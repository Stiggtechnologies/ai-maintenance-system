/**
 * Sync Develop — Case Workspace, first cut (/develop/cases/:caseId).
 * Slice 1 scope: case header, framework/stage position, gate list with
 * per-gate requirement rollup, gate-decision recording, sanction.
 *
 * HONESTY RULES THIS PAGE KEEPS:
 *   * The rollup is assessGate's verdict (gateRollup) — no readiness
 *     percentage is rendered anywhere, because the weighted calculation is
 *     D3.35 and does not exist yet. Where a number is not computable the
 *     page says so instead of inventing one.
 *   * Every mutation is a definer RPC; refusals are rendered VERBATIM. The
 *     client role gates only hide forms — authority lives in the database.
 *   * §44 sections live here as they become real: deliverables (D3.26),
 *     evidence (D11.17/18), risks (D5.22), decisions + options (D3.27/28),
 *     actions (D11.37), schedule (D5.28 import half) and — with Slice 2 —
 *     objective (D11.15), success contract (D1.01), business case & value
 *     (D2.01–D2.07), benefits (D9.10) and cost (recorded anchors only)
 *     render persisted rows with honest empty states. This is the §44
 *     one-page Case Workspace (D13.04); earned value, forecasts and change
 *     control remain Slice 4 and are absent, not mocked.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  GitBranch,
  Landmark,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import {
  acceptDeliverable,
  addDecisionOption,
  advanceCaseStage,
  bindActionToCase,
  bindRiskToCase,
  createCaseDecision,
  createCaseDeliverable,
  getDevelopmentCase,
  listBindableActions,
  listBindableRisks,
  listIntakeDocuments,
  listOrgMembers,
  recordCaseEvidence,
  recordCaseGateReview,
  sanctionDevelopmentCase,
  selectDecisionOption,
  submitDeliverable,
  verifyEvidenceItem,
  type BindableAction,
  type BindableRisk,
  type GateConditionInput,
  type GateFindingInput,
  type IntakeDocumentOption,
  type OrgMember,
} from "../services/developService";
import {
  EVIDENCE_CLASSES,
  GATE_OUTCOMES,
  LIFECYCLE_TYPES,
  gateRollup,
  isPassingOutcome,
  openRiskBlockers,
  type CaseWorkspace,
  type WorkspaceDecision,
  type WorkspaceGate,
  type WorkspaceStage,
} from "../lib/develop";
import {
  BaselinesSection,
  EvidenceAgentPanel,
  GateReadinessPanel,
  OperationalReadinessSection,
  ScheduleSection,
} from "../components/develop/ReadinessPanels";
import {
  BenefitsSection,
  BusinessCaseSection,
  CostSection,
  ObjectiveSection,
  SuccessContractSection,
} from "../components/develop/ValueSpinePanels";

const REVIEW_ROLES = [
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
];

/** Roles that may register/frame (creation is preparation, not determination). */
const PLAN_ROLES = [...REVIEW_ROLES, "ai_admin", "planner"];

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

function money(value: number | null | undefined): string {
  if (value == null) return "not stated";
  return `$${Number(value).toLocaleString()}`;
}

interface ConditionDraft {
  description: string;
  owner_id: string;
  due_date: string;
  evidence_requirement: string;
  consequence_if_missed: string;
}

