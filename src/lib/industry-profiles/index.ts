/**
 * Industry profile architecture: binding packs to the kernel they claim to be
 * (register E1.01 common kernel + profile architecture, E1.06 differentiated
 * risk models per failure context, U5.x industry packs).
 *
 * WHAT WAS THERE, AND WHY IT REGISTERED AS ❌.
 *
 * Sixteen industry packs already existed in industry-template-packs.ts — 2,400
 * lines of asset classes, onboarding questions, risk drivers and KPI names.
 * All of it prose. A pack that says "process safety, pressure containment,
 * turnaround management" in a string list operates nothing: no engine runs
 * because the string is present, and no gap shows because it is missing. The
 * same shape as a twin template with no components — it registers as coverage
 * and reasons about nothing.
 *
 * Meanwhile the actual kernel now exists: censored Weibull with standards-
 * driven estimator selection, fault and event trees, RBDs compiled from the
 * dependency graph, Monte Carlo, schedule risk, PFD/SIL, alarm performance,
 * cost forecasting, verification obligations. None of it was connected to any
 * pack.
 *
 * THE ARCHITECTURE (E1.01).
 *
 * One kernel, many profiles. The kernel is the set of engines; a PROFILE is a
 * declaration of which failure contexts an industry actually has, and each
 * FAILURE CONTEXT binds to the engines that legitimately analyse it. The
 * binding is the architecture — and because it is data, the completeness of
 * any pack is MEASURABLE: which of its claimed contexts have a real engine
 * behind them, and which are still prose.
 *
 * WHY FAILURE CONTEXTS AND NOT INDUSTRIES (E1.06).
 *
 * A compressor trip, a haul-truck failure and a weld defect need different
 * risk models — but so do a refinery compressor trip and a data-centre chiller
 * trip need the SAME one. The reusable unit is the failure context, not the
 * industry. Industries differ in which contexts they contain and how the
 * consequences weigh, not in the mathematics of each context.
 *
 * Pure functions and data. No database, no network.
 */

/** The kernel: engines that actually exist, with where they live. */
export type KernelEngine =
  | "censored_weibull" // src/lib/reliability + method-selection
  | "crow_amsaa" // src/lib/reliability
  | "repairable_availability" // src/lib/reliability
  | "fault_event_trees" // src/lib/modelling/fault-tree
  | "rbd" // src/lib/modelling/rbd
  | "monte_carlo" // src/lib/modelling/monte-carlo
  | "schedule_risk" // src/lib/modelling/schedule-risk
  | "cost_forecast" // src/lib/modelling/cost-forecast
  | "pfd_sil" // process-safety module
  | "alarm_performance" // alarm_performance / EEMUA 191 benchmarks
  | "interval_optimization" // Barlow-Proschan age replacement
  | "spares_optimization" // Poisson lead-time demand
  | "cascade_interdependency" // interdependency module
  | "verification_loop" // verification_obligations
  | "symptom_coding" // src/lib/symptom-coding
  | "efficiency_degradation"; // environmental module

/**
 * A failure context: one kind of thing that goes wrong, with the risk model
 * that legitimately analyses it. This is the E1.06 unit of differentiation.
 */
export interface FailureContext {
  key: string;
  label: string;
  /** What the event physically is. */
  description: string;
  /** Engines with genuine standing on this context. */
  engines: KernelEngine[];
  /** The workflow shape: what must happen when one occurs. */
  workflow:
    | "safety_investigation"
    | "reliability_analysis"
    | "quality_containment"
    | "capacity_restoration";
  /** Data without which the context cannot be analysed, only logged. */
  requiredData: string[];
}

