export type DecisionCaseStage =
  | "intent"
  | "asset_truth"
  | "evidence"
  | "analysis"
  | "authority"
  | "execution"
  | "outcomes"
  | "learning";

export type EvidenceQuality = "high" | "medium" | "missing" | "conflict";
export type DecisionIndustryId = "oil-gas" | "mining" | "manufacturing";
export type ApprovalStatus =
  | "complete"
  | "reviewing"
  | "next"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "delegated";

export interface DecisionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  author: string;
  text: string;
  createdAt: string;
  meta?: string;
}

export interface DecisionEvidence {
  id: string;
  title: string;
  summary: string;
  quality: EvidenceQuality;
  state: string;
  record: string;
  finding: string;
  lineage: string;
  sourceSystem: string;
}

export interface DecisionApproval {
  id: string;
  initials: string;
  name: string;
  role: string;
  responsibility: string;
  status: ApprovalStatus;
  decidedAt?: string;
}

export interface DecisionCalculation {
  id: string;
  label: string;
  formula: string;
  result: string;
  sourceEvidenceIds: string[];
  assumption: string;
}

export interface DecisionCase {
  id: string;
  caseNumber: string;
  version: string;
  organization: string;
  site: string;
  industry?: DecisionIndustryId;
  title: string;
  objective: string;
  asset: string;
  assetContext: string;
  risk: "critical" | "material" | "moderate";
  valueExposure: number;
  evidenceScore: number;
  authorityRole: string;
  statusLabel: string;
  stage: DecisionCaseStage;
  updatedAt: string;
  createdFromIntake: boolean;
  intakeRole: string;
  recommendation: string;
  recommendationDetail: string;
  priorityReason: string;
  decisionMetrics: Array<{ label: string; value: string; detail: string }>;
  evidence: DecisionEvidence[];
  calculations: DecisionCalculation[];
  approvals: DecisionApproval[];
  comments: Array<{
    id: string;
    author: string;
    text: string;
    createdAt: string;
  }>;
  workPackage: {
    id: string;
    number: string;
    title: string;
    targetSystem: string;
    status: "locked" | "released" | "in_progress" | "complete";
    receipt?: {
      externalId: string;
      status: "simulated" | "accepted" | "synced";
      releasedAt: string;
      lastSync: string;
    };
    controls: Array<{
      id: string;
      text: string;
      owner: string;
      status: "ready" | "control" | "complete";
    }>;
  };
  valueMetrics: Array<{
    id: string;
    label: string;
    detail: string;
    baseline: string;
    target: string;
    actual?: string;
    verifiedActual: string;
  }>;
  financeSponsor: string;
  financeStatus: "baseline_approved" | "pending" | "verified";
  learningRecord?: {
    id: string;
    status: "candidate" | "retained";
    summary: string;
  };
  messages: DecisionMessage[];
  tokensUsed: number;
  tokenAllowance: number;
  billingMode: "complimentary" | "pay_per_use" | "workspace" | "paused";
}

export interface DecisionJourneyContext {
  asset?: string;
  pain?: string;
  role?: string;
  company?: string;
  system?: string;
  intakeId?: string;
  industry?: DecisionIndustryId;
}

export const DECISION_CASE_STORAGE_KEY = "syncai.decisionCases.v2";
export const PUBLIC_DECISION_CASE_STORAGE_KEY = "syncai.publicDecisionCases.v2";
export const PENDING_DECISION_CASE_HANDOFF_KEY =
  "syncai.pendingDecisionCaseHandoff.v1";
export const DEFAULT_DECISION_CASE_ID = "dc-1048";
const seedTime = "2026-08-12T16:00:00.000Z";

export interface DecisionIndustryPack {
  id: DecisionIndustryId;
  label: string;
  shortLabel: string;
  proofLine: string;
  roles: string[];
  nextDollarPrompt: string;
}

export const DECISION_INDUSTRY_PACKS: DecisionIndustryPack[] = [
  {
    id: "oil-gas",
    label: "Oil & Gas",
    shortLabel: "Energy",
    proofLine: "Production reliability · integrity · governed change",
    roles: [
      "Reliability Engineer",
      "Maintenance Manager",
      "Operations Authority",
      "Executive / finance sponsor",
    ],
    nextDollarPrompt:
      "Which production-risk exposure should receive the next dollar, and how will we verify value?",
  },
  {
    id: "mining",
    label: "Mining",
    shortLabel: "Mining",
    proofLine: "Throughput · mobile fleet · processing reliability",
    roles: [
      "Reliability Engineer",
      "Maintenance Superintendent",
      "Processing Operations Authority",
      "Asset Manager / finance sponsor",
    ],
    nextDollarPrompt:
      "Which lost-tonnage exposure should receive the next dollar, and how will we verify recovery?",
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    shortLabel: "Manufacturing",
    proofLine: "Line performance · quality · controlled production change",
    roles: [
      "Reliability Engineer",
      "Maintenance Manager",
      "Production Authority",
      "Plant Manager / finance sponsor",
    ],
    nextDollarPrompt:
      "Which production-loss exposure should receive the next dollar, and how will we verify improvement?",
  },
];

export function normalizeDecisionIndustry(
  value: string | null | undefined,
): DecisionIndustryId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "mining") return "mining";
  if (
    normalized === "manufacturing" ||
    normalized === "manufacture" ||
    normalized === "factory"
  ) {
    return "manufacturing";
  }
  return "oil-gas";
}

export function getDecisionIndustryPack(
  industry: DecisionIndustryId,
): DecisionIndustryPack {
  return (
    DECISION_INDUSTRY_PACKS.find((pack) => pack.id === industry) ||
    DECISION_INDUSTRY_PACKS[0]
  );
}

export function getPublicDecisionCaseStorageKey(
  industry: DecisionIndustryId,
): string {
  return `${PUBLIC_DECISION_CASE_STORAGE_KEY}.${industry}`;
}

export interface PendingDecisionCaseHandoff {
  decisionCase: DecisionCase;
  stagedAt: string;
}

