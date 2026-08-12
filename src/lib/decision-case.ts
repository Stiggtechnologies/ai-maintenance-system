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

export interface DecisionCase {
  id: string;
  caseNumber: string;
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
  decisionMetrics: Array<{ label: string; value: string; detail: string }>;
  evidence: DecisionEvidence[];
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
  }>;
  financeSponsor: string;
  financeStatus: "baseline_approved" | "pending" | "verified";
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

export const DECISION_CASE_STORAGE_KEY = "syncai.decisionCases.v1";
export const DEFAULT_DECISION_CASE_ID = "dc-1048";
const seedTime = "2026-08-12T16:00:00.000Z";

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
    decisionMetrics: [
      { label: "Seal failures", value: "5", detail: "in 9 months" },
      { label: "Downtime", value: "180 h", detail: "documented" },
      { label: "Startup-linked", value: "80%", detail: "of failures" },
    ],
    evidence,
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
      },
      {
        id: "value-startups",
        label: "Startup exceptions",
        detail: "Per 10 starts",
        baseline: "4",
        target: "0",
      },
      {
        id: "value-effort",
        label: "Inspection effort",
        detail: "Annualized",
        baseline: "48 h",
        target: "16 h",
      },
      {
        id: "value-avoided",
        label: "Avoided downtime value",
        detail: "Finance-approved rate",
        baseline: "$0",
        target: "$210k",
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

function alternateCase(
  base: DecisionCase,
  overrides: Partial<DecisionCase>,
): DecisionCase {
  return { ...base, ...overrides };
}

export function createSeedDecisionCases(
  context: DecisionJourneyContext = {},
): DecisionCase[] {
  const pump = pumpCase(context);
  return [
    pump,
    alternateCase(pumpCase({}), {
      id: "dc-1049",
      caseNumber: "DC-1049",
      title: "Determine what is driving C-204 repeat compressor trips",
      objective:
        "Resolve the configuration conflict and authorize the smallest controlled operating intervention.",
      asset: "C-204 compressor",
      assetContext: "Compression · Unit 2",
      risk: "critical",
      valueExposure: 420000,
      evidenceScore: 82,
      authorityRole: "Operations Authority",
      statusLabel: "Evidence conflict",
      stage: "evidence",
      createdFromIntake: false,
      recommendation: "Do not authorize a permanent mechanical change yet.",
      recommendationDetail:
        "Collect aligned operating-state vibration, process-rate, and hot-alignment evidence before selecting an intervention.",
      workPackage: {
        ...pump.workPackage,
        id: "wp-7221",
        number: "WP-7221",
        title: "C-204 operating-state evidence capture",
      },
      financeSponsor: "R. Chen",
    }),
    alternateCase(pumpCase({}), {
      id: "dc-1036",
      caseNumber: "DC-1036",
      title: "Verify whether the B-12 efficiency intervention created value",
      objective:
        "Close the operating evidence window and obtain finance sign-off on realized energy value.",
      asset: "B-12 boiler",
      assetContext: "Utilities · Boiler house",
      risk: "moderate",
      valueExposure: 178000,
      evidenceScore: 91,
      authorityRole: "Finance Sponsor",
      statusLabel: "Value verification",
      stage: "outcomes",
      createdFromIntake: false,
      recommendation: "Complete the 30-day normalized efficiency comparison.",
      recommendationDetail:
        "The controlled intervention is complete. Finance sign-off is pending normalized fuel and production conditions.",
      workPackage: {
        ...pump.workPackage,
        id: "wp-7152",
        number: "WP-7152",
        title: "B-12 combustion optimization",
        status: "complete",
      },
      financeStatus: "pending",
    }),
  ];
}

export function readDecisionCases(
  storage: Pick<Storage, "getItem">,
  context: DecisionJourneyContext = {},
): DecisionCase[] {
  try {
    const saved = storage.getItem(DECISION_CASE_STORAGE_KEY);
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
) {
  storage.setItem(DECISION_CASE_STORAGE_KEY, JSON.stringify(cases));
}

export function formatDecisionValue(value: number): string {
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
