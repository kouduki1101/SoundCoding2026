"""Explicit paid import recording; never runs the imported repository's code."""

import argparse
import json
import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

from infra.gcp import PROJECT, ROOT, STATE, cloud
from infra.gcp import api as cloud_api


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    state = json.loads(STATE.read_text(encoding="utf-8"))
    password = cloud("secrets", "versions", "access", "latest", f"--secret={os.environ['CG_REVIEWER_PASSWORD_SECRET']}")
    sign_in = httpx.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": state["firebase"]["apiKey"]},
        json={"email": os.environ["CG_REVIEWER_EMAIL"], "password": password, "returnSecureToken": True},
        timeout=30,
    )
    sign_in.raise_for_status()
    auth = sign_in.json()
    date = datetime.now(UTC).strftime("%Y-%m-%d")
    base = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
    quotas = {}
    for collection, identifier in (("daily_quotas", f"{auth['localId']}_{date}"), ("global_quotas", date)):
        fields = cloud_api("GET", f"{base}/{collection}/{identifier}").get("fields", {})
        quotas[collection] = {
            key: int(value["integerValue"])
            for key, value in fields.items()
            if key
            in (
                "analyses",
                "refreshes",
                "investigations",
                "consumed_input",
                "consumed_output",
                "reserved_input",
                "reserved_output",
            )
        }
    print(json.dumps({"quota_date_utc": date, **quotas}), flush=True)
    if not args.execute:
        return
    payload = json.loads(args.snapshot.read_text(encoding="utf-8"))
    output = ROOT / ".local/tsugiai-recording"
    if (output / "run.json").exists():
        raise RuntimeError(
            "An import has already been recorded. Reuse its run and saved bundle; do not launch another paid import."
        )
    with httpx.Client(
        base_url=state["web_url"] + "/api/v1",
        timeout=60,
        headers={"Authorization": f"Bearer {auth['idToken']}", "Origin": state["web_url"]},
    ) as client:
        config = client.get("/config").json()["data"]
        if config.get("daily_analysis_limit") != 10:
            raise RuntimeError("Wait for the verified 10/day release before recording")
        response = client.post(
            "/projects/import", json=payload, headers={"Idempotency-Key": uuid.uuid4().hex}
        )
        if response.is_error:
            raise RuntimeError(
                f"Import rejected: {response.status_code} {response.json().get('error', {}).get('code')}"
            )
        created = response.json()["data"]
        output.mkdir(parents=True, exist_ok=True)
        (output / "run.json").write_text(json.dumps(created), encoding="utf-8")
        last = ""
        for _ in range(300):
            run = client.get(f"/runs/{created['run_id']}").json()["data"]
            if run["status"] != last:
                print(json.dumps({"status": run["status"], "error": run.get("error")}), flush=True)
                last = run["status"]
            if last in ("completed", "partial", "failed", "cancelled"):
                break
            time.sleep(2)
        if last not in ("completed", "partial"):
            raise RuntimeError(f"Import did not complete: {last}")
        bundle = client.get(f"/projects/{created['project_id']}/bundle").json()["data"]
        bundle["trace"] = client.get(f"/runs/{created['run_id']}/events").json()["data"]
        (output / "bundle.json").write_text(
            json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        report = {
            **created,
            "status": last,
            "model_requests": run["model_requests"],
            "input_tokens": run["input_tokens"],
            "output_tokens": run["output_tokens"],
            "coverage": bundle["map"]["coverage"],
            "recorded_at": datetime.now(UTC).isoformat(),
            "revision": payload["revision"],
            "imported_files": len(payload["sources"]),
        }
        (output / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps({key: value for key, value in report.items() if key != "coverage"}), flush=True)


if __name__ == "__main__":
    main()
