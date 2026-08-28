/**
 * Sync Develop — readiness surfaces for the Case Workspace (Slice 1 rows
 * 9–12): the §80 gate-readiness panel (D3.35/D13.05), the baselines section
 * (D5.26), the §81 operational-readiness view (D8.08/D8.11) and the
 * per-criterion evidence/gap agent panel (D12.07).
 *
 * HONESTY RULES, inherited from the page these mount on:
 *   * every number rendered here is a row returned by a governed RPC —
 *     get_gate_readiness / get_case_operational_readiness return the same
 *     rows the enforcement paths consult, and nothing is recomputed or
 *     invented client-side;
 *   * refusals render VERBATIM — including the closure-rate projection's
 *     "not yet: N of 3 closure events recorded" and the evidence agent's
 *     provider notes; where a number is not computable the panel says so
 *     instead of showing one;
 *   * the evidence agent is advisory (§70): its panel carries the server's
 *     own disclaimer and its only write path is the opt-in AI_INFERENCE
 *     record through the governed RPC.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Anchor,
  Factory,
  Gauge,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  BASELINE_TYPES,
  type CaseWorkspace,
  type GateReadinessResult,
  type OperationalReadinessResult,
  type ReadinessBlocker,
} from "../../lib/develop";
import {
  approveCaseBaseline,
  bindAssetToCase,
  createCaseBaseline,
  getCaseOperationalReadiness,
  getGateReadiness,
  listBindableAssets,
  listIntakeDocuments,
  runEvidenceAgent,
  type BindableAsset,
  type EvidenceAgentResult,
  type IntakeDocumentOption,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

function CategoryBar({
  label,
  pct,
  detail,
}: {
  label: string;
  pct: number | null;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 truncate text-slate-300">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        {pct != null && (
          <div
            className={`h-full rounded-full ${pct >= 90 ? "bg-emerald-400/70" : pct >= 60 ? "bg-signal-cyan/70" : "bg-amber-400/70"}`}
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          />
        )}
      </div>
      <span className="w-28 shrink-0 text-right text-slate-400">
        {pct != null ? `${pct}%` : "no weight"} {detail}
      </span>
    </div>
  );
}

function blockerLine(b: ReadinessBlocker): {
  key: string;
  kind: string;
  body: React.ReactNode;
} {
  if (b.type === "mandatory_criterion") {
    return {
      key: `c-${b.id}`,
      kind: "mandatory requirement",
      body: (
        <>
          {b.name}{" "}
          <span className="text-red-300/80">
            ({b.status.replace(/_/g, " ")}, {b.category})
          </span>
        </>
      ),
    };
  }
  if (b.type === "open_risk") {
    return {
      key: `r-${b.id}`,
      kind: `${b.level} risk`,
      body: (
        <>
          <Link to="/risk" className="underline decoration-dotted">
            {b.name}
          </Link>{" "}
          <span className="text-red-300/80">({b.status})</span>
        </>
      ),
    };
  }
  return {
    key: `gc-${b.id}`,
    kind: "open condition",
    body: (
      <>
        {b.name}{" "}
        <span className="text-red-300/80">
          (due {b.dueDate}
          {b.overdue ? ", OVERDUE" : ""}
          {b.gate ? `, from ${b.gate}` : ""})
        </span>
      </>
    ),
  };
}

/** The §80 experience: readiness %, BLOCKED override, named blockers,
 *  per-category bars, projected gate date or its honest refusal. */
