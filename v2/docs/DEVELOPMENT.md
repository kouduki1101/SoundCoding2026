# 開発手順

Node.js 24、pnpm 10.27.0、Python 3.13、uvを使います。Web依存は`pnpm-lock.yaml`、Python依存は`uv.lock`に固定しています。

## 準備

リポジトリのルートで実行します。`.env`がすでにある場合はコピーを省略してください。

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
uv sync --locked
pnpm build:tools
pnpm exec playwright install chromium
```

通常の開発では模擬Agentとローカル保存を使います。有料モデルの接続設定は必要ありません。

## 起動

端末1でAPIとローカルworkerを起動します。

```powershell
$env:PYTHONPATH='apps/backend'
$env:ENVIRONMENT='local'
$env:APP_ROLE='web'
$env:MODEL_MODE='fixture'
$env:STORE_MODE='local'
$env:ENABLE_LIVE_ANALYSIS='false'
uv run python scripts/dev.py
```

端末2でWebを起動します。

```powershell
pnpm dev:web
```

[http://127.0.0.1:5173](http://127.0.0.1:5173)を開きます。APIは8080、Webは5173を使います。終了するときは両端末でCtrl+Cを押します。

## テスト

```powershell
pnpm test:changed --all
```

| 対象 | コマンド |
|---|---|
| TypeScriptの型 | `pnpm typecheck` |
| Web・共通モジュールのlint | `pnpm lint` |
| 音・静的索引 | `pnpm test` |
| Pythonのlint | `uv run ruff check apps/backend scripts tests infra` |
| Pythonの型 | `uv run mypy apps/backend` |
| Backend | `uv run pytest -m "not live"` |
| ブラウザE2E | `pnpm test:e2e` |

通常のテストは模擬データを使います。有料モデルのテストは別途明示的に実行します。

## 契約の生成

通信契約は`apps/backend/code_groove/schemas.py`で定義します。JSON SchemaとTypeScript型は次のコマンドで生成します。

```powershell
uv run python scripts/generate-contracts.py
node scripts/generate-types.mjs
uv run python scripts/generate-contracts.py --check
```

ローカルの実行データと認証情報はGit管理外です。解析対象のリポジトリは静的に読み取り、実行しません。
