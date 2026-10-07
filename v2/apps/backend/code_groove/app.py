import asyncio
import copy
import hashlib
import json
import re
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import Field
from starlette.middleware.gzip import GZipMiddleware

from code_groove.auth import FirebaseVerifier
from code_groove.errors import GrooveError
from code_groove.http_limits import BodyLimitMiddleware
from code_groove.improvements import apply_edits, source_hash
from code_groove.incremental import INDEX_VERSION
from code_groove.jobs import DAILY_ANALYSIS_LIMIT, JobService
from code_groove.reconciliation import reconciliation_scope
from code_groove.relationships import relationship_data
from code_groove.repository import plan_repository, repository_status, validate_local_sources
from code_groove.schemas import (
    ComparisonInvestigationRequest,
    Contract,
    Evidence,
    Id,
    ImprovementProposal,
    InvestigationCandidate,
    SemanticMap,
)
from code_groove.settings import ROOT, Settings
from code_groove.source import build_index, parse_github_url, resolve_github_pull, run_node, validate_scope
from code_groove.storage import ArtifactStore, MetadataStore, Transaction
from code_groove.structure import structure_data, validate_comparison_request
from code_groove.validation import validate_candidate, validate_investigation

SAMPLES = (
    "cohesive",
    "scattered",
    "mixed",
    "justified",
    "orchestrator",
    "recorded-scattered",
    "recorded-justified",
    "recorded-returns-before",
    "recorded-returns-after",
    "checkout-flow",
    "recorded-checkout-flow",
    "recorded-tsugiai-agents",
)


@lru_cache(maxsize=24)
def studio_score(serialized_map: str, kit_hash: str) -> dict:
    return run_node("groove-core", {"map": json.loads(serialized_map), "kit_hash": kit_hash})


