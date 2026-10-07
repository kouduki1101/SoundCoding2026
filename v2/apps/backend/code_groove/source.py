import asyncio
import hashlib
import io
import ipaddress
import json
import re
import shutil
import socket
import subprocess
import sys
import tarfile
from pathlib import PurePosixPath
from urllib.parse import quote, urlparse

import httpx

from code_groove.errors import GrooveError
from code_groove.settings import ROOT

SAMPLE_IDS = (
    "cohesive",
    "scattered",
    "mixed",
    "justified",
    "orchestrator",
    "returns-before",
    "returns-after",
    "checkout-flow",
)
EXCLUDED = {
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
}
SECRET = re.compile(
    r"(?i)((?:api[_-]?key|password|secret|access[_-]?token)[\"']?\s*[:=]\s*)([\"'])(?:\\.|(?!\2)[^\\\r\n])*\2"
)


def sanitize(source: str) -> str:
    source = re.sub(
        r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
        lambda m: "[REDACTED]" + "\n" * m.group().count("\n"),
        source,
        flags=re.S,
    )
    source = SECRET.sub(lambda m: m.group(1) + m.group(2) + "[REDACTED]" + m.group(2), source)
    return re.sub(r"(?:AIza[\w-]{35}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})", "[REDACTED]", source)


def parse_github_url(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    if "/pull/" in parsed.path:
        raise GrooveError("PR_NOT_SUPPORTED", "PRではなくリポジトリのURLを入力してください。")
    if parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.query or parsed.fragment:
        raise GrooveError(
            "INVALID_SOURCE_URL", "https://github.com/owner/repository の形式で入力してください。"
        )
    match = re.fullmatch(r"/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})/?", parsed.path)
    if not match:
        raise GrooveError("INVALID_SOURCE_URL", "リポジトリのURLが正しくありません。")
    owner, repo = match.groups()
    repo = repo.removesuffix(".git")
    if owner in (".", "..") or repo in (".", "..", ""):
        raise GrooveError("INVALID_SOURCE_URL", "リポジトリのURLが正しくありません。")
    return owner, repo


def parse_github_pull_url(url: str) -> tuple[str, str, int]:
    if any(ord(char) <= 32 or ord(char) == 127 for char in url):
        raise GrooveError("INVALID_SOURCE_URL", "公開GitHub PRのURLを指定してください。")
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "github.com"
        or parsed.params
        or "?" in url
        or "#" in url
    ):
        raise GrooveError("INVALID_SOURCE_URL", "公開GitHub PRのURLを指定してください。")
    match = re.fullmatch(
        r"/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})/pull/([1-9][0-9]{0,9})/?",
        parsed.path,
    )
    if not match:
        raise GrooveError("INVALID_SOURCE_URL", "公開GitHub PRのURLを指定してください。")
    owner, repo, number = match.groups()
    if owner in (".", "..") or repo in (".", ".."):
        raise GrooveError("INVALID_SOURCE_URL", "公開GitHub PRのURLを指定してください。")
    return owner, repo, int(number)


async def resolve_github_pull(url: str) -> dict[str, str | int]:
    owner, repo, number = parse_github_pull_url(url)
    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=False,
        trust_env=False,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "CodeGroove/1.0"},
    ) as client:
        try:
            response = await client.get(f"https://api.github.com/repos/{owner}/{repo}/pulls/{number}")
        except httpx.HTTPError as exc:
            raise GrooveError("SOURCE_UNAVAILABLE", "GitHubのPR情報を取得できませんでした。", 502, True) from exc
    if response.status_code in (403, 429):
        raise GrooveError("SOURCE_RATE_LIMITED", "GitHubの取得制限です。しばらく待って再試行してください。", 429, True)
    if response.status_code >= 500:
        raise GrooveError("SOURCE_UNAVAILABLE", "GitHubのPR情報を取得できませんでした。", 502, True)
    if response.status_code != 200:
        raise GrooveError("NOT_FOUND", "公開GitHub PRを取得できませんでした。", 404)
    try:
        pull = response.json()
        base = pull["base"]
        head = pull["head"]
        base_sha, head_sha = base["sha"], head["sha"]
        base_repo, head_repo = base["repo"], head["repo"]
        if not all(isinstance(sha, str) and re.fullmatch(r"[a-f0-9]{40}", sha) for sha in (base_sha, head_sha)):
            raise ValueError("Invalid PR revisions or repository visibility")
        names = []
        for candidate in (base_repo, head_repo):
            full_name = candidate["full_name"]
            match = re.fullmatch(r"([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})", full_name)
            if (
                candidate["private"] is not False
                or not match
                or match.group(1) in (".", "..")
                or match.group(2) in (".", "..")
            ):
                raise ValueError("Invalid PR repository")
            names.append(match.groups())
        (base_owner, base_name), (head_owner, head_name) = names
        if (base_owner.lower(), base_name.lower()) != (owner.lower(), repo.lower()):
            raise ValueError("PR base repository does not match URL")
    except (KeyError, TypeError, ValueError, GrooveError) as exc:
        raise GrooveError("SOURCE_INVALID", "PRの固定コード版を検証できませんでした。", 502) from exc
    return {
        "repository_url": f"https://github.com/{base_owner}/{base_name}",
        "pull_number": number,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "base_repository_url": f"https://github.com/{base_owner}/{base_name}",
        "head_repository_url": f"https://github.com/{head_owner}/{head_name}",
    }


