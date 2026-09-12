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
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Anchor,
  Factory,
  GanttChart,
  Gauge,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  BASELINE_TYPES,
  type CaseWorkspace,
  type GateReadinessResult,
  type OperationalReadinessResult,
  type OperationalReadinessFactorKey,
  type OperationalReadinessIndexResult,
  type ReadinessBlocker,
  type SystemOperationalReadinessResult,
  type SystemReadinessDesignOriginsResult,
} from "../../lib/develop";
import {
  approveCaseBaseline,
  adoptCaseOperationalReadinessIndexProfile,
  bindAssetToCase,
  createCaseBaseline,
  getCaseOperationalReadiness,
  getCaseOperationalReadinessIndex,
  getCaseSystemOperationalReadiness,
  getCaseSystemReadinessDesignOrigins,
  getGateReadiness,
  initializeCommissioningSystemReadiness,
  listBindableAssets,
  listOrgEvidenceItems,
  listOrgMembers,
  listOperationalReadinessCatalog,
  listCaseRequirements,
  listIntakeDocuments,
  recordSystemOperationalReadinessItem,
  recordSystemReadinessDesignOrigin,
  runEvidenceAgent,
  saveCaseOperationalReadinessIndexProfile,
  type BindableAsset,
  type EvidenceAgentResult,
  type IntakeDocumentOption,
  type OrgMember,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

const ORI_FACTORS: Array<{ key: OperationalReadinessFactorKey; label: string }> = [
  { key: "people", label: "People" },
  { key: "procedures", label: "Procedures" },
  { key: "asset_data", label: "Asset data" },
  { key: "maintenance", label: "Maintenance" },
  { key: "spares", label: "Spares" },
  { key: "training", label: "Training" },
  { key: "operations", label: "Operations" },
  { key: "safety", label: "Safety" },
  { key: "cyber", label: "Cyber" },
];

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
  if (b.type === "open_condition") {
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
  if (b.type === "success_contract") {
    // D1.02: the same predicate record_case_gate_review refuses a proceed on,
    // named before anyone attempts the review.
    return {
      key: `sc-${b.id}`,
      kind: "success contract",
      body: <>{b.name}</>,
    };
  }
  if (b.type === "regulatory_condition") {
    return {
      key: `rc-${b.id}`,
      kind: `permit condition (${b.domain.replace(/_/g, " ")})`,
      body: (
        <>
          {b.name}{" "}
          <span className="text-red-300/80">
            (due {b.dueDate}, OVERDUE, {b.regulator})
          </span>
        </>
      ),
    };
  }
  if (b.type === "uncovered_commitment") {
    return {
      key: `uc-${b.id}`,
      kind: `uncovered ${b.kind} commitment`,
      body: (
        <>
          {b.name}{" "}
          <span className="text-red-300/80">
            (due {b.dueDate}, OVERDUE, no project requirement carries it)
          </span>
        </>
      ),
    };
  }
  if (b.type === "procurement_package_unawarded") {
    // D6.09: the mandatory long-lead package whose award-by date has passed.
    // The date arithmetic is the SERVER's — this renders it, it does not
    // recompute it, so the banner and the persistence wall cannot disagree.
    return {
      key: `pu-${b.id}`,
      kind: `procurement package unawarded (${b.packageCode})`,
      body: (
        <>
          {b.name}{" "}
          <span className="text-red-300/80">
            (award required by {b.awardRequiredBy}, commercial status{" "}
            {b.commercialStatus.replace(/_/g, " ")})
          </span>
        </>
      ),
    };
  }
  if (b.type === "procurement_package_late") {
    return {
      key: `pl-${b.id}`,
      kind: `procurement package late (${b.packageCode})`,
      body: (
        <>
          {b.name}{" "}
          <span className="text-red-300/80">
            ({b.slippageDays} day(s) after the {b.requiredDate} the project
            needs it)
          </span>
        </>
      ),
    };
  }
  if (b.type === "procurement_package_contract_late") {
    // D6.09 leg 3: the mandatory package whose AWARDED CONTRACT completes
    // after the date the project needs the equipment. The leg that closes
    // "awarded late, no forecast recorded" — which legs 1 and 2 between them
    // left silent, so a contract that could not deliver on time by its own
    // terms raised nothing and the gate passed.
    return {
      key: `pcl-${b.id}`,
      kind: `procurement contract cannot deliver on time (${b.packageCode})`,
      body: (
        <>
          {b.name}{" "}
          <span className="text-red-300/80">
            (contract completes {b.contractCompletionDate}, {b.slippageDays}{" "}
            day(s) after the {b.requiredDate} the project needs it)
          </span>
        </>
      ),
    };
  }
  if (b.type === "assurance_not_satisfied") {
    return {
      key: `as-${b.id}`,
      kind: `assurance demanded: ${b.demandedLevel}`,
      body: <>{b.name}</>,
    };
  }
  // Exhaustiveness: a blocker type the union does not know is rendered as
  // itself rather than silently wearing another type's label. The first draft
  // fell through to the success_contract shape, so every Slice 3C blocker
  // rendered as "SUCCESS CONTRACT:" — a true row under a false heading.
  const unknown = b as { type: string; id: string | number; name: string };
  return {
    key: `${unknown.type}-${unknown.id}`,
    kind: unknown.type.replace(/_/g, " "),
    body: <>{unknown.name}</>,
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
          any percentage — the {result.readinessPct}% is context, not permission
          (spec §45).
        </p>
      )}

      {/* D3.16 (spec II.15): the assurance POSITION at this gate — what the
          adopted governance intensity demands and whether a completed,
          II.15-complete review bound to THIS gate meets it. The payload was
          returned and read by nothing; a position nobody renders informs no
          decision. */}
      {result.assurance?.required && (
        <p
          className={`text-[11px] ${
            result.assurance.satisfied ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          Assurance (II.15): this case&apos;s adopted governance intensity
          demands <strong>{result.assurance.demandedLevel}</strong> assurance
          {result.assurance.independentRequiredByBinding
            ? " (the binding requires independence)"
            : ""}
          .{" "}
          {result.assurance.satisfied
            ? "A completed, acceptable review bound to this gate, with a verified competency and an explicit conflicts declaration, meets it."
            : `Not met: ${result.assurance.reviews.length} review(s) recorded against this case, none of them a completed, acceptable, II.15-complete review bound to this gate at or above ${result.assurance.demandedLevel}.`}
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
        {busy
          ? "Scanning…"
          : open && result
            ? "Hide evidence scan"
            : "What evidence supports this?"}
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
        versioned per case. Approval is a recorded human act; a prior version is
        immutable, because it is the anchor change control will diff against.
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
                Approved {new Date(b.approval.approvedAt).toLocaleDateString()}
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
/**
 * The imported schedule, LISTED (D5.28 import half). Read-only on purpose:
 * P6 is the system of record and Sync never writes a schedule back — there
 * is no edit affordance to build. Analysis over these rows (critical path,
 * schedule confidence, simulation) is later work and nothing here pretends
 * otherwise.
 */
const ACTIVITY_RENDER_CAP = 50;

export function ScheduleSection({ workspace }: { workspace: CaseWorkspace }) {
  // Frontend and migrations ship on independent paths; a workspace read from
  // a database that predates 20261112090000 simply has no key, and that must
  // render as the empty state rather than a crash.
  const events = workspace.schedule ?? [];
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        <GanttChart className="h-4 w-4 text-slate-500" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-100">Schedule</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Activities imported from Primavera P6 against this case. P6 remains the
        system of record — Sync analyzes and never writes back. This section
        lists what was imported; critical-path and schedule-confidence analysis
        land in a later slice.
      </p>
      <div className="mt-3 space-y-3">
        {events.length === 0 && (
          <p className="text-xs text-slate-500">
            No schedule imported for this case. Export the schedule from P6 as
            CSV and load it as “Schedule activities (P6)” on the{" "}
            <Link
              to="/pm-programme"
              className="text-signal-cyan hover:underline"
            >
              data import page
            </Link>
            , naming this case in the case_title column — activities and their
            dependencies land here.
          </p>
        )}
        {events.map((ev) => (
          <div
            key={ev.id}
            className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-200">{ev.title}</span>
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                {ev.status}
              </span>
              <span className="text-slate-500">
                {ev.activities.length} activit
                {ev.activities.length === 1 ? "y" : "ies"}
              </span>
            </div>
            {ev.activities.length === 0 && (
              <p className="mt-1 text-slate-500">
                The schedule exists but holds no activities — every row of its
                upload was refused. The import page keeps each refusal with its
                reason.
              </p>
            )}
            {ev.activities.slice(0, ACTIVITY_RENDER_CAP).map((a) => (
              <div
                key={a.activityId}
                className="mt-1.5 border-t border-white/5 pt-1.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-slate-400">
                    {a.activityId}
                  </span>
                  <span className="text-slate-200">{a.description}</span>
                  {a.wbsPath && (
                    <span className="font-mono text-[10px] text-slate-500">
                      {a.wbsPath}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {a.durationHours}h
                  {a.plannedStart && a.plannedFinish && (
                    <>
                      {" · "}
                      {new Date(a.plannedStart).toLocaleDateString()} →{" "}
                      {new Date(a.plannedFinish).toLocaleDateString()}
                    </>
                  )}
                  {a.calendar && <> · calendar {a.calendar}</>}
                  {a.predecessors.length > 0 && (
                    <>
                      {" · after "}
                      <span className="font-mono">
                        {a.predecessors.join(", ")}
                      </span>
                    </>
                  )}
                </p>
              </div>
            ))}
            {ev.activities.length > ACTIVITY_RENDER_CAP && (
              <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[11px] text-slate-500">
                …and {ev.activities.length - ACTIVITY_RENDER_CAP} more imported
                activities not shown here.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OperationalReadinessSection({
  caseId,
  canPlan,
}: {
  caseId: string;
  canPlan: boolean;
}) {
  const [result, setResult] = useState<OperationalReadinessResult | null>(null);
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
                    (
                    {b.kind === "safety_mission_critical"
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
        <OperationalReadinessIndexSection caseId={caseId} canPlan={canPlan} />
        <SystemOperationalReadinessSection
          caseId={caseId}
          canPlan={canPlan}
        />
      </div>
    </div>
  );
}

function OperationalReadinessIndexSection({
  caseId,
  canPlan,
}: {
  caseId: string;
  canPlan: boolean;
}) {
  const [model, setModel] = useState<OperationalReadinessIndexResult | null>(null);
  const [catalog, setCatalog] = useState<
    Awaited<ReturnType<typeof listOperationalReadinessCatalog>>
  >([]);
  const [evidence, setEvidence] = useState<
    Array<{ id: string; description: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, items, sources] = await Promise.all([
        getCaseOperationalReadinessIndex(caseId),
        listOperationalReadinessCatalog(),
        listOrgEvidenceItems(),
      ]);
      setModel(next);
      setCatalog(items);
      setEvidence(sources);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Readiness index read failed");
    }
  }, [caseId]);
  useEffect(() => void load(), [load]);

  const draft = model?.profiles.find((profile) => profile.status === "draft");
  const adopted = model?.profiles.find((profile) => profile.status === "adopted");
  const editing = draft ?? adopted;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await saveCaseOperationalReadinessIndexProfile({
        caseId,
        profileId: draft?.profileId,
        factors: ORI_FACTORS.map(({ key }) => ({
          key,
          weight: Number(data.get(`weight_${key}`)),
          categories: data.getAll(`categories_${key}`).map(String),
        })),
        hardRequirementKeys: data.getAll("hardRequirementKeys").map(String),
        basis: String(data.get("basis") ?? ""),
        evidenceItemId: String(data.get("evidenceItemId") ?? ""),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Index policy save refused");
    } finally {
      setBusy(false);
    }
  }

  async function adopt() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await adoptCaseOperationalReadinessIndexProfile(draft.profileId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Index policy adoption refused");
    } finally {
      setBusy(false);
    }
  }

  const calculation = model?.calculation;
  return (
    <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-200">Operational Readiness Index</h3>
          <p className="mt-1 max-w-3xl text-[11px] text-slate-500">
            Nine explicitly weighted factors over the system-scoped readiness record. Open safety or selected hard conditions force BLOCKED regardless of the weighted percentage. This is decision support only and cannot accept handover.
          </p>
        </div>
        {calculation?.index != null && (
          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${calculation.status === "BLOCKED" ? "border-red-400/30 text-red-300" : "border-signal-cyan/30 text-signal-cyan"}`}>
            {calculation.index}% · {calculation.status}
          </span>
        )}
      </div>
      <ErrorLine error={error} />
      {calculation?.error && (
        <p className="rounded border border-amber-400/20 bg-amber-400/5 px-2.5 py-2 text-[11px] text-amber-200">{calculation.error}</p>
      )}
      {calculation?.factors && (
        <div className="grid gap-2 md:grid-cols-3">
          {calculation.factors.map((factor) => (
            <div key={factor.key} className="rounded border border-white/6 bg-white/[0.02] p-2 text-[11px] text-slate-400">
              <div className="flex justify-between"><span className="font-semibold text-slate-200">{factor.key.replaceAll("_", " ")}</span><span>weight {factor.weight}</span></div>
              <div className="mt-1">{factor.percent == null ? "No scoped inputs" : `${factor.percent}% · ${factor.satisfied}/${factor.total}`}</div>
            </div>
          ))}
        </div>
      )}
      {(calculation?.hardBlockers?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-red-300">{calculation?.hardBlockerCount} hard condition(s) open — weighted score overridden</p>
          <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
            {calculation?.hardBlockers?.map((blocker) => (
              <li key={`${blocker.systemId}-${blocker.itemId}`} className="rounded border border-red-400/20 bg-red-400/5 px-2 py-1 text-[11px] text-red-200">
                {blocker.systemRef} · {blocker.assetTag ?? blocker.asset} · {blocker.item} · {blocker.kind.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {adopted && <p className="text-[11px] text-slate-500">Adopted policy v{adopted.version}: {adopted.basis}</p>}
      {canPlan && (
        <form key={draft?.profileId ?? `new-${adopted?.profileId ?? "none"}`} onSubmit={save} className="space-y-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
          <div>
            <p className="text-xs font-semibold text-slate-200">{draft ? `Edit draft policy v${draft.version}` : adopted ? `Create policy v${adopted.version + 1} from the adopted position` : "Author the first index policy"}</p>
            <p className="mt-1 text-[11px] text-slate-500">Assign every readiness category to exactly one factor and state each weight. No defaults are supplied or silently inferred.</p>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {ORI_FACTORS.map(({ key, label }) => {
              const current = editing?.factors.find((factor) => factor.key === key);
              return <div key={key} className="rounded border border-white/6 p-2">
                <label className="text-[11px] font-semibold text-slate-200">{label} weight
                  <input name={`weight_${key}`} type="number" min="0.01" step="0.01" required defaultValue={current?.weight ?? ""} className={`${inputClass} mt-1`} />
                </label>
                <label className="mt-2 block text-[11px] text-slate-400">Assigned categories
                  <select name={`categories_${key}`} multiple required defaultValue={current?.categories ?? []} className={`${inputClass} mt-1 h-28`}>
                    {[...new Set(catalog.map((item) => item.ori_category))].map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}
                  </select>
                </label>
              </div>;
            })}
          </div>
          <label className="block text-[11px] text-slate-400">Hard-condition catalog items
            <select name="hardRequirementKeys" multiple required defaultValue={editing?.hardRequirementKeys ?? []} className={`${inputClass} mt-1 h-36`}>
              {catalog.map((item) => <option key={item.key} value={item.key}>{item.ori_category.replaceAll("_", " ")} · {item.item_label}</option>)}
            </select>
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <select name="evidenceItemId" required defaultValue={editing?.evidenceItemId ?? ""} className={inputClass}><option value="" disabled>Policy evidence…</option>{evidence.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}</select>
            <textarea name="basis" required minLength={20} defaultValue={editing?.basis ?? ""} className={inputClass} placeholder="Why these weights, assignments, and hard conditions are appropriate (20+ characters)" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="rounded border border-signal-cyan/20 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50">{busy ? "Saving…" : draft ? "Save draft" : "Create draft"}</button>
            {draft && <button type="button" onClick={() => void adopt()} disabled={busy} className="rounded border border-emerald-400/20 px-3 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-50">Adopt this policy</button>}
          </div>
        </form>
      )}
    </div>
  );
}

function SystemOperationalReadinessSection({
  caseId,
  canPlan,
}: {
  caseId: string;
  canPlan: boolean;
}) {
  const [model, setModel] = useState<SystemOperationalReadinessResult | null>(
    null,
  );
  const [designOrigins, setDesignOrigins] =
    useState<SystemReadinessDesignOriginsResult | null>(null);
  const [requirements, setRequirements] = useState<
    Awaited<ReturnType<typeof listCaseRequirements>>
  >([]);
  const [catalog, setCatalog] = useState<
    Awaited<ReturnType<typeof listOperationalReadinessCatalog>>
  >([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [evidence, setEvidence] = useState<
    Array<{ id: string; description: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [next, origins, people, sources, caseRequirements, readinessCatalog] = await Promise.all([
        getCaseSystemOperationalReadiness(caseId),
        getCaseSystemReadinessDesignOrigins(caseId),
        listOrgMembers(),
        listOrgEvidenceItems(),
        listCaseRequirements(caseId),
        listOperationalReadinessCatalog(),
      ]);
      setModel(next);
      setDesignOrigins(origins);
      setMembers(people);
      setEvidence(sources);
      setRequirements(caseRequirements);
      setCatalog(readinessCatalog);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "System readiness read failed",
      );
    }
  }, [caseId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function initialize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await initializeCommissioningSystemReadiness({
        systemId: Number(data.get("systemId")),
        ownerId: String(data.get("ownerId") ?? ""),
        requiredBefore: String(data.get("requiredBefore") ?? ""),
        basis: String(data.get("basis") ?? ""),
        basisEvidenceItemId: String(data.get("basisEvidenceItemId") ?? ""),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Assignment refused");
    } finally {
      setBusy(false);
    }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await recordSystemOperationalReadinessItem({
        systemId: Number(data.get("systemId")),
        itemId: String(data.get("itemId") ?? ""),
        status: String(data.get("status")) as
          | "human_provided"
          | "not_applicable",
        evidenceItemId: String(data.get("evidenceItemId") ?? ""),
        note: String(data.get("note") ?? ""),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Outcome refused");
    } finally {
      setBusy(false);
    }
  }

  async function connectDesignRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await recordSystemReadinessDesignOrigin({
        systemId: Number(data.get("systemId")),
        designRequirementId: Number(data.get("designRequirementId")),
        onboardingRequirementKey: String(
          data.get("onboardingRequirementKey") ?? "",
        ),
        ownerId: String(data.get("ownerId") ?? ""),
        requiredBefore: String(data.get("requiredBefore") ?? ""),
        mappingBasis: String(data.get("mappingBasis") ?? ""),
        mappingEvidenceItemId: String(
          data.get("mappingEvidenceItemId") ?? "",
        ),
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Design-to-readiness connection refused",
      );
    } finally {
      setBusy(false);
    }
  }

  const scopedItems =
    model?.systems.flatMap((system) =>
      system.items.map((item) => ({ system, item })),
    ) ?? [];
  return (
    <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
      <div>
        <h3 className="text-xs font-semibold text-slate-200">
          Commissioning-system readiness
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          The same asset-onboarding items, scoped to each commissioning system
          with a named owner, required-before date, and completion evidence.
          This records readiness only; it does not accept handover or authorize
          energization.
        </p>
      </div>
      <ErrorLine error={error} />
      {model?.systems.map((system) => (
        <div
          key={system.systemId}
          className="rounded-lg border border-white/8 bg-white/[0.02] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-200">
              {system.systemRef} — {system.title}
            </span>
            <span className="text-slate-400">
              {system.satisfiedCount}/{system.itemCount} evidenced ·{" "}
              {system.overdueOpenCount} overdue
            </span>
          </div>
          {system.assetCount === 0 && (
            <p className="mt-1 text-[11px] text-amber-300">
              Bind at least one asset in the Commissioning section before
              assigning readiness items.
            </p>
          )}
          {system.items.length > 0 && (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {system.items.map((item) => (
                <li
                  key={item.scopeId}
                  className={`rounded border px-2 py-1 text-[11px] ${item.overdue ? "border-red-400/25 text-red-200" : "border-white/5 text-slate-400"}`}
                >
                  {item.assetTag ?? item.asset}: {item.item} · {item.owner ?? "owner unavailable"} · due {item.requiredBefore} · {item.status.replaceAll("_", " ")}
                  {!item.evidenceReady && " · evidence missing"}
                </li>
              ))}
            </ul>
          )}
          {designOrigins?.systems
            .find((candidate) => candidate.systemId === system.systemId)
            ?.origins.map((origin) => (
              <div
                key={origin.originId}
                className="mt-2 rounded border border-signal-cyan/15 bg-signal-cyan/5 px-2 py-1.5 text-[11px] text-slate-300"
              >
                <span className="font-semibold text-signal-cyan">
                  {origin.requirementRef}
                </span>{" "}
                → {origin.readinessCategory.replaceAll("_", " ")} ·{" "}
                {origin.readinessItem} · {origin.materializedItemCount}/
                {system.assetCount} asset item(s)
                {!origin.fullyMaterialized && " · awaiting bound assets"}
              </div>
            ))}
        </div>
      ))}
      {canPlan && model && model.systems.length > 0 && requirements.length > 0 && (
        <form
          onSubmit={connectDesignRequirement}
          className="grid gap-2 rounded-lg border border-signal-cyan/15 bg-signal-cyan/5 p-3 md:grid-cols-2"
        >
          <div className="md:col-span-2">
            <p className="text-xs font-semibold text-slate-200">
              Start readiness from a design requirement
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              A named human selects the exact existing catalog obligation. SyncAI
              creates open canonical items for every bound asset now and for assets
              bound later; it never guesses a mapping or marks an item complete.
            </p>
          </div>
          <select name="systemId" required className={inputClass} defaultValue="">
            <option value="" disabled>Commissioning system…</option>
            {model.systems.map((system) => <option key={system.systemId} value={system.systemId}>{system.systemRef} — {system.title}</option>)}
          </select>
          <select name="designRequirementId" required className={inputClass} defaultValue="">
            <option value="" disabled>Design requirement…</option>
            {requirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.requirement_ref} · {requirement.category} · {requirement.requirement}</option>)}
          </select>
          <select name="onboardingRequirementKey" required className={`${inputClass} md:col-span-2`} defaultValue="">
            <option value="" disabled>Exact operational-readiness catalog item…</option>
            {catalog.map((item) => <option key={item.key} value={item.key}>{item.ori_category.replaceAll("_", " ")} · {item.item_label}</option>)}
          </select>
          <select name="ownerId" required className={inputClass} defaultValue="">
            <option value="" disabled>Named readiness owner…</option>
            {members.filter((member) => member.role !== "ai_admin").map((member) => <option key={member.id} value={member.id}>{member.full_name ?? member.email ?? member.id}</option>)}
          </select>
          <input name="requiredBefore" required type="date" className={inputClass} />
          <select name="mappingEvidenceItemId" required className={`${inputClass} md:col-span-2`} defaultValue="">
            <option value="" disabled>Mapping evidence…</option>
            {evidence.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}
          </select>
          <textarea name="mappingBasis" required minLength={20} className={`${inputClass} md:col-span-2`} placeholder="Why this design requirement creates this exact readiness obligation (20+ characters)" />
          <button disabled={busy} className="rounded border border-signal-cyan/20 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50">Create canonical readiness items</button>
        </form>
      )}
      {canPlan && model && model.systems.length > 0 && (
        <form onSubmit={initialize} className="grid gap-2 md:grid-cols-2">
          <select name="systemId" required className={inputClass} defaultValue="">
            <option value="" disabled>Commissioning system…</option>
            {model.systems.map((system) => <option key={system.systemId} value={system.systemId}>{system.systemRef} — {system.title}</option>)}
          </select>
          <select name="ownerId" required className={inputClass} defaultValue="">
            <option value="" disabled>Named readiness owner…</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.full_name ?? member.email ?? member.id}</option>)}
          </select>
          <input name="requiredBefore" required type="date" className={inputClass} />
          <select name="basisEvidenceItemId" required className={inputClass} defaultValue="">
            <option value="" disabled>Assignment evidence…</option>
            {evidence.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}
          </select>
          <input name="basis" required minLength={20} className={`${inputClass} md:col-span-2`} placeholder="Assignment basis (20+ characters)" />
          <button disabled={busy} className="rounded border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">Assign canonical readiness items</button>
        </form>
      )}
      {canPlan && scopedItems.length > 0 && (
        <form onSubmit={complete} className="grid gap-2 md:grid-cols-2">
          <select name="itemRef" required className={`${inputClass} md:col-span-2`} defaultValue="" onChange={(event) => {
            const [systemId, itemId] = event.target.value.split(":");
            const form = event.currentTarget.form;
            if (form) { (form.elements.namedItem("systemId") as HTMLInputElement).value = systemId; (form.elements.namedItem("itemId") as HTMLInputElement).value = itemId; }
          }}>
            <option value="" disabled>Readiness item to evidence…</option>
            {scopedItems.filter(({ item }) => !item.evidenceReady).map(({ system, item }) => <option key={item.scopeId} value={`${system.systemId}:${item.itemId}`}>{system.systemRef} · {item.assetTag ?? item.asset} · {item.item}</option>)}
          </select>
          <input type="hidden" name="systemId" /><input type="hidden" name="itemId" />
          <select name="status" required className={inputClass} defaultValue="human_provided"><option value="human_provided">Evidence provided</option><option value="not_applicable">Not applicable, evidenced</option></select>
          <select name="evidenceItemId" required className={inputClass} defaultValue=""><option value="" disabled>Completion evidence…</option>{evidence.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}</select>
          <textarea name="note" required minLength={20} className={`${inputClass} md:col-span-2`} placeholder="Human readiness determination (20+ characters)" />
          <button disabled={busy} className="rounded border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">Record evidenced outcome</button>
        </form>
      )}
      {model && <p className="text-[10px] text-slate-600">Canonical store: {model.readinessStore}. {designOrigins?.decisionBoundary ?? model.decisionBoundary}</p>}
    </div>
  );
}
