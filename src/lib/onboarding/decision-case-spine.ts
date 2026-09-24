/**
 * Decision Case spine — auto-build, evidence, disposition, verification,
 * invite, and loop-maturity readiness. P1 records a counterfactual before
 * Accept, cites evidence already on the case, an optional decision expiry,
 * verification-owner attribution, an advisory / review / ops label, and a
 * local proof summary. Reuses the canonical DecisionCase. Does not
 * re-implement the Ask-first opening and does not create a development case.
 */
import {
  createHonestEmptyDecisionCase,
  isSeedDecisionCaseId,
} from "../decision-case-honesty";
import type {
  DecisionApproval,
  DecisionCase,
  DecisionCaseStage,
  DecisionEvidence,
  EvidenceQuality,
} from "../decision-case";
import type { InvertedIntentId } from "./inverted-opening";

const BANNED_SEED =
  /Fort McMurray|North Ridge Energy|P-101|dc-1048|Copper Ridge/i;

export const SPINE_STAGES = [
  "QUESTION",
  "EVIDENCE",
  "RECOMMENDATION",
  "HUMAN DECISION",
  "ACTION",
  "VERIFICATION",
  "LEARNING",
] as const;

export type EvidenceKind =
  "work_history" | "condition" | "documents" | "inspection" | "schedule_cost";

export const EVIDENCE_KINDS: ReadonlyArray<{
  id: EvidenceKind;
  title: string;
  ask: string;
}> = [
  {
    id: "work_history",
    title: "Work history",
    ask: "Work orders, failure codes, repair notes, or downtime events.",
  },
  {
    id: "condition",
    title: "Condition",
    ask: "Vibration, temperature, oil, process, or other condition readings.",
  },
  {
    id: "documents",
    title: "Documents",
    ask: "OEM manuals, drawings, procedures, or prior engineering notes.",
  },
  {
    id: "inspection",
    title: "Inspection",
    ask: "Field inspection, NDT, or walkdown findings.",
  },
  {
    id: "schedule_cost",
    title: "Schedule / cost",
    ask: "Outage window, craft hours, parts lead time, or cost exposure.",
  },
];

export type EvidenceMethod =
  "upload_file" | "paste_data" | "connect_source" | "manual" | "ask_admin";

export const EVIDENCE_METHODS: ReadonlyArray<{
  id: EvidenceMethod;
  title: string;
}> = [
  { id: "upload_file", title: "Upload a file" },
  { id: "paste_data", title: "Paste data" },
  { id: "connect_source", title: "Connect a source" },
  { id: "manual", title: "Continue with manual evidence" },
  { id: "ask_admin", title: "Ask an admin later" },
];

export const CONNECTION_FAILURE_FALLBACKS: readonly EvidenceMethod[] = [
  "upload_file",
  "paste_data",
  "manual",
  "ask_admin",
];

export type SpineDisposition =
  "accept" | "reject" | "need_more_evidence" | "park" | "escalate";

export const SPINE_DISPOSITIONS: ReadonlyArray<{
  id: SpineDisposition;
  title: string;
  hint: string;
}> = [
  {
    id: "accept",
    title: "Accept",
    hint: "Why this is the decision, and under what conditions.",
  },
  {
    id: "reject",
    title: "Reject",
    hint: "What is wrong, unsafe, or unsupported.",
  },
  {
    id: "need_more_evidence",
    title: "Need more evidence",
    hint: "Which missing evidence blocks a defensible decision.",
  },
  {
    id: "park",
    title: "Park",
    hint: "Why this waits, and what trigger reopens it.",
  },
  {
    id: "escalate",
    title: "Escalate",
    hint: "Which authority must take this, and why it is outside this owner.",
  },
];

export type VerificationEffectiveness =
  "effective" | "partially_effective" | "ineffective" | "inconclusive";

export const VERIFICATION_EFFECTIVENESS: ReadonlyArray<{
  id: VerificationEffectiveness;
  title: string;
}> = [
  { id: "effective", title: "Effective" },
  { id: "partially_effective", title: "Partially effective" },
  { id: "ineffective", title: "Ineffective" },
  { id: "inconclusive", title: "Inconclusive" },
];

export type CasePeople = {
  decisionOwner: string;
  recommendationAuthor: string;
  requiredApprover: string;
  verificationOwner: string;
};

export type VerificationPlan = {
  question: string;
  expected: string;
  actual: string;
  evidence: string;
  scheduledFor: string;
  effectiveness: VerificationEffectiveness | "";
  /** Named Verification Owner. Links Actual / Evidence; not an effectiveness score. */
  attributedTo?: string;
};

export type DispositionRecord = {
  /** What would change the recommendation. Required before Accept is locked. */
  counterfactual?: string;
  /** Optional YYYY-MM-DD. Not an auto-revoke and not plant execute. */
  expiresOn?: string;
};

export type LoopGateId =
  | "decision_loop"
  | "evidence_path"
  | "named_approver"
  | "verification"
  | "audit_trail";

export type LoopGate = {
  id: LoopGateId;
  title: string;
  met: boolean;
  evidence: string;
};

export type SpineReadiness = {
  gates: LoopGate[];
  metCount: number;
  total: number;
  headline: string;
};

