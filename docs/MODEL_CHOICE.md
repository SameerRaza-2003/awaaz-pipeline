# Model choice

The goal is the cheapest OpenRouter model that passes the project's own quality bar:
(a) tool-call correctness on all agents, (b) zero PII leaks on 30 synthetic cases in English, Roman Urdu and Urdu,
(c) intake quality on 10 scripted dialogues. Latency and cost per pipeline run are recorded too.

## Shortlist (OpenRouter prices, October 2026)

Filtered on `tools` + `structured_outputs` support, interactive (non-batch) endpoints from major providers, sorted by price.
Refresh with `make eval MODELS=... ` after running `uv run python ../evals/run_model_eval.py --list` from `backend/`.

| Model | Input $/M | Output $/M | Notes |
|---|---|---|---|
| `deepseek/deepseek-v4-flash` | 0.091 | 0.182 | cheapest of the shortlist, 1M context |
| `openai/gpt-5-nano` | 0.05 | 0.40 | |
| `google/gemini-2.5-flash-lite` | 0.10 | 0.40 | strong multilingual |
| `anthropic/claude-haiku-5.5` | 0.10 | 0.50 | candidate for `MODEL_DRAFTING` if PII fails |

Embeddings: `baai/bge-m3` (small, multilingual) through OpenRouter. Offline fallbacks: `fastembed`
(`uv sync --extra local-embeddings`) and a dependency-free hashing embedder that only matches words.

## Current setting

`MODEL_DEFAULT=deepseek/deepseek-v4-flash` is the provisional default because it is the cheapest candidate.
**The eval has not been run against live models yet** (it needs an `OPENROUTER_API_KEY`). Until it has, treat the default as
unverified.

To decide:

```bash
make eval MODELS=deepseek/deepseek-v4-flash,openai/gpt-5-nano,google/gemini-2.5-flash-lite,anthropic/claude-haiku-5.5
```

Pick the cheapest model with ✅ in all of (a)–(c) and set `MODEL_DEFAULT`. If only the PII column fails for the cheap models,
keep the cheap model as default and set `MODEL_DRAFTING` to the cheapest model that passes PII.
Per-model results are written to `evals/results/`. Paste the summary table here when done.

## Results

_Not run yet._
