"""Explicit-project, idempotent bootstrap and deployment. No credential files are generated."""

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import httpx

PROJECT = "artful-bonsai-491601-p3"
REGION = "asia-northeast1"
ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local/deploy-settings.json"
if not STATE.exists() and (ROOT / "infra/deployment-config.json").exists():
    STATE = ROOT / "infra/deployment-config.json"
GCLOUD = shutil.which("gcloud")
ARTIFACTS = f"{PROJECT}-cg-artifacts"
BUILD_BUCKET = f"{PROJECT}-cg-build"


def cloud(*args, json_output=False, optional=False, input_data=None):
    command = [GCLOUD, *args, f"--project={PROJECT}", "--quiet"]
    if json_output:
        command.append("--format=json")
    result = subprocess.run(command, input=input_data, capture_output=True, cwd=ROOT)
    if result.returncode:
        if optional:
            return None
        raise RuntimeError(result.stderr.decode(errors="replace")[-2500:])
    output = result.stdout.decode(errors="replace")
    return json.loads(output or "{}") if json_output else output.strip()


def api(method, url, payload=None):
    token = cloud("auth", "print-access-token")
    response = httpx.request(
        method,
        url,
        json=payload,
        headers={"Authorization": f"Bearer {token}", "x-goog-user-project": PROJECT},
        timeout=60,
    )
    if response.is_error:
        raise RuntimeError(
            f"{method} {url.split('?')[0]}: {response.status_code} {response.json().get('error', {}).get('message', '')}"
        )
    return response.json()


def wait_operation(value, base):
    for _ in range(60):
        if value.get("done"):
            if value.get("error"):
                raise RuntimeError(value["error"]["message"])
            return value.get("response", {})
        time.sleep(2)
        value = api("GET", f"{base}/{value['name']}")
    raise RuntimeError("Cloud operation timed out")


def service_account(name):
    email = f"{name}@{PROJECT}.iam.gserviceaccount.com"
    if not cloud("iam", "service-accounts", "describe", email, optional=True):
        cloud("iam", "service-accounts", "create", name, f"--display-name=Code Groove {name}")
    return email


def project_role(email, role):
    cloud(
        "projects",
        "add-iam-policy-binding",
        PROJECT,
        f"--member=serviceAccount:{email}",
        f"--role={role}",
        "--condition=None",
    )


def bucket_role(bucket, email, role):
    cloud(
        "storage",
        "buckets",
        "add-iam-policy-binding",
        f"gs://{bucket}",
        f"--member=serviceAccount:{email}",
        f"--role={role}",
    )


def save(state):
    destination = ROOT / ".local/deploy-settings.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(state, indent=2), encoding="utf-8")


