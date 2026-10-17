# One container: FastAPI on 127.0.0.1:8000 behind the Next.js server on $PORT (default 3000).

FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV NEXT_OUTPUT=standalone BACKEND_URL=http://127.0.0.1:8000 NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/backend
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/backend/.venv
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=web /app/frontend/.next/standalone /app/web
COPY --from=web /app/frontend/.next/static /app/web/.next/static
COPY --from=web /app/frontend/public /app/web/public
COPY start.sh /app/start.sh
ENV DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production
RUN mkdir -p /data && chmod +x /app/start.sh
EXPOSE 3000
CMD ["/app/start.sh"]
