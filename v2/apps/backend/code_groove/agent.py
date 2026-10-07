import asyncio
import json
import random
import time
import uuid
from typing import Any

from google.genai import errors, types
from pydantic import ValidationError

from code_groove.adk_adapter import generate_response
from code_groove.agent_tools import AgentContext as AgentContext
from code_groove.agent_tools import declarations
from code_groove.agent_tools import execute_tool as execute_tool
from code_groove.errors import GrooveError
from code_groove.model_client import create_model_client
from code_groove.schemas import (
    AnalysisCandidate,
    ComparisonAnswerCandidate,
    ImprovementCandidate,
    InvestigationCandidate,
)
from code_groove.settings import ROOT


def model_error_reason(message: str | None) -> str:
    text = (message or "").lower()
    for fragment, reason in (
        ("signature", "signature_validation"),
        ("schema", "schema_validation"),
        ("turn", "conversation_validation"),
        ("thinking", "thinking_configuration"),
        ("function", "tool_configuration"),
        ("tool", "tool_configuration"),
    ):
        if fragment in text:
            return reason
    return "provider_rejected"


async def run_agent(ctx: AgentContext) -> Any:
    from code_groove.agent_runtime import run_with_adk

    return await run_with_adk(ctx, _run_bounded_loop)


async def _run_bounded_loop(ctx: AgentContext) -> Any:
    client = create_model_client(ctx.settings)
    prompt = (ROOT / "prompts/conductor-system-v1.txt").read_text(encoding="utf-8")
    if ctx.proposing:
        prompt = (ROOT / "prompts/improvement-system-v1.txt").read_text(encoding="utf-8")
    elif ctx.comparing:
        prompt = (ROOT / "prompts/comparison-system-v1.txt").read_text(encoding="utf-8")
    elif ctx.investigating:
        prompt += "\n" + (ROOT / "prompts/investigation-system-v1.txt").read_text(encoding="utf-8")
    payload = {
        "index": {
            **ctx.index,
            "relations": {"count": len(ctx.index["relations"]), "retrieve": "inspect_relations"},
        }
        if ctx.repository_index
        else ctx.index,
        "snapshot_id": ctx.snapshot_id,
        "analysis_depth": ctx.analysis_depth,
        "goal": "意味と所有境界を復元し、必要な反証を調べる",
        "limits": {"responsibilities": 6, "events": 96},
        "base": ctx.base,
        "selection": ctx.selection,
        "verified_unchanged_interpretation": ctx.cached_interpretation,
        "changes": ctx.changes,
        "prior_motif_assignments": ctx.prior_motifs,
        "saved_partition_interpretations_unverified": ctx.integration_context,
    }
    if ctx.repository_index:
        prompt += "\nClassify only the supplied scoped units. Nested callbacks belong to their indexed lexical owner; use member_symbol_ids=[unit_id]. Repository context is static inventory, not a semantic verdict. Use list_units(scope=repository), list_repository_files/search_code/read_code and inspect_relations to follow dependencies and comparison peers outside the selected scope. Outside reads do not mean those partitions are fully classified. Do not claim consistency outside the selected scope or whole-repository completion. For long units read adjacent bounded ranges and cite all ranges covering the unit. Unit calls are paginated through inspect_relations."
    if ctx.integration_context:
        prompt += "\nThis is a bounded cross-partition reconciliation, not whole-repository analysis. Re-read all selected implementations. Saved interpretations are hypotheses, never fresh evidence. Compare change_reason, contracts and counter-explanations across partitions. Assign a shared responsibility/motif only if the same reason to change is supported by fresh reads from each partition. Otherwise keep roles distinct or mark unknown. Report the precise unreviewed scope."
    history = [types.Content(role="user", parts=[types.Part(text=json.dumps(payload, ensure_ascii=False))])]
    output_limit = 8192 if ctx.investigating else 16384
    max_input, max_output = (160000, 20000) if ctx.investigating else (400000, 48000)
    config = types.GenerateContentConfig(
        system_instruction=prompt,
        tools=[types.Tool(function_declarations=declarations(ctx.investigating, ctx.proposing, ctx.comparing))],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MEDIUM),
        max_output_tokens=output_limit,
    )
    text_only = 0
    try:
        while True:
            ctx.check()
            closing = (
                ctx.model_count >= (6 if ctx.investigating else 10)
                or max_output - ctx.output_tokens < output_limit + 4096
                or time.monotonic() - ctx.started > (110 if ctx.investigating else 300)
            )
            if closing:
                if config.tool_config is None:
                    history.append(
                        types.Content(
                            role="user",
                            parts=[
                                types.Part(
                                    text="The exploration boundary is reached. Submit concise grounded "
                                    "results using existing evidence. Mark unsupported units and claims "
                                    "as unknown; do not perform further reads."
                                )
                            ],
                        )
                    )
                final_name = (
                    "submit_proposal"
                    if ctx.proposing
                    else "submit_investigation"
                    if ctx.investigating
                    else "submit_analysis"
                )
                config.tools = [
                    types.Tool(
                        function_declarations=[
                            d for d in declarations(ctx.investigating, ctx.proposing, ctx.comparing) if d.name == final_name
                        ]
                    )
                ]
                config.tool_config = types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(
                        mode=types.FunctionCallingConfigMode.AUTO,
                    )
                )
            try:
                counted = await asyncio.wait_for(
                    client.aio.models.count_tokens(model=ctx.settings.gemini_model, contents=history),  # type: ignore[arg-type]
                    min(30, (180 if ctx.investigating else 480) - (time.monotonic() - ctx.started)),
                )
            except TimeoutError as exc:
                raise GrooveError("MODEL_TIMEOUT", "トークン計数がタイムアウトしました。", 504) from exc
            input_count = (
                int(counted.total_tokens or 0)
                + len(prompt) // 2
                + len(
                    json.dumps(
                        [d.model_dump(mode="json") for d in declarations(ctx.investigating, ctx.proposing, ctx.comparing)]
                    )
                )
                // 2
            )
            if (
                input_count > (32000 if ctx.investigating else 48000)
                or ctx.input_tokens + input_count > max_input
                or max_output - ctx.output_tokens < 1024
            ):
                raise GrooveError("BUDGET_EXCEEDED", "トークン予算に達しました。", 429)
            for retry in range(3):
                ctx.check()
                request_output_limit = min(output_limit, max_output - ctx.output_tokens)
                if ctx.input_tokens + input_count > max_input or request_output_limit < 1024:
                    raise GrooveError("BUDGET_EXCEEDED", "再試行のトークン予算に達しました。", 429)
                if ctx.model_count >= (8 if ctx.investigating else 18):
                    raise GrooveError("BUDGET_EXCEEDED", "モデル呼び出し上限に達しました。", 429)
                ctx.model_count += 1
                ctx.input_tokens += input_count
                ctx.output_tokens += request_output_limit
                ctx.save_usage(
                    {
                        "model_requests": ctx.model_count,
                        "tool_calls": ctx.tool_count,
                        "input_tokens": ctx.input_tokens,
                        "output_tokens": ctx.output_tokens,
                    }
                )
                try:
                    request_config = config.model_copy(deep=True)
                    request_config.max_output_tokens = request_output_limit
                    response = await asyncio.wait_for(
                        generate_response(client, ctx.settings.gemini_model, history, request_config),
                        min(95, (180 if ctx.investigating else 480) - (time.monotonic() - ctx.started)),
                    )
                    break
                except errors.APIError as exc:
                    if exc.code not in (429, 503, 504) or retry == 2:
                        ctx.emit(
                            "model_error",
                            {
                                "code": exc.code,
                                "error_type": type(exc).__name__,
                                "phase": "submission" if closing else "exploration",
                                "reason": model_error_reason(exc.message),
                            },
                        )
                        code = "MODEL_UNAVAILABLE" if exc.code in (401, 403, 404) else "MODEL_ERROR"
                        raise GrooveError(
                            code, "モデルの接続・権限・利用可能性を確認してください。", 503
                        ) from exc
                    ctx.emit("model_retry", {"code": exc.code, "attempt": retry + 1})
                    await asyncio.sleep(min(2**retry + random.random(), 4))
                except TimeoutError as exc:
                    raise GrooveError("MODEL_TIMEOUT", "モデル応答がタイムアウトしました。", 504) from exc
            usage = response.usage_metadata
            if usage:
                ctx.input_tokens += int(usage.prompt_token_count or 0) - input_count
                ctx.output_tokens += (
                    int(usage.candidates_token_count or 0)
                    + int(usage.thoughts_token_count or 0)
                    - request_output_limit
                )
            usage_data = {
                "model_requests": ctx.model_count,
                "tool_calls": ctx.tool_count,
                "input_tokens": ctx.input_tokens,
                "output_tokens": ctx.output_tokens,
            }
            ctx.save_usage(usage_data)
            ctx.emit("budget_updated", usage_data)
            if not response.candidates or not response.candidates[0].content:
                raise GrooveError("MODEL_BLOCKED", "モデルが有効な応答を返しませんでした。", 503)
            content = response.candidates[0].content
            history.append(content)
            calls = [p.function_call for p in content.parts or [] if p.function_call]
            if not calls:
                text_only += 1
                if text_only > 1:
                    raise GrooveError("AGENT_DID_NOT_SUBMIT", "Agentが検証済み結果を提出しませんでした。")
                history.append(
                    types.Content(
                        role="user",
                        parts=[types.Part(text="Submit via the final tool with grounded evidence.")],
                    )
                )
                continue
            response_parts = []
            for call in calls:
                ctx.check()
                if not call.name or not call.id:
                    raise GrooveError("INVALID_MODEL_CALL", "モデルの関数呼び出しIDを検証できません。")
                event_id = f"tool_{uuid.uuid4().hex}"
                purpose = str((call.args or {}).get("purpose", ""))[:160]
                ctx.emit("tool_started", {"tool": call.name, "purpose": purpose, "tool_event_id": event_id})
                started = time.monotonic()
                try:
                    if closing and call.name != (
                        "submit_proposal"
                        if ctx.proposing
                        else "submit_investigation"
                        if ctx.investigating
                        else "submit_analysis"
                    ):
                        raise GrooveError("FINALIZATION_REQUIRED", "取得済みの根拠で提出してください。")
                    if call.name.startswith("submit_") and len(calls) != 1:
                        raise GrooveError("FINALIZE_MUST_BE_ALONE", "提出は単独のbatchで行ってください。")
                    result = execute_tool(ctx, call.name, call.args or {}, event_id)
                    if isinstance(result, (AnalysisCandidate, InvestigationCandidate, ImprovementCandidate, ComparisonAnswerCandidate)):
                        ctx.check()
                        ctx.emit(
                            "tool_completed", {"tool": call.name, "purpose": "検証済み候補を提出", "ok": True}
                        )
                        return result
                    tool_response = {
                        "ok": True,
                        "data": result,
                        "evidence_ids": result.get("evidence_ids", []),
                        "budget_remaining": {
                            "tool_calls": (20 if ctx.investigating else 48) - ctx.tool_count,
                            "model_requests": (8 if ctx.investigating else 18) - ctx.model_count,
                            "output_tokens": max_output - ctx.output_tokens,
                            "seconds": max(
                                0,
                                round((180 if ctx.investigating else 480) - (time.monotonic() - ctx.started)),
                            ),
                            "finalize_next": closing,
                        },
                    }
                    ctx.emit(
                        "tool_completed",
                        {
                            "tool": call.name,
                            "purpose": purpose,
                            "evidence_ids": result.get("evidence_ids", []),
                            "target": result.get("span", {}),
                            "duration_ms": round((time.monotonic() - started) * 1000),
                            "ok": True,
                        },
                    )
                except (GrooveError, ValidationError) as exc:
                    if isinstance(exc, GrooveError) and (
                        exc.code == "BUDGET_EXCEEDED" or ctx.final_errors > 2
                    ):
                        raise
                    message = (
                        exc.message
                        if isinstance(exc, GrooveError)
                        else json.dumps([{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:10]])
                    )
                    code = exc.code if isinstance(exc, GrooveError) else "INVALID_ARGUMENTS"
                    tool_response = {"ok": False, "error": {"code": code, "message": message}}
                    ctx.emit(
                        "tool_failed",
                        {"tool": call.name, "code": code, "purpose": purpose, "validation": message[:1600]},
                    )
                response_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            id=call.id, name=call.name, response=tool_response
                        )
                    )
                )
            history.append(types.Content(role="user", parts=response_parts))
    finally:
        await client.aio.aclose()