def bootstrap():
    print("Enabling APIs in target project", flush=True)
    cloud(
        "services",
        "enable",
        *[
            f"{name}.googleapis.com"
            for name in (
                "run",
                "cloudbuild",
                "cloudtasks",
                "artifactregistry",
                "iam",
                "iamcredentials",
                "sts",
                "secretmanager",
                "firestore",
                "storage",
                "aiplatform",
                "firebase",
                "identitytoolkit",
                "cloudbilling",
                "billingbudgets",
                "apikeys",
            )
        ],
    )
    number = cloud("projects", "describe", PROJECT, json_output=True)["projectNumber"]
    accounts = {
        name: service_account(f"cg-{name}") for name in ("web", "worker", "tasks-invoker", "build", "deploy")
    }
    state = {
        "project": PROJECT,
        "number": str(number),
        "region": REGION,
        "accounts": accounts,
        "artifact_bucket": ARTIFACTS,
        "build_bucket": BUILD_BUCKET,
    }
    save(state)
    print("Creating private storage, native Firestore and serial queue", flush=True)
    for bucket in (ARTIFACTS, BUILD_BUCKET):
        if cloud("storage", "buckets", "describe", f"gs://{bucket}", optional=True) is None:
            cloud(
                "storage",
                "buckets",
                "create",
                f"gs://{bucket}",
                f"--location={REGION}",
                "--uniform-bucket-level-access",
                "--public-access-prevention",
            )
        lifecycle = ROOT / ".local/lifecycle.json"
        lifecycle.write_text(
            json.dumps(
                {
                    "rule": [
                        {"action": {"type": "Delete"}, "condition": {"age": 14 if bucket == ARTIFACTS else 3}}
                    ]
                }
            ),
            encoding="utf-8",
        )
        cloud("storage", "buckets", "update", f"gs://{bucket}", f"--lifecycle-file={lifecycle}")
    if not cloud("firestore", "databases", "list", json_output=True):
        cloud(
            "firestore",
            "databases",
            "create",
            "--database=(default)",
            f"--location={REGION}",
            "--type=firestore-native",
        )
    if (
        cloud("artifacts", "repositories", "describe", "code-groove", f"--location={REGION}", optional=True)
        is None
    ):
        cloud(
            "artifacts",
            "repositories",
            "create",
            "code-groove",
            f"--location={REGION}",
            "--repository-format=docker",
            "--description=Code Groove runtime",
        )
    cleanup = ROOT / ".local/registry-cleanup.json"
    cleanup.write_text(
        json.dumps(
            [
                {"name": "old-images", "action": {"type": "Delete"}, "condition": {"olderThan": "604800s"}},
                {
                    "name": "keep-latest-two",
                    "action": {"type": "Keep"},
                    "mostRecentVersions": {"keepCount": 2},
                },
            ]
        ),
        encoding="utf-8",
    )
    cloud(
        "artifacts",
        "repositories",
        "set-cleanup-policies",
        "code-groove",
        f"--location={REGION}",
        f"--policy={cleanup}",
        "--no-dry-run",
    )
    if cloud("tasks", "queues", "describe", "cg-analysis", f"--location={REGION}", optional=True) is None:
        cloud("tasks", "queues", "create", "cg-analysis", f"--location={REGION}")
    cloud(
        "tasks",
        "queues",
        "update",
        "cg-analysis",
        f"--location={REGION}",
        "--max-concurrent-dispatches=1",
        "--max-dispatches-per-second=1",
        "--max-attempts=3",
        "--min-backoff=10s",
        "--max-backoff=60s",
        "--max-retry-duration=3600s",
    )
    for name in ("web", "worker"):
        project_role(accounts[name], "roles/datastore.user")
    project_role(accounts["web"], "roles/firebaseauth.viewer")
    project_role(accounts["worker"], "roles/aiplatform.user")
    for name in ("web", "worker", "deploy"):
        project_role(accounts[name], "roles/serviceusage.serviceUsageConsumer")
    cloud(
        "tasks",
        "queues",
        "add-iam-policy-binding",
        "cg-analysis",
        f"--location={REGION}",
        f"--member=serviceAccount:{accounts['web']}",
        "--role=roles/cloudtasks.enqueuer",
    )
    cloud(
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        accounts["tasks-invoker"],
        f"--member=serviceAccount:{accounts['web']}",
        "--role=roles/iam.serviceAccountUser",
    )
    bucket_role(ARTIFACTS, accounts["web"], "roles/storage.objectViewer")
    bucket_role(ARTIFACTS, accounts["web"], "roles/storage.objectCreator")
    bucket_role(ARTIFACTS, accounts["worker"], "roles/storage.objectUser")
    bucket_role(BUILD_BUCKET, accounts["build"], "roles/storage.objectViewer")
    bucket_role(BUILD_BUCKET, accounts["deploy"], "roles/storage.objectUser")
    bucket_role(BUILD_BUCKET, accounts["deploy"], "roles/storage.bucketViewer")
    cloud(
        "artifacts",
        "repositories",
        "add-iam-policy-binding",
        "code-groove",
        f"--location={REGION}",
        f"--member=serviceAccount:{accounts['build']}",
        "--role=roles/artifactregistry.writer",
    )
    cloud(
        "artifacts",
        "repositories",
        "add-iam-policy-binding",
        "code-groove",
        f"--location={REGION}",
        f"--member=serviceAccount:{accounts['deploy']}",
        "--role=roles/artifactregistry.reader",
    )
    project_role(accounts["build"], "roles/logging.logWriter")
    project_role(accounts["deploy"], "roles/cloudbuild.builds.editor")
    for name in ("web", "worker", "build"):
        cloud(
            "iam",
            "service-accounts",
            "add-iam-policy-binding",
            accounts[name],
            f"--member=serviceAccount:{accounts['deploy']}",
            "--role=roles/iam.serviceAccountUser",
        )
    configure_firebase(state)


