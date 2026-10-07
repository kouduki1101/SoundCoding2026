"""Read-only deployment checks; reviewer credentials never leave process memory or auth service."""

import hashlib
import json
import os

import httpx

from infra.gcp import PROJECT, ROOT, STATE, cloud


def main():
    state = json.loads(STATE.read_text())
    checks = {}
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        checks["private_worker"] = client.get(state["worker_url"] + "/health").status_code == 403
        checks["protected_api"] = client.get(state["web_url"] + "/api/v1/projects").status_code == 401
        checks["activity_requires_auth"] = (
            client.get(state["web_url"] + "/api/v1/account/activity").status_code == 401
        )
        kit_url = state["web_url"] + "/audio/midnight-jazz-v4/"
        kit = client.get(kit_url + "manifest.json").json()
        expected = json.loads(
            (ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text(encoding="utf-8")
        )
        checks["pinned_recorded_kit"] = kit == expected
        sample = next(s for s in kit["samples"] if s["voice"] == "bass")
        checks["recorded_asset_hash"] = (
            hashlib.sha256(client.get(kit_url + sample["file"]).content).hexdigest() == sample["sha256"]
        )
        checks["sample_attribution"] = "CC BY 3.0" in client.get(kit_url + "NOTICE.txt").text
        homepage = client.get(state["web_url"])
        checks["security_headers"] = (
            homepage.status_code == 200
            and "default-src 'self'" in homepage.headers.get("content-security-policy", "")
            and homepage.headers.get("x-content-type-options") == "nosniff"
            and "max-age=" in homepage.headers.get("strict-transport-security", "")
        )
        checks["private_artifacts"] = (
            client.get(f"https://storage.googleapis.com/{PROJECT}-cg-artifacts/").status_code == 403
        )
        password = cloud("secrets", "versions", "access", "latest", f"--secret={os.environ['CG_REVIEWER_PASSWORD_SECRET']}")
        sign_in = client.post(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
            params={"key": state["firebase"]["apiKey"]},
            json={"email": os.environ["CG_REVIEWER_EMAIL"], "password": password, "returnSecureToken": True},
        )
        if sign_in.is_error:
            raise RuntimeError(f"Reviewer sign-in failed ({sign_in.status_code})")
        token = sign_in.json()["idToken"]
        firestore = (
            f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/accounts"
        )
        checks["direct_firestore_anonymous_denied"] = client.get(firestore).status_code == 403
        checks["direct_firestore_reviewer_denied"] = (
            client.get(firestore, headers={"Authorization": f"Bearer {token}"}).status_code == 403
        )
        projects = client.get(
            state["web_url"] + "/api/v1/projects", headers={"Authorization": f"Bearer {token}"}
        )
        checks["reviewer_authorized_api"] = projects.status_code == 200
        activity = client.get(
            state["web_url"] + "/api/v1/account/activity",
            headers={"Authorization": f"Bearer {token}"},
        )
        checks["activity_owned_lookup"] = activity.status_code == 200 and (
            activity.json()["data"] is None
            or set(activity.json()["data"]) == {"run_id", "project_id", "kind", "status"}
        )
        checks["unknown_owner_resource_hidden"] = (
            client.get(
                state["web_url"] + "/api/v1/projects/p_unknown",
                headers={"Authorization": f"Bearer {token}"},
            ).status_code
            == 404
        )
    report = {"status": "PASS" if all(checks.values()) else "FAIL", "checks": checks}
    (ROOT / "artifacts/deployed-security.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    if not all(checks.values()):
        raise RuntimeError("Deployment checks failed; inspect boolean-only report.")


if __name__ == "__main__":
    main()
