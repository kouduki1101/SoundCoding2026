import json
import subprocess
import sys

from code_groove.errors import GrooveError
from code_groove.schemas import CallRelationships, Span
from code_groove.settings import ROOT
from code_groove.source import run_node


def relationship_data(snapshot: dict, semantic: dict, unit_id: str) -> dict:
    unit = next((unit for unit in semantic["units"] if unit["unit_id"] == unit_id), None)
    if not unit:
        raise GrooveError("INVALID_SELECTION", "保存された実装を選んでください。")
    unit_span = Span.model_validate(unit["primary_span"])
    payload = {
        "snapshot_id": snapshot["snapshot_id"],
        "sources": snapshot["sources"],
        "unit_span": unit_span.model_dump(),
        "operation": "relationships",
    }
    try:
        if unit_span.path.endswith(".py"):
            parsed = subprocess.run(
                [sys.executable, "-I", str(ROOT / "apps/backend/code_groove/python_indexer.py")],
                input=json.dumps(payload, ensure_ascii=False),
                text=True,
                encoding="utf-8",
                capture_output=True,
                timeout=5,
                check=False,
            )
            if parsed.returncode or len(parsed.stdout.encode()) > 4 * 1024 * 1024:
                raise GrooveError("SOURCE_PARSE_FAILED", "静的な関係を抽出できませんでした。")
            result = json.loads(parsed.stdout)
        elif unit_span.path.endswith((".ts", ".tsx")):
            result = run_node("structure", payload)
        else:
            return CallRelationships(
                snapshot_id=snapshot["snapshot_id"],
                unit_span=unit_span,
                status="unsupported",
                links=[],
                truncated=False,
                limitations=["この言語の関係抽出は未対応です。元コードで確認してください。"],
            ).model_dump()
        return CallRelationships.model_validate(result).model_dump()
    except (subprocess.TimeoutExpired, ValueError) as exc:
        raise GrooveError(
            "SOURCE_PARSE_FAILED", "静的な関係の抽出上限を超えました。元コードで確認してください。"
        ) from exc
