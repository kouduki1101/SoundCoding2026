from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    environment: Literal["local", "production"] = "local"
    app_role: Literal["web", "worker"] = "web"
    model_mode: Literal["fixture", "live"] = "fixture"
    model_auth_mode: Literal["adc", "express"] = "adc"
    gemini_model: str = "gemini-3.8-flash"
    google_cloud_project: str = "artful-bonsai-491601-p3"
    google_cloud_location: str = "global"
    google_cloud_api_key: str = ""
    gcp_region: str = "asia-northeast1"
    store_mode: Literal["local", "gcp"] = "local"
    local_data_dir: Path = ROOT / ".local"
    artifact_bucket: str = ""
    tasks_queue: str = "cg-analysis"
    tasks_invoker_email: str = ""
    worker_url: str = ""
    public_base_url: str = "http://localhost:5173"
    enable_live_analysis: bool = False
    firebase_api_key: str = ""
    firebase_auth_domain: str = ""
    firebase_app_id: str = ""
    firestore_database: str = "(default)"

    def validate_runtime(self) -> None:
        if self.environment == "production":
            if self.model_mode != "live" or self.store_mode != "gcp":
                raise RuntimeError("Production requires live model and GCP storage")
            if not self.artifact_bucket or not self.google_cloud_project:
                raise RuntimeError("Missing production storage configuration")
            if self.app_role == "web" and not self.firebase_api_key:
                raise RuntimeError("Missing Firebase configuration")
