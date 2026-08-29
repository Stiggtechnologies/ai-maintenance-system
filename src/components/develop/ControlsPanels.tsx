/**
 * Sync Develop Slice 4A — the §44 Integrated Controls sections of the Case
 * Workspace: the scope architecture chain (D5.01), its traceability gaps
 * (D5.02), post-baseline scope cost attribution (D5.03), the eleven controls
 * baseline structures (D5.04), ScheduleActivity with P6 as system of record
 * (D5.28), CostItem (D5.29) and the calculation lineage every controls
 * number carries (D11.29).
 *
 * HONESTY RULES, inherited from the page these mount on and sharpened here:
 *
 *   * THE GAPS ARE THE PRODUCT. This surface renders
 *     get_case_scope_traceability's arrays VERBATIM — the same function
 *     compute_case_scope_growth records its refusals from. It never draws a
 *     tidy tree with the broken links omitted, and it never summarises a
 *     list of gaps into a single green tick.
 *
 *   * NO MONEY FIGURE WITHOUT LINEAGE. The two computed figures on this
 *     page — scope growth and the cost reconciliation — are rendered from a
 *     RECORDED calculation_runs row and from nothing else. get_case_controls
 *     also embeds the LIVE reads of both; those record nothing, so they are
 *     used here only for their REFUSALS (which are statements, not figures),
 *     for the row listings, and to detect that a recorded run's inputs have
 *     moved. Rendering the read's number under a lineage block describing an
 *     older run is how a page ends up showing two different answers to one
 *     question and calling one the provenance of the other.
 *
 *   * A STALE RUN SAYS SO. A recorded figure stays defensible for ever and
 *     stops being current the moment its inputs change; the run carries the
 *     same fingerprint the live read produces, so the gap is detectable
 *     without computing a second number.
 *
 *   * REFUSALS RENDER VERBATIM, in place of the number, never beside a
 *     blank. "This case has no approved SCOPE baseline…" is the answer to
 *     "what did scope growth cost", not an error state.
 *
 *   * P6 OWNS WHAT IT EXPORTED. An imported activity shows its origin and
 *     its verbatim P6 wbs_path; the only edit this surface offers on one is
 *     resolving the WBS element, which is Sync's own column. There is no
 *     control here that would write back to P6, because none exists.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarClock,
  Coins,
  FileStack,
  GitCompareArrows,
  Layers,
  Network,
  Scale,
  SquareStack,
} from "lucide-react";
import {
  CBS_COST_TYPES,
  CONTROLS_CALC_VERSION,
  NEED_SOURCE_AUTHORITIES,
  SCOPE_CHANGE_ORIGINS,
  capturableStructures,
  costReconciliationFingerprint,
  costReconciliationHeadline,
  costReconciliationOutputs,
  driftedStructures,
  emptyGapSentence,
  formatMoney,
  hasDisplayableOutputs,
  runIsStale,
  scopeGrowthFingerprint,
  scopeGrowthHeadline,
  traceabilityHeadline,
  uncodedActivitiesByOrigin,
  type CalculationRun,
  type CaseControls,
  type CostReconciliation,
  type ScopeGrowth,
} from "../../lib/develop/controls";
import {
  attributePostBaselineScope,
  captureControlsBaselineStructure,
  computeCaseCostReconciliation,
  computeCaseScopeGrowth,
  designateControlAccount,
  getCaseCalculationLineage,
  getCaseControls,
  linkRequirementToNeed,
  linkRequirementToWbs,
  listCaseBaselines,
  listCaseRequirements,
  recordCbsCode,
  recordCostItem,
  recordLocalScheduleActivity,
  recordScopeNeed,
  recordWbsElement,
  setScheduleActivityWbs,
  setScopeNeedStatus,
  type OrgMember,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

function Refusal({ text }: { text: string }) {
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

/**
 * Money is rendered with its own unit or not as money at all. The default of
 * "CAD" this used to carry printed a USD figure under a CAD symbol whenever
 * the currency was absent or ambiguous.
 */
function money(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  return formatMoney(value, currency);
}

/**
 * A gap list. An EMPTY list renders its own sentence, never nothing — and the
 * sentence depends on the DENOMINATOR: "every requirement is delivered by at
 * least one WBS element" over a case with no requirements is reassurance
 * about an empty set, which is exactly the tidy-tree reading D5.02 exists to
 * prevent.
 */
