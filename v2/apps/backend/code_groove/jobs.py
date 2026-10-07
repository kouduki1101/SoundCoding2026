import asyncio
import hashlib
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from google.api_core.exceptions import AlreadyExists
from google.cloud import tasks_v2

from code_groove.agent import AgentContext, run_agent
from code_groove.errors import GrooveError
from code_groove.improvements import apply_edits, proposal_diff, source_hash
from code_groove.incremental import INDEX_VERSION, PROMPT_VERSION, compatible, reuse_unchanged
from code_groove.reconciliation import follow_reconciliation, reconciliation_scope
from code_groove.repository import cached_chunks, follow_chunk, plan_repository, select_chunk
from code_groove.schemas import (
    ComparisonInvestigationRequest,
    ComparisonInvestigationResult,
    Coverage,
    Evidence,
    ImprovementProposal,
    InvestigationResult,
    SemanticMap,
)
from code_groove.settings import ROOT, Settings
from code_groove.source import build_index, github_snapshot, run_node, sample_snapshot
from code_groove.storage import ArtifactStore, MetadataStore, Transaction
from code_groove.structure import validate_comparison_request

TERMINAL = {"completed", "partial", "failed", "cancelled"}
DAILY_ANALYSIS_LIMIT = 10


class JobService:
    def __init__(self, settings: Settings, metadata: MetadataStore, artifacts: ArtifactStore):
        self.settings, self.store, self.artifacts = settings, metadata, artifacts

    def create(
        self,
        uid: str,
        body: dict,
        key: str,
        kind: str = "analysis",
        project: dict | None = None,
        local_sources: dict[str, str] | None = None,
    ) -> dict:
        if not self.settings.enable_live_analysis:
            raise GrooveError("LIVE_DISABLED", "実解析は現在停止しています。保存結果は再生できます。", 503)
        if self.settings.model_mode != "live":
            raise GrooveError("LIVE_DISABLED", "実解析にはliveモードの設定が必要です。", 503)
        if (self.store.get("runtime_controls", "global") or {}).get("kill_switch"):
            raise GrooveError("LIVE_DISABLED", "新しい実解析を停止しています。", 503)
        now = time.time()
        date = datetime.now(UTC).strftime("%Y-%m-%d")
        quota_id = f"{uid}_{date}"
        idem = hashlib.sha256(f"{uid}:{kind}:{key}".encode()).hexdigest()
        body_hash = hashlib.sha256(
            json.dumps({"body": body, "project": project and project["project_id"]}, sort_keys=True).encode()
        ).hexdigest()
        run_id = f"run_{uuid.uuid4().hex}"
        project_id = project["project_id"] if project else f"p_{uuid.uuid4().hex}"
        prepared_key = None
        if local_sources is not None:
            project_id = f"p_{idem[:32]}"
            sha = source_hash(local_sources)
            prepared_key = f"projects/{project_id}/inputs/{sha}/source.json.gz"
        reserved_input, reserved_output = (
            (160000, 20000) if kind in ("investigation", "proposal") else (400000, 48000)
        )

        def operation(tx: Transaction) -> dict:
            previous = tx.get("idempotency", idem)
            if previous and previous["expires_at"] > now:
                if previous["request_hash"] != body_hash:
                    raise GrooveError("IDEMPOTENCY_CONFLICT", "同じキーが異なる要求に使われています。", 409)
                existing = tx.get("runs", previous["run_id"])
                if not existing:
                    raise GrooveError("EXPIRED", "以前の要求は削除されています。", 410)
                return existing
            account = tx.get("accounts", uid) or {}
            if not account.get("enabled"):
                raise GrooveError("ACCOUNT_NOT_ALLOWED", "このアカウントは利用許可されていません。", 403)
            active = tx.get("runs", account["active_run_id"]) if account.get("active_run_id") else None
            user_quota = tx.get("daily_quotas", quota_id) or {
                "analyses": 0,
                "investigations": 0,
                "reserved_input": 0,
                "reserved_output": 0,
                "consumed_input": 0,
                "consumed_output": 0,
            }
            global_quota = tx.get("global_quotas", date) or {
                "reserved_input": 0,
                "reserved_output": 0,
                "consumed_input": 0,
                "consumed_output": 0,
            }
            current_project = tx.get("projects", project_id) if project else None
            if project and (
                not current_project
                or current_project["status"] in ("deleting", "deleted")
                or current_project["expires_at"] <= now
            ):
                raise GrooveError("NOT_FOUND", "projectを利用できません。", 404)
            if (kind in ("investigation", "proposal") or body.get("proposal_id")) and (
                (current_project or {}).get("latest_analysis_id") != body["analysis_id"]
            ):
                raise GrooveError("STALE_BASE_ANALYSIS", "解釈が更新されています。", 409)
            if active and active["status"] not in TERMINAL:
                raise GrooveError("ACTIVE_RUN_LIMIT", "実行中の調査を完了または停止してください。", 429)
            refresh = kind == "analysis" and bool(body.get("refresh"))
            counter = (
                "refreshes"
                if refresh
                else "investigations"
                if kind in ("investigation", "proposal")
                else "analyses"
            )
            user_quota.setdefault("refreshes", 0)
            if user_quota[counter] >= (
                10 if refresh or kind in ("investigation", "proposal") else DAILY_ANALYSIS_LIMIT
            ):
                raise GrooveError("DAILY_QUOTA", "本日（UTC）の実解析上限に達しました。", 429)
            if body.get("proposal_id") and user_quota["analyses"] >= DAILY_ANALYSIS_LIMIT:
                raise GrooveError(
                    "DAILY_QUOTA", "改善後の実解析を予約できません。本日（UTC）の上限に達しました。", 429
                )
            if (
                global_quota["reserved_input"] + global_quota["consumed_input"] + reserved_input > 3000000
                or global_quota["reserved_output"] + global_quota["consumed_output"] + reserved_output
                > 300000
            ):
                raise GrooveError("GLOBAL_QUOTA", "本日（UTC）の全体トークン予算に達しました。", 429)
            expires = project["expires_at"] if project else now + 7 * 86400
            run = {
                "run_id": run_id,
                "project_id": project_id,
                "owner_uid": uid,
                "kind": kind,
                "body": body,
                "status": "enqueue_pending",
                "cancel_requested": False,
                "attempt": 0,
                "seq": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "model_requests": 0,
                "tool_calls": 0,
                "reserved_input": reserved_input,
                "reserved_output": reserved_output,
                "quota_id": quota_id,
                "quota_date": date,
                "quota_released": False,
                "analysis_counted": not refresh or bool(body.get("proposal_id")),
                "created_at": now,
                "updated_at": now,
                "expires_at": expires,
            }
            if body.get("proposal_id"):
                proposal = tx.get("proposals", body["proposal_id"])
                if not proposal or proposal["owner_uid"] != uid or proposal.get("status", "draft") != "draft":
                    raise GrooveError("INVALID_STATE", "この改善案は既に処理されています。", 409)
                tx.put(
                    "proposals",
                    body["proposal_id"],
                    {**proposal, "status": "accepted", "accepted_run_id": run_id, "updated_at": now},
                )
            if not project:
                tx.put(
                    "projects",
                    project_id,
                    {
                        "project_id": project_id,
                        "owner_uid": uid,
                        "source": body["source"],
                        **({"pull_request": body["pull_request"]} if body.get("pull_request") else {}),
                        "status": "enqueue_pending",
                        "run_id": run_id,
                        "created_at": now,
                        "updated_at": now,
                        "expires_at": expires,
                        **({"snapshot_key": prepared_key} if prepared_key else {}),
                    },
                )
            elif kind == "analysis":
                tx.put(
                    "projects", project_id, {**(current_project or {}), "run_id": run_id, "updated_at": now}
                )
            elif kind == "proposal":
                tx.put(
                    "projects",
                    project_id,
                    {**(current_project or {}), "proposal_run_id": run_id, "updated_at": now},
                )
            elif kind == "investigation":
                tx.put(
                    "projects",
                    project_id,
                    {
                        **(current_project or {}),
                        ("comparison_run_id" if body.get("comparison") else "investigation_run_id"): run_id,
                        "investigation_analysis_id": body["analysis_id"],
                        "updated_at": now,
                    },
                )
            for collection, identifier, quota in [
                ("daily_quotas", quota_id, user_quota),
                ("global_quotas", date, global_quota),
            ]:
                quota["reserved_input"] += reserved_input
                quota["reserved_output"] += reserved_output
                if collection == "daily_quotas":
                    quota[counter] += 1
                    if body.get("proposal_id"):
                        quota["analyses"] += 1
                quota.update(
                    updated_at=now, created_at=quota.get("created_at", now), expires_at=now + 2 * 86400
                )
                tx.put(collection, identifier, quota)
            tx.put("accounts", uid, {**account, "active_run_id": run_id, "updated_at": now})
            tx.put("runs", run_id, run)
            tx.put(
                "idempotency",
                idem,
                {
                    "owner_uid": uid,
                    "request_hash": body_hash,
                    "run_id": run_id,
                    "created_at": now,
                    "updated_at": now,
                    "expires_at": now + 86400,
                },
            )
            return run

        run = self.store.atomic(operation)
        if prepared_key and local_sources is not None:
            # Admission precedes storage; a denied upload creates no billable artifact.
            # Idempotent retries can finish this write before the task is enqueued.
            self.artifacts.put(prepared_key, {"sha": source_hash(local_sources), "sources": local_sources})
        try:
            self.enqueue(run)
        except GrooveError as exc:
            if exc.code != "ENQUEUE_PENDING":
                raise
        current = self.store.get("runs", run["run_id"]) or run
        return {"project_id": run["project_id"], "run_id": run["run_id"], "status": current["status"]}

    def enqueue(self, run: dict) -> None:
        if run["status"] != "enqueue_pending":
            return
        if self.settings.store_mode == "gcp":
            client = tasks_v2.CloudTasksClient()
            parent = client.queue_path(
                self.settings.google_cloud_project, self.settings.gcp_region, self.settings.tasks_queue
            )
            task: Any = {
                "name": f"{parent}/tasks/cg-{run['run_id']}",
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": f"{self.settings.worker_url}/internal/tasks/run",
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"run_id": run["run_id"]}).encode(),
                    "oidc_token": {
                        "service_account_email": self.settings.tasks_invoker_email,
                        "audience": self.settings.worker_url,
                    },
                },
                "dispatch_deadline": {"seconds": 600},
            }
            try:
                client.create_task(parent=parent, task=task)
            except AlreadyExists:
                pass
            except Exception as exc:
                raise GrooveError("ENQUEUE_PENDING", "登録した処理を再投入できます。", 503, True) from exc

        def operation(tx):
            current = tx.get("runs", run["run_id"])
            if current and current["status"] == "enqueue_pending":
                tx.put("runs", run["run_id"], {**current, "status": "queued", "updated_at": time.time()})

        self.store.atomic(operation)

    def claim(self, run_id: str, attempt_id: str) -> dict | None:
        now = time.time()

        def operation(tx):
            run = tx.get("runs", run_id)
            if not run or run["status"] in TERMINAL:
                return None
            if run.get("lease_expires_at", 0) > now:
                raise GrooveError("LEASE_BUSY", "別のworkerが実行中です。", 409, True)
            if run["attempt"] >= 2:
                tx.put(
                    "runs",
                    run_id,
                    {
                        **run,
                        "status": "failed",
                        "error": {"code": "ATTEMPT_LIMIT", "message": "再試行回数の上限です。"},
                    },
                )
                return None
            run.update(
                attempt=run["attempt"] + 1,
                attempt_id=attempt_id,
                lease_expires_at=now + 90,
                started_at=run.get("started_at", now),
                updated_at=now,
            )
            tx.put("runs", run_id, run)
            return run

        return self.store.atomic(operation)

    def guard(self, run_id: str, attempt: str) -> dict:
        run = self.store.get("runs", run_id)
        project = self.store.get("projects", run["project_id"]) if run else None
        if not run or run.get("attempt_id") != attempt or run.get("lease_expires_at", 0) < time.time():
            raise GrooveError("LEASE_LOST", "処理の所有権が移動しました。", 409)
        if (
            run["cancel_requested"]
            or not project
            or project["status"] in ("deleting", "deleted")
            or project["expires_at"] <= time.time()
        ):
            raise GrooveError("CANCELLED", "処理を停止しました。")
        if (self.store.get("runtime_controls", "global") or {}).get("kill_switch"):
            raise GrooveError("CANCELLED", "新規モデル呼び出しを停止しました。")
        if not (self.store.get("accounts", run["owner_uid"]) or {}).get("enabled"):
            raise GrooveError("CANCELLED", "アカウントの利用を停止しました。")
        limit = 180 if run["kind"] in ("investigation", "proposal") else 480
        if time.time() - run["started_at"] > limit:
            raise GrooveError("MODEL_TIMEOUT", "調査の制限時間を超えました。", 408)
        return run

    def mutate(self, run_id: str, attempt: str, values: dict) -> None:
        def operation(tx):
            run = tx.get("runs", run_id)
            if not run or run.get("attempt_id") != attempt:
                raise GrooveError("LEASE_LOST", "処理の所有権が移動しました。", 409)
            tx.put("runs", run_id, {**run, **values, "updated_at": time.time()})

        self.store.atomic(operation)

    def settle_quota(self, run_id: str) -> None:
        def operation(tx):
            run = tx.get("runs", run_id)
            if run["quota_released"]:
                return
            account = tx.get("accounts", run["owner_uid"]) or {}
            quotas = [
                ("daily_quotas", run["quota_id"], tx.get("daily_quotas", run["quota_id"])),
                ("global_quotas", run["quota_date"], tx.get("global_quotas", run["quota_date"])),
            ]
            for collection, identifier, quota in quotas:
                if quota:
                    quota["reserved_input"] -= run["reserved_input"]
                    quota["reserved_output"] -= run["reserved_output"]
                    quota["consumed_input"] += run["input_tokens"]
                    quota["consumed_output"] += run["output_tokens"]
                    tx.put(collection, identifier, quota)
            if account.get("active_run_id") == run_id:
                tx.put(
                    "accounts",
                    run["owner_uid"],
                    {**account, "active_run_id": None, "updated_at": time.time()},
                )
            tx.put("runs", run_id, {**run, "quota_released": True, "updated_at": time.time()})

        self.store.atomic(operation)

    def cancel(self, run_id: str) -> bool:
        def operation(tx):
            run = tx.get("runs", run_id)
            if not run or run["status"] in TERMINAL:
                return False
            run["cancel_requested"] = True
            if run.get("lease_expires_at", 0) <= time.time():
                run["status"] = "cancelled"
            tx.put("runs", run_id, {**run, "updated_at": time.time()})
            return run["status"] == "cancelled"

        if self.store.atomic(operation):
            self.settle_quota(run_id)
        return bool((self.store.get("runs", run_id) or {}).get("cancel_requested"))

    async def handle(self, run_id: str) -> None:
        attempt = uuid.uuid4().hex
        run = await asyncio.to_thread(self.claim, run_id, attempt)
        if not run:
            current = self.store.get("runs", run_id)
            if current and current["status"] in TERMINAL:
                self.settle_quota(run_id)
            return

        async def heartbeat():
            while True:
                await asyncio.sleep(15)
                await asyncio.to_thread(self.mutate, run_id, attempt, {"lease_expires_at": time.time() + 90})

        heartbeat_task = asyncio.create_task(heartbeat())

        def emit(kind, payload):
            self.store.append_event(run_id, kind, payload, attempt)
            print(
                json.dumps(
                    {
                        "event_type": kind,
                        "run_id": run_id,
                        "attempt_id": attempt,
                        "model_id": self.settings.gemini_model,
                        "error_code": payload.get("code"),
                    }
                ),
                flush=True,
            )

        try:
            self.guard(run_id, attempt)
            emit("run_started", {"kind": run["kind"]})
            project = self.store.get("projects", run["project_id"])
            if not project:
                raise GrooveError("CANCELLED", "projectが削除されています。")
            if run["kind"] in ("investigation", "proposal"):
                base_meta = self.store.get("analyses", run["body"]["analysis_id"])
                if not base_meta or not base_meta.get("snapshot_key"):
                    raise GrooveError("STALE_BASE_ANALYSIS", "元のコードが見つかりません。", 409)
                project = {**project, "snapshot_key": base_meta["snapshot_key"]}
            previous = None
            snapshot_key = project.get("snapshot_key")
            cached, changes = None, None
            cached_evidence: list[Evidence] = []
            prior_map = None
            if project.get("latest_analysis_id") and run["kind"] == "analysis":
                meta = self.store.get("analyses", project["latest_analysis_id"])
                if meta:
                    prior_map = self.artifacts.get(meta["artifact_key"])["map"]
            if project.get("snapshot_key"):
                previous = await asyncio.to_thread(self.artifacts.get, project["snapshot_key"])
                if prior_map and meta and not meta.get("snapshot_key"):
                    self.store.update(
                        "analyses", project["latest_analysis_id"], {"snapshot_key": project["snapshot_key"]}
                    )
            if run["body"].get("derived_sources_key"):
                derived = await asyncio.to_thread(self.artifacts.get, run["body"]["derived_sources_key"])
                sources = derived["sources"]
                sha = source_hash(sources)
                snapshot_id = f"snap_{sha[:24]}_{hashlib.sha256(INDEX_VERSION.encode()).hexdigest()[:6]}"
                self.mutate(run_id, attempt, {"status": "indexing"})
                index = await asyncio.to_thread(
                    build_index,
                    snapshot_id,
                    sources,
                    repository=bool(previous and previous.get("repository_plan")),
                )
                if project["source"].get("scope_path"):
                    index["scope_path"] = project["source"]["scope_path"]
                    index["scope_note"] = (
                        "範囲外の実装・呼び出し元は未検査。リポジトリ全体の健全性を断定しない。"
                    )
                snapshot = {
                    "sha": sha,
                    "snapshot_id": snapshot_id,
                    "sources": sources,
                    "index": index,
                    "index_version": INDEX_VERSION,
                }
                snapshot_key = f"projects/{run['project_id']}/snapshots/{snapshot_id}/snapshot.json.gz"
                if previous and previous.get("repository_plan"):
                    snapshot["repository_plan"] = plan_repository(index, sources)
                    prior_analysis = self.store.get("analyses", run["body"]["analysis_id"]) or {}
                    if prior_analysis.get("integration_chunk_ids"):
                        integration_chunks, integration_units = follow_reconciliation(
                            previous, snapshot, prior_analysis
                        )
                        run["body"].update(
                            integration_chunk_ids=integration_chunks, integration_unit_ids=integration_units
                        )
                    matching = follow_chunk(
                        previous["repository_plan"],
                        snapshot["repository_plan"],
                        prior_analysis.get("chunk_id"),
                    )
                    if matching:
                        run["body"]["chunk_id"] = matching
                await asyncio.to_thread(self.artifacts.put, snapshot_key, snapshot)
                emit(
                    "improvement_applied",
                    {"proposal_id": run["body"]["proposal_id"], "snapshot_id": snapshot_id},
                )
            elif project.get("snapshot_key") and (
                not run["body"].get("refresh")
                or project.get("working_copy")
                or run["body"].get("chunk_id")
                or run["body"].get("integration_chunk_ids")
                or project["source"]["kind"] == "local_snapshot"
            ):
                snapshot = await asyncio.to_thread(self.artifacts.get, project["snapshot_key"])
                if "index" not in snapshot:
                    sha, sources = snapshot["sha"], snapshot["sources"]
                    snapshot_id = f"snap_{sha[:24]}_{hashlib.sha256(INDEX_VERSION.encode()).hexdigest()[:6]}"
                    self.mutate(run_id, attempt, {"status": "indexing"})
                    index = await asyncio.to_thread(build_index, snapshot_id, sources, repository=True)
                    snapshot = {
                        "sha": sha,
                        "snapshot_id": snapshot_id,
                        "sources": sources,
                        "index": index,
                        "index_version": INDEX_VERSION,
                    }
                    snapshot_key = f"projects/{run['project_id']}/snapshots/{snapshot_id}/snapshot.json.gz"
                    snapshot["repository_plan"] = plan_repository(index, sources)
                    await asyncio.to_thread(self.artifacts.put, snapshot_key, snapshot)
                    self.store.update(
                        "projects",
                        run["project_id"],
                        {"snapshot_key": snapshot_key, "snapshot_id": snapshot_id, "sha": sha},
                    )
                    emit(
                        "source_pinned",
                        {
                            "sha": sha,
                            "snapshot_id": snapshot_id,
                            "provenance": "user_supplied_committed_snapshot",
                        },
                    )
            else:
                self.mutate(run_id, attempt, {"status": "fetching"})
                source = project["source"]
                if source["kind"] == "sample":
                    sha, sources = sample_snapshot(source["sample_id"])
                else:
                    if source.get("scope_path"):
                        sha, sources = await github_snapshot(
                            source["url"], source.get("ref"), source["scope_path"]
                        )
                        emit(
                            "scope_selected",
                            {
                                "message": "対象フォルダーのみ健診。範囲外は未検査です。",
                                "scope_path": source["scope_path"],
                            },
                        )
                    else:
                        sha, sources = await github_snapshot(source["url"], source.get("ref"))
                snapshot_id = f"snap_{sha[:24]}_{hashlib.sha256(INDEX_VERSION.encode()).hexdigest()[:6]}"
                emit("source_pinned", {"sha": sha, "snapshot_id": snapshot_id})
                self.mutate(run_id, attempt, {"status": "indexing"})
                unchanged_index = (
                    previous
                    and previous["sources"] == sources
                    and previous.get("index_version") == INDEX_VERSION
                )
                if unchanged_index:
                    assert previous is not None
                    snapshot_id = previous["snapshot_id"]
                    index = previous["index"]
                    emit("index_cache_hit", {"snapshot_id": snapshot_id})
                else:
                    index = await asyncio.to_thread(build_index, snapshot_id, sources, repository=True)
                    if source.get("scope_path"):
                        index["scope_path"] = source["scope_path"]
                        index["scope_note"] = (
                            "範囲外の実装・呼び出し元は未検査。リポジトリ全体の健全性を断定しない。"
                        )
                snapshot = {
                    "sha": sha,
                    "snapshot_id": snapshot_id,
                    "sources": sources,
                    "index": index,
                    "index_version": INDEX_VERSION,
                }
                if (
                    len(index["units"]) > 32
                    or sum(f["is_source"] for f in index["files"]) > 40
                    or sum(f["lines"] for f in index["files"] if f["is_source"]) > 6000
                ):
                    snapshot["repository_plan"] = plan_repository(index, sources)
                key = (
                    project["snapshot_key"]
                    if unchanged_index
                    else f"projects/{run['project_id']}/snapshots/{snapshot_id}/snapshot.json.gz"
                )
                snapshot_key = key
                await asyncio.to_thread(self.artifacts.put, key, snapshot)
                self.store.update(
                    "projects",
                    run["project_id"],
                    {"snapshot_key": key, "snapshot_id": snapshot_id, "sha": sha},
                )
            partition = None
            agent_index = snapshot["index"]
            integration_context = []
            if run["kind"] in ("investigation", "proposal") and (base_meta or {}).get(
                "integration_chunk_ids"
            ):
                assert base_meta is not None
                run["body"]["integration_chunk_ids"] = base_meta["integration_chunk_ids"]
                run["body"]["integration_unit_ids"] = base_meta["integration_unit_ids"]
            if snapshot.get("repository_plan") and not run["body"].get("integration_chunk_ids"):
                plan = snapshot["repository_plan"]
                available = cached_chunks(
                    plan,
                    self.store.list("analyses", "project_id", run["project_id"]),
                    self.settings.gemini_model,
                )
                chosen = run["body"].get("chunk_id")
                if run["kind"] in ("investigation", "proposal"):
                    chosen = (base_meta or {}).get("chunk_id")
                if not chosen:
                    chosen = next(
                        (c["chunk_id"] for c in plan["chunks"] if c["chunk_id"] not in available),
                        plan["chunks"][0]["chunk_id"],
                    )
                agent_index = select_chunk(snapshot, chosen)
                partition = next(c for c in plan["chunks"] if c["chunk_id"] == chosen)
                emit(
                    "partition_selected",
                    {
                        "message": f"分割範囲を検査 · 保存済み{len(available)}/{len(plan['chunks'])}範囲 · 残りは未検査",
                        "chunk_id": chosen,
                        "paths": partition["paths"],
                        "units": len(partition["unit_ids"]),
                        "repository_symbols": plan["indexed_symbols"],
                    },
                )
                if run["kind"] == "analysis" and chosen in available and not run["body"].get("retry_partial"):
                    saved = available[chosen]
                    emit(
                        "analysis_cache_hit",
                        {"analysis_id": saved["analysis_id"], "chunk_id": chosen, "model_requests": 0},
                    )
                    self.mutate(run_id, attempt, {"status": "partial", "result_id": saved["analysis_id"]})
                    self.store.update(
                        "projects",
                        run["project_id"],
                        {"status": "partial", "latest_analysis_id": saved["analysis_id"]},
                    )
                    return
            if run["body"].get("integration_chunk_ids"):
                chunk_ids = run["body"]["integration_chunk_ids"]
                agent_index, partition = reconciliation_scope(
                    snapshot, chunk_ids, run["body"]["integration_unit_ids"]
                )
                saved = [
                    a
                    for a in self.store.list("analyses", "project_id", run["project_id"])
                    if a.get("chunk_id") in chunk_ids
                    and a.get("snapshot_id") == snapshot["snapshot_id"]
                    and a["owner_uid"] == run["owner_uid"]
                    and a["expires_at"] > time.time()
                ]
                if run["body"].get("proposal_id") and prior_map:
                    integration_context = [
                        {
                            "analysis_id": prior_map["analysis_id"],
                            "responsibilities": prior_map["responsibilities"],
                            "unknowns": prior_map["profile"]["unknowns"],
                            "note": "Previous approved snapshot; all selected new code must be read again",
                        }
                    ]
                elif {a["chunk_id"] for a in saved} != set(chunk_ids):
                    raise GrooveError("INVALID_SELECTION", "統合元の保存結果を利用できません。")
                for cid in [] if integration_context else chunk_ids:
                    meta = max((a for a in saved if a["chunk_id"] == cid), key=lambda a: a["created_at"])
                    value = self.artifacts.get(meta["artifact_key"])["map"]
                    integration_context.append(
                        {
                            "chunk_id": cid,
                            "analysis_id": value["analysis_id"],
                            "responsibilities": value["responsibilities"],
                            "unknowns": value["profile"]["unknowns"],
                        }
                    )
                emit(
                    "integration_selected",
                    {
                        "chunk_ids": chunk_ids,
                        "units": len(agent_index["units"]),
                        "message": "保存解釈を仮説として、新しい読取根拠で範囲間を統合調査",
                    },
                )
            if not partition and prior_map and compatible(prior_map, self.settings.gemini_model) and previous:
                if (
                    previous["sources"] == snapshot["sources"]
                    and previous.get("index_version") == INDEX_VERSION
                ):
                    emit("analysis_cache_hit", {"analysis_id": prior_map["analysis_id"], "model_requests": 0})
                    self.mutate(
                        run_id, attempt, {"status": "completed", "result_id": prior_map["analysis_id"]}
                    )
                    self.store.update("projects", run["project_id"], {"status": "completed"})
                    return
                if previous.get("index_version") == INDEX_VERSION:
                    cached, cached_evidence, changes = reuse_unchanged(prior_map, previous, snapshot)
                    emit("incremental_scope", changes)
            emit(
                "index_ready",
                {"units": len(snapshot["index"]["units"]), "files": len(snapshot["index"]["files"])},
            )
            self.mutate(run_id, attempt, {"status": "investigating"})
            if run["kind"] == "analysis" and run["body"].get("refresh"):

                def count_refresh_analysis(tx):
                    current = tx.get("runs", run_id)
                    quota = tx.get("daily_quotas", run["quota_id"])
                    if current.get("analysis_counted"):
                        return
                    if quota["analyses"] >= DAILY_ANALYSIS_LIMIT:
                        raise GrooveError(
                            "DAILY_QUOTA", "変更あり。本日（UTC）のAI解析上限に達しました。", 429
                        )
                    tx.put("daily_quotas", run["quota_id"], {**quota, "analyses": quota["analyses"] + 1})
                    tx.put("runs", run_id, {**current, "analysis_counted": True})

                self.store.atomic(count_refresh_analysis)
            base = None
            if run["kind"] in ("investigation", "proposal"):
                analysis = self.store.get("analyses", run["body"]["analysis_id"])
                if not analysis:
                    raise GrooveError("STALE_BASE_ANALYSIS", "元の解析が見つかりません。", 409)
                base = self.artifacts.get(analysis["artifact_key"])["map"]

            if run["body"].get("comparison"):
                comparison_request = ComparisonInvestigationRequest.model_validate(run["body"]["comparison"])
                comparison = validate_comparison_request(snapshot, comparison_request)
                selected_ids = {comparison_request.unit_a, comparison_request.unit_b}
                agent_index = {
                    **snapshot["index"],
                    "units": [u for u in snapshot["index"]["units"] if u["unit_id"] in selected_ids],
                }
                run["body"]["comparison_context"] = {
                    "a": comparison["a"],
                    "b": comparison["b"],
                    "rows": comparison["rows"][comparison_request.start_row : comparison_request.end_row],
                    "prompt_version": "comparison-agent-v1",
                }

            def guard():
                self.guard(run_id, attempt)

            ctx = AgentContext(
                self.settings,
                run["project_id"],
                snapshot["snapshot_id"],
                snapshot["sources"],
                agent_index,
                emit,
                guard,
                lambda values: self.mutate(run_id, attempt, values),
                base=base,
                cached_interpretation=cached,
                changes=changes,
                evidence=cached_evidence,
                selection=run["body"] if base else None,
                proposing=run["kind"] == "proposal",
                analysis_depth="focused" if base or run["body"].get("proposal_id") else "overview",
                prior_motifs=[
                    {k: r[k] for k in ("responsibility_id", "label", "motif_id", "change_reason")}
                    for r in (prior_map or {}).get("responsibilities", [])
                ],
                input_tokens=run["input_tokens"],
                output_tokens=run["output_tokens"],
                model_count=run["model_requests"],
                tool_count=run["tool_calls"],
                started=time.monotonic() - max(0, time.time() - run["started_at"]),
                repository_index=snapshot["index"] if partition or run["body"].get("comparison") else None,
                integration_context=integration_context,
            )
            candidate = await run_agent(ctx)
            self.guard(run_id, attempt)
            result_id = f"{'proposal' if ctx.proposing else 'investigation' if base else 'analysis'}_{uuid.uuid4().hex}"
            if ctx.proposing:
                assert base is not None
                changed = apply_edits(candidate, snapshot["sources"], ctx.evidence)
                result = ImprovementProposal(
                    **candidate.model_dump(),
                    proposal_id=result_id,
                    base_analysis_id=base["analysis_id"],
                    base_snapshot_id=ctx.snapshot_id,
                    source_hash=source_hash(snapshot["sources"]),
                    evidence=ctx.evidence,
                    diff=proposal_diff(snapshot["sources"], changed),
                ).model_dump(mode="json")
                collection = "proposals"
                artifact_key = f"projects/{run['project_id']}/proposals/{result_id}/proposal.json.gz"
            elif ctx.comparing:
                assert base is not None
                result = ComparisonInvestigationResult(
                    **candidate.model_dump(),
                    investigation_id=result_id,
                    base_analysis_id=base["analysis_id"],
                    origin="live",
                    request=ComparisonInvestigationRequest.model_validate(run["body"]["comparison"]),
                    evidence=ctx.evidence,
                    model_id=self.settings.gemini_model,
                ).model_dump(mode="json")
                collection = "investigations"
                artifact_key = f"projects/{run['project_id']}/investigations/{result_id}/result.json.gz"
            elif base:
                result = InvestigationResult(
                    **candidate.model_dump(),
                    investigation_id=result_id,
                    base_analysis_id=base["analysis_id"],
                    selected_unit_ids=run["body"]["unit_ids"],
                    selected_event_ids=run["body"]["event_ids"],
                    evidence=ctx.evidence,
                ).model_dump(mode="json")
                collection = "investigations"
                artifact_key = f"projects/{run['project_id']}/investigations/{result_id}/result.json.gz"
            else:
                semantic = SemanticMap(
                    **candidate.model_dump(),
                    schema_version="1.0",
                    analysis_id=result_id,
                    project_id=run["project_id"],
                    snapshot_id=ctx.snapshot_id,
                    origin="live",
                    analysis_depth=ctx.analysis_depth,
                    evidence=ctx.evidence,
                    coverage=Coverage(
                        **{
                            "indexed_source_files": sum(f["is_source"] for f in ctx.index["files"]),
                            "eligible_source_files": sum(f["is_source"] for f in snapshot["index"]["files"]),
                            "indexed_units": len(ctx.index["units"]),
                            "inspected_units": sum(u.review_state == "inspected" for u in candidate.units),
                            "unresolved_unit_ids": [
                                u.unit_id for u in candidate.units if u.review_state != "inspected"
                            ],
                            "excluded_paths": [
                                {"path": f["path"], "reason": "outside_current_partition_not_analyzed"}
                                for f in snapshot["index"]["files"]
                                if f["is_source"]
                                and f["path"] not in {u["primary_span"]["path"] for u in ctx.index["units"]}
                            ]
                            if partition
                            else [],
                            "inspected_line_ranges": [e.span.model_dump() for e in ctx.evidence],
                        }
                    ),
                    model_id=self.settings.gemini_model,
                    prompt_version=PROMPT_VERSION,
                    parent_analysis_id=run["body"].get("analysis_id"),
                    integration_chunk_ids=run["body"].get("integration_chunk_ids", []),
                    created_at=datetime.now(UTC).isoformat(),
                ).model_dump(mode="json")
                self.mutate(run_id, attempt, {"status": "compiling"})
                kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
                score = await asyncio.to_thread(
                    run_node, "groove-core", {"map": semantic, "kit_hash": kit["kit_hash"]}
                )
                result = {
                    "map": semantic,
                    "score": score,
                    **(
                        {
                            "partition": {
                                "chunk_id": partition["chunk_id"],
                                "paths": partition["paths"],
                                "whole_repository_complete": False,
                                "integration_chunk_ids": partition.get("integration_chunk_ids", []),
                            }
                        }
                        if partition
                        else {}
                    ),
                }
                collection = "analyses"
                artifact_key = f"projects/{run['project_id']}/analyses/{result_id}/bundle.json.gz"
            await asyncio.to_thread(self.artifacts.put, artifact_key, result)

            def publish(tx):
                current = tx.get("runs", run_id)
                target = tx.get("projects", run["project_id"])
                if (
                    current.get("attempt_id") != attempt
                    or current["cancel_requested"]
                    or current.get("lease_expires_at", 0) <= time.time()
                    or target["status"] in ("deleting", "deleted")
                ):
                    raise GrooveError("CANCELLED", "結果の公開を停止しました。")
                if base and target.get("latest_analysis_id") != base["analysis_id"]:
                    raise GrooveError(
                        "STALE_BASE_ANALYSIS", "解釈が更新されています。選択を更新してください。", 409
                    )
                if (
                    run["body"].get("proposal_id")
                    and target.get("latest_analysis_id") != run["body"]["analysis_id"]
                ):
                    raise GrooveError("STALE_BASE_ANALYSIS", "再解析中に元の解釈が変更されました。", 409)
                tx.put(
                    collection,
                    result_id,
                    {
                        **({"kind": "structure_comparison"} if ctx.comparing else {}),
                        "owner_uid": run["owner_uid"],
                        "project_id": run["project_id"],
                        "artifact_key": artifact_key,
                        "base_analysis_id": base and base["analysis_id"],
                        "snapshot_key": snapshot_key,
                        "snapshot_id": snapshot["snapshot_id"],
                        "run_id": run_id,
                        "created_at": time.time(),
                        "updated_at": time.time(),
                        "expires_at": run["expires_at"],
                        **({"status": "draft"} if ctx.proposing else {}),
                        **({"proposal_id": result_id} if ctx.proposing else {}),
                        **(
                            {
                                "chunk_id": partition["chunk_id"],
                                "chunk_fingerprint": partition["fingerprint"],
                                "prompt_version": PROMPT_VERSION,
                                "model_id": self.settings.gemini_model,
                                "analysis_id": result_id,
                                "inspected_units": result["map"]["coverage"]["inspected_units"],
                                "unresolved_units": len(result["map"]["coverage"]["unresolved_unit_ids"]),
                                "integration_chunk_ids": partition.get("integration_chunk_ids", []),
                                "integration_unit_ids": partition["unit_ids"],
                            }
                            if partition and not base
                            else {}
                        ),
                    },
                )
                if ctx.proposing:
                    tx.put(
                        "projects",
                        run["project_id"],
                        {
                            **target,
                            "latest_proposal_id": result_id,
                            "proposal_run_id": "",
                            "updated_at": time.time(),
                        },
                    )
                elif base:
                    tx.put(
                        "projects",
                        run["project_id"],
                        {
                            **target,
                            (
                                "latest_comparison_id" if ctx.comparing else "latest_investigation_id"
                            ): result_id,
                            "investigation_analysis_id": base["analysis_id"],
                            ("comparison_run_id" if ctx.comparing else "investigation_run_id"): "",
                            "updated_at": time.time(),
                        },
                    )
                if not base:
                    tx.put(
                        "projects",
                        run["project_id"],
                        {
                            **target,
                            "latest_analysis_id": result_id,
                            "status": "partial" if partition else "completed",
                            "updated_at": time.time(),
                            **(
                                {
                                    "snapshot_key": snapshot_key,
                                    "snapshot_id": snapshot["snapshot_id"],
                                    "sha": snapshot["sha"],
                                    "working_copy": True,
                                    "approved_proposal_id": run["body"]["proposal_id"],
                                    "previous_analysis_id": run["body"]["analysis_id"],
                                }
                                if run["body"].get("proposal_id")
                                else {}
                            ),
                        },
                    )
                tx.put(
                    "runs",
                    run_id,
                    {
                        **current,
                        "status": "partial"
                        if not base and (partition or result["map"]["coverage"]["unresolved_unit_ids"])
                        else "completed",
                        "result_id": result_id,
                        "updated_at": time.time(),
                    },
                )

            self.store.atomic(publish)
            emit("run_completed", {"result_id": result_id})
        except GrooveError as exc:
            if exc.code == "LEASE_LOST":
                raise
            self.mutate(
                run_id,
                attempt,
                {
                    "status": "cancelled" if exc.code == "CANCELLED" else "failed",
                    "error": {"code": exc.code, "message": exc.message},
                    "lease_expires_at": 0,
                },
            )
            emit("run_failed", {"code": exc.code})
        except Exception as exc:
            self.mutate(
                run_id,
                attempt,
                {
                    "status": "failed",
                    "error": {"code": "DEPENDENCY_ERROR", "message": "依存サービスでエラーが発生しました。"},
                    "lease_expires_at": 0,
                },
            )
            emit("run_failed", {"code": "DEPENDENCY_ERROR", "error_type": type(exc).__name__})
        finally:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
            current = self.store.get("runs", run_id)
            if current and current["status"] in TERMINAL:
                self.settle_quota(run_id)

    def enqueue_delete(self, project_id: str) -> None:
        if self.settings.store_mode != "gcp":
            return
        client = tasks_v2.CloudTasksClient()
        parent = client.queue_path(
            self.settings.google_cloud_project, self.settings.gcp_region, self.settings.tasks_queue
        )
        task: Any = {
            "name": f"{parent}/tasks/delete-{project_id}",
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{self.settings.worker_url}/internal/tasks/delete",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"project_id": project_id}).encode(),
                "oidc_token": {
                    "service_account_email": self.settings.tasks_invoker_email,
                    "audience": self.settings.worker_url,
                },
            },
            "dispatch_deadline": {"seconds": 600},
        }
        try:
            client.create_task(parent=parent, task=task)
        except AlreadyExists:
            pass
        except Exception as exc:
            raise GrooveError("DELETE_ENQUEUE_PENDING", "削除登録を再試行してください。", 503, True) from exc

    def delete(self, project_id: str) -> None:
        project = self.store.get("projects", project_id)
        if not project or project["status"] == "deleted":
            return
        if project["status"] != "deleting":
            raise GrooveError("INVALID_STATE", "削除が要求されていません。", 409)
        for run in self.store.list("runs", "project_id", project_id):
            if run["status"] not in TERMINAL:
                self.store.update("runs", run["run_id"], {"cancel_requested": True})
                if run.get("lease_expires_at", 0) > time.time():
                    raise GrooveError("DELETE_WAITING", "workerの終了を待っています。", 503, True)
                self.store.update("runs", run["run_id"], {"status": "cancelled"})
            self.settle_quota(run["run_id"])
        self.artifacts.delete_project(project_id)
        self.store.delete_project_children(project_id)
        self.store.update(
            "projects", project_id, {"status": "deleted", "snapshot_key": None, "latest_analysis_id": None}
        )
