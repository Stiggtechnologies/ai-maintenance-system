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
import { Link, useNavigate, useParams } from "react-router-dom";
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
  closeGateCondition,
  decideGateRequirementWaiver,
  recordCaseEvidence,
  recordCaseGateReview,
  requestGateRequirementWaiver,
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
  type WorkspaceCondition,
  type WorkspaceDecision,
  type WorkspaceEvidence,
  type WorkspaceGate,
  type WorkspaceRisk,
  type WorkspaceStage,
  type WorkspaceWaiver,
} from "../lib/develop";
import {
  BaselinesSection,
  EvidenceAgentPanel,
  GateReadinessPanel,
  OperationalReadinessSection,
  ScheduleSection,
} from "../components/develop/ReadinessPanels";
import { GovernancePanel } from "../components/develop/GovernancePanel";
import {
  BenefitsSection,
  BusinessCaseSection,
  CostSection,
  ObjectiveSection,
  SuccessContractSection,
} from "../components/develop/ValueSpinePanels";
import { CaseChainsPanel } from "../components/develop/CaseChainsPanels";
import { IntegratedControlsPanel } from "../components/develop/ControlsPanels";
import { PerformancePanel } from "../components/develop/PerformancePanels";
import { ScheduleAssurancePanel } from "../components/develop/SchedulePanels";
import { ChangeAndControlsPanel } from "../components/develop/ChangeControlPanels";
import { RequirementsThreadPanel } from "../components/develop/RequirementsThreadPanels";
import { FrontlineDesignPanel } from "../components/develop/FrontlineDesignPanels";
import { ProcurementPanel } from "../components/develop/ProcurementPanels";
import { WorkPackagingPanel } from "../components/develop/WorkPackagingPanels";
import { DigitalThreadPanel } from "../components/develop/DigitalThreadPanels";
import {
  CaseRamPanel,
  ChangeImpactAgentPanel,
  DevelopEventBusPanel,
  InformationEnginePanel,
} from "../components/develop/EventBusPanels";

const REVIEW_ROLES = [
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
];

/** Roles that may register/frame (creation is preparation, not determination). */
const PLAN_ROLES = [...REVIEW_ROLES, "ai_admin", "planner"];

/**
 * Slice 5B (D4.10/D4.11), spec I.25. The FRONTLINE acts — attending a design
 * review, raising a recommendation, dispositioning one — are the only acts in
 * this workspace whose RPCs admit `supervisor` and `technician` BY NAME, and
 * they do so deliberately: "a design review whose findings only a manager may
 * type is not a frontline design review" (20261205090000). `PLAN_ROLES` fits
 * every other panel and mis-fits this one in both directions, so these two
 * sets are stated separately rather than reused.
 *
 * `ai_admin` is excluded from BOTH: §70 refuses it by name at every one of
 * these doors, so rendering it the forms only offers an act the server will
 * reject.
 */
const FRONTLINE_ROLES = [
  ...REVIEW_ROLES,
  "planner",
  "supervisor",
  "technician",
];
const DESIGN_PLAN_ROLES = [...REVIEW_ROLES, "planner"];

/**
 * Slice 6A (D6.03/D6.04/D6.05), spec I.16 + §24 + §70.
 *
 * PROCUREMENT_PLAN_ROLES: recording a package, moving a §25 dimension,
 * inviting a bidder, issuing the tender, lodging a bid, opening the envelopes
 * and evaluating. `ai_admin` is excluded — §70 refuses it BY NAME at the open
 * and the evaluation doors, so rendering it those forms only offers acts the
 * server will reject.
 *
 * PROCUREMENT_AWARD_ROLES: the two acts that commit the owner's capital —
 * awarding the contract and approving its commitments. Narrower on purpose,
 * and matching `award_contract` / `approve_contract_commitments` exactly: a
 * planner or an engineer holds no contract-award delegation, and offering them
 * the button would put the refusal after the intent instead of before it.
 */
