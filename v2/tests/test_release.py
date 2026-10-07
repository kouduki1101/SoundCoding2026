import json

import httpx
import pytest

from infra import gcp
from scripts import release


@pytest.fixture
def release_environment(tmp_path, monkeypatch):
    image = "example.invalid/runtime:release"
    state = {"web_url": "https://web.example.invalid", "worker_url": "https://worker.example.invalid"}
    (tmp_path / ".local").mkdir()
    (tmp_path / ".local/deploy-settings.json").write_text(json.dumps(state))
    fixture = tmp_path / "fixtures/recorded-live/tsugiai-agents.json"
    fixture.parent.mkdir(parents=True)
    fixture.write_text(json.dumps({"recording": "expected"}))
    service = {
        "spec": {"template": {"spec": {"containers": [{"image": image}]}}},
        "status": {
            "latestCreatedRevisionName": "release",
            "latestReadyRevisionName": "release",
            "traffic": [{"revisionName": "release", "percent": 100}],
        },
    }
    responses = {
        state["web_url"] + "/health": (200, {"status": "ok"}),
        state["web_url"] + "/api/v1/projects": (401, {}),
        state["worker_url"] + "/health": (403, {}),
        state["web_url"] + "/api/v1/samples/recorded-tsugiai-agents/bundle": (
            200,
            {"data": {"recording": "expected"}},
        ),
    }

    def get(url, **kwargs):
        status, body = responses[url]
        return httpx.Response(status, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(release, "ROOT", tmp_path)
    monkeypatch.setattr(release, "cloud", lambda *args, **kwargs: service)
    monkeypatch.setattr(release.httpx, "get", get)
    return image, service, responses, state


def test_release_verifies_both_services_and_public_replay(release_environment):
    image, _, _, _ = release_environment
    release.verify_health(image)


@pytest.mark.parametrize("failure", ["image", "not_ready", "traffic", "web_auth", "worker_auth", "sample"])
def test_release_rejects_incomplete_or_unsafe_rollout(release_environment, failure):
    image, service, responses, state = release_environment
    if failure == "image":
        service["spec"]["template"]["spec"]["containers"][0]["image"] = "previous-image"
    elif failure == "not_ready":
        service["status"]["latestCreatedRevisionName"] = "pending"
    elif failure == "traffic":
        service["status"]["traffic"] = [{"revisionName": "release", "percent": 50}]
    elif failure == "web_auth":
        responses[state["web_url"] + "/api/v1/projects"] = (200, {})
    elif failure == "worker_auth":
        responses[state["worker_url"] + "/health"] = (200, {})
    else:
        responses[state["web_url"] + "/api/v1/samples/recorded-tsugiai-agents/bundle"] = (200, {"data": {}})
    with pytest.raises(RuntimeError):
        release.verify_health(image)


def test_deploy_creates_private_report_directory_on_fresh_checkout(tmp_path, monkeypatch):
    state = {
        "project": "example-project",
        "region": "asia-northeast1",
        "accounts": {"web": "web", "worker": "worker", "tasks-invoker": "tasks", "deploy": "deploy"},
        "firebase": {"apiKey": "public-example", "appId": "example", "authDomain": "example.invalid"},
        "web_url": "https://code-groove-web.example.invalid",
    }
    config = tmp_path / "deployment-config.json"
    config.write_text(json.dumps(state))

    def cloud(*args, **kwargs):
        if args[:3] == ("run", "services", "describe"):
            return {"status": {"url": f"https://{args[3]}.example.invalid"}}
        return None

    monkeypatch.setattr(gcp, "ROOT", tmp_path)
    monkeypatch.setattr(gcp, "STATE", config)
    monkeypatch.setattr(gcp, "cloud", cloud)
    monkeypatch.setenv("CG_DEPLOY_SKIP_IAM", "1")
    gcp.deploy("example.invalid/runtime:release")
    report = json.loads((tmp_path / "artifacts/deployment.json").read_text())
    assert report["image"] == "example.invalid/runtime:release"
    assert (tmp_path / ".local/deploy-settings.json").is_file()
