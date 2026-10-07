FROM node:24-bookworm-slim AS webbuild
WORKDIR /app
RUN npm install -g pnpm@10.27.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages packages
COPY scripts/build-tools.mjs scripts/build-tools.mjs
COPY tsconfig.json ./
RUN pnpm build

FROM ghcr.io/astral-sh/uv:0.6.11 AS uvbin
FROM python:3.13-slim-bookworm AS runtime
COPY --from=uvbin /uv /usr/local/bin/uv
COPY --from=webbuild /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev && useradd --uid 10001 --create-home groove
COPY apps/backend apps/backend
COPY prompts prompts
COPY fixtures fixtures
COPY --from=webbuild /app/dist dist
COPY --from=webbuild /app/apps/web/public/audio apps/web/public/audio
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH="/app/apps/backend" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
USER groove
CMD ["python", "-m", "code_groove.serve"]
