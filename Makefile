.PHONY: install dev dev-http dev-phone backend frontend frontend-https test lint e2e eval eval-quick matching-eval seed demo-reset

install:
	cd backend && uv sync
	cd frontend && npm install

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npx next dev -H 0.0.0.0

# HTTPS with a self-signed certificate, reachable from phones on the same Wi-Fi:
# phones only share GPS location with https pages. Open https://<this computer's IP>:3000
# (or https://localhost:3000) and accept the certificate warning once.
dev:
	$(MAKE) -j2 backend frontend-https

dev-phone: dev

# Plain http (location will not work on phones).
dev-http:
	$(MAKE) -j2 backend frontend

frontend-https:
	cd frontend && npx next dev --experimental-https -H 0.0.0.0

test:
	cd backend && uv run pytest -q

lint:
	cd frontend && npx tsc --noEmit && npx eslint .

e2e:
	cd backend && uv run python ../scripts/e2e.py

eval:
	cd backend && uv run python ../evals/run_model_eval.py --models $(MODELS)

eval-quick:
	cd backend && uv run python ../evals/run_model_eval.py --quick --models $(MODELS)

matching-eval:
	cd backend && uv run python ../evals/matching_eval.py

seed:
	cd backend && uv run python -m app.seed

demo-reset:
	cd backend && uv run python -m app.demo
