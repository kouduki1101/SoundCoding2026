from unittest.mock import Mock

from code_groove.jobs import JobService
from code_groove.settings import Settings
from code_groove.storage import ArtifactStore, MetadataStore


def test_enqueue_outage_preserves_run_and_retry_does_not_reserve_twice(tmp_path, monkeypatch):
    settings = Settings(local_data_dir=tmp_path, enable_live_analysis=True, model_mode="live")
    metadata, artifacts = MetadataStore(settings), ArtifactStore(settings)
    metadata.put("accounts", "reviewer", {"enabled": True})
    settings.store_mode = "gcp"
    task_client = Mock()
    task_client.queue_path.return_value = "projects/p/locations/tokyo/queues/q"
    task_client.create_task.side_effect = RuntimeError("network failure")
    monkeypatch.setattr("code_groove.jobs.tasks_v2.CloudTasksClient", lambda: task_client)
    jobs = JobService(settings, metadata, artifacts)
    body = {"source": {"kind": "sample", "sample_id": "mixed"}}
    created = jobs.create("reviewer", body, "same-request")
    assert created["status"] == "enqueue_pending"
    pending = metadata.get("runs", created["run_id"])
    reserved = metadata.list("global_quotas")[0]["reserved_input"]
    task_client.create_task.side_effect = None
    jobs.enqueue(pending)
    again = jobs.create("reviewer", body, "same-request")
    assert again["run_id"] == created["run_id"] and again["status"] == "queued"
    assert metadata.list("global_quotas")[0]["reserved_input"] == reserved