def validate_scope(value: str | None) -> str | None:
    if not value:
        return None
    path = value.rstrip("/")
    if (
        not path
        or path.startswith("/")
        or any(part in ("", ".", "..") for part in path.split("/"))
        or any(char in path for char in ("\\", ":", "\0"))
        or any(ord(char) < 32 for char in path)
        or len(path) > 200
    ):
        raise GrooveError("INVALID_SOURCE_URL", "対象フォルダーは安全な相対パスで指定してください。")
    return path


def safe_archive(data: bytes, scope_path: str | None = None) -> dict[str, str]:
    scope_path = validate_scope(scope_path)
    if len(data) > 10 * 1024 * 1024:
        raise GrooveError("SOURCE_TOO_LARGE", "圧縮リポジトリは10 MiB以内にしてください。")
    sources: dict[str, str] = {}
    paths: set[str] = set()
    total, count = 0, 0
    root = None
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for entry in archive:
                name = entry.name
                parts = PurePosixPath(name).parts
                if (
                    not parts
                    or name.startswith("/")
                    or ".." in parts
                    or "\\" in name
                    or ":" in name
                    or "\0" in name
                    or len(name) > 300
                ):
                    raise GrooveError("UNSAFE_ARCHIVE", "安全でないアーカイブ形式です。")
                root = root or parts[0]
                if parts[0] != root or not (entry.isdir() or entry.isfile()):
                    raise GrooveError("UNSAFE_ARCHIVE", "リンクや特殊ファイルは解析できません。")
                if entry.isdir():
                    continue
                path = "/".join(parts[1:])
                if not path or path in paths:
                    raise GrooveError("UNSAFE_ARCHIVE", "重複パスを含むアーカイブです。")
                paths.add(path)
                total += entry.size
                count += 1
                if entry.size < 0 or total > 40 * 1024 * 1024 or count > 1000:
                    raise GrooveError("SOURCE_TOO_LARGE", "展開サイズまたはファイル数の上限を超えています。")
                if any(p in EXCLUDED or p.startswith(".env") for p in parts) or not path.endswith(
                    (".ts", ".tsx", ".py", ".md", ".json", ".toml")
                ):
                    continue
                if (
                    path.endswith((".d.ts", ".min.ts", "lock.json"))
                    or "credential" in path.lower()
                    or "private" in path.lower()
                ):
                    continue
                if (
                    scope_path
                    and not path.startswith(scope_path + "/")
                    and path not in ("README.md", "package.json", "tsconfig.json", "pyproject.toml")
                ):
                    continue
                if entry.size > 200 * 1024:
                    raise GrooveError("SCOPE_TOO_LARGE", "単一の対象ファイルを200 KiB以内にしてください。")
                stream = archive.extractfile(entry)
                if stream is None:
                    raise GrooveError("UNSAFE_ARCHIVE", "アーカイブを読み込めません。")
                raw = stream.read(200 * 1024 + 1)
                if len(raw) > 200 * 1024:
                    raise GrooveError("SOURCE_TOO_LARGE", "ファイル上限を超えています。")
                try:
                    sources[path] = sanitize(raw.decode("utf-8"))
                except UnicodeDecodeError:
                    continue
    except (tarfile.TarError, EOFError, OSError) as exc:
        raise GrooveError("UNSAFE_ARCHIVE", "アーカイブが破損しています。") from exc
    if scope_path and not any(path.startswith(scope_path + "/") for path in sources):
        raise GrooveError("NOT_FOUND", "対象フォルダーに対応コードがありません。", 404)
    return sources


