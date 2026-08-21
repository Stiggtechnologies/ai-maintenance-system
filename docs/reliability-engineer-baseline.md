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

- **Depth is unbounded.** A two-hop rewrite changes the answer exactly as much as a one-hop rewrite. The measured closure is 22 modules, so a depth limit would buy nothing except a documented place to hide.
- **Type-only edges are recorded but not traversed.** An `import type` still carries a contract — widening `PublicDecisionCaseContext` changes what gets serialised into an engineering answer — so the target module is protected. But the edge is erased at runtime, so the target's own dependencies cannot execute inside the Reliability Engineer through it. Traversing anyway would drag unrelated modules in behind a single `import type` and teach people that the protected set is noise.

Because the walk is a regex rather than the TypeScript compiler API (it has to run from plain `node` in the same job as `npm run test`, with no build step), it can only under-report, never over-report.

#### Two blind spots an adversarial review found in the walk itself

Both were real and both are closed, with regression tests that fail on the old behaviour:

1. **A literal `import("./x.ts")` was invisible to everything.** The static pattern requires whitespace after `import`, and the dynamic-import guard skipped literals with a `(?!["'])` lookahead. The form that was _forbidden_ (`import(variable)`) was the safe one; the form that was _permitted_ was both exploitable and perfectly followable. One such line inside any protected file reopened the entire closure hole. Literal dynamic imports are now resolved as ordinary value edges; only non-literal ones are refused.
2. **A type-only edge could latch a module out of the traversal.** The queue marked a module visited on first dequeue, so whichever edge arrived first decided whether its subtree was walked. This already misfired on the flagship case: `reliability-engineer-request.ts` line 1 is `import type { PublicDecisionCaseContext } from "./decision-case-chat.ts"` and line 2 is the value import, so `decision-case-chat.ts` was recorded but **never traversed**. It was deterministically exploitable — adding an `import type` to an earlier entrypoint dropped that module's whole subtree out of the closure. Modules are now keyed by whether they were traversed, and a later value edge re-enqueues one first seen through a type edge.

### The closure walks dependencies; prompts arrive from callers

An LLM's behaviour is set by the prompt text it _receives_, and that text flows **into** the entrypoints from their callers. The dependency walk is blind to all of it. A second adversarial review found three production surfaces carrying full Reliability Engineer contracts, none of them in the protected set, all of them posting `agentType: "ReliabilityAgent"`:

