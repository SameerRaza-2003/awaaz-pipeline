.PHONY: install dev backend frontend test lint e2e eval eval-quick matching-eval seed demo-reset

install:
	cd backend && uv sync
	cd frontend && npm install

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	$(MAKE) -j2 backend frontend

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
