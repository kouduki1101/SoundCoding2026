"""ADK model boundary. The application retains budgets, leases and evidence validation.

No ADK automatic tool execution, remote sessions, caching or telemetry exporter is enabled.
One non-streaming request produces one complete Content, including opaque thought signatures.
"""

from google import genai
from google.adk.models.google_llm import Gemini
from google.adk.models.llm_request import LlmRequest
from google.genai import types

from code_groove.errors import GrooveError


async def generate_response(
    client: genai.Client, model: str, contents: list[types.Content], config: types.GenerateContentConfig
) -> types.GenerateContentResponse:
    adapter = Gemini(model=model, client=client)
    request = LlmRequest(model=model, contents=contents, config=config)
    async for response in adapter.generate_content_async(request, stream=False):
        if response.partial:
            continue
        if response.error_code or not response.content:
            raise GrooveError("MODEL_BLOCKED", "モデルが有効な応答を返しませんでした。", 503)
        return types.GenerateContentResponse(
            candidates=[types.Candidate(content=response.content)],
            usage_metadata=response.usage_metadata,
        )
    raise GrooveError("MODEL_BLOCKED", "モデルが有効な応答を返しませんでした。", 503)