def configure_firebase(state):
    print("Configuring Firebase email/password (preserving other providers)", flush=True)
    base = "https://firebase.googleapis.com/v1beta1"
    apps = api("GET", f"{base}/projects/{PROJECT}/webApps").get("apps", [])
    app = next((a for a in apps if a.get("displayName") == "Code Groove"), None)
    if not app:
        app = wait_operation(
            api("POST", f"{base}/projects/{PROJECT}/webApps", {"displayName": "Code Groove"}), base
        )
    state["firebase"] = api("GET", f"{base}/{app['name']}/config")
    auth_base = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config"
    api(
        "PATCH",
        f"{auth_base}?updateMask=signIn.email.enabled,signIn.email.passwordRequired,client.permissions.disabledUserSignup,client.permissions.disabledUserDeletion",
        {
            "signIn": {"email": {"enabled": True, "passwordRequired": True}},
            "client": {"permissions": {"disabledUserSignup": True, "disabledUserDeletion": True}},
        },
    )
    configure_browser_key(state)
    save(state)
    print("Bootstrap finished", flush=True)


def configure_browser_key(state):
    base = "https://apikeys.googleapis.com/v2"
    parent = f"projects/{state['number']}/locations/global"
    keys = api("GET", f"{base}/{parent}/keys").get("keys", [])
    key = next((value for value in keys if value.get("displayName") == "Code Groove browser auth"), None)
    if not key:
        key = wait_operation(
            api(
                "POST",
                f"{base}/{parent}/keys?keyId=code-groove-browser",
                {
                    "displayName": "Code Groove browser auth",
                    "restrictions": {
                        "apiTargets": [
                            {"service": "identitytoolkit.googleapis.com"},
                            {"service": "securetoken.googleapis.com"},
                        ]
                    },
                },
            ),
            base,
        )
    state["firebase"]["apiKey"] = api("GET", f"{base}/{key['name']}/keyString")["keyString"]


