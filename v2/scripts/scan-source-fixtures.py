"""Scan serialized source text without executing analyzed repository code."""

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md", ".yaml", ".yml"}


def source_entries(value):
    if isinstance(value, dict):
        for name, content in value.items():
            if isinstance(content, str) and Path(name).suffix in SOURCE_EXTENSIONS:
                yield name, content
            else:
                yield from source_entries(content)
    elif isinstance(value, list):
        for content in value:
            yield from source_entries(content)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scanner", default="gitleaks")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="code-groove-source-scan-") as directory:
        destination = Path(directory)
        count = 0
        for bundle in (ROOT / "fixtures").rglob("*.json"):
            for name, content in source_entries(json.loads(bundle.read_text(encoding="utf-8"))):
                digest = hashlib.sha256(content.encode()).hexdigest()
                (destination / f"{digest}{Path(name).suffix}").write_text(content, encoding="utf-8")
                count += 1
        result = subprocess.run(
            [args.scanner, "dir", str(destination), "--config", str(ROOT / ".gitleaks.toml"),
             "--redact", "--no-banner"],
            check=False,
        )
        print(f"Scanned {count} embedded source entries; target code was not executed.")
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
