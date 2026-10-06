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

## Boundaries preserved and still open

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