async def github_snapshot(
    url: str, ref: str | None, scope_path: str | None = None
) -> tuple[str, dict[str, str]]:
    owner, repo = parse_github_url(url)
    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=False,
        trust_env=False,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "CodeGroove/1.0"},
    ) as client:

        async def get_json(path):
            response = await client.get(f"https://api.github.com/repos/{owner}/{repo}{path}")
            if response.status_code == 403 or response.status_code == 429:
                raise GrooveError(
                    "SOURCE_RATE_LIMITED",
                    "GitHubの取得制限です。しばらく待って再試行してください。",
                    429,
                    True,
                )
            if response.status_code != 200:
                raise GrooveError("NOT_FOUND", "公開リポジトリを取得できませんでした。", 404)
            return response.json()

        metadata = await get_json("")
        if metadata.get("private"):
            raise GrooveError("INVALID_SOURCE_URL", "公開リポジトリのみ利用できます。")
        revision = ref or metadata["default_branch"]
        if len(revision) > 100:
            raise GrooveError("INVALID_SOURCE_URL", "refが長すぎます。")
        commit = await get_json(f"/commits/{quote(revision, safe='')}")
        sha = commit["sha"]
        if not re.fullmatch(r"[a-f0-9]{40}", sha):
            raise GrooveError("INVALID_SOURCE_URL", "commitを固定できませんでした。")
        archive_url = f"https://codeload.github.com/{owner}/{repo}/tar.gz/{sha}"
        for _ in range(3):
            parsed = urlparse(archive_url)
            if parsed.scheme != "https" or parsed.netloc not in ("api.github.com", "codeload.github.com"):
                raise GrooveError("UNSAFE_ARCHIVE", "許可されていない取得先です。")
            addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, 443)
            if any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
                raise GrooveError("UNSAFE_ARCHIVE", "取得先のIPを検証できません。")
            async with client.stream("GET", archive_url) as response:
                if response.is_redirect:
                    archive_url = response.headers["location"]
                    continue
                if response.status_code != 200:
                    raise GrooveError("NOT_FOUND", "固定スナップショットの取得に失敗しました。", 404)
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > 10 * 1024 * 1024:
                        raise GrooveError("SOURCE_TOO_LARGE", "圧縮リポジトリの上限は10 MiBです。")
                    chunks.append(chunk)
                return sha, safe_archive(b"".join(chunks), scope_path)
    raise GrooveError("UNSAFE_ARCHIVE", "redirect回数の上限を超えました。")


def run_node(name: str, payload: dict) -> dict:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Trusted Node runtime missing")
    result = subprocess.run(
        [node, "--max-old-space-size=128", str(ROOT / f"dist/tools/{name}.mjs")],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=5,
        check=False,
    )
    if result.returncode or len(result.stdout.encode()) > 4 * 1024 * 1024:
        raise GrooveError("INVALID_ANALYSIS", "索引または譜面を検証できませんでした。")
    return json.loads(result.stdout)


def build_index(snapshot_id: str, sources: dict[str, str], *, repository: bool = False) -> dict:
    eligible = {
        path: content
        for path, content in sources.items()
        if path.endswith((".ts", ".tsx", ".py"))
        and not re.search(r"\.(test|spec)\.tsx?$|(^|/)test_[^/]+\.py$|(^|/)tests?/", path)
    }
    if (
        len(eligible) > (400 if repository else 40)
        or sum(len(v.splitlines()) for v in eligible.values()) > (60000 if repository else 6000)
        or sum(len(v.encode()) for v in sources.values()) > (4 * 1024 * 1024 if repository else 1024 * 1024)
    ):
        raise GrooveError(
            "SCOPE_TOO_LARGE", "静的索引の上限を超えています。対象フォルダーを指定してください。"
        )
    index = run_node("repo-indexer", {"snapshot_id": snapshot_id, "sources": sources})
    if any(path.endswith(".py") for path in sources):
        try:
            parsed = subprocess.run(
                [sys.executable, "-I", str(ROOT / "apps/backend/code_groove/python_indexer.py")],
                input=json.dumps({"snapshot_id": snapshot_id, "sources": sources}, ensure_ascii=False),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=5,
                check=False,
            )
            if parsed.returncode or len(parsed.stdout) > 4 * 1024 * 1024:
                raise GrooveError("SOURCE_PARSE_FAILED", "Pythonの静的解析上限を超えました。")
            python_index = json.loads(parsed.stdout)
        except subprocess.TimeoutExpired as exc:
            raise GrooveError("SOURCE_PARSE_FAILED", "Pythonの静的解析がタイムアウトしました。") from exc
        index["files"] = [f for f in index["files"] if not f["path"].endswith(".py")] + python_index["files"]
        index["units"].extend(python_index["units"])
        index["relations"].extend(python_index["relations"])
    for file in index["files"]:
        file["lines"] = len(sources[file["path"]].splitlines())
    if len(index["units"]) > (4096 if repository else 32):
        raise GrooveError(
            "SCOPE_TOO_LARGE", f"静的索引の実装単位が{4096 if repository else 32}を超えています。"
        )
    if any(f["parse_errors"] for f in index["files"] if f["is_source"]):
        raise GrooveError("SOURCE_PARSE_FAILED", "TypeScript / Pythonの構文を確認してください。")
    return index


def sample_snapshot(sample_id: str) -> tuple[str, dict[str, str]]:
    if sample_id not in SAMPLE_IDS:
        raise GrooveError("NOT_FOUND", "サンプルが見つかりません。", 404)
    directory = ROOT / "fixtures/repos" / sample_id
    sources = {
        str(path.relative_to(directory)).replace("\\", "/"): sanitize(path.read_text(encoding="utf-8"))
        for path in directory.rglob("*")
        if path.is_file()
    }
    sha = hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()
    return sha, sources