function pumpCase(context: DecisionJourneyContext): DecisionCase {
  const asset = context.asset || "P-101 process pump";
  const role = context.role || "Reliability Engineering";
  const createdFromIntake = Boolean(
    context.asset || context.pain || context.role || context.intakeId,
  );
  const evidence: DecisionEvidence[] = [
    {
      id: "ev-cmms",
      title: "CMMS work history",
      summary: "18 records reconciled to the P-101 hierarchy",
      quality: "high",
      state: "Governed · reconciled",
      record: "WO-3812 through WO-4760 · 18 records",
      finding:
        "Five seal failures occurred in nine months; four were recorded within twelve hours of startup.",
      lineage: "Asset P-101 → failure code SEAL → startup timestamp join",
      sourceSystem: context.system || "CMMS / EAM",
    },
    {
      id: "ev-basis",
      title: "Maintenance basis rev. 6",
      summary: "Approved requirement and authority boundary",
      quality: "high",
      state: "Approved · current",
      record: "MB-P101-006 · approved 2025-11-18",
      finding:
        "Inspection interval changes require Reliability Engineering approval.",
      lineage: "Controlled requirement 4.2.3 → authority map REL-ENG",
      sourceSystem: "Engineering document control",
    },
    {
      id: "ev-vibration",
      title: "Vibration history",
      summary: "Partial operating coverage across the review period",
      quality: "medium",
      state: "Partial · 67% coverage",
      record: "PI-VIB-P101 · 2025-09 to 2026-05",
      finding:
        "Startup transients are visible, but three operating periods have no sensor coverage.",
      lineage: "Historian validation → operating-state segmentation",
      sourceSystem: "Process historian",
    },
    {
      id: "ev-solids",
      title: "Startup solids sample",
      summary: "Required to test the suspected failure mechanism",
      quality: "missing",
      state: "Missing · blocks mechanism confirmation",
      record: "No governed startup sample found",
      finding:
        "Solids concentration during startup cannot yet be tested as a causal contributor.",
      lineage: "Required by evidence plan EP-1048-02",
      sourceSystem: "Laboratory information system",
    },
    {
      id: "ev-flush",
      title: "Seal flush configuration",
      summary: "Approved drawing conflicts with a field note",
      quality: "conflict",
      state: "Conflict · authority resolution required",
      record: "Drawing P101-M-044 vs. field note FN-882",
      finding:
        "The approved drawing and field-observed restriction size do not agree.",
      lineage: "Configuration comparison → technical query TQ-1048-01",
      sourceSystem: "Engineering document control",
    },
  ];

  return {
    id: DEFAULT_DECISION_CASE_ID,
    caseNumber: "DC-1048",
    version: "v0.4",
    organization: context.company || "North Ridge Energy",
    site: "Central Processing Facility · Unit 1",
    industry: "oil-gas",
    title: `Decide whether ${asset}'s seal inspection interval can safely change`,
    objective: `${context.pain || "Repeat failures on critical assets"}. Rank the governed action, approval requirement, and value-verification plan.`,
    asset,
    assetContext: "Process water · Unit 1",
    risk: "material",
    valueExposure: 210000,
    evidenceScore: 76,
    authorityRole: role.includes("Executive")
      ? role
      : "Reliability Engineering",
    statusLabel: "Technical review",
    stage: "authority",
    updatedAt: seedTime,
    createdFromIntake,
    intakeRole: role,
    recommendation: "Do not approve the yearly inspection interval.",
    recommendationDetail:
      "Keep the monthly interval temporarily. Authorize a controlled 30-day startup evidence plan, then reassess a staged extension to quarterly.",
    priorityReason:
      "Material downtime exposure, an unresolved startup mechanism, and a decision-ready controlled trial make this the next governable action.",
    decisionMetrics: [
      { label: "Seal failures", value: "5", detail: "in 9 months" },
      { label: "Downtime", value: "180 h", detail: "documented" },
      { label: "Startup-linked", value: "80%", detail: "of failures" },
    ],
    evidence,
    calculations: [
      {
        id: "calc-failure-count",
        label: "Seal-failure count",
        formula:
          "COUNT(work orders where asset = P-101 and failure code = SEAL)",
        result: "5 failures in 9 months",
        sourceEvidenceIds: ["ev-cmms"],
        assumption:
          "Repeat corrective work on the same seal mechanism is counted once per work order.",
      },
      {
        id: "calc-downtime",
        label: "Seal-related downtime",
        formula: "SUM(downtime hours for the 5 governed seal-failure records)",
        result: "180 hours",
        sourceEvidenceIds: ["ev-cmms"],
        assumption: "Only approved CMMS downtime entries are included.",
      },
      {
        id: "calc-startup",
        label: "Startup concentration",
        formula: "4 startup-linked failures / 5 seal failures × 100",
        result: "80% startup-linked",
        sourceEvidenceIds: ["ev-cmms", "ev-vibration"],
        assumption:
          "Startup-linked means within twelve hours of a recorded start event.",
      },
    ],
    approvals: [
      {
        id: "ap-analysis",
        initials: "AI",
        name: "SyncAI analysis",
        role: "Governed engineering intelligence",
        responsibility: "Evidence, calculations, and recommendation",
        status: "complete",
      },
      {
        id: "ap-reliability",
        initials: "MT",
        name: "M. Tran",
        role: "Reliability Engineer",
        responsibility: "Technical scope and failure mechanism",
        status: "reviewing",
      },
      {
        id: "ap-maintenance",
        initials: "SK",
        name: "S. Khan",
        role: "Maintenance Manager",
        responsibility: "Execution window and work controls",
        status: "next",
      },
      {
        id: "ap-operations",
        initials: "JL",
        name: "J. Lee",
        role: "Operations Authority",
        responsibility: "Startup sampling access",
        status: "next",
      },
    ],
    comments: [
      {
        id: "comment-1",
        author: "M. Tran",
        text: "Confirm the seal-flush restriction before releasing the evidence trial.",
        createdAt: seedTime,
      },
    ],
    workPackage: {
      id: "wp-7215",
      number: "WP-7215",
      title: "P-101 startup evidence trial",
      targetSystem: context.system || "IBM Maximo",
      status: "locked",
      controls: [
        {
          id: "control-1",
          text: "Collect startup solids samples at suction and seal flush",
          owner: "Operations",
          status: "ready",
        },
        {
          id: "control-2",
          text: "Verify the field restriction against drawing P101-M-044",
          owner: "Maintenance",
          status: "ready",
        },
        {
          id: "control-3",
          text: "Capture flush pressure and vibration trend for ten starts",
          owner: "Reliability",
          status: "ready",
        },
        {
          id: "control-4",
          text: "Stop if seal temperature or vibration exceeds the approved limit",
          owner: "Control",
          status: "control",
        },
      ],
    },
    valueMetrics: [
      {
        id: "value-downtime",
        label: "Seal-related downtime",
        detail: "Rolling 90 days",
        baseline: "180 h",
        target: "≤ 20 h",
        verifiedActual: "14 h",
      },
      {
        id: "value-startups",
        label: "Startup exceptions",
        detail: "Per 10 starts",
        baseline: "4",
        target: "0",
        verifiedActual: "0",
      },
      {
        id: "value-effort",
        label: "Inspection effort",
        detail: "Annualized",
        baseline: "48 h",
        target: "16 h",
        verifiedActual: "16 h",
      },
      {
        id: "value-avoided",
        label: "Avoided downtime value",
        detail: "Finance-approved rate",
        baseline: "$0",
        target: "$210k",
        verifiedActual: "$196k",
      },
    ],
    financeSponsor: "A. Morgan",
    financeStatus: "baseline_approved",
    messages: [
      {
        id: "message-system",
        role: "system",
        author: "SyncAI",
        text: createdFromIntake
          ? "The value-proof intake was converted into a governed Decision Case with its asset scope, sponsor outcome, and available evidence."
          : "A governed Decision Case is ready with asset context, available evidence, authority boundaries, and a value-verification plan.",
        createdAt: seedTime,
        meta: createdFromIntake ? "One-click onboarding" : "Governed workspace",
      },
      {
        id: "message-user",
        role: "user",
        author: "You",
        text: `Can we extend ${asset}'s seal inspection from monthly to yearly? Give me the decision, risks, missing evidence, and approval requirement.`,
        createdAt: seedTime,
      },
      {
        id: "message-assistant",
        role: "assistant",
        author: "SyncAI",
        text: "The available evidence does not support moving directly from monthly to yearly inspection. The repeated startup-linked failures indicate an unresolved operating or contamination mechanism. Keep the monthly interval, run the controlled evidence trial, and require Reliability Engineering approval before changing maintenance strategy.",
        createdAt: seedTime,
        meta: "Deterministic analysis · governed recommendation",
      },
    ],
    tokensUsed: 4158,
    tokenAllowance: 12000,
    billingMode: "complimentary",
  };
}

function compressorCase(context: DecisionJourneyContext = {}): DecisionCase {
  const base = pumpCase(context);
  return {
    ...base,
    id: "dc-1049",
    caseNumber: "DC-1049",
    version: "v0.3",
    site: "Compression Station · Unit 2",
    title: "Determine what is driving C-204 repeat compressor trips",
    objective:
      "Resolve the configuration conflict and authorize the smallest controlled operating intervention.",
    asset: "C-204 compressor",
    assetContext: "Gas compression · Unit 2",
    risk: "critical",
    valueExposure: 420000,
    evidenceScore: 82,
    authorityRole: "Operations Authority",
    statusLabel: "Evidence conflict",
    stage: "evidence",
    createdFromIntake: false,
    intakeRole: "Operations Authority",
    recommendation: "Do not authorize a permanent mechanical change yet.",
    recommendationDetail:
      "Resolve the hot-alignment record conflict and collect operating-state vibration, process-rate, and support-condition evidence before selecting an intervention.",
    priorityReason:
      "This case ranks first because it combines critical trip consequence, $420k exposure, and a configuration conflict that can be resolved before capital is committed.",
    decisionMetrics: [
      { label: "Repeat trips", value: "4", detail: "in 5 months" },
      { label: "Downtime", value: "102 h", detail: "trip-related" },
      { label: "Rate-linked", value: "75%", detail: "of trips" },
    ],
    evidence: [
      {
        id: "ev-c204-events",
        title: "Trip and work history",
        summary: "11 records reconciled to the C-204 hierarchy",
        quality: "high",
        state: "Governed · reconciled",
        record: "TRIP-204-019 through WO-5931 · 11 records",
        finding:
          "Four high-vibration trips caused 102 downtime hours; three occurred above 88% process rate.",
        lineage:
          "Asset C-204 → trip code VIB-HI → operating-rate timestamp join",
        sourceSystem: "Historian and CMMS / EAM",
      },
      {
        id: "ev-c204-spectrum",
        title: "Operating-state vibration",
        summary: "Drive-end spectra aligned to three of four trips",
        quality: "medium",
        state: "Partial · 75% event coverage",
        record: "VIB-C204-2026Q1Q2 · 3 aligned trip windows",
        finding:
          "The 1× response rises with process rate, but one trip has no retained spectrum.",
        lineage: "Trip timestamp → operating state → spectrum archive",
        sourceSystem: "Condition monitoring platform",
      },
      {
        id: "ev-c204-alignment",
        title: "Hot-alignment record",
        summary: "Approved tolerance conflicts with the latest field sheet",
        quality: "conflict",
        state: "Conflict · authority resolution required",
        record: "AL-C204-018 vs. field sheet FS-204-77",
        finding:
          "The field offset exceeds the approved tolerance, but instrument traceability is incomplete.",
        lineage: "Alignment standard 7.1 → field measurement comparison",
        sourceSystem: "Engineering document control",
      },
      {
        id: "ev-c204-process",
        title: "Process-rate history",
        summary: "Complete rate, pressure, and temperature context",
        quality: "high",
        state: "Governed · complete",
        record: "PI-C204-OPS · 2026-01 to 2026-05",
        finding:
          "Three trips followed operation above 88% rate; suction conditions remained inside the approved envelope.",
        lineage: "Historian quality validation → operating-state segmentation",
        sourceSystem: "Process historian",
      },
      {
        id: "ev-c204-support",
        title: "Support and pipe-strain survey",
        summary: "Required before permanent mechanical change",
        quality: "missing",
        state: "Missing · blocks intervention selection",
        record: "No governed survey found after WO-5884",
        finding:
          "Support looseness, soft foot, and pipe strain have not been eliminated as contributors.",
        lineage: "Required by evidence plan EP-1049-01",
        sourceSystem: "Inspection management",
      },
    ],
    calculations: [
      {
        id: "calc-c204-trips",
        label: "Repeat-trip count",
        formula: "COUNT(events where asset = C-204 and trip code = VIB-HI)",
        result: "4 trips in 5 months",
        sourceEvidenceIds: ["ev-c204-events"],
        assumption:
          "A trip is counted once using the initiating event timestamp.",
      },
      {
        id: "calc-c204-downtime",
        label: "Trip-related downtime",
        formula: "SUM(CMMS downtime linked to the 4 governed trip events)",
        result: "102 hours",
        sourceEvidenceIds: ["ev-c204-events"],
        assumption:
          "Only downtime linked to the initiating vibration trip is included.",
      },
      {
        id: "calc-c204-rate",
        label: "High-rate concentration",
        formula: "3 trips above 88% process rate / 4 governed trips × 100",
        result: "75% rate-linked",
        sourceEvidenceIds: ["ev-c204-events", "ev-c204-process"],
        assumption:
          "High rate is the approved operating-state threshold of 88%.",
      },
    ],
    approvals: [
      base.approvals[0],
      {
        id: "ap-c204-operations",
        initials: "DO",
        name: "D. Okafor",
        role: "Operations Authority",
        responsibility: "Operating envelope and controlled evidence window",
        status: "reviewing",
      },
      {
        id: "ap-c204-reliability",
        initials: "MT",
        name: "M. Tran",
        role: "Reliability Engineer",
        responsibility: "Vibration mechanism and evidence sufficiency",
        status: "next",
      },
      {
        id: "ap-c204-maintenance",
        initials: "SK",
        name: "S. Khan",
        role: "Maintenance Manager",
        responsibility: "Survey execution and mechanical controls",
        status: "next",
      },
    ],
    comments: [
      {
        id: "comment-c204-1",
        author: "D. Okafor",
        text: "Resolve the alignment measurement traceability before authorizing work.",
        createdAt: seedTime,
      },
    ],
    workPackage: {
      id: "wp-7221",
      number: "WP-7221",
      title: "C-204 operating-state evidence capture",
      targetSystem: "IBM Maximo",
      status: "locked",
      controls: [
        {
          id: "control-c204-1",
          text: "Capture vibration spectra at 60%, 75%, and 90% process rate",
          owner: "Reliability",
          status: "ready",
        },
        {
          id: "control-c204-2",
          text: "Repeat hot alignment with a traceable instrument",
          owner: "Maintenance",
          status: "ready",
        },
        {
          id: "control-c204-3",
          text: "Survey support condition, soft foot, and connected pipe strain",
          owner: "Mechanical",
          status: "ready",
        },
        {
          id: "control-c204-4",
          text: "Stop the trial at the approved vibration trip threshold",
          owner: "Operations",
          status: "control",
        },
      ],
    },
    valueMetrics: [
      {
        id: "value-downtime",
        label: "Trip-related downtime",
        detail: "Rolling 90 days",
        baseline: "102 h",
        target: "≤ 10 h",
        verifiedActual: "8 h",
      },
      {
        id: "value-startups",
        label: "Unplanned vibration trips",
        detail: "Per 30 operating days",
        baseline: "4",
        target: "0",
        verifiedActual: "0",
      },
      {
        id: "value-effort",
        label: "Operating-state coverage",
        detail: "Across approved rate bands",
        baseline: "52%",
        target: "≥ 95%",
        verifiedActual: "98%",
      },
      {
        id: "value-avoided",
        label: "Avoided trip exposure",
        detail: "Finance-approved rate",
        baseline: "$0",
        target: "$420k",
        verifiedActual: "$388k",
      },
    ],
    financeSponsor: "R. Chen",
    financeStatus: "baseline_approved",
    messages: [
      {
        id: "message-c204-system",
        role: "system",
        author: "SyncAI",
        text: "A governed compressor Decision Case is ready with isolated evidence, authority boundaries, and a value-verification plan.",
        createdAt: seedTime,
        meta: "Governed workspace",
      },
      {
        id: "message-c204-user",
        role: "user",
        author: "You",
        text: "What is driving C-204's repeat vibration trips, and what should we authorize next?",
        createdAt: seedTime,
      },
      {
        id: "message-c204-assistant",
        role: "assistant",
        author: "SyncAI",
        text: "Do not authorize a permanent mechanical change yet. Four governed vibration trips caused 102 hours of downtime, and three occurred above 88% process rate. Resolve the alignment conflict and collect the missing support-condition evidence before selecting an intervention.",
        createdAt: seedTime,
        meta: "Deterministic analysis · governed recommendation",
      },
    ],
    tokensUsed: 2760,
  };
}

