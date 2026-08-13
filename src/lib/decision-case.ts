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
}

export const DECISION_CASE_STORAGE_KEY = "syncai.decisionCases.v2";
export const PUBLIC_DECISION_CASE_STORAGE_KEY = "syncai.publicDecisionCases.v1";
export const PENDING_DECISION_CASE_HANDOFF_KEY =
  "syncai.pendingDecisionCaseHandoff.v1";
export const DEFAULT_DECISION_CASE_ID = "dc-1048";
const seedTime = "2026-08-12T16:00:00.000Z";

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
    organization: context.company || "North Ridge Operations",
    site: "Process Plant · Unit 1",
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

function compressorCase(): DecisionCase {
  const base = pumpCase({});
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

function boilerCase(): DecisionCase {
  const base = pumpCase({});
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

export function createSeedDecisionCases(
  context: DecisionJourneyContext = {},
): DecisionCase[] {
  return [pumpCase(context), compressorCase(), boilerCase()];
}

export function createDraftDecisionCase(role: string): DecisionCase {
  const seed = pumpCase({ role });
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
