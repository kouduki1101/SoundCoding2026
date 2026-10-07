import asyncio
import importlib.metadata
import json
import subprocess
import sys
from pathlib import Path

import google.auth
from google.genai import types
from google.oauth2.credentials import Credentials

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/backend"))
from code_groove.model_client import create_model_client  # noqa: E402
from code_groove.settings import Settings  # noqa: E402


async def main():
    settings = Settings()
    report = {
        "sdk": importlib.metadata.version("google-genai"),
        "model": settings.gemini_model,
        "location": settings.google_cloud_location,
        "auth_mode": settings.model_auth_mode,
    }
    try:
        try:
            credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            report["credential_source"] = "adc"
        except google.auth.exceptions.DefaultCredentialsError:
            result = subprocess.run(
                ["gcloud.cmd", "auth", "print-access-token"],
                capture_output=True,
                text=True,
                check=True,
                timeout=30,
            )
            credentials = Credentials(token=result.stdout.strip())
            report["credential_source"] = "authenticated_gcloud_preflight_only"
        client = create_model_client(settings, credentials)
        declaration = types.FunctionDeclaration(
            name="read_probe",
            description="Return the probe value.",
            parameters_json_schema={"type": "object", "properties": {}, "required": []},
        )
        config = types.GenerateContentConfig(
            tools=[types.Tool(function_declarations=[declaration])],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            thinking_config=types.ThinkingConfig(thinking_level="MEDIUM"),
            max_output_tokens=512,
        )
        history = [
            types.Content(role="user", parts=[types.Part(text="Call read_probe, then report its value.")])
        ]
        response = await asyncio.wait_for(
            client.aio.models.generate_content(model=settings.gemini_model, contents=history, config=config),
            timeout=70,
        )
        content = response.candidates[0].content
        calls = [p.function_call for p in content.parts if p.function_call]
        if not calls:
            raise RuntimeError("No function call returned")
        history.append(content)
        history.append(
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=c.id, name=c.name, response={"value": "groove-ok"}
                        )
                    )
                    for c in calls
                ],
            )
        )
        response = await asyncio.wait_for(
            client.aio.models.generate_content(model=settings.gemini_model, contents=history, config=config),
            timeout=70,
        )
        report.update(
            status="PASS",
            function_roundtrip=True,
            function_ids_present=all(c.id for c in calls),
            usage=response.usage_metadata.model_dump(mode="json"),
            text=response.text,
        )
        await client.aio.aclose()
    except Exception as exc:
        report.update(
            status="BLOCKED_MODEL_CONNECTION",
            error_type=type(exc).__name__,
            error_code=getattr(exc, "code", None),
        )
    (ROOT / "artifacts/model-preflight.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


asyncio.run(main())