function boilerCase(context: DecisionJourneyContext = {}): DecisionCase {
  const base = pumpCase(context);
  return {
    ...base,
    id: "dc-1036",
    caseNumber: "DC-1036",
    version: "v1.0",
    site: "Utilities · Boiler House",
    title: "Verify whether the B-12 efficiency intervention created value",
    objective:
      "Close the normalized operating evidence window and obtain finance sign-off on realized energy value.",
    asset: "B-12 boiler",
    assetContext: "Steam generation · Boiler house",
    risk: "moderate",
    valueExposure: 178000,
    evidenceScore: 91,
    authorityRole: "Finance Sponsor",
    statusLabel: "Value verification",
    stage: "outcomes",
    createdFromIntake: false,
    intakeRole: "Executive / finance sponsor",
    recommendation: "Complete the 30-day normalized efficiency comparison.",
    recommendationDetail:
      "The controlled combustion intervention is complete. Finance sign-off is pending the final normalized fuel and production comparison.",
    priorityReason:
      "Execution is complete and the remaining work is a low-effort finance verification that can convert measured performance into retained value.",
    decisionMetrics: [
      { label: "Fuel intensity", value: "−8.6%", detail: "normalized" },
      { label: "Evidence window", value: "27/30", detail: "days complete" },
      { label: "Value confidence", value: "91%", detail: "decision-ready" },
    ],
    evidence: [
      {
        id: "ev-b12-fuel",
        title: "Fuel and steam history",
        summary: "27 normalized operating days retained",
        quality: "high",
        state: "Governed · reconciled",
        record: "PI-B12-EFF · 2026-06-01 to 2026-06-27",
        finding:
          "Normalized fuel intensity is 8.6% below the approved baseline across comparable production conditions.",
        lineage: "Fuel flow + steam production → approved normalization model",
        sourceSystem: "Process historian",
      },
      {
        id: "ev-b12-baseline",
        title: "Finance baseline",
        summary: "Approved energy rate and comparison boundary",
        quality: "high",
        state: "Approved · current",
        record: "FIN-B12-2026-04 · approved 2026-05-28",
        finding:
          "The approved baseline rate supports up to $178k annualized value at the target efficiency.",
        lineage: "Utility invoice rate → finance baseline approval",
        sourceSystem: "Finance planning",
      },
      {
        id: "ev-b12-production",
        title: "Production normalization",
        summary: "Steam demand and ambient corrections applied",
        quality: "high",
        state: "Governed · complete",
        record: "MODEL-B12-NORM-03 · 27 daily comparisons",
        finding:
          "All retained days remain inside the approved steam-demand and ambient-temperature envelope.",
        lineage: "Historian inputs → controlled model version 3",
        sourceSystem: "Engineering analytics",
      },
      {
        id: "ev-b12-window",
        title: "Final verification window",
        summary: "Three comparable operating days remain",
        quality: "missing",
        state: "Pending · 3 days required",
        record: "Days 28 through 30 not yet closed",
        finding:
          "Finance verification remains locked until the 30-day window is complete.",
        lineage: "Verification plan VP-1036-01",
        sourceSystem: "Value assurance",
      },
    ],
    calculations: [
      {
        id: "calc-b12-intensity",
        label: "Normalized fuel-intensity change",
        formula:
          "(post-intervention intensity − baseline intensity) / baseline intensity × 100",
        result: "−8.6%",
        sourceEvidenceIds: ["ev-b12-fuel", "ev-b12-production"],
        assumption:
          "Only days within the approved steam-demand and ambient envelope are retained.",
      },
      {
        id: "calc-b12-value",
        label: "Annualized value at target",
        formula:
          "verified fuel reduction × approved energy rate × annual operating days",
        result: "$178k target",
        sourceEvidenceIds: ["ev-b12-fuel", "ev-b12-baseline"],
        assumption:
          "Finance-approved energy rate remains valid for the verification period.",
      },
    ],
    approvals: [
      base.approvals[0],
      {
        id: "ap-b12-finance",
        initials: "AM",
        name: "A. Morgan",
        role: "Finance Sponsor",
        responsibility: "Baseline, normalization boundary, and realized value",
        status: "reviewing",
      },
      {
        id: "ap-b12-operations",
        initials: "JL",
        name: "J. Lee",
        role: "Operations Authority",
        responsibility: "Comparable operating-window confirmation",
        status: "approved",
        decidedAt: seedTime,
      },
    ],
    comments: [
      {
        id: "comment-b12-1",
        author: "A. Morgan",
        text: "Close the final three comparable days before recording realized value.",
        createdAt: seedTime,
      },
    ],
    workPackage: {
      id: "wp-7152",
      number: "WP-7152",
      title: "B-12 combustion optimization",
      targetSystem: "IBM Maximo",
      status: "complete",
      receipt: {
        externalId: "MAX-WO-7152",
        status: "synced",
        releasedAt: "2026-06-01T14:22:00.000Z",
        lastSync: seedTime,
      },
      controls: [
        {
          id: "control-b12-1",
          text: "Apply the approved combustion-control settings",
          owner: "Operations",
          status: "complete",
        },
        {
          id: "control-b12-2",
          text: "Retain fuel, steam, oxygen, and ambient conditions",
          owner: "Performance",
          status: "complete",
        },
      ],
    },
    valueMetrics: [
      {
        id: "value-downtime",
        label: "Normalized fuel intensity",
        detail: "Per tonne of steam",
        baseline: "1.00",
        target: "≤ 0.92",
        verifiedActual: "0.914",
      },
      {
        id: "value-startups",
        label: "Comparable evidence days",
        detail: "Approved window",
        baseline: "0",
        target: "30",
        verifiedActual: "30",
      },
      {
        id: "value-effort",
        label: "Efficiency improvement",
        detail: "Normalized",
        baseline: "0%",
        target: "≥ 8%",
        verifiedActual: "8.6%",
      },
      {
        id: "value-avoided",
        label: "Verified energy value",
        detail: "Annualized",
        baseline: "$0",
        target: "$178k",
        verifiedActual: "$171k",
      },
    ],
    financeSponsor: "A. Morgan",
    financeStatus: "pending",
    messages: [
      {
        id: "message-b12-system",
        role: "system",
        author: "SyncAI",
        text: "The completed B-12 intervention is in its governed value-verification window.",
        createdAt: seedTime,
        meta: "Outcome verification",
      },
      {
        id: "message-b12-assistant",
        role: "assistant",
        author: "SyncAI",
        text: "Twenty-seven comparable operating days show an 8.6% normalized fuel-intensity improvement. Three approved days remain before Finance can verify the annualized value.",
        createdAt: seedTime,
        meta: "Deterministic value analysis",
      },
    ],
    tokensUsed: 1980,
  };
}

