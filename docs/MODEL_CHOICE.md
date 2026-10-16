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

`MODEL_DEFAULT=deepseek/deepseek-v4-flash`, chosen by the eval below: it is the cheapest candidate and passes every check,
so `MODEL_DRAFTING` stays empty (same model for everything).

To decide:

```bash
make eval MODELS=deepseek/deepseek-v4-flash,openai/gpt-5-nano,google/gemini-2.5-flash-lite,anthropic/claude-haiku-5.5
```

Pick the cheapest model with ✅ in all of (a)–(c) and set `MODEL_DEFAULT`. If only the PII column fails for the cheap models,
keep the cheap model as default and set `MODEL_DRAFTING` to the cheapest model that passes PII.
Per-model results are written to `evals/results/`. Paste the summary table here when done.

## Results (17 October 2026)

Full run: 9 agent tool-call checks, 30 PII cases (10 English, 10 Roman Urdu, 10 Urdu), 10 intake dialogues.

| Model | (a) tools | (b) PII | (c) intake | Cost per full pipeline | p50 agent latency | Pass |
|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | 9/9 | 30/30 | 10/10 | $0.0106 | 8.0 s | ✅ |

The whole eval cost $0.097. The other candidates were not needed, since the cheapest one passes; the run was
stopped during `gemini-2.5-flash-lite` at the 50-minute limit.

Notes:
- Slowest single agent run was 138 s (a run that hit the 45 s timeout and was retried). The emergency agents use shorter
  timeouts (20 s / 30 s) and fall back to the fixed template, so alerts are never held up by this.
- Two fixes came out of the first runs: the intake prompt now asks exactly one question per reply, and community matching
  uses `MATCH_THRESHOLD=0.50` plus `MATCH_MARGIN=0.05` (with bge-m3, unrelated communities scored up to 0.54).