export type EvidenceLineage = {
  evidenceCount: number;
  missing: string[];
  assumptions: string[];
  confidencePct: number;
  requiredAuthority: string;
  verificationStatus: string;
  honesty: string;
};

export function inferRequiredAuthority(
  question: string,
  intent: InvertedIntentId | "",
): string {
  const text = question.toLowerCase();
  if (intent === "connect") {
    return "Workspace administrator (integration authority)";
  }
  if (
    /\b(safety|isolation|lockout|hazardous|oem limit|shutdown|startup|regulatory)\b/.test(
      text,
    )
  ) {
    return "Named technical authority for safety / isolation / OEM-limit change";
  }
  if (intent === "coordinate" || /\b(field|crew|permit|outage)\b/.test(text)) {
    return "Operations / field supervisor with permit and work-release authority";
  }
  return "Reliability Engineer with named approver for the recommended change";
}

export function noConnectedDataHonesty(): string {
  return "No connected operating data. Structure reasoning is valid. An asset-specific recommendation is not justified until you attach evidence.";
}

export function policyAdvisory(requiredAuthority: string): string {
  return `Requires ${requiredAuthority} under this workspace's current policy. Sync recommends; it does not authorize. Plant execute stays disabled.`;
}

export function inviteCopy(authority: string): string {
  return `This decision requires approval from someone with ${authority}. Invite them now.`;
}

export function spineAssumptions(hasSuppliedEvidence: boolean): string[] {
  if (hasSuppliedEvidence) {
    return [
      "Attached records are customer-supplied evidence, not a certified PI/CMMS.",
      "No OEM limit or safety threshold is invented.",
    ];
  }
  return [
    "No connected plant, historian, or CMMS feed is in this workspace.",
    "Structure reasoning is allowed. An asset-specific recommendation is not.",
    "No silent demo case or fabricated reading is used.",
    "Engineering thresholds are not invented. Missing limits stay missing.",
  ];
}

export function computeConfidencePct(evidence: DecisionEvidence[]): number {
  if (evidence.length === 0) return 8;
  const supplied = evidence.filter(
    (item) => item.quality === "high" || item.quality === "medium",
  ).length;
  const missing = evidence.filter(
    (item) => item.quality === "missing" || item.quality === "conflict",
  ).length;
  const raw = Math.round(
    (supplied / Math.max(1, supplied + missing)) * 70 + (supplied > 0 ? 12 : 8),
  );
  return Math.min(82, Math.max(8, raw));
}

function missingSlots(): DecisionEvidence[] {
  const now = new Date().toISOString();
  return EVIDENCE_KINDS.map((kind) => ({
    id: `missing-${kind.id}`,
    title: kind.title,
    summary: kind.ask,
    quality: "missing" as const,
    state: "Not supplied",
    record: "No customer record attached",
    finding: `Missing ${kind.title.toLowerCase()} — required before an asset-specific recommendation.`,
    lineage: `Ask-first spine · ${now} · type asked before system mapping`,
    sourceSystem: "Not connected",
  }));
}

export function buildSpineDecisionCase(input: {
  question: string;
  intent: InvertedIntentId | "";
}): DecisionCase {
  const question = input.question.trim();
  if (question.length < 12) {
    throw new Error("A Decision Case needs a real question.");
  }
  if (BANNED_SEED.test(question)) {
    throw new Error(
      "Seed plant names are not accepted as a first-run subject.",
    );
  }
  const empty = createHonestEmptyDecisionCase("Reliability Engineer");
  if (isSeedDecisionCaseId(empty.id)) {
    throw new Error("Spine refused a seed Decision Case id.");
  }
  const missing = missingSlots();
  const authority = inferRequiredAuthority(question, input.intent);
  const assumptions = spineAssumptions(false);
  const confidence = computeConfidencePct(missing);
  const createdAt = new Date().toISOString();
  return {
    ...empty,
    title: question.slice(0, 140),
    objective: question,
    asset: "Decision scope named by the question — no seeded asset",
    assetContext: "Provisional workspace. No connected asset record.",
    recommendation:
      "No asset-specific recommendation yet. The case structure is ready; the decision is not.",
    recommendationDetail: noConnectedDataHonesty(),
    authorityRole: authority,
    statusLabel: "Ask-first assessment",
    stage: "evidence",
    evidenceScore: confidence,
    evidence: missing,
    decisionMetrics: [
      {
        label: "Confidence",
        value: `${confidence}%`,
        detail: "Low because no operating evidence is attached",
      },
      {
        label: "Assumptions",
        value: String(assumptions.length),
        detail: assumptions[0],
      },
      {
        label: "Missing evidence",
        value: String(missing.length),
        detail: "Asked by type before any Historian-vs-CMMS choice",
      },
    ],
    approvals: [],
    messages: [
      {
        id: `spine-q-${empty.id}`,
        role: "user",
        author: "You",
        text: question,
        createdAt,
      },
      {
        id: `spine-a-${empty.id}`,
        role: "assistant",
        author: "SyncAI",
        text: [
          noConnectedDataHonesty(),
          "",
          "Missing evidence (type first):",
          ...missing.map((item) => `- ${item.title}: ${item.finding}`),
          "",
          "Assumptions:",
          ...assumptions.map((item) => `- ${item}`),
          "",
          policyAdvisory(authority),
        ].join("\n"),
        createdAt,
        meta: "Ask-first preliminary recommendation",
      },
    ],
    comments: [],
    createdFromIntake: true,
    intakeRole: input.intent || "unspecified",
  };
}

