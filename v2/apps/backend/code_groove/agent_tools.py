import hashlib
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from google.genai import types
from pydantic import Field, ValidationError

from code_groove.errors import GrooveError
from code_groove.improvements import apply_edits
from code_groove.schemas import (
    AnalysisCandidate,
    ComparisonAnswerCandidate,
    Contract,
    Evidence,
    Hypothesis,
    ImprovementCandidate,
    InvestigationCandidate,
    Span,
)
from code_groove.settings import Settings
from code_groove.source import build_index
from code_groove.structure import validate_comparison_answer
from code_groove.validation import validate_candidate, validate_investigation


class PurposeArgs(Contract):
    purpose: str = Field(min_length=1, max_length=160)


class ListArgs(PurposeArgs):
    cursor: int = Field(default=0, ge=0, strict=True)
    limit: int = Field(default=50, ge=1, le=50, strict=True)


class UnitListArgs(ListArgs):
    scope: Literal["current", "repository"] = "current"
    path_prefix: str = Field(default="", max_length=240)
    label_query: str = Field(default="", max_length=80)


class ReadArgs(PurposeArgs):
    file_id: str
    start_line: int = Field(ge=1, strict=True)
    end_line: int = Field(ge=1, strict=True)


class SearchArgs(PurposeArgs):
    query: str = Field(min_length=1, max_length=120)
    path_prefix: str = Field(default="", max_length=240)
    limit: int = Field(default=20, ge=1, le=20, strict=True)
    cursor: int = Field(default=0, ge=0, strict=True)


class RelationsArgs(PurposeArgs):
    unit_id: str
    direction: str = Field(pattern=r"^(callers|callees|tests)$")
    cursor: int = Field(default=0, ge=0, strict=True)


class HypothesisArgs(Contract):
    statement: str = Field(max_length=160)
    counter_question: str = Field(max_length=160)
    evidence_ids: list[str] = Field(max_length=96)
    status: str = Field(pattern=r"^(open|supported|rejected|undetermined)$")


class ProgressArgs(Contract):
    message: str = Field(min_length=1, max_length=120)


@dataclass
class AgentContext:
    settings: Settings
    project_id: str
    snapshot_id: str
    sources: dict[str, str]
    index: dict
    emit: Callable[[str, dict], None]
    guard: Callable[[], None]
    save_usage: Callable[[dict], None]
    base: dict | None = None
    cached_interpretation: dict | None = None
    changes: dict | None = None
    selection: dict | None = None
    proposing: bool = False
    analysis_depth: Literal["overview", "focused"] = "overview"
    prior_motifs: list[dict] = field(default_factory=list)
    repository_index: dict | None = None
    integration_context: list[dict] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    hypotheses: list[Hypothesis] = field(default_factory=list)
    reads: Counter = field(default_factory=Counter)
    tool_count: int = 0
    model_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    final_errors: int = 0
    started: float = field(default_factory=time.monotonic)

    @property
    def investigating(self):
        return self.base is not None

    @property
    def comparing(self):
        return bool(self.selection and self.selection.get("comparison"))

    def check(self):
        self.guard()
        if time.monotonic() - self.started > (180 if self.investigating else 480):
            raise GrooveError("MODEL_TIMEOUT", "調査の制限時間を超えました。", 408)


TOOL_ARGS: dict[str, type[Contract]] = {
    "list_units": UnitListArgs,
    "list_repository_files": ListArgs,
    "read_code": ReadArgs,
    "search_code": SearchArgs,
    "inspect_relations": RelationsArgs,
    "record_hypothesis": HypothesisArgs,
    "update_progress": ProgressArgs,
}


def inline_schema(schema: dict) -> dict:
    definitions = schema.get("$defs", {})

    def walk(value):
        if isinstance(value, list):
            return [walk(v) for v in value]
        if not isinstance(value, dict):
            return value
        if "$ref" in value:
            return walk(definitions[value["$ref"].split("/")[-1]])
        return {
            k: {name: walk(item) for name, item in v.items()} if k == "properties" else walk(v)
            for k, v in value.items()
            if k not in ("$defs", "title", "additionalProperties", "default")
        }

    return walk(schema)


def declarations(
    investigating: bool, proposing: bool = False, comparing: bool = False
) -> list[types.FunctionDeclaration]:
    result = [
        types.FunctionDeclaration(
            name=name,
            description=f"Authorized read-only repository tool: {name}",
            parameters_json_schema=inline_schema(model.model_json_schema()),
        )
        for name, model in TOOL_ARGS.items()
    ]
    name = "submit_proposal" if proposing else "submit_investigation" if investigating else "submit_analysis"
    model = (
        ComparisonAnswerCandidate
        if comparing
        else ImprovementCandidate
        if proposing
        else InvestigationCandidate
        if investigating
        else AnalysisCandidate
    )
    result.append(
        types.FunctionDeclaration(
            name=name,
            description="Submit the grounded candidate, alone in a batch.",
            parameters_json_schema={
                "type": "object",
                "properties": {"candidate": inline_schema(model.model_json_schema())},
                "required": ["candidate"],
            },
        )
    )
    return result