export function GateReadinessPanel({
  caseId,
  gateId,
  gateName,
  refreshKey,
}: {
  caseId: string;
  gateId: number;
  gateName: string;
  refreshKey: number;
}) {
  const [result, setResult] = useState<GateReadinessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGateReadiness(caseId, gateId)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Readiness read failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, gateId, refreshKey]);

  if (loading)
    return <div className="text-xs text-slate-500">Computing readiness…</div>;
  if (error) return <ErrorLine error={error} />;
  if (!result) return null;

  const headline =
    result.readinessPct != null
      ? `${gateName} — Readiness ${result.readinessPct}%`
      : `${gateName} — readiness not computable (no weighted requirements)`;

  return (
    <div className="space-y-2.5 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 text-signal-cyan" aria-hidden />
        <span className="text-sm font-semibold text-slate-100">{headline}</span>
        {result.blocked ? (
          <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-300">
            BLOCKED
          </span>
        ) : (
          <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            no mandatory blockers
          </span>
        )}
        <span className="text-xs text-slate-400">
          Blockers: {result.blockers.length}. Mandatory {result.mandatoryMet} of{" "}
          {result.mandatoryTotal} met.
        </span>
      </div>

      {result.blocked && result.readinessPct != null && (
        <p className="text-[11px] text-slate-400">
          A failed or never-assessed mandatory requirement blocks this gate at
          any percentage — the {result.readinessPct}% is context, not
          permission (spec §45).
        </p>
      )}

      {result.blockers.length > 0 && (
        <ul className="space-y-1">
          {result.blockers.map((b) => {
            const line = blockerLine(b);
            return (
              <li
                key={line.key}
                className="flex items-start gap-1.5 rounded-md border border-red-400/25 bg-red-400/5 px-2.5 py-1.5 text-[11px] text-red-200"
              >
                <AlertTriangle
                  className="mt-0.5 h-3 w-3 shrink-0"
                  aria-hidden
                />
                <span>
                  <span className="font-semibold uppercase tracking-wide text-red-300">
                    {line.kind}:
                  </span>{" "}
                  {line.body}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1">
        {result.categories.map((cat) => (
          <CategoryBar
            key={cat.category}
            label={
              cat.category === "uncategorized"
                ? "uncategorized (no category set)"
                : cat.category.replace(/_/g, " / ")
            }
            pct={cat.readinessPct}
            detail={`(${cat.metCount}/${cat.criteriaTotal}${cat.unmetMandatory > 0 ? `, ${cat.unmetMandatory} mand. open` : ""})`}
          />
        ))}
      </div>

      <div className="text-[11px] text-slate-400">
        {result.projection.available ? (
          <>
            Projected gate date at current closure rate:{" "}
            <span className="font-semibold text-slate-200">
              {result.projection.projectedDate}
            </span>{" "}
            ({result.projection.remaining} requirement(s) remaining at{" "}
            {result.projection.ratePerDay} closures/day over{" "}
            {result.projection.closureEvents} recorded closures)
          </>
        ) : (
          <>Projected gate date: {result.projection.reason}</>
        )}
      </div>

      <div className="text-[11px] text-slate-500">
        Case evidence: {result.evidenceSummary.verified} verified of{" "}
        {result.evidenceSummary.total}
        {result.evidenceSummary.aiInferenceUnverified > 0 &&
          ` (${result.evidenceSummary.aiInferenceUnverified} unverified AI inference — support only after human verification)`}
        . Evidence counts inform the reviewer; only recorded findings move
        readiness.
      </div>
    </div>
  );
}

/** Per-criterion evidence/gap agent (D12.07). Advisory only, §70 absolute. */
export function EvidenceAgentPanel({
  caseId,
  criterionId,
  criterion,
}: {
  caseId: string;
  criterionId: number;
  criterion: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvidenceAgentResult | null>(null);
  const [recordBusy, setRecordBusy] = useState(false);

  const run = async (record: boolean) => {
    if (record) setRecordBusy(true);
    else setBusy(true);
    setError(null);
    try {
      const r = await runEvidenceAgent({ caseId, criterionId, record });
      setResult(r);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evidence agent failed");
      setOpen(true);
    } finally {
      setBusy(false);
      setRecordBusy(false);
    }
  };

  return (
    <div className="mt-1.5">
      <button
        onClick={() => (open && result ? setOpen(false) : void run(false))}
        disabled={busy}
        className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"
        title={`What evidence supports: ${criterion}`}
      >
        <Search className="h-3 w-3" aria-hidden />
        {busy ? "Scanning…" : open && result ? "Hide evidence scan" : "What evidence supports this?"}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-md border border-white/8 bg-white/[0.02] p-2 text-[11px]">
          <ErrorLine error={error} />
          {result && (
            <>
              <p
                className={
                  result.analysis.verdict === "supported"
                    ? "text-emerald-300"
                    : "text-amber-300"
                }
              >
                {result.analysis.statement}
              </p>
              {result.analysis.matches.length > 0 && (
                <ul className="space-y-1">
                  {result.analysis.matches.map((m) => (
                    <li key={m.evidence.id} className="text-slate-300">
                      <span className="rounded bg-white/5 px-1 py-0.5 text-[10px] text-slate-400">
                        {m.evidence.evidenceClass ?? "unclassified"} ·{" "}
                        {m.evidence.verificationStatus}
                      </span>{" "}
                      {m.evidence.description}
                      <span className="text-slate-500">
                        {" "}
                        (matched: {m.matchedTerms.join(", ")})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {result.kbCitations.length > 0 && (
                <div className="text-slate-400">
                  Document passages:{" "}
                  {result.kbCitations.map((c) => c.label).join(" ")}
                </div>
              )}
              {result.narrative ? (
                <p className="border-l-2 border-signal-cyan/30 pl-2 text-slate-300">
                  {result.narrative}
                  {result.model && (
                    <span className="text-slate-500"> — {result.model}</span>
                  )}
                </p>
              ) : (
                result.providerNote && (
                  <p className="text-slate-500">{result.providerNote}</p>
                )
              )}
              <p className="text-slate-500">{result.disclaimer}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void run(true)}
                  disabled={recordBusy}
                  className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/5 disabled:opacity-50"
                >
                  {recordBusy
                    ? "Recording…"
                    : "Record finding as AI_INFERENCE evidence"}
                </button>
                {result.recordedEvidenceId && (
                  <span className="text-emerald-300">
                    recorded (unverified until a human verifies it)
                  </span>
                )}
                {result.recordNote && (
                  <span className="text-amber-300">{result.recordNote}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Baselines (D5.26): six §20 types, versioned, prior versions immutable. */
export function BaselinesSection({
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
  const [baselineType, setBaselineType] = useState("");
  const [description, setDescription] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documents, setDocuments] = useState<IntakeDocumentOption[]>([]);
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adding && documents.length === 0) {
      listIntakeDocuments()
        .then(setDocuments)
        .catch(() => setDocuments([]));
    }
  }, [adding, documents.length]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createCaseBaseline({
        caseId: workspace.id,
        baselineType,
        description,
        documentId: documentId || null,
      });
      setAdding(false);
      setBaselineType("");
      setDescription("");
      setDocumentId("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (baselineId: string) => {
    setBusy(true);
    setError(null);
    try {
      await approveCaseBaseline({ baselineId, note });
      setApproveFor(null);
      setNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        <Anchor className="h-4 w-4 text-slate-500" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-100">Baselines</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        The six §20 types — SCOPE, COST, SCHEDULE, DESIGN, RISK, BENEFITS —
        versioned per case. Approval is a recorded human act; a prior version
        is immutable, because it is the anchor change control will diff
        against.
      </p>
      <div className="mt-3 space-y-2">
        <ErrorLine error={error} />
        {workspace.baselines.length === 0 && (
          <p className="text-xs text-slate-500">
            No baselines yet. Draft the reference this case will be measured
            against — scope first, then cost and schedule as they firm up.
          </p>
        )}
        {workspace.baselines.map((b) => (
          <div
            key={b.id}
            className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-200">
                {b.baselineType} v{b.version}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  b.status === "approved"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : b.status === "superseded"
                      ? "bg-white/5 text-slate-500"
                      : "bg-signal-cyan/10 text-signal-cyan"
                }`}
              >
                {b.status}
              </span>
              {b.document && (
                <span className="text-slate-500">doc: {b.document.title}</span>
              )}
            </div>
            <p className="mt-1 text-slate-300">{b.description}</p>
            {b.approval && (
              <p className="mt-1 text-[11px] text-slate-500">
                Approved{" "}
                {new Date(b.approval.approvedAt).toLocaleDateString()}
                {b.approval.by ? ` by ${b.approval.by}` : ""} —{" "}
                {b.approval.note}
              </p>
            )}
            {canReview && b.status === "draft" && (
              <div className="mt-1.5">
                {approveFor === b.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Basis for approval (20 characters minimum)"
                      className={`${inputClass} max-w-md`}
                    />
                    <button
                      onClick={() => void approve(b.id)}
                      disabled={busy}
                      className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
                    >
                      Approve v{b.version}
                    </button>
                    <button
                      onClick={() => setApproveFor(null)}
                      className="text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setApproveFor(b.id)}
                    className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5"
                  >
                    Approve this baseline
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {canPlan && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Draft a baseline
          </button>
        )}
        {adding && (
          <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={baselineType}
                onChange={(e) => setBaselineType(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Type…
                </option>
                {BASELINE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this baseline fixes (10 characters minimum)"
                className={`${inputClass} sm:col-span-2`}
              />
              <select
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className={`${inputClass} sm:col-span-3`}
              >
                <option value="">
                  No document — or pick one from the intake register
                </option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void create()}
                disabled={busy || baselineType === ""}
                className="rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-50"
              >
                {busy ? "Drafting…" : "Create draft"}
              </button>
              <button
                onClick={() => {
                  setAdding(false);
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
    </div>
  );
}

/** The §81 operations view: per-category honest counts, hard blockers named. */
export function OperationalReadinessSection({
  caseId,
  canPlan,
}: {
  caseId: string;
  canPlan: boolean;
}) {
  const [result, setResult] = useState<OperationalReadinessResult | null>(
    null,
  );
  const [assets, setAssets] = useState<BindableAsset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getCaseOperationalReadiness(caseId)
      .then((r) => setResult(r))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Readiness read failed"),
      );
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (canPlan) {
      listBindableAssets()
        .then(setAssets)
        .catch(() => setAssets([]));
    }
  }, [canPlan]);

  const bind = async () => {
    setBusy(true);
    setError(null);
    try {
      await bindAssetToCase({ assetId, caseId });
      setAssetId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Binding failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        <Factory className="h-4 w-4 text-slate-500" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-100">
          Operational readiness
        </h2>
        {result?.overall && (
          <span className="rounded-full bg-signal-cyan/10 px-2 py-0.5 text-xs font-semibold text-signal-cyan">
            {result.overall.pct}% ({result.overall.satisfied}/
            {result.overall.total})
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Could operations take ownership? Per-§30-category readiness of the
        assets in this case&apos;s scope, from the one onboarding catalog.
        Safety and mission-critical items are hard blockers by name.
        {result?.scopeNote ? ` (${result.scopeNote}.)` : ""}
      </p>
      <div className="mt-3 space-y-2.5">
        <ErrorLine error={error} />
        {result?.note && (
          <p className="text-xs text-slate-500">{result.note}</p>
        )}

        {result && result.categories.length > 0 && (
          <div className="space-y-1">
            {result.categories.map((cat) => (
              <CategoryBar
                key={cat.category}
                label={
                  cat.category === "uncategorized"
                    ? "uncategorized (platform sections)"
                    : cat.category.replace(/_/g, " ")
                }
                pct={cat.pct}
                detail={`(${cat.satisfied}/${cat.total})`}
              />
            ))}
          </div>
        )}

        {result && result.hardBlockers.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-300">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              {result.overall?.hardBlockerCount} hard blocker(s)
              {result.overall != null &&
                result.overall.safetyOpenCount > 0 &&
                ` — ${result.overall.safetyOpenCount} safety/mission-critical`}
              {result.hardBlockers.length <
                (result.overall?.hardBlockerCount ?? 0) &&
                ` (showing first ${result.hardBlockers.length})`}
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {result.hardBlockers.map((b, i) => (
                <li
                  key={`${b.assetId}-${b.item}-${i}`}
                  className="rounded-md border border-red-400/20 bg-red-400/5 px-2.5 py-1.5 text-[11px] text-red-200"
                >
                  <span className="font-semibold">{b.asset}</span>
                  {b.assetTag ? ` (${b.assetTag})` : ""}: {b.item}{" "}
                  <span className="text-red-300/80">
                    ({b.kind === "safety_mission_critical"
                      ? "safety/mission-critical"
                      : "required for go-live"}
                    , {b.status})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && result.assets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {result.assets.map((a) => (
              <span
                key={a.assetId}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  a.ready
                    ? "border-emerald-400/30 text-emerald-300"
                    : "border-white/10 text-slate-400"
                }`}
              >
                {a.name}: {a.requiredSatisfied}/{a.required} required
                {a.ready ? " — ready" : ""}
              </span>
            ))}
          </div>
        )}

        {canPlan && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className={`${inputClass} max-w-xs`}
            >
              <option value="" disabled>
                Bind an asset to this case&apos;s scope…
              </option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.tag ? ` (${a.tag})` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => void bind()}
              disabled={busy || assetId === ""}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              {busy ? "Binding…" : "Bind asset"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