export const FAILURE_CONTEXTS: FailureContext[] = [
  {
    key: "process_trip",
    label: "Process trip / loss of containment risk",
    description:
      "A protective function operated or should have: trips, reliefs, SIS demands. The question is barrier health, not component life.",
    engines: [
      "pfd_sil",
      "fault_event_trees",
      "alarm_performance",
      "verification_loop",
    ],
    workflow: "safety_investigation",
    requiredData: [
      "protective function register",
      "demand and proof-test records",
      "alarm history",
    ],
  },
  {
    key: "mobile_plant_failure",
    label: "Mobile plant component failure",
    description:
      "A wear-driven component on a mobile machine reached end of life or failed early. The question is life distribution against operating hours.",
    engines: [
      "censored_weibull",
      "interval_optimization",
      "spares_optimization",
      "symptom_coding",
      "cost_forecast",
    ],
    workflow: "reliability_analysis",
    requiredData: [
      "operating hours (meter, not calendar)",
      "component change-out history with censoring",
      "failure narratives",
    ],
  },
  {
    key: "static_equipment_degradation",
    label: "Static equipment degradation",
    description:
      "Corrosion, erosion, fouling on vessels, piping, exchangers. Progresses continuously; the question is inspection timing and remaining life.",
    engines: [
      "efficiency_degradation",
      "interval_optimization",
      "verification_loop",
    ],
    workflow: "reliability_analysis",
    requiredData: [
      "inspection measurements over time",
      "design limits",
      "process conditions",
    ],
  },
  {
    key: "rotating_equipment_failure",
    label: "Rotating equipment failure",
    description:
      "Pumps, compressors, turbines. Condition-monitorable, often redundant; the question is redundancy-aware system risk.",
    engines: [
      "censored_weibull",
      "rbd",
      "monte_carlo",
      "repairable_availability",
      "cascade_interdependency",
    ],
    workflow: "reliability_analysis",
    requiredData: [
      "failure history per unit",
      "redundancy configuration",
      "condition monitoring where fitted",
    ],
  },
  {
    key: "quality_loss",
    label: "Quality loss / defect escape",
    description:
      "The plant ran but produced scrap or rework — a weld defect, an out-of-spec batch. The question is containment scope, then process capability.",
    engines: ["crow_amsaa", "verification_loop"],
    workflow: "quality_containment",
    requiredData: [
      "defect classification",
      "affected-lot traceability",
      "process parameters at time of production",
    ],
  },
  {
    key: "network_outage",
    label: "Network / distributed asset outage",
    description:
      "A distributed system lost service — feeder, span, main. Consequence scales with topology and restoration order, not asset value.",
    engines: ["cascade_interdependency", "rbd", "monte_carlo", "schedule_risk"],
    workflow: "capacity_restoration",
    requiredData: [
      "network topology / dependency graph",
      "customer-or-load mapping",
      "crew and restoration constraints",
    ],
  },
  {
    key: "turnaround_execution",
    label: "Turnaround / outage execution risk",
    description:
      "Planned shutdown work where duration is the risk. The question is schedule confidence, not failure probability.",
    engines: ["schedule_risk", "monte_carlo", "cost_forecast"],
    workflow: "capacity_restoration",
    requiredData: [
      "task network with duration ranges",
      "critical resource constraints",
    ],
  },
  {
    key: "structural_deterioration",
    label: "Structural / civil deterioration",
    description:
      "Slow, inspection-rated decline of structures. The question is deterioration rate against intervention windows.",
    engines: [
      "efficiency_degradation",
      "interval_optimization",
      "cost_forecast",
    ],
    workflow: "reliability_analysis",
    requiredData: [
      "condition ratings over time",
      "load and exposure data",
      "intervention cost model",
    ],
  },
];

/**
 * A profile: which contexts an industry pack actually contains. THIS is what
 * makes a pack operational rather than prose — each claimed capability area
 * resolves to contexts, and each context resolves to engines that exist.
 */
export interface IndustryProfile {
  industryCode: string;
  registerRef: string;
  contexts: string[];
  /** Pack claims that resolve to NO context — named, not hidden. */
  proseOnly: string[];
}

export const INDUSTRY_PROFILES: IndustryProfile[] = [
  {
    industryCode: "oil_sands",
    registerRef: "E1.02",
    contexts: [
      "process_trip",
      "mobile_plant_failure",
      "static_equipment_degradation",
      "rotating_equipment_failure",
      "turnaround_execution",
    ],
    proseOnly: ["tailings geotechnical assessment"],
  },
  {
    industryCode: "petrochemical",
    registerRef: "U5.01 / E1.03",
    contexts: [
      "process_trip",
      "static_equipment_degradation",
      "rotating_equipment_failure",
      "turnaround_execution",
    ],
    proseOnly: [
      "RBI corrosion-loop modelling (API 580/581 — in the standards register, engine not built)",
    ],
  },
  {
    industryCode: "oil_gas",
    registerRef: "U5.01",
    contexts: [
      "process_trip",
      "static_equipment_degradation",
      "rotating_equipment_failure",
      "turnaround_execution",
    ],
    proseOnly: ["well integrity"],
  },
  {
    industryCode: "manufacturing",
    registerRef: "U5.02 / E1.04",
    contexts: [
      "rotating_equipment_failure",
      "quality_loss",
      "turnaround_execution",
    ],
    proseOnly: [
      "takt/line-balancing optimisation",
      "robot-specific health models",
    ],
  },
  {
    industryCode: "mining",
    registerRef: "U5.03-adjacent",
    contexts: [
      "mobile_plant_failure",
      "rotating_equipment_failure",
      "network_outage",
      "turnaround_execution",
    ],
    proseOnly: [],
  },
  {
    industryCode: "transportation_logistics",
    registerRef: "U5.03",
    contexts: ["mobile_plant_failure", "turnaround_execution"],
    proseOnly: ["route/depot optimisation", "regulatory inspection scheduling"],
  },
  {
    industryCode: "utilities",
    registerRef: "U5.04",
    contexts: [
      "network_outage",
      "rotating_equipment_failure",
      "structural_deterioration",
    ],
    proseOnly: ["storm response mobilisation", "crew dispatch"],
  },
  {
    industryCode: "power_generation",
    registerRef: "U5.04-adjacent",
    contexts: [
      "process_trip",
      "rotating_equipment_failure",
      "turnaround_execution",
      "static_equipment_degradation",
    ],
    proseOnly: [],
  },
  {
    industryCode: "data_centers",
    registerRef: "U5.05-adjacent",
    contexts: ["rotating_equipment_failure", "network_outage"],
    proseOnly: ["thermal/airflow modelling"],
  },
  {
    industryCode: "pharmaceuticals",
    registerRef: "U5.06-adjacent",
    contexts: ["quality_loss", "rotating_equipment_failure", "process_trip"],
    proseOnly: ["GxP validation workflows", "batch-record integration"],
  },
];

