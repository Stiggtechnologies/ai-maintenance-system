/**
 * Closed implementation contract distilled from the complete 1,109-line GPD
 * discussion. CI requires every item to remain implemented and traceable to a
 * concrete implementation and verification artifact.
 */
export interface EngineeringModelRequirementControl {
  id: string;
  category: string;
  requirement: string;
  status: "implemented";
  implementationRefs: string[];
  verificationRefs: string[];
}

const TYPES = "src/lib/engineering-models/types.ts";
const VALIDATION = "src/lib/engineering-models/validation.ts";
const POF = "src/lib/engineering-models/physics-of-failure.ts";
const RESONANCE = "src/lib/engineering-models/resonance.ts";
const CAPABILITY_ADAPTER =
  "src/lib/engineering-models/physics-capability-adapter.ts";
const MIGRATION =
  "supabase/migrations/20261214090001_engineering_model_supply_chain.sql";
const EDGE = "supabase/functions/engineering-model-supply-chain/index.ts";
const REGISTRY = "src/pages/EngineeringModelRegistryPage.tsx";
const TRACE = "src/components/EngineeringModelTracePanel.tsx";
const POF_TEST = "src/lib/engineering-models/physics-of-failure.test.ts";
const VALIDATION_TEST = "src/lib/engineering-models/validation.test.ts";
const RESONANCE_TEST = "src/lib/engineering-models/resonance.test.ts";

const control = (
  id: string,
  category: string,
  requirement: string,
  implementationRefs: string[],
  verificationRefs: string[],
): EngineeringModelRequirementControl => ({
  id,
  category,
  requirement,
  status: "implemented",
  implementationRefs,
  verificationRefs,
});