def current_music(bundle: dict) -> dict:
    if not bundle["score"]["scenes"]:
        return bundle
    plan = bundle["score"]["scenes"][0]["repo"]
    if plan["kit_id"] == "midnight-jazz-v4" and plan["grammar_version"] == "groove-chamber-v10":
        return bundle
    kit = json.loads(
        (ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text(encoding="utf-8")
    )
    return {
        **bundle,
        "score": copy.deepcopy(studio_score(json.dumps(bundle["map"], sort_keys=True), kit["kit_hash"])),
    }


class Source(Contract):
    kind: Literal["github_public", "sample"]
    url: str | None = Field(default=None, max_length=300)
    ref: str | None = Field(default=None, max_length=120, pattern=r"^[\w./-]+$")
    scope_path: str | None = Field(default=None, max_length=200)
    sample_id: (
        Literal[
            "cohesive",
            "scattered",
            "mixed",
            "justified",
            "orchestrator",
            "returns-before",
            "returns-after",
            "checkout-flow",
        ]
        | None
    ) = None


class CreateProject(Contract):
    source: Source
    label: str | None = Field(default=None, max_length=80)


class LocalImport(Contract):
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    sources: dict[str, str] = Field(min_length=1, max_length=500)
    label: str = Field(default="Local snapshot", min_length=1, max_length=80)


class ChunkRequest(Contract):
    chunk_id: Id
    retry_partial: bool = False


class IntegrationRequest(Contract):
    chunk_ids: list[Id] = Field(min_length=2, max_length=4)
    unit_ids: list[Id] = Field(min_length=2, max_length=32)


class Selection(Contract):
    scene_id: Id
    unit_ids: list[Id] = Field(default_factory=list, max_length=32)
    event_ids: list[Id] = Field(default_factory=list, max_length=96)
    question: str = Field(min_length=1, max_length=1000)


class TaskBody(Contract):
    run_id: Id | None = None
    project_id: Id | None = None


class ProposalRequest(Contract):
    signal_id: Id


def create_app(settings: Settings | None = None, verifier: Callable[[str], str] | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate_runtime()
    store, artifacts = MetadataStore(settings), ArtifactStore(settings)
    jobs, verify = JobService(settings, store, artifacts), verifier or FirebaseVerifier(settings)
    app = FastAPI(title="Code Groove", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(BodyLimitMiddleware)
    app.state.store, app.state.artifacts, app.state.jobs = store, artifacts, jobs

    @app.exception_handler(GrooveError)
    async def handle_error(_request: Request, exc: GrooveError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": exc.code, "message": exc.message, "retryable": exc.retryable}},
            status_code=exc.status,
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "INVALID_REQUEST", "message": "入力の形式または上限を確認してください。"}},
            status_code=400,
        )

    @app.middleware("http")
    async def protection(request: Request, call_next: Callable) -> Response:
        if settings.app_role == "web" and request.url.path.startswith("/internal/"):
            return JSONResponse(
                {"error": {"code": "NOT_FOUND", "message": "対象が見つかりません。"}}, status_code=404
            )
        length = request.headers.get("content-length", "0")
        limit = 8 * 1024 * 1024 if request.url.path == "/api/v1/projects/import" else 131072
        if not length.isdigit() or int(length) > limit:
            return JSONResponse(
                {"error": {"code": "REQUEST_TOO_LARGE", "message": "入力が大きすぎます。"}}, status_code=413
            )
        if request.method in ("POST", "DELETE", "PATCH") and request.url.path.startswith("/api/"):
            allowed = {settings.public_base_url.rstrip("/")}
            if settings.environment == "local":
                allowed |= {"http://localhost:5173", "http://127.0.0.1:5173", "http://testserver"}
            if request.headers.get("origin") and request.headers["origin"] not in allowed:
                return JSONResponse(
                    {"error": {"code": "ORIGIN_DENIED", "message": "この送信元は許可されていません。"}},
                    status_code=403,
                )
        response = await call_next(request)
        response.headers.update(
            {
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; "
                "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; "
                "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
            }
        )
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def uid(authorization: Annotated[str | None, Header()] = None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise GrooveError("AUTH_REQUIRED", "ログインしてください。", 401)
        user = verify(authorization[7:])
        if not (store.get("accounts", user) or {}).get("enabled"):
            raise GrooveError("ACCOUNT_NOT_ALLOWED", "このアカウントは利用許可されていません。", 403)
        return user

    def own(collection: str, identifier: str, user: str, parent: bool = True) -> dict:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identifier):
            raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)
        value = store.get(collection, identifier)
        if not value or value.get("owner_uid") != user or value.get("status") in ("deleting", "deleted"):
            raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)
        if value.get("expires_at", 0) <= time.time():
            raise GrooveError("EXPIRED", "保存期限（7日）が過ぎています。", 410)
        if parent and collection != "projects":
            own("projects", value["project_id"], user, False)
        return value

    def idem(key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> str:
        if not key or not re.fullmatch(r"[a-zA-Z0-9_-]{8,128}", key):
            raise GrooveError("IDEMPOTENCY_KEY_REQUIRED", "要求の識別キーが必要です。", 400)
        return key

    User = Annotated[str, Depends(uid)]
    Key = Annotated[str, Depends(idem)]

    @app.get("/health")
    @app.get("/healthz")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/readyz")
    def ready() -> dict:
        return {"status": "ready", "role": settings.app_role}

    if settings.app_role == "worker":

        @app.post("/internal/tasks/run")
        async def run_task(body: TaskBody) -> dict:
            if not body.run_id:
                raise GrooveError("INVALID_REQUEST", "run_idが必要です。")
            await jobs.handle(body.run_id)
            return {"status": "ok"}

        @app.post("/internal/tasks/delete")
        def delete_task(body: TaskBody) -> dict:
            if not body.project_id:
                raise GrooveError("INVALID_REQUEST", "project_idが必要です。")
            jobs.delete(body.project_id)
            return {"status": "ok"}

        return app

    @app.get("/api/v1/config")
    def config() -> dict:
        return {
            "data": {
                "live_enabled": settings.enable_live_analysis,
                "local_mock_enabled": settings.environment == "local" and settings.model_mode == "fixture",
                "model_id": settings.gemini_model,
                "daily_analysis_limit": DAILY_ANALYSIS_LIMIT,
                "firebase": {
                    "apiKey": settings.firebase_api_key,
                    "authDomain": settings.firebase_auth_domain,
                    "projectId": settings.google_cloud_project,
                    "appId": settings.firebase_app_id,
                },
            }
        }

    @app.get("/api/v1/samples")
    def samples() -> dict:
        return {
            "data": [
                {"sample_id": name}
                for name in SAMPLES
                if (
                    ROOT
                    / "fixtures"
                    / (
                        f"recorded-live/{name.removeprefix('recorded-')}.json"
                        if name.startswith("recorded-")
                        else f"{name}.json"
                    )
                ).is_file()
            ]
        }

    @app.get("/api/v1/samples/{sample_id}/bundle")
    def sample_bundle(sample_id: str) -> dict:
        if sample_id not in SAMPLES:
            raise GrooveError("NOT_FOUND", "サンプルが見つかりません。", 404)
        file = (
            ROOT
            / "fixtures"
            / (
                f"recorded-live/{sample_id.removeprefix('recorded-')}.json"
                if sample_id.startswith("recorded-")
                else f"{sample_id}.json"
            )
        )
        if not file.is_file():
            raise GrooveError("NOT_FOUND", "保存済みサンプルはまだありません。", 404)
        bundle = json.loads(file.read_text(encoding="utf-8"))
        return {"data": current_music(bundle)}

    @app.get("/api/v1/samples/{sample_id}/repository-reference")
    def sample_repository_reference(sample_id: str) -> dict:
        if sample_id != "recorded-tsugiai-agents":
            raise GrooveError("NOT_FOUND", "このサンプルに全体の参考コードはありません。", 404)
        from code_groove.repository_reference import tsugiai_reference

        return {"data": tsugiai_reference().model_dump()}

    @app.post("/api/v1/projects", status_code=202)
    async def create_project(body: CreateProject, user: User, key: Key) -> dict:
        request = body.model_dump(mode="json")
        if body.source.kind == "github_public":
            if not body.source.url or body.source.sample_id:
                raise GrooveError("INVALID_SOURCE_URL", "公開GitHub URLを指定してください。")
            request["source"]["scope_path"] = validate_scope(body.source.scope_path)
            if "/pull/" in body.source.url:
                if body.source.ref:
                    raise GrooveError("INVALID_SOURCE_URL", "PR URLとrefを同時に指定できません。")
                if not settings.enable_live_analysis or settings.model_mode != "live":
                    raise GrooveError("LIVE_DISABLED", "実解析は現在停止しています。保存結果は再生できます。", 503)
                pull = await resolve_github_pull(body.source.url)
                request["source"]["url"] = pull["head_repository_url"]
                request["source"]["ref"] = pull["head_sha"]
                request["pull_request"] = {
                    **pull,
                    "url": f"{pull['repository_url']}/pull/{pull['pull_number']}",
                }
            else:
                parse_github_url(body.source.url)
        elif not body.source.sample_id or body.source.url or body.source.ref or body.source.scope_path:
            raise GrooveError("INVALID_SOURCE", "内蔵サンプルを指定してください。")
        return {"data": await asyncio.to_thread(jobs.create, user, request, key)}

    @app.get("/api/v1/samples/{sample_id}/structure")
    def sample_structure(
        sample_id: str, unit_a: Id | None = None, unit_b: Id | None = None, markers: bool = False
    ) -> dict:
        bundle = sample_bundle(sample_id)["data"]
        snapshot = {"snapshot_id": bundle["map"]["snapshot_id"], "sources": bundle["sources"]}
        return {"data": structure_data(snapshot, unit_a, unit_b, markers)}

    @app.get("/api/v1/samples/{sample_id}/relationships")
    def sample_relationships(sample_id: str, unit_id: Id) -> dict:
        bundle = sample_bundle(sample_id)["data"]
        snapshot = {"snapshot_id": bundle["map"]["snapshot_id"], "sources": bundle["sources"]}
        return {"data": relationship_data(snapshot, bundle["map"], unit_id)}

    def comparison_demo_snapshot():
        content = (ROOT / "fixtures/structure-comparison/examples.ts").read_text(encoding="utf-8")
        sources = {"examples.ts": content}
        return {"snapshot_id": "snap_structure_demo_v1", "sources": sources}

    @app.get("/api/v1/comparison-demo/structure")
    def comparison_demo(unit_a: Id | None = None, unit_b: Id | None = None, markers: bool = False) -> dict:
        snapshot = comparison_demo_snapshot()
        return {"data": {**structure_data(snapshot, unit_a, unit_b, markers), "sources": snapshot["sources"]}}

    @app.post("/api/v1/samples/{sample_id}/comparison-investigations/mock")
    def mock_comparison(sample_id: str, body: ComparisonInvestigationRequest) -> dict:
        if settings.environment != "local" or settings.model_mode != "fixture":
            raise GrooveError("NOT_FOUND", "ローカルのモック教材でのみ利用できます。", 404)
        # Exercise the real bounded read/submit tools; no model, job or paid quota is used.
        from code_groove.agent_tools import AgentContext, execute_tool
        from code_groove.schemas import ComparisonInvestigationResult

        if sample_id == "structure-demo":
            snapshot = comparison_demo_snapshot()
            base = {"analysis_id": "mock_initial_structure", "origin": "fixture"}
        else:
            bundle = sample_bundle(sample_id)["data"]
            base = bundle["map"]
            snapshot = {"snapshot_id": base["snapshot_id"], "sources": bundle["sources"]}
        validate_comparison_request(snapshot, body)
        index = build_index(snapshot["snapshot_id"], snapshot["sources"], repository=True)
        ctx = AgentContext(
            settings,
            "p_comparison_mock",
            snapshot["snapshot_id"],
            snapshot["sources"],
            index,
            lambda *_: None,
            lambda: None,
            lambda _: None,
            base=base,
            selection={"comparison": body.model_dump(mode="json")},
        )
        for identifier in (body.unit_a, body.unit_b):
            unit = next(u for u in index["units"] if u["unit_id"] == identifier)
            execute_tool(
                ctx,
                "read_code",
                {
                    **{k: unit["primary_span"][k] for k in ("file_id", "start_line", "end_line")},
                    "purpose": "モック経路で選択した関数本体を静的に読み直す",
                },
                f"mock_read_{identifier}",
            )
        candidate = execute_tool(
            ctx,
            "submit_investigation",
            {
                "candidate": {
                    "interpretation": "inconclusive",
                    "summary": "モック回答：両関数を読み直しました。構文上の違いだけでは目的に適合するか決められません。",
                    "reason": "期待・観察・疑問を受け取る経路の技術検証です。実モデルによる判断ではありません。",
                    "counter_explanation": "製品契約が異なれば意図した差の可能性があります。",
                    "unknowns": ["仕様、実行動作、実モデルの説明の妥当性は未確認"],
                    "evidence_ids": [e.evidence_id for e in ctx.evidence],
                }
            },
            "mock_submit",
        )
        result = ComparisonInvestigationResult(
            **candidate.model_dump(),
            investigation_id=f"mock_{uuid.uuid4().hex}",
            base_analysis_id=base["analysis_id"],
            origin="fixture",
            request=body,
            evidence=ctx.evidence,
            model_id="mock-no-model",
        )
        return {"data": result.model_dump(mode="json")}

    @app.post("/api/v1/projects/import", status_code=202)
    def import_project(body: LocalImport, user: User, key: Key) -> dict:
        sources = validate_local_sources(body.sources)
        source = {
            "kind": "local_snapshot",
            "revision": body.revision,
            "label": body.label,
            "source_hash": source_hash(sources),
            "provenance": "user_supplied_committed_snapshot",
        }
        return {"data": jobs.create(user, {"source": source}, key, local_sources=sources)}

    @app.post("/api/v1/samples/{sample_id}/projects", status_code=201)
    def adopt_recorded_sample(sample_id: str, user: User, key: Key) -> dict:
        if sample_id not in ("recorded-returns-before", "recorded-checkout-flow", "recorded-tsugiai-agents"):
            raise GrooveError("INVALID_SOURCE", "保存済み実解析を選択してください。")
        idem_id = hashlib.sha256(f"{user}:adopt:{sample_id}:{key}".encode()).hexdigest()
        previous = store.get("idempotency", idem_id)
        if previous and previous["expires_at"] > time.time():
            project = own("projects", previous["project_id"], user)
            return {
                "data": {"project_id": project["project_id"], "analysis_id": project["latest_analysis_id"]}
            }
        if (
            len(
                [
                    p
                    for p in store.list("projects", "owner_uid", user)
                    if p["expires_at"] > time.time() and p["status"] != "deleted"
                ]
            )
            >= 20
        ):
            raise GrooveError("PROJECT_LIMIT", "保存数の上限です。不要な作業を削除してください。", 429)
        bundle = sample_bundle(sample_id)["data"]
        project_id, analysis_id = f"p_{uuid.uuid4().hex}", f"analysis_{uuid.uuid4().hex}"
        bundle["map"].update(project_id=project_id, analysis_id=analysis_id)
        bundle["score"]["analysis_id"] = analysis_id
        snapshot_id = bundle["map"]["snapshot_id"]
        snapshot_key = f"projects/{project_id}/snapshots/{snapshot_id}/snapshot.json.gz"
        artifact_key = f"projects/{project_id}/analyses/{analysis_id}/bundle.json.gz"
        snapshot = {
            "snapshot_id": snapshot_id,
            "sources": bundle["sources"],
            "sha": source_hash(bundle["sources"]),
            "index_version": INDEX_VERSION,
            "index": build_index(snapshot_id, bundle["sources"], repository=bool(bundle.get("partition"))),
        }
        chunk_metadata = {}
        if bundle.get("partition"):
            snapshot["repository_plan"] = plan_repository(snapshot["index"], snapshot["sources"])
            chunk = next(
                c
                for c in snapshot["repository_plan"]["chunks"]
                if c["chunk_id"] == bundle["partition"]["chunk_id"]
            )
            chunk_metadata = {
                "chunk_id": chunk["chunk_id"],
                "chunk_fingerprint": chunk["fingerprint"],
                "model_id": bundle["map"]["model_id"],
                "prompt_version": bundle["map"]["prompt_version"],
                "inspected_units": bundle["map"]["coverage"]["inspected_units"],
                "unresolved_units": len(bundle["map"]["coverage"]["unresolved_unit_ids"]),
            }
        artifacts.put(snapshot_key, snapshot)
        artifacts.put(
            artifact_key,
            {
                "map": bundle["map"],
                "score": bundle["score"],
                "trace": bundle.get("trace", []),
                **({"case_study": bundle["case_study"]} if bundle.get("case_study") else {}),
                **({"partition": bundle["partition"]} if bundle.get("partition") else {}),
            },
        )
        now = time.time()
        common = {
            "owner_uid": user,
            "project_id": project_id,
            "snapshot_key": snapshot_key,
            "snapshot_id": snapshot_id,
            "created_at": now,
            "updated_at": now,
            "expires_at": now + 7 * 86400,
        }

        def publish_copy(tx):
            existing = tx.get("idempotency", idem_id)
            if existing and existing["expires_at"] > now:
                return existing["project_id"], existing["analysis_id"]
            tx.put(
                "projects",
                project_id,
                {
                    **common,
                    "status": "partial" if chunk_metadata else "completed",
                    "source": (
                        {
                            "kind": "local_snapshot",
                            "label": bundle["case_study"]["title"],
                            "revision": bundle["case_study"]["revision"],
                            "source_hash": snapshot["sha"],
                            "provenance": "recorded_committed_scope",
                        }
                        if bundle.get("case_study")
                        else {"kind": "sample", "sample_id": sample_id.removeprefix("recorded-")}
                    ),
                    "latest_analysis_id": analysis_id,
                    "run_id": "",
                    "working_copy": True,
                    "sha": snapshot["sha"],
                },
            )
            tx.put(
                "analyses",
                analysis_id,
                {**common, "analysis_id": analysis_id, "artifact_key": artifact_key, **chunk_metadata},
            )
            tx.put("idempotency", idem_id, {**common, "analysis_id": analysis_id, "expires_at": now + 86400})
            return project_id, analysis_id

        project_id, analysis_id = store.atomic(publish_copy)
        return {"data": {"project_id": project_id, "analysis_id": analysis_id}}

    @app.get("/api/v1/account/activity")
    def account_activity(user: User) -> dict:
        account = store.get("accounts", user) or {}
        run = store.get("runs", account["active_run_id"]) if account.get("active_run_id") else None
        if (
            not run
            or run.get("owner_uid") != user
            or run["status"] in ("completed", "partial", "failed", "cancelled")
            or run["expires_at"] <= time.time()
        ):
            return {"data": None}
        project = store.get("projects", run["project_id"])
        if (
            not project
            or project.get("owner_uid") != user
            or project["expires_at"] <= time.time()
            or project["status"] in ("deleting", "deleted")
        ):
            return {"data": None}
        return {"data": {key: run[key] for key in ("run_id", "project_id", "kind", "status")}}

    @app.get("/api/v1/projects")
    def list_projects(user: User) -> dict:
        return {
            "data": [
                {k: v for k, v in item.items() if k not in ("owner_uid", "snapshot_key")}
                for item in sorted(
                    store.list("projects", "owner_uid", user), key=lambda p: p["created_at"], reverse=True
                )
                if item["expires_at"] > time.time() and item["status"] not in ("deleting", "deleted")
            ]
        }

    @app.get("/api/v1/projects/{project_id}")
    def get_project(project_id: str, user: User) -> dict:
        return {
            "data": {
                k: v
                for k, v in own("projects", project_id, user).items()
                if k not in ("owner_uid", "snapshot_key")
            }
        }

    def snapshot_for(project: dict) -> dict:
        if not project.get("snapshot_key"):
            raise GrooveError("NOT_READY", "スナップショットを準備しています。", 409)
        return artifacts.get(project["snapshot_key"])

    @app.get("/api/v1/projects/{project_id}/repository")
    def get_repository(project_id: str, user: User) -> dict:
        snapshot = snapshot_for(own("projects", project_id, user))
        if not snapshot.get("repository_plan"):
            return {"data": None}
        analyses = [
            a
            for a in store.list("analyses", "project_id", project_id)
            if a["owner_uid"] == user and a["expires_at"] > time.time()
        ]
        return {"data": repository_status(snapshot, analyses, settings.gemini_model)}

    @app.post("/api/v1/projects/{project_id}/chunks", status_code=202)
    def analyze_chunk(project_id: str, body: ChunkRequest, user: User, key: Key) -> dict:
        project = own("projects", project_id, user)
        snapshot = snapshot_for(project)
        if not any(
            c["chunk_id"] == body.chunk_id for c in snapshot.get("repository_plan", {}).get("chunks", [])
        ):
            raise GrooveError("INVALID_SELECTION", "存在する検査範囲を選んでください。")
        if body.retry_partial:
            analyses = [
                a
                for a in store.list("analyses", "project_id", project_id)
                if a["owner_uid"] == user and a["expires_at"] > time.time()
            ]
            status = repository_status(snapshot, analyses, settings.gemini_model)
            selected = next(c for c in status["chunks"] if c["chunk_id"] == body.chunk_id)
            if selected["status"] != "partial":
                raise GrooveError("INVALID_SELECTION", "未解決のある保存範囲を選んでください。")
        return {
            "data": jobs.create(
                user,
                {
                    "source": project["source"],
                    "chunk_id": body.chunk_id,
                    "refresh": True,
                    "retry_partial": body.retry_partial,
                },
                key,
                project=project,
            )
        }

    @app.post("/api/v1/projects/{project_id}/integrations", status_code=202)
    def integrate_partitions(project_id: str, body: IntegrationRequest, user: User, key: Key) -> dict:
        project = own("projects", project_id, user)
        snapshot = snapshot_for(project)
        reconciliation_scope(snapshot, body.chunk_ids, body.unit_ids)
        saved = {
            a.get("chunk_id")
            for a in store.list("analyses", "project_id", project_id)
            if a["owner_uid"] == user
            and a["expires_at"] > time.time()
            and a.get("snapshot_id") == snapshot["snapshot_id"]
        }
        if not set(body.chunk_ids) <= saved:
            raise GrooveError(
                "INVALID_SELECTION", "同じスナップショットの保存結果がある範囲を選んでください。"
            )
        return {
            "data": jobs.create(
                user,
                {
                    "source": project["source"],
                    "refresh": True,
                    "integration_chunk_ids": body.chunk_ids,
                    "integration_unit_ids": body.unit_ids,
                },
                key,
                project=project,
            )
        }

    @app.get("/api/v1/projects/{project_id}/files")
    def get_files(project_id: str, user: User) -> dict:
        return {"data": snapshot_for(own("projects", project_id, user))["index"]}

    @app.get("/api/v1/projects/{project_id}/source")
    def get_source(
        project_id: str, file_id: Id, user: User, start: int = Query(1, ge=1), end: int = Query(200, ge=1)
    ) -> dict:
        snapshot = snapshot_for(own("projects", project_id, user))
        file = next((f for f in snapshot["index"]["files"] if f["file_id"] == file_id), None)
        if not file or end < start or end - start >= 200:
            raise GrooveError("INVALID_SELECTION", "最大200行の範囲を指定してください。")
        return {
            "data": {
                "file_id": file_id,
                "path": file["path"],
                "start": start,
                "source": "\n".join(snapshot["sources"][file["path"]].splitlines()[start - 1 : end]),
            }
        }

    @app.post("/api/v1/projects/{project_id}/analyses", status_code=202)
    def reanalyze(project_id: str, user: User, key: Key) -> dict:
        project = own("projects", project_id, user)
        return {
            "data": jobs.create(user, {"source": project["source"], "refresh": True}, key, project=project)
        }

    def bundle_for(analysis_id: str, user: str) -> dict:
        return current_music(artifacts.get(own("analyses", analysis_id, user)["artifact_key"]))

    @app.get("/api/v1/projects/{project_id}/bundle")
    def project_bundle(project_id: str, user: User, analysis: str | None = None) -> dict:
        project = own("projects", project_id, user)
        identifier = analysis or project.get("latest_analysis_id")
        if not identifier:
            raise GrooveError("NOT_READY", "実解析が完了していません。", 409)
        meta = own("analyses", identifier, user)
        if meta["project_id"] != project_id:
            raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)
        snapshot = artifacts.get(meta["snapshot_key"]) if meta.get("snapshot_key") else snapshot_for(project)
        bundle = artifacts.get(meta["artifact_key"])
        bundle = current_music(bundle)
        trace = bundle.get("trace", [])
        if meta.get("run_id"):
            source_run = own("runs", meta["run_id"], user)
            if source_run["project_id"] == project_id:
                trace = [
                    {k: e[k] for k in ("seq", "type", "timestamp", "payload")}
                    for e in sorted(
                        store.list("run_events", "run_id", meta["run_id"]), key=lambda e: e["seq"]
                    )[:200]
                ]
        return {
            "data": {
                **bundle,
                "sources": snapshot["sources"],
                "trace": trace,
                **(
                    {
                        "repository": repository_status(
                            snapshot,
                            [
                                a
                                for a in store.list("analyses", "project_id", project_id)
                                if a["expires_at"] > time.time()
                            ],
                            settings.gemini_model,
                        )
                    }
                    if snapshot.get("repository_plan")
                    else {}
                ),
            }
        }

    @app.get("/api/v1/analyses/{analysis_id}")
    def get_analysis(analysis_id: str, user: User) -> dict:
        return {"data": bundle_for(analysis_id, user)["map"]}

    @app.get("/api/v1/analyses/{analysis_id}/score")
    def get_score(analysis_id: str, user: User) -> dict:
        return {"data": bundle_for(analysis_id, user)["score"]}

    @app.post("/api/v1/analyses/{analysis_id}/investigations", status_code=202)
    def investigate(analysis_id: str, body: Selection, user: User, key: Key) -> dict:
        meta = own("analyses", analysis_id, user)
        project = own("projects", meta["project_id"], user)
        bundle = artifacts.get(meta["artifact_key"])
        scene = next((s for s in bundle["score"]["scenes"] if s["scene_id"] == body.scene_id), None)
        selected_events = {e["event_id"]: e for e in bundle["map"]["events"]}
        if (
            not scene
            or not (body.unit_ids or body.event_ids)
            or not set(body.unit_ids) <= set(scene["unit_ids"])
            or any(
                e not in selected_events or selected_events[e]["unit_id"] not in scene["unit_ids"]
                for e in body.event_ids
            )
        ):
            raise GrooveError("INVALID_SELECTION", "現在のシーン内の小節か意味イベントを選択してください。")
        if project.get("latest_analysis_id") != analysis_id:
            raise GrooveError("STALE_BASE_ANALYSIS", "最新の解釈を選択してください。", 409)
        return {
            "data": jobs.create(
                user, {**body.model_dump(), "analysis_id": analysis_id}, key, "investigation", project
            )
        }

    @app.get("/api/v1/investigations/{investigation_id}")
    def get_investigation(investigation_id: str, user: User) -> dict:
        return {"data": artifacts.get(own("investigations", investigation_id, user)["artifact_key"])}

    @app.get("/api/v1/analyses/{analysis_id}/structure")
    def analysis_structure(
        analysis_id: str,
        user: User,
        unit_a: Id | None = None,
        unit_b: Id | None = None,
        markers: bool = False,
    ) -> dict:
        meta = own("analyses", analysis_id, user)
        snapshot = artifacts.get(meta["snapshot_key"])
        return {"data": structure_data(snapshot, unit_a, unit_b, markers)}

    @app.get("/api/v1/analyses/{analysis_id}/relationships")
    def analysis_relationships(analysis_id: str, unit_id: Id, user: User) -> dict:
        meta = own("analyses", analysis_id, user)
        snapshot = artifacts.get(meta["snapshot_key"])
        semantic = artifacts.get(meta["artifact_key"])["map"]
        return {"data": relationship_data(snapshot, semantic, unit_id)}

    @app.post("/api/v1/analyses/{analysis_id}/comparison-investigations", status_code=202)
    def compare_investigation(
        analysis_id: str, body: ComparisonInvestigationRequest, user: User, key: Key
    ) -> dict:
        meta = own("analyses", analysis_id, user)
        project = own("projects", meta["project_id"], user)
        snapshot = artifacts.get(meta["snapshot_key"])
        validate_comparison_request(snapshot, body)
        return {
            "data": jobs.create(
                user,
                {
                    "analysis_id": analysis_id,
                    "comparison": body.model_dump(mode="json"),
                    "unit_ids": [body.unit_a, body.unit_b],
                    "event_ids": [],
                },
                key,
                "investigation",
                project,
            )
        }

    @app.post("/api/v1/analyses/{analysis_id}/proposals", status_code=202)
    def propose_improvement(analysis_id: str, body: ProposalRequest, user: User, key: Key) -> dict:
        analysis = own("analyses", analysis_id, user)
        project = own("projects", analysis["project_id"], user)
        base = artifacts.get(analysis["artifact_key"])["map"]
        if base.get("analysis_depth", "focused") != "focused":
            raise GrooveError(
                "FOCUSED_REVIEW_REQUIRED", "選択区間を追加調査し、結果を確認してください。", 409
            )
        signal = next(
            (
                s
                for s in base.get("review_signals", [])
                if s["signal_id"] == body.signal_id
                and s["verdict"] == "concern"
                and s.get("review_axis", "coherence") == "coherence"
                and not s.get("human_review_required")
            ),
            None,
        )
        if not signal:
            raise GrooveError("INVALID_SELECTION", "根拠のある懸念を選択してください。")
        return {
            "data": jobs.create(
                user,
                {
                    "analysis_id": analysis_id,
                    "signal_id": body.signal_id,
                    "unit_ids": signal["unit_ids"],
                    "event_ids": signal["event_ids"],
                },
                key,
                "proposal",
                project,
            )
        }

    @app.get("/api/v1/proposals/{proposal_id}")
    def get_proposal(proposal_id: str, user: User) -> dict:
        meta = own("proposals", proposal_id, user)
        return {"data": {**artifacts.get(meta["artifact_key"]), "status": meta.get("status", "draft")}}

    @app.post("/api/v1/proposals/{proposal_id}/accept", status_code=202)
    def accept_proposal(proposal_id: str, user: User, key: Key) -> dict:
        meta = own("proposals", proposal_id, user)
        project = own("projects", meta["project_id"], user)
        proposal = ImprovementProposal.model_validate(artifacts.get(meta["artifact_key"]))
        analysis = own("analyses", proposal.base_analysis_id, user)
        snapshot = artifacts.get(analysis["snapshot_key"])
        if (
            source_hash(snapshot["sources"]) != proposal.source_hash
            or snapshot["snapshot_id"] != proposal.base_snapshot_id
        ):
            raise GrooveError("STALE_BASE_ANALYSIS", "変更元スナップショットが一致しません。", 409)
        sources = apply_edits(proposal, snapshot["sources"], proposal.evidence)
        artifact_key = f"projects/{project['project_id']}/proposals/{proposal_id}/accepted-sources.json.gz"
        artifacts.put(artifact_key, {"sources": sources})
        return {
            "data": jobs.create(
                user,
                {
                    "analysis_id": proposal.base_analysis_id,
                    "proposal_id": proposal_id,
                    "derived_sources_key": artifact_key,
                    "refresh": True,
                },
                key,
                "analysis",
                project,
            )
        }

    @app.post("/api/v1/proposals/{proposal_id}/reject")
    def reject_proposal(proposal_id: str, user: User) -> dict:
        own("proposals", proposal_id, user)

        def reject(tx):
            meta = tx.get("proposals", proposal_id)
            project = tx.get("projects", meta["project_id"])
            if meta.get("status", "draft") == "accepted":
                raise GrooveError("INVALID_STATE", "採用した改善案は却下できません。", 409)
            if not project or project["status"] in ("deleting", "deleted"):
                raise GrooveError("NOT_FOUND", "projectを利用できません。", 404)
            tx.put("proposals", proposal_id, {**meta, "status": "rejected", "updated_at": time.time()})

        store.atomic(reject)
        return {"data": {"status": "rejected"}}

    @app.post("/api/v1/investigations/{investigation_id}/publish-interpretation")
    def publish(investigation_id: str, user: User) -> dict:
        meta = own("investigations", investigation_id, user)
        if meta.get("kind") == "structure_comparison":
            raise GrooveError(
                "INVALID_STATE", "構造比較の回答は人の記録に関連付けます。意味譜面の更新ではありません。"
            )
        result = artifacts.get(meta["artifact_key"])
        project = own("projects", meta["project_id"], user)
        previous = result["base_analysis_id"]
        base_meta = own("analyses", previous, user)
        if project.get("latest_analysis_id") != previous:
            raise GrooveError("STALE_BASE_ANALYSIS", "解釈が更新されています。", 409)
        if (
            not result["suggested_reclassification"]
            and not result.get("review_signals")
            and not result.get("replaced_signal_ids")
            and not result.get("design_patterns")
        ):
            raise GrooveError("NO_RECLASSIFICATION", "反映する解釈の更新がありません。", 409)
        semantic = copy.deepcopy(bundle_for(previous, user)["map"])
        candidate = InvestigationCandidate.model_validate(
            {k: result[k] for k in InvestigationCandidate.model_fields if k in result}
        )
        repository_index = artifacts.get(base_meta["snapshot_key"])["index"]
        validate_investigation(
            candidate, [Evidence(**e) for e in result["evidence"]], semantic, repository_index
        )
        patterns = {p["pattern_id"]: p for p in semantic.get("design_patterns", [])}
        patterns.update({p["pattern_id"]: p for p in result.get("design_patterns", [])})
        semantic["design_patterns"] = list(patterns.values())
        updates = {s["signal_id"]: s for s in result.get("review_signals", [])}
        semantic["review_signals"] = [
            s
            for s in semantic.get("review_signals", [])
            if s["signal_id"] not in updates and s["signal_id"] not in result.get("replaced_signal_ids", [])
        ] + list(updates.values())
        semantic["responsibilities"].extend(result["new_responsibilities"])
        semantic["evidence"].extend(result["evidence"])
        by_id = {e["event_id"]: e for e in semantic["events"]}
        for change in result["suggested_reclassification"]:
            event = by_id.get(change["event_id"])
            if not event or event["responsibility_id"] != change["from_responsibility_id"]:
                raise GrooveError("INVALID_ANALYSIS", "再分類元が一致しません。")
            event["responsibility_id"] = change["to_responsibility_id"]
            event["evidence_ids"] = list(dict.fromkeys(event["evidence_ids"] + change["evidence_ids"]))
        orders: dict[str, int] = {}
        for event in sorted(semantic["events"], key=lambda e: (e["semantic_order"], e["event_id"])):
            rid = event["responsibility_id"]
            event["semantic_order"] = orders.get(rid, 0)
            orders[rid] = event["semantic_order"] + 1
        identifier = f"analysis_{uuid.uuid4().hex}"
        semantic.update(
            analysis_id=identifier,
            parent_analysis_id=previous,
            analysis_depth="focused",
            created_at=datetime.now(UTC).isoformat(),
        )
        model = SemanticMap.model_validate(semantic)
        validate_candidate(
            model,
            repository_index,
            [Evidence(**e) for e in semantic["evidence"]],
        )
        kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
        score = run_node("groove-core", {"map": semantic, "kit_hash": kit["kit_hash"]})
        artifact_key = f"projects/{project['project_id']}/analyses/{identifier}/bundle.json.gz"
        artifacts.put(
            artifact_key,
            {
                "map": semantic,
                "score": score,
                **(
                    {"partition": bundle_for(previous, user)["partition"]}
                    if base_meta.get("chunk_id")
                    else {}
                ),
            },
        )

        def operation(tx: Transaction) -> None:
            current = tx.get("projects", project["project_id"])
            if current["status"] in ("deleting", "deleted") or current.get("latest_analysis_id") != previous:
                raise GrooveError("STALE_BASE_ANALYSIS", "解釈が更新されています。", 409)
            tx.put(
                "analyses",
                identifier,
                {
                    **meta,
                    "artifact_key": artifact_key,
                    "base_analysis_id": previous,
                    "created_at": time.time(),
                    "updated_at": time.time(),
                    **(
                        {
                            "analysis_id": identifier,
                            **{
                                k: base_meta[k]
                                for k in ("integration_chunk_ids", "integration_unit_ids")
                                if k in base_meta
                            },
                            **{
                                k: base_meta[k]
                                for k in (
                                    "chunk_id",
                                    "chunk_fingerprint",
                                    "prompt_version",
                                    "model_id",
                                    "inspected_units",
                                    "unresolved_units",
                                )
                            },
                        }
                        if base_meta.get("chunk_id")
                        else {}
                    ),
                },
            )
            tx.put(
                "projects",
                project["project_id"],
                {**current, "latest_analysis_id": identifier, "updated_at": time.time()},
            )

        store.atomic(operation)
        return {"data": {"analysis_id": identifier}}

    @app.get("/api/v1/runs/{run_id}")
    def get_run(run_id: str, user: User) -> dict:
        return {
            "data": {
                k: v
                for k, v in own("runs", run_id, user).items()
                if k not in ("owner_uid", "body", "attempt_id", "quota_id", "quota_date")
            }
        }

    @app.get("/api/v1/runs/{run_id}/events")
    def events(
        run_id: str, user: User, after_seq: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)
    ) -> dict:
        run = own("runs", run_id, user)
        values = store.events_after(run_id, after_seq, limit, run.get("seq", 0))
        return {
            "data": [
                {k: e[k] for k in ("seq", "type", "timestamp", "payload")}
                for e in values
                if e["seq"] > after_seq
            ][:limit]
        }

    @app.post("/api/v1/runs/{run_id}/cancel")
    def cancel(run_id: str, user: User) -> dict:
        own("runs", run_id, user)
        return {"data": {"run_id": run_id, "cancel_requested": jobs.cancel(run_id)}}

    @app.post("/api/v1/projects/{project_id}/retry-enqueue", status_code=202)
    def retry_enqueue(project_id: str, user: User) -> dict:
        project = own("projects", project_id, user)
        run = own("runs", project["run_id"], user)
        jobs.enqueue(run)
        return {"data": {"project_id": project_id, "run_id": run["run_id"]}}

    @app.delete("/api/v1/projects/{project_id}", status_code=202)
    def delete_project(project_id: str, user: User) -> dict:
        project = store.get("projects", project_id)
        if project and project.get("owner_uid") == user and project["status"] == "deleting":
            jobs.enqueue_delete(project_id)
        else:
            own("projects", project_id, user)
            store.update("projects", project_id, {"status": "deleting"})
            jobs.enqueue_delete(project_id)
        return {"data": {"project_id": project_id, "status": "deleting"}}

    @app.get("/{path:path}", include_in_schema=False)
    def static(path: str) -> FileResponse:
        if path.startswith(("api/", "internal/")):
            raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)
        root = (ROOT / "dist/web").resolve()
        candidate = (root / path).resolve()
        if not candidate.is_relative_to(root):
            raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)
        if candidate.is_file():
            return FileResponse(candidate)
        if (root / "index.html").is_file() and (
            not path or re.fullmatch(r"projects/[a-zA-Z0-9_-]{1,80}/(arrange|inspect)", path)
        ):
            return FileResponse(root / "index.html")
        raise GrooveError("NOT_FOUND", "対象が見つかりません。", 404)

    return app


app = create_app()
