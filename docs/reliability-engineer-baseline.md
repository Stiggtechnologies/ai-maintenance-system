# Reliability Engineer RE-2026.08 baseline

`RE-2026.08` is the minimum acceptable production quality for SyncAI Reliability Engineer. It is a floor, not a frozen implementation: later versions may change prompts, models, retrieval, specialist routing, token budgets or orchestration only when they are qualified to be no worse than this baseline.

## How the ratchet protects itself

The manifest describes the floor. It is not the floor.

`benchmarks/reliability-engineer/re-2026.08/manifest.json` is not in its own `protectedPaths`, and deliberately so — putting it there would deadlock every legitimate ratchet behind a live qualification run just to edit the rulebook. Instead the irreducible minimum lives in three layers:

| Layer | Where                                         | What it holds                                                                                                                                                         |
| ----- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `scripts/reliability-baseline-floor.mjs`      | Hardcoded minimum protected entrypoints, minimum thresholds, zero allowances, required quality dimensions, required golden-case ids. Never derived from the manifest. |
| 2     | `scripts/check-reliability-baseline.mjs`      | Imports layer 1 and refuses to evaluate a manifest that sits below it, on every run, whether or not the diff touches a protected path.                                |
| 3     | `src/test/reliabilityBaselineRatchet.test.ts` | Re-states the load-bearing numbers as its own literals and asserts layer 1 still matches. Runs under `npx vitest run`.                                                |

The manifest may only be **ratcheted** against layer 1: more protected paths, stricter thresholds, more cases, more dimensions. Setting `pairwiseWinOrTieRate` to 0, zeroing a `zeroTolerance` counter, deleting a `protectedPaths` entry or dropping a golden trap all fail layer 2 and layer 3.

The duplication between layers 1 and 3 is intentional. Weakening layer 1 fails layer 3; weakening layer 3 leaves layer 1 enforcing; weakening both is a two-file diff whose every hunk is visibly about lowering a safety floor, and AGENTS.md parallel-work rule 3 then applies to it explicitly.

## Where the gate actually runs

Branch protection on `main` requires exactly four checks: `Lint + Typecheck`, `Unit tests`, `Migration chain + seeded auth smoke`, `Golden-path E2E`. The two jobs in `.github/workflows/reliability-qualification.yml` are **not** among them, so that workflow can go red and a pull request will still merge.

So the enforcing logic runs inside a check that is already required:

- `.github/workflows/ci.yml` → job `Unit tests` runs `node scripts/check-reliability-baseline.mjs` as an explicit step, with `fetch-depth: 0` so the gate can resolve the merge base it diffs against.
- `src/test/reliabilityBaselineRatchet.test.ts` runs the same floor and closure assertions inside `npm run test`, and asserts that the CI step above still exists — so removing the step fails the job it was removed from.

The standalone workflow is kept: it is the one that can be dispatched manually for reference capture and live qualification, and its path filter documents the governed surfaces. That filter is asserted against `manifest.protectedPaths` by the ratchet test, so a newly protected file cannot be added to the manifest and forgotten in the trigger.

### If the owner also wants the dedicated job to be blocking

Branch protection is an owner-only setting, so this is a recommendation, not something an agent can apply.

**Read this caveat first.** `RE-2026.08 deterministic floor` lives in a workflow with a `paths:` filter. A required status check that never runs is reported as _pending_, not as _passed_ — so making the job required as it stands would block every pull request that does not touch a Reliability Engineer file. Two safe options:

1. **Do nothing.** The gate already runs in `Unit tests`, which is required and unfiltered. This is why the enforcement was put there.
2. **Make the workflow unconditional first**, by removing the `paths:` filters from the `pull_request` trigger in `.github/workflows/reliability-qualification.yml`, then add the job:

```bash
gh api -X PATCH \
  repos/Stiggtechnologies/ai-maintenance-system/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{
  "strict": true,
  "checks": [
    { "context": "Lint + Typecheck", "app_id": 15368 },
    { "context": "Unit tests", "app_id": 15368 },
    { "context": "Migration chain + seeded auth smoke", "app_id": 15368 },
    { "context": "Golden-path E2E", "app_id": 15368 },
    { "context": "RE-2026.08 deterministic floor", "app_id": 15368 }
  ]
}
JSON
```

Separately, `enforce_admins` is currently `false`, so an administrator can bypass every required check above regardless of this setting. Turning it on is a distinct owner decision:

```bash
gh api -X POST \
  repos/Stiggtechnologies/ai-maintenance-system/branches/main/protection/enforce_admins
```

## What is protected

The baseline manifest pins the accepted Reliability Engineer methodology, specialist router, Decision Case request builder, governed retrieval boundary, authenticated model processor, public Reliability Engineer edge path and client contract. The exact protected paths and original Git blob hashes are recorded in `benchmarks/reliability-engineer/re-2026.08/manifest.json`.

### The protected set is an import closure, not a file list

A file list is not a boundary. `reliability-engineer-request.ts` is protected and its second line imports `buildDecisionCaseChatPrompts` from `./decision-case-chat.ts`, which was in neither the protected set nor the workflow path filter — so the entire Decision Case prompt could be rewritten with the release gate never running.

`computeProtectedClosure()` walks the first-party import graph from the seven entrypoints and fails if anything transitively reachable is absent from `protectedPaths`. Six modules were reachable and unprotected; all six are now pinned:

| Module                                             | Reached by                                                                               | Why it matters                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `supabase/functions/_shared/decision-case-chat.ts` | value import from `reliability-engineer-request.ts`, `public-reliability-agent/index.ts` | builds the Decision Case prompts                        |
| `supabase/functions/_shared/llm-provider.ts`       | value import from `ai-agent-processor/index.ts`                                          | provider chain, failover, which model actually answered |
| `src/lib/reliability-agent-contract.ts`            | value import from `publicReliabilityAgent.ts`                                            | classifies what the client may ask for                  |
| `src/lib/supabase-config.ts`                       | value import from `publicReliabilityAgent.ts`                                            | the endpoint the call is sent to                        |
| `src/lib/decision-case.ts`                         | type-only                                                                                | Decision Case evidence shape                            |
| `src/lib/public-reliability.ts`                    | type-only                                                                                | public scenario identity contract                       |

Two rules govern the walk, both deliberate:

- **Depth is unbounded.** A two-hop rewrite changes the answer exactly as much as a one-hop rewrite. The measured closure is 16 modules, so a depth limit would buy nothing except a documented place to hide.
- **Type-only edges are recorded but not traversed.** An `import type` still carries a contract — widening `PublicDecisionCaseContext` changes what gets serialised into an engineering answer — so the target module is protected. But the edge is erased at runtime, so the target's own dependencies cannot execute inside the Reliability Engineer through it. Traversing anyway would drag `reliability-report-engine.ts`, `reliability-calculations.ts` and `reliability-knowledge-base.ts` in behind a single `import type`, freezing three unrelated modules and teaching people that the protected set is noise. If any of them ever becomes reachable by a value edge, the walk catches it that day.

Because the walk is a regex rather than the TypeScript compiler API (it has to run from plain `node` in the same job as `npm run test`, with no build step), it can only under-report, never over-report. The one edge a regex cannot see — `await import(someVariable)` — is forbidden outright inside the closure.

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

## Capturing the reference behavior — OPEN BLOCKER

The structural baseline is already pinned by commit/hash. The actual model outputs that represent the behavior we want to preserve must also be frozen while the protected code still matches the manifest.

**They have not been captured, and cannot be captured with the credentials this repository has.** `benchmarks/reliability-engineer/re-2026.08/reference-outputs.json` does not exist, so the gate correctly refuses every protected change: the Reliability Engineer is frozen solid, not merely floored.

What is actually missing:

| Need                                        | Status                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `OPENAI_API_KEY` repository secret          | **absent** — the repository has exactly one secret, `SUPABASE_ACCESS_TOKEN` |
| Workflow to dispatch once the secret exists | `.github/workflows/reliability-qualification.yml`, mode `capture-reference` |
| Independent judge model                     | required — see below                                                        |

```bash
# after the owner adds OPENAI_API_KEY
gh workflow run reliability-qualification.yml \
  -f mode=capture-reference \
  -f model=<candidate-model> \
  -f judge_model=<independent-judge-model>
```

There is a second route that needs **no new secret**: `.github/workflows/one-shot-capture-re-2026-08.yml` captures through the already-deployed production `ai-agent-processor` using `SUPABASE_ACCESS_TOKEN` to reveal the service-role key. Two things to know before relying on it:

- It sends `publicOnly: true`, and that branch of `ai-agent-processor/index.ts` calls `callPublicReliabilityEngineer`, which hardcodes `https://api.openai.com/v1/responses` at line 402. It does **not** use `LLM_BASE_URL` and does **not** go through `buildProviderChain`, so this route cannot reach the Stigg AI Gateway the platform otherwise routes through, and it depends on `OPENAI_API_KEY` being set _on the deployed edge function_ rather than in the repository. (The authenticated path, `callLLM`, does honour `LLM_BASE_URL` — the bypass is specific to the public path.) That divergence is recorded here, not fixed: changing it is a protected-surface change, which is precisely what the gate exists to hold.
- The reference it captures is therefore a snapshot of production-as-deployed, not of the repository as checked out. That is arguably the more honest floor, but it must be stated on the artefact.

### Proving the harness without a credential

Because the real harness cannot run today, it would otherwise sit unexecuted until the day someone urgently needed it. `--dry-run` runs the entire pipeline — prompt construction, specialist routing, blind A/B slot assignment, the judge JSON schema, metric aggregation, dimension-regression detection, report shape, protected-path hashing and file write — against a deterministic stub model:

```bash
npm run reliability:dryrun
```

It runs on every triggering pull request as the `Qualification harness dry run` job. Every artefact it produces is stamped `dryRun: true`, it refuses to write to the real `reference-outputs.json` path, and the release gate rejects any reference file or qualification report carrying that stamp. A stub can never become the floor.

The capture command refuses to run if any protected path has changed from the original `RE-2026.08` hashes. Commit the generated `benchmarks/reliability-engineer/re-2026.08/reference-outputs.json` after reviewing it.

## Qualifying a future candidate

After the reference outputs are committed:

```bash
OPENAI_API_KEY=... \
RELIABILITY_QUALIFICATION_MODEL=<candidate-model> \
RELIABILITY_JUDGE_MODEL=<approved-judge-model-that-is-NOT-the-candidate> \
npx tsx scripts/run-reliability-qualification.ts
```

`RELIABILITY_JUDGE_MODEL` is mandatory and must differ from the candidate. It previously defaulted to the candidate model, which meant a model scoring its own answer against a frozen reference of its own answer and the report calling that an independent comparison. There is no safe default, so there is no default: an unset or identical judge is a hard stop in the harness, in the dispatch workflow, and in the release gate, which re-checks `candidateModel` against `judgeModel` in the report because a report is a file and files can be hand-edited.

The runner executes the same 30 cases using the candidate core and specialist router. It blind-randomizes candidate/reference placement per case, asks the judge to score both answers, records hard failures and calculates pairwise/dimension metrics. The generated report deliberately remains `pending_human_review` until a qualified human SME reviews the cases and changes the verdict to `qualified` with their name and review timestamp.

The candidate report also records the Git blob hash of every protected path. CI verifies those hashes against the code being released, so a qualification report cannot be reused for a different Reliability Engineer implementation.

## Release principle

A new model can be more fluent, faster or cheaper and still be rejected. The current Reliability Engineer is the minimum engineering standard. Changes are released only when they preserve every zero-tolerance boundary and meet or beat `RE-2026.08` on the engineering dimensions above.
