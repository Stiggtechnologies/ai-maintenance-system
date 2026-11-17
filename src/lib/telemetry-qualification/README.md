# Telemetry qualification foundation — draft

Synthetic, non-operational contract tests for maintenance evidence. This is not
an onboard HUMS, deployed adapter, military-qualified product, operational
readiness assessment, or predictive-performance qualification. No live,
defence or customer data is used. No model is trained, promoted or approved.

## Contract and canonical ownership

`contracts.ts` defines `syncai-telemetry-qualification-v1`. It is an in-memory
qualification envelope, not another persistence store or ingest endpoint.
Canonical organization/site/asset/sensor/component IDs are supplied unchanged;
source system plus organization plus source ID identifies an event in a replay.
IDs must be nonblank; this module cannot establish that they exist.

- `measured_observation`: sensor value or explicit missing value (`null`).
- `derived_feature`: computed value, exact model version and source lineage.
- `condition_estimate`: model assertion with lineage and explicit score semantics.
- `forecast`: model assertion with a target time later than capture time.

Confidence is only an **uncalibrated model score** in [0, 1], accompanied by a
stated applicability and basis. Presence of these fields does not establish
calibration or applicability in the field. No score is converted to failure
probability, remaining useful life, readiness, or an operating recommendation.

The inspected canonical contracts remain authoritative:

| Existing owner                                                 | Reuse/boundary                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/ingest-entities.ts`                                   | Existing condition-reading quality vocabulary and stable external ID; no changes to preflight or live ingest.                  |
| `src/services/conditionStateService.ts` / `condition_readings` | Type-only reuse of value, asset ID and capture time; only canonical time-series store.                                         |
| `src/services/reliabilityCallers.ts` / `operating_states`      | Canonical regime/coverage evidence can be referenced; this module does not invent a duty cycle or aggregate operating history. |
| `src/types/operating.ts` / `evidence_items`                    | Type-only reuse of organization ID; lineage uses canonical record references, not new evidence records.                        |
| `src/lib/develop/controls.ts` / `calculation_runs`             | Type-only reuse of input-reference structure. The report is a test result, not a persisted calculation run.                    |
| `src/lib/model-risk/index.ts` / `model_register`               | Type-only reuse of model key/version. Caller configuration is an input snapshot, never a register or approval receipt.         |
| `docs/engineering-context/edge-evidence-contract.md`           | Signed evidence still requires authentication, current approved model, tenant bindings, freshness and monotonic sequence.      |

Existing Weibull/Crow-AMSAA/repairable functions consume failures, censoring or
work-history exposure. Existing quality-management functions consume inspected
quantities, defects and acceptance outcomes. Neither matches this fixture's
sensor amplitudes. No reliability/quality math is copied or used outside its
assumptions. Replay outputs qualified values and explicit refusals only.

## Validation and deterministic replay

`validateTelemetry(unknown, configuration, asOf)` returns `valid`, `invalid`,
`unknown`, or `quarantined`, with stable reason codes. It never reads the clock.
The caller must provide the evaluation time. V1 requires canonical UTC
millisecond timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`); unsupported representations
are refused rather than silently normalized. There are no clock source, offset,
synchronization quality or timing-uncertainty fields in v1. Ordering assumes the
supplied timestamps are exact; it is not uncertainty-qualified ordering.
Capture must precede receipt, and
receipt must not exceed `asOf`. Units match exactly; there is no conversion.
Configuration validity is [validFrom, validUntil), covers capture, receipt and
evaluation, and must match the supplied identity and exact version. V1 deliberately
quarantines a buffered event whose configuration is no longer current at evaluation.
Latency limits are explicit synthetic configuration, not engineering thresholds.

Validation reports the first refusal in deterministic order: envelope/identity,
kind/value/provenance/time, configuration, model, latency, quality, then missing value.
An absent derived value does not bypass confidence, horizon or binding checks.
Lineage arrays must be dense: empty slots are not source references.
`good` is the only replay-eligible quality. Other canonical quality values are
quarantined; this stricter offline policy does not change live-ingest behavior.