function GapList({
  title,
  denominator,
  nothingRecorded,
  empty,
  rows,
}: {
  title: string;
  denominator: number;
  nothingRecorded: string;
  empty: string;
  rows: { key: string; primary: string; secondary?: string | null }[];
}) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title} · {rows.length}
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          {emptyGapSentence(denominator, nothingRecorded, empty)}
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="text-xs text-slate-300">
              <span className="font-mono text-slate-200">{r.primary}</span>
              {r.secondary ? (
                <span className="text-slate-500"> — {r.secondary}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The lineage of one displayed number, openable beside it. */
function LineageBlock({ run }: { run: CalculationRun | undefined }) {
  if (run == null) {
    return (
      <p className="text-[11px] text-slate-500">
        No calculation has been recorded for this figure yet. Nothing is shown
        above that was not computed and recorded — press Compute to produce one.
      </p>
    );
  }
  return (
    <details className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Lineage · {run.codeVersion} ·{" "}
        {new Date(run.computedAt).toLocaleString()}
      </summary>
      <div className="mt-2 space-y-1 text-xs text-slate-400">
        <p>
          <span className="text-slate-500">Method: </span>
          {run.method}
        </p>
        <p>
          <span className="text-slate-500">Computed by: </span>
          {run.computedBy ?? "system"} · status {run.status}
        </p>
        <p className="font-mono text-[11px] text-slate-500">
          inputs {JSON.stringify(run.inputs)}
        </p>
        <p className="text-[11px] text-slate-500">
          {run.inputRefs.length} input row(s) referenced
        </p>
        {run.refusals.length > 0 && (
          <ul className="space-y-1">
            {run.refusals.map((r, i) => (
              <li key={i} className="text-amber-200">
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/* ─────────────────────────── scope architecture ──────────────────────── */

function ScopeArchitectureSection({
  caseId,
  controls,
  members,
  canPlan,
  onChanged,
}: {
  caseId: string;
  controls: CaseControls;
  members: OrgMember[];
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [needRef, setNeedRef] = useState("");
  const [needStatement, setNeedStatement] = useState("");
  const [needOwner, setNeedOwner] = useState("");
  const [needAuthority, setNeedAuthority] =
    useState<string>("PROJECT_FRAMEWORK");
  const [wbsCode, setWbsCode] = useState("");
  const [wbsTitle, setWbsTitle] = useState("");
  const [wbsScope, setWbsScope] = useState("");
  const [wbsParent, setWbsParent] = useState("");
  const [wbsSystem, setWbsSystem] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [cbsCode, setCbsCode] = useState("");
  const [cbsTitle, setCbsTitle] = useState("");
  const [cbsType, setCbsType] = useState<string>("labour");
  const [caRef, setCaRef] = useState("");
  const [caWbs, setCaWbs] = useState("");
  const [caCbs, setCaCbs] = useState("");
  const [caOwner, setCaOwner] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, reset: () => void) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      reset();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The write was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Network className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Scope architecture"
      subtitle="Business need → requirement → system → WBS → … → control account (spec I.6). Work package and contract are Slices 7 and 6 and are shown as holes in the chain, not omitted from it."
    >
      <ErrorLine error={error} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Business needs · {controls.needs.length}
          </p>
          {controls.needs.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              No business need is recorded. Every requirement on this case is an
              orphan until one is.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {controls.needs.map((n) => (
                <li key={n.id} className="text-slate-300">
                  <span className="font-mono text-slate-200">{n.needRef}</span>{" "}
                  {n.statement}
                  <span className="text-slate-500">
                    {" "}
                    · {n.sourceAuthority} · {n.status} · {n.requirementCount}{" "}
                    requirement(s) · {n.owner ?? "no owner"}
                  </span>
                  {canPlan && n.status === "open" && (
                    <span className="ml-2 inline-flex gap-2">
                      <button
                        className="text-[11px] text-signal-cyan hover:underline disabled:opacity-40"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              setScopeNeedStatus({
                                needId: n.id,
                                status: "met",
                              }),
                            () => undefined,
                          )
                        }
                      >
                        mark met
                      </button>
                      <button
                        className="text-[11px] text-amber-200 hover:underline disabled:opacity-40"
                        type="button"
                        disabled={busy || withdrawReason.trim().length < 10}
                        title="Withdrawing a need un-traces every requirement that rested on it, so a reason is required."
                        onClick={() =>
                          void run(
                            () =>
                              setScopeNeedStatus({
                                needId: n.id,
                                status: "withdrawn",
                                reason: withdrawReason,
                              }),
                            () => setWithdrawReason(""),
                          )
                        }
                      >
                        withdraw
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canPlan && controls.needs.some((n) => n.status === "open") && (
            <input
              className={`${inputClass} mt-2`}
              placeholder="Reason, if withdrawing a need (10 characters minimum)"
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
            />
          )}
        </div>

        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            WBS · {controls.wbs.length}
          </p>
          {controls.wbs.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              No WBS element is recorded, so no cost line and no schedule
              activity on this case can be coded to authorized scope.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {controls.wbs.map((w) => (
                <li key={w.id} className="text-slate-300">
                  <span
                    className="font-mono text-slate-200"
                    style={{ paddingLeft: `${(w.depth - 1) * 10}px` }}
                  >
                    {w.wbsCode}
                  </span>{" "}
                  {w.title}
                  <span className="text-slate-500">
                    {" "}
                    · {w.requirementCount} req · {w.activityCount} activity ·{" "}
                    {w.costItemCount} cost ·{" "}
                    {w.controlAccountRef ?? "no control account"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            CBS · {controls.cbs.length}
          </p>
          {controls.cbs.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              No cost breakdown code is recorded — a cost line has nothing to
              collect under.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-slate-300">
              {controls.cbs.map((b) => (
                <li key={b.id}>
                  <span className="font-mono text-slate-200">{b.cbsCode}</span>{" "}
                  {b.title}
                  <span className="text-slate-500"> · {b.costType}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Control accounts · {controls.controlAccounts.length}
          </p>
          {controls.controlAccounts.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              No control account is designated, so no scope on this case has a
              cost collection point or a named accountable owner.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-slate-300">
              {controls.controlAccounts.map((ca) => (
                <li key={ca.id}>
                  <span className="font-mono text-slate-200">
                    {ca.controlAccountRef}
                  </span>{" "}
                  WBS {ca.wbsCode} · CBS {ca.cbsCode}
                  <span className="text-slate-500">
                    {" "}
                    · {ca.accountableOwner ?? "no owner"} · {ca.costItemCount}{" "}
                    line(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {canPlan && (
        <div className="grid gap-3 md:grid-cols-2">
          <form
            className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  recordScopeNeed({
                    caseId,
                    needRef,
                    statement: needStatement,
                    ownerId: needOwner,
                    sourceAuthority: needAuthority,
                  }),
                () => {
                  setNeedRef("");
                  setNeedStatement("");
                },
              );
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Record a business need
            </p>
            <input
              className={inputClass}
              placeholder="Reference (N-01)"
              value={needRef}
              onChange={(e) => setNeedRef(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="What the business needs to be true"
              value={needStatement}
              onChange={(e) => setNeedStatement(e.target.value)}
            />
            <select
              className={inputClass}
              value={needOwner}
              onChange={(e) => setNeedOwner(e.target.value)}
            >
              <option value="">Owner…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name ?? m.email}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={needAuthority}
              onChange={(e) => setNeedAuthority(e.target.value)}
            >
              {NEED_SOURCE_AUTHORITIES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button className={btnClass} disabled={busy} type="submit">
              Record need
            </button>
          </form>

          <form
            className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  recordWbsElement({
                    caseId,
                    wbsCode,
                    title: wbsTitle,
                    scopeDescription: wbsScope,
                    parentWbsCode: wbsParent || null,
                    systemNodeId: wbsSystem || null,
                  }),
                () => {
                  setWbsCode("");
                  setWbsTitle("");
                  setWbsScope("");
                },
              );
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Record a WBS element
            </p>
            <input
              className={inputClass}
              placeholder="WBS code (1.2.1)"
              value={wbsCode}
              onChange={(e) => setWbsCode(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Title"
              value={wbsTitle}
              onChange={(e) => setWbsTitle(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="What is IN this element"
              value={wbsScope}
              onChange={(e) => setWbsScope(e.target.value)}
            />
            <select
              className={inputClass}
              value={wbsParent}
              onChange={(e) => setWbsParent(e.target.value)}
            >
              <option value="">No parent (root element)</option>
              {controls.wbs.map((w) => (
                <option key={w.id} value={w.wbsCode}>
                  {w.wbsCode} — {w.title}
                </option>
              ))}
            </select>
            {/* The chain's SYSTEM link (spec I.6). Optional by design — not
                every element serves a single system — but it has to be
                REACHABLE, or reporting the link as built is a claim about
                machinery no user can use. */}
            <select
              className={inputClass}
              value={wbsSystem}
              onChange={(e) => setWbsSystem(e.target.value)}
            >
              <option value="">
                {controls.systemNodes.length === 0
                  ? "No system node exists in this organization's tree yet"
                  : "No system (this element serves no single system)"}
              </option>
              {controls.systemNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <button className={btnClass} disabled={busy} type="submit">
              Record WBS element
            </button>
          </form>

          <form
            className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  recordCbsCode({
                    caseId,
                    cbsCode,
                    title: cbsTitle,
                    costType: cbsType,
                  }),
                () => {
                  setCbsCode("");
                  setCbsTitle("");
                },
              );
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Record a CBS code
            </p>
            <input
              className={inputClass}
              placeholder="CBS code (C-2100)"
              value={cbsCode}
              onChange={(e) => setCbsCode(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="What it collects"
              value={cbsTitle}
              onChange={(e) => setCbsTitle(e.target.value)}
            />
            <select
              className={inputClass}
              value={cbsType}
              onChange={(e) => setCbsType(e.target.value)}
            >
              {CBS_COST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button className={btnClass} disabled={busy} type="submit">
              Record CBS code
            </button>
          </form>

          <form
            className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  designateControlAccount({
                    caseId,
                    controlAccountRef: caRef,
                    wbsCode: caWbs,
                    cbsCode: caCbs,
                    accountableOwnerId: caOwner,
                  }),
                () => setCaRef(""),
              );
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Designate a control account
            </p>
            <input
              className={inputClass}
              placeholder="Reference (CA-01)"
              value={caRef}
              onChange={(e) => setCaRef(e.target.value)}
            />
            <select
              className={inputClass}
              value={caWbs}
              onChange={(e) => setCaWbs(e.target.value)}
            >
              <option value="">WBS element…</option>
              {controls.wbs.map((w) => (
                <option key={w.id} value={w.wbsCode}>
                  {w.wbsCode} — {w.title}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={caCbs}
              onChange={(e) => setCaCbs(e.target.value)}
            >
              <option value="">CBS code…</option>
              {controls.cbs.map((b) => (
                <option key={b.id} value={b.cbsCode}>
                  {b.cbsCode} — {b.title}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={caOwner}
              onChange={(e) => setCaOwner(e.target.value)}
            >
              <option value="">Accountable owner…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name ?? m.email}
                </option>
              ))}
            </select>
            <button className={btnClass} disabled={busy} type="submit">
              Designate control account
            </button>
          </form>
        </div>
      )}
    </Section>
  );
}

/* ───────────────────── traceability gaps (the predicate) ─────────────── */

function TraceabilitySection({
  caseId,
  controls,
  canPlan,
  onChanged,
}: {
  caseId: string;
  controls: CaseControls;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const trace = controls.traceability;
  const [requirements, setRequirements] = useState<
    { id: number; requirement_ref: string; scope_need_id: string | null }[]
  >([]);
  const [reqId, setReqId] = useState("");
  const [needId, setNeedId] = useState("");
  const [wbsId, setWbsId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uncoded = useMemo(() => uncodedActivitiesByOrigin(trace), [trace]);

  useEffect(() => {
    void listCaseRequirements(caseId)
      .then(setRequirements)
      .catch(() => setRequirements([]));
  }, [caseId, controls]);

  const link = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The link was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<GitCompareArrows className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Scope traceability"
      subtitle="Where the chain does not join, in both directions. This is the same predicate the scope-growth calculation records its refusals from — what is displayed and what the server refuses over cannot differ."
    >
      <p className="text-sm text-slate-200">{traceabilityHeadline(trace)}</p>

      <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
        {trace.chain.map((link) => (
          <span
            key={link.link}
            className={`rounded-full px-2 py-0.5 ${
              link.built
                ? "bg-white/5 text-slate-300"
                : "bg-amber-400/10 text-amber-200"
            }`}
            title={
              link.deferral ??
              (link.optional
                ? `${link.home} — optional: not every element serves a single system, so a count of 0 here is not a gap`
                : link.home)
            }
          >
            {link.link}
            {link.built ? ` · ${link.count}` : " · not built"}
            {link.built && link.optional ? " · optional" : ""}
          </span>
        ))}
      </div>
      {trace.chain
        .filter((link) => link.deferral)
        .map((link) => (
          <Refusal key={link.link} text={`${link.link}: ${link.deferral}`} />
        ))}

      <div className="grid gap-2 md:grid-cols-2">
        <GapList
          title="Needs with no requirement"
          denominator={trace.totals.needs}
          nothingRecorded="No business need is recorded on this case, so there is nothing to implement yet."
          empty="Every recorded need has at least one requirement behind it."
          rows={trace.forwardGaps.needsWithoutRequirement.map((n) => ({
            key: n.needId,
            primary: n.needRef,
            secondary: n.statement,
          }))}
        />
        <GapList
          title="Requirements not in the WBS"
          denominator={trace.totals.requirements}
          nothingRecorded="No requirement is recorded on this case, so nothing traces into the WBS yet."
          empty="Every requirement is delivered by at least one WBS element."
          rows={trace.forwardGaps.requirementsWithoutWbs.map((r) => ({
            key: String(r.requirementId),
            primary: r.requirementRef,
            secondary: r.requirement,
          }))}
        />
        <GapList
          title="WBS branches with no control account"
          denominator={trace.totals.wbsElements}
          nothingRecorded="No WBS element is recorded on this case, so no branch collects cost yet."
          empty="Every WBS branch collects cost at a control account."
          rows={trace.forwardGaps.wbsElementsWithoutControlAccount.map((w) => ({
            key: w.wbsElementId,
            primary: w.wbsCode,
            secondary: w.title,
          }))}
        />
        <GapList
          title="Requirements with no business need (orphan)"
          denominator={trace.totals.requirements}
          nothingRecorded="No requirement is recorded on this case, so none can be an orphan yet."
          empty="Every requirement traces back to a recorded need that is still open."
          rows={trace.orphans.requirementsWithoutNeed.map((r) => ({
            key: String(r.requirementId),
            primary: r.requirementRef,
            secondary: r.withdrawnNeedRef
              ? `${r.requirement} — traced to ${r.withdrawnNeedRef}, which has been withdrawn`
              : r.requirement,
          }))}
        />
        <GapList
          title="WBS elements no requirement reaches (orphan)"
          denominator={trace.totals.wbsElements}
          nothingRecorded="No WBS element is recorded on this case, so none can be an orphan yet."
          empty="Every WBS element delivers something somebody required."
          rows={trace.orphans.wbsElementsWithoutRequirement.map((w) => ({
            key: w.wbsElementId,
            primary: w.wbsCode,
            secondary: w.title,
          }))}
        />
        <GapList
          title={`Schedule activities with no authorized scope (${uncoded.imported} imported, ${uncoded.local} local)`}
          denominator={trace.totals.scheduleActivities}
          nothingRecorded="No schedule activity is recorded on this case — nothing has been imported from P6 and nothing authored here."
          empty="Every activity on this case is coded to a WBS element."
          rows={trace.orphans.scheduleActivitiesWithoutScope.map((a) => ({
            key: String(a.activityId),
            primary: a.activityKey,
            secondary: `${a.label} · ${a.origin}${a.wbsPath ? ` · P6 path ${a.wbsPath}` : ""}`,
          }))}
        />
        <GapList
          title="Cost lines outside every control account (orphan)"
          denominator={trace.totals.costItems}
          nothingRecorded="No cost line is coded on this case, so no money sits outside a control account yet."
          empty="Every cost line rolls up to a control account."
          rows={trace.orphans.costItemsOutsideAControlAccount.map((ci) => ({
            key: ci.costItemId,
            primary: ci.costItemRef,
            secondary: `${ci.description} · ${money(ci.baselineCost, ci.currency)}`,
          }))}
        />
      </div>

      <p className="text-[11px] text-slate-500">
        Requirements traced to the WBS:{" "}
        {trace.requirementsTracedPct == null
          ? "no requirements recorded, so there is no percentage"
          : `${trace.requirementsTracedPct}%`}{" "}
        · activities with authorized scope:{" "}
        {trace.activitiesWithScopePct == null
          ? "no activities recorded, so there is no percentage"
          : `${trace.activitiesWithScopePct}%`}
      </p>

      {canPlan && (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Close a break in the chain
            </p>
            <select
              className={inputClass}
              value={reqId}
              onChange={(e) => setReqId(e.target.value)}
            >
              <option value="">Requirement…</option>
              {requirements.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.requirement_ref}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <select
                className={inputClass}
                value={needId}
                onChange={(e) => setNeedId(e.target.value)}
              >
                <option value="">Business need…</option>
                {controls.needs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.needRef}
                  </option>
                ))}
              </select>
              <button
                className={btnClass}
                disabled={busy || !reqId || !needId}
                type="button"
                onClick={() =>
                  void link(() =>
                    linkRequirementToNeed({
                      requirementId: Number(reqId),
                      needId,
                    }),
                  )
                }
              >
                Trace requirement to need
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className={inputClass}
                value={wbsId}
                onChange={(e) => setWbsId(e.target.value)}
              >
                <option value="">WBS element…</option>
                {controls.wbs.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.wbsCode} — {w.title}
                  </option>
                ))}
              </select>
              <button
                className={btnClass}
                disabled={busy || !reqId || !wbsId}
                type="button"
                onClick={() =>
                  void link(() =>
                    linkRequirementToWbs({
                      requirementId: Number(reqId),
                      wbsElementId: wbsId,
                    }),
                  )
                }
              >
                Deliver requirement in WBS
              </button>
            </div>
            <ErrorLine error={error} />
          </div>
        </div>
      )}
    </Section>
  );
}

/* ──────────────────────── schedule activities (D5.28) ────────────────── */

function ScheduleActivitySection({
  caseId,
  controls,
  canPlan,
  onChanged,
}: {
  caseId: string;
  controls: CaseControls;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [activityId, setActivityId] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("");
  const [wbsCode, setWbsCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, reset?: () => void) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      reset?.();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The write was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<CalendarClock className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Schedule activities"
      subtitle="P6 remains the system of record for what it exported (spec §22, §77). Sync annotates an imported activity — resolving its WBS element — and never overwrites a P6-owned field. Locally authored activities are marked as such, permanently."
    >
      <ErrorLine error={error} />
      {controls.scheduleActivities.length === 0 ? (
        <p className="text-xs text-slate-500">
          No activity is recorded for this case. Import a P6 CSV on the data
          import page, or author a local activity below — the two stay
          distinguishable.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-1.5 py-1 text-left">Activity</th>
                <th className="px-1.5 py-1 text-left">Origin</th>
                <th className="px-1.5 py-1 text-right">Hours</th>
                <th className="px-1.5 py-1 text-left">P6 WBS path</th>
                <th className="px-1.5 py-1 text-left">Resolved WBS</th>
              </tr>
            </thead>
            <tbody>
              {controls.scheduleActivities.map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="px-1.5 py-1">
                    <span className="font-mono text-slate-200">
                      {a.activityKey}
                    </span>{" "}
                    <span className="text-slate-400">{a.label}</span>
                  </td>
                  <td className="px-1.5 py-1 text-slate-400">
                    {a.origin === "imported"
                      ? `imported · ${a.sourceSystem ?? "P6"}`
                      : "authored in Sync"}
                  </td>
                  <td className="px-1.5 py-1 text-right text-slate-300">
                    {a.durationHours ?? "—"}
                  </td>
                  <td className="px-1.5 py-1 font-mono text-slate-500">
                    {a.wbsPath ?? "—"}
                  </td>
                  <td className="px-1.5 py-1">
                    {canPlan ? (
                      <select
                        className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-xs text-slate-200"
                        value={a.wbsCode ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          void act(() =>
                            setScheduleActivityWbs({
                              activityId: a.id,
                              wbsCode: e.target.value || null,
                            }),
                          )
                        }
                      >
                        <option value="">no authorized scope</option>
                        {controls.wbs.map((w) => (
                          <option key={w.id} value={w.wbsCode}>
                            {w.wbsCode}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-400">
                        {a.wbsCode ?? "no authorized scope"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canPlan && (
        <form
          className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                recordLocalScheduleActivity({
                  caseId,
                  activityId,
                  description,
                  durationHours: duration,
                  wbsCode: wbsCode || null,
                }),
              () => {
                setActivityId("");
                setDescription("");
                setDuration("");
              },
            );
          }}
        >
          <input
            className={inputClass}
            placeholder="Activity id"
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Duration (hours)"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          <select
            className={inputClass}
            value={wbsCode}
            onChange={(e) => setWbsCode(e.target.value)}
          >
            <option value="">No WBS yet</option>
            {controls.wbs.map((w) => (
              <option key={w.id} value={w.wbsCode}>
                {w.wbsCode}
              </option>
            ))}
          </select>
          <button className={btnClass} disabled={busy} type="submit">
            Author local activity
          </button>
        </form>
      )}
    </Section>
  );
}

/* ─────────────────────────── cost items (D5.29) ──────────────────────── */

function CostItemSection({
  caseId,
  controls,
  reconciliation,
  canPlan,
  onChanged,
}: {
  caseId: string;
  controls: CaseControls;
  reconciliation: CostReconciliation;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [ref, setRef] = useState("");
  const [wbsCode, setWbsCode] = useState("");
  const [cbsCode, setCbsCode] = useState("");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState("");
  const [baselineCost, setBaselineCost] = useState("");
  const [commitment, setCommitment] = useState("");
  const [actual, setActual] = useState("");
  const [forecast, setForecast] = useState("");
  const [contingency, setContingency] = useState("");
  const [contingencyBasis, setContingencyBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latest = controls.latestCalculations["case_cost_reconciliation"];
  const recordedReconciliation = useMemo(
    () => costReconciliationHeadline(latest),
    [latest],
  );
  const reconciliationStale = useMemo(
    () =>
      costReconciliationOutputs(latest) != null &&
      runIsStale(latest, costReconciliationFingerprint(reconciliation)),
    [latest, reconciliation],
  );

  return (
    <Section
      icon={<Coins className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Cost lines"
      subtitle="CBS/WBS-coded cost items (spec §23). These DECOMPOSE the recorded business case — they are not a second cost truth, and no NPV, IRR or payback is computed from them."
    >
      <ErrorLine error={error} />
      {controls.costItems.length === 0 ? (
        <p className="text-xs text-slate-500">
          No cost line is coded on this case. A line whose WBS code does not
          resolve is refused rather than parked in an unassigned bucket, so
          record the WBS and CBS first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-1.5 py-1 text-left">Line</th>
                <th className="px-1.5 py-1 text-left">WBS / CBS</th>
                <th className="px-1.5 py-1 text-right">Baseline</th>
                <th className="px-1.5 py-1 text-right">Commitment</th>
                <th className="px-1.5 py-1 text-right">Actual</th>
                <th className="px-1.5 py-1 text-right">Forecast</th>
                <th className="px-1.5 py-1 text-right">Contingency</th>
              </tr>
            </thead>
            <tbody>
              {controls.costItems.map((ci) => (
                <tr key={ci.id} className="border-t border-white/5">
                  <td className="px-1.5 py-1">
                    <span className="font-mono text-slate-200">
                      {ci.costItemRef}
                    </span>{" "}
                    <span className="text-slate-400">{ci.description}</span>
                  </td>
                  <td className="px-1.5 py-1 font-mono text-slate-400">
                    {ci.wbsCode} / {ci.cbsCode}
                  </td>
                  {[
                    ci.baselineCost,
                    ci.commitment,
                    ci.actual,
                    ci.forecast,
                    ci.contingency,
                  ].map((v, i) => (
                    <td
                      key={i}
                      className="px-1.5 py-1 text-right text-slate-300"
                    >
                      {v == null ? (
                        <span className="text-slate-600">not stated</span>
                      ) : (
                        money(v, ci.currency)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Reconciliation to the business case
          </p>
          {canPlan && (
            <button
              className={btnClass}
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setBusy(true);
                computeCaseCostReconciliation(caseId)
                  // Reload rather than render the returned payload: the
                  // figure must come from the RECORDED run the read serves.
                  .then(() => onChanged())
                  .catch((e) =>
                    setError(
                      e instanceof Error ? e.message : "Compute was refused",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Compute and record
            </button>
          )}
        </div>
        {/* The REFUSALS are statements about the record, so they show
            whatever the state of the calculation — a reader is entitled to
            know that two of three lines carry no baseline even before
            anybody presses Compute. */}
        {reconciliation.refusals.length > 0 && (
          <div className="mt-1 space-y-1">
            {reconciliation.refusals.map((r, i) => (
              <Refusal key={i} text={r} />
            ))}
          </div>
        )}
        {/* The FIGURE comes from the recorded run and from nothing else. */}
        {recordedReconciliation == null ? (
          <p className="mt-1 text-xs text-slate-500">
            No reconciliation has been recorded for this case yet, so no figure
            is shown here. Press Compute and record to produce one with its
            lineage.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-200">
            {recordedReconciliation}
          </p>
        )}
        {reconciliationStale && (
          <Refusal
            text={`The cost lines have changed since this run was recorded ${new Date(latest!.computedAt).toLocaleString()}. The figure above is what was computed then, not what the lines say now — compute again to record a current one.`}
          />
        )}
        <LineageBlock run={latest} />
      </div>

      {canPlan && (
        <form
          className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            recordCostItem({
              caseId,
              costItemRef: ref,
              wbsCode,
              cbsCode,
              description,
              basis,
              baselineCost,
              commitment,
              actual,
              forecast,
              contingency,
              contingencyBasis,
            })
              .then(() => {
                setRef("");
                setDescription("");
                onChanged();
              })
              .catch((err) =>
                setError(
                  err instanceof Error ? err.message : "The write was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <input
            className={inputClass}
            placeholder="Line reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <select
            className={inputClass}
            value={wbsCode}
            onChange={(e) => setWbsCode(e.target.value)}
          >
            <option value="">WBS code…</option>
            {controls.wbs.map((w) => (
              <option key={w.id} value={w.wbsCode}>
                {w.wbsCode}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={cbsCode}
            onChange={(e) => setCbsCode(e.target.value)}
          >
            <option value="">CBS code…</option>
            {controls.cbs.map((b) => (
              <option key={b.id} value={b.cbsCode}>
                {b.cbsCode}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Basis for these figures"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Baseline cost"
            value={baselineCost}
            onChange={(e) => setBaselineCost(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Commitment"
            value={commitment}
            onChange={(e) => setCommitment(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Actual"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Forecast"
            value={forecast}
            onChange={(e) => setForecast(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Contingency"
            value={contingency}
            onChange={(e) => setContingency(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Contingency basis"
            value={contingencyBasis}
            onChange={(e) => setContingencyBasis(e.target.value)}
          />
          <button className={btnClass} disabled={busy} type="submit">
            Record cost line
          </button>
        </form>
      )}
    </Section>
  );
}

/* ───────────────────── post-baseline scope growth (D5.03) ────────────── */

function ScopeGrowthSection({
  caseId,
  controls,
  growth,
  canPlan,
  onChanged,
}: {
  caseId: string;
  controls: CaseControls;
  growth: ScopeGrowth;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [changeRef, setChangeRef] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState<string>("design_development");
  const [wbsCode, setWbsCode] = useState("");
  const [addedAt, setAddedAt] = useState("");
  const [costEffect, setCostEffect] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [approvedRef, setApprovedRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = controls.latestCalculations["case_scope_growth"];
  const growthStale = useMemo(
    () =>
      hasDisplayableOutputs(latest) &&
      runIsStale(latest, scopeGrowthFingerprint(growth, controls.traceability)),
    [latest, growth, controls.traceability],
  );
  const prior = growth.priorBaselines;

  return (
    <Section
      icon={<Scale className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Scope added after the baseline"
      subtitle="What scope growth has cost, attributed to the approved SCOPE baseline it came after (spec I.6). An addition with no cost estimate is counted, never priced at zero."
    >
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-200">
          {scopeGrowthHeadline(growth, latest)}
        </p>
        {canPlan && (
          <button
            className={btnClass}
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setBusy(true);
              computeCaseScopeGrowth(caseId)
                .then(() => onChanged())
                .catch((e) =>
                  setError(
                    e instanceof Error ? e.message : "Compute was refused",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Compute and record
          </button>
        )}
      </div>

      {growthStale && (
        <Refusal
          text={`The scope record has changed since this run was recorded ${new Date(latest!.computedAt).toLocaleString()}. The figure above is what was computed then — compute again to record a current one.`}
        />
      )}

      {growth.evaluable && (growth.caveats ?? []).length > 0 && (
        <div className="space-y-1">
          {(growth.caveats ?? []).map((c, i) => (
            <Refusal key={i} text={c} />
          ))}
        </div>
      )}

      {/* SUPERSEDED VERSIONS. Approving a new scope baseline moves the
          question to "growth since THIS one", and everything attributed to a
          previous version stops counting toward the headline. It does not
          stop existing: showing it here is what keeps a re-baseline from
          silently erasing recorded growth. */}
      {growth.evaluable && (prior?.additionCount ?? 0) > 0 && (
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Attributed to superseded scope baselines · {prior?.additionCount}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-slate-400">
            {(prior?.versions ?? []).map((v) => (
              <li key={v.baselineId}>
                v{v.version} ({v.status}) — {v.additionCount} addition(s),{" "}
                {v.costTotal == null
                  ? "none costed"
                  : money(v.costTotal, growth.currency)}
                {v.uncostedCount > 0 ? `, ${v.uncostedCount} not costed` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">
            These were folded into the current baseline when it was approved, so
            they are not growth against it — and they are not deleted from the
            record either.
          </p>
        </div>
      )}

      {growth.evaluable && (growth.additions ?? []).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-1.5 py-1 text-left">Change</th>
                <th className="px-1.5 py-1 text-left">Origin</th>
                <th className="px-1.5 py-1 text-left">WBS</th>
                <th className="px-1.5 py-1 text-right">Cost</th>
                <th className="px-1.5 py-1 text-left">Approved change</th>
              </tr>
            </thead>
            <tbody>
              {(growth.additions ?? []).map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="px-1.5 py-1">
                    <span className="font-mono text-slate-200">
                      {a.changeRef}
                    </span>{" "}
                    <span className="text-slate-400">{a.description}</span>
                  </td>
                  <td className="px-1.5 py-1 text-slate-400">
                    {a.origin.replaceAll("_", " ")}
                  </td>
                  <td className="px-1.5 py-1 font-mono text-slate-400">
                    {a.wbsCode}
                  </td>
                  <td className="px-1.5 py-1 text-right text-slate-300">
                    {a.costEffect == null ? (
                      <span className="text-slate-600">not estimated</span>
                    ) : (
                      money(a.costEffect, a.currency)
                    )}
                  </td>
                  <td className="px-1.5 py-1 text-slate-400">
                    {a.approvedChangeRef ?? (
                      <span className="text-amber-200">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LineageBlock run={latest} />
      {hasDisplayableOutputs(latest) && !growthStale && (
        <p className="text-[11px] text-slate-500">
          Figure produced by code version {latest.codeVersion} (this build:{" "}
          {CONTROLS_CALC_VERSION}).
        </p>
      )}

      {canPlan && (
        <form
          className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            attributePostBaselineScope({
              caseId,
              changeRef,
              description,
              origin,
              wbsCode,
              addedAt,
              costEffect,
              costBasis,
              approvedChangeRef: approvedRef,
            })
              .then(() => {
                setChangeRef("");
                setDescription("");
                onChanged();
              })
              .catch((err) =>
                setError(
                  err instanceof Error ? err.message : "The write was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <input
            className={inputClass}
            placeholder="Change reference"
            value={changeRef}
            onChange={(e) => setChangeRef(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="What scope was added"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select
            className={inputClass}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            {SCOPE_CHANGE_ORIGINS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={wbsCode}
            onChange={(e) => setWbsCode(e.target.value)}
          >
            <option value="">WBS code…</option>
            {controls.wbs.map((w) => (
              <option key={w.id} value={w.wbsCode}>
                {w.wbsCode}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            type="datetime-local"
            value={addedAt}
            onChange={(e) => setAddedAt(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Cost effect (leave empty if unestimated)"
            value={costEffect}
            onChange={(e) => setCostEffect(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Cost basis"
            value={costBasis}
            onChange={(e) => setCostBasis(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Approved change request ref (if any)"
            value={approvedRef}
            onChange={(e) => setApprovedRef(e.target.value)}
          />
          <button className={btnClass} disabled={busy} type="submit">
            Attribute scope addition
          </button>
        </form>
      )}
    </Section>
  );
}

/* ────────────────── the eleven controls structures (D5.04) ───────────── */

function ControlsBaselineSection({
  caseId,
  controls,
  canReview,
  onChanged,
}: {
  caseId: string;
  controls: CaseControls;
  canReview: boolean;
  onChanged: () => void;
}) {
  const baseline = controls.controlsBaseline;
  const [baselines, setBaselines] = useState<
    { id: string; baseline_type: string; version: number }[]
  >([]);
  const [baselineId, setBaselineId] = useState("");
  const [structure, setStructure] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const capturable = useMemo(() => capturableStructures(baseline), [baseline]);
  const drifted = useMemo(() => driftedStructures(baseline), [baseline]);

  useEffect(() => {
    void listCaseBaselines(caseId)
      .then(setBaselines)
      .catch(() => setBaselines([]));
  }, [caseId, controls]);

  return (
    <Section
      icon={<Layers className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Controls baseline — eleven structures"
      subtitle="Spec I.8's eleven, each against the canonical home it is derived from. A structure with no home says so; capturing one fixes what it contained when the baseline was approved, and drift is reported per structure."
    >
      <ErrorLine error={error} />
      <p className="text-xs text-slate-400">
        {baseline.capturedCount} of {baseline.structureCount} structures
        captured
        {baseline.driftedCount > 0
          ? ` · ${baseline.driftedCount} have changed since they were fixed`
          : ""}
        {baseline.baselineComplete == null
          ? " · no controls baseline has been captured on this case yet"
          : ""}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-1.5 py-1 text-left">Structure</th>
              <th className="px-1.5 py-1 text-left">Home</th>
              <th className="px-1.5 py-1 text-right">Now</th>
              <th className="px-1.5 py-1 text-left">Baselined</th>
            </tr>
          </thead>
          <tbody>
            {baseline.structures.map((s) => (
              <tr key={s.structure} className="border-t border-white/5">
                <td className="px-1.5 py-1 text-slate-200">
                  {s.structure.replaceAll("_", " ")}
                </td>
                <td className="px-1.5 py-1 font-mono text-slate-500">
                  {s.home}
                </td>
                <td className="px-1.5 py-1 text-right text-slate-300">
                  {s.currentCount ?? "—"}
                </td>
                <td className="px-1.5 py-1 text-slate-400">
                  {s.refusal ? (
                    <span className="text-amber-200">not baselineable</span>
                  ) : s.baseline ? (
                    `${s.baseline.baselineType} v${s.baseline.version} · ${s.baseline.elementCount} element(s)${s.drifted ? " · DRIFTED" : ""}`
                  ) : (
                    "not captured"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {baseline.structures
        .filter((s) => s.refusal)
        .map((s) => (
          <Refusal key={s.structure} text={`${s.structure}: ${s.refusal}`} />
        ))}
      {drifted.map((s) => (
        <Refusal
          key={`drift-${s.structure}`}
          text={s.driftDetail ?? `${s.structure} has changed since baseline.`}
        />
      ))}

      {canReview && (
        <form
          className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            captureControlsBaselineStructure({ baselineId, structure })
              .then(() => {
                setStructure("");
                onChanged();
              })
              .catch((err) =>
                setError(
                  err instanceof Error ? err.message : "Capture was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <select
            className={inputClass}
            value={baselineId}
            onChange={(e) => setBaselineId(e.target.value)}
          >
            <option value="">Approved baseline…</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {b.baseline_type} v{b.version}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={structure}
            onChange={(e) => setStructure(e.target.value)}
          >
            <option value="">Structure…</option>
            {capturable.map((s) => (
              <option key={s.structure} value={s.structure}>
                {s.structure.replaceAll("_", " ")} ({s.currentCount})
              </option>
            ))}
          </select>
          <button
            className={btnClass}
            disabled={busy || !baselineId || !structure}
            type="submit"
          >
            Capture structure
          </button>
        </form>
      )}
    </Section>
  );
}

/* ─────────────────────── calculation lineage (D11.29) ────────────────── */

function CalculationLineageSection({
  caseId,
  controls,
}: {
  caseId: string;
  controls: CaseControls;
}) {
  /**
   * The full recorded history, not just the latest per key. A number that was
   * superseded still has to be defensible: "what did we tell the board in
   * March" is answered by the run that was current in March, and a view that
   * only ever shows the newest one cannot answer it.
   */
  const [runs, setRuns] = useState<CalculationRun[]>(
    Object.values(controls.latestCalculations).filter(
      (r): r is CalculationRun => r != null,
    ),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCaseCalculationLineage(caseId)
      .then((payload) => setRuns(payload.runs))
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Could not load the lineage history",
        ),
      );
  }, [caseId, controls]);

  return (
    <Section
      icon={<FileStack className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Calculation lineage"
      subtitle="Every computed FIGURE on this page — the scope-growth cost and the cost reconciliation — is rendered from one of these runs and from nothing else: its method, the code version that produced it, the inputs it read, and what it refused on the way (spec §71-78). Counts and listings above are the recorded rows themselves. Runs are immutable, so a superseded figure keeps its defence."
    >
      <ErrorLine error={error} />
      {runs.length === 0 ? (
        <p className="text-xs text-slate-500">
          No calculation has been recorded for this case, so the two computed
          figures above show why there is no number rather than a number.
        </p>
      ) : (
        runs.map((run) => (
          <div
            key={run.id}
            className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2"
          >
            <p className="text-xs font-semibold text-slate-200">
              {run.calculationKey.replaceAll("_", " ")} · {run.status}
            </p>
            <LineageBlock run={run} />
          </div>
        ))
      )}
    </Section>
  );
}

/* ───────────────────────────── the panel ─────────────────────────────── */

export function IntegratedControlsPanel({
  caseId,
  members,
  canPlan,
  canReview,
  reloadKey,
}: {
  caseId: string;
  members: OrgMember[];
  canPlan: boolean;
  canReview: boolean;
  reloadKey: number;
}) {
  const [controls, setControls] = useState<CaseControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * There is deliberately no "freshly computed result" state here.
   *
   * It used to hold the payload compute_case_* returns and render it in
   * preference to the read — which meant that BEFORE anyone pressed Compute
   * the page fell back to get_case_controls' embedded LIVE READ and rendered
   * a money figure that no calculation_runs row backed, directly above the
   * sentence "nothing is shown above that was not computed and recorded".
   * Computing now reloads, so the figure on screen is always the recorded
   * run in `latestCalculations` and nothing else.
   */
  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await getCaseControls(caseId);
      setControls(next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load the controls view",
      );
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (controls == null) {
    return (
      <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5 text-xs text-slate-500">
        Loading the scope chain, cost lines, schedule activities and controls
        baseline…
      </div>
    );
  }

  return (
    <>
      <ScopeArchitectureSection
        caseId={caseId}
        controls={controls}
        members={members}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <TraceabilitySection
        caseId={caseId}
        controls={controls}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <ScheduleActivitySection
        caseId={caseId}
        controls={controls}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <CostItemSection
        caseId={caseId}
        controls={controls}
        reconciliation={controls.costReconciliation}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <ScopeGrowthSection
        caseId={caseId}
        controls={controls}
        growth={controls.scopeGrowth}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <ControlsBaselineSection
        caseId={caseId}
        controls={controls}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <CalculationLineageSection caseId={caseId} controls={controls} />
      <div className="rounded-xl border border-white/6 bg-[#0D1520] px-4 py-3">
        <div className="flex items-center gap-2">
          <SquareStack className="h-4 w-4 text-slate-500" aria-hidden />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Not in this view, and why
          </p>
        </div>
        <ul className="mt-1 space-y-1 text-xs text-slate-500">
          {controls.notInThisSlice.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
