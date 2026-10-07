"""Opt-in paid deployed workflow. Credentials stay in process memory."""

import argparse
import json
import os
import re
import time
import uuid

import httpx
from code_groove.settings import ROOT

from infra.gcp import STATE, cloud


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", default="justified")
    parser.add_argument("--investigate", action="store_true")
    parser.add_argument("--refresh-cache", action="store_true")
    parser.add_argument("--report-prefix", default="deployed")
    args = parser.parse_args()
    prefix = args.report_prefix
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", prefix):
        parser.error("report-prefix must contain 1-40 lowercase letters, digits or hyphens")
    state = json.loads(STATE.read_text())
    password = cloud("secrets", "versions", "access", "latest", f"--secret={os.environ['CG_REVIEWER_PASSWORD_SECRET']}")
    sign_in = httpx.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": state["firebase"]["apiKey"]},
        json={"email": os.environ["CG_REVIEWER_EMAIL"], "password": password, "returnSecureToken": True},
        timeout=30,
    )
    if sign_in.is_error:
        raise RuntimeError(f"Reviewer login failed ({sign_in.status_code})")
    token = sign_in.json()["idToken"]
    client = httpx.Client(
        base_url=state["web_url"] + "/api/v1",
        timeout=60,
        headers={"Authorization": f"Bearer {token}", "Origin": state["web_url"]},
    )

    def api(path, body=None):
        response = (
            client.get(path)
            if body is None
            else client.post(path, json=body, headers={"Idempotency-Key": uuid.uuid4().hex})
        )
        if response.is_error:
            raise RuntimeError(
                f"{path}: {response.status_code} {response.json().get('error', {}).get('code')}"
            )
        return response.json()["data"]

    def wait(run_id):
        last = ""
        for _ in range(300):
            run = api(f"/runs/{run_id}")
            if run["status"] != last:
                print(
                    json.dumps({"run_id": run_id, "status": run["status"], "error": run.get("error")}),
                    flush=True,
                )
                last = run["status"]
            if run["status"] in ("completed", "partial"):
                return run
            if run["status"] in ("failed", "cancelled"):
                raise RuntimeError(f"Run ended: {run.get('error')}")
            time.sleep(2)
        raise RuntimeError("Deployed run did not finish in 10 minutes")

    created = api("/projects", {"source": {"kind": "sample", "sample_id": args.sample}})
    print(json.dumps({"reviewer_login": "PASS", **created}), flush=True)
    completed = wait(created["run_id"])
    bundle = api(f"/projects/{created['project_id']}/bundle")
    events = api(f"/runs/{created['run_id']}/events")
    report = {
        "status": "PASS",
        "sample": args.sample,
        "project_id": created["project_id"],
        "analysis_id": completed["result_id"],
        "duration_seconds": round(completed["updated_at"] - completed["created_at"], 2),
        "model_requests": completed["model_requests"],
        "input_tokens": completed["input_tokens"],
        "output_tokens": completed["output_tokens"],
        "events": len(bundle["map"]["events"]),
        "worker_unauthenticated_status": httpx.get(state["worker_url"] + "/readyz", timeout=30).status_code,
        "web_unauthenticated_status": httpx.get(
            state["web_url"] + "/api/v1/projects", timeout=30
        ).status_code,
    }
    (ROOT / f"artifacts/{prefix}-analysis-trace.json").write_text(
        json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if args.refresh_cache:
        refreshed = api(f"/projects/{created['project_id']}/analyses", {})
        cached = wait(refreshed["run_id"])
        cache_events = api(f"/runs/{refreshed['run_id']}/events")
        cache_kinds = {event["type"] for event in cache_events}
        report["unchanged_refresh"] = {
            "status": "PASS"
            if cached["model_requests"] == 0
            and cached["result_id"] == completed["result_id"]
            and {"index_cache_hit", "analysis_cache_hit"}.issubset(cache_kinds)
            else "FAIL",
            "model_requests": cached["model_requests"],
            "input_tokens": cached["input_tokens"],
            "output_tokens": cached["output_tokens"],
            "index_cache_hit": "index_cache_hit" in cache_kinds,
            "analysis_cache_hit": "analysis_cache_hit" in cache_kinds,
        }
        (ROOT / f"artifacts/{prefix}-refresh-trace.json").write_text(
            json.dumps(cache_events, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if report["unchanged_refresh"]["status"] != "PASS":
            raise RuntimeError("Unchanged refresh did not reuse the index and analysis")
    if args.investigate:
        concern_events = {
            event_id
            for signal in bundle["map"].get("review_signals", [])
            if signal["verdict"] == "concern"
            for event_id in signal["event_ids"]
        }
        selected = next(
            (event for event in bundle["map"]["events"] if event["event_id"] in concern_events),
            bundle["map"]["events"][0],
        )
        investigation = api(
            f"/analyses/{completed['result_id']}/investigations",
            {
                "scene_id": bundle["score"]["scenes"][0]["scene_id"],
                "unit_ids": [selected["unit_id"]],
                "event_ids": [selected["event_id"]],
                "question": "理由のある例外はありますか？関連コードとテストで確かめてください。",
            },
        )
        investigated = wait(investigation["run_id"])
        result = api(f"/investigations/{investigated['result_id']}")
        report["investigation"] = {
            "result_id": investigated["result_id"],
            "model_requests": investigated["model_requests"],
            "findings": len(result["findings"]),
            "fresh_evidence": len(result["evidence"]),
        }
        (ROOT / f"artifacts/{prefix}-investigation-trace.json").write_text(
            json.dumps(api(f"/runs/{investigation['run_id']}/events"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (ROOT / f"artifacts/{prefix}-investigation.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    (ROOT / f"artifacts/{prefix}-smoke.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (ROOT / f".local/{prefix}-bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
