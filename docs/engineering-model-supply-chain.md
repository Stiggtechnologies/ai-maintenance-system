# SyncAI Engineering Model Supply Chain

## Implemented boundary

SyncAI treats Get Physics Done (GPD) as optional, replaceable, offline authoring and red-team tooling. GPD is not called by a plant request, is not exposed as customer runtime UI, and is not required for a production calculation. The production capability is SyncAI's governed model supply chain:

`author → package → independently verify → bench validate → field validate → competency approve → bounded execution → human decision → intervention → field outcome → recalibrate or retire`

The implementation contract was distilled from the complete 1,109-line, 53,436-byte discussion supplied on 2026-09-05. Its SHA-256 is `7e5220417ca293674e4500671472e94ad8b2fac2832b235010f1fb61be11fb40`. The executable 55-item coverage register is in `src/lib/engineering-models/implementation-control.ts`; CI fails if an item loses its implementation or verification artifact.

## Control architecture

- `model_register` remains the one versioned model registry. Engineering manifests, lifecycle, applicability, verification, uncertainty, conventions, reproducible environment, provenance, reviewer competence and runtime keys extend it.
- `calculation_runs` remains the immutable ledger for independent verification, computed results and refused attempts.
- `evidence_items`, `approvals`, `model_predictions`, `damage_mechanisms`, `asset_failure_mode_libraries`, `configuration_baselines`, `recommendations`, `decisions` and `work_orders` remain canonical. New tables bind or qualify those records; none duplicates them.
- Browser clients cannot call model ingestion, verification recording or calculation recording. The authenticated Edge boundary validates membership and role, recomputes the canonical manifest SHA-256, selects an exact allowlisted evaluator and calls service-only database functions.
- Imported scripts are inert. There is no `eval`, dynamic function loading or runtime network requirement in a model contract.
- Every model result is advisory, carries `humanApprovalRequired: true`, and carries `operationalAuthorization: false`.

## Promotion and execution gates

A model version moves only through:

`draft → derived → verified → bench_validated → field_validated → engineering_approved → production_eligible`

The author cannot complete engineering approval. Approval requires the exact domain competency role assigned in the canonical role system. Production eligibility additionally requires all production evidence bindings, a passing independent verification run, machine-readable applicability, compatible production dependencies and no blocking or expired verification debt. Revalidation or retirement immediately removes eligibility and opens impact records for affected recommendations and decisions.

At execution, the server reapplies tenant, asset, recommendation, model version, lifecycle, as-maintained configuration, asset-family mapping, component, operating state, exclusions, required inputs, units, valid ranges, evidence identity and measurement-quality checks. Refusal is a persisted outcome, not an exception hidden from the user.

## Physics of Failure coverage

The shared deterministic library includes Miner damage, Arrhenius acceleration, Coffin–Manson fatigue, Paris-law crack growth, creep damage, Archard wear, rainflow cycle extraction, competing-hazard policy, Gaussian degradation-state updating, hypothesis arbitration, intervention effects, physical-versus-economic RUL, model disagreement and reproducible parameter sweeps.

The manifest contract also requires the controls that cannot honestly be collapsed into a single generic formula: canonical mechanism taxonomy, load-spectrum method, damage accumulation, mechanism interaction, censoring, cohorting, calibration/holdout/residual checks, uncertainty decomposition, consequence-aware thresholds, value-of-information inspection, inspection probability of detection, intervention-effect evidence, as-maintained configuration, common-cause assessment, model-conflict review, fitness-for-service escalation, repairability, counterfactual review, design feedback, retirement triggers and preservation of non-physics RCA branches.

FMMEA extends the existing failure-mode library with mechanism, stressors, damage variable, exact model version, occurrence basis, canonical evidence, local/system effects and recommended action. It deliberately allows an explicit non-physics branch instead of forcing every failure into a physical mechanism.

## First governed pilot

The first pack is `pof.shaft-resonance.screening@1.0.0`. It compares shaft/forcing frequencies and a bounded single-degree-of-freedom natural frequency with a measured spectral peak. It refuses classification without an engineering-approved match tolerance and canonical source. It cannot diagnose root cause, estimate life, authorize continued operation or replace modal confirmation.

The pack includes durable project, requirements, roadmap, state, model, assumptions, conventions, derivation, verification, applicability and manifest artifacts under `engineering-model-packs/vibration-resonance-v1/`. Each artifact has a pinned SHA-256 digest and the runtime has no GPD dependency.

## Product use

The Engineering Models page provides tenant posture, controlled pilot ingestion, independent verification, evidence binding, lifecycle promotion, revalidation/retirement and verification-debt management. Recommendation cards show explicit no-model influence or the exact model/version, calculation status, verification status, field validation, applicability, engineering approval and refusals. The display repeats that a result grants no operational authority.

Additional GPD-authored, OEM, standards, empirical or hybrid packs enter through the same manifest and server allowlist. Adding a new pack therefore requires both an approved manifest and a reviewed deterministic evaluator deployment; a manifest alone can never introduce production code.
