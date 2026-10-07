import gzip
import hashlib
import json
import sqlite3
import time
from builtins import list as ListType
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.storage import Client as StorageClient

from code_groove.errors import GrooveError
from code_groove.settings import Settings


def normalize(value):
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    return value


class Transaction:
    def __init__(self, get: Callable, put: Callable):
        self.get = get
        self.put = put


class MetadataStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cloud = settings.store_mode == "gcp"
        self.db: Any = None
        if self.cloud:
            self.db = firestore.Client(
                project=settings.google_cloud_project, database=settings.firestore_database
            )
        else:
            settings.local_data_dir.mkdir(parents=True, exist_ok=True)
            self.path = settings.local_data_dir / "metadata.sqlite"
            with self.connect() as connection:
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS documents (collection TEXT, id TEXT, value TEXT, PRIMARY KEY(collection,id))"
                )

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def get(self, collection: str, key: str) -> dict | None:
        if self.cloud:
            return normalize(self.db.collection(collection).document(key).get().to_dict())
        with self.connect() as connection:
            row = connection.execute(
                "SELECT value FROM documents WHERE collection=? AND id=?", (collection, key)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def atomic(self, operation: Callable[[Transaction], Any]) -> Any:
        def cloud_payload(value):
            payload = dict(value)
            if isinstance(payload.get("expires_at"), (float, int)):
                payload["expires_at"] = datetime.fromtimestamp(payload["expires_at"], UTC)
            return payload

        if self.cloud:

            @firestore.transactional
            def apply(transaction):
                def get(collection, key):
                    return normalize(
                        self.db.collection(collection).document(key).get(transaction=transaction).to_dict()
                    )

                def put(collection, key, value):
                    transaction.set(self.db.collection(collection).document(key), cloud_payload(value))

                return operation(Transaction(get, put))

            return apply(self.db.transaction())
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")

            def get(collection, key):
                row = connection.execute(
                    "SELECT value FROM documents WHERE collection=? AND id=?", (collection, key)
                ).fetchone()
                return json.loads(row[0]) if row else None

            def put(collection, key, value):
                connection.execute(
                    "INSERT OR REPLACE INTO documents VALUES (?,?,?)", (collection, key, json.dumps(value))
                )

            return operation(Transaction(get, put))

    def put(self, collection: str, key: str, value: dict) -> None:
        self.atomic(lambda tx: tx.put(collection, key, value))

    def update(self, collection: str, key: str, changes: dict) -> dict:
        def operation(tx):
            value = tx.get(collection, key)
            if value is None:
                raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)
            value.update(changes, updated_at=time.time())
            tx.put(collection, key, value)
            return value

        return self.atomic(operation)

    def list(self, collection: str, field: str | None = None, value: Any = None) -> list[dict]:
        if self.cloud:
            query = self.db.collection(collection)
            if field:
                query = query.where(filter=FieldFilter(field, "==", value))
            return [normalize(doc.to_dict()) for doc in query.stream()]
        with self.connect() as connection:
            values = [
                json.loads(row[0])
                for row in connection.execute("SELECT value FROM documents WHERE collection=?", (collection,))
            ]
            return [item for item in values if not field or item.get(field) == value]

    def events_after(self, run_id: str, after_seq: int, limit: int, head_seq: int) -> ListType[dict]:
        """Read only the requested immutable event page; no growing history query."""
        stop = min(head_seq, after_seq + limit)
        if stop <= after_seq:
            return []
        if self.cloud:
            refs = [
                self.db.collection("run_events").document(f"{run_id}_{seq:06}")
                for seq in range(after_seq + 1, stop + 1)
            ]
            values = [normalize(doc.to_dict()) for doc in self.db.get_all(refs) if doc.exists]
        else:
            with self.connect() as connection:
                rows = connection.execute(
                    "SELECT value FROM documents WHERE collection='run_events' "
                    "AND json_extract(value,'$.run_id')=? "
                    "AND json_extract(value,'$.seq')>? AND json_extract(value,'$.seq')<=?",
                    (run_id, after_seq, stop),
                )
                values = [json.loads(row[0]) for row in rows]
        return sorted(values, key=lambda value: value["seq"])

    def append_event(self, run_id: str, kind: str, payload: dict, attempt: str | None = None) -> None:
        def operation(tx):
            run = tx.get("runs", run_id)
            if not run or attempt and run.get("attempt_id") != attempt:
                raise GrooveError("LEASE_LOST", "処理の所有権が移動しました。", 409)
            seq = run.get("seq", 0) + 1
            now = time.time()
            event = {
                "run_id": run_id,
                "project_id": run["project_id"],
                "owner_uid": run["owner_uid"],
                "seq": seq,
                "type": kind,
                "timestamp": datetime.now(UTC).isoformat(),
                "payload": payload,
                "created_at": now,
                "updated_at": now,
                "expires_at": run["expires_at"],
            }
            tx.put("run_events", f"{run_id}_{seq:06}", event)
            tx.put("runs", run_id, {**run, "seq": seq, "updated_at": now})

        self.atomic(operation)

    def delete_project_children(self, project_id: str) -> None:
        for collection in ("analyses", "investigations", "proposals", "run_events", "runs"):
            if self.cloud:
                query = self.db.collection(collection).where(
                    filter=FieldFilter("project_id", "==", project_id)
                )
                for document in query.stream():
                    document.reference.delete()
            else:
                with self.connect() as connection:
                    rows = connection.execute(
                        "SELECT id,value FROM documents WHERE collection=?", (collection,)
                    ).fetchall()
                    for identifier, payload in rows:
                        if json.loads(payload).get("project_id") == project_id:
                            connection.execute(
                                "DELETE FROM documents WHERE collection=? AND id=?", (collection, identifier)
                            )