const PROCUREMENT_PLAN_ROLES = [...REVIEW_ROLES, "planner"];
const PROCUREMENT_AWARD_ROLES = ["admin", "executive", "maintenance_manager"];

/**
 * Slice 7A (D7.17/D7.10/D7.18/D7.07), spec II.4 + §27 + §28 + §70.
 *
 * AWP_PLAN_ROLES: recording a package, packaging work, recording a §28
 * constraint, forecasting one and verifying one satisfied. `supervisor` is IN
 * — an installation package's constraints are cleared by the person standing
 * where the work is — and `ai_admin` is OUT, because §70 refuses it by name at
 * the constraint-verification wall and offering the form only puts the refusal
 * after the intent.
 *
 * AWP_RELEASE_ROLES: the one act §70 reserves here — saying this work is safe
 * to start. Matching `release_work_package` exactly: a planner packages the
 * work and a supervisor or a manager releases it.
 */
const AWP_PLAN_ROLES = [...REVIEW_ROLES, "planner", "supervisor"];
const AWP_RELEASE_ROLES = [
  "admin",
  "executive",
  "maintenance_manager",
  "supervisor",
];

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
  risks,
  evidence,
  waivers,
  onRecorded,
}: {
  gate: WorkspaceGate;
  caseId: string;
  canReview: boolean;
  members: OrgMember[];
  riskBlockers: string[];
  risks: WorkspaceRisk[];
  evidence: WorkspaceEvidence[];
  waivers: WorkspaceWaiver[];
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
  const [fundingAnswer, setFundingAnswer] = useState("");
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
        fundingAnswer: fundingAnswer.trim() || null,
      });
      setRecording(false);
      setOutcome("");
      setNote("");
      setFindings({});
      setConditions([]);
      setFundingAnswer("");
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
          <ChevronDown
            className="h-4 w-4 shrink-0 text-slate-500"
            aria-hidden
          />
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
            {rollup.fundingUnanswered && (
              <span className="rounded-full bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                funding question unanswered
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
          <div className="text-xs text-slate-400">
            {rollup.assessment.reason}
          </div>

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
                      {c.activeWaiver && (
                        <span
                          className="rounded-full bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300"
                          title={c.activeWaiver.justification}
                        >
                          waived until{" "}
                          {new Date(
                            c.activeWaiver.expiresAt,
                          ).toLocaleDateString()}
                        </span>
                      )}
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

          {latest?.fundingContinuationAnswer && (
            <div className="rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300">
              <span className="font-semibold text-slate-200">
                Zero-based funding answer:
              </span>{" "}
              {latest.fundingContinuationAnswer}
            </div>
          )}

          {latest && latest.conditions.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-300">
                Conditions on the latest decision
              </div>
              <ul className="space-y-1">
                {latest.conditions.map((cond) => (
                  <ConditionRow
                    key={cond.id}
                    condition={cond}
                    canReview={canReview}
                    evidence={evidence}
                    onClosed={onRecorded}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* D3.19: waivers against this gate's requirements — request,
              decide (authority-routed at the DB), and the standing record.
              An expired waiver stays listed: enforcement reverted, and the
              record of the exception survives it. */}
          <GateWaiverBlock
            gate={gate}
            caseId={caseId}
            canReview={canReview}
            risks={risks}
            waivers={waivers}
            onChanged={onRecorded}
          />

          {/* D3.31 (spec III.§36): the prepared review — evidence assembled
              per requirement, the blocker list, the SoD position stated
              before the form, and the recorder that delegates to the ONE act
              site. The inline quick-record below is unchanged. */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/develop/cases/${caseId}/gates/${gate.id}/review`}
              className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/15"
            >
              Open the gate review
            </Link>
            {canReview && !recording && (
              <button
                onClick={() => setRecording(true)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
              >
                Record gate decision
              </button>
            )}
          </div>

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

              {gate.decisionType === "gate" && (
                <div>
                  <div className="mb-1 text-[11px] text-slate-400">
                    Zero-based funding question (spec I.5)
                    {gate.fundingQuestionRequired
                      ? " — required at this sanction-type gate for a passing outcome"
                      : " — asked at every gate; recorded when answered"}
                  </div>
                  <textarea
                    value={fundingAnswer}
                    onChange={(e) => setFundingAnswer(e.target.value)}
                    placeholder="If this project were proposed today using what we now know, would we still fund it? (20 characters minimum when required)"
                    rows={2}
                    className={inputClass}
                  />
                </div>
              )}

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

/**
 * D3.18: one condition with its lifecycle. Overdue conditions arrive here
 * already escalated by the hourly sweep (status 'missed', breach stamped,
 * security event raised); closing any open or missed condition REQUIRES a
 * linked evidence item of this case — the DB refuses an evidence-free
 * closure, this form just says so earlier.
 */
function ConditionRow({
  condition,
  canReview,
  evidence,
  onClosed,
}: {
  condition: WorkspaceCondition;
  canReview: boolean;
  evidence: WorkspaceEvidence[];
  onClosed: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [evidenceId, setEvidenceId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closable = condition.status === "open" || condition.status === "missed";

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      await closeGateCondition({
        conditionId: condition.id,
        evidenceId,
        note: note.trim() || null,
      });
      setClosing(false);
      onClosed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Closing failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-md border px-2.5 py-1.5 text-[11px] text-slate-300 ${
        condition.status === "missed"
          ? "border-red-400/30 bg-red-400/5"
          : condition.status === "satisfied"
            ? "border-emerald-400/20 bg-emerald-400/5"
            : "border-amber-400/20 bg-amber-400/5"
      }`}
    >
      <span className="font-medium text-slate-200">
        {condition.description}
      </span>{" "}
      — owner {condition.owner ?? "unknown"}, due {condition.dueDate}, evidence:{" "}
      {condition.evidenceRequirement}; if missed:{" "}
      {condition.consequenceIfMissed}
      <span
        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
          condition.status === "missed"
            ? "bg-red-400/10 text-red-300"
            : condition.status === "satisfied"
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-amber-400/10 text-amber-300"
        }`}
      >
        {condition.status === "missed"
          ? "OVERDUE — escalated"
          : condition.status}
      </span>
      {condition.status === "satisfied" && (
        <span className="ml-1 text-slate-400">
          closed by {condition.closedBy ?? "unknown"}
          {condition.breachedAt ? " (late — breach on record)" : ""}
          {condition.closureNote ? `: ${condition.closureNote}` : ""}
        </span>
      )}
      {canReview && closable && !closing && (
        <button
          onClick={() => setClosing(true)}
          className="ml-2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200 hover:bg-white/5"
        >
          Close with evidence
        </button>
      )}
      {closing && (
        <div className="mt-1.5 space-y-1.5">
          <ErrorLine error={error} />
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={evidenceId}
              onChange={(e) => setEvidenceId(e.target.value)}
              className="min-w-52 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
            >
              <option value="" disabled>
                Evidence item that closes it…
              </option>
              {evidence.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {(ev.description ?? ev.id).slice(0, 80)} ({ev.evidenceClass})
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Closure note (optional)"
              className="min-w-40 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
            />
            <button
              onClick={() => void close()}
              disabled={busy || evidenceId === ""}
              className="rounded border border-signal-cyan/30 bg-signal-cyan/15 px-2 py-1 text-[10px] font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy ? "Closing…" : "Close"}
            </button>
            <button
              onClick={() => setClosing(false)}
              className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-300"
            >
              Cancel
            </button>
          </div>
          {evidence.length === 0 && (
            <div className="text-[10px] text-slate-500">
              No evidence is recorded on this case yet — record it in the
              Evidence section first; a condition does not close on assertion.
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * D3.19: waivers against this gate's requirements. Requests bind a
 * mandatory-or-advisory requirement of THIS gate to a case risk and an
 * expiry; decisions route through the adopted gate_requirement_waiver
 * authority at the DB (fail-closed). The record survives expiry — an
 * expired waiver is listed as expired, never removed.
 */
function GateWaiverBlock({
  gate,
  caseId,
  canReview,
  risks,
  waivers,
  onChanged,
}: {
  gate: WorkspaceGate;
  caseId: string;
  canReview: boolean;
  risks: WorkspaceRisk[];
  waivers: WorkspaceWaiver[];
  onChanged: () => void;
}) {
  const criterionIds = useMemo(
    () => new Set(gate.criteria.map((c) => c.id)),
    [gate.criteria],
  );
  const gateWaivers = waivers.filter((w) => criterionIds.has(w.requirementId));
  const [requesting, setRequesting] = useState(false);
  const [requirementId, setRequirementId] = useState("");
  const [justification, setJustification] = useState("");
  const [controls, setControls] = useState("");
  const [riskId, setRiskId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [decideNote, setDecideNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestGateRequirementWaiver({
        caseId,
        requirementId: Number(requirementId),
        justification,
        compensatingControls: controls,
        riskId,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
      });
      setRequesting(false);
      setRequirementId("");
      setJustification("");
      setControls("");
      setRiskId("");
      setExpiresAt("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (waiverId: string, approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await decideGateRequirementWaiver({
        waiverId,
        approve,
        note: decideNote[waiverId] ?? "",
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  if (gateWaivers.length === 0 && !canReview) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-slate-300">
          Requirement waivers (spec II.16)
        </div>
        {canReview && !requesting && (
          <button
            onClick={() => setRequesting(true)}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200 hover:bg-white/5"
          >
            Request waiver
          </button>
        )}
      </div>
      <ErrorLine error={error} />
      {gateWaivers.length === 0 && !requesting && (
        <div className="text-[11px] text-slate-500">
          None. Every requirement of this gate binds in full.
        </div>
      )}
      {gateWaivers.map((w) => (
        <div
          key={w.id}
          className="rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
        >
          <span className="font-medium text-slate-200">{w.criterion}</span>
          <span
            className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              w.status === "approved"
                ? "bg-violet-400/10 text-violet-300"
                : w.status === "pending"
                  ? "bg-amber-400/10 text-amber-300"
                  : w.status === "expired"
                    ? "bg-red-400/10 text-red-300"
                    : "bg-white/5 text-slate-400"
            }`}
          >
            {w.status === "expired"
              ? "expired — enforcement reverted"
              : w.status}
          </span>{" "}
          — {w.justification}; controls: {w.compensatingControls}; risk:{" "}
          {w.riskTitle ?? w.riskId ?? "unlinked"}; expires{" "}
          {new Date(w.expiresAt).toLocaleDateString()}
          {w.decidedBy ? `; decided by ${w.decidedBy}` : ""}
          {canReview && w.status === "pending" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <input
                value={decideNote[w.id] ?? ""}
                onChange={(e) =>
                  setDecideNote((prev) => ({ ...prev, [w.id]: e.target.value }))
                }
                placeholder="Decision reasoning (10 characters minimum)"
                className="min-w-52 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
              />
              <button
                onClick={() => void decide(w.id, true)}
                disabled={busy}
                className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-300 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => void decide(w.id, false)}
                disabled={busy}
                className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-semibold text-red-300 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
      {requesting && (
        <div className="space-y-1.5 rounded-md border border-white/8 bg-white/[0.02] p-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <select
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Requirement to waive…
              </option>
              {gate.criteria.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.criterion.slice(0, 90)}
                </option>
              ))}
            </select>
            <select
              value={riskId}
              onChange={(e) => setRiskId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Risk assessment covering the waiver…
              </option>
              {risks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.currentRiskLevel ?? "unrated"})
                </option>
              ))}
            </select>
            <input
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why the requirement cannot be met (20 characters minimum)"
              className={inputClass}
            />
            <input
              value={controls}
              onChange={(e) => setControls(e.target.value)}
              placeholder="Compensating controls (20 characters minimum)"
              className={inputClass}
            />
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={inputClass}
            />
          </div>
          {risks.length === 0 && (
            <div className="text-[10px] text-slate-500">
              No risks are bound to this case — bind or record the risk first
              (spec II.16: a waiver names its risk assessment).
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void request()}
              disabled={busy || !requirementId || !riskId}
              className="rounded border border-signal-cyan/30 bg-signal-cyan/15 px-2 py-1 text-[10px] font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy ? "Requesting…" : "Request"}
            </button>
            <button
              onClick={() => setRequesting(false)}
              className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-300"
            >
              Cancel
            </button>
          </div>
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
            No deliverables registered on this case yet. Register what each gate
            requires, name an owner, and submit the document when it exists.
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
                  Nothing here yet? Ingest it on the Knowledge Base page first —
                  that rail is the one document door.
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
                  <td className="py-1.5 pr-3 text-slate-300">{fmt(o.capex)}</td>
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
            Selection is recorded — who, when and why — and is not overwritable.
            Link the evidence it rests on.
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
            risks arrive here automatically; other actions can be attached from
            the canonical action store.
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
  const canFrontline =
    profile?.role != null && FRONTLINE_ROLES.includes(profile.role);
  const canDesignPlan =
    profile?.role != null && DESIGN_PLAN_ROLES.includes(profile.role);
  const canAdmin =
    profile?.role != null && ["admin", "executive"].includes(profile.role);
  const canProcure =
    profile?.role != null && PROCUREMENT_PLAN_ROLES.includes(profile.role);
  const canAwardContract =
    profile?.role != null && PROCUREMENT_AWARD_ROLES.includes(profile.role);
  const canPackageWork =
    profile?.role != null && AWP_PLAN_ROLES.includes(profile.role);
  const canReleasePackage =
    profile?.role != null && AWP_RELEASE_ROLES.includes(profile.role);

  const [workspace, setWorkspace] = useState<CaseWorkspace | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  /**
   * Slice 3C: the chains panel owns its own read (get_case_chains), the same
   * shape GovernancePanel and OperationalReadinessSection already use. This
   * counter re-runs it whenever the page reloads — recording evidence here
   * changes what a commitment can be discharged against there.
   */
  const [chainsKey, setChainsKey] = useState(0);
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
      setChainsKey((k) => k + 1);
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
      : workspace?.stages.find((s) => s.sequence === currentStage.sequence + 1);

  const sanction = async () => {
    if (!caseId) return;
    setSanctionBusy(true);
    setFlash(null);
    try {
      const result = await sanctionDevelopmentCase({
        caseId,
        note: sanctionNote,
        sanctionedValue: sanctionValue === "" ? null : Number(sanctionValue),
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
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate("/develop")}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All cases
        </button>
        {/* D13.06 (spec §44): claim → evidence → confidence for this case. */}
        <Link
          to={`/develop/cases/${caseId}/assurance`}
          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/5"
        >
          Assurance case
        </Link>
        {/* D13.09 / D7.19 (Slice 7B): the packages awaiting a release
            decision, across cases — the surface Workflow 4 names. */}
        <Link
          to="/execution-readiness"
          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/5"
        >
          Execution readiness
        </Link>
      </div>

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
              {workspace.sanction.by
                ? ` by ${workspace.sanction.by}`
                : ""}. {workspace.sanction.note}
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
          No framework governs this case yet, so there is no stage position and
          no gates to show. Assign an adopted framework at creation, or author
          one (RPC-first this slice) and create the next case under it.
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
                        stage.isCurrent ? openRiskBlockers(workspace.risks) : []
                      }
                      risks={workspace.risks}
                      evidence={workspace.evidence}
                      waivers={workspace.waivers}
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
      <GovernancePanel
        caseId={workspace.id}
        canReview={canReview}
        canAdmin={canAdmin}
        stageKeys={workspace.stages.map((s) => s.stageKey)}
        evidence={workspace.evidence}
        onChanged={() => void load()}
      />
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
      <CaseChainsPanel
        caseId={workspace.id}
        members={members}
        gates={workspace.stages.flatMap((s) =>
          s.gates.map((g) => ({ id: g.id, name: g.name })),
        )}
        canPlan={canPlan}
        canReview={canReview}
        reloadKey={chainsKey}
      />
      <ScheduleSection workspace={workspace} />
      <CostSection workspace={workspace} />
      {/* §44 Integrated Controls (Slice 4A): the scope chain and its gaps,
          schedule activities with P6 as system of record, CBS/WBS-coded cost
          lines, post-baseline scope growth, the eleven controls structures,
          and the lineage behind every number above. */}
      <IntegratedControlsPanel
        caseId={workspace.id}
        members={members}
        canPlan={canPlan}
        canReview={canReview}
        reloadKey={chainsKey}
      />
      {/* §44 Performance (Slice 4B): rules of credit and claimed progress,
          the earned value metric suite, the eight-dimension estimate basis
          and the confidence that travels with every forecast, the progress
          integrity cross-check, and the §51 forecast presentation whose
          P50/P80 columns say they are absent rather than manufacturing a
          spread. */}
      <PerformancePanel
        caseId={workspace.id}
        canPlan={canPlan}
        canReview={canReview}
        reloadKey={chainsKey}
        renderScheduleAssurance={(performance, onChanged) => (
          /* §44 Schedule assurance (Slice 4C): the nine II.6 defect classes,
             the §50 quality score and the distinct schedule confidence, the
             risk→activity→money chain, and the seeded Monte Carlo that
             REFUSES to run on a schedule failing its diagnostics. It renders
             inside the Performance panel because it consumes the same one
             read — a second fetch would let the gate on screen disagree with
             the gate the percentiles were computed under. */
          <ScheduleAssurancePanel
            caseId={workspace.id}
            performance={performance}
            canPlan={canPlan}
            onChanged={onChanged}
          />
        )}
      />
      {/* §44 Integrated Controls + change control (Slice 4D): the six control
          dimensions composed from RECORDED RUNS (nothing recomputed here), the
          contingency ledger whose drawdowns are authority-gated and attributed
          to a cause, Workflow 3 riding the existing MOC engine, and §54
          decision latency with its critical-path exposure — each refusing by
          name rather than reporting a comfortable zero. */}
      <ChangeAndControlsPanel
        caseId={workspace.id}
        canPlan={canPlan}
        canReview={canReview}
        reloadKey={chainsKey}
        baselines={workspace.baselines
          .filter((b) => b.status !== "draft")
          .map((b) => ({
            id: b.id,
            label: `${b.baselineType} v${b.version} (${b.status})`,
          }))}
      />
      {/* Design integrity and the digital thread (Slice 5A): the §10
          Requirement object with its hierarchy and its objective→…→operating
          KPI thread (the two unbuilt links shown as deferred, not omitted),
          the §11 Verification object with its five methods and a result only
          a named human can record, and the §59 Requirements Agent — whose
          findings are SQL and whose one model-sourced family is labelled
          AI-generated. Every coverage figure here REFUSES over an empty
          requirement set rather than reading as a clean bill. */}
      <RequirementsThreadPanel
        caseId={workspace.id}
        members={members.map((m) => ({
          id: m.id,
          name: m.full_name ?? m.email ?? m.id,
        }))}
        canPlan={canPlan}
        reloadKey={chainsKey}
      />
      {/* Frontline design review, six-axis scoring and the §19 interfaces
          (Slice 5B): the people who will maintain, operate and build this
          disposition its design BEFORE it is built, and an un-dispositioned
          recommendation is a gate blocker on the SAME machinery a breached
          permit condition rides. The composite score refuses while any axis is
          unscored, and the interfaces traverse the shared dependency graph
          rather than a second one. */}
      <FrontlineDesignPanel
        caseId={workspace.id}
        members={members.map((m) => ({
          id: m.id,
          name: m.full_name ?? m.email ?? m.id,
        }))}
        canPlan={canDesignPlan}
        canFrontline={canFrontline}
        reloadKey={chainsKey}
      />
      {/* The digital thread (Slice 5C): spec II.2's Common Data Environment as
          a real link model rather than partial hops — every object anchored to
          ONE asset in the canonical hierarchy (§26), exactly one authoritative
          revision per object held by a database index rather than a report, a
          continuity invariant whose severances are refused or recorded and
          never quiet, and change receipts a person has to answer. The impact
          traversal REFUSES over a gap rather than reporting the subgraph it
          could reach as if it were the affected set. */}
      <DigitalThreadPanel
        caseId={workspace.id}
        canPlan={canPlan}
        reloadKey={chainsKey}
      />
      {/* The event bus and the two agents (Slice 5D): spec §71-78's five named
          events, emitted by the acts that cause them and CONSUMED — an
          unanswered blocking consequence stops a gate review at the database,
          not on a screen. The §60 Change Impact Agent runs the digital
          thread's ONE traversal and refuses where it is gapped; the §63 RAM
          kernel is scoped to this case's asset set and names every leg it
          cannot compute. Both agents propose and neither can change anything.
          Sync Information is composed last, with the leg it does not have
          named and no composite score over the ones it does. */}
      <DevelopEventBusPanel
        caseId={workspace.id}
        viewer={{ id: profile?.id ?? null, role: profile?.role ?? null }}
        reloadKey={chainsKey}
      />
      <ChangeImpactAgentPanel
        caseId={workspace.id}
        canPlan={canPlan}
        reloadKey={chainsKey}
      />
      <CaseRamPanel
        caseId={workspace.id}
        canPlan={canPlan}
        reloadKey={chainsKey}
      />
      {/* Procurement, the sealed-bid tender and the §24 contract (Slice 6A):
          the ProcurementPackage with all four §25 status dimensions, a
          mandatory long-lead package that cannot arrive when the project needs
          it blocking the gate through the SAME predicate a breached permit
          condition rides, bids sealed until one recorded open act, evaluations
          frozen once written, an award routed through an adopted
          contract-award delegation by somebody who did not evaluate, and its
          commitments posted into Slice 4's ONE cost model. */}
      <ProcurementPanel
        caseId={workspace.id}
        canPlan={canProcure}
        canAward={canAwardContract}
        currentUserEmail={profile?.email ?? null}
        reloadKey={chainsKey}
      />
      {/* Advanced Work Packaging (Slice 7A): spec II.4's typed EWP → PWP →
          CWP → IWP chain, enforced at the database so a package cannot skip a
          level or point at the wrong parent; §27's five package types on the
          canonical work identity (work_orders stays the work — this packages
          it); §28's ten constraint types on the ONE constraint store, keeping
          its satisfied-requires-verifier rule and adding a §70 wall so the
          verifier is a person; and I.28's FORWARD burn-down — what will block
          this package and when — recorded as an immutable calculation run
          rather than recomputed, and refusing over a package nobody has
          assessed rather than reporting a comfortable zero. */}
      <WorkPackagingPanel
        caseId={workspace.id}
        canPlan={canPackageWork}
        canRelease={canReleasePackage}
        reloadKey={chainsKey}
      />
      <InformationEnginePanel caseId={workspace.id} reloadKey={chainsKey} />
      <OperationalReadinessSection caseId={workspace.id} canPlan={canPlan} />

      {/* Sanction */}
      {workspace.status !== "sanctioned" &&
        workspace.status !== "cancelled" &&
        workspace.status !== "completed" && (
          <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-slate-100">Sanction</h2>
            <p className="mt-1 text-xs text-slate-400">
              A §70 determination: recorded only through the authority-checked
              path. It requires an ADOPTED sanction delegation for your role and
              passing reviews on the current stage&apos;s blocking gates — the
              server states exactly what is missing.
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
