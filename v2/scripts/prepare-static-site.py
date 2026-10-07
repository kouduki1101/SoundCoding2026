"""Prepare an isolated Sites source checkout from the reviewed Git worktree.

Copies tracked and unignored new files plus the validated static build. The
destination must be a new sibling directory, so private local records and
runtime files never enter the hosting source repository.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: prepare-static-site.py <new sibling directory>")
    destination = Path(sys.argv[1]).resolve()
    if destination.parent != SOURCE.parent or destination.exists():
        raise SystemExit("Destination must be a new sibling directory of the project.")
    build = SOURCE / "out"
    if not (build / "index.html").is_file():
        raise SystemExit("Build the static Site before preparing its source checkout.")
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=SOURCE
    ).split(b"\0")
    destination.mkdir()
    for raw in paths:
        if not raw:
            continue
        relative = Path(os.fsdecode(raw))
        if relative.is_absolute() or ".." in relative.parts:
            raise SystemExit("Unsafe source path in Git file list.")
        origin = SOURCE / relative
        if not origin.is_file():
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, target)
    shutil.copytree(build, destination / "out")
    manifest = destination / ".openai" / "hosting.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text('{"static":{"directory":"out"}}\n', encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