function GateCard({
  gate,
  caseId,
  canReview,
  members,
  riskBlockers,
  onRecorded,
}: {
  gate: WorkspaceGate;
  caseId: string;
  canReview: boolean;
  members: OrgMember[];
  riskBlockers: string[];
  onRecorded: () => void;
}) {
  const rollup = useMemo(
    () => gateRollup(gate, riskBlockers),
    [gate, riskBlockers],
  );
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [findings, setFindings] = useState<Record<number, GateFindingInput>>(
    {},
  );
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFinding = (
    criterionId: number,
    criterionText: string,
    status: "met" | "not_met" | "not_assessed",
    evidence?: string,
  ) => {
    setFindings((prev) => ({
      ...prev,
      [criterionId]: {
        criterion_id: criterionId,
        criterion_text: criterionText,
        status,
        evidence:
          evidence !== undefined ? evidence : prev[criterionId]?.evidence,
      },
    }));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const conditionInputs: GateConditionInput[] = conditions.map((c) => ({
        description: c.description,
        owner_id: c.owner_id,
        due_date: c.due_date,
        evidence_requirement: c.evidence_requirement,
        consequence_if_missed: c.consequence_if_missed,
      }));
      await recordCaseGateReview({
        caseId,
        gateId: gate.id,
        outcome,
        note,
        findings: Object.values(findings),
        conditions: conditionInputs,
      });
      setRecording(false);
      setOutcome("");
      setNote("");
      setFindings({});
      setConditions([]);
      onRecorded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed");
    } finally {
      setBusy(false);
    }
  };

  const latest = gate.latestReview;
  const passing = isPassingOutcome(rollup.latestOutcome);

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0 text-slate-500"
            aria-hidden
          />
        )}
        <span className="flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {gate.name}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${gate.decisionType === "checkpoint" ? "bg-white/5 text-slate-400" : "bg-signal-cyan/10 text-signal-cyan"}`}
            >
              {gate.decisionType}
            </span>
            {gate.independentAssuranceRequired && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                <ShieldCheck className="h-3 w-3" aria-hidden /> independent
                assurance
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">
            {rollup.criteriaTotal === 0
              ? "No requirements defined — this gate blocks nothing yet"
              : `${rollup.assessment.metCount} of ${rollup.mandatoryTotal} mandatory requirement(s) met on the latest review${rollup.hasReview ? "" : " — never assessed"}`}
          </span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            latest == null
              ? "bg-white/5 text-slate-400"
              : passing
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-amber-400/10 text-amber-300"
          }`}
        >
          {latest == null ? "no decision" : latest.outcome.replace(/_/g, " ")}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/6 px-3 py-3">
          <div className="text-xs text-slate-400">{rollup.assessment.reason}</div>

          {/* The §80 experience (D3.35/D13.05): readiness %, BLOCKED
              override, per-category bars, NAMED blockers (mandatory
              requirements, open High/Critical risks, open conditions) and
              the closure-rate projection — all rows of get_gate_readiness,
              rendered as returned. The client-side rollup above stays the
              assessGate voice; the numbers come from the one query. */}
          <GateReadinessPanel
            caseId={caseId}
            gateId={gate.id}
            gateName={gate.name}
            refreshKey={gate.latestReview?.id ?? 0}
          />

          {gate.criteria.length > 0 && (
            <ul className="space-y-1.5">
              {gate.criteria.map((c) => {
                const finding = latest?.findings.find(
                  (f) => f.criterion.trim() === c.criterion.trim(),
                );
                return (
                  <li
                    key={c.id}
                    className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-200">
                        {c.criterion}
                      </span>
                      {c.isMandatory ? (
                        <span className="rounded-full bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                          mandatory
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                          advisory
                        </span>
                      )}
                      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {c.sourceAuthority}
                      </span>
                      {finding && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${finding.status === "met" ? "bg-emerald-400/10 text-emerald-300" : finding.status === "not_met" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}
                        >
                          {finding.status.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    {recording && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {(["met", "not_met", "not_assessed"] as const).map(
                          (s) => (
                            <label
                              key={s}
                              className="flex items-center gap-1 text-[11px] text-slate-300"
                            >
                              <input
                                type="radio"
                                name={`finding-${gate.id}-${c.id}`}
                                checked={findings[c.id]?.status === s}
                                onChange={() =>
                                  setFinding(c.id, c.criterion, s)
                                }
                              />
                              {s.replace(/_/g, " ")}
                            </label>
                          ),
                        )}
                        <input
                          placeholder="Evidence"
                          value={findings[c.id]?.evidence ?? ""}
                          onChange={(e) =>
                            setFinding(
                              c.id,
                              c.criterion,
                              findings[c.id]?.status ?? "not_assessed",
                              e.target.value,
                            )
                          }
                          className="min-w-40 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
                        />
                      </div>
                    )}
                    {/* D12.07 — advisory evidence/gap agent, per criterion. */}
                    <EvidenceAgentPanel
                      caseId={caseId}
                      criterionId={c.id}
                      criterion={c.criterion}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {latest && latest.conditions.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-300">
                Conditions on the latest decision
              </div>
              <ul className="space-y-1">
                {latest.conditions.map((cond) => (
                  <li
                    key={cond.id}
                    className="rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-slate-300"
                  >
                    <span className="font-medium text-slate-200">
                      {cond.description}
                    </span>{" "}
                    — owner {cond.owner ?? "unknown"}, due {cond.dueDate},
                    evidence: {cond.evidenceRequirement}; if missed:{" "}
                    {cond.consequenceIfMissed} ({cond.status})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canReview && !recording && (
            <button
              onClick={() => setRecording(true)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
            >
              Record gate decision
            </button>
          )}

          {recording && (
            <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.02] p-3">
              {error && (
                <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Outcome…
                  </option>
                  {GATE_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Basis for the decision (20 characters minimum)"
                  className={inputClass}
                />
              </div>

              {outcome === "proceed_with_conditions" && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Conditions — each carries owner, due date, evidence and
                    consequence (spec II.16)
                  </div>
                  {conditions.map((c, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-1 gap-1.5 rounded border border-white/8 p-2 sm:grid-cols-2"
                    >
                      <input
                        value={c.description}
                        onChange={(e) =>
                          setConditions((prev) =>
                            prev.map((p, j) =>
                              j === i
                                ? { ...p, description: e.target.value }
                                : p,
                            ),
                          )
                        }
                        placeholder="What must be done"
                        className={inputClass}
                      />
                      <select
                        value={c.owner_id}
                        onChange={(e) =>
                          setConditions((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, owner_id: e.target.value } : p,
                            ),
                          )
                        }
                        className={inputClass}
                      >
                        <option value="" disabled>
                          Owner…
                        </option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name ?? m.email ?? m.id}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={c.due_date}
                        onChange={(e) =>
                          setConditions((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, due_date: e.target.value } : p,
                            ),
                          )
                        }
                        className={inputClass}
                      />
                      <input
                        value={c.evidence_requirement}
                        onChange={(e) =>
                          setConditions((prev) =>
                            prev.map((p, j) =>
                              j === i
                                ? { ...p, evidence_requirement: e.target.value }
                                : p,
                            ),
                          )
                        }
                        placeholder="Evidence that closes it"
                        className={inputClass}
                      />
                      <input
                        value={c.consequence_if_missed}
                        onChange={(e) =>
                          setConditions((prev) =>
                            prev.map((p, j) =>
                              j === i
                                ? {
                                    ...p,
                                    consequence_if_missed: e.target.value,
                                  }
                                : p,
                            ),
                          )
                        }
                        placeholder="Consequence if missed"
                        className={`${inputClass} sm:col-span-2`}
                      />
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setConditions((prev) => [
                        ...prev,
                        {
                          description: "",
                          owner_id: "",
                          due_date: "",
                          evidence_requirement: "",
                          consequence_if_missed: "",
                        },
                      ])
                    }
                    className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
                  >
                    Add condition
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => void submit()}
                  disabled={busy || outcome === ""}
                  className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-50"
                >
                  {busy ? "Recording…" : "Record decision"}
                </button>
                <button
                  onClick={() => {
                    setRecording(false);
                    setError(null);
                  }}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function statusPill(status: string): string {
  switch (status) {
    case "accepted":
    case "verified":
      return "bg-emerald-400/10 text-emerald-300";
    case "rejected":
      return "bg-red-400/10 text-red-300";
    case "submitted":
      return "bg-signal-cyan/10 text-signal-cyan";
    default:
      return "bg-white/5 text-slate-400";
  }
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

function DeliverablesSection({
  workspace,
  members,
  canPlan,
  canReview,
  onChanged,
}: {
  workspace: CaseWorkspace;
  members: OrgMember[];
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [documents, setDocuments] = useState<IntakeDocumentOption[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [revision, setRevision] = useState("");
  const [reviewNoteFor, setReviewNoteFor] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const criteria = workspace.stages.flatMap((s) =>
    s.gates.flatMap((g) =>
      g.criteria.map((c) => ({
        id: c.id,
        label: `${g.name}: ${c.criterion}`,
      })),
    ),
  );

  const openSubmit = async (deliverableId: string) => {
    setSubmitFor(deliverableId);
    setError(null);
    try {
      setDocuments(await listIntakeDocuments());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to list documents");
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await createCaseDeliverable({
        caseId: workspace.id,
        title,
        type,
        ownerId,
        requirementId: requirementId === "" ? null : Number(requirementId),
        requiredDate: requiredDate === "" ? null : requiredDate,
      });
      setAdding(false);
      setTitle("");
      setType("");
      setOwnerId("");
      setRequirementId("");
      setRequiredDate("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!submitFor) return;
    setBusy(true);
    setError(null);
    try {
      await submitDeliverable({
        deliverableId: submitFor,
        documentId,
        revision: revision === "" ? null : revision,
      });
      setSubmitFor(null);
      setDocumentId("");
      setRevision("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  const review = async (
    deliverableId: string,
    decision: "accepted" | "rejected",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await acceptDeliverable({
        deliverableId,
        decision,
        note: reviewNote === "" ? null : reviewNote,
      });
      setReviewNoteFor(null);
      setReviewNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<FileCheck2 className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Deliverables"
      hint="Gate requirements linked to real documents. Submission attaches a document already ingested through the knowledge-base intake — there is no second upload path. Acceptance is a recorded human determination that feeds gate readiness."
    >
      <div className="space-y-2">
        <ErrorLine error={error} />
        {workspace.deliverables.length === 0 && (
          <p className="text-xs text-slate-500">
            No deliverables registered on this case yet. Register what each
            gate requires, name an owner, and submit the document when it
            exists.
          </p>
        )}
        {workspace.deliverables.map((d) => (
          <div
            key={d.id}
            className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-100">
                {d.title}
              </span>
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {d.type}
              </span>
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                rev {d.revision}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusPill(d.status)}`}
              >
                {d.status}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Owner {d.owner ?? "unknown"}
              {d.requiredDate ? ` · due ${d.requiredDate}` : ""}
              {d.requirement
                ? ` · answers: ${d.requirement.criterion}${d.requirement.isMandatory ? " (mandatory)" : ""}`
                : " · case-level (no gate requirement linked)"}
            </div>
            {d.document && (
              <div className="mt-1 text-[11px] text-slate-400">
                Document: {d.document.title} ({d.document.documentClass},{" "}
                {d.document.chunkCount} chunk(s))
              </div>
            )}
            {d.acceptance && (
              <div className="mt-1 text-[11px] text-emerald-300">
                Accepted{" "}
                {new Date(d.acceptance.acceptedAt).toLocaleDateString()} by{" "}
                {d.acceptance.by ?? "unknown"}
                {d.reviewNote ? ` — ${d.reviewNote}` : ""}
              </div>
            )}
            {d.status === "rejected" && d.reviewNote && (
              <div className="mt-1 text-[11px] text-red-300">
                Rejected — {d.reviewNote}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(canPlan || d.status !== "accepted") &&
                d.status !== "accepted" &&
                submitFor !== d.id && (
                  <button
                    onClick={() => void openSubmit(d.id)}
                    className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
                  >
                    {d.status === "submitted" ? "Resubmit" : "Submit document"}
                  </button>
                )}
              {canReview && d.status === "submitted" && (
                <>
                  {reviewNoteFor !== d.id ? (
                    <button
                      onClick={() => {
                        setReviewNoteFor(d.id);
                        setReviewNote("");
                      }}
                      className="rounded border border-emerald-400/30 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-400/10"
                    >
                      Review…
                    </button>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="Note (required to reject)"
                        className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
                      />
                      <button
                        onClick={() => void review(d.id, "accepted")}
                        disabled={busy}
                        className="rounded border border-emerald-400/30 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => void review(d.id, "rejected")}
                        disabled={busy}
                        className="rounded border border-red-400/30 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
            {submitFor === d.id && (
              <div className="mt-2 space-y-1.5 rounded border border-white/8 p-2">
                <div className="text-[11px] text-slate-400">
                  Attach a document from the knowledge-base intake register.
                  Nothing here yet? Ingest it on the Knowledge Base page first
                  — that rail is the one document door.
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  <select
                    value={documentId}
                    onChange={(e) => setDocumentId(e.target.value)}
                    className={`${inputClass} sm:col-span-2`}
                  >
                    <option value="" disabled>
                      {documents.length === 0
                        ? "No ingested documents in this organization"
                        : "Document…"}
                    </option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title} ({doc.document_class})
                      </option>
                    ))}
                  </select>
                  <input
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                    placeholder={`Revision (now ${d.revision})`}
                    className={inputClass}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void submit()}
                    disabled={busy || documentId === ""}
                    className="rounded border border-signal-cyan/30 bg-signal-cyan/10 px-2 py-1 text-[11px] font-semibold text-signal-cyan disabled:opacity-50"
                  >
                    {busy ? "Submitting…" : "Submit"}
                  </button>
                  <button
                    onClick={() => setSubmitFor(null)}
                    className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {canPlan && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Register deliverable
          </button>
        )}
        {adding && (
          <div className="space-y-2 rounded-lg border border-white/8 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (e.g. Estimate basis memo)"
                className={inputClass}
              />
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="Type (report, drawing, study, plan…)"
                className={inputClass}
              />
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Owner…
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name ?? m.email ?? m.id}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
                className={inputClass}
              />
              <select
                value={requirementId}
                onChange={(e) => setRequirementId(e.target.value)}
                className={`${inputClass} sm:col-span-2`}
              >
                <option value="">
                  No gate requirement (case-level deliverable)
                </option>
                {criteria.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void add()}
                disabled={busy || title === "" || type === "" || ownerId === ""}
                className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
              >
                {busy ? "Registering…" : "Register"}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function EvidenceSection({
  workspace,
  canReview,
  onChanged,
}: {
  workspace: CaseWorkspace;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [evidenceClass, setEvidenceClass] = useState("");
  const [description, setDescription] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [method, setMethod] = useState("");

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordCaseEvidence({
        caseId: workspace.id,
        evidenceClass,
        description,
        sourceSystem,
      });
      setAdding(false);
      setEvidenceClass("");
      setDescription("");
      setSourceSystem("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (
    evidenceId: string,
    outcome: "verified" | "rejected",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await verifyEvidenceItem({ evidenceId, method, outcome });
      setVerifyFor(null);
      setMethod("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<ClipboardList className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Evidence"
      hint="The one evidence model, with §9 provenance classes. Verification is a recorded human determination — who, when, method — and an AI inference can never reach verified status without one."
    >
      <div className="space-y-2">
        <ErrorLine error={error} />
        {workspace.evidence.length === 0 && (
          <p className="text-xs text-slate-500">
            No evidence recorded against this case yet. Record what is known —
            measurements, inspections, calculations, documents — with its
            source; gate findings then have something to stand on.
          </p>
        )}
        {workspace.evidence.map((e) => (
          <div
            key={e.id}
            className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${e.evidenceClass === "AI_INFERENCE" ? "bg-amber-400/10 text-amber-300" : "bg-white/5 text-slate-300"}`}
              >
                {e.evidenceClass ?? "unclassified"}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusPill(e.verificationStatus)}`}
              >
                {e.verificationStatus}
              </span>
              {e.dataQuality && (
                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                  quality: {e.dataQuality}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-200">{e.description}</p>
            <div className="mt-1 text-[11px] text-slate-400">
              {e.sourceSystem ? `Source: ${e.sourceSystem}` : "Source unstated"}
              {e.observedAt
                ? ` · observed ${new Date(e.observedAt).toLocaleDateString()}`
                : ""}
              {e.document ? ` · document: ${e.document.title}` : ""}
            </div>
            {e.verification && (
              <div
                className={`mt-1 text-[11px] ${e.verificationStatus === "verified" ? "text-emerald-300" : "text-red-300"}`}
              >
                {e.verificationStatus === "verified" ? "Verified" : "Rejected"}{" "}
                by {e.verification.by ?? "unknown"} on{" "}
                {new Date(e.verification.verifiedAt).toLocaleDateString()} —
                method: {e.verification.method}
              </div>
            )}
            {canReview && e.verificationStatus === "unverified" && (
              <div className="mt-1.5">
                {verifyFor !== e.id ? (
                  <button
                    onClick={() => {
                      setVerifyFor(e.id);
                      setMethod("");
                    }}
                    className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
                  >
                    Verify…
                  </button>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <input
                      value={method}
                      onChange={(ev) => setMethod(ev.target.value)}
                      placeholder="Method — how was this checked?"
                      className="min-w-56 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
                    />
                    <button
                      onClick={() => void verify(e.id, "verified")}
                      disabled={busy}
                      className="rounded border border-emerald-400/30 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
                    >
                      Verified
                    </button>
                    <button
                      onClick={() => void verify(e.id, "rejected")}
                      disabled={busy}
                      className="rounded border border-red-400/30 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      Rejected
                    </button>
                    <button
                      onClick={() => setVerifyFor(null)}
                      className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300"
                    >
                      Cancel
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Record evidence
          </button>
        )}
        {adding && (
          <div className="space-y-2 rounded-lg border border-white/8 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                value={evidenceClass}
                onChange={(e) => setEvidenceClass(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Provenance class…
                </option>
                {EVIDENCE_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <input
                value={sourceSystem}
                onChange={(e) => setSourceSystem(e.target.value)}
                placeholder="Source system (historian, CMMS, lab, report…)"
                className={inputClass}
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this evidence establish?"
                className={`${inputClass} sm:col-span-2`}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void add()}
                disabled={
                  busy ||
                  evidenceClass === "" ||
                  description === "" ||
                  sourceSystem === ""
                }
                className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
              >
                {busy ? "Recording…" : "Record"}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function RisksSection({
  workspace,
  canPlan,
  onChanged,
}: {
  workspace: CaseWorkspace;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [attaching, setAttaching] = useState(false);
  const [candidates, setCandidates] = useState<BindableRisk[]>([]);
  const [riskId, setRiskId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockers = openRiskBlockers(workspace.risks);

  const openAttach = async () => {
    setAttaching(true);
    setError(null);
    try {
      setCandidates(await listBindableRisks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to list risks");
    }
  };

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      await bindRiskToCase({ riskId, caseId: workspace.id });
      setAttaching(false);
      setRiskId("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Binding failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<ShieldAlert className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Risks"
      hint="The case's rows of the one ISO 31000 risk table — assessed, treated and accepted on the Risk Operating System. Unresolved High/Critical risks appear as named blockers on the current stage's gates."
    >
      <div className="space-y-2">
        <ErrorLine error={error} />
        {blockers.length > 0 && (
          <div className="rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-xs text-red-300">
            {blockers.length} unresolved High/Critical risk(s) count against
            gate readiness.
          </div>
        )}
        {workspace.risks.length === 0 && (
          <p className="text-xs text-slate-500">
            No risks bound to this case yet. Assess them on the{" "}
            <a href="/risk" className="text-signal-cyan hover:underline">
              Risk Operating System
            </a>{" "}
            and attach them here — a case whose risk picture is empty has not
            looked.
          </p>
        )}
        {workspace.risks.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
          >
            <span className="text-sm text-slate-100">{r.title}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                r.currentRiskLevel === "Critical" ||
                r.currentRiskLevel === "High"
                  ? "bg-red-400/10 text-red-300"
                  : "bg-white/5 text-slate-400"
              }`}
            >
              {r.currentRiskLevel ?? "unscored"}
            </span>
            <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
              {r.status.replace(/_/g, " ")}
            </span>
            <span className="text-[11px] text-slate-500">
              {r.owner ? `owner ${r.owner}` : "no owner"}
              {r.reviewDate ? ` · review ${r.reviewDate}` : ""}
            </span>
          </div>
        ))}
        {canPlan && !attaching && (
          <button
            onClick={() => void openAttach()}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Attach risk
          </button>
        )}
        {attaching && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 p-3">
            <select
              value={riskId}
              onChange={(e) => setRiskId(e.target.value)}
              className={`${inputClass} min-w-64 flex-1`}
            >
              <option value="" disabled>
                {candidates.length === 0
                  ? "No unbound risks — create them on /risk first"
                  : "Risk…"}
              </option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.current_risk_level ?? "unscored"})
                </option>
              ))}
            </select>
            <button
              onClick={() => void attach()}
              disabled={busy || riskId === ""}
              className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy ? "Attaching…" : "Attach"}
            </button>
            <button
              onClick={() => setAttaching(false)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

function DecisionCard({
  decision,
  workspace,
  canPlan,
  canReview,
  onChanged,
}: {
  decision: WorkspaceDecision;
  workspace: CaseWorkspace;
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [addingOption, setAddingOption] = useState(false);
  const [label, setLabel] = useState("");
  const [capex, setCapex] = useState("");
  const [opex, setOpex] = useState("");
  const [lifecycleCost, setLifecycleCost] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const [scheduleEffect, setScheduleEffect] = useState("");
  const [riskEffect, setRiskEffect] = useState("");
  const [reliabilityEffect, setReliabilityEffect] = useState("");
  const [environmentalEffect, setEnvironmentalEffect] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [optionId, setOptionId] = useState("");
  const [rationale, setRationale] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string): number | null => (v === "" ? null : Number(v));

  const addOption = async () => {
    setBusy(true);
    setError(null);
    try {
      await addDecisionOption(decision.id, {
        label,
        capex: num(capex),
        opex: num(opex),
        lifecycleCost: num(lifecycleCost),
        expectedValue: num(expectedValue),
        scheduleEffect: scheduleEffect || null,
        riskEffect: riskEffect || null,
        reliabilityEffect: reliabilityEffect || null,
        environmentalEffect: environmentalEffect || null,
      });
      setAddingOption(false);
      setLabel("");
      setCapex("");
      setOpex("");
      setLifecycleCost("");
      setExpectedValue("");
      setScheduleEffect("");
      setRiskEffect("");
      setReliabilityEffect("");
      setEnvironmentalEffect("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adding the option failed");
    } finally {
      setBusy(false);
    }
  };

  const select = async () => {
    setBusy(true);
    setError(null);
    try {
      await selectDecisionOption({
        decisionId: decision.id,
        optionId,
        rationale,
        evidenceItemIds: evidenceIds,
      });
      setSelecting(false);
      setOptionId("");
      setRationale("");
      setEvidenceIds([]);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection failed");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (v: number | null) =>
    v == null ? "not stated" : `$${Number(v).toLocaleString()}`;

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-100">
          {decision.question ?? "(no question recorded)"}
        </span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${decision.selection ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}
        >
          {decision.selection ? "decided" : "open"}
        </span>
        {decision.requiredDate && (
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
            due {decision.requiredDate}
          </span>
        )}
      </div>
      {decision.options.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-slate-500">
          No options on this decision yet — a single option is a decision
          already taken, not a decision being made.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[11px]">
            <thead>
              <tr className="text-slate-500">
                <th className="pb-1 pr-3 font-medium">Option</th>
                <th className="pb-1 pr-3 font-medium">Capex</th>
                <th className="pb-1 pr-3 font-medium">Opex</th>
                <th className="pb-1 pr-3 font-medium">Lifecycle cost</th>
                <th className="pb-1 pr-3 font-medium">Expected value</th>
                <th className="pb-1 pr-3 font-medium">Effects</th>
              </tr>
            </thead>
            <tbody>
              {decision.options.map((o) => (
                <tr
                  key={o.id}
                  className={`border-t border-white/5 ${o.isSelected ? "bg-emerald-400/5" : ""}`}
                >
                  <td className="py-1.5 pr-3 text-slate-200">
                    {o.label}
                    {o.isSelected && (
                      <span className="ml-1.5 rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        selected
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">
                    {fmt(o.capex)}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">{fmt(o.opex)}</td>
                  <td className="py-1.5 pr-3 text-slate-300">
                    {fmt(o.lifecycleCost)}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">
                    {fmt(o.expectedValue)}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-400">
                    {[
                      o.scheduleEffect && `schedule: ${o.scheduleEffect}`,
                      o.riskEffect && `risk: ${o.riskEffect}`,
                      o.reliabilityEffect &&
                        `reliability: ${o.reliabilityEffect}`,
                      o.environmentalEffect &&
                        `environmental: ${o.environmentalEffect}`,
                    ]
                      .filter(Boolean)
                      .join("; ") || "not stated"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {decision.selection && (
        <div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-2 text-[11px] text-emerald-200">
          Selected{" "}
          {new Date(decision.selection.selectedAt).toLocaleDateString()} by{" "}
          {decision.selection.by ?? "unknown"} — {decision.selection.rationale}
          {decision.evidenceItemIds.length > 0 &&
            ` · ${decision.evidenceItemIds.length} evidence link(s)`}
          {decision.assumptions.length > 0 &&
            ` · rests on ${decision.assumptions.length} assumption(s)`}
        </div>
      )}
      {decision.assumptions.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {decision.assumptions.map((a) => (
            <li key={a.id} className="text-[11px] text-slate-400">
              Assumption ({a.status}): {a.statement}
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={error} />
      {!decision.selection && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canPlan && !addingOption && (
            <button
              onClick={() => setAddingOption(true)}
              className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
            >
              Add option
            </button>
          )}
          {canReview && decision.options.length > 0 && !selecting && (
            <button
              onClick={() => setSelecting(true)}
              className="rounded border border-emerald-400/30 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/10"
            >
              Select option…
            </button>
          )}
        </div>
      )}
      {addingOption && (
        <div className="mt-2 space-y-1.5 rounded border border-white/8 p-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Option label (e.g. Replace with model B)"
              className={`${inputClass} sm:col-span-2`}
            />
            <input
              type="number"
              value={capex}
              onChange={(e) => setCapex(e.target.value)}
              placeholder="Capex ($) — blank if not stated"
              className={inputClass}
            />
            <input
              type="number"
              value={opex}
              onChange={(e) => setOpex(e.target.value)}
              placeholder="Opex ($/yr) — blank if not stated"
              className={inputClass}
            />
            <input
              type="number"
              value={lifecycleCost}
              onChange={(e) => setLifecycleCost(e.target.value)}
              placeholder="Lifecycle cost ($)"
              className={inputClass}
            />
            <input
              type="number"
              value={expectedValue}
              onChange={(e) => setExpectedValue(e.target.value)}
              placeholder="Expected value ($)"
              className={inputClass}
            />
            <input
              value={scheduleEffect}
              onChange={(e) => setScheduleEffect(e.target.value)}
              placeholder="Schedule effect"
              className={inputClass}
            />
            <input
              value={riskEffect}
              onChange={(e) => setRiskEffect(e.target.value)}
              placeholder="Risk effect"
              className={inputClass}
            />
            <input
              value={reliabilityEffect}
              onChange={(e) => setReliabilityEffect(e.target.value)}
              placeholder="Reliability effect"
              className={inputClass}
            />
            <input
              value={environmentalEffect}
              onChange={(e) => setEnvironmentalEffect(e.target.value)}
              placeholder="Environmental effect"
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void addOption()}
              disabled={busy || label === ""}
              className="rounded border border-signal-cyan/30 bg-signal-cyan/10 px-2 py-1 text-[11px] font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add option"}
            </button>
            <button
              onClick={() => setAddingOption(false)}
              className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {selecting && (
        <div className="mt-2 space-y-1.5 rounded border border-white/8 p-2">
          <div className="text-[11px] text-slate-400">
            Selection is recorded — who, when and why — and is not
            overwritable. Link the evidence it rests on.
          </div>
          <select
            value={optionId}
            onChange={(e) => setOptionId(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Option…
            </option>
            {decision.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Rationale — the years-later why (20 characters minimum)"
            className={inputClass}
          />
          {workspace.evidence.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded border border-white/5 p-2">
              {workspace.evidence.map((e) => (
                <label
                  key={e.id}
                  className="flex items-start gap-1.5 text-[11px] text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={evidenceIds.includes(e.id)}
                    onChange={(ev) =>
                      setEvidenceIds((prev) =>
                        ev.target.checked
                          ? [...prev, e.id]
                          : prev.filter((id) => id !== e.id),
                      )
                    }
                  />
                  <span>
                    [{e.evidenceClass ?? "unclassified"} ·{" "}
                    {e.verificationStatus}] {e.description}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void select()}
              disabled={busy || optionId === ""}
              className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
            >
              {busy ? "Recording…" : "Record selection"}
            </button>
            <button
              onClick={() => setSelecting(false)}
              className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionsSection({
  workspace,
  canPlan,
  canReview,
  onChanged,
}: {
  workspace: CaseWorkspace;
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await createCaseDecision({
        caseId: workspace.id,
        question,
        requiredDate: requiredDate === "" ? null : requiredDate,
      });
      setAdding(false);
      setQuestion("");
      setRequiredDate("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Framing the decision failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<GitBranch className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Decisions"
      hint="The canonical decision record with its comparable options — the reconstructible “why did we select this” years later. Selecting an option is a recorded human act with evidence links; a made decision is never overwritten."
    >
      <div className="space-y-2">
        <ErrorLine error={error} />
        {workspace.decisions.length === 0 && (
          <p className="text-xs text-slate-500">
            No decisions framed on this case yet. Frame the question first —
            what is being decided, by when — then lay the options against each
            other.
          </p>
        )}
        {workspace.decisions.map((d) => (
          <DecisionCard
            key={d.id}
            decision={d}
            workspace={workspace}
            canPlan={canPlan}
            canReview={canReview}
            onChanged={onChanged}
          />
        ))}
        {canPlan && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Frame decision
          </button>
        )}
        {adding && (
          <div className="space-y-2 rounded-lg border border-white/8 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Decision question — what is being decided?"
                className={`${inputClass} sm:col-span-2`}
              />
              <input
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void add()}
                disabled={busy || question === ""}
                className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
              >
                {busy ? "Framing…" : "Frame decision"}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function ActionsSection({
  workspace,
  canPlan,
  onChanged,
}: {
  workspace: CaseWorkspace;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [attaching, setAttaching] = useState(false);
  const [candidates, setCandidates] = useState<BindableAction[]>([]);
  const [recommendationId, setRecommendationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openAttach = async () => {
    setAttaching(true);
    setError(null);
    try {
      setCandidates(await listBindableActions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to list actions");
    }
  };

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      await bindActionToCase({ recommendationId, caseId: workspace.id });
      setAttaching(false);
      setRecommendationId("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Binding failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<ListChecks className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Actions"
      hint="The canonical recommendation/action store, bound to this case — directly or through its risks. Each carries its verification obligation: the promise of how we will know it worked."
    >
      <div className="space-y-2">
        <ErrorLine error={error} />
        {workspace.actions.length === 0 && (
          <p className="text-xs text-slate-500">
            No actions bound to this case yet. Treatments of the case&apos;s
            risks arrive here automatically; other actions can be attached
            from the canonical action store.
          </p>
        )}
        {workspace.actions.map((a) => (
          <div
            key={a.id}
            className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-100">{a.title}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusPill(a.status)}`}
              >
                {a.status}
              </span>
              {a.urgency && (
                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {a.urgency}
                </span>
              )}
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {a.binding === "direct"
                  ? "bound directly"
                  : `via risk: ${a.riskTitle ?? "unknown"}`}
              </span>
            </div>
            {a.verification ? (
              <div className="mt-1 text-[11px] text-slate-400">
                Verification {a.verification.status}
                {a.verification.result ? ` (${a.verification.result})` : ""} ·
                due {a.verification.dueDate}
                {a.verification.dueDateAssumed ? " (assumed)" : ""}
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-slate-500">
                No verification obligation yet — it is created when the action
                is approved with a stated verification method.
              </div>
            )}
          </div>
        ))}
        {canPlan && !attaching && (
          <button
            onClick={() => void openAttach()}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Attach action
          </button>
        )}
        {attaching && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 p-3">
            <select
              value={recommendationId}
              onChange={(e) => setRecommendationId(e.target.value)}
              className={`${inputClass} min-w-64 flex-1`}
            >
              <option value="" disabled>
                {candidates.length === 0
                  ? "No unbound actions in the canonical store"
                  : "Action…"}
              </option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} ({a.status})
                </option>
              ))}
            </select>
            <button
              onClick={() => void attach()}
              disabled={busy || recommendationId === ""}
              className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy ? "Attaching…" : "Attach"}
            </button>
            <button
              onClick={() => setAttaching(false)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

export function DevelopmentCaseWorkspacePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canReview =
    profile?.role != null && REVIEW_ROLES.includes(profile.role);
  const canPlan = profile?.role != null && PLAN_ROLES.includes(profile.role);

  const [workspace, setWorkspace] = useState<CaseWorkspace | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [sanctionNote, setSanctionNote] = useState("");
  const [sanctionValue, setSanctionValue] = useState("");
  const [sanctionBusy, setSanctionBusy] = useState(false);
  const [advanceBusy, setAdvanceBusy] = useState(false);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const [ws, mem] = await Promise.all([
        getDevelopmentCase(caseId),
        listOrgMembers().catch(() => [] as OrgMember[]),
      ]);
      setWorkspace(ws);
      setMembers(mem);
      if (ws == null) setError("Case not found in this organization.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the case");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentStage: WorkspaceStage | undefined = workspace?.stages.find(
    (s) => s.isCurrent,
  );
  const nextStage: WorkspaceStage | undefined =
    currentStage == null
      ? undefined
      : workspace?.stages.find(
          (s) => s.sequence === currentStage.sequence + 1,
        );

  const sanction = async () => {
    if (!caseId) return;
    setSanctionBusy(true);
    setFlash(null);
    try {
      const result = await sanctionDevelopmentCase({
        caseId,
        note: sanctionNote,
        sanctionedValue:
          sanctionValue === "" ? null : Number(sanctionValue),
      });
      setFlash(
        `Sanctioned at $${Number(result.sanctioned_value).toLocaleString()}.`,
      );
      setSanctionNote("");
      setSanctionValue("");
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Sanction failed");
    } finally {
      setSanctionBusy(false);
    }
  };

  const advance = async () => {
    if (!caseId || !nextStage) return;
    setAdvanceBusy(true);
    setFlash(null);
    try {
      await advanceCaseStage({ caseId, toStageKey: nextStage.stageKey });
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Stage move refused");
    } finally {
      setAdvanceBusy(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-slate-400">Loading case…</div>;
  }
  if (error || workspace == null) {
    return (
      <div className="p-6 space-y-4">
        <button
          onClick={() => navigate("/develop")}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All cases
        </button>
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error ?? "Case not found."}
        </div>
      </div>
    );
  }

  const lifecycleLabel =
    LIFECYCLE_TYPES.find((t) => t.value === workspace.lifecycleType)?.label ??
    workspace.lifecycleType;

  return (
    <div className="p-6 space-y-6">
      <button
        onClick={() => navigate("/develop")}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All cases
      </button>

      {/* Case header */}
      <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              {workspace.title}
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              {lifecycleLabel}
              {workspace.businessUnit ? ` · ${workspace.businessUnit}` : ""}
              {workspace.sponsor ? ` · Sponsor: ${workspace.sponsor}` : ""}
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${workspace.status === "sanctioned" ? "bg-emerald-400/10 text-emerald-300" : "bg-signal-cyan/10 text-signal-cyan"}`}
          >
            {workspace.status.replace(/_/g, " ")}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Problem / opportunity
            </div>
            <p className="mt-1 text-sm text-slate-300">
              {workspace.problemStatement}
            </p>
            {workspace.opportunityStatement && (
              <p className="mt-2 text-xs text-slate-400">
                {workspace.opportunityStatement}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Estimated capex
              </div>
              <div className="mt-1 text-slate-200">
                {money(workspace.estimatedCapex)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Expected value
              </div>
              <div className="mt-1 text-slate-200">
                {money(workspace.expectedValue)}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Framework
              </div>
              <div className="mt-1 text-slate-200">
                {workspace.framework
                  ? `${workspace.framework.name} v${workspace.framework.version} (${workspace.framework.sourceAuthority})`
                  : "None assigned — gates attach when a framework governs this case"}
              </div>
            </div>
          </div>
        </div>

        {workspace.sanction && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2.5 text-xs text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Sanctioned {money(workspace.sanction.sanctionedValue)} on{" "}
              {new Date(workspace.sanction.sanctionedAt).toLocaleDateString()}
              {workspace.sanction.by ? ` by ${workspace.sanction.by}` : ""}.{" "}
              {workspace.sanction.note}
            </span>
          </div>
        )}
      </div>

      {flash && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
          {flash}
        </div>
      )}

      {/* Stage position + gates */}
      {workspace.framework == null ? (
        <div className="rounded-xl border border-white/6 bg-[#0D1520] p-6 text-sm text-slate-400">
          No framework governs this case yet, so there is no stage position
          and no gates to show. Assign an adopted framework at creation, or
          author one (RPC-first this slice) and create the next case under
          it.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {workspace.stages.map((s, i) => (
              <div key={s.stageKey} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-600">→</span>}
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${s.isCurrent ? "border-signal-cyan/40 bg-signal-cyan/10 text-signal-cyan" : "border-white/8 text-slate-400"}`}
                >
                  {s.sequence}. {s.displayName}
                </span>
              </div>
            ))}
          </div>

          {canReview && nextStage && (
            <button
              onClick={() => void advance()}
              disabled={advanceBusy}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              {advanceBusy
                ? "Moving…"
                : `Advance to ${nextStage.displayName} (gates permitting)`}
            </button>
          )}

          {workspace.stages.map((stage) => (
            <div
              key={stage.stageKey}
              className={`rounded-xl border p-4 ${stage.isCurrent ? "border-signal-cyan/25 bg-[#0D1520]" : "border-white/6 bg-[#0D1520]/60"}`}
            >
              <div className="mb-2 flex items-center gap-2">
                <Landmark className="h-4 w-4 text-slate-500" aria-hidden />
                <span className="text-sm font-semibold text-slate-100">
                  {stage.displayName}
                </span>
                <span className="text-[11px] text-slate-500">
                  {stage.stageKey}
                </span>
                {stage.isCurrent && (
                  <span className="rounded-full bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan">
                    current
                  </span>
                )}
              </div>
              {stage.purpose && (
                <p className="mb-2 text-xs text-slate-400">{stage.purpose}</p>
              )}
              {stage.gates.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No gates defined on this stage.
                </p>
              ) : (
                <div className="space-y-2">
                  {stage.gates.map((g: WorkspaceGate) => (
                    <GateCard
                      key={g.id}
                      gate={g}
                      caseId={workspace.id}
                      canReview={canReview}
                      members={members}
                      riskBlockers={
                        stage.isCurrent
                          ? openRiskBlockers(workspace.risks)
                          : []
                      }
                      onRecorded={() => void load()}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* §44 sections, in the spec's own order — objective, business case,
          options (inside decisions), risks, requirements (gates above),
          decisions, deliverables, schedule, cost, actions. Each renders
          exactly what is persisted, with an honest empty state that says
          what to do; no placeholder numbers anywhere. */}
      <ObjectiveSection workspace={workspace} />
      <SuccessContractSection
        workspace={workspace}
        members={members}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <BusinessCaseSection
        workspace={workspace}
        members={members}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <BenefitsSection
        workspace={workspace}
        members={members}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <DeliverablesSection
        workspace={workspace}
        members={members}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <EvidenceSection
        workspace={workspace}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <RisksSection
        workspace={workspace}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <DecisionsSection
        workspace={workspace}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <ActionsSection
        workspace={workspace}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <BaselinesSection
        workspace={workspace}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <ScheduleSection workspace={workspace} />
      <CostSection workspace={workspace} />
      <OperationalReadinessSection caseId={workspace.id} canPlan={canPlan} />

      {/* Sanction */}
      {workspace.status !== "sanctioned" &&
        workspace.status !== "cancelled" &&
        workspace.status !== "completed" && (
          <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-slate-100">Sanction</h2>
            <p className="mt-1 text-xs text-slate-400">
              A §70 determination: recorded only through the authority-checked
              path. It requires an ADOPTED sanction delegation for your role
              and passing reviews on the current stage&apos;s blocking gates —
              the server states exactly what is missing.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                type="number"
                min="0"
                step="any"
                value={sanctionValue}
                onChange={(e) => setSanctionValue(e.target.value)}
                placeholder={`Value ($) — defaults to estimated capex (${money(workspace.estimatedCapex)})`}
                className={`${inputClass} sm:col-span-1`}
              />
              <input
                value={sanctionNote}
                onChange={(e) => setSanctionNote(e.target.value)}
                placeholder="Basis for the sanction decision (20 characters minimum)"
                className={`${inputClass} sm:col-span-2`}
              />
            </div>
            <button
              onClick={() => void sanction()}
              disabled={sanctionBusy}
              className="mt-3 rounded-lg bg-emerald-400/10 border border-emerald-400/30 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
            >
              {sanctionBusy ? "Checking authority…" : "Sanction this case"}
            </button>
          </div>
        )}
    </div>
  );
}