function miningCases(context: DecisionJourneyContext): DecisionCase[] {
  const organization = context.company || "Copper Ridge Mining";
  const primaryAsset = context.asset || "CR-01 primary crusher";
  const primary = pumpCase(context);
  const conveyor = compressorCase(context);
  const haulTruck = boilerCase(context);

  return [
    {
      ...primary,
      id: "mining-crusher-2201",
      caseNumber: "MD-2201",
      version: "v0.6",
      organization,
      site: "Concentrator · Primary crushing",
      industry: "mining",
      title: `Decide where the next ${primaryAsset} reliability dollar should go`,
      objective: `${context.pain || "Repeated low-lube-pressure trips are constraining crusher throughput"}. Rank the smallest governed intervention, approval boundary, and lost-tonnage recovery plan.`,
      asset: primaryAsset,
      assetContext: "Primary crushing · Lube system · 1,450 t/h nameplate",
      risk: "critical",
      valueExposure: 680000,
      evidenceScore: 78,
      authorityRole: "Maintenance Superintendent",
      statusLabel: "Technical authority review",
      stage: "authority",
      intakeRole: context.role || "Reliability Engineer",
      recommendation:
        "Fund the controlled lube-system verification before a major bearing replacement.",
      recommendationDetail:
        "Hold the existing trip protection. Validate the pressure chain, inspect filtration and bypass condition, and capture oil cleanliness across three controlled starts before committing capital.",
      priorityReason:
        "This is the highest governable exposure: seven trips, 14,800 tonnes of constrained production, and a resolvable instrumentation conflict before major component spend.",
      decisionMetrics: [
        { label: "Crusher trips", value: "7", detail: "in 6 weeks" },
        { label: "Lost tonnes", value: "14,800 t", detail: "reconciled" },
        { label: "Start-linked", value: "71%", detail: "of trips" },
      ],
      evidence: [
        {
          id: "ev-cr01-events",
          title: "Crusher trip and delay history",
          summary: "26 events reconciled to production delay codes",
          quality: "high",
          state: "Governed · reconciled",
          record: "DLY-CR01-441 through WO-7298 · 26 records",
          finding:
            "Seven low-lube-pressure trips constrained 14,800 tonnes; five occurred during the first twenty minutes after start.",
          lineage: "CR-01 trip tag → dispatch delay → tonnes reconciliation",
          sourceSystem: context.system || "Fleet / plant delay accounting",
        },
        {
          id: "ev-cr01-oil",
          title: "Lube oil condition history",
          summary: "Viscosity, water, and particle results across four samples",
          quality: "medium",
          state: "Partial · no controlled startup sample",
          record: "LAB-CR01-118 through 121",
          finding:
            "Routine samples remain inside site alert bands, but no sample covers the post-start pressure decay window.",
          lineage: "Sample point CR01-LS-02 → laboratory chain of custody",
          sourceSystem: "Oil analysis laboratory",
        },
        {
          id: "ev-cr01-pressure",
          title: "Lube-pressure instrument chain",
          summary: "Historian tag conflicts with the latest field calibration",
          quality: "conflict",
          state: "Conflict · blocks trip-mechanism confirmation",
          record: "PT-CR01-17 trend vs. CAL-CR01-17-082",
          finding:
            "The field calibration offset does not match the historian scaling retained for two of the seven trips.",
          lineage:
            "Trip setpoint → transmitter calibration → historian scaling",
          sourceSystem: "Process historian and calibration management",
        },
        {
          id: "ev-cr01-feed",
          title: "Feed and operating-state history",
          summary: "Crusher power, feed size, and apron-feeder rate aligned",
          quality: "high",
          state: "Governed · complete",
          record: "PI-CR01-OPS · 2026-05 to 2026-06",
          finding:
            "Trip concentration is not explained by feed rate or crusher power excursions.",
          lineage:
            "Trip window → operating-state segmentation → feed reconciliation",
          sourceSystem: "Plant historian",
        },
        {
          id: "ev-cr01-inspection",
          title: "Filter bypass and bearing inspection",
          summary: "Required to distinguish restriction from component damage",
          quality: "missing",
          state: "Missing · blocks capital recommendation",
          record: "No governed post-trip inspection found",
          finding:
            "Bypass condition, strainer loading, and bearing distress have not been verified after a representative trip.",
          lineage: "Required by evidence plan EP-2201-03",
          sourceSystem: "SAP PM",
        },
      ],
      calculations: [
        {
          id: "calc-cr01-trips",
          label: "Governed trip count",
          formula: "COUNT(CR-01 low-lube-pressure initiating events)",
          result: "7 trips in 6 weeks",
          sourceEvidenceIds: ["ev-cr01-events"],
          assumption: "Secondary crusher stops are excluded from the count.",
        },
        {
          id: "calc-cr01-tonnes",
          label: "Constrained production",
          formula: "SUM(reconciled delay duration × approved operating rate)",
          result: "14,800 tonnes",
          sourceEvidenceIds: ["ev-cr01-events", "ev-cr01-feed"],
          assumption:
            "Only crusher-attributed delay periods with a valid feed-rate record are included.",
        },
        {
          id: "calc-cr01-start",
          label: "Startup concentration",
          formula: "5 start-window trips / 7 governed trips × 100",
          result: "71% start-linked",
          sourceEvidenceIds: ["ev-cr01-events", "ev-cr01-feed"],
          assumption: "Startup window is the approved first twenty minutes.",
        },
      ],
      approvals: [
        {
          id: "ap-cr01-intake",
          initials: "YO",
          name: "You",
          role: context.role || "Reliability Engineer",
          responsibility: "Decision intent and evidence boundary",
          status: "complete",
          decidedAt: seedTime,
        },
        {
          id: "ap-cr01-maint",
          initials: "LS",
          name: "L. Singh",
          role: "Maintenance Superintendent",
          responsibility:
            "Controlled inspection scope and protection integrity",
          status: "reviewing",
        },
        {
          id: "ap-cr01-ops",
          initials: "JM",
          name: "J. McKay",
          role: "Processing Operations Authority",
          responsibility: "Controlled start window and production boundary",
          status: "next",
        },
      ],
      comments: [
        {
          id: "comment-cr01-1",
          author: "L. Singh",
          text: "Keep the OEM trip protection active during every verification start.",
          createdAt: seedTime,
        },
      ],
      workPackage: {
        id: "wp-8201",
        number: "WP-8201",
        title: "CR-01 controlled lube-system verification",
        targetSystem: "SAP PM",
        status: "locked",
        controls: [
          {
            id: "control-cr01-1",
            text: "Validate pressure transmitter, switch, scaling, and trip setpoint",
            owner: "Instrumentation",
            status: "ready",
          },
          {
            id: "control-cr01-2",
            text: "Inspect filter differential pressure, bypass, strainer, and retained debris",
            owner: "Maintenance",
            status: "ready",
          },
          {
            id: "control-cr01-3",
            text: "Capture oil sample and pressure trace across three controlled starts",
            owner: "Reliability",
            status: "ready",
          },
          {
            id: "control-cr01-4",
            text: "Stop immediately at the approved protection threshold",
            owner: "Operations",
            status: "control",
          },
        ],
      },
      valueMetrics: [
        {
          id: "value-cr01-delay",
          label: "Crusher trip delay",
          detail: "Rolling 30 operating days",
          baseline: "41 h",
          target: "≤ 8 h",
          verifiedActual: "6 h",
        },
        {
          id: "value-cr01-tonnes",
          label: "Recovered throughput",
          detail: "Against approved production baseline",
          baseline: "0 t",
          target: "≥ 10,000 t",
          verifiedActual: "12,600 t",
        },
        {
          id: "value-cr01-trips",
          label: "Low-pressure trips",
          detail: "Per 30 operating days",
          baseline: "7",
          target: "≤ 1",
          verifiedActual: "1",
        },
        {
          id: "value-cr01-avoided",
          label: "Verified production value",
          detail: "Finance-approved contribution rate",
          baseline: "$0",
          target: "$680k",
          verifiedActual: "$592k",
        },
      ],
      financeSponsor: "K. Alvarez",
      financeStatus: "baseline_approved",
      messages: [
        {
          id: "message-cr01-system",
          role: "system",
          author: "SyncAI",
          text: "A mining Decision Case is ready with crusher hierarchy, lost-tonnage evidence, protection boundaries, and a measurable recovery plan.",
          createdAt: seedTime,
          meta: "Mining value proof · governed workspace",
        },
        {
          id: "message-cr01-user",
          role: "user",
          author: "You",
          text: "Should we replace the crusher bearings, change the trip setpoint, or spend the next dollar somewhere else?",
          createdAt: seedTime,
        },
        {
          id: "message-cr01-assistant",
          role: "assistant",
          author: "SyncAI",
          text: "Do not change the protection setpoint or commit to a bearing replacement yet. The pressure-chain conflict can be resolved with a controlled lube-system verification that protects the crusher and tests the highest-value decision for far less capital.",
          createdAt: seedTime,
          meta: "Deterministic analysis · governed recommendation",
        },
      ],
      tokensUsed: 4380,
    },
    {
      ...conveyor,
      id: "mining-conveyor-2202",
      caseNumber: "MD-2202",
      version: "v0.3",
      organization,
      site: "Materials handling · Overland conveyor",
      industry: "mining",
      title: "Resolve CV-204 repeat mistracking before replacing the belt",
      objective:
        "Separate loading, structure, and pulley-condition contributors and authorize the smallest controlled correction.",
      asset: "CV-204 overland conveyor",
      assetContext: "Ore transfer · 2.4 km overland conveyor",
      risk: "material",
      valueExposure: 390000,
      evidenceScore: 74,
      authorityRole: "Processing Operations Authority",
      statusLabel: "Evidence conflict",
      stage: "evidence",
      intakeRole: "Maintenance Superintendent",
      recommendation: "Do not authorize a belt replacement yet.",
      recommendationDetail:
        "Reconcile the structure survey, inspect pulley lagging and carryback, and capture belt position by loading state before selecting a permanent correction.",
      priorityReason:
        "The case carries 62 hours of plant delay, but the belt condition and structure records disagree; resolving that conflict prevents premature replacement spend.",
      decisionMetrics: [
        { label: "Delay", value: "62 h", detail: "in 10 weeks" },
        { label: "Lost tonnes", value: "9,200 t", detail: "reconciled" },
        { label: "Load-linked", value: "67%", detail: "of events" },
      ],
      evidence: [
        {
          id: "ev-cv204-delays",
          title: "Conveyor delay history",
          summary: "18 mistracking events reconciled to plant delays",
          quality: "high",
          state: "Governed · reconciled",
          record: "DLY-CV204-201 through 218",
          finding:
            "Twelve of eighteen events occurred above 80% loading and account for 62 hours of delay.",
          lineage: "Mistracking switch event → delay code → feed tonnes",
          sourceSystem: "Plant delay accounting",
        },
        {
          id: "ev-cv204-position",
          title: "Belt-position trend",
          summary: "Four of six critical zones instrumented",
          quality: "medium",
          state: "Partial · 67% zone coverage",
          record: "PI-CV204-TRACK · zones 2, 3, 5, and 6",
          finding:
            "Lateral movement increases after transfer loading, but two high-consequence zones have no retained trend.",
          lineage: "Belt switch → loading state → conveyor zone",
          sourceSystem: "Plant historian",
        },
        {
          id: "ev-cv204-survey",
          title: "Conveyor structure survey",
          summary: "Field offsets conflict with the approved alignment record",
          quality: "conflict",
          state: "Conflict · engineering resolution required",
          record: "CV204-SUR-09 vs. drawing CV204-GA-014",
          finding:
            "Three stringer offsets exceed the field tolerance, but the survey control points are not traceable to the approved datum.",
          lineage:
            "Approved datum → field control → stringer offset comparison",
          sourceSystem: "Engineering document control",
        },
        {
          id: "ev-cv204-pulley",
          title: "Pulley lagging and carryback inspection",
          summary: "Required before belt replacement scope",
          quality: "missing",
          state: "Missing · blocks correction selection",
          record: "No governed loaded-condition inspection found",
          finding:
            "Lagging condition, buildup, and return-side carryback have not been assessed under representative loading.",
          lineage: "Required by evidence plan EP-2202-01",
          sourceSystem: "SAP PM",
        },
      ],
      calculations: [
        {
          id: "calc-cv204-delay",
          label: "Mistracking delay",
          formula: "SUM(delay hours where initiating equipment = CV-204)",
          result: "62 hours",
          sourceEvidenceIds: ["ev-cv204-delays"],
          assumption: "Downstream consequential delay is excluded.",
        },
        {
          id: "calc-cv204-tonnes",
          label: "Lost production",
          formula: "SUM(valid delay duration × reconciled feed rate)",
          result: "9,200 tonnes",
          sourceEvidenceIds: ["ev-cv204-delays"],
          assumption: "Only intervals with valid belt-scale data are included.",
        },
      ],
      approvals: [
        {
          id: "ap-cv204-intake",
          initials: "YO",
          name: "You",
          role: "Maintenance Superintendent",
          responsibility: "Decision intent and evidence boundary",
          status: "complete",
          decidedAt: seedTime,
        },
        {
          id: "ap-cv204-ops",
          initials: "JM",
          name: "J. McKay",
          role: "Processing Operations Authority",
          responsibility: "Loaded test window and operating controls",
          status: "reviewing",
        },
        {
          id: "ap-cv204-eng",
          initials: "AR",
          name: "A. Roy",
          role: "Mechanical Engineering Authority",
          responsibility: "Survey datum and permanent correction",
          status: "next",
        },
      ],
      comments: [
        {
          id: "comment-cv204-1",
          author: "A. Roy",
          text: "Re-establish the approved survey datum before moving structure.",
          createdAt: seedTime,
        },
      ],
      workPackage: {
        id: "wp-8202",
        number: "WP-8202",
        title: "CV-204 loaded-condition alignment study",
        targetSystem: "SAP PM",
        status: "locked",
        controls: [
          {
            id: "control-cv204-1",
            text: "Re-establish survey control from the approved datum",
            owner: "Engineering",
            status: "ready",
          },
          {
            id: "control-cv204-2",
            text: "Inspect lagging, buildup, idlers, and carryback under load",
            owner: "Maintenance",
            status: "ready",
          },
          {
            id: "control-cv204-3",
            text: "Capture belt position at 50%, 75%, and 90% loading",
            owner: "Reliability",
            status: "ready",
          },
          {
            id: "control-cv204-4",
            text: "Retain all mistracking protection during the study",
            owner: "Operations",
            status: "control",
          },
        ],
      },
      valueMetrics: [
        {
          id: "value-cv204-delay",
          label: "Mistracking delay",
          detail: "Rolling 30 operating days",
          baseline: "62 h",
          target: "≤ 10 h",
          verifiedActual: "9 h",
        },
        {
          id: "value-cv204-tonnes",
          label: "Recovered tonnes",
          detail: "Against plant plan",
          baseline: "0 t",
          target: "≥ 7,500 t",
          verifiedActual: "8,100 t",
        },
        {
          id: "value-cv204-events",
          label: "Mistracking events",
          detail: "Per 30 operating days",
          baseline: "18",
          target: "≤ 3",
          verifiedActual: "2",
        },
        {
          id: "value-cv204-value",
          label: "Verified throughput value",
          detail: "Finance-approved contribution rate",
          baseline: "$0",
          target: "$390k",
          verifiedActual: "$352k",
        },
      ],
      financeSponsor: "K. Alvarez",
      financeStatus: "baseline_approved",
      messages: [
        {
          id: "message-cv204-system",
          role: "system",
          author: "SyncAI",
          text: "The CV-204 mining Decision Case keeps delay, throughput, field configuration, authority, and value evidence together.",
          createdAt: seedTime,
          meta: "Mining value proof · governed workspace",
        },
        {
          id: "message-cv204-assistant",
          role: "assistant",
          author: "SyncAI",
          text: "Do not replace the belt yet. Resolve the survey conflict and observe pulley, carryback, and belt position under representative loading before selecting a permanent correction.",
          createdAt: seedTime,
          meta: "Deterministic analysis · governed recommendation",
        },
      ],
      tokensUsed: 2960,
    },
    {
      ...haulTruck,
      id: "mining-haul-2194",
      caseNumber: "MD-2194",
      version: "v1.0",
      organization,
      site: "Open pit · Mobile fleet",
      industry: "mining",
      title: "Verify whether the HD-785 cooling intervention created value",
      objective:
        "Close the comparable duty-cycle window and verify realized availability and avoided delay value.",
      asset: "HT-27 haul truck",
      assetContext: "Ultra-class haulage · West pit fleet",
      risk: "moderate",
      valueExposure: 245000,
      evidenceScore: 93,
      authorityRole: "Asset Manager / finance sponsor",
      statusLabel: "Value verification",
      stage: "outcomes",
      intakeRole: "Asset Manager / finance sponsor",
      recommendation: "Complete the 30-day comparable duty-cycle verification.",
      recommendationDetail:
        "The cooling-pack cleaning trigger is active. Verify derate recurrence, physical availability, and maintenance effort across the final four comparable shifts.",
      priorityReason:
        "The intervention is complete; four comparable shifts can convert measured fleet improvement into verified value and retained learning.",
      decisionMetrics: [
        { label: "Engine derates", value: "−72%", detail: "duty-adjusted" },
        { label: "Availability", value: "+2.8 pt", detail: "physical" },
        { label: "Evidence window", value: "26/30", detail: "shifts" },
      ],
      evidence: [
        {
          id: "ev-ht27-events",
          title: "Fleet event and delay history",
          summary: "26 comparable shifts reconciled to dispatch",
          quality: "high",
          state: "Governed · reconciled",
          record: "FLEET-HT27-POST · shifts 1 through 26",
          finding:
            "High-coolant-temperature derates fell 72% after the controlled cleaning trigger was introduced.",
          lineage: "ECM derate → dispatch delay → duty-cycle normalization",
          sourceSystem: "Fleet management system",
        },
        {
          id: "ev-ht27-duty",
          title: "Comparable haul-cycle model",
          summary:
            "Payload, grade, ambient temperature, and queue time normalized",
          quality: "high",
          state: "Approved · current",
          record: "MODEL-HT27-DUTY-02",
          finding:
            "All retained shifts fall inside the approved payload, grade, and ambient comparison boundary.",
          lineage: "Dispatch cycles → approved duty model version 2",
          sourceSystem: "Fleet analytics",
        },
        {
          id: "ev-ht27-work",
          title: "Cooling-pack maintenance receipts",
          summary: "Labor, wash condition, and inspection results retained",
          quality: "high",
          state: "Governed · complete",
          record: "SAP-WO-8177 · six triggered services",
          finding:
            "Triggered services used 18 fewer labor hours than the prior fixed-frequency plan over the same duty exposure.",
          lineage: "Condition trigger → work order → labor confirmation",
          sourceSystem: "SAP PM",
        },
        {
          id: "ev-ht27-window",
          title: "Final verification shifts",
          summary: "Four comparable shifts remain",
          quality: "missing",
          state: "Pending · 4 shifts required",
          record: "Shifts 27 through 30 not yet closed",
          finding:
            "Finance verification remains locked until the approved 30-shift window is complete.",
          lineage: "Value plan VP-2194-02",
          sourceSystem: "Value assurance",
        },
      ],
      calculations: [
        {
          id: "calc-ht27-derates",
          label: "Duty-adjusted derate reduction",
          formula:
            "(baseline derate rate − observed rate) / baseline rate × 100",
          result: "72% reduction",
          sourceEvidenceIds: ["ev-ht27-events", "ev-ht27-duty"],
          assumption:
            "Only shifts inside the approved duty boundary are retained.",
        },
        {
          id: "calc-ht27-availability",
          label: "Physical availability change",
          formula: "post-intervention availability − approved baseline",
          result: "+2.8 percentage points",
          sourceEvidenceIds: ["ev-ht27-events", "ev-ht27-work"],
          assumption: "Non-cooling delays are retained in both periods.",
        },
      ],
      approvals: [
        {
          id: "ap-ht27-rel",
          initials: "NK",
          name: "N. King",
          role: "Mobile Equipment Reliability",
          responsibility: "Duty model and recurrence definition",
          status: "approved",
          decidedAt: seedTime,
        },
        {
          id: "ap-ht27-finance",
          initials: "KA",
          name: "K. Alvarez",
          role: "Asset Manager / finance sponsor",
          responsibility: "Availability baseline and realized value",
          status: "reviewing",
        },
      ],
      comments: [
        {
          id: "comment-ht27-1",
          author: "K. Alvarez",
          text: "Close the final comparable shifts before recording fleet value.",
          createdAt: seedTime,
        },
      ],
      workPackage: {
        id: "wp-8177",
        number: "WP-8177",
        title: "HT-27 condition-triggered cooling service",
        targetSystem: "SAP PM",
        status: "complete",
        receipt: {
          externalId: "SAP-WO-8177",
          status: "synced",
          releasedAt: "2026-06-02T13:30:00.000Z",
          lastSync: seedTime,
        },
        controls: [
          {
            id: "control-ht27-1",
            text: "Apply the approved restriction and temperature trigger",
            owner: "Reliability",
            status: "complete",
          },
          {
            id: "control-ht27-2",
            text: "Retain payload, grade, ambient, derate, and labor evidence",
            owner: "Fleet planning",
            status: "complete",
          },
        ],
      },
      valueMetrics: [
        {
          id: "value-ht27-derates",
          label: "Temperature derates",
          detail: "Per 30 comparable shifts",
          baseline: "18",
          target: "≤ 6",
          verifiedActual: "5",
        },
        {
          id: "value-ht27-availability",
          label: "Physical availability",
          detail: "Duty-adjusted",
          baseline: "86.2%",
          target: "≥ 88.5%",
          verifiedActual: "89.0%",
        },
        {
          id: "value-ht27-effort",
          label: "Cooling service labor",
          detail: "Comparable duty exposure",
          baseline: "46 h",
          target: "≤ 32 h",
          verifiedActual: "28 h",
        },
        {
          id: "value-ht27-value",
          label: "Verified fleet value",
          detail: "Finance-approved rate",
          baseline: "$0",
          target: "$245k",
          verifiedActual: "$231k",
        },
      ],
      financeSponsor: "K. Alvarez",
      financeStatus: "pending",
      messages: [
        {
          id: "message-ht27-system",
          role: "system",
          author: "SyncAI",
          text: "The HT-27 intervention is in its governed fleet value-verification window.",
          createdAt: seedTime,
          meta: "Mining outcome verification",
        },
        {
          id: "message-ht27-assistant",
          role: "assistant",
          author: "SyncAI",
          text: "Twenty-six comparable shifts show 72% fewer temperature derates and a 2.8-point availability gain. Four shifts remain before Finance can verify realized value.",
          createdAt: seedTime,
          meta: "Deterministic value analysis",
        },
      ],
      tokensUsed: 2140,
    },
  ];
}

