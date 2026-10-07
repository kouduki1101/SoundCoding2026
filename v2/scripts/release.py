import argparse
import json
import time

import httpx

from infra.gcp import BUILD_BUCKET, PROJECT, REGION, ROOT, STATE, cloud, deploy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    if len(args.revision) != 40 or any(c not in "0123456789abcdef" for c in args.revision):
        parser.error("Use a full Git commit SHA")
    state = json.loads(STATE.read_text())
    image = f"{REGION}-docker.pkg.dev/{PROJECT}/code-groove/runtime:{args.revision}"
    existing = cloud("artifacts", "docker", "images", "describe", image, json_output=True, optional=True)
    if existing:
        print("Reusing the existing revision image", flush=True)
        deploy(image)
        verify_health(image)
        return
    build = cloud(
        "builds",
        "submit",
        ".",
        "--config=cloudbuild.yaml",
        f"--substitutions=_IMAGE={image}",
        f"--service-account=projects/{PROJECT}/serviceAccounts/{state['accounts']['build']}",
        f"--gcs-source-staging-dir=gs://{BUILD_BUCKET}/source",
        "--async",
        json_output=True,
    )
    print(f"Cloud Build {build['id']}", flush=True)
    for _ in range(240):
        status = cloud("builds", "describe", build["id"], json_output=True)["status"]
        if status == "SUCCESS":
            break
        if status in ("FAILURE", "CANCELLED", "TIMEOUT", "INTERNAL_ERROR", "EXPIRED"):
            raise RuntimeError(f"Build ended: {status}")
        time.sleep(5)
    else:
        raise RuntimeError("Build polling deadline exceeded")
    deploy(image)
    verify_health(image)


def verify_health(image):
    saved = json.loads((ROOT / ".local/deploy-settings.json").read_text())
    for service in ("code-groove-web", "code-groove-worker"):
        deployed = cloud("run", "services", "describe", service, f"--region={REGION}", json_output=True)
        if deployed["spec"]["template"]["spec"]["containers"][0]["image"] != image:
            raise RuntimeError(f"{service} is not configured with the release image")
        ready = deployed["status"]["latestReadyRevisionName"]
        if ready != deployed["status"]["latestCreatedRevisionName"]:
            raise RuntimeError(f"{service} release revision is not ready")
        traffic = [entry for entry in deployed["status"].get("traffic", []) if entry.get("percent", 0)]
        if len(traffic) != 1 or traffic[0].get("revisionName") != ready or traffic[0]["percent"] != 100:
            raise RuntimeError(f"{service} release does not serve all traffic")
    response = httpx.get(f"{saved['web_url']}/health", timeout=30)
    response.raise_for_status()
    if response.json().get("status") != "ok":
        raise RuntimeError("Health response invalid")
    protected = httpx.get(f"{saved['web_url']}/api/v1/projects", timeout=30)
    worker = httpx.get(f"{saved['worker_url']}/health", timeout=30)
    if protected.status_code != 401 or worker.status_code != 403:
        raise RuntimeError("Deployment access controls invalid")
    public_sample = httpx.get(f"{saved['web_url']}/api/v1/samples/recorded-tsugiai-agents/bundle", timeout=30)
    public_sample.raise_for_status()
    expected = json.loads((ROOT / "fixtures/recorded-live/tsugiai-agents.json").read_text(encoding="utf-8"))
    if public_sample.json().get("data") != expected:
        raise RuntimeError("Deployed sample does not match the release fixture")
    print("Release image, traffic, health, access controls and public replay verified", flush=True)


if __name__ == "__main__":
    main()
