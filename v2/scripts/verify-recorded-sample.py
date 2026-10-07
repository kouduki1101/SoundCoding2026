"""Verify deployed public replay and an owned copy. Never starts a model run."""

import argparse
import json
import os
import uuid
from datetime import UTC, datetime

import httpx

from infra.gcp import PROJECT, ROOT, STATE, cloud
from infra.gcp import api as cloud_api


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default="artifacts/deployed-r12-sample.json")
    args = parser.parse_args()
    state = json.loads(STATE.read_text(encoding="utf-8"))
    expected = json.loads((ROOT / "fixtures/recorded-live/tsugiai-agents.json").read_text(encoding="utf-8"))
    password = cloud("secrets", "versions", "access", "latest", f"--secret={os.environ['CG_REVIEWER_PASSWORD_SECRET']}")
    login = httpx.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": state["firebase"]["apiKey"]},
        json={"email": os.environ["CG_REVIEWER_EMAIL"], "password": password, "returnSecureToken": True},
        timeout=30,
    )
    login.raise_for_status()
    auth = login.json()
    date = datetime.now(UTC).strftime("%Y-%m-%d")
    quota_url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/daily_quotas/{auth['localId']}_{date}"
    before = cloud_api("GET", quota_url)["fields"]
    checks = {}
    with httpx.Client(base_url=state["web_url"] + "/api/v1", timeout=60) as client:
        public_response = client.get("/samples/recorded-tsugiai-agents/bundle")
        public_response.raise_for_status()
        public = public_response.json()["data"]
        checks["anonymous_actual_recording"] = public == expected
        checks["ten_daily_analyses"] = client.get("/config").json()["data"]["daily_analysis_limit"] == 10
        client.headers.update({"Authorization": f"Bearer {auth['idToken']}", "Origin": state["web_url"]})
        response = client.post(
            "/samples/recorded-tsugiai-agents/projects",
            json={},
            headers={"Idempotency-Key": uuid.uuid4().hex},
        )
        response.raise_for_status()
        copied = response.json()["data"]
        bundle = client.get(f"/projects/{copied['project_id']}/bundle").json()["data"]
        repository = client.get(f"/projects/{copied['project_id']}/repository").json()["data"]
        checks["owned_copy_partition_preserved"] = bundle["partition"] == public["partition"]
        checks["owned_copy_sources_trace_provenance_preserved"] = all(
            bundle[key] == public[key] for key in ("sources", "trace", "case_study")
        )
        checks["owned_score_identical_content"] = (
            bundle["score"]["score_hash"] == public["score"]["score_hash"]
            and bundle["score"]["scenes"] == public["score"]["scenes"]
        )
        checks["pending_ranges_remain_pending"] = (
            repository["analyzed_chunks"] == 1
            and repository["pending_units"] == 9
            and repository["cross_partition_review"] == "not_run"
        )
        checks["scope_coverage_honest"] = (
            bundle["map"]["coverage"]["inspected_units"] == 9 and len(bundle["sources"]) == 11
        )
    after = cloud_api("GET", quota_url)["fields"]
    checks["no_quota_or_token_consumption"] = before == after
    report = {
        "status": "PASS" if all(checks.values()) else "FAIL",
        "verified_at": datetime.now(UTC).isoformat(),
        "web_url": state["web_url"],
        "sample_id": "recorded-tsugiai-agents",
        "grammar_version": public["score"]["scenes"][0]["repo"]["grammar_version"],
        "score_hash": public["score"]["score_hash"],
        "checks": checks,
        "saved_project_id": copied["project_id"],
        "new_model_requests": 0,
    }
    (ROOT / args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    if not all(checks.values()):
        raise RuntimeError("Deployed recorded-sample verification failed")


if __name__ == "__main__":
    main()
