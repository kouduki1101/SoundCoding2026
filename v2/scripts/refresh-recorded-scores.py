import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/backend"))
from code_groove.source import run_node  # noqa: E402


def preserve_order(value, previous):
    if isinstance(value, dict) and isinstance(previous, dict):
        keys = [key for key in previous if key in value] + [key for key in value if key not in previous]
        return {key: preserve_order(value[key], previous.get(key)) for key in keys}
    if isinstance(value, list) and isinstance(previous, list):
        return [
            preserve_order(item, previous[index] if index < len(previous) else None)
            for index, item in enumerate(value)
        ]
    return value


parser = argparse.ArgumentParser()
parser.add_argument("--include-fixtures", action="store_true")
args = parser.parse_args()
kit = json.loads((ROOT / "apps/web/public/audio/midnight-jazz-v4/manifest.json").read_text())
paths = sorted((ROOT / "fixtures/recorded-live").glob("*.json"))
if args.include_fixtures:
    paths += sorted((ROOT / "fixtures").glob("*.json"))
for path in paths:
    bundle = json.loads(path.read_text(encoding="utf-8"))
    bundle["score"] = preserve_order(
        run_node("groove-core", {"map": bundle["map"], "kit_hash": kit["kit_hash"]}), bundle["score"]
    )
    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{path.stem}: musical score upgraded; Agent interpretation and trace preserved")