class ArtifactStore:
    def __init__(self, settings: Settings):
        self.cloud = settings.store_mode == "gcp"
        self.directory = settings.local_data_dir / "artifacts"
        self.bucket: Any = None
        if self.cloud:
            self.bucket = StorageClient(project=settings.google_cloud_project).bucket(
                settings.artifact_bucket
            )
        else:
            self.directory.mkdir(parents=True, exist_ok=True)

    def put(self, key: str, value: dict) -> None:
        data = gzip.compress(json.dumps(value, ensure_ascii=False, sort_keys=True).encode(), mtime=0)
        digest = hashlib.sha256(data).hexdigest()
        if self.cloud:
            blob = self.bucket.blob(key)
            if blob.exists():
                blob.reload()
                if blob.metadata.get("sha256") != digest:
                    raise GrooveError("IMMUTABLE_CONFLICT", "保存済みartifactを上書きできません。", 409)
                return
            blob.metadata = {"sha256": digest}
            blob.upload_from_string(data, content_type="application/gzip", if_generation_match=0)
        else:
            destination = self.directory / key
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                with destination.open("xb") as stream:
                    stream.write(data)
            except FileExistsError:
                if destination.read_bytes() != data:
                    raise GrooveError("IMMUTABLE_CONFLICT", "artifactを上書きできません。", 409) from None

    def get(self, key: str) -> dict:
        data = (
            self.bucket.blob(key).download_as_bytes() if self.cloud else (self.directory / key).read_bytes()
        )
        return json.loads(gzip.decompress(data))

    def delete_project(self, project_id: str) -> None:
        prefix = f"projects/{project_id}/"
        if self.cloud:
            for blob in self.bucket.list_blobs(prefix=prefix):
                blob.delete()
        else:
            directory = (self.directory / prefix).resolve()
            if not directory.is_relative_to(self.directory.resolve()):
                raise RuntimeError("Invalid artifact deletion root")
            if directory.exists():
                for path in directory.rglob("*"):
                    if path.is_file():
                        path.unlink()
                for path in sorted(directory.rglob("*"), reverse=True):
                    if path.is_dir():
                        path.rmdir()
                directory.rmdir()
