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
 *   * The full §44 workspace (business case, options, risks, requirements,
 *     decisions, deliverables, schedule, cost, actions) is later slices;
 *     the sections below are only what is real today.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import {
  advanceCaseStage,
  getDevelopmentCase,
  listOrgMembers,
  recordCaseGateReview,
  sanctionDevelopmentCase,
  type GateConditionInput,
  type GateFindingInput,
  type OrgMember,
} from "../services/developService";
import {
  GATE_OUTCOMES,
  LIFECYCLE_TYPES,
  gateRollup,
  isPassingOutcome,
  type CaseWorkspace,
  type WorkspaceGate,
  type WorkspaceStage,
} from "../lib/develop";

const REVIEW_ROLES = [
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
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
  onRecorded,
}: {
  gate: WorkspaceGate;
  caseId: string;
  canReview: boolean;
  members: OrgMember[];
  onRecorded: () => void;
}) {
  const rollup = useMemo(() => gateRollup(gate), [gate]);
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

export function DevelopmentCaseWorkspacePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canReview =
    profile?.role != null && REVIEW_ROLES.includes(profile.role);

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
                      onRecorded={() => void load()}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
