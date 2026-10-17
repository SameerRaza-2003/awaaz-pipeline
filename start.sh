#!/bin/sh
# Backend stays private inside the container; the web server forwards /api to it.
cd /app/backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
cd /app/web && node server.js &
wait -n 2>/dev/null || wait
exit 1