export const ENGINEERING_MODEL_REQUIREMENT_CONTROLS: EngineeringModelRequirementControl[] =
  [
    control(
      "EMS-001",
      "boundary",
      "Use GPD only as an offline/build-time authoring and red-team tool.",
      [TYPES, EDGE],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-002",
      "boundary",
      "Keep GPD replaceable and out of the production dependency path.",
      [VALIDATION, EDGE],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-003",
      "artifacts",
      "Ingest the durable project, requirements, roadmap, state, model, assumptions, conventions, derivation, verification, applicability and manifest chain.",
      [TYPES, VALIDATION, MIGRATION],
      [RESONANCE_TEST],
    ),
    control(
      "EMS-004",
      "registry",
      "Extend the canonical model_register rather than create a parallel model store.",
      [MIGRATION, CAPABILITY_ADAPTER],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-005",
      "governance",
      "Enforce draft through production-eligible, revalidation-required and retired lifecycle states.",
      [VALIDATION, MIGRATION],
      [
        VALIDATION_TEST,
        "src/test/engineeringModelSupplyChainMigration.test.ts",
      ],
    ),
    control(
      "EMS-006",
      "runtime",
      "Execute only version-pinned, allowlisted deterministic calculations; imported code remains inert.",
      [VALIDATION, EDGE, MIGRATION],
      [VALIDATION_TEST, "src/test/engineeringModelSupplyChainContract.test.ts"],
    ),
    control(
      "EMS-007",
      "governance",
      "Keep every engineering output advisory and human-final.",
      [TYPES, MIGRATION, TRACE],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-008",
      "governance",
      "Never grant operational authorization from a model calculation.",
      [TYPES, EDGE, MIGRATION, TRACE],
      ["src/test/engineeringModelSupplyChainContract.test.ts"],
    ),
    control(
      "EMS-009",
      "provenance",
      "Preserve Apache-2.0 provenance for GPD-authored packs and record the authoring tool/version/reference.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-010",
      "provenance",
      "Record and gate source usage rights for standards, OEM, proprietary and customer data.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-011",
      "verification",
      "Contract dimensional, limiting-case, conservation, symmetry, benchmark, stability, regression and adversarial checks.",
      [TYPES, VALIDATION, EDGE],
      [RESONANCE_TEST],
    ),
    control(
      "EMS-012",
      "verification",
      "Rerun verification independently of the authoring environment and make browser fabrication impossible.",
      [EDGE, MIGRATION],
      ["src/test/engineeringModelSupplyChainContract.test.ts"],
    ),
    control(
      "EMS-013",
      "verification",
      "Regression-test known reference cases whenever a model version changes.",
      [RESONANCE, EDGE],
      [RESONANCE_TEST],
    ),
    control(
      "EMS-014",
      "analysis",
      "Produce reproducible sensitivity and parameter-sweep artifacts rather than a single opaque number.",
      [POF],
      [POF_TEST],
    ),
    control(
      "EMS-015",
      "reproducibility",
      "Pin runtime/package/solver versions, tolerances and random seeds for reproducibility and air-gap use.",
      [TYPES, VALIDATION, RESONANCE],
      [RESONANCE_TEST],
    ),
    control(
      "EMS-016",
      "verification",
      "Track blocking verification debt, temporary expiry and evidenced resolution.",
      [MIGRATION, REGISTRY],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-017",
      "verification",
      "Actively test bad units, extreme inputs, sparse data and conflicting evidence.",
      [VALIDATION, EDGE],
      [VALIDATION_TEST, RESONANCE_TEST],
    ),
    control(
      "EMS-018",
      "semantics",
      "Lock engineering conventions including unit system, pressure, vibration, stress, time, coordinates and probability.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-019",
      "semantics",
      "Type every producer and consumer port by physical meaning, unit, basis, convention and valid range.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-020",
      "dependencies",
      "Refuse incompatible model links and identify downstream models and decisions affected by change.",
      [VALIDATION, MIGRATION],
      [
        VALIDATION_TEST,
        "src/test/engineeringModelSupplyChainMigration.test.ts",
      ],
    ),
    control(
      "EMS-021",
      "applicability",
      "Make asset family, component, state, input range and excluded conditions machine-readable and refusing.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-022",
      "configuration",
      "Require the current as-maintained configuration where the model contract demands it.",
      [VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-023",
      "measurement",
      "Gate calibration, sampling adequacy, drift, missingness and measurement uncertainty.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-024",
      "fmmea",
      "Extend canonical FMEA rows to mechanism, stressor, damage variable, model, effects, evidence and occurrence basis while preserving non-physics RCA.",
      [TYPES, MIGRATION],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-025",
      "pof",
      "Provide deterministic Arrhenius, Coffin-Manson, Paris-law, creep, wear and Miner life/damage kernels.",
      [POF],
      [POF_TEST],
    ),
    control(
      "EMS-026",
      "pof",
      "Govern acceleration factors and separate accelerated-test from use-condition assumptions.",
      [POF, TYPES],
      [POF_TEST],
    ),
    control(
      "EMS-027",
      "stress-history",
      "Convert time histories into load spectra, including rainflow cycles.",
      [POF],
      [POF_TEST],
    ),
    control(
      "EMS-028",
      "damage",
      "Represent cumulative, history-dependent fatigue, creep and wear damage.",
      [POF, TYPES],
      [POF_TEST],
    ),
    control(
      "EMS-029",
      "interactions",
      "Require evidence of mechanism independence or an approved interaction model.",
      [POF, TYPES],
      [POF_TEST],
    ),
    control(
      "EMS-030",
      "interactions",
      "Combine competing hazards only under the declared interaction policy.",
      [POF],
      [POF_TEST],
    ),
    control(
      "EMS-031",
      "state-estimation",
      "Update hidden degradation state and confidence from imperfect measurements.",
      [POF],
      [POF_TEST],
    ),
    control(
      "EMS-032",
      "ram",
      "Preserve censoring, suspensions, incomplete histories and truncation context.",
      [TYPES, MIGRATION],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-033",
      "ram",
      "Cohort assets by duty, environment, age, maintenance and configuration.",
      [TYPES, MIGRATION],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-034",
      "calibration",
      "Require calibration data, holdout validation, residual checks and recalibration triggers.",
      [TYPES, VALIDATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-035",
      "uncertainty",
      "Separate parameter, measurement, model-form, operating-condition and scenario uncertainty.",
      [TYPES, VALIDATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-036",
      "decisions",
      "Make thresholds consequence-aware rather than applying one RUL response universally.",
      [TYPES, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-037",
      "inspection",
      "Represent value-of-information inspection planning.",
      [TYPES],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-038",
      "inspection",
      "Require probability-of-detection treatment for imperfect inspection and NDE.",
      [TYPES],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-039",
      "intervention",
      "Record how repair, lubrication, alignment, derating or replacement changes damage state without implicit reset.",
      [POF, MIGRATION],
      [POF_TEST],
    ),
    control(
      "EMS-040",
      "escalation",
      "Escalate structural, pressure-boundary and safety-critical cases to formal fitness-for-service or specialist review.",
      [TYPES, RESONANCE],
      [RESONANCE_TEST],
    ),
    control(
      "EMS-041",
      "rul",
      "Keep physical/safe remaining life separate from economic replacement timing.",
      [POF, TYPES],
      [POF_TEST],
    ),
    control(
      "EMS-042",
      "ram",
      "Require explicit common-cause assessment for shared design, environment, batch, maintenance or utility exposure.",
      [TYPES],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-043",
      "arbitration",
      "Surface empirical-versus-PoF disagreement and competing hypotheses for human resolution.",
      [POF, MIGRATION],
      [POF_TEST],
    ),
    control(
      "EMS-044",
      "rca",
      "Preserve human, procedural, contamination, vendor and configuration branches outside physics.",
      [TYPES, VALIDATION, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-045",
      "learning",
      "Record field outcomes, counterfactual review and design feedback against the exact model/run/work record.",
      [TYPES, MIGRATION],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-046",
      "retirement",
      "Retire or revalidate on bias, failed regression, invalid assumptions, configuration/dependency change or supersession.",
      [TYPES, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-047",
      "product",
      "Provide a governed tenant model-registry surface without exposing GPD as customer runtime UI.",
      [REGISTRY, "src/services/engineeringModelService.ts", CAPABILITY_ADAPTER],
      ["src/pages/EngineeringModelRegistryPage.test.tsx"],
    ),
    control(
      "EMS-048",
      "traceability",
      "Show exact model/version, verification, field validation, applicability, approval and refusals on influenced recommendations.",
      [TRACE, MIGRATION],
      ["src/components/EngineeringModelTracePanel.test.tsx"],
    ),
    control(
      "EMS-049",
      "evidence",
      "Bind model parameters and validation claims to canonical evidence with minimum grades.",
      [TYPES, MIGRATION, REGISTRY],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-050",
      "competency",
      "Require independent, domain-specific reviewer competency rather than generic approval.",
      [TYPES, MIGRATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-051",
      "sources",
      "Support deterministic physics, empirical/hybrid models, standards methods and OEM curves in one governed registry.",
      [TYPES, MIGRATION],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-052",
      "chemistry",
      "Require lab evidence where chemistry dominates instead of representing GPD as a chemistry authority.",
      [TYPES, VALIDATION],
      [VALIDATION_TEST],
    ),
    control(
      "EMS-053",
      "domains",
      "Represent tribology, fracture, creep, electrical reliability, rotating machinery, fluid and thermal reviewer domains.",
      [TYPES, MIGRATION],
      ["src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
    control(
      "EMS-054",
      "pilot",
      "Ship a bounded shaft vibration/resonance pilot with durable artifacts, deterministic evaluation and an approved-tolerance refusal.",
      [
        RESONANCE,
        "engineering-model-packs/vibration-resonance-v1/MANIFEST.json",
      ],
      [RESONANCE_TEST],
    ),
    control(
      "EMS-055",
      "closed-loop",
      "Complete measure → infer → predict → decide → intervene → verify → recalibrate using canonical ledgers.",
      [TYPES, POF, MIGRATION, TRACE],
      [POF_TEST, "src/test/engineeringModelSupplyChainMigration.test.ts"],
    ),
  ];

export const ENGINEERING_MODEL_SOURCE_CONTROL = {
  lineCount: 1109,
  byteCount: 53436,
  sha256: "7e5220417ca293674e4500671472e94ad8b2fac2832b235010f1fb61be11fb40",
} as const;