function manufacturingCases(context: DecisionJourneyContext): DecisionCase[] {
  const organization = context.company || "Atlas Precision Manufacturing";
  const primaryAsset = context.asset || "PR-07 stamping press";
  const press = pumpCase(context);
  const packaging = compressorCase(context);
  const oven = boilerCase(context);

  return [
    {
      ...press,
      id: "manufacturing-press-3107",
      caseNumber: "FD-3107",
      version: "v0.5",
      organization,
      site: "Plant 2 · Stamping line",
      industry: "manufacturing",
      title: `Decide the next governed action for ${primaryAsset}`,
      objective: `${context.pain || "Repeat die-protection trips are reducing line output and increasing scrap"}. Rank the safest controlled action and define how recovered production will be verified.`,
      asset: primaryAsset,
      assetContext: "High-volume stamping · Line S2",
      risk: "critical",
      valueExposure: 360000,
      evidenceScore: 81,
      authorityRole: "Production Authority",
      statusLabel: "Technical authority review",
      stage: "authority",
      intakeRole: context.role || "Reliability Engineer",
      recommendation: "Do not bypass the die-protection circuit.",
      recommendationDetail:
        "Validate sensor timing, strip-feed alignment, and changeover setup across a controlled production run before changing logic or replacing the press control module.",
      priorityReason:
        "The case combines a safety-relevant control, 23 line stops, and a measurable scrap and throughput opportunity that can be tested without defeating protection.",
      decisionMetrics: [
        { label: "Line stops", value: "23", detail: "in 8 weeks" },
        { label: "Scrap", value: "4.1%", detail: "affected runs" },
        { label: "Changeover-linked", value: "61%", detail: "of stops" },
      ],
      evidence: [
        {
          id: "ev-pr07-stops",
          title: "MES stop and production history",
          summary: "23 stops reconciled to work orders and part runs",
          quality: "high",
          state: "Governed · reconciled",
          record: "MES-PR07-611 through 633",
          finding:
            "Fourteen stops occurred in the first 500 pieces after a die change and correlate with elevated scrap.",
          lineage: "PR-07 stop code → part run → changeover timestamp",
          sourceSystem: context.system || "MES and CMMS",
        },
        {
          id: "ev-pr07-sensors",
          title: "Die-protection event trace",
          summary: "Sensor state and press-angle data retained for 19 stops",
          quality: "medium",
          state: "Partial · 83% event coverage",
          record: "PLC-PR07-DP · 19 retained traces",
          finding:
            "Misfeed input timing drifts after changeover, but four stop traces were overwritten.",
          lineage: "Protection trip → PLC trace → press-angle alignment",
          sourceSystem: "Controls historian",
        },
        {
          id: "ev-pr07-pfmea",
          title: "Approved PFMEA and control plan",
          summary: "Current protection intent and response boundary",
          quality: "high",
          state: "Approved · current",
          record: "PFMEA-S2-014 rev. 9 · CP-S2-014 rev. 6",
          finding:
            "The die-protection circuit is a required control; logic bypass requires formal engineering and quality approval.",
          lineage:
            "Failure mode 3.4 → prevention control DP-07 → authority map",
          sourceSystem: "Quality document control",
        },
        {
          id: "ev-pr07-wiring",
          title: "Misfeed sensor configuration",
          summary: "Field wiring conflicts with the approved controls drawing",
          quality: "conflict",
          state: "Conflict · controls resolution required",
          record: "EL-PR07-222 rev. 4 vs. field verification FV-3107",
          finding:
            "The field sensor channel and debounce value do not match the approved drawing and backup record.",
          lineage: "Approved drawing → PLC backup → field channel verification",
          sourceSystem: "Engineering document control",
        },
        {
          id: "ev-pr07-feed",
          title: "Controlled strip-feed study",
          summary: "Required to distinguish setup from control failure",
          quality: "missing",
          state: "Missing · blocks permanent change",
          record: "No governed post-changeover study found",
          finding:
            "Feed pitch, pilot release, lubrication, and sensor timing have not been observed together under an approved trial.",
          lineage: "Required by evidence plan EP-3107-02",
          sourceSystem: "Manufacturing engineering",
        },
      ],
      calculations: [
        {
          id: "calc-pr07-stops",
          label: "Governed stop count",
          formula: "COUNT(PR-07 die-protection initiating stops)",
          result: "23 stops in 8 weeks",
          sourceEvidenceIds: ["ev-pr07-stops"],
          assumption: "Secondary line starvation and blocking are excluded.",
        },
        {
          id: "calc-pr07-changeover",
          label: "Changeover concentration",
          formula: "14 post-changeover stops / 23 governed stops × 100",
          result: "61% changeover-linked",
          sourceEvidenceIds: ["ev-pr07-stops", "ev-pr07-sensors"],
          assumption: "Post-changeover window is the first 500 pieces.",
        },
        {
          id: "calc-pr07-scrap",
          label: "Affected-run scrap",
          formula: "scrapped pieces / total affected-run pieces × 100",
          result: "4.1%",
          sourceEvidenceIds: ["ev-pr07-stops"],
          assumption: "Only quality-confirmed scrap is included.",
        },
      ],
      approvals: [
        {
          id: "ap-pr07-intake",
          initials: "YO",
          name: "You",
          role: context.role || "Reliability Engineer",
          responsibility: "Decision intent and evidence boundary",
          status: "complete",
          decidedAt: seedTime,
        },
        {
          id: "ap-pr07-prod",
          initials: "EP",
          name: "E. Park",
          role: "Production Authority",
          responsibility: "Controlled run and production boundary",
          status: "reviewing",
        },
        {
          id: "ap-pr07-quality",
          initials: "TD",
          name: "T. Davis",
          role: "Quality Engineering Authority",
          responsibility: "PFMEA, control plan, and product acceptance",
          status: "next",
        },
      ],
      comments: [
        {
          id: "comment-pr07-1",
          author: "T. Davis",
          text: "The approved die-protection function must remain active throughout the study.",
          createdAt: seedTime,
        },
      ],
      workPackage: {
        id: "wp-9107",
        number: "WP-9107",
        title: "PR-07 controlled changeover and feed study",
        targetSystem: "SAP PM / MES",
        status: "locked",
        controls: [
          {
            id: "control-pr07-1",
            text: "Reconcile the approved wiring, PLC backup, and field channel",
            owner: "Controls Engineering",
            status: "ready",
          },
          {
            id: "control-pr07-2",
            text: "Record feed pitch, pilot release, lubrication, and sensor timing",
            owner: "Manufacturing Engineering",
            status: "ready",
          },
          {
            id: "control-pr07-3",
            text: "Run 2,000 pieces under the approved control plan",
            owner: "Production",
            status: "ready",
          },
          {
            id: "control-pr07-4",
            text: "Stop on any protection, safety, or quality exception",
            owner: "Production Authority",
            status: "control",
          },
        ],
      },
      valueMetrics: [
        {
          id: "value-pr07-stops",
          label: "Die-protection stops",
          detail: "Per 10,000 pieces",
          baseline: "8.4",
          target: "≤ 2.0",
          verifiedActual: "1.6",
        },
        {
          id: "value-pr07-scrap",
          label: "Post-changeover scrap",
          detail: "First 500 pieces",
          baseline: "4.1%",
          target: "≤ 1.5%",
          verifiedActual: "1.2%",
        },
        {
          id: "value-pr07-output",
          label: "Good pieces recovered",
          detail: "Rolling 30 days",
          baseline: "0",
          target: "≥ 18,000",
          verifiedActual: "21,400",
        },
        {
          id: "value-pr07-value",
          label: "Verified contribution value",
          detail: "Finance-approved margin",
          baseline: "$0",
          target: "$360k",
          verifiedActual: "$331k",
        },
      ],
      financeSponsor: "M. Bennett",
      financeStatus: "baseline_approved",
      messages: [
        {
          id: "message-pr07-system",
          role: "system",
          author: "SyncAI",
          text: "A manufacturing Decision Case is ready with MES loss, control-plan authority, protected work, and contribution-value verification.",
          createdAt: seedTime,
          meta: "Manufacturing value proof · governed workspace",
        },
        {
          id: "message-pr07-user",
          role: "user",
          author: "You",
          text: "Can we bypass the die-protection input to stop the nuisance trips? Give me the risk, evidence gaps, and best next action.",
          createdAt: seedTime,
        },
        {
          id: "message-pr07-assistant",
          role: "assistant",
          author: "SyncAI",
          text: "Do not bypass the protection. Reconcile the field configuration and run a controlled feed and changeover study that preserves the approved PFMEA control while testing the likely setup mechanism.",
          createdAt: seedTime,
          meta: "Deterministic analysis · governed recommendation",
        },
      ],
      tokensUsed: 4020,
    },
    {
      ...packaging,
      id: "manufacturing-packaging-3114",
      caseNumber: "FD-3114",
      version: "v0.3",
      organization,
      site: "Plant 2 · Final assembly",
      industry: "manufacturing",
      title: "Resolve PKG-04 repeat changeover jams before buying capacity",
      objective:
        "Separate change-part configuration, material, and equipment-condition contributors before approving capital.",
      asset: "PKG-04 cartoner",
      assetContext: "Final packaging · Mixed-SKU line",
      risk: "material",
      valueExposure: 280000,
      evidenceScore: 77,
      authorityRole: "Production Authority",
      statusLabel: "Evidence conflict",
      stage: "evidence",
      intakeRole: "Maintenance Manager",
      recommendation: "Do not approve the high-speed module yet.",
      recommendationDetail:
        "Reconcile the change-part master, validate centerline settings, and observe three representative SKU changeovers before attributing the constraint to installed capacity.",
      priorityReason:
        "Most lost output occurs after changeover, while the field centerline and approved recipe conflict; that is a cheaper decision to resolve than new equipment.",
      decisionMetrics: [
        { label: "Microstops", value: "146", detail: "in 30 days" },
        { label: "Lost output", value: "31,200", detail: "saleable units" },
        { label: "Changeover-linked", value: "74%", detail: "of loss" },
      ],
      evidence: [
        {
          id: "ev-pkg04-mes",
          title: "MES loss tree",
          summary: "Microstops reconciled by SKU and changeover state",
          quality: "high",
          state: "Governed · reconciled",
          record: "MES-PKG04-2026-06 · 146 events",
          finding:
            "Seventy-four percent of lost units occur during the first hour after three high-volume SKU changeovers.",
          lineage: "Cartoner stop → SKU → changeover state → good count",
          sourceSystem: "MES",
        },
        {
          id: "ev-pkg04-recipe",
          title: "Centerline and recipe master",
          summary: "Approved settings conflict with the active machine recipe",
          quality: "conflict",
          state: "Conflict · production engineering resolution required",
          record: "CL-PKG04-018 rev. 7 vs. recipe backup 2026-06-12",
          finding:
            "Infeed timing and compression-rail positions differ from the approved centerline for two high-loss SKUs.",
          lineage: "Approved centerline → recipe backup → field setting",
          sourceSystem: "Manufacturing document control",
        },
        {
          id: "ev-pkg04-parts",
          title: "Change-part condition",
          summary: "Wear and identification complete for 8 of 11 parts",
          quality: "medium",
          state: "Partial · three parts not measured",
          record: "INS-PKG04-044",
          finding:
            "Two guides show measurable wear, but three format parts lack dimensional results.",
          lineage: "SKU bill of change parts → inspection record",
          sourceSystem: "CMMS",
        },
        {
          id: "ev-pkg04-study",
          title: "Representative changeover study",
          summary: "Required before capacity recommendation",
          quality: "missing",
          state: "Missing · blocks capital decision",
          record: "No governed three-SKU study found",
          finding:
            "Material condition, setup sequence, centerline, and first-hour loss have not been captured together.",
          lineage: "Required by evidence plan EP-3114-01",
          sourceSystem: "Continuous improvement system",
        },
      ],
      calculations: [
        {
          id: "calc-pkg04-loss",
          label: "Saleable output loss",
          formula:
            "SUM(approved run rate × microstop duration) − rejected inferred units",
          result: "31,200 units",
          sourceEvidenceIds: ["ev-pkg04-mes"],
          assumption:
            "Only MES events with valid speed and SKU context are retained.",
        },
        {
          id: "calc-pkg04-changeover",
          label: "Changeover loss concentration",
          formula: "first-hour lost units / governed lost units × 100",
          result: "74% changeover-linked",
          sourceEvidenceIds: ["ev-pkg04-mes", "ev-pkg04-recipe"],
          assumption:
            "First hour starts at the approved line-release timestamp.",
        },
      ],
      approvals: [
        {
          id: "ap-pkg04-intake",
          initials: "YO",
          name: "You",
          role: "Maintenance Manager",
          responsibility: "Decision intent and evidence boundary",
          status: "complete",
          decidedAt: seedTime,
        },
        {
          id: "ap-pkg04-prod",
          initials: "EP",
          name: "E. Park",
          role: "Production Authority",
          responsibility: "Representative SKU run and production control",
          status: "reviewing",
        },
        {
          id: "ap-pkg04-eng",
          initials: "RC",
          name: "R. Chen",
          role: "Manufacturing Engineering",
          responsibility: "Recipe master and capital recommendation",
          status: "next",
        },
      ],
      comments: [
        {
          id: "comment-pkg04-1",
          author: "R. Chen",
          text: "Reconcile the centerline before using rate loss to justify new capacity.",
          createdAt: seedTime,
        },
      ],
      workPackage: {
        id: "wp-9114",
        number: "WP-9114",
        title: "PKG-04 three-SKU changeover study",
        targetSystem: "SAP PM / MES",
        status: "locked",
        controls: [
          {
            id: "control-pkg04-1",
            text: "Reconcile approved centerline, recipe backup, and field settings",
            owner: "Manufacturing Engineering",
            status: "ready",
          },
          {
            id: "control-pkg04-2",
            text: "Measure and identify all required change parts",
            owner: "Maintenance",
            status: "ready",
          },
          {
            id: "control-pkg04-3",
            text: "Observe three representative SKU changeovers and first-hour loss",
            owner: "Continuous Improvement",
            status: "ready",
          },
          {
            id: "control-pkg04-4",
            text: "Hold quality release criteria throughout the study",
            owner: "Quality",
            status: "control",
          },
        ],
      },
      valueMetrics: [
        {
          id: "value-pkg04-output",
          label: "Lost saleable units",
          detail: "Rolling 30 days",
          baseline: "31,200",
          target: "≤ 8,000",
          verifiedActual: "6,900",
        },
        {
          id: "value-pkg04-time",
          label: "Changeover stabilization",
          detail: "Median minutes to centerline",
          baseline: "58 min",
          target: "≤ 25 min",
          verifiedActual: "21 min",
        },
        {
          id: "value-pkg04-quality",
          label: "First-hour rejects",
          detail: "Across target SKUs",
          baseline: "3.2%",
          target: "≤ 1.0%",
          verifiedActual: "0.8%",
        },
        {
          id: "value-pkg04-value",
          label: "Verified contribution value",
          detail: "Finance-approved margin",
          baseline: "$0",
          target: "$280k",
          verifiedActual: "$264k",
        },
      ],
      financeSponsor: "M. Bennett",
      financeStatus: "baseline_approved",
      messages: [
        {
          id: "message-pkg04-system",
          role: "system",
          author: "SyncAI",
          text: "The PKG-04 Decision Case is ready with SKU-level loss, configuration truth, controlled work, and value evidence.",
          createdAt: seedTime,
          meta: "Manufacturing value proof · governed workspace",
        },
        {
          id: "message-pkg04-assistant",
          role: "assistant",
          author: "SyncAI",
          text: "Do not buy the high-speed module yet. Most output loss is concentrated after changeover, and the active recipe conflicts with the approved centerline. Resolve configuration truth before capital.",
          createdAt: seedTime,
          meta: "Deterministic analysis · governed recommendation",
        },
      ],
      tokensUsed: 2830,
    },
    {
      ...oven,
      id: "manufacturing-oven-3092",
      caseNumber: "FD-3092",
      version: "v1.0",
      organization,
      site: "Plant 1 · Heat treatment",
      industry: "manufacturing",
      title: "Verify whether the OV-12 cure-profile intervention created value",
      objective:
        "Close the approved product-family window and verify energy, quality, and throughput outcomes.",
      asset: "OV-12 cure oven",
      assetContext: "Heat treatment · Product family A",
      risk: "moderate",
      valueExposure: 165000,
      evidenceScore: 92,
      authorityRole: "Plant Manager / finance sponsor",
      statusLabel: "Value verification",
      stage: "outcomes",
      intakeRole: "Plant Manager / finance sponsor",
      recommendation: "Complete the 30-batch verification window.",
      recommendationDetail:
        "The approved cure-profile change is complete. Verify energy per accepted batch, first-pass yield, and cycle time across the final three comparable batches.",
      priorityReason:
        "Execution is complete and three batches can convert operating improvement into finance-verified contribution value and reusable process knowledge.",
      decisionMetrics: [
        { label: "Energy / batch", value: "−9.2%", detail: "normalized" },
        { label: "First-pass yield", value: "+1.7 pt", detail: "family A" },
        { label: "Evidence window", value: "27/30", detail: "batches" },
      ],
      evidence: [
        {
          id: "ev-ov12-energy",
          title: "Batch energy and profile history",
          summary: "27 comparable batches retained",
          quality: "high",
          state: "Governed · reconciled",
          record: "PI-OV12-POST · batches 1 through 27",
          finding:
            "Normalized energy per accepted batch is 9.2% below baseline with every retained profile inside the approved window.",
          lineage:
            "Oven energy + batch genealogy → approved normalization model",
          sourceSystem: "Historian and MES",
        },
        {
          id: "ev-ov12-quality",
          title: "Quality release history",
          summary: "First-pass yield and test results by batch",
          quality: "high",
          state: "Approved · complete",
          record: "QMS-OV12-POST · 27 released batches",
          finding:
            "First-pass yield improved 1.7 percentage points with no new defect mode detected.",
          lineage: "Batch genealogy → test disposition → released quantity",
          sourceSystem: "QMS",
        },
        {
          id: "ev-ov12-baseline",
          title: "Finance and production baseline",
          summary:
            "Energy rate, accepted output, and product boundary approved",
          quality: "high",
          state: "Approved · current",
          record: "FIN-OV12-2026-05",
          finding:
            "The approved boundary supports up to $165k annualized value at the target energy and yield result.",
          lineage: "Utility rate + contribution margin → baseline approval",
          sourceSystem: "Finance planning",
        },
        {
          id: "ev-ov12-window",
          title: "Final verification batches",
          summary: "Three comparable batches remain",
          quality: "missing",
          state: "Pending · 3 batches required",
          record: "Batches 28 through 30 not yet closed",
          finding:
            "Finance verification remains locked until the approved 30-batch window is complete.",
          lineage: "Value plan VP-3092-01",
          sourceSystem: "Value assurance",
        },
      ],
      calculations: [
        {
          id: "calc-ov12-energy",
          label: "Normalized energy change",
          formula: "(post energy/accepted batch − baseline) / baseline × 100",
          result: "−9.2%",
          sourceEvidenceIds: ["ev-ov12-energy", "ev-ov12-quality"],
          assumption: "Only approved family-A batches are retained.",
        },
        {
          id: "calc-ov12-yield",
          label: "First-pass yield change",
          formula: "post first-pass yield − approved baseline yield",
          result: "+1.7 percentage points",
          sourceEvidenceIds: ["ev-ov12-quality", "ev-ov12-baseline"],
          assumption: "Rework disposition is unchanged between periods.",
        },
      ],
      approvals: [
        {
          id: "ap-ov12-quality",
          initials: "TD",
          name: "T. Davis",
          role: "Quality Engineering Authority",
          responsibility: "Cure profile and product release boundary",
          status: "approved",
          decidedAt: seedTime,
        },
        {
          id: "ap-ov12-finance",
          initials: "MB",
          name: "M. Bennett",
          role: "Plant Manager / finance sponsor",
          responsibility: "Baseline and realized contribution value",
          status: "reviewing",
        },
      ],
      comments: [
        {
          id: "comment-ov12-1",
          author: "M. Bennett",
          text: "Close the final three released batches before retaining the annualized value.",
          createdAt: seedTime,
        },
      ],
      workPackage: {
        id: "wp-9092",
        number: "WP-9092",
        title: "OV-12 approved cure-profile optimization",
        targetSystem: "SAP PM / MES",
        status: "complete",
        receipt: {
          externalId: "MES-CHG-9092",
          status: "synced",
          releasedAt: "2026-06-03T11:20:00.000Z",
          lastSync: seedTime,
        },
        controls: [
          {
            id: "control-ov12-1",
            text: "Apply the approved recipe and locked profile limits",
            owner: "Production Engineering",
            status: "complete",
          },
          {
            id: "control-ov12-2",
            text: "Retain energy, genealogy, profile, and quality evidence",
            owner: "Quality",
            status: "complete",
          },
        ],
      },
      valueMetrics: [
        {
          id: "value-ov12-energy",
          label: "Energy per accepted batch",
          detail: "Normalized family A",
          baseline: "1.00",
          target: "≤ 0.92",
          verifiedActual: "0.908",
        },
        {
          id: "value-ov12-yield",
          label: "First-pass yield",
          detail: "Product family A",
          baseline: "96.8%",
          target: "≥ 98.0%",
          verifiedActual: "98.5%",
        },
        {
          id: "value-ov12-cycle",
          label: "Accepted cycle time",
          detail: "Median batch",
          baseline: "112 min",
          target: "≤ 105 min",
          verifiedActual: "103 min",
        },
        {
          id: "value-ov12-value",
          label: "Verified contribution value",
          detail: "Annualized",
          baseline: "$0",
          target: "$165k",
          verifiedActual: "$158k",
        },
      ],
      financeSponsor: "M. Bennett",
      financeStatus: "pending",
      messages: [
        {
          id: "message-ov12-system",
          role: "system",
          author: "SyncAI",
          text: "The OV-12 intervention is in its governed manufacturing value-verification window.",
          createdAt: seedTime,
          meta: "Manufacturing outcome verification",
        },
        {
          id: "message-ov12-assistant",
          role: "assistant",
          author: "SyncAI",
          text: "Twenty-seven released batches show 9.2% lower normalized energy and a 1.7-point first-pass-yield gain. Three batches remain before Finance can verify annualized value.",
          createdAt: seedTime,
          meta: "Deterministic value analysis",
        },
      ],
      tokensUsed: 2050,
    },
  ];
}

