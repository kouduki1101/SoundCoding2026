import difflib
import hashlib
import json
import re

from code_groove.errors import GrooveError
from code_groove.schemas import Evidence, ImprovementCandidate


def source_hash(sources: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(sources, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def apply_edits(
    candidate: ImprovementCandidate, sources: dict[str, str], evidence: list[Evidence]
) -> dict[str, str]:
    proofs = {e.evidence_id: e for e in evidence}
    if not candidate.evidence_ids or any(e not in proofs for e in candidate.evidence_ids):
        raise GrooveError("INVALID_PROPOSAL", "改善案には実際に読み取った根拠が必要です。")
    result = dict(sources)
    if len({e.path for e in candidate.edits}) > 4:
        raise GrooveError("INVALID_PROPOSAL", "変更は4ファイルまでです。")
    for edit in candidate.edits:
        path = edit.path
        if (
            not re.fullmatch(r"(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.(?:ts|tsx|py)", path)
            or any(
                part.lower() in {"node_modules", "vendor", "dist", "build", "infra", "scripts", "tests"}
                for part in path.split("/")[:-1]
            )
            or path.split("/")[-1].startswith("test_")
        ):
            raise GrooveError("INVALID_PROPOSAL", "変更できるのは通常のソースファイルだけです。")
        if path not in result:
            parents = {
                p.rsplit("/", 1)[0] for p in sources if "/" in p and p.endswith((".ts", ".tsx", ".py"))
            }
            if edit.before or "/" not in path or path.rsplit("/", 1)[0] not in parents:
                raise GrooveError("INVALID_PROPOSAL", "新規ソースは既存ディレクトリ内に限ります。")
            result[path] = edit.after
            continue
        original = result[path]
        if not edit.before or original.count(edit.before) != 1 or edit.before == edit.after:
            raise GrooveError("INVALID_PROPOSAL", "変更元は一意に一致する必要があります。")
        # Validate every hunk against the immutable original, not a prior generated edit.
        if sources.get(path, "").count(edit.before) != 1:
            raise GrooveError("INVALID_PROPOSAL", "生成した変更への追加変更はできません。")
        start = sources[path][: sources[path].index(edit.before)].count("\n") + 1
        end = start + len(edit.before.splitlines()) - 1
        if not any(
            proof.span.path == path and proof.span.start_line <= start and proof.span.end_line >= end
            for proof_id, proof in proofs.items()
            if proof_id in candidate.evidence_ids
        ):
            raise GrooveError("INVALID_PROPOSAL", "変更範囲全体を読み取ってから提案してください。")
        result[path] = original.replace(edit.before, edit.after, 1)
    if sum(len(v.encode()) for v in result.values()) > 4 * 1024 * 1024 or any(
        len(v.encode()) > 200 * 1024 for v in result.values()
    ):
        raise GrooveError("INVALID_PROPOSAL", "変更後のソースが上限を超えています。")
    if len(proposal_diff(sources, result)) > 64000:
        raise GrooveError("INVALID_PROPOSAL", "差分が大きすぎます。変更範囲を縮小してください。")
    return result


def proposal_diff(sources: dict[str, str], changed: dict[str, str]) -> str:
    return "\n".join(
        "\n".join(
            difflib.unified_diff(
                sources.get(path, "").splitlines(),
                changed[path].splitlines(),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
                lineterm="",
            )
        )
        for path in sorted(changed)
        if sources.get(path) != changed[path]
    )
