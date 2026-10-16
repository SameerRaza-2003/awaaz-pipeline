.PHONY: install dev dev-phone backend frontend frontend-https test lint e2e eval eval-quick matching-eval seed demo-reset

install:
	cd backend && uv sync
	cd frontend && npm install

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npx next dev -H 0.0.0.0

dev:
	$(MAKE) -j2 backend frontend

# Same, but HTTPS with a self-signed certificate: phones only share GPS location over HTTPS.
# Open https://<this computer's IP>:3000 on the phone and accept the certificate warning once.
dev-phone:
	$(MAKE) -j2 backend frontend-https

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