export function createSeedDecisionCases(
  context: DecisionJourneyContext = {},
): DecisionCase[] {
  const industry = normalizeDecisionIndustry(context.industry);
  if (industry === "mining") return miningCases(context);
  if (industry === "manufacturing") return manufacturingCases(context);
  return [pumpCase(context), compressorCase(context), boilerCase(context)];
}

export function createDraftDecisionCase(
  role: string,
  industry: DecisionIndustryId = "oil-gas",
): DecisionCase {
  const seed = createSeedDecisionCases({ role, industry })[0];
  const suffix = Date.now().toString().slice(-5);
  return {
    ...seed,
    id: `draft-${suffix}`,
    caseNumber: `DRAFT-${suffix}`,
    version: "v0.1",
    title: "Define a new governed decision",
    objective:
      "State the decision, affected asset, expected value, evidence boundary, and required technical authority.",
    asset: "Decision scope not yet defined",
    assetContext: "Awaiting asset selection",
    risk: "moderate",
    valueExposure: 0,
    evidenceScore: 0,
    authorityRole: "Authority not yet assigned",
    statusLabel: "Define intent",
    stage: "intent",
    createdFromIntake: false,
    recommendation: "No recommendation until the decision intent is defined.",
    recommendationDetail:
      "Use the cowork conversation to define the asset, decision boundary, evidence, value target, and accountable authority.",
    priorityReason:
      "Draft cases are excluded from portfolio exposure and ranking.",
    decisionMetrics: [],
    evidence: [],
    calculations: [],
    approvals: [],
    comments: [],
    workPackage: {
      id: `wp-draft-${suffix}`,
      number: "Not created",
      title: "Work package created after authority approval",
      targetSystem: "Not selected",
      status: "locked",
      controls: [],
    },
    valueMetrics: [],
    financeSponsor: "Not assigned",
    financeStatus: "pending",
    messages: [
      {
        id: `draft-system-${suffix}`,
        role: "system",
        author: "SyncAI",
        text: "What decision must the organization make, which asset is affected, and what measurable outcome would prove value?",
        createdAt: new Date().toISOString(),
        meta: "Intent definition",
      },
    ],
    tokensUsed: 0,
  };
}