export interface ContextBinding {
  key: string;
  label: string;
  engines: KernelEngine[];
  workflow: FailureContext["workflow"];
  requiredData: string[];
}

export interface ProfileAssessment {
  industryCode: string;
  registerRef: string;
  /** Contexts fully backed by kernel engines. */
  operational: ContextBinding[];
  /** Contexts declared in the profile that do not exist in the master list —
   *  a wiring error, surfaced loudly rather than dropped. */
  unknownContexts: string[];
  /** Pack claims with no engine behind them. */
  proseOnly: string[];
  /** Distinct engines this profile exercises. */
  enginesUsed: KernelEngine[];
  operationalShare: number;
  reason: string;
}

export function assessProfile(profile: IndustryProfile): ProfileAssessment {
  const byKey = new Map(FAILURE_CONTEXTS.map((c) => [c.key, c]));
  const operational: ContextBinding[] = [];
  const unknown: string[] = [];

  for (const key of profile.contexts) {
    const ctx = byKey.get(key);
    if (!ctx) {
      unknown.push(key);
      continue;
    }
    operational.push({
      key: ctx.key,
      label: ctx.label,
      engines: ctx.engines,
      workflow: ctx.workflow,
      requiredData: ctx.requiredData,
    });
  }

  const engines = [...new Set(operational.flatMap((c) => c.engines))];
  const claimed =
    operational.length + profile.proseOnly.length + unknown.length;
  const share = claimed > 0 ? operational.length / claimed : 0;

  return {
    industryCode: profile.industryCode,
    registerRef: profile.registerRef,
    operational,
    unknownContexts: unknown,
    proseOnly: profile.proseOnly,
    enginesUsed: engines,
    operationalShare: share,
    reason:
      `${operational.length} of ${claimed} claimed capability area(s) are operational — bound to ${engines.length} real kernel engine(s) with the workflow and required data named per context. ` +
      (profile.proseOnly.length > 0
        ? `${profile.proseOnly.length} remain prose: ${profile.proseOnly.join("; ")}. Named rather than hidden, because a claim with no engine behind it must not read as coverage. `
        : `Nothing in this pack is prose-only. `) +
      (unknown.length > 0
        ? `WIRING ERROR: ${unknown.join(", ")} resolve to no known failure context.`
        : ``),
  };
}

/**
 * The E1.06 check: two different failure contexts must produce genuinely
 * different treatment, or the differentiation is decorative.
 */
export interface DifferentiationCheck {
  differentiated: boolean;
  sharedEngines: KernelEngine[];
  distinctA: KernelEngine[];
  distinctB: KernelEngine[];
  differentWorkflow: boolean;
  reason: string;
}

export function checkDifferentiation(
  contextKeyA: string,
  contextKeyB: string,
): DifferentiationCheck {
  const a = FAILURE_CONTEXTS.find((c) => c.key === contextKeyA);
  const b = FAILURE_CONTEXTS.find((c) => c.key === contextKeyB);
  if (!a || !b) {
    return {
      differentiated: false,
      sharedEngines: [],
      distinctA: [],
      distinctB: [],
      differentWorkflow: false,
      reason: `Unknown context: ${!a ? contextKeyA : contextKeyB}.`,
    };
  }
  const setB = new Set(b.engines);
  const setA = new Set(a.engines);
  const shared = a.engines.filter((e) => setB.has(e));
  const distinctA = a.engines.filter((e) => !setB.has(e));
  const distinctB = b.engines.filter((e) => !setA.has(e));
  const differentWorkflow = a.workflow !== b.workflow;
  const differentiated =
    distinctA.length > 0 || distinctB.length > 0 || differentWorkflow;

  return {
    differentiated,
    sharedEngines: shared,
    distinctA,
    distinctB,
    differentWorkflow,
    reason: differentiated
      ? `"${a.label}" and "${b.label}" get genuinely different treatment: ` +
        (differentWorkflow
          ? `different workflows (${a.workflow} vs ${b.workflow})`
          : `the same workflow`) +
        `, ${distinctA.length + distinctB.length} engine(s) unique to one side` +
        (shared.length > 0
          ? `, ${shared.length} legitimately shared (the kernel is common by design — E1.01)`
          : ``) +
        `.`
      : `These two contexts bind to identical engines and the same workflow. If they are really different kinds of failure, the binding is wrong; if not, one of them should not exist.`,
  };
}
