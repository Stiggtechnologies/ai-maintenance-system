# scripts/

Operational and CI scripts. Entries below only where a script needs context
that does not fit in its own header.

## eval-models.mjs — model evaluation harness (Grok vs gpt-5.6-terra)

Runs the product's real prompt shapes (copilot chat, FMEA/RCA deliverables,
typed classify/assess tasks, loop enrichment, public assessment) against every
OpenAI-compatible provider configured in `EVAL_PROVIDERS`, and writes token,
latency, and CAD-cost numbers plus a side-by-side markdown report to
`artifacts/model-eval/<date>/`. Quality judgement stays human.

A provider whose key env var is absent is skipped cleanly, so CI never makes
a live model call. No key, no spend, no exception.

```sh
OPENAI_API_KEY=… XAI_API_KEY=… node scripts/eval-models.mjs
```

### Verified model IDs and rates (vendor pages, never a registry)

Retrieved **2026-08-19**:

| Model           | Vendor price (USD/1M in/out)   | Source                                         |
| --------------- | ------------------------------ | ---------------------------------------------- |
| `gpt-5.6-terra` | 2.00 / 12.00                   | https://developers.openai.com/api/docs/pricing |
| `gpt-5.6-luna`  | 0.20 / 1.20                    | https://developers.openai.com/api/docs/pricing |
| `gpt-4o-mini`   | 0.15 / 0.60                    | https://developers.openai.com/api/docs/pricing |
| `grok-4.6`      | 2.00 / 6.00 (<200k-token tier) | https://docs.x.ai/docs/models                  |
| `grok-4.3`      | 1.25 / 2.50 (<200k-token tier) | https://docs.x.ai/docs/models                  |

xAI's current text-model line-up on that date: `grok-4.6`, `grok-4.5`,
`grok-4.3`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`,
`grok-build-0.1`, `grok-4.20-multi-agent-0309`. The harness defaults to
`grok-4.6` (flagship). xAI's API is OpenAI-compatible at
`https://api.x.ai/v1`.

CAD conversion uses USD/CAD **1.3889** — Bank of Canada daily average for
2026-08-18 (https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json).
The same rates are seeded in `private.llm_prices`
(`supabase/migrations/20260916000000_llm_cost_guardrails.sql`); if you
re-verify prices, update both places and the retrieval dates.
