export type ReliabilityClaimType =
  | "analysis_method"
  | "failure_behaviour"
  | "component_structure"
  | "maintenance_task"
  | "nameplate_spec";

export interface ReliabilitySpecialist {
  id: string;
  label: string;
  brief: string;
  claimTypes: ReliabilityClaimType[];
}

interface SpecialistDefinition extends ReliabilitySpecialist {
  signals: RegExp;
}

const SPECIALISTS: SpecialistDefinition[] = [
  {
    id: "rca-fracas",
    label: "RCA / FRACAS specialist",
    signals:
      /\b(root cause|rca|fracas|repeat|recurr|trip|failure|failed|mechanism|bad actor|defect elimination|post-trip)\b/i,
    brief:
      "Build a falsifiable problem statement and event boundary. Separate observations from causal hypotheses, rank competing mechanisms, identify discriminating tests, and define corrective-action effectiveness and recurrence closure. Never relabel correlation as root cause.",
    claimTypes: ["analysis_method", "failure_behaviour"],
  },
  {
    id: "ram",
    label: "RAM quantitative specialist",
    signals:
      /\b(mtbf|mttf|mttr|availability|reliability|maintainability|failure rate|hazard|weibull|poisson|confidence bound|mission reliability|ram\b)/i,
    brief:
      "Validate the population, exposure, event boundary, censoring, repair-time definition, units, and model assumptions before calculating. Show formulas and arithmetic. State what the result can and cannot prove, and refuse invalid precision when denominators or event definitions are missing.",
    claimTypes: ["analysis_method", "failure_behaviour"],
  },
  {
    id: "fmea-rcm-pm",
    label: "FMEA / RCM / PM strategy specialist",
    signals:
      /\b(fmea|fmeca|rcm|maintenance strategy|pm |preventive|inspection interval|task interval|p-f interval|proof test|on-condition|condition-based|failure mode|hidden failure)\b/i,
    brief:
      "Start with functions, functional failures, failure modes, effects, consequences, and task technical applicability. Reject calendar changes based only on zero recorded failures. Tie intervals to failure behaviour, detection capability, P-F interval or proof-test evidence, and consequence-based approval.",
    claimTypes: ["analysis_method", "failure_behaviour", "maintenance_task"],
  },
  {
    id: "condition-monitoring",
    label: "Condition monitoring specialist",
    signals:
      /\b(vibration|oil sample|lubricant|thermography|ultrasound|sensor|historian|calibration|alarm|trip setpoint|trend|condition monitoring)\b/i,
    brief:
      "Check measurement-chain integrity, sampling conditions, alarm provenance, baselines, operating-state normalization, and coverage gaps. Distinguish a trustworthy physical observation from a sensor, scaling, logic, or data-quality problem.",
    claimTypes: [
      "failure_behaviour",
      "component_structure",
      "maintenance_task",
      "nameplate_spec",
    ],
  },
  {
    id: "authority-risk",
    label: "Technical authority / risk specialist",
    signals:
      /\b(safety|environment|regulatory|critical|approval|authority|moc|change control|bypass|setpoint|protective|interlock|oem limit|risk)\b/i,
    brief:
      "Identify the consequence of being wrong, preserve protective functions and approved operating envelopes, distinguish recommendation from authorization, and name the technical authority, MOC, OEM, safety, environmental, or regulatory gates that apply.",
    claimTypes: ["analysis_method", "nameplate_spec"],
  },
  {
    id: "lifecycle-value",
    label: "Lifecycle / spares / value specialist",
    signals:
      /\b(value|roi|cost|dollar|downtime|production loss|lost tonnes|spare|inventory|lead time|replace|repair|overhaul|lifecycle|life cycle|capex|opex)\b/i,
    brief:
      "Compare options on consequence, lead time, reversibility, uncertainty, transferred risk, and total lifecycle exposure. Separate forecast, authorized value, and verified realized value. Define the baseline, attribution boundary, observation window, finance owner, and disconfirming indicators.",
    claimTypes: ["analysis_method", "component_structure", "maintenance_task"],
  },
  {
    id: "mro-inventory",
    label: "MRO inventory / critical spares specialist",
    signals:
      /\b(inventory|spare parts?|critical spares?|insurance spare|stockout|reorder point|safety stock|min\/?max|abc\/?xyz|fsn|eoq|intermittent demand|rotable|repairable|obsolescence|obsolete|material master|sku|uom|cycle count|warehouse|storeroom|shutdown spares?|turnaround materials?|consignment|vmi|working capital|supplier lead time)\b/i,
    brief:
      "Segment inventory by demand behavior, criticality, consequence, redundancy, lead time, repairability, and service target. Treat intermittent demand and insurance spares differently from consumables. Challenge min/max, reorder point, safety stock, repairable-pool, shutdown-readiness, obsolescence, duplicate-material, supplier, and preservation assumptions. Quantify cash release and stockout exposure without optimizing working capital at the expense of asset risk.",
    claimTypes: ["analysis_method", "component_structure", "maintenance_task"],
  },
  {
    id: "planning-scheduling",
    label: "Maintenance Planning & Scheduling specialist",
    signals:
      /\b(job plan|work planning|maintenance schedul|weekly schedule|lookahead|six-week|6-week|backlog|ready to schedule|work readiness|schedule compliance|schedule attainment|planned work|break-in work|wrench time|resource load|labor demand|labour demand|craft capacity|shutdown|turnaround|scope freeze|critical path|work order|task list|planner|scheduler)\b/i,
    brief:
      "Turn approved technical intent into executable work. Validate job scope, task sequence, labor and craft hours, materials, tools, services, permits, isolations, drawings, access, operations coordination, duration, dependencies, and readiness before schedule commitment. Rank backlog by consequence and readiness, level-load resource demand, preserve frozen-schedule governance, and define technician feedback and schedule-attainment measures. Do not let scheduling urgency override technical authority or missing safety controls.",
    claimTypes: ["analysis_method", "component_structure", "maintenance_task"],
  },
];

const GENERAL_SPECIALIST: ReliabilitySpecialist = {
  id: "general-reliability",
  label: "Senior reliability generalist",
  brief:
    "Frame the decision before solving it. Establish the asset/function boundary, known evidence, uncertainty, consequence, defensible next action, accountable owner, approval boundary, and measurable outcome.",
  claimTypes: ["analysis_method", "failure_behaviour"],
};

export function selectReliabilitySpecialists(
  question: string,
): ReliabilitySpecialist[] {
  const selected = SPECIALISTS.filter((specialist) =>
    specialist.signals.test(question),
  ).slice(0, 4);
  return selected.length ? selected : [GENERAL_SPECIALIST];
}

export function specialistClaimTypes(
  specialists: ReliabilitySpecialist[],
): ReliabilityClaimType[] {
  return [
    ...new Set(specialists.flatMap((specialist) => specialist.claimTypes)),
  ];
}

export function buildSpecialistBrief(
  specialists: ReliabilitySpecialist[],
): string {
  return specialists
    .map((specialist) => `- ${specialist.label}: ${specialist.brief}`)
    .join("\n");
}
