"""Verify a completed HITL result; credentials remain in process memory."""

import argparse
import json
import os
import time
import uuid

import httpx

from infra.gcp import ROOT, STATE, cloud


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="Verify identical refresh uses no model")
    parser.add_argument("--proof", default="artifacts/deployed-r4-hitl.json")
    parser.add_argument("--original", default="fixtures/recorded-live/returns-before.json")
    parser.add_argument("--report", default="artifacts/deployed-r4-replay.json")
    args = parser.parse_args()
    proof = json.loads((ROOT / args.proof).read_text(encoding="utf-8"))
    state = json.loads(STATE.read_text())
    password = cloud("secrets", "versions", "access", "latest", f"--secret={os.environ['CG_REVIEWER_PASSWORD_SECRET']}")
    login = httpx.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": state["firebase"]["apiKey"]},
        json={"email": os.environ["CG_REVIEWER_EMAIL"], "password": password, "returnSecureToken": True},
        timeout=30,
    )
    if login.is_error:
        raise RuntimeError(f"Reviewer sign-in failed ({login.status_code})")
    with httpx.Client(
        base_url=state["web_url"] + "/api/v1",
        headers={"Authorization": f"Bearer {login.json()['idToken']}", "Origin": state["web_url"]},
        timeout=30,
    ) as client:

        def api(path, body=None):
            response = (
                client.get(path)
                if body is None
                else client.post(path, json=body, headers={"Idempotency-Key": uuid.uuid4().hex})
            )
            if response.is_error:
                raise RuntimeError(f"Verification request failed ({response.status_code})")
            return response.json()["data"]

        project = proof["project_id"]
        current = api(f"/projects/{project}/bundle")
        base = api(f"/projects/{project}/bundle?analysis={proof['before_analysis_id']}")
        original = json.loads((ROOT / args.original).read_text(encoding="utf-8"))
        checks = {
            "approved_result_current": current["map"]["analysis_id"] == proof["after_analysis_id"],
            "base_source_immutable": base["sources"] == original["sources"],
            "approved_source_distinct": base["sources"] != current["sources"],
            "saved_score_stable": api(f"/projects/{project}/bundle")["score"] == current["score"],
            "accepted_proposal": api(f"/proposals/{proof['proposal_id']}")["status"] == "accepted",
        }
        report = {"checks": checks}
        if args.refresh:
            created = api(f"/projects/{project}/analyses", {})
            for _ in range(30):
                run = api(f"/runs/{created['run_id']}")
                if run["status"] in ("completed", "partial", "failed", "cancelled"):
                    break
                time.sleep(2)
            events = api(f"/runs/{created['run_id']}/events")
            checks["identical_refresh_cached"] = (
                run["status"] == "completed"
                and run["result_id"] == current["map"]["analysis_id"]
                and all(run[k] == 0 for k in ("model_requests", "input_tokens", "output_tokens"))
                and any(e["type"] == "analysis_cache_hit" for e in events)
            )
            report["refresh"] = {
                k: run[k]
                for k in ("run_id", "status", "result_id", "model_requests", "input_tokens", "output_tokens")
            }
        report["status"] = "PASS" if all(checks.values()) else "FAIL"
        (ROOT / args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
        if report["status"] != "PASS":
            raise RuntimeError("Approved replay verification failed")


if __name__ == "__main__":
    main()
