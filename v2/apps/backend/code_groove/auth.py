import firebase_admin
from firebase_admin import auth

from code_groove.errors import GrooveError
from code_groove.settings import Settings


class FirebaseVerifier:
    def __init__(self, settings: Settings):
        try:
            self.app = firebase_admin.get_app("code-groove")
        except ValueError:
            self.app = firebase_admin.initialize_app(
                options={"projectId": settings.google_cloud_project}, name="code-groove"
            )

    def __call__(self, token: str) -> str:
        try:
            return auth.verify_id_token(token, app=self.app, check_revoked=True)["uid"]
        except Exception as exc:
            raise GrooveError("AUTH_REQUIRED", "ログインし直してください。", 401) from exc
