import argparse
import io
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples/checkout-lab"
FILES = [
    "package.json",
    "package-lock.json",
    "runner.mjs",
    "server.ts",
    "app.ts",
    "index.html",
    "style.css",
    "README.md",
    "tsconfig.json",
]


def archive() -> bytes:
    files = {name: (EXAMPLE / name).read_text(encoding="utf-8").encode() for name in FILES}
    config = json.loads(files["tsconfig.json"])
    config["compilerOptions"]["paths"]["@checkout/*"] = ["./src/*"]
    files["tsconfig.json"] = (json.dumps(config, indent=2) + "\n").encode()
    core = ROOT / "fixtures/repos/checkout-flow"
    files["ANALYZED_README.md"] = (core / "README.md").read_text(encoding="utf-8").encode()
    files.update(
        {
            f"src/{path.name}": path.read_text(encoding="utf-8").encode()
            for path in sorted((core / "src").glob("*.ts"))
        }
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(f"checkout-lab/{name}", (2026, 10, 3, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, content)
    return output.getvalue()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    destination = ROOT / "apps/web/public/samples/checkout-lab.zip"
    expected = archive()
    if args.check:
        if not destination.exists():
            raise SystemExit("Runnable sample download is stale; run scripts/build-sample.py")
        with zipfile.ZipFile(io.BytesIO(expected)) as generated, zipfile.ZipFile(destination) as saved:
            if saved.namelist() != generated.namelist() or any(
                saved.read(name) != generated.read(name) for name in generated.namelist()
            ):
                raise SystemExit("Runnable sample download is stale; run scripts/build-sample.py")
        print("Runnable sample archive matches the source and unchanged examined core")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(expected)
        print(f"Runnable sample: {len(expected)} bytes")