def deploy(image):
    state = json.loads(STATE.read_text())
    accounts = state["accounts"]
    common = {
        "ENVIRONMENT": "production",
        "MODEL_MODE": "live",
        "STORE_MODE": "gcp",
        "MODEL_AUTH_MODE": "adc",
        "GOOGLE_CLOUD_PROJECT": PROJECT,
        "GOOGLE_CLOUD_QUOTA_PROJECT": PROJECT,
        "GOOGLE_CLOUD_LOCATION": "global",
        "GCP_REGION": REGION,
        "GEMINI_MODEL": "gemini-3.8-flash",
        "ARTIFACT_BUCKET": ARTIFACTS,
        "ENABLE_LIVE_ANALYSIS": "true",
        "TASKS_QUEUE": "cg-analysis",
        "TASKS_INVOKER_EMAIL": accounts["tasks-invoker"],
    }

    def rollout(name, environment, memory, timeout, concurrency, max_instances):
        environment_file = ROOT / f".local/{name}-env.yaml"
        environment_file.parent.mkdir(parents=True, exist_ok=True)
        environment_file.write_text(json.dumps(environment), encoding="utf-8")
        cloud(
            "run",
            "deploy",
            name,
            f"--image={image}",
            f"--region={REGION}",
            "--cpu=1",
            f"--memory={memory}",
            f"--timeout={timeout}",
            f"--concurrency={concurrency}",
            "--min=0",
            f"--max={max_instances}",
            f"--max-instances={max_instances}",
            "--startup-probe=httpGet.path=/health,periodSeconds=10,timeoutSeconds=5,failureThreshold=12",
            "--cpu-throttling",
            f"--service-account={accounts['worker' if name.endswith('worker') else 'web']}",
            f"--env-vars-file={environment_file}",
        )
        return cloud("run", "services", "describe", name, f"--region={REGION}", json_output=True)["status"][
            "url"
        ]

    worker = rollout("code-groove-worker", {**common, "APP_ROLE": "worker"}, "1Gi", "600s", 1, 1)
    if not os.environ.get("CG_DEPLOY_SKIP_IAM"):
        cloud(
            "run",
            "services",
            "add-iam-policy-binding",
            "code-groove-worker",
            f"--region={REGION}",
            f"--member=serviceAccount:{accounts['tasks-invoker']}",
            "--role=roles/run.invoker",
        )
    web_env = {
        **common,
        "APP_ROLE": "web",
        "WORKER_URL": worker,
        "FIREBASE_API_KEY": state["firebase"]["apiKey"],
        "FIREBASE_APP_ID": state["firebase"]["appId"],
        "FIREBASE_AUTH_DOMAIN": state["firebase"]["authDomain"],
    }
    if state.get("web_url"):
        web_env["PUBLIC_BASE_URL"] = state["web_url"]
    web = rollout("code-groove-web", web_env, "512Mi", "60s", 40, 2)
    if web_env.get("PUBLIC_BASE_URL") != web:
        cloud(
            "run",
            "services",
            "update",
            "code-groove-web",
            f"--region={REGION}",
            f"--update-env-vars=PUBLIC_BASE_URL={web}",
        )
    if not os.environ.get("CG_DEPLOY_SKIP_IAM"):
        cloud(
            "run",
            "services",
            "add-iam-policy-binding",
            "code-groove-web",
            f"--region={REGION}",
            "--member=allUsers",
            "--role=roles/run.invoker",
        )
        config_url = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config"
        config = api("GET", config_url)
        domains = list(dict.fromkeys(config.get("authorizedDomains", []) + [web.split("://")[1]]))
        api("PATCH", f"{config_url}?updateMask=authorizedDomains", {"authorizedDomains": domains})
    if not os.environ.get("CG_DEPLOY_SKIP_IAM"):
        for service in ("code-groove-web", "code-groove-worker"):
            cloud(
                "run",
                "services",
                "add-iam-policy-binding",
                service,
                f"--region={REGION}",
                f"--member=serviceAccount:{accounts['deploy']}",
                "--role=roles/run.developer",
            )
    state.update(worker_url=worker, web_url=web, image=image)
    save(state)
    report = ROOT / "artifacts/deployment.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps({k: state[k] for k in ("project", "region", "web_url", "worker_url", "image")}, indent=2),
        encoding="utf-8",
    )
    print(f"Deployed {web}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["bootstrap", "build", "deploy"])
    parser.add_argument("--image")
    args = parser.parse_args()
    if args.action == "bootstrap":
        bootstrap()
    elif args.action == "build":
        if not args.image:
            parser.error("--image is required")
        state = json.loads(STATE.read_text())
        print("Submitting Cloud Build", flush=True)
        build = cloud(
            "builds",
            "submit",
            ".",
            "--config=cloudbuild.yaml",
            f"--substitutions=_IMAGE={args.image}",
            f"--service-account=projects/{PROJECT}/serviceAccounts/{state['accounts']['build']}",
            f"--gcs-source-staging-dir=gs://{BUILD_BUCKET}/source",
            "--async",
            json_output=True,
        )
        print(json.dumps({"id": build["id"], "status": build["status"]}))
    else:
        if not args.image:
            parser.error("--image is required")
        deploy(args.image)