export function readDecisionCases(
  storage: Pick<Storage, "getItem">,
  context: DecisionJourneyContext = {},
  storageKey = DECISION_CASE_STORAGE_KEY,
): DecisionCase[] {
  try {
    const saved = storage.getItem(storageKey);
    const parsed = saved ? (JSON.parse(saved) as DecisionCase[]) : null;
    return Array.isArray(parsed) && parsed.length
      ? parsed
      : createSeedDecisionCases(context);
  } catch {
    return createSeedDecisionCases(context);
  }
}

export function writeDecisionCases(
  storage: Pick<Storage, "setItem">,
  cases: DecisionCase[],
  storageKey = DECISION_CASE_STORAGE_KEY,
) {
  storage.setItem(storageKey, JSON.stringify(cases));
}

export function stageDecisionCaseHandoff(
  storage: Pick<Storage, "setItem">,
  decisionCase: DecisionCase,
) {
  const handoff: PendingDecisionCaseHandoff = {
    decisionCase,
    stagedAt: new Date().toISOString(),
  };
  storage.setItem(PENDING_DECISION_CASE_HANDOFF_KEY, JSON.stringify(handoff));
}

export function readDecisionCaseHandoff(
  storage: Pick<Storage, "getItem">,
): PendingDecisionCaseHandoff | null {
  try {
    const raw = storage.getItem(PENDING_DECISION_CASE_HANDOFF_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingDecisionCaseHandoff) : null;
    if (
      !parsed?.decisionCase ||
      typeof parsed.decisionCase.id !== "string" ||
      typeof parsed.decisionCase.caseNumber !== "string" ||
      typeof parsed.decisionCase.asset !== "string" ||
      !Array.isArray(parsed.decisionCase.messages)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDecisionCaseHandoff(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(PENDING_DECISION_CASE_HANDOFF_KEY);
}

export function formatDecisionValue(value: number): string {
  if (value === 0) return "Draft";
  return value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2)}M`
    : `$${Math.round(value / 1000)}k`;
}

export const DECISION_CASE_STAGES: Array<{
  id: DecisionCaseStage;
  label: string;
}> = [
  { id: "intent", label: "Intent" },
  { id: "asset_truth", label: "Asset truth" },
  { id: "evidence", label: "Evidence" },
  { id: "analysis", label: "Analysis" },
  { id: "authority", label: "Authority" },
  { id: "execution", label: "Execution" },
  { id: "outcomes", label: "Outcomes" },
  { id: "learning", label: "Learning" },
];