def execute_tool(ctx: AgentContext, name: str, args: dict, event_id: str) -> Any:
    ctx.check()
    if ctx.tool_count >= (20 if ctx.investigating else 48):
        raise GrooveError("BUDGET_EXCEEDED", "ツール呼び出し上限に達しました。", 429)
    ctx.tool_count += 1
    ctx.save_usage(
        {
            "model_requests": ctx.model_count,
            "tool_calls": ctx.tool_count,
            "input_tokens": ctx.input_tokens,
            "output_tokens": ctx.output_tokens,
        }
    )
    if name in ("submit_analysis", "submit_investigation", "submit_proposal"):
        try:
            candidate: Any
            if set(args) != {"candidate"}:
                raise GrooveError("INVALID_ANALYSIS", "candidateだけを提出してください。")
            if name == "submit_proposal" and ctx.proposing:
                candidate = ImprovementCandidate.model_validate(args["candidate"])
                assert ctx.base is not None
                signals = {s["signal_id"] for s in ctx.base.get("review_signals", [])}
                if not candidate.signal_ids or any(s not in signals for s in candidate.signal_ids):
                    raise GrooveError("INVALID_PROPOSAL", "既存の診断に結び付く改善案が必要です。")
                changed = apply_edits(candidate, ctx.sources, ctx.evidence)
                proposed_index = build_index(
                    ctx.snapshot_id, changed, repository=ctx.repository_index is not None
                )
                if any(
                    not item["resolved"] and item["module"].startswith(".")
                    for file in proposed_index["files"]
                    for item in file.get("imports", [])
                ):
                    raise GrooveError("INVALID_PROPOSAL", "ローカル参照先のないimportは提案できません。")
                ctx.check()
            elif name == "submit_analysis" and not ctx.investigating:
                candidate = AnalysisCandidate.model_validate(args["candidate"])
                validate_candidate(candidate, ctx.index, ctx.evidence, ctx.repository_index)
                if {u.unit_id for u in candidate.units} != {u["unit_id"] for u in ctx.index["units"]}:
                    raise GrooveError("INVALID_ANALYSIS", "全unitを分類または未確認として含めてください。")
            elif name == "submit_investigation" and ctx.investigating and not ctx.proposing:
                if ctx.comparing:
                    candidate = ComparisonAnswerCandidate.model_validate(args["candidate"])
                    validate_comparison_answer(candidate, ctx.evidence, ctx)
                else:
                    candidate = InvestigationCandidate.model_validate(args["candidate"])  # type: ignore[assignment]
                    assert ctx.base is not None
                    validate_investigation(candidate, ctx.evidence, ctx.base, ctx.repository_index)  # type: ignore[arg-type]
            else:
                raise GrooveError("INVALID_ANALYSIS", "このrunでは利用できない提出ツールです。")
            if isinstance(candidate, (AnalysisCandidate, InvestigationCandidate)) and any(
                s.verdict == "concern" and s.review_axis == "coherence" and s.counter_status != "rejected"
                for s in candidate.review_signals
            ):
                raise GrooveError(
                    "INVALID_ANALYSIS", "反証の確認記録がない懸念は判断保留として提出してください。"
                )
            return candidate
        except (ValidationError, GrooveError):
            ctx.final_errors += 1
            if ctx.final_errors > 2:
                raise GrooveError("INVALID_ANALYSIS", "2回の修復で検証を通過できませんでした。") from None
            raise
    if name not in TOOL_ARGS:
        raise GrooveError("TOOL_NOT_ALLOWED", "許可されていないツールです。")
    parsed: Any = TOOL_ARGS[name].model_validate(args)
    source_index = ctx.repository_index or ctx.index
    files = {f["file_id"]: f for f in source_index["files"]}
    if isinstance(parsed, ListArgs):
        if name == "list_repository_files":
            rows = source_index["files"]
            return {
                "files": rows[parsed.cursor : parsed.cursor + parsed.limit],
                "truncated": len(rows) > parsed.cursor + parsed.limit,
                "next_cursor": parsed.cursor + parsed.limit
                if len(rows) > parsed.cursor + parsed.limit
                else None,
            }
        assert isinstance(parsed, UnitListArgs)
        unit_index = source_index if parsed.scope == "repository" else ctx.index
        rows = [
            u
            for u in unit_index["units"]
            if u["primary_span"]["path"].startswith(parsed.path_prefix)
            and parsed.label_query.casefold() in u["label"].casefold()
        ]
        page = rows[parsed.cursor : parsed.cursor + parsed.limit]
        current_ids = {u["unit_id"] for u in ctx.index["units"]}
        return {
            "units": [{**u, "in_current_partition": u["unit_id"] in current_ids} for u in page],
            "files": [
                f for f in unit_index["files"] if f["file_id"] in {u["primary_span"]["file_id"] for u in page}
            ],
            "scope": parsed.scope,
            "total_matches": len(rows),
            "truncated": len(rows) > parsed.cursor + parsed.limit,
            "next_cursor": parsed.cursor + parsed.limit if len(rows) > parsed.cursor + parsed.limit else None,
        }
    if isinstance(parsed, ReadArgs):
        file = files.get(parsed.file_id)
        if not file:
            raise GrooveError("NOT_FOUND", "索引に存在しないファイルです。", 404)
        lines = ctx.sources[file["path"]].splitlines()
        if (
            parsed.end_line < parsed.start_line
            or parsed.end_line > len(lines)
            or parsed.end_line - parsed.start_line >= 160
        ):
            raise GrooveError("INVALID_EVIDENCE", "有効な最大160行の範囲で読んでください。")
        key = (parsed.file_id, parsed.start_line, parsed.end_line)
        ctx.reads[key] += 1
        if ctx.reads[key] > 2:
            raise GrooveError("BUDGET_EXCEEDED", "同一範囲の読取は2回までです。", 429)
        source = "\n".join(lines[parsed.start_line - 1 : parsed.end_line])
        if len(source) > 12000:
            raise GrooveError("INVALID_EVIDENCE", "範囲を12,000文字以内に縮小してください。")
        evidence = Evidence(
            evidence_id=f"ev_{uuid.uuid4().hex}",
            snapshot_id=ctx.snapshot_id,
            span=Span(
                file_id=parsed.file_id,
                path=file["path"],
                start_line=parsed.start_line,
                end_line=parsed.end_line,
            ),
            projection_sha256=hashlib.sha256(source.encode()).hexdigest(),
            source_kind="test"
            if ".test." in file["path"]
            or ".spec." in file["path"]
            or "/tests/" in f"/{file['path']}"
            or file["path"].split("/")[-1].startswith("test_")
            else "code"
            if file["path"].endswith((".ts", ".tsx", ".py"))
            else "document",
            observation=parsed.purpose,
            created_by_tool_event_id=event_id,
        )
        ctx.evidence.append(evidence)
        return {
            "source": source,
            "span": evidence.span.model_dump(),
            "evidence_ids": [evidence.evidence_id],
            "untrusted_repository_data": True,
        }
    if isinstance(parsed, SearchArgs):
        matches = []
        for file in source_index["files"]:
            if not file["path"].startswith(parsed.path_prefix):
                continue
            for line, content in enumerate(ctx.sources[file["path"]].splitlines(), 1):
                if parsed.query in content:
                    matches.append(
                        {
                            "file_id": file["file_id"],
                            "path": file["path"],
                            "line": line,
                            "snippet": content[:240],
                        }
                    )
        return {
            "matches": matches[parsed.cursor : parsed.cursor + parsed.limit],
            "truncated": len(matches) > parsed.cursor + parsed.limit,
            "next_cursor": parsed.cursor + parsed.limit
            if len(matches) > parsed.cursor + parsed.limit
            else None,
        }
    if isinstance(parsed, RelationsArgs):
        unit = next((u for u in source_index["units"] if u["unit_id"] == parsed.unit_id), None)
        if not unit:
            raise GrooveError("NOT_FOUND", "unitが存在しません。", 404)
        if parsed.direction == "tests":
            candidates = [
                f
                for f in source_index["files"]
                if (
                    ".test." in f["path"]
                    or ".spec." in f["path"]
                    or f["path"].endswith(".py")
                    and ("tests/" in f["path"] or f["path"].split("/")[-1].startswith("test_"))
                )
                and unit["label"].split(".")[-1] in ctx.sources[f["path"]]
            ]
            return {
                "candidates": candidates[parsed.cursor : parsed.cursor + 20],
                "truncated": len(candidates) > parsed.cursor + 20,
                "next_cursor": parsed.cursor + 20 if len(candidates) > parsed.cursor + 20 else None,
                "resolved": False,
            }
        rows = [
            r
            for r in source_index["relations"]
            if r["caller" if parsed.direction == "callees" else "callee"] == parsed.unit_id
        ]
        page = rows[parsed.cursor : parsed.cursor + 20]
        neighbors = {r.get("callee") for r in page} | {r.get("caller") for r in page}
        return {
            "relations": page,
            "units": [u for u in source_index["units"] if u["unit_id"] in neighbors],
            "scope": "repository",
            "truncated": len(rows) > parsed.cursor + 20,
            "next_cursor": parsed.cursor + 20 if len(rows) > parsed.cursor + 20 else None,
        }
    if isinstance(parsed, HypothesisArgs):
        if any(e not in {p.evidence_id for p in ctx.evidence} for e in parsed.evidence_ids):
            raise GrooveError("INVALID_EVIDENCE", "仮説は読取済みの根拠を参照してください。")
        hypothesis = Hypothesis(hypothesis_id=f"hyp_{uuid.uuid4().hex}", **parsed.model_dump())
        ctx.hypotheses.append(hypothesis)
        ctx.emit("hypothesis_recorded", hypothesis.model_dump())
        return hypothesis.model_dump()
    ctx.emit("progress", {"message": parsed.message})
    return {"updated": True}
