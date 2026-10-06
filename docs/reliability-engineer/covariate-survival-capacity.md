# Declared Cox numerical boundary qualification

**Draft — C7.14 remains yellow.** This is a computational and mathematical
witness, not customer evidence, fleet suitability, an endpoint latency SLA,
production load testing, validated predictive coverage or operating authority.

The existing kernel accepts at most 2,000 complete exposure intervals and eight
named covariates. Those are software computation limits, not engineering
thresholds or sample-adequacy criteria. Neither limit is raised by this work.
An excessive cohort is refused in full; no truncation or favourable subset is
analysed to make it fit the limit.

## Exact synthetic input

`src/lib/reliability/fixtures/cox-capacity-input.ts` is a deterministic,
content-hash-bound recipe with seed 1597463007. It calls no application fitting,
diagnostic, prediction or confidence functions. The full generated input has:

- 2,000 intervals belonging to 1,000 distinct physical-life identities;
- eight independently generated named synthetic covariates;
- two contiguous intervals per life, with pre-interval observations;
- four strata, delayed entry, tied failures and right censoring;
- explicit mappings to 32 synthetic asset clusters, not row-derived independence;
- a constant and a two-piece known-at-origin conditional profile over the exact
  `(11, 31]` window, each using joint covariate vectors observed in its stratum.

The numbers and validity statements describe a synthetic recipe only. They
imply no sensor persistence rule, OEM limit, approved customer operating
condition, independent-asset adequacy or engineering acceptance criterion.

## Independent executed reference

Run the repository generator against an explicit isolated runtime:

```sh
npx tsx scripts/qualify-cox-capacity-reference.mjs /absolute/node_modules/webr
```

It actually executed WebR 0.6.0, R 4.6.0, survival 3.8.6, Matrix 1.7.5 and lattice
0.22.9. Only synthetic recipe inputs enter R; no application mathematics or
customer data are imported. Existing package binaries are used as references,
not copied into the application implementation. Artifact formatting does not
influence any numerical reference value.

The retained `cox-capacity-reference.json` freezes coefficients, model-based
and asset-clustered covariance, all eight identity-time PH score tests plus the
global test, log likelihood, both conditional hazards and full asset influences.
For each of 32 assets it independently fits increased and decreased case weights
at each of three perturbations, 1e-4, 1e-5 and 1e-6: 192 full perturbed-model
fits. The largest influence difference was 1.8152146435274075e-9, below the
declared 2e-7 numerical stability tolerance. This tolerance is not an engineering
or model-acceptance threshold. The complete path's full joint variance, not
independently squared path pieces or the different `survfit` variance convention,
feeds independently evaluated R nominal log-hazard confidence bounds.

Formatted artifact SHA-256:
`c2b8fd8bbbb88aa974bb31f876a0050c535f9bce1f2aeb9569918aceeabc3176`.
The artifact also pins the exact recipe-file bytes and complete generated-input
serialization separately. `cox-capacity.test.ts` verifies those hashes and
compares SyncAI's complete shared-kernel results against the retained R witness.
It separately refuses 2,001 intervals and a ninth covariate without mutating or
fitting a truncated version of the original input.

Published commit `7f93bc3adabd2b0daa03b5d34e3cef1b888e8a94` completed all five
primary hosted gates in run `37420300152`, including the full migration/auth
smoke and Golden-path E2E. Its exact-commit local regression passed 648 files
and 8,257 tests. The browser artifact `11393415928` has digest
`8a276cafa63825d390f1bc2a976c96df17d8d6e8ff7871b95f806f592879c56c`;
the dedicated `installed-model-confidence-bounds.png` was downloaded and
visually inspected. It shows failure bounds 26.3697%–30.4671%, survival bounds
69.5329%–73.6303%, and explicit unqualified-coverage/advisory warnings. This is
the small three-asset installed-life browser witness, **not** a 2,000-interval
database/browser witness. The live-provider golden qualification was skipped,
not passed. These checks do not establish independent review, merge or
production deployment, nor cover changes made after that commit.

## Boundaries preserved and still open

### Whole-source preparation and a discovered identity blocker

`survival-capacity-source.test.ts` additionally prepares all 1,000 explicit
synthetic physical lives through `prepareSurvivalCensus`, preserving all 2,000
intervals, eight conditions, 32 asset clusters, delayed entry and censoring.
The prepared fit is compared with the frozen independent R coefficients,
model covariance and likelihood. A source, approval, unit or coverage defect
in the final life refuses the entire cohort. A 1,001st two-interval life also
refuses in full; no good subset is passed to the numerical kernel. The source
fixture's approval/evidence flags are deliberately synthetic, not database
receipts, and this test does **not** prove ingestion or full-stack acceptance.

The pre-existing canonical life-event constraint in
`20260830090000_component_life_events.sql` identifies events by organization,
unit number, component, removal hours and event kind. For this exact recipe,
only 789 of those legacy identities are unique: **211 distinct physical lives
would collide**. The newer governed `lifeRef` identity cannot resolve a
collision that prevents the initial event from being created. The existing
writer receives no physical-life identity before insertion.

The owned runtime smoke now witnesses this limitation through the actual
authenticated `record_component_life_event` RPC: a distinct source, work order
and removal date with identical same-asset/component exposure returns the
legacy duplicate error, creates no event and changes no approval. Its explicit
status is `legacy_same_exposure_life_ingestion=false`. Until a fresh hosted
run executes that assertion, the new runtime witness remains pending.

This needs a serialized architecture/invariant migration, not a numerical
workaround. Required closure includes an explicit physical-life/source identity
at initial capture, preservation of historical records and old API behavior,
same-source retry idempotency, rejection of duplicate physical lives, tenant
and independent-review boundaries, and an actual complete-cohort
capture/review/calculation/history/browser witness. Do not alter measured
exposure, relabel assets, drop colliding lives, disable the old constraint
without a replacement identity, or fabricate approvals to claim capacity.

The application solver, numerical pins, tenant/auth/source/approval rules,
canonical calculation ledger and advisory authority are unchanged. This
increment adds qualification, not a new model or a new persistence path.
`phAssumptionValidated`, `coverageValidated`, `futureEventPredictionInterval`
and `liveAssetForecast` remain false; predictive `confidenceInterval` remains
null. Passing synthetic PH calculations does not establish PH for a customer.

The witness qualifies this declared synthetic computational boundary. It does
not establish representative customer performance, all possible conditioning
patterns, transport ceilings, peak memory/latency under concurrent service
traffic, a complete 2,000-interval database/browser journey, actual MFA
enrollment, held-out calibration or field applicability. Independent
architecture/security/domain review, parent-stack integration, exact-head
hosted checks, merge and production verification remain required.
