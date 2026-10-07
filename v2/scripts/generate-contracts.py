import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/backend"))
from code_groove.schemas import (  # noqa: E402
    CallRelationships,
    ComparisonExport,
    ComparisonInvestigationRequest,
    ComparisonInvestigationResult,
    ImprovementProposal,
    InvestigationResult,
    ScoreBundle,
    SemanticMap,
    StructureComparison,
    StructurePlaybackPlan,
)

parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
for model in (
    CallRelationships,
    SemanticMap,
    ScoreBundle,
    InvestigationResult,
    ImprovementProposal,
    StructureComparison,
    StructurePlaybackPlan,
    ComparisonInvestigationRequest,
    ComparisonInvestigationResult,
    ComparisonExport,
):
    content = json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2) + "\n"
    path = ROOT / "contracts" / f"{model.__name__}.schema.json"
    if args.check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            raise SystemExit(f"Outdated schema: {path.name}")
    else:
        path.write_text(content, encoding="utf-8")
print("Contracts verified" if args.check else "Contracts generated")
