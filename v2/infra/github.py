import json
import shutil
import subprocess

from infra.gcp import STATE, cloud

REPOSITORY = "kdoai/code-groove"
GH = shutil.which("gh")


def github(*args):
    result = subprocess.run([GH, *args], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def main():
    repo = json.loads(github("api", f"repos/{REPOSITORY}"))
    state = json.loads(STATE.read_text())
    number = state["number"]
    pool = "cg-github"
    if cloud("iam", "workload-identity-pools", "describe", pool, "--location=global", optional=True) is None:
        cloud(
            "iam",
            "workload-identity-pools",
            "create",
            pool,
            "--location=global",
            "--display-name=Code Groove GitHub",
        )
    if (
        cloud(
            "iam",
            "workload-identity-pools",
            "providers",
            "describe",
            "github",
            "--workload-identity-pool=cg-github",
            "--location=global",
            optional=True,
        )
        is None
    ):
        cloud(
            "iam",
            "workload-identity-pools",
            "providers",
            "create-oidc",
            "github",
            "--location=global",
            "--workload-identity-pool=cg-github",
            "--issuer-uri=https://token.actions.githubusercontent.com",
            "--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id",
            f"--attribute-condition=assertion.repository_id=='{repo['id']}' && assertion.repository_owner_id=='{repo['owner']['id']}' && assertion.ref=='refs/heads/main' && assertion.environment=='production'",
        )
    provider = f"projects/{number}/locations/global/workloadIdentityPools/{pool}/providers/github"
    member = f"principalSet://iam.googleapis.com/projects/{number}/locations/global/workloadIdentityPools/{pool}/attribute.repository_id/{repo['id']}"
    cloud(
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        state["accounts"]["deploy"],
        f"--member={member}",
        "--role=roles/iam.workloadIdentityUser",
    )
    github("variable", "set", "GCP_WORKLOAD_IDENTITY_PROVIDER", "--repo", REPOSITORY, "--body", provider)
    github(
        "api",
        f"repos/{REPOSITORY}/environments/production",
        "--method",
        "PUT",
        "--input",
        "infra/github-environment.json",
    )
    policies = json.loads(
        github("api", f"repos/{REPOSITORY}/environments/production/deployment-branch-policies")
    )
    if not any(policy["name"] == "main" for policy in policies["branch_policies"]):
        github(
            "api",
            f"repos/{REPOSITORY}/environments/production/deployment-branch-policies",
            "--method",
            "POST",
            "-f",
            "name=main",
            "-f",
            "type=branch",
        )
    print(
        json.dumps(
            {
                "repository": REPOSITORY,
                "provider": provider,
                "identity": state["accounts"]["deploy"],
                "service_account_keys": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
