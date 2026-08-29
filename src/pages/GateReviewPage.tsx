/**
 * Sync Develop — Workflow 2: the gate review (D3.31, spec III.§36), at
 * /develop/cases/:caseId/gates/:gateId/review.
 *
 * WHAT THIS SCREEN IS FOR. The gate machinery has been DB-enforced since
 * Slice 1 and the Case Workspace has been able to record a decision since
 * then too. What was missing was the REVIEW — the ten §36 steps a human
 * actually walks: requirements checked, evidence retrieved, its quality
 * stated, unresolved risks named, approvals and assurance positioned, and
 * only then a decision. This page is that walk, in order, on one screen.
 *
 * HONESTY RULES:
 *   * every number and every blocker comes from get_gate_review_pack, which
 *     returns get_gate_readiness' own payload. Nothing here recomputes
 *     readiness — a second evaluator on a screen is the one people believe;
 *   * evidence is what somebody LINKED. "No deliverable and no evidence is
 *     linked to this requirement" is the server's sentence and it is rendered
 *     verbatim, because that is the row that gets work done;
 *   * the SoD position is stated BEFORE the form, not discovered after it.
 *     The same predicate refuses the act at the database, so the screen and
 *     the server cannot disagree;
 *   * §70: the gate agent's reading sits beside the decision and can never
 *     make it. Its disclaimer is the server's own text, rendered as written.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleSlash,
  FileCheck2,
  Gauge,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import {
  abandonGateReview,
  getGateAgentReports,
  getGateReviewPack,
  listOrgMembers,
  openGateReview,
  recordGateReviewOutcome,
  runGateAgent,
  type AssembledRequirement,
  type GateAgentReportRow,
  type GateAgentResult,
  type GateConditionInput,
  type GateFindingInput,
  type GateReviewPack,
  type OrgMember,
} from "../services/developService";
import { GATE_OUTCOMES } from "../lib/develop";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

const BLOCKER_LABEL: Record<string, string> = {
  mandatory_criterion: "Mandatory requirement",
  open_risk: "Unresolved risk",
  open_condition: "Open condition",
  success_contract: "Success contract",
  regulatory_condition: "Permit condition",
  uncovered_commitment: "Uncovered commitment",
  assurance_not_satisfied: "Independent assurance",
};

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-xs whitespace-pre-wrap text-red-300">
      {error}
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-cyan/15 text-[10px] font-bold text-signal-cyan">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ConfidenceChip({
  confidence,
}: {
  confidence: { evidenceConfidence?: number; refusal?: string; error?: string };
}) {
  if (typeof confidence?.evidenceConfidence === "number") {
    return (
      <span className="rounded-full bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan">
        EC {confidence.evidenceConfidence.toFixed(2)}
      </span>
    );
  }
  return (
    <span
      className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
      title={confidence?.error ?? confidence?.refusal ?? "not computed"}
    >
      EC refused
    </span>
  );
}

function RequirementCard({
  requirement,
  finding,
  onFinding,
  recording,
}: {
  requirement: AssembledRequirement;
  finding: GateFindingInput | undefined;
  onFinding: (
    status: "met" | "not_met" | "not_assessed",
    evidence?: string,
  ) => void;
  recording: boolean;
}) {
  const a = requirement.assembled;
  return (
    <li className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-100">
          {requirement.criterion}
        </span>
        {requirement.isMandatory ? (
          <span className="rounded-full bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
            mandatory
          </span>
        ) : (
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
            advisory
          </span>
        )}
        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
          {requirement.sourceAuthority}
        </span>
        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
          {requirement.category}
        </span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            requirement.status === "met"
              ? "bg-emerald-400/10 text-emerald-300"
              : requirement.status === "not_met"
                ? "bg-red-400/10 text-red-300"
                : "bg-amber-400/10 text-amber-300"
          }`}
        >
          {requirement.status.replace(/_/g, " ")}
        </span>
        {requirement.activeWaiver && (
          <span
            className="rounded-full bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300"
            title={requirement.activeWaiver.justification}
          >
            waived until{" "}
            {new Date(requirement.activeWaiver.expiresAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* §36 steps 3-4: the evidence, pre-assembled, and its quality. */}
      <p className="mt-1.5 text-[11px] text-slate-400">{a.statement}</p>
      {a.deliverables.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {a.deliverables.map((d) => (
            <li key={d.id} className="text-[11px] text-slate-300">
              <FileCheck2
                className="mr-1 inline h-3 w-3 text-slate-500"
                aria-hidden
              />
              {d.title} · rev {d.revision} ·{" "}
              <span
                className={
                  d.status === "accepted"
                    ? "text-emerald-300"
                    : "text-amber-300"
                }
              >
                {d.status}
              </span>
              {d.acceptedBy ? ` · accepted by ${d.acceptedBy}` : ""}
            </li>
          ))}
        </ul>
      )}
      {a.evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {a.evidence.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300"
            >
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  e.verificationStatus === "verified"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : e.verificationStatus === "rejected"
                      ? "bg-red-400/10 text-red-300"
                      : "bg-amber-400/10 text-amber-300"
                }`}
              >
                {e.verificationStatus}
              </span>
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {e.evidenceClass ?? "unclassed"}
              </span>
              <ConfidenceChip confidence={e.confidence} />
              <span className="truncate">{e.description}</span>
              <span className="text-slate-500">— {e.link}</span>
            </li>
          ))}
        </ul>
      )}

      {recording && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["met", "not_met", "not_assessed"] as const).map((s) => (
            <label
              key={s}
              className="flex items-center gap-1 text-[11px] text-slate-300"
            >
              <input
                type="radio"
                name={`finding-${requirement.id}`}
                checked={finding?.status === s}
                onChange={() => onFinding(s)}
              />
              {s.replace(/_/g, " ")}
            </label>
          ))}
          <input
            placeholder="Evidence for this finding"
            value={finding?.evidence ?? ""}
            onChange={(e) =>
              onFinding(finding?.status ?? "not_assessed", e.target.value)
            }
            className="min-w-40 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-100"
          />
        </div>
      )}
    </li>
  );
}

interface ConditionDraft {
  description: string;
  owner_id: string;
  due_date: string;
  evidence_requirement: string;
  consequence_if_missed: string;
}

export function GateReviewPage() {
  const { caseId, gateId } = useParams<{ caseId: string; gateId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const gateIdNum = Number(gateId ?? 0);

  const [pack, setPack] = useState<GateReviewPack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [fundingAnswer, setFundingAnswer] = useState("");
  const [findings, setFindings] = useState<Record<number, GateFindingInput>>(
    {},
  );
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [abandonReason, setAbandonReason] = useState("");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [agent, setAgent] = useState<GateAgentResult | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  /** Prior readings, dated. A reading is a fact about a moment, so the
   *  history is shown rather than only the latest one. */
  const [agentHistory, setAgentHistory] = useState<GateAgentReportRow[]>([]);

  const load = useCallback(async () => {
    if (!caseId || !Number.isInteger(gateIdNum) || gateIdNum <= 0) return;
    try {
      const [nextPack, reports] = await Promise.all([
        getGateReviewPack(caseId, gateIdNum),
        getGateAgentReports(caseId, gateIdNum).catch(() => ({
          caseId,
          reports: [] as GateAgentReportRow[],
        })),
      ]);
      setPack(nextPack);
      setAgentHistory(reports.reports);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId, gateIdNum]);

  useEffect(() => {
    void load();
    listOrgMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [load]);

  const session = pack?.openSession ?? null;
  const mine = session != null && session.openedById === profile?.id;
  const sod = pack?.sod;
  const blockers = pack?.readiness?.blockers ?? [];

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setActError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (e) {
      setActError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!session) return;
    await act(
      () =>
        recordGateReviewOutcome({
          sessionId: session.id,
          outcome,
          note,
          findings: Object.values(findings),
          conditions: conditions.map((c) => ({ ...c }) as GateConditionInput),
          fundingAnswer: fundingAnswer.trim() || null,
        }),
      "Gate decision recorded. The review session is closed and linked to it.",
    );
    setOutcome("");
    setNote("");
    setFindings({});
    setConditions([]);
    setFundingAnswer("");
  };

  const runAgent = async (record: boolean) => {
    if (!caseId) return;
    setAgentBusy(true);
    setAgentError(null);
    try {
      setAgent(await runGateAgent({ caseId, gateId: gateIdNum, record }));
      if (record) await load();
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentBusy(false);
    }
  };

  const readinessLabel = useMemo(() => {
    const pct = pack?.readiness?.readinessPct;
    if (pct == null) {
      return "no readiness percentage — this gate defines no weighted requirements";
    }
    return `${pct}% readiness`;
  }, [pack]);

  if (!caseId || !Number.isInteger(gateIdNum) || gateIdNum <= 0) {
    return <div className="p-6 text-sm text-slate-300">No gate named.</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate(`/develop/cases/${caseId}`)}
          className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Case workspace
        </button>
        <Link
          to={`/develop/cases/${caseId}/assurance`}
          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
        >
          Assurance case
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-slate-50">
          Gate review — {pack?.gateName ?? "loading"}
        </h1>
        <p className="text-xs text-slate-400">
          {pack?.caseTitle} · {pack?.decisionType ?? ""} ·{" "}
          {pack ? readinessLabel : ""}
          {pack?.readiness?.blocked ? " · BLOCKED" : ""}
        </p>
      </header>

      <ErrorLine error={loadError} />
      <ErrorLine error={actError} />
      {notice && (
        <div className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2 text-xs text-emerald-300">
          {notice}
        </div>
      )}

      {pack && (
        <>
          {/* §36 steps 1-2 + 5-7 — the position, from the one evaluator. */}
          <Step n={1} title="Where this gate stands">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <Gauge className="h-4 w-4 text-signal-cyan" aria-hidden />
              <span className="font-semibold text-slate-100">
                {readinessLabel}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  pack.readiness.blocked
                    ? "bg-red-400/10 text-red-300"
                    : "bg-emerald-400/10 text-emerald-300"
                }`}
              >
                {pack.readiness.blocked ? "BLOCKED" : "not blocked"}
              </span>
              <span>
                {pack.readiness.mandatoryMet} of {pack.readiness.mandatoryTotal}{" "}
                mandatory requirement(s) met on the latest review
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {(pack.readiness.categories ?? []).map((c) => (
                <div
                  key={c.category}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <span className="w-32 shrink-0 truncate text-slate-400">
                    {c.category}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    {c.readinessPct != null && (
                      <div
                        className="h-full rounded-full bg-signal-cyan/70"
                        style={{
                          width: `${Math.max(2, Math.min(100, c.readinessPct))}%`,
                        }}
                      />
                    )}
                  </div>
                  <span className="w-14 shrink-0 text-right text-slate-300">
                    {c.readinessPct == null ? "—" : `${c.readinessPct}%`}
                  </span>
                </div>
              ))}
            </div>
          </Step>

          <Step n={2} title={`Blockers (${blockers.length})`}>
            {blockers.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nothing is recorded as blocking this gate. That is not the same
                as ready — it means nothing the evaluator can see stands in the
                way.
              </p>
            ) : (
              <ul className="space-y-1">
                {blockers.map((b, i) => (
                  <li
                    key={`${b.type}-${b.id ?? i}`}
                    className="flex flex-wrap items-start gap-2 rounded border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="rounded-full bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                      {BLOCKER_LABEL[b.type] ?? b.type}
                    </span>
                    <span className="flex-1 text-slate-300">{b.name}</span>
                    {/* `overdue` exists only on the dated blocker families
                        (conditions, permit conditions, commitments) — the union
                        is narrowed rather than widened, so a family that has no
                        date cannot silently render as on time. */}
                    {"overdue" in b && b.overdue && (
                      <span className="text-red-300">overdue</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Step>

          <Step
            n={3}
            title="Requirements, with the evidence assembled for each"
          >
            {pack.requirements.length === 0 ? (
              <p className="text-xs text-slate-400">
                This gate defines no requirements, so it can block nothing — and
                a proceed through it is refused for that reason.
              </p>
            ) : (
              <ul className="space-y-2">
                {pack.requirements.map((r) => (
                  <RequirementCard
                    key={r.id}
                    requirement={r}
                    finding={findings[r.id]}
                    recording={mine}
                    onFinding={(status, evidence) =>
                      setFindings((prev) => ({
                        ...prev,
                        [r.id]: {
                          criterion_id: r.id,
                          criterion_text: r.criterion,
                          status,
                          evidence:
                            evidence !== undefined
                              ? evidence
                              : prev[r.id]?.evidence,
                        },
                      }))
                    }
                  />
                ))}
              </ul>
            )}
          </Step>

          <Step n={4} title="Independent assurance">
            {pack.assurance == null ? (
              <p className="text-xs text-slate-400">
                No assurance position was returned for this gate.
              </p>
            ) : (
              <div className="text-xs text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
                  <span>
                    demanded level:{" "}
                    <span className="font-semibold text-slate-100">
                      {String(pack.assurance.demandedLevel ?? "none")}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      pack.assurance.required === false
                        ? "bg-white/5 text-slate-400"
                        : pack.assurance.satisfied
                          ? "bg-emerald-400/10 text-emerald-300"
                          : "bg-amber-400/10 text-amber-300"
                    }`}
                  >
                    {pack.assurance.required === false
                      ? "not required"
                      : pack.assurance.satisfied
                        ? "satisfied at this gate"
                        : "not satisfied at this gate"}
                  </span>
                </div>
              </div>
            )}
          </Step>

          {/* §70 — the agent reads, and cannot decide. */}
          <Step n={5} title="Gate agent reading (advisory)">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void runAgent(false)}
                disabled={agentBusy}
                className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                <Bot className="h-3.5 w-3.5" aria-hidden />
                {agentBusy ? "Reading…" : "Read this gate"}
              </button>
              {agent && (
                <button
                  onClick={() => void runAgent(true)}
                  disabled={agentBusy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Record this reading
                </button>
              )}
            </div>
            <ErrorLine error={agentError} />
            {agent && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-white/8 bg-white/[0.02] p-2.5 text-[11px] text-slate-300">
                <p className="font-semibold text-slate-100">
                  {agent.reading.headline}
                </p>
                {agent.reading.blockerLines.map((l) => (
                  <p key={l}>· {l}</p>
                ))}
                <p className="text-slate-400">{agent.reading.projectionLine}</p>
                {agent.narrative && (
                  <p className="whitespace-pre-wrap border-t border-white/6 pt-1.5">
                    {agent.narrative}
                  </p>
                )}
                {agent.providerNote && (
                  <p className="text-slate-500">{agent.providerNote}</p>
                )}
                {agent.recordNote && (
                  <p className="text-amber-300">{agent.recordNote}</p>
                )}
                {agent.recorded && (
                  <p className="text-emerald-300">
                    Recorded as report #{agent.recorded.report_id}.
                  </p>
                )}
                <p className="border-t border-white/6 pt-1.5 text-slate-500">
                  {agent.disclaimer}
                </p>
              </div>
            )}
            {agentHistory.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[11px] font-semibold text-slate-400">
                  Recorded readings ({agentHistory.length}) — each dated, none
                  editable
                </div>
                <ul className="space-y-1">
                  {agentHistory.slice(0, 5).map((r) => (
                    <li
                      key={r.id}
                      className="rounded border border-white/6 bg-white/[0.02] px-2 py-1 text-[11px] text-slate-400"
                    >
                      <span className="text-slate-300">
                        {new Date(r.asAt).toLocaleString()}
                      </span>{" "}
                      ·{" "}
                      {r.readinessPct == null
                        ? "no percentage"
                        : `${r.readinessPct}%`}{" "}
                      · {r.blocked ? "BLOCKED" : "not blocked"} ·{" "}
                      {r.blockerCount} blocker(s)
                      {r.model ? ` · ${r.model}` : ""} · advisory
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Step>

          {/* §36 step 10 — and who may take it. */}
          <Step n={6} title="The decision">
            {sod && (
              <div className="mb-3 space-y-1">
                <div
                  className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
                    sod.mayRecord
                      ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-300"
                      : "border-amber-400/25 bg-amber-400/5 text-amber-300"
                  }`}
                >
                  {sod.mayRecord ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                  ) : (
                    <CircleSlash className="h-4 w-4" aria-hidden />
                  )}
                  {sod.mayRecord
                    ? "You may record this gate decision."
                    : "You may not record this gate decision."}
                </div>
                <ul className="space-y-0.5">
                  {sod.pairs
                    .filter((p) => p.applies)
                    .map((p) => (
                      <li
                        key={p.pair}
                        className="flex items-start gap-2 text-[11px]"
                      >
                        <span
                          className={
                            p.clear ? "text-emerald-400" : "text-amber-400"
                          }
                        >
                          {p.clear ? "clear" : "blocked"}
                        </span>
                        <span className="text-slate-400">
                          {p.label} — {p.reason}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {session == null ? (
              <button
                onClick={() =>
                  void act(
                    () => openGateReview(caseId, gateIdNum),
                    "Review opened. The brief above is now recorded as what you were shown.",
                  )
                }
                disabled={busy}
                className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/15 disabled:opacity-50"
              >
                Open the review
              </button>
            ) : !mine ? (
              <p className="text-xs text-amber-300">
                A review of this gate is already open — opened{" "}
                {new Date(session.openedAt).toLocaleString()} by{" "}
                {session.openedBy ?? "another member"}. Continue it with them,
                or ask them to abandon it before opening another.
              </p>
            ) : (
              <div className="space-y-2">
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
                <input
                  value={fundingAnswer}
                  onChange={(e) => setFundingAnswer(e.target.value)}
                  placeholder="Zero-based funding answer — if this project were proposed today, would we still fund it? (required at a sanction gate)"
                  className={inputClass}
                />

                {outcome === "proceed_with_conditions" && (
                  <div className="space-y-2 rounded-lg border border-white/8 p-2.5">
                    <div className="text-xs font-semibold text-slate-200">
                      Conditions (each with owner, due date, closing evidence
                      and the consequence if missed)
                    </div>
                    {conditions.map((c, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
                      >
                        <input
                          className={inputClass}
                          placeholder="What must be done"
                          value={c.description}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? { ...x, description: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                        <select
                          className={inputClass}
                          value={c.owner_id}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? { ...x, owner_id: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="">Owner…</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name ?? m.email}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          className={inputClass}
                          value={c.due_date}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? { ...x, due_date: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                        <input
                          className={inputClass}
                          placeholder="Evidence that closes it"
                          value={c.evidence_requirement}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      evidence_requirement: e.target.value,
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        <input
                          className={`${inputClass} sm:col-span-2`}
                          placeholder="Consequence if missed"
                          value={c.consequence_if_missed}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      consequence_if_missed: e.target.value,
                                    }
                                  : x,
                              ),
                            )
                          }
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
                      Add a condition
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void submit()}
                    disabled={busy || !outcome}
                    className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/15 disabled:opacity-50"
                  >
                    Record the decision
                  </button>
                  <input
                    value={abandonReason}
                    onChange={(e) => setAbandonReason(e.target.value)}
                    placeholder="Reason to abandon this review"
                    className="min-w-56 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-100"
                  />
                  <button
                    onClick={() =>
                      void act(
                        () => abandonGateReview(session.id, abandonReason),
                        "Review abandoned. The record that it was opened and dropped survives.",
                      )
                    }
                    disabled={busy}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  >
                    Abandon
                  </button>
                </div>
                <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
                  <ShieldAlert
                    className="mt-0.5 h-3 w-3 shrink-0"
                    aria-hidden
                  />
                  Every refusal you see when you record comes from the database,
                  not from this form: unmet mandatory requirements, outstanding
                  permit conditions, uncovered commitments, composite authority
                  rules and the success contract all block a pass at the act
                  site, whatever this screen shows.
                </p>
              </div>
            )}
          </Step>
        </>
      )}
    </div>
  );
}

export default GateReviewPage;