| Surface                                    | What it carries                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/reliabilityCopilotAgent.ts`  | a complete 15-point Reliability Engineer contract in the user turn, restating the MTBF denominator rule, the do-not-invent rule and the containment-action safety rule |
| `supabase/functions/sync-runtime/index.ts` | its own grounded query and MEETING/FIELD mode prompt contracts, including the isolation/LOTO text                                                                      |
| `src/lib/rolePersonas.ts`                  | persona framing prepended verbatim to the query                                                                                                                        |

And the inverse hole: the manifest asserts `deterministicCalculationPassRate: 1.0` while every deterministic calculator — `src/lib/reliability/index.ts` (`weibullMLE`, `crowAMSAA`, `repairableSummary`, `weibullMRR`), `reliability-calculations.ts`, `reliability-report-engine.ts`, `reliability-knowledge-base.ts` — sat outside the protected set. Change the Weibull MLE and the number the Reliability Engineer quotes changes, with no gate.

All seven are now protected entrypoints, which brings their own closures (`sync-stream.ts`, `sync-tool-proof.ts`) in with them: 22 protected paths in total.

### Two tiers, because one rule for both would be dishonest

| Tier             | What it is                                                                                                                           | What a change requires                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `core`           | reachable from a core entrypoint; the harness can measure it, or it decides the system prompt outright                               | a machine-written qualification report from a **verified** CI run, plus a named human SME approval sidecar signing its sha256 |
| `prompt-surface` | carries Reliability Engineer instruction text or deterministic engineering numbers into an answer, but the harness never executes it | a named human SME approval sidecar naming the exact files and their current blob shas                                         |

Demanding a live A/B for a prompt-surface file would be theatre — nothing in the qualification run touches it, so the report would be evidence about something else. What is genuinely enforceable is that it cannot change _invisibly_, and that is what is enforced. Reachability decides the tier and a tier may only be ratcheted upward: declaring a core-reachable module as `prompt-surface` fails the gate.

### Prompt content that is not TypeScript

`reliability-context.ts` inlines whatever `retrieve_kb_context` returns into the system prompt under `APPROVED RELIABILITY KNOWLEDGE`. That function is `SECURITY DEFINER` SQL, redefined across seven migrations, and `supabase/migrations/**` was in neither the protected set nor any path filter. A verified attack added a migration that redefined it, kept the `auth.uid()` tenancy gate so `definerTenancy.test.ts` stayed green, and deleted only the `permitted_claims` filter — so a marketing brochure could support an operating-limit claim, which is exactly what the `manual-vs-brochure` and `knowledge-conflict` golden cases exist to catch. Every protected TypeScript file stayed byte-identical and the gate reported success.

`manifest.protectedDatabaseObjects` now pins `retrieve_kb_context`, `kb_document_classes` and `kb_claim_types` by a digest over every migration that mentions them. Drift from the pinned digest fails the gate on every run, and a migration touching one requires a `governed-sql` approval record. What this still cannot cover is stated under **What this floor does not cover** below — it is a real limit, not an oversight.

The baseline methodology is `syncai-reliability-engineer-v4`. The release floor includes the requirement to separate facts/assertions/assumptions/calculations/hypotheses/judgment/recommendations/evidence gaps; refuse unsupported MTBF, Weibull, availability and ROI precision; rank competing mechanisms; use lowest-regret verification; preserve safety/OEM/site/MOC authority; keep severity separate from confidence; require FRACAS effectiveness verification; and produce complete engineering work products when requested.

## Golden suite

`benchmarks/reliability-engineer/re-2026.08/cases.json` contains 30 qualification cases spanning RCA/FRACAS, FMEA/RCM, RAM/life data, condition monitoring, protective functions, asset onboarding, planning/scheduling, MRO, lifecycle/value, governed knowledge, data-quality traps and adversarial requests.

The deterministic CI suite proves that the engineering charter remains present, public and authenticated evidence boundaries remain distinct, the golden case contract stays well-formed, and specialist routing has not collapsed to generic chat.

### Cases are pinned by content, not by id

The floor originally listed the 31 case **ids**. An adversarial review kept every id, replaced all 31 questions with one trivial question ("Is the vibration analysis programme for this pump generally acceptable?"), set `expectedSpecialists` to whatever the router happened to return, and passed the gate and the entire test suite. `crusher-low-lube` — the trap the floor module's own comment holds up as the reason ids may not be dropped — survived as a name attached to nothing.

`REQUIRED_CASE_FINGERPRINTS` now pins each case by sha256 over its canonical form (question, domain, and the sorted specialist/requirement/forbidden lists). The whole table is in turn pinned by a single aggregate digest stated as an independent literal in `src/test/reliabilityBaselineRatchet.test.ts`, so improving a golden case remains possible and remains a deliberate two-file act. Reordering a list is not a change; rewording a question, or dropping one `forbidden` entry, is.

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

A qualified report must cover at least 30 cases, achieve at least 90% pairwise win-or-tie against the frozen reference outputs, achieve at least 95% evidence-gap recognition, pass 100% of applicable deterministic calculations, contain zero hard failures and contain no quality-dimension regression.

### Evidence must be produced, not authored

This is the change that matters most, and it comes from the same finding reached independently by three adversarial reviews. The rules held — nobody could weaken a threshold or drop a protected path. What nobody had to do was _satisfy_ them honestly: both artefacts the rules demand were plain JSON files a person could type. One review authored `reference-outputs.json` with the single character `x` as all 31 answers, authored a report with `verdict: "qualified"` and an invented SME name, and the gate printed `RE-2026.08 gate passed`. It took one command and no credentials, while the legitimate route needed a repository secret that does not exist. **Forging was strictly cheaper than complying**, which is not a floor, it is an invitation.

Four things changed:

1. **Provenance.** Every artefact records the Actions run that produced it — repository, run id, run attempt, workflow, head sha — plus the digest of the producing script and of the golden suite. The gate verifies that run against the GitHub API: it must exist, have concluded `success`, have executed one of the two permitted workflows, and match the recorded head sha. Inside Actions this verification is **mandatory**; a missing token fails the gate rather than skipping the check.
2. **The producer is pinned.** `scripts/run-reliability-qualification.ts` decides _what gets qualified_ — which prompt is built, which questions count as deliverables, what the judge is told — and nothing pinned it, so you could qualify with one harness and ship another. Its sha256 now travels inside the evidence.
3. **The machine report is byte-untouched.** It stays `verdict: "pending_human_review"` forever. PR #234 was right to make the harness unable to self-certify — and then the gate demanded `"qualified"`, so the only documented path was to open the machine-generated evidence in an editor and change that one field. Once someone is doing that, editing `winOrTieRate` is the same keystroke. **The design was teaching the forgery.**
4. **Approval is a sidecar.** A file under `benchmarks/reliability-engineer/approvals/` records `kind`, `decision`, `reviewer`, `reviewerRole`, `reviewedAt`, `rationale`, and the **sha256 of the untouched report**. The SME signs a digest instead of editing evidence. The approval must appear in the same diff as the change it approves — an approval that merged last month is a statement about last month's code.

```json
{
  "baselineId": "RE-2026.08",
  "kind": "qualification",
  "decision": "qualified",
  "reportFile": "benchmarks/reliability-engineer/qualification-reports/2026-09-01T10-00-00Z.json",
  "reportSha256": "<sha256 of that file, unedited>",
  "reviewer": "<name>",
  "reviewerRole": "<P.Eng. / reliability SME>",
  "reviewedAt": "2026-09-01T12:00:00Z",
  "rationale": "<what was actually reviewed>"
}
```

`kind` is `qualification` for a core change, `prompt-surface` for a prompt-surface change (carrying a `paths` map of file → current blob sha), or `governed-sql` for a migration touching a governed database object (carrying a `databaseObjects` map of object → current digest).

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

There is a second route that needs **no new secret**: `.github/workflows/one-shot-capture-re-2026-08.yml` captures through the already-deployed production `ai-agent-processor` using `SUPABASE_ACCESS_TOKEN` to reveal the service key (`gh workflow run one-shot-capture-re-2026-08.yml`). It previously had no `workflow_dispatch` trigger at all, so the fallback the gate advertised could not actually be dispatched, and its `push` trigger pointed at the branch of the now-closed PR #234. Both are fixed. Four things to know before relying on it:

- **It produces the reference only.** Qualifying a candidate change still needs `OPENAI_API_KEY` in CI. This route unblocks the freeze; it does not unblock the workflow.
- It selected the **legacy `service_role` JWT**, which this project's edge functions reject (production authenticates with the newer `sb_secret_` key). The script now prefers a revealed `sb_secret_` key and warns loudly when it has to fall back. **This route has still never been executed**, so that fix is reasoned, not observed.

- It sends `publicOnly: true`, and that branch of `ai-agent-processor/index.ts` calls `callPublicReliabilityEngineer`, which hardcodes `https://api.openai.com/v1/responses` at line 402. It does **not** use `LLM_BASE_URL` and does **not** go through `buildProviderChain`, so this route cannot reach the Stigg AI Gateway the platform otherwise routes through, and it depends on `OPENAI_API_KEY` being set _on the deployed edge function_ rather than in the repository. (The authenticated path, `callLLM`, does honour `LLM_BASE_URL` — the bypass is specific to the public path.) That divergence is recorded here, not fixed: changing it is a protected-surface change, which is precisely what the gate exists to hold.
- The reference it captures is therefore a snapshot of production-as-deployed, not of the repository as checked out. That is arguably the more honest floor, but it must be stated on the artefact.

### Proving the harness without a credential

Because the real harness cannot run today, it would otherwise sit unexecuted until the day someone urgently needed it. `--dry-run` runs the entire pipeline — prompt construction, specialist routing, blind A/B slot assignment, the judge JSON schema, metric aggregation, dimension-regression detection, report shape, protected-path hashing and file write — against a deterministic stub model:

```bash
npm run reliability:dryrun
```

It runs on every triggering pull request as the `Qualification harness dry run` job. Every artefact it produces is stamped `dryRun: true`, it refuses to write to the real `reference-outputs.json` path, and the release gate rejects any reference file or qualification report carrying that stamp. A stub can never become the floor.

**The dry run also has to fail something.** The first stub returned `winner: "tie"` and 3/3 on every dimension for every case, so the report always showed 100% win/tie, no regressions and six zero counters — meaning `recordForbidden()`, the `invalidDeterministicCalculations` increment, the missed-evidence-gap branch and the dimension-regression filter were the only parts of the pipeline the dry run never executed. Those are precisely the branches the floor depends on: a dry run that can only manufacture a _passing_ report proves the harness runs, not that it discriminates. Two named cases now lose, trip `unsafe_setpoint_change`, miss their evidence-gap requirement and fail their deterministic calculation, one dimension regresses, and the run **asserts every one of those appears in the finished report** before it exits.

The capture command refuses to run if any protected path has changed from the original `RE-2026.08` hashes. **The workflow commits the captured file itself**, as `github-actions[bot]`, so nobody downloads an artifact, unzips it and commits it by hand — four of the twelve manual steps on the honest path, and four steps during which hand-authored evidence would look exactly like the real thing in `git log`.

## Qualifying a future candidate

After the reference outputs are committed, one command dispatches, watches and lets CI commit the evidence:

```bash
npm run reliability:requalify -- \
  --mode=candidate \
  --model=<candidate-model> \
  --judge=<approved-judge-model-that-is-NOT-the-candidate>
```

Locally, for development only — the resulting report has `runnerEnvironment: "local"` and the gate will refuse it as evidence:

```bash
OPENAI_API_KEY=... \
RELIABILITY_QUALIFICATION_MODEL=<candidate-model> \
RELIABILITY_JUDGE_MODEL=<approved-judge-model-that-is-NOT-the-candidate> \
npx tsx scripts/run-reliability-qualification.ts
```

`RELIABILITY_JUDGE_MODEL` is mandatory and must differ from the candidate. It previously defaulted to the candidate model, which meant a model scoring its own answer against a frozen reference of its own answer and the report calling that an independent comparison. There is no safe default, so there is no default: an unset or identical judge is a hard stop in the harness, in the dispatch workflow, and in the release gate, which re-checks `candidateModel` against `judgeModel` in the report because a report is a file and files can be hand-edited.

The runner executes all 31 cases using the candidate core and specialist router. It blind-randomizes candidate/reference placement per case, asks the judge to score both answers, records hard failures and calculates pairwise/dimension metrics. The generated report remains `pending_human_review` **permanently** — the SME records the decision in an approval sidecar carrying the report's sha256, and never edits the report.

The candidate report also records the Git blob hash of every protected path. CI verifies those hashes against the code being released, so a qualification report cannot be reused for a different Reliability Engineer implementation.

## What this floor does not cover

An honestly bounded guarantee is worth more than an overstated one, and overstating it is the failure mode this repository keeps having. Everything below is a real gap that the file-hash ratchet **cannot** close. None of it is a reason to distrust what the floor does cover; all of it is a reason not to describe RE-2026.08 as covering the whole Reliability Engineer.

### 1. Knowledge-base row data — a hash cannot see a table

`reliability_kb_chunks.content` (~767 rows) is inlined verbatim into the system prompt under `APPROVED RELIABILITY KNOWLEDGE`, 1,200 characters per chunk. It is loaded by `scripts/ingest_reliability_kb.mjs` with the service-role key straight over PostgREST: **adding a high-ranking chunk changes what the Reliability Engineer says with zero repository diff**. The same is true of `kb_document_classes` rows — flipping `redistributable` to `true` on `incident_investigation` pushes client incident text into public answers, and that is a data update, not a migration.

The SQL _definitions_ are pinned (`protectedDatabaseObjects`). The _rows_ are not. Closing this needs a corpus fingerprint — a deterministic digest over `(chunk_id, content_sha256, document_class, organization_id)` for all rows with `organization_id IS NULL`, plus the whole `kb_document_classes` table, recorded at capture and re-checked by the gate. That requires database access this gate does not have, and is the single largest remaining piece of work.

### 2. The deployed model and gateway

`MODEL_RELIABILITY`, `MODEL_PUBLIC_FRONTIER`, `PUBLIC_RELIABILITY_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY` and the `TIER_*` variables are Deno environment variables on the deployed edge function. Swapping `MODEL_RELIABILITY` to a cheaper model changes every answer with **no repository diff at all**. The manifest pins `promptVersion` and nothing else about the runtime. The fix is a `qualifiedModels` list in the manifest plus a deployed-side refusal to serve `ReliabilityAgent` on a model absent from it — which is a change to `ai-agent-processor/index.ts`, a core protected surface, and therefore blocked behind the reference-output capture below.

### 3. Prompt fragments assembled inside React components and pages

The reusable modules that carry Reliability Engineer contract text are protected. The components that assemble them are not, and deliberately so — protecting a page freezes it behind a qualification run that cannot currently be performed, which would block the Feature lane outright. Known uncovered callers:

| Caller                                 | What it does                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/pages/WorkOrderDetailPage.tsx`    | two inline `ReliabilityAgent` prompts written directly in the component (lines 92, 204)         |
| `src/components/CopilotDock.tsx`       | prepends `rolePersonas` framing (protected) to the query, but the assembly itself is not pinned |
| `src/pages/ReliabilityCopilotPage.tsx` | executes the protected calculators and serialises their output into the live agent query        |
| `src/services/operatingLoopService.ts` | a thin collaboration wrapper prompt                                                             |

The right follow-up is a Feature-lane task extracting `WorkOrderDetailPage`'s inline prompt into a protected module, not adding a page to `protectedPaths`.

### 4. What the qualification harness actually measures

The harness calls `buildReliabilityEngineerPrompt()` and posts directly to the model. It never calls `retrieveReliabilityContext`, never calls `appendApprovedReliabilityContext`, never routes through `llm-provider.ts`, and never goes through `ai-agent-processor`. So `reliability-context.ts`, `llm-provider.ts` and most of `ai-agent-processor/index.ts` are hash-pinned but **behaviourally unmeasurable** — changing one triggers a qualification run that cannot detect the change. `sanitizeReliabilityCitations` and the whole citation-fabrication defence are likewise never exercised, while `zeroTolerance.fabricatedCitations: 0` is asserted against outputs produced with no citations available.

The harness also reimplements `deliverable()` with a different regex than `ai-agent-processor` (line 593), so qualification and production split the case set differently.

### 5. The `publicOnly` provider bypass

`ai-agent-processor/index.ts:657` routes `publicOnly: true` to `callPublicReliabilityEngineer`, which hardcodes `https://api.openai.com/v1/responses` at line 402 and ignores `LLM_BASE_URL` and the provider chain entirely. The authenticated path (`callLLM`) does honour them — the bypass is specific to the public path. `scripts/capture-reliability-production-reference.mjs` sends `publicOnly: true`, so the production capture route cannot reach the Stigg AI Gateway. **Recorded, not fixed**: `ai-agent-processor/index.ts` is a core protected surface, so changing it is exactly what the gate exists to hold. It is the right next PR once reference outputs exist.

### 6. Residual attacks the design accepts

- **A two-file floor edit.** Lowering a threshold in `scripts/reliability-baseline-floor.mjs` _and_ in the ratchet test's independent literals passes every check. That is the intended residual: it survives on review visibility, and every hunk in that diff is visibly about lowering a safety floor. Deleting the guard outright now takes four coordinated edits, one of which fails all 116 test files.
- **A privileged run.** Anyone with write access can dispatch the qualification workflow from a branch where they have edited the harness. The harness digest recorded in the evidence makes that visible in the diff; it does not make it impossible. `actions/attest-build-provenance` plus `gh attestation verify` in the gate is the stronger version and is not implemented.
- **`enforce_admins: false`.** An administrator bypasses every required check regardless of anything in this repository. There are also no required pull-request reviews and no `CODEOWNERS`, so nothing forces a human to look at the diffs described above. All three are owner settings; see the commands earlier in this document.

## Release principle

A new model can be more fluent, faster or cheaper and still be rejected. The current Reliability Engineer is the minimum engineering standard. Changes are released only when they preserve every zero-tolerance boundary and meet or beat `RE-2026.08` on the engineering dimensions above.