`replay` accepts typed envelopes in **supplied arrival order**. It creates only
batch-local maps. Inputs are not changed, no state survives calls, and no IO,
network, random generator, notification or operational action is invoked.
Determinism means the same supplied arrival order, not permutation invariance.
A source-ID repeat with identical envelope content is `duplicate`, including
repeated unknown or quarantined data; these duplicates never carry a qualified value. A different
receipt timestamp also counts as changed content in v1: transport acknowledgement
semantics are intentionally not solved here. Sorted object keys make comparison
independent of property insertion order; array order remains significant. This
comparison is neither a cryptographic digest nor a security replay mechanism.
Series grouping projects only declared identity and model key/version fields;
accepted extension metadata cannot split a canonical series or bypass contradictions.
Conflicting IDs quarantine the conflicting group. Differing qualified values
at the same capture instant in the same source/kind/model/configuration series
quarantine that point and its duplicates. Older arrivals are quarantined and do
not replace the newest qualified reading. Quarantined and unknown values never
become zero. Equal-valued readings under different IDs remain separate readings;
cross-source sensor fusion and cross-sensor contradiction detection are not supplied.

The report carries source IDs in fixture order and contract/replay versions,
fixed evaluation time, explicit reasons, qualified value or null, `synthetic=true`
and `operationalAuthorization=false`. Its fixture label and row index resolve to
the complete identity, provenance and configuration in `fixtures.ts`. It is not
a model accuracy or reliability report. All fixture numbers are invented signals.

## Reproduce

From the repository root:

```sh
npx vitest run src/lib/telemetry-qualification
npx eslint src/lib/telemetry-qualification --max-warnings 0
npm run typecheck
npx tsx -e 'import {fixtures,AS_OF} from "./src/lib/telemetry-qualification/fixtures.ts"; import {replay} from "./src/lib/telemetry-qualification/index.ts"; console.log(JSON.stringify(fixtures.map(f=>replay(f,AS_OF)),null,2))' > /tmp/telemetry-report.json
```

`qualification-report.json` is the retained machine-readable output. Tests compare
it with replay, separately assert labelled outcomes, replay twice byte-for-byte,
and verify unchanged inputs and isolated runs. No command contacts a live source.

## Authorization, policy gaps and next evidence gate

Matching tenant fields is **not authentication or authorization**. Any future
adapter must resolve IDs using authorized canonical reads and preserve runtime
RLS, role checks, signature verification and current model/configuration policy.
This module cannot establish trust in caller-supplied configuration or source refs.
No model applicability, calibration or evidence verification is implied by `valid`.

Two future policy gaps remain deliberately open:

1. **Acknowledgement loss:** after a signed write succeeds but its response is
   lost, a retry currently fails duplicate-ID/sequence checks. A governed read-only
   reconciliation design must authenticate the caller, bind exact content and
   tenant, and prove the original receipt without accepting replayed writes.
2. **Retired-model buffered events:** observations captured before model retirement
   may arrive afterwards. A future policy must decide whether historical evidence
   can be retained, under which immutable version/approval context, without treating
   the old model as currently approved. V1 does not authorize such an exception.

Neither gap weakens the existing signed-ingest freshness, monotonic-sequence,
key-lifecycle or exact-current-model checks. Offline same-content classification
must never be wired in as permission to bypass those checks.

Next gate: architecture/domain review of the envelope and refusal policy, then
an independently reviewed canonical adapter design with authenticated tenant
resolution and explicit acknowledgement/retirement policy. Field performance
would require separate representative labelled data, calibrated uncertainty,
model applicability and hardware/environment evidence. Synthetic tests supply
none of that evidence.

Scope is only this directory. Existing DB migrations, Auth, Edge functions, live
ingest, UI, deployment config, customer journeys and PR #661 are unchanged.
Open PRs #590 (sensor registry), #611 (Azure ingress), #567 (model monitoring) and
#629 (operational monitor) retain ownership of their runtime areas. This module
adds none of those features. No `.agents/skills` files were present in the selected
workspace. Rollback before integration is a revert of this isolated module; no
persisted data or operational state requires recovery.