export function attachSpineEvidence(
  decisionCase: DecisionCase,
  kind: EvidenceKind,
  method: EvidenceMethod,
  body: string,
): DecisionCase {
  const text = body.trim();
  if (!text && method !== "ask_admin") return decisionCase;
  const kindMeta = EVIDENCE_KINDS.find((item) => item.id === kind);
  const now = new Date().toISOString();
  if (method === "ask_admin") {
    return {
      ...decisionCase,
      updatedAt: now,
      messages: [
        ...decisionCase.messages,
        {
          id: `admin-later-${Date.now()}`,
          role: "system",
          author: "Connection",
          text: `${kindMeta?.title ?? kind} left for an admin. Case stays open — upload, paste, or manual evidence remain available.`,
          createdAt: now,
          meta: "Connection fallback",
        },
      ],
    };
  }
  const nextItem: DecisionEvidence = {
    id: `ev-${kind}-${Date.now()}`,
    title: kindMeta?.title ?? kind,
    summary: text.slice(0, 280),
    quality: "medium",
    state: "Manually supplied",
    record: `Spine ${method}`,
    finding: text.slice(0, 400),
    lineage: `Customer-supplied · ${method} · ${now}`,
    sourceSystem:
      method === "connect_source" ? "Connection attempted" : "Manual / file",
  };
  const evidence = [
    nextItem,
    ...decisionCase.evidence.filter((item) => item.id !== `missing-${kind}`),
  ];
  const confidence = computeConfidencePct(evidence);
  return {
    ...decisionCase,
    evidence,
    evidenceScore: confidence,
    updatedAt: now,
    stage: decisionCase.stage === "evidence" ? "analysis" : decisionCase.stage,
    recommendation:
      "Preliminary recommendation can be reviewed against the attached evidence. It is still not authorization.",
    recommendationDetail:
      "Evidence was attached on this case. Asset-specific claims remain limited to what the attachment actually contains.",
    decisionMetrics: decisionCase.decisionMetrics.map((item) =>
      item.label === "Confidence"
        ? {
            ...item,
            value: `${confidence}%`,
            detail: "Rises only as supplied evidence is attached",
          }
        : item.label === "Missing evidence"
          ? {
              ...item,
              value: String(
                evidence.filter((row) => row.quality === "missing").length,
              ),
            }
          : item,
    ),
    messages: [
      ...decisionCase.messages,
      {
        id: `ev-msg-${Date.now()}`,
        role: "user",
        author: "You",
        text: `Added ${kindMeta?.title ?? kind} via ${method}: ${text.slice(0, 240)}`,
        createdAt: now,
      },
    ],
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function applyPeople(
  decisionCase: DecisionCase,
  people: CasePeople,
): DecisionCase {
  const approvals: DecisionApproval[] = [];
  if (people.requiredApprover.trim()) {
    approvals.push({
      id: "required-approver",
      initials: initials(people.requiredApprover),
      name: people.requiredApprover.trim(),
      role: "Required Approver",
      responsibility: inferRequiredAuthority(
        decisionCase.objective,
        (decisionCase.intakeRole as InvertedIntentId) || "",
      ),
      status: "reviewing",
    });
  }
  const now = new Date().toISOString();
  const rows: Array<[string, string]> = [
    ["Decision Owner", people.decisionOwner],
    ["Recommendation Author", people.recommendationAuthor],
    ["Required Approver", people.requiredApprover],
    ["Verification Owner", people.verificationOwner],
  ];
  return {
    ...decisionCase,
    financeSponsor: people.decisionOwner.trim() || decisionCase.financeSponsor,
    authorityRole: people.requiredApprover.trim() || decisionCase.authorityRole,
    approvals,
    comments: [
      ...decisionCase.comments.filter(
        (item) =>
          ![
            "Decision Owner",
            "Recommendation Author",
            "Required Approver",
            "Verification Owner",
          ].includes(item.author),
      ),
      ...rows
        .filter(([, value]) => value.trim())
        .map(([label, value], index) => ({
          id: `people-${index}-${now}`,
          author: label,
          text: value.trim(),
          createdAt: now,
        })),
    ],
  };
}

const DISPOSITION_COMMENT_IDS = [
  "counterfactual",
  "decision-expiry",
  "disposition-rationale",
  "disposition-id",
] as const;

export function applyDisposition(
  decisionCase: DecisionCase,
  disposition: SpineDisposition,
  rationale: string,
  people: CasePeople,
  record: DispositionRecord = {},
): DecisionCase {
  const reason = rationale.trim();
  if (!reason) {
    throw new Error("A short rationale is required for every disposition.");
  }
  const counterfactual = (record.counterfactual ?? "").trim();
  if (disposition === "accept" && !counterfactual) {
    throw new Error(
      "Accept stays unlocked until you say what would change this recommendation.",
    );
  }
  const expiresOn = (record.expiresOn ?? "").trim();
  if (expiresOn && !isCalendarDate(expiresOn)) {
    throw new Error("Decision expiry must be a date or left blank.");
  }
  const now = new Date().toISOString();
  const option = SPINE_DISPOSITIONS.find((item) => item.id === disposition);
  const withPeople = applyPeople(decisionCase, people);
  const status =
    disposition === "accept"
      ? ("approved" as const)
      : disposition === "reject"
        ? ("rejected" as const)
        : disposition === "escalate"
          ? ("delegated" as const)
          : disposition === "need_more_evidence"
            ? ("changes_requested" as const)
            : ("reviewing" as const);
  const changeSentence = counterfactual
    ? `What would change this recommendation: ${counterfactual}`
    : "What would change this recommendation was not stated.";
  const expirySentence = expiresOn
    ? `Decision expiry ${expiresOn}. Sync does not auto-revoke or execute when that date passes.`
    : "No decision expiry date set.";
  const extraComments: DecisionCase["comments"] = [
    {
      id: "disposition-id",
      author: "Disposition",
      text: disposition,
      createdAt: now,
    },
    {
      id: "disposition-rationale",
      author: "Disposition rationale",
      text: reason,
      createdAt: now,
    },
  ];
  if (counterfactual) {
    extraComments.push({
      id: "counterfactual",
      author: "What would change this recommendation",
      text: counterfactual,
      createdAt: now,
    });
  }
  if (expiresOn) {
    extraComments.push({
      id: "decision-expiry",
      author: "Decision expiry",
      text: expiresOn,
      createdAt: now,
    });
  }
  return {
    ...withPeople,
    stage: disposition === "accept" ? "outcomes" : "authority",
    statusLabel: `${option?.title ?? disposition} · not plant execute`,
    approvals: withPeople.approvals.map((item) =>
      item.id === "required-approver"
        ? { ...item, status, decidedAt: now }
        : item,
    ),
    comments: [
      ...withPeople.comments.filter(
        (item) =>
          !DISPOSITION_COMMENT_IDS.includes(
            item.id as (typeof DISPOSITION_COMMENT_IDS)[number],
          ),
      ),
      ...extraComments,
    ],
    messages: [
      ...withPeople.messages,
      {
        id: `disp-${Date.now()}`,
        role: "system",
        author: people.decisionOwner.trim() || "Decision Owner",
        text: `Disposition ${option?.title ?? disposition}: ${reason}. ${changeSentence} ${expirySentence} Recommend is not authorize. Plant execute stays disabled.`,
        createdAt: now,
        meta: "Human disposition",
      },
    ],
    workPackage: {
      ...withPeople.workPackage,
      status: "locked",
      targetSystem: "Not selected — plant execute disabled",
    },
  };
}

export function applyVerificationPlan(
  decisionCase: DecisionCase,
  plan: VerificationPlan,
): DecisionCase {
  if (!plan.expected.trim() || !plan.scheduledFor.trim()) {
    throw new Error("Verification needs Expected and a scheduled date.");
  }
  const now = new Date().toISOString();
  const hasOutcome = Boolean(plan.actual.trim() || plan.evidence.trim());
  const owner = (plan.attributedTo ?? "").trim();
  const attribution = outcomeAttribution(plan, owner);
  const recorded = Boolean(plan.effectiveness && hasOutcome);
  const scheduleText = recorded
    ? `Verification recorded as ${plan.effectiveness}. Expected: ${plan.expected}. Actual: ${plan.actual || "not stated"}. Evidence: ${plan.evidence || "not attached"}.`
    : `Verification scheduled for ${plan.scheduledFor}. Question: ${plan.question || "How will we know this worked?"}. Expected: ${plan.expected}.`;
  return {
    ...decisionCase,
    stage: recorded ? "learning" : "outcomes",
    statusLabel: recorded
      ? `Verification recorded · ${plan.effectiveness}`
      : `Verification scheduled · ${plan.scheduledFor}`,
    valueMetrics: [
      {
        id: "verify-expected",
        label: "Expected",
        detail: "How we will know this worked",
        baseline: plan.expected.trim(),
        target: plan.expected.trim(),
        actual: plan.actual.trim() || undefined,
        verifiedActual: plan.actual.trim() || "Pending",
      },
      {
        id: "verify-evidence",
        label: "Verification evidence",
        detail: plan.evidence.trim() || "Not yet attached",
        baseline: plan.scheduledFor,
        target: plan.question.trim() || "How will we know this worked?",
        actual: plan.effectiveness || undefined,
        verifiedActual: plan.effectiveness || "Scheduled",
      },
    ],
    comments: hasOutcome
      ? [
          ...decisionCase.comments.filter(
            (item) => item.id !== "outcome-attribution",
          ),
          {
            id: "outcome-attribution",
            author: "Outcome attribution",
            text: attribution.line,
            createdAt: now,
          },
        ]
      : decisionCase.comments.filter(
          (item) => item.id !== "outcome-attribution",
        ),
    learningRecord: recorded
      ? {
          id: `learn-${decisionCase.caseNumber}`,
          status: "candidate",
          summary: `${plan.effectiveness}: expected ${plan.expected}; actual ${plan.actual || "not stated"}; evidence ${plan.evidence || "not attached"}. ${attribution.line}`,
        }
      : decisionCase.learningRecord,
    messages: [
      ...decisionCase.messages,
      {
        id: `verify-${Date.now()}`,
        role: "system",
        author: attribution.attributed ? owner : "Verification",
        text: hasOutcome ? `${attribution.line} ${scheduleText}` : scheduleText,
        createdAt: now,
        meta: "Verification obligation",
      },
    ],
  };
}

export function applyInvite(
  decisionCase: DecisionCase,
  input: { name: string; email: string; authority: string },
): DecisionCase {
  const name = input.name.trim();
  const email = input.email.trim();
  const authority = input.authority.trim() || decisionCase.authorityRole;
  if (!name && !email) {
    throw new Error("Invite needs a name or work email.");
  }
  const now = new Date().toISOString();
  const label = name || email;
  const existing = decisionCase.approvals.some(
    (item) => item.id === "required-approver",
  );
  return {
    ...decisionCase,
    approvals: existing
      ? decisionCase.approvals.map((item) =>
          item.id === "required-approver"
            ? { ...item, name: label, role: authority }
            : item,
        )
      : [
          ...decisionCase.approvals,
          {
            id: "required-approver",
            initials: initials(label),
            name: label,
            role: authority,
            responsibility: `Invited to this Decision Case · ${email || "no email yet"}`,
            status: "next",
          },
        ],
    messages: [
      ...decisionCase.messages,
      {
        id: `invite-${Date.now()}`,
        role: "system",
        author: "Invite",
        text: `${inviteCopy(authority)} Recorded for ${label}${email ? ` <${email}>` : ""}. Delivery is a workspace-admin action if mail is not configured.`,
        createdAt: now,
        meta: "Contextual invite",
      },
    ],
  };
}

export function lineageFromCase(
  decisionCase: DecisionCase,
  verification?: VerificationPlan | null,
): EvidenceLineage {
  const missing = decisionCase.evidence
    .filter((item) => item.quality === "missing" || item.quality === "conflict")
    .map((item) => item.title);
  const supplied = decisionCase.evidence.filter(
    (item) => item.quality === "high" || item.quality === "medium",
  );
  const verificationStatus = verification?.effectiveness
    ? `Recorded · ${verification.effectiveness}`
    : verification?.scheduledFor
      ? `Scheduled · ${verification.scheduledFor}`
      : "Not scheduled";
  return {
    evidenceCount: supplied.length,
    missing,
    assumptions: spineAssumptions(supplied.length > 0),
    confidencePct: computeConfidencePct(decisionCase.evidence),
    requiredAuthority: decisionCase.authorityRole,
    verificationStatus,
    honesty:
      supplied.length === 0
        ? noConnectedDataHonesty()
        : "Recommendation is limited to attached evidence. It is not authorization.",
  };
}

export function readinessFromCase(
  decisionCase: DecisionCase,
  extras: {
    saved: boolean;
    disposition?: SpineDisposition | "";
    verification?: VerificationPlan | null;
    invited?: boolean;
    manualEvidencePath?: boolean;
  },
): SpineReadiness {
  const lineage = lineageFromCase(decisionCase, extras.verification);
  const hasAudit =
    decisionCase.messages.some((item) => item.role === "user") && extras.saved;
  const verificationMet = Boolean(
    extras.verification?.scheduledFor || extras.verification?.effectiveness,
  );
  const namedApprover = Boolean(
    decisionCase.approvals.some((item) => item.name.trim()) || extras.invited,
  );
  const evidencePath =
    lineage.evidenceCount > 0 || Boolean(extras.manualEvidencePath);
  const loopDemonstrated = Boolean(extras.disposition);
  const gates: LoopGate[] = [
    {
      id: "decision_loop",
      title: "Decision loop demonstrated",
      met: loopDemonstrated,
      evidence: loopDemonstrated
        ? `Human disposition recorded: ${extras.disposition}`
        : "Ask happened; a human disposition is still required",
    },
    {
      id: "evidence_path",
      title: "Evidence source or honest manual path",
      met: evidencePath,
      evidence: evidencePath
        ? `${lineage.evidenceCount} attached · ${lineage.missing.length} still missing`
        : "No file, paste, connection, or manual evidence yet",
    },
    {
      id: "named_approver",
      title: "Named approver",
      met: namedApprover,
      evidence: namedApprover
        ? decisionCase.authorityRole
        : "Required approver is not named",
    },
    {
      id: "verification",
      title: "Verification scheduled or recorded",
      met: verificationMet,
      evidence: lineage.verificationStatus,
    },
    {
      id: "audit_trail",
      title: "Audit trail",
      met: hasAudit,
      evidence: hasAudit
        ? `${decisionCase.messages.length} case turns retained`
        : "Save the assessment so the trail is on the workspace",
    },
  ];
  const metCount = gates.filter((item) => item.met).length;
  return {
    gates,
    metCount,
    total: gates.length,
    headline:
      metCount === gates.length
        ? "Stage-1 loop maturity: the first Decision Case loop is complete on this workspace."
        : `Stage-1 loop maturity: ${metCount} of ${gates.length} gates earned — not onboarding-screen ticks.`,
  };
}

/** Id of the last Decision Case this browser saved. Not case content. */
export const SPINE_SAVED_CASE_KEY = "syncai.spine-case-id.v1";

export function spineStageIndex(stage: DecisionCaseStage): number {
  switch (stage) {
    case "intent":
    case "asset_truth":
      return 0;
    case "evidence":
      return 1;
    case "analysis":
      return 2;
    case "authority":
      return 3;
    case "execution":
      return 4;
    case "outcomes":
      return 5;
    case "learning":
      return 6;
    default:
      return 0;
  }
}

export function describeUploadedFile(input: {
  name: string;
  type: string;
  size: number;
  text: string | null;
}): string {
  const name = input.name.trim() || "unnamed file";
  const kind = input.type || "unknown type";
  if (input.text && input.text.trim()) {
    return `File ${name} (${kind}, ${input.size} bytes):\n${input.text.trim().slice(0, 4000)}`;
  }
  return `File ${name} attached (${kind}, ${input.size} bytes). Text was not extracted. Paste an excerpt if it should be in the case. No readings were invented from the file.`;
}

export type ConnectionAttempt =
  | { ok: false; reason: string }
  | { ok: true; sourceName: string; note: string };

const USABLE_INTEGRATION = /^(healthy|connected|active|degraded)$/i;

/** Interprets existing integration rows. Does not invent a connector or readings. */
export function interpretConnectionAttempt(
  rows: Array<{ name: string; status: string }> | null,
  errorMessage?: string,
): ConnectionAttempt {
  if (errorMessage) {
    return {
      ok: false,
      reason: `Could not read integration status (${errorMessage}). The case stays open.`,
    };
  }
  if (!rows || rows.length === 0) {
    return {
      ok: false,
      reason: "No source is connected in this workspace.",
    };
  }
  const usable = rows.find((row) => USABLE_INTEGRATION.test(row.status));
  if (!usable) {
    return {
      ok: false,
      reason: `Sources are listed (${rows.map((row) => row.name).join(", ")}) but none are usable.`,
    };
  }
  return {
    ok: true,
    sourceName: usable.name,
    note: `${usable.name} is listed as ${usable.status}. This path does not pull tags or invent readings. Upload a CSV export or paste from that source.`,
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function commentText(decisionCase: DecisionCase, id: string): string {
  return (
    [...decisionCase.comments].reverse().find((item) => item.id === id)?.text ??
    ""
  );
}

export function counterfactualFromCase(decisionCase: DecisionCase): string {
  return commentText(decisionCase, "counterfactual");
}

export function expiryFromCase(decisionCase: DecisionCase): string {
  return commentText(decisionCase, "decision-expiry");
}

export function rationaleFromCase(decisionCase: DecisionCase): string {
  return commentText(decisionCase, "disposition-rationale");
}

export function dispositionFromCase(
  decisionCase: DecisionCase,
): SpineDisposition | "" {
  const stored = commentText(decisionCase, "disposition-id");
  if (SPINE_DISPOSITIONS.some((item) => item.id === stored)) {
    return stored as SpineDisposition;
  }
  const label = decisionCase.statusLabel.trim().toLowerCase();
  return (
    SPINE_DISPOSITIONS.find((item) =>
      label.startsWith(item.title.toLowerCase()),
    )?.id ?? ""
  );
}

export function peopleFromCase(decisionCase: DecisionCase): CasePeople {
  const text = (author: string) =>
    [...decisionCase.comments].reverse().find((item) => item.author === author)
      ?.text ?? "";
  return {
    decisionOwner: text("Decision Owner"),
    recommendationAuthor: text("Recommendation Author") || "SyncAI",
    requiredApprover: text("Required Approver"),
    verificationOwner: text("Verification Owner"),
  };
}

export function verificationFromCase(
  decisionCase: DecisionCase,
): VerificationPlan | null {
  const expected = decisionCase.valueMetrics.find(
    (item) => item.id === "verify-expected",
  );
  const evidence = decisionCase.valueMetrics.find(
    (item) => item.id === "verify-evidence",
  );
  if (!expected && !evidence) return null;
  const effectivenessRaw = evidence?.actual ?? "";
  const effectiveness = VERIFICATION_EFFECTIVENESS.some(
    (item) => item.id === effectivenessRaw,
  )
    ? (effectivenessRaw as VerificationEffectiveness)
    : "";
  return {
    question: evidence?.target || "How will we know this worked?",
    expected: expected?.baseline ?? "",
    actual: expected?.actual ?? "",
    evidence:
      !evidence || evidence.detail === "Not yet attached"
        ? ""
        : evidence.detail,
    scheduledFor: evidence?.baseline ?? "",
    effectiveness,
    attributedTo: peopleFromCase(decisionCase).verificationOwner,
  };
}

export type ProvenanceCite = {
  id: string;
  title: string;
  sourceSystem: string;
  lineage: string;
  quality: EvidenceQuality;
  summary: string;
};

/** Cites evidence already attached. Missing slots are not sources. */
export function provenanceFromCase(decisionCase: DecisionCase): {
  cites: ProvenanceCite[];
  note: string;
} {
  const cites = decisionCase.evidence
    .filter((item) => item.quality === "high" || item.quality === "medium")
    .map((item) => ({
      id: item.id,
      title: item.title,
      sourceSystem: item.sourceSystem,
      lineage: item.lineage,
      quality: item.quality,
      summary: item.summary,
    }));
  return {
    cites,
    note:
      cites.length > 0
        ? "Provenance cites evidence already on this case. It does not add a source that was not attached."
        : "No supplied evidence is on this case. Provenance cannot cite a source that was not attached.",
  };
}

export function outcomeAttribution(
  plan: Pick<VerificationPlan, "actual" | "evidence">,
  verificationOwner: string,
): { attributed: boolean; line: string } {
  const owner = verificationOwner.trim();
  const hasOutcome = Boolean(plan.actual.trim() || plan.evidence.trim());
  if (!hasOutcome) {
    return {
      attributed: false,
      line: "Actual and verification evidence are not recorded yet. Effectiveness alone is not attribution.",
    };
  }
  if (!owner) {
    return {
      attributed: false,
      line: "Actual and verification evidence are not linked to a Verification Owner. Name that person to attribute the outcome.",
    };
  }
  return {
    attributed: true,
    line: `Actual and verification evidence are linked to Verification Owner ${owner}.`,
  };
}

export type SpineCaseClass = "advisory" | "review" | "ops";

export type SpineClassification = {
  id: SpineCaseClass;
  label: "Advisory" | "Review" | "Ops";
  basis: string;
};

const TECHNICAL_EVIDENCE: ReadonlySet<EvidenceKind> = new Set([
  "work_history",
  "condition",
  "documents",
  "inspection",
]);

function suppliedEvidenceKinds(evidence: DecisionEvidence[]): EvidenceKind[] {
  const found = new Set<EvidenceKind>();
  for (const item of evidence) {
    if (item.quality !== "high" && item.quality !== "medium") continue;
    const fromId =
      /^ev-(work_history|condition|documents|inspection|schedule_cost)-/.exec(
        item.id,
      );
    if (fromId) {
      found.add(fromId[1] as EvidenceKind);
      continue;
    }
    const byTitle = EVIDENCE_KINDS.find(
      (kind) => kind.title.toLowerCase() === item.title.trim().toLowerCase(),
    );
    if (byTitle) found.add(byTitle.id);
  }
  return EVIDENCE_KINDS.map((kind) => kind.id).filter((id) => found.has(id));
}

function intentOf(decisionCase: DecisionCase): InvertedIntentId | "" {
  const role = decisionCase.intakeRole;
  if (role === "solve" || role === "coordinate" || role === "connect") {
    return role;
  }
  return "";
}

/**
 * Class from intent, attached evidence types, and disposition.
 * Does not read criticality, duty, consequence, or a signed approval policy.
 */
export function classifySpineCase(
  decisionCase: DecisionCase,
  disposition: SpineDisposition | "" = "",
): SpineClassification {
  const intent = intentOf(decisionCase);
  const kinds = suppliedEvidenceKinds(decisionCase.evidence);
  const technical = kinds.filter((kind) => TECHNICAL_EVIDENCE.has(kind));
  const honesty =
    "Class uses intent, attached evidence types, and disposition. Criticality, duty, consequence, and a signed approval policy are not used.";
  const hold =
    disposition === "need_more_evidence" ||
    disposition === "park" ||
    disposition === "reject" ||
    disposition === "escalate";
  if (hold) {
    return {
      id: "review",
      label: "Review",
      basis: `Disposition is ${disposition}${intent ? ` on intent ${intent}` : ""}. The case stays in review while that hold stands. ${honesty}`,
    };
  }
  if (intent === "coordinate" || intent === "connect") {
    return {
      id: "ops",
      label: "Ops",
      basis: `Intent is ${intent}. ${
        kinds.length
          ? `Supplied evidence types: ${kinds.join(", ")}.`
          : "No supplied evidence types yet."
      } ${honesty}`,
    };
  }
  const scheduleOnly =
    kinds.length > 0 && kinds.every((kind) => kind === "schedule_cost");
  if (scheduleOnly && technical.length === 0) {
    return {
      id: "ops",
      label: "Ops",
      basis: `Supplied evidence is schedule / cost only. ${honesty}`,
    };
  }
  if (kinds.length === 0) {
    return {
      id: "review",
      label: "Review",
      basis: `No supplied evidence is attached${intent ? ` (intent ${intent})` : ""}. An advisory label would over-claim. ${honesty}`,
    };
  }
  return {
    id: "advisory",
    label: "Advisory",
    basis: `Intent is ${intent || "unspecified"} with supplied evidence (${kinds.join(", ")})${disposition ? ` and disposition ${disposition}` : ""}. ${honesty}`,
  };
}

export function buildProofSummary(input: {
  decisionCase: DecisionCase;
  disposition: SpineDisposition | "";
  rationale: string;
  counterfactual: string;
  expiresOn: string;
  people: CasePeople;
  verification: VerificationPlan;
}): string {
  const recordedPeople = peopleFromCase(input.decisionCase);
  const people: CasePeople = {
    decisionOwner:
      input.people.decisionOwner.trim() || recordedPeople.decisionOwner,
    recommendationAuthor:
      input.people.recommendationAuthor.trim() ||
      recordedPeople.recommendationAuthor,
    requiredApprover:
      input.people.requiredApprover.trim() || recordedPeople.requiredApprover,
    verificationOwner:
      input.people.verificationOwner.trim() || recordedPeople.verificationOwner,
  };
  const disposition =
    input.disposition || dispositionFromCase(input.decisionCase);
  const recordedDisposition = dispositionFromCase(input.decisionCase);
  const rationale =
    input.rationale.trim() || rationaleFromCase(input.decisionCase);
  const counterfactual =
    input.counterfactual.trim() || counterfactualFromCase(input.decisionCase);
  const expiresOn =
    input.expiresOn.trim() || expiryFromCase(input.decisionCase);
  const recordedPlan = verificationFromCase(input.decisionCase);
  const verification: VerificationPlan = {
    question:
      input.verification.question.trim() ||
      recordedPlan?.question ||
      "How will we know this worked?",
    expected:
      input.verification.expected.trim() || recordedPlan?.expected || "",
    actual: input.verification.actual.trim() || recordedPlan?.actual || "",
    evidence:
      input.verification.evidence.trim() || recordedPlan?.evidence || "",
    scheduledFor:
      input.verification.scheduledFor.trim() ||
      recordedPlan?.scheduledFor ||
      "",
    effectiveness:
      input.verification.effectiveness || recordedPlan?.effectiveness || "",
    attributedTo: people.verificationOwner,
  };
  const classification = classifySpineCase(input.decisionCase, disposition);
  const provenance = provenanceFromCase(input.decisionCase);
  const attribution = outcomeAttribution(
    verification,
    people.verificationOwner,
  );
  const missing = input.decisionCase.evidence
    .filter((item) => item.quality === "missing" || item.quality === "conflict")
    .map((item) => item.title);
  const dispositionTitle =
    SPINE_DISPOSITIONS.find((item) => item.id === disposition)?.title ??
    "Not recorded";
  const locked =
    Boolean(disposition) && disposition === recordedDisposition
      ? "recorded on the case"
      : disposition
        ? "selected on this page, not recorded on the case"
        : "not recorded";
  const lines = [
    "# Decision Case proof summary",
    "",
    `Case: ${input.decisionCase.caseNumber}`,
    `Class: ${classification.label}`,
    `Basis: ${classification.basis}`,
    "",
    "## Ask",
    input.decisionCase.objective.trim() || "No question recorded.",
    "",
    "## Evidence",
    ...(provenance.cites.length
      ? provenance.cites.map(
          (cite) =>
            `- ${cite.title} — ${cite.sourceSystem} — ${cite.lineage} — ${cite.summary}`,
        )
      : ["- No supplied evidence is attached."]),
    missing.length
      ? `Still missing: ${missing.join(", ")}.`
      : "No missing evidence slots remain.",
    "",
    "## Recommendation",
    input.decisionCase.recommendation,
    input.decisionCase.recommendationDetail,
    "",
    "## Provenance",
    provenance.note,
    ...provenance.cites.map(
      (cite) =>
        `- ${cite.title} (${cite.sourceSystem}); lineage: ${cite.lineage}`,
    ),
    "",
    "## Human decision",
    `Disposition: ${dispositionTitle} (${locked})`,
    `Rationale: ${rationale || "Not recorded."}`,
    `What would change this recommendation: ${counterfactual || "Not stated."}`,
    `Decision expiry: ${expiresOn || "Not set."}`,
    `Decision Owner: ${people.decisionOwner || "Not named."}`,
    `Recommendation Author: ${people.recommendationAuthor || "Not named."}`,
    `Required Approver: ${people.requiredApprover || "Not named."}`,
    `Verification Owner: ${people.verificationOwner || "Not named."}`,
    "Plant execute stays disabled. Sync recommends; it does not authorize.",
    expiresOn
      ? "A decision expiry is a date on the human decision. Sync does not auto-revoke or execute when it passes."
      : "No decision expiry date is set.",
    "",
    "## Verification",
    `Question: ${verification.question}`,
    `Expected: ${verification.expected || "Not stated."}`,
    `Scheduled: ${verification.scheduledFor || "Not scheduled."}`,
    `Actual: ${verification.actual || "Not stated."}`,
    `Evidence: ${verification.evidence || "Not attached."}`,
    `Effectiveness: ${verification.effectiveness || "Not recorded."}`,
    attribution.line,
    "",
    "## Not loaded",
    "Criticality, duty, and consequence are not stated unless you add them as evidence.",
    "No approval-policy record is loaded. Required authority stays inferred from the question.",
    "",
    "Read-only recap of this case in the session. Not a governed evidence vault and not a development case.",
  ];
  return lines.join("\n");
}

export function proofDownloadName(caseNumber: string): string {
  const safe = caseNumber
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safe || "decision-case"}-proof.md`;
}

export function unknownsFromCase(decisionCase: DecisionCase): string[] {
  const missing = decisionCase.evidence
    .filter((item) => item.quality === "missing" || item.quality === "conflict")
    .map((item) => `${item.title} is not attached.`);
  const rows = [
    ...missing,
    "Criticality, duty, and consequence are not stated unless you add them.",
    "No approval-policy record is loaded. Required authority is inferred from the question, not from a signed matrix.",
  ];
  const supplied = decisionCase.evidence.some(
    (item) => item.quality === "high" || item.quality === "medium",
  );
  if (!supplied) {
    rows.unshift(
      "No connected operating data. An asset-specific recommendation is not justified.",
    );
  }
  return rows;
}
