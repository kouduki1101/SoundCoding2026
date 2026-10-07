import json

from infra.gcp import PROJECT, ROOT, STATE, api, cloud


def main():
    state = json.loads(STATE.read_text())
    for collection in (
        "projects",
        "analyses",
        "investigations",
        "proposals",
        "runs",
        "run_events",
        "idempotency",
        "daily_quotas",
        "global_quotas",
    ):
        cloud(
            "firestore",
            "fields",
            "ttls",
            "update",
            "expires_at",
            f"--collection-group={collection}",
            "--enable-ttl",
            "--async",
        )
    billing = cloud("billing", "projects", "describe", PROJECT, json_output=True)["billingAccountName"]
    account = api("GET", f"https://cloudbilling.googleapis.com/v1/{billing}")
    currency = account.get("currencyCode", "USD")
    wanted = {
        "Cloud Run",
        "Cloud Firestore",
        "Cloud Storage",
        "Cloud Build",
        "Cloud Tasks",
        "Artifact Registry",
        "Secret Manager",
        "Cloud Logging",
        "Identity Platform",
    }
    services = api("GET", "https://cloudbilling.googleapis.com/v1/services?pageSize=5000")["services"]
    included = [service["name"] for service in services if service["displayName"] in wanted]
    url = f"https://billingbudgets.googleapis.com/v1/{billing}/budgets"
    budgets = api("GET", url).get("budgets", [])
    existing = next(
        (item for item in budgets if item.get("displayName") == "Code Groove infrastructure"), None
    )
    amount = "6000" if currency == "JPY" else "30"
    budget = {
        "displayName": "Code Groove infrastructure",
        "budgetFilter": {
            "projects": [f"projects/{state['number']}"],
            "services": included,
            "calendarPeriod": "MONTH",
            "creditTypesTreatment": "INCLUDE_ALL_CREDITS",
        },
        "amount": {"specifiedAmount": {"currencyCode": currency, "units": amount}},
        "thresholdRules": [
            {"thresholdPercent": threshold, "spendBasis": "CURRENT_SPEND"} for threshold in (0.5, 0.8, 1.0)
        ],
    }
    if existing:
        saved = existing
    else:
        saved = api("POST", url, budget)
    report = {
        "budget": saved["name"],
        "currency": currency,
        "amount": amount,
        "service_names": sorted(wanted),
        "included_service_count": len(included),
        "hard_cap": False,
        "ai_excluded": True,
    }
    (ROOT / "artifacts/operations.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
