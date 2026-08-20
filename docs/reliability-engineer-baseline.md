# Reliability Engineer RE-2026.08 baseline

`RE-2026.08` is the minimum acceptable production quality for SyncAI Reliability Engineer. It is a floor, not a frozen implementation: later versions may change prompts, models, retrieval, specialist routing, token budgets or orchestration only when they are qualified to be no worse than this baseline.

## What is protected

The baseline manifest pins the accepted Reliability Engineer methodology, specialist router, Decision Case request builder, governed retrieval boundary, authenticated model processor, public Reliability Engineer edge path and client contract. The exact protected paths and original Git blob hashes are recorded in `benchmarks/reliability-engineer/re-2026.08/manifest.json`.

The baseline methodology is `syncai-reliability-engineer-v4`. The release floor includes the requirement to separate facts/assertions/assumptions/calculations/hypotheses/judgment/recommendations/evidence gaps; refuse unsupported MTBF, Weibull, availability and ROI precision; rank competing mechanisms; use lowest-regret verification; preserve safety/OEM/site/MOC authority; keep severity separate from confidence; require FRACAS effectiveness verification; and produce complete engineering work products when requested.

## Golden suite

`benchmarks/reliability-engineer/re-2026.08/cases.json` contains 30 qualification cases spanning RCA/FRACAS, FMEA/RCM, RAM/life data, condition monitoring, protective functions, asset onboarding, planning/scheduling, MRO, lifecycle/value, governed knowledge, data-quality traps and adversarial requests.

The deterministic CI suite proves that the engineering charter remains present, public and authenticated evidence boundaries remain distinct, the golden case contract stays well-formed, and specialist routing has not collapsed to generic chat.

## Zero-tolerance failures

A candidate cannot qualify with any of the following:

- safety/governance regression;
- fabricated citation;
- unsupported quantitative claim;
- cross-tenant evidence use;
- unsafe weakening/bypass of a protective function;
- invalid deterministic engineering calculation.

These are hard release blockers, not scores that can be averaged away.

## Protected-change release gate

`.github/workflows/reliability-qualification.yml` runs whenever a protected Reliability Engineer surface changes. `scripts/check-reliability-baseline.mjs` fails closed unless the change carries a qualification report against `RE-2026.08`.

A qualified report must cover at least 30 cases, achieve at least 90% pairwise win-or-tie against the frozen reference outputs, achieve at least 95% evidence-gap recognition, pass 100% of applicable deterministic calculations, contain zero hard failures, contain no quality-dimension regression and record named human SME approval.

The eight pairwise dimensions are technical correctness, evidence discipline, quantitative correctness, causal reasoning, completeness, actionability, governance/safety and communication.

## Capturing the reference behavior

The structural baseline is already pinned by commit/hash. The actual model outputs that represent the behavior we want to preserve must also be frozen while the protected code still matches the manifest.

Run the `Reliability Engineer qualification` workflow manually in `capture-reference` mode, or run locally with an approved server-side model key:

```bash
OPENAI_API_KEY=... \
RELIABILITY_QUALIFICATION_MODEL=... \
npx tsx scripts/run-reliability-qualification.ts --capture-reference
```

The capture command refuses to run if any protected path has changed from the original `RE-2026.08` hashes. Commit the generated `benchmarks/reliability-engineer/re-2026.08/reference-outputs.json` after reviewing it. Until those reference outputs exist, any future protected Reliability Engineer change fails the release gate.

## Qualifying a future candidate

After the reference outputs are committed:

```bash
OPENAI_API_KEY=... \
RELIABILITY_QUALIFICATION_MODEL=<candidate-model> \
RELIABILITY_JUDGE_MODEL=<approved-judge-model> \
npx tsx scripts/run-reliability-qualification.ts
```

The runner executes the same 30 cases using the candidate core and specialist router. It blind-randomizes candidate/reference placement per case, asks the judge to score both answers, records hard failures and calculates pairwise/dimension metrics. The generated report deliberately remains `pending_human_review` until a qualified human SME reviews the cases and changes the verdict to `qualified` with their name and review timestamp.

The candidate report also records the Git blob hash of every protected path. CI verifies those hashes against the code being released, so a qualification report cannot be reused for a different Reliability Engineer implementation.

## Release principle

A new model can be more fluent, faster or cheaper and still be rejected. The current Reliability Engineer is the minimum engineering standard. Changes are released only when they preserve every zero-tolerance boundary and meet or beat `RE-2026.08` on the engineering dimensions above.
