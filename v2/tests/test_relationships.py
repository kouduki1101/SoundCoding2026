import time

from code_groove.app import create_app
from code_groove.relationships import relationship_data
from code_groove.schemas import CallRelationships
from code_groove.settings import Settings
from code_groove.source import build_index
from fastapi.testclient import TestClient


def test_python_static_links_keep_all_returns_and_skip_reassigned_results(tmp_path):
    marker = tmp_path / "must_not_execute"
    sources = {
        "policy.py": f"open({str(marker)!r}, 'w').write('unsafe')\ndef decide(x):\n    if x: return True\n    return False\n",
        "service.py": "from policy import decide as policy\ndef run(x):\n    result = policy(x)\n    if result: consume(result)\n    return result\n",
    }
    index = build_index("snap_python_links", sources)
    unit = next(unit for unit in index["units"] if unit["label"] == "run")
    snapshot = {"snapshot_id": "snap_python_links", "sources": sources}
    result = relationship_data(snapshot, {"units": [unit]}, unit["unit_id"])
    CallRelationships.model_validate(result)
    call = next(link for link in result["links"] if link["name"] == "policy")
    assert call["resolution"] == "static_definition"
    assert [span["start_line"] for span in call["return_spans"]] == [3, 4]
    assert [span["start_line"] for span in call["use_spans"]] == [4, 5]
    assert not marker.exists()
    sources["service.py"] = sources["service.py"].replace("    if result", "    result = None\n    if result")
    index = build_index("snap_rebound", sources)
    unit = next(unit for unit in index["units"] if unit["label"] == "run")
    result = relationship_data(
        {"snapshot_id": "snap_rebound", "sources": sources}, {"units": [unit]}, unit["unit_id"]
    )
    call = next(link for link in result["links"] if link["name"] == "policy")
    assert call["use_status"] == "unresolved"
    assert call["use_spans"] == []


def test_read_only_relationship_endpoints_enforce_owner_and_expiration(tmp_path):
    app = create_app(
        Settings(local_data_dir=tmp_path, model_mode="fixture", store_mode="local"),
        verifier=lambda token: token,
    )
    for user in ("alice", "bob"):
        app.state.store.put("accounts", user, {"enabled": True})
    client = TestClient(app)
    bundle = client.get("/api/v1/samples/recorded-checkout-flow/bundle").json()["data"]
    unit = next(unit for unit in bundle["map"]["units"] if unit["label"] == "submitCheckout")
    query = f"?unit_id={unit['unit_id']}"
    public = client.get("/api/v1/samples/recorded-checkout-flow/relationships" + query)
    assert public.status_code == 200
    result = public.json()["data"]
    CallRelationships.model_validate(result)
    quote = next(link for link in result["links"] if link["name"] == "quoteInvoice")
    assert quote["resolution"] == "static_definition"
    assert quote["return_spans"] and quote["use_spans"]
    headers = {"Authorization": "Bearer alice", "Idempotency-Key": "copy_static_links"}
    copied = client.post("/api/v1/samples/recorded-checkout-flow/projects", headers=headers, json={}).json()[
        "data"
    ]
    url = f"/api/v1/analyses/{copied['analysis_id']}/relationships" + query
    assert client.get(url, headers=headers).status_code == 200
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer bob"}).status_code == 404
    assert (
        client.get("/api/v1/samples/recorded-checkout-flow/relationships?unit_id=unknown").status_code == 400
    )
    app.state.store.update("analyses", copied["analysis_id"], {"expires_at": time.time() - 1})
    assert client.get(url, headers=headers).status_code == 410


def test_python_global_rebinding_does_not_claim_a_call_target():
    sources = {
        "main.py": "def decide():\n    return 1\ndecide = unknown()\ndef run():\n    return decide()\n"
    }
    index = build_index("snap_global_rebinding", sources)
    unit = next(unit for unit in index["units"] if unit["label"] == "run")
    result = relationship_data(
        {"snapshot_id": "snap_global_rebinding", "sources": sources}, {"units": [unit]}, unit["unit_id"]
    )
    assert result["links"][0]["resolution"] == "unresolved"
    assert result["links"][0]["return_spans"] == []
