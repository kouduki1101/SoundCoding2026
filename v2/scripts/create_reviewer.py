import json
import os
import secrets
import time

import firebase_admin
from code_groove.settings import ROOT, Settings
from code_groove.storage import MetadataStore
from firebase_admin import auth

from infra.gcp import PROJECT, cloud

EMAIL = os.environ["CG_REVIEWER_EMAIL"]
SECRET = os.environ["CG_REVIEWER_PASSWORD_SECRET"]


def main():
    os.environ["GOOGLE_CLOUD_QUOTA_PROJECT"] = PROJECT
    password = cloud("secrets", "versions", "access", "latest", f"--secret={SECRET}", optional=True)
    if not password:
        password = secrets.token_urlsafe(24)
        if cloud("secrets", "describe", SECRET, optional=True) is None:
            cloud("secrets", "create", SECRET, "--replication-policy=automatic")
        cloud("secrets", "versions", "add", SECRET, "--data-file=-", input_data=password.encode())
    app = firebase_admin.initialize_app(options={"projectId": PROJECT}, name="reviewer-setup")
    try:
        user = auth.get_user_by_email(EMAIL, app=app)
        auth.update_user(user.uid, password=password, disabled=False, app=app)
    except auth.UserNotFoundError:
        user = auth.create_user(
            email=EMAIL, password=password, email_verified=False, display_name="Code Groove Reviewer", app=app
        )
    settings = Settings(store_mode="gcp")
    store = MetadataStore(settings)
    previous = store.get("accounts", user.uid) or {}
    store.put(
        "accounts",
        user.uid,
        {
            **previous,
            "enabled": True,
            "role": "reviewer",
            "created_at": previous.get("created_at", time.time()),
            "updated_at": time.time(),
        },
    )
    (ROOT / ".local/reviewer.json").write_text(
        json.dumps({"email": EMAIL, "uid": user.uid, "secret": SECRET}), encoding="utf-8"
    )
    print(
        json.dumps(
            {"status": "created"}
        )
    )


if __name__ == "__main__":
    main()
