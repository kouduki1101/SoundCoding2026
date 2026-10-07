import asyncio
import os
import subprocess
import sys

from code_groove.jobs import TERMINAL, JobService
from code_groove.settings import Settings
from code_groove.storage import ArtifactStore, MetadataStore


async def worker():
    settings = Settings()
    store = MetadataStore(settings)
    jobs = JobService(settings, store, ArtifactStore(settings))
    while True:
        for run in store.list("runs"):
            if run["status"] not in TERMINAL:
                await jobs.handle(run["run_id"])
        for project in store.list("projects"):
            if project["status"] == "deleting":
                jobs.delete(project["project_id"])
        await asyncio.sleep(2)


if __name__ == "__main__":
    if "--worker" in sys.argv:
        asyncio.run(worker())
    else:
        environment = {**os.environ, "PYTHONPATH": "apps/backend"}
        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "code_groove.app:app", "--port", "8080"], env=environment
        )
        queue = subprocess.Popen([sys.executable, __file__, "--worker"], env=environment)
        try:
            api.wait()
        finally:
            api.terminate()
            queue.terminate()
