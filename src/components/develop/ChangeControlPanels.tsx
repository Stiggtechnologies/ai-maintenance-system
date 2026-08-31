/**
 * Sync Develop Slice 4D — the change-control surface.
 *
 *   D5.18  the contingency ledger: every entry with its cause, its approving
 *          authority, the CEILING that authority was checked against, and the
 *          balance it left behind.
 *   D5.19  consumption by cause, with the `unattributed` bucket ALWAYS
 *          rendered — empty is a fact, absent is an invitation to assume.
 *   D5.27  the Change object with its impact vector and propagation chain.
 *   D5.30  Workflow 3 as a sequence you can see: raise → assess → sign →
 *          decide → propagate → implement, with the CURRENT blocker named.
 *   D3.12/13/21/36  decision latency, critical-path exposure and decision
 *          debt, each refusing rather than reporting a comfortable zero.
 *   D5.21  the composed Sync Assurance engine.
 *   D13.08 the Integrated Controls screen.
 *
 * THE SURFACE CONVENTION, unchanged from 4A/4B/4C: every FIGURE comes from a
 * recorded calculation run; the live read supplies refusals, row listings and
 * staleness detection; a run whose input fingerprint has moved is labelled
 * stale and its code-version caption suppressed. What 4D adds is that the
 * Integrated Controls screen does not even have a live read to fall back to —
 * it is handed recorded runs and renders "no run recorded" where there is
 * none, because a blank tile in a controls view reads as zero.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  GitPullRequestArrow,
  LayoutGrid,
  ShieldCheck,
  Timer,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  changeBlocker,
  changeFingerprint,
  contingencyFingerprint,
  decisionDebtFingerprint,
  decisionDebtHeadline,
  decisionLatencyFingerprint,
  decisionLatencyHeadline,
  dimensionDisplay,
  dimensionFingerprint,
  drawdownPreflight,
  moneyOrReason,
  recordedDebtHeadline,
  recordedLatencyHeadline,
  selectableCauseClasses,
  type AuthorityDelegations,
  type CaseAssuranceEngine,
  type CaseChangeControl,
  type CaseContingency,
  type CaseDecisionDebt,
  type CaseDecisionLatency,
  type CaseIntegratedControls,
  type ContingencyCauseClass,
} from "../../lib/develop/change";
import {
  performanceRunIsStale,
  type PerformanceCalculationRun,
} from "../../lib/develop/performance";
import {
  adoptAuthorityLimit,
  assessProjectChange,
  closeChangePropagation,
  computeCaseChangeControl,
  computeCaseContingencyConsumption,
  computeCaseDecisionDebt,
  computeCaseDecisionLatency,
  decideProjectChange,
  draftAuthorityCeiling,
  drawDownContingency,
  establishContingencyPool,
  getAuthorityDelegations,
  getCaseAssuranceEngine,
  getCaseChangeControl,
  getCaseContingency,
  getCaseDecisionDebt,
  getCaseDecisionLatency,
  getCaseIntegratedControls,
  implementProjectChange,
  linkDecisionToActivity,
  propagateProjectChange,
  raiseProjectChange,
  recordDecisionDelayExposure,
  releaseContingency,
  signProjectChangeEngineering,
  stateAuthorityCeiling,
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

/** A refusal is an ANSWER, so it is rendered as prose and never as an error. */
function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

function LineageBlock({
  run,
  stale = false,
}: {
  run: PerformanceCalculationRun | null | undefined;
  stale?: boolean;
}) {
  if (run == null) {
    return (
      <p className="text-[11px] text-slate-500">
        No calculation has been recorded for this figure yet. Nothing above is a
        number this screen produced — press Compute to record one.
      </p>
    );
  }
  return (
    <details className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Lineage · {stale ? "superseded inputs" : run.codeVersion} ·{" "}
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
        {(run.refusals ?? []).length > 0 && (
          <ul className="space-y-1">
            {(run.refusals ?? []).map((r, i) => (
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

/* ════ the delegation instrument the money doors are checked against ═══ */

/**
 * D5.18's ceiling, stated through the product.
 *
 * Until this existed the 4D seeds left `max_commitment_usd` null, R2 made a
 * null ceiling REFUSE, and the refusal's own remediation ("record
 * max_commitment_usd on the delegation") was impossible: `adopt_authority_limit`
 * takes no amount, the table has only a read policy, and the CI smoke set the
 * number with a raw psql UPDATE. Every drawdown refused for ever and only a
 * DBA could change that.
 *
 * A ceiling is stated on a DRAFT and then adopted. An adopted delegation is
 * never edited — every recorded drawdown quotes the ceiling it was checked
 * against, so a ceiling that could move afterwards would make all of them
 * unfalsifiable.
 */
function AuthorityDelegationSection({
  delegations,
  onChanged,
}: {
  delegations: AuthorityDelegations;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [basis, setBasis] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setCeiling("");
      setBasis("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const drafts = delegations.delegations.filter((d) => d.status === "draft");
  const selected = delegations.delegations.find((d) => d.id === target) ?? null;

  return (
    <Section
      icon={<ShieldCheck className="h-4 w-4 text-signal-cyan" />}
      title="Delegation of authority — the money ceiling"
      subtitle="Spec §43: the ceiling every contingency drawdown and every change approval is checked against. Absence refuses, and a blank ceiling refuses: “nobody has said how much you may spend” is not permission to spend."
    >
      <ErrorLine error={error} />
      <Refusal text={delegations.refusal} />
      <p className="text-[11px] text-slate-500">{delegations.note}</p>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-3">Act</th>
              <th className="py-1 pr-3">Role</th>
              <th className="py-1 pr-3">Ceiling</th>
              <th className="py-1 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {delegations.delegations.map((d) => (
              <tr key={d.id} className="align-top text-slate-300">
                <td className="py-1 pr-3">{d.actionType}</td>
                <td className="py-1 pr-3">
                  {d.roleKey}
                  {d.isMyRole ? " (yours)" : ""}
                </td>
                <td className="py-1 pr-3">
                  {d.maxCommitment == null ? (
                    <span className="text-amber-200">unstated — refuses</span>
                  ) : (
                    `${d.maxCommitmentCurrency} ${d.maxCommitment.toLocaleString()}`
                  )}
                </td>
                <td className="py-1 pr-3">
                  {d.status}
                  {d.status === "adopted" && (
                    <button
                      disabled={busy}
                      className={`${btnClass} ml-2`}
                      onClick={() =>
                        void act(() =>
                          draftAuthorityCeiling({
                            limitId: d.id,
                            note: "Redrafted to restate the ceiling through the product rather than editing an adopted delegation.",
                          }),
                        )
                      }
                    >
                      Redraft
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {delegations.canState && drafts.length > 0 && (
        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            State a ceiling on a draft (§70 — a human determination)
          </p>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
          >
            <option value="">Draft delegation…</option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.actionType} · {d.roleKey} · v{d.version}
              </option>
            ))}
          </select>
          {selected?.selfAdoptionRefusal != null && (
            <Refusal text={selected.selfAdoptionRefusal} />
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              placeholder="Maximum commitment"
              className={inputClass}
            />
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              placeholder="Currency (three-letter code)"
              maxLength={3}
              className={inputClass}
            />
          </div>
          <input
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="The delegation instrument this ceiling comes from (20 characters minimum)"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={
                busy ||
                target === "" ||
                ceiling.trim() === "" ||
                currency.length !== 3 ||
                basis.trim().length < 20 ||
                selected?.selfAdoptionRefusal != null
              }
              className={btnClass}
              onClick={() =>
                void act(() =>
                  stateAuthorityCeiling({
                    limitId: target,
                    maxCommitment: ceiling,
                    currency,
                    basis,
                  }),
                )
              }
            >
              State the ceiling
            </button>
            <button
              disabled={
                busy ||
                target === "" ||
                selected?.maxCommitment == null ||
                selected?.selfAdoptionRefusal != null
              }
              className={btnClass}
              onClick={() =>
                void act(() =>
                  adoptAuthorityLimit({
                    limitId: target,
                    note:
                      basis.trim().length >= 10
                        ? basis
                        : "Adopted from the organization's delegation of authority instrument.",
                  }),
                )
              }
            >
              Adopt
            </button>
          </div>
          {selected?.ceilingRefusal != null && (
            <Refusal text={selected.ceilingRefusal} />
          )}
        </div>
      )}
    </Section>
  );
}

/* ══════════════ D5.18 / D5.19 — the contingency ledger ═══════════════ */

function ContingencySection({
  caseId,
  contingency,
  run,
  stale,
  canPlan,
  onChanged,
  baselines,
}: {
  caseId: string;
  contingency: CaseContingency;
  run: PerformanceCalculationRun | null;
  stale: boolean;
  canPlan: boolean;
  onChanged: () => void;
  baselines: { id: string; label: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [cause, setCause] = useState<ContingencyCauseClass>("scope_maturation");
  const [justification, setJustification] = useState("");
  const [riskId, setRiskId] = useState("");
  const [changeId, setChangeId] = useState("");
  const [poolBaseline, setPoolBaseline] = useState("");
  const [poolAmount, setPoolAmount] = useState("");
  const [poolBasis, setPoolBasis] = useState("");
  const [poolCurrency, setPoolCurrency] = useState("CAD");
  /* THE RELEASE HAS ITS OWN STATE AND ITS OWN CONFIRMATION. It used to read
     the same `amount` and `justification` as the drawdown, sit directly under
     the Draw down button, look identical, and be enabled whenever an amount
     had been typed — so a mis-click while composing a drawdown RETURNED money
     to the fund instead of taking it, against whichever drawdown happened to
     come back first. Two opposite money operations do not share one field. */
  const [releaseEntryId, setReleaseEntryId] = useState("");
  const [releaseAmount, setReleaseAmount] = useState("");
  const [releaseJustification, setReleaseJustification] = useState("");
  const [releaseArmed, setReleaseArmed] = useState(false);

  const preflight = drawdownPreflight(amount, contingency);
  const pool = contingency.currentPool;
  const releaseTarget =
    contingency.entries.find((e) => e.id === releaseEntryId) ?? null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAmount("");
      setJustification("");
      setReleaseAmount("");
      setReleaseJustification("");
      setReleaseArmed(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Banknote className="h-4 w-4 text-signal-cyan" />}
      title="Contingency"
      subtitle="Spec II.8: not an invisible slush fund. Original amount, basis, risk event, drawdown, approving authority, remaining — every one of them on the record."
    >
      <ErrorLine error={error} />
      <Refusal text={contingency.refusal} />
      {/* Money in two currencies is not added. The per-pool figures below are
          exact; the case-level totals are withheld and named. */}
      {contingency.currencyRefusal != null &&
        contingency.currencyRefusal !== contingency.refusal && (
          <Refusal text={contingency.currencyRefusal} />
        )}

      {pool != null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Original", value: pool.originalAmount },
            { label: "Drawn down", value: pool.drawnDown },
            { label: "Released", value: pool.released },
            { label: "Remaining", value: pool.remaining },
          ].map((t) => (
            <div
              key={t.label}
              className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
            >
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                {t.label}
              </p>
              <p className="text-sm font-semibold text-slate-100">
                {moneyOrReason(t.value, pool.currency, "not recorded").text}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* PRIOR POOLS ARE SHOWN BESIDE THE CURRENT ONE, never dropped. */}
      {contingency.pools.length > 1 && (
        <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Pools on prior baselines — money spent before a re-baseline was
            still spent
          </p>
          <ul className="mt-1 space-y-1 text-xs text-slate-300">
            {contingency.pools
              .filter((p) => !p.isCurrent)
              .map((p) => (
                <li key={p.id}>
                  {p.poolRef} (baseline v{p.baselineVersion}) ·{" "}
                  {moneyOrReason(p.drawnDown, p.currency, "—").text} drawn of{" "}
                  {moneyOrReason(p.originalAmount, p.currency, "—").text}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* D5.19 — every cause, ALWAYS, including `unattributed`. */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-3">Cause</th>
              <th className="py-1 pr-3">Drawn</th>
              <th className="py-1 pr-3">Released</th>
              <th className="py-1 pr-3">Net</th>
              <th className="py-1 pr-3">Share</th>
            </tr>
          </thead>
          <tbody>
            {contingency.byCause.map((c) => (
              <tr
                key={c.causeClass}
                className={
                  c.causeClass === "unattributed" && (c.net ?? 0) !== 0
                    ? "text-amber-200"
                    : "text-slate-300"
                }
              >
                <td className="py-1 pr-3">{c.label}</td>
                {/* Withheld, not zeroed, when the pools disagree on currency —
                    and the per-cause refusal says which. */}
                <td className="py-1 pr-3">
                  {c.drawnDown == null
                    ? "withheld"
                    : c.drawnDown.toLocaleString()}
                </td>
                <td className="py-1 pr-3">
                  {c.released == null
                    ? "withheld"
                    : c.released.toLocaleString()}
                </td>
                <td className="py-1 pr-3">
                  {c.net == null ? "withheld" : c.net.toLocaleString()}
                </td>
                <td className="py-1 pr-3">
                  {c.sharePercent == null ? "—" : `${c.sharePercent}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Refusal
        text={
          contingency.lineContingency.agreesWithPools === false
            ? contingency.lineContingency.note
            : null
        }
      />

      {/* The ledger itself. */}
      {contingency.entries.length > 0 && (
        <details className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Ledger · {contingency.entries.length} entries · append-only
          </summary>
          <ul className="mt-2 space-y-2 text-xs text-slate-300">
            {contingency.entries.map((e) => (
              <li key={e.id} className="border-l border-white/10 pl-2">
                <span className="text-slate-100">
                  #{e.entryNo} {e.entryType} {e.amount.toLocaleString()}
                </span>
                {e.causeClass != null && <> · {e.causeClass}</>}
                {e.causeRiskTitle != null && <> · risk: {e.causeRiskTitle}</>}
                <br />
                <span className="text-slate-500">
                  approved by {e.approver ?? "—"} ({e.approverRole})
                  {e.approverCeiling != null && (
                    <>
                      {" "}
                      against a {e.tierLabel ?? "recorded"} ceiling of{" "}
                      {e.approverCeiling.toLocaleString()}
                    </>
                  )}{" "}
                  · balance after {e.balanceAfter.toLocaleString()}
                </span>
                <br />
                <span className="text-slate-400">{e.justification}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canPlan && pool == null && baselines.length > 0 && (
        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Establish the fund (§70 — a human determination)
          </p>
          <select
            value={poolBaseline}
            onChange={(e) => setPoolBaseline(e.target.value)}
            className={inputClass}
          >
            <option value="">Approved COST baseline…</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <input
            value={poolAmount}
            onChange={(e) => setPoolAmount(e.target.value)}
            placeholder="Original amount"
            className={inputClass}
          />
          <input
            value={poolCurrency}
            onChange={(e) => setPoolCurrency(e.target.value.toUpperCase())}
            placeholder="Currency (three-letter code, e.g. CAD)"
            maxLength={3}
            className={inputClass}
          />
          <input
            value={poolBasis}
            onChange={(e) => setPoolBasis(e.target.value)}
            placeholder="Basis for this amount (20 characters minimum)"
            className={inputClass}
          />
          <p className="text-[11px] text-slate-500">
            A ceiling is an amount in a currency. A fund held in a currency the
            adopted delegation does not state its ceiling in will REFUSE every
            drawdown — Sync holds no exchange rate and will not compare two
            different units.
          </p>
          <button
            disabled={busy || poolBaseline === "" || poolCurrency.length !== 3}
            className={btnClass}
            onClick={() =>
              void act(() =>
                establishContingencyPool({
                  caseId,
                  baselineId: poolBaseline,
                  originalAmount: poolAmount,
                  currency: poolCurrency,
                  basis: poolBasis,
                }),
              )
            }
          >
            Establish pool
          </button>
        </div>
      )}

      {canPlan && pool != null && (
        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Draw down — authority-gated, cause-attributed, §70 human-only
          </p>
          {contingency.authority?.permitted === false && (
            <Refusal text={contingency.authority.refusal} />
          )}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className={inputClass}
          />
          <select
            value={cause}
            onChange={(e) => setCause(e.target.value as ContingencyCauseClass)}
            className={inputClass}
          >
            {selectableCauseClasses().map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
                {c.linked ? " (cites a subject)" : ""}
              </option>
            ))}
          </select>
          {cause === "realized_risk" && (
            <input
              value={riskId}
              onChange={(e) => setRiskId(e.target.value)}
              placeholder="Risk id that was realized"
              className={inputClass}
            />
          )}
          {cause === "approved_change" && (
            <input
              value={changeId}
              onChange={(e) => setChangeId(e.target.value)}
              placeholder="Approved change id this funds"
              className={inputClass}
            />
          )}
          <input
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Why this money is being drawn (20 characters minimum)"
            className={inputClass}
          />
          {/* The preflight quotes the server's own refusal; the server is
              still the enforcement, and it refuses again on submit. */}
          {amount !== "" && preflight.reason != null && (
            <Refusal text={preflight.reason} />
          )}
          <button
            disabled={busy || !preflight.ok}
            className={btnClass}
            onClick={() =>
              void act(() =>
                drawDownContingency({
                  poolId: pool.id,
                  amount,
                  causeClass: cause,
                  justification,
                  riskId: riskId || undefined,
                  changeId: changeId || undefined,
                }),
              )
            }
          >
            {busy ? "Checking authority…" : "Draw down"}
          </button>
        </div>
      )}

      {canPlan &&
        pool != null &&
        contingency.entries.some((e) => e.entryType === "drawdown") && (
          <div className="space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-wide text-amber-200/80">
              Release — returns money to the fund (the opposite of a drawdown)
            </p>
            <select
              value={releaseEntryId}
              onChange={(e) => {
                setReleaseEntryId(e.target.value);
                setReleaseArmed(false);
              }}
              className={inputClass}
            >
              <option value="">Which drawdown is being reversed…</option>
              {contingency.entries
                .filter((e) => e.entryType === "drawdown")
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    #{e.entryNo} · {e.poolRef} · {e.amount.toLocaleString()} ·{" "}
                    {e.causeClass ?? "no cause"} ·{" "}
                    {new Date(e.recordedAt).toLocaleDateString()}
                  </option>
                ))}
            </select>
            <input
              value={releaseAmount}
              onChange={(e) => {
                setReleaseAmount(e.target.value);
                setReleaseArmed(false);
              }}
              placeholder="Amount to return to the fund"
              className={inputClass}
            />
            <input
              value={releaseJustification}
              onChange={(e) => setReleaseJustification(e.target.value)}
              placeholder="Why this money is being returned (20 characters minimum)"
              className={inputClass}
            />
            {releaseArmed && releaseTarget != null && (
              <p className="text-xs text-amber-200">
                This will RETURN {releaseAmount} to {releaseTarget.poolRef}{" "}
                against drawdown #{releaseTarget.entryNo} (
                {releaseTarget.amount.toLocaleString()},{" "}
                {releaseTarget.causeClass ?? "no cause"}). It increases what
                everybody else may still spend from this fund. Press again to
                confirm.
              </p>
            )}
            <button
              disabled={
                busy ||
                releaseEntryId === "" ||
                releaseAmount.trim() === "" ||
                releaseJustification.trim().length < 20
              }
              className={btnClass}
              onClick={() => {
                if (!releaseArmed) {
                  setReleaseArmed(true);
                  return;
                }
                void act(() =>
                  releaseContingency({
                    entryId: releaseEntryId,
                    amount: releaseAmount,
                    justification: releaseJustification,
                  }),
                );
              }}
            >
              {releaseArmed
                ? "Confirm release"
                : releaseTarget == null
                  ? "Release against a drawdown"
                  : `Release against drawdown #${releaseTarget.entryNo}`}
            </button>
          </div>
        )}

      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          className={btnClass}
          onClick={() =>
            void act(() => computeCaseContingencyConsumption(caseId))
          }
        >
          Compute consumption
        </button>
        {stale && (
          <span className="text-[11px] text-amber-300">
            The ledger has moved since this run was recorded.
          </span>
        )}
      </div>
      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ═════════════ D5.27 / D5.30 — Workflow 3 change control ═════════════ */

function ChangeSection({
  caseId,
  change,
  run,
  stale,
  canPlan,
  canReview,
  onChanged,
  baselines,
}: {
  caseId: string;
  change: CaseChangeControl;
  run: PerformanceCalculationRun | null;
  stale: boolean;
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
  baselines: { id: string; label: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [cls, setCls] = useState("");
  const [baseline, setBaseline] = useState("");
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  /* The impact vector, authored. No defaults: a default here is a number
     nobody stated deciding who is allowed to approve the change. */
  const [costEffect, setCostEffect] = useState("");
  const [contingencyEffect, setContingencyEffect] = useState("");
  const [scheduleDays, setScheduleDays] = useState("");
  const [riskEffect, setRiskEffect] = useState("");
  const [changeCurrency, setChangeCurrency] = useState("CAD");
  const [technicalEffect, setTechnicalEffect] = useState("");
  const [impactBasis, setImpactBasis] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<GitPullRequestArrow className="h-4 w-4 text-signal-cyan" />}
      title="Change control (Workflow 3)"
      subtitle="Proposed change → identify baseline → impacts → risk reassessment → required authority → decision → propagate. On the SAME MOC engine that gates asset change classes, not a second workflow."
    >
      <ErrorLine error={error} />
      <Refusal text={change.refusal} />
      {change.authority?.permitted === false && (
        <Refusal text={change.authority.refusal} />
      )}

      <ul className="space-y-3">
        {change.changes.map((c) => {
          const blocker = changeBlocker(c);
          return (
            <li
              key={c.id}
              className="rounded-lg border border-white/6 bg-white/[0.02] p-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-slate-100">
                  {c.changeRef}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                  {c.status} · {c.classTitle ?? c.changeClass} · baseline{" "}
                  {c.baselineType} v{c.baselineVersion}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{c.proposedChange}</p>

              {c.impact == null ? (
                <Refusal text={c.impactRefusal} />
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Cost", c.impact.costEffect],
                    ["Schedule (days)", c.impact.scheduleEffectDays],
                    ["Contingency", c.impact.contingencyEffect],
                  ].map(([label, v]) => (
                    <div key={String(label)}>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        {label}
                      </p>
                      <p className="text-xs text-slate-100">
                        {Number(v).toLocaleString()}
                      </p>
                    </div>
                  ))}
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Residual risk
                    </p>
                    <p className="text-xs text-slate-100">
                      {c.impact.riskEffect}
                    </p>
                  </div>
                </div>
              )}

              {blocker != null && <Refusal text={blocker} />}

              {c.approver != null && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Decided by {c.approver} ({c.approverRole})
                  {c.approverCeiling != null && (
                    <>
                      {" "}
                      under a {c.tierLabel ?? "recorded"} ceiling of{" "}
                      {c.approverCeiling.toLocaleString()}
                    </>
                  )}
                </p>
              )}

              {c.propagation.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    Propagation chain
                  </p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {c.propagation.map((p) => (
                      <li
                        key={p.id}
                        className={
                          p.status === "pending"
                            ? "text-amber-200"
                            : "text-slate-400"
                        }
                      >
                        {p.targetKind} · {p.status}
                        {p.syncOwned ? " · Sync-owned" : " · closed by a human"}
                        <br />
                        <span className="text-slate-500">{p.effect}</span>
                        {canPlan && p.status === "pending" && !p.syncOwned && (
                          <button
                            disabled={busy || note.trim().length < 10}
                            className={`${btnClass} ml-2`}
                            onClick={() =>
                              void act(() =>
                                closeChangePropagation({
                                  propagationId: p.id,
                                  outcome: "applied",
                                  note,
                                }),
                              )
                            }
                          >
                            Close as applied
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canPlan && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.impact == null && (
                    /* THE IMPACT VECTOR IS AUTHORED, NOT DEFAULTED.
                       This button used to post a hardcoded vector — cost 0,
                       schedule 0, risk Low, currency CAD, and the note as both
                       the technical effect and the impact basis. Every
                       consequence of that was a false ✅: `sync_change_authority`
                       routes on the cost effect plus the contingency effect, so
                       EVERY change assessed through the product routed on
                       magnitude 0 and a $10M change was approvable by a project
                       manager under a $250k ceiling; all four propagation hops
                       are gated on a non-zero effect, so the propagation chain
                       D5.27 is named for could never be authored; and the
                       20-character impact-basis wall was satisfied by a literal
                       this component supplied rather than by anything a person
                       stated. There are no defaults here now. */
                    <div className="w-full space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Assess the impact — the authority this change is routed
                        to is decided by these numbers
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                        <input
                          value={costEffect}
                          onChange={(e) => setCostEffect(e.target.value)}
                          placeholder="Cost effect"
                          className={inputClass}
                        />
                        <input
                          value={contingencyEffect}
                          onChange={(e) => setContingencyEffect(e.target.value)}
                          placeholder="Contingency effect"
                          className={inputClass}
                        />
                        <input
                          value={scheduleDays}
                          onChange={(e) => setScheduleDays(e.target.value)}
                          placeholder="Schedule effect (days)"
                          className={inputClass}
                        />
                        <input
                          value={changeCurrency}
                          onChange={(e) =>
                            setChangeCurrency(e.target.value.toUpperCase())
                          }
                          placeholder="Currency"
                          maxLength={3}
                          className={inputClass}
                        />
                      </div>
                      <select
                        value={riskEffect}
                        onChange={(e) => setRiskEffect(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">
                          Residual risk after the change…
                        </option>
                        {["Low", "Medium", "High", "Critical"].map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <input
                        value={technicalEffect}
                        onChange={(e) => setTechnicalEffect(e.target.value)}
                        placeholder="Technical effect (10 characters minimum)"
                        className={inputClass}
                      />
                      <input
                        value={impactBasis}
                        onChange={(e) => setImpactBasis(e.target.value)}
                        placeholder="What this impact was estimated from (20 characters minimum)"
                        className={inputClass}
                      />
                      <button
                        disabled={
                          busy ||
                          costEffect.trim() === "" ||
                          scheduleDays.trim() === "" ||
                          contingencyEffect.trim() === "" ||
                          riskEffect === "" ||
                          changeCurrency.length !== 3 ||
                          technicalEffect.trim().length < 10 ||
                          impactBasis.trim().length < 20
                        }
                        className={btnClass}
                        onClick={() =>
                          void act(() =>
                            assessProjectChange({
                              changeId: c.id,
                              technicalEffect,
                              costEffect,
                              scheduleEffectDays: scheduleDays,
                              contingencyEffect,
                              riskEffect,
                              currency: changeCurrency,
                              impactBasis,
                            }),
                          )
                        }
                      >
                        Assess
                      </button>
                    </div>
                  )}
                  {c.impact != null && c.competenceSignedAt == null && (
                    <button
                      disabled={busy || note.trim().length < 20}
                      className={btnClass}
                      onClick={() =>
                        void act(() =>
                          signProjectChangeEngineering({
                            changeId: c.id,
                            note,
                          }),
                        )
                      }
                    >
                      Engineering sign-off
                    </button>
                  )}
                  {canReview &&
                    c.competenceSignedAt != null &&
                    c.decidedAt == null && (
                      <>
                        <button
                          disabled={busy || note.trim().length < 20}
                          className={btnClass}
                          onClick={() =>
                            void act(() =>
                              decideProjectChange({
                                changeId: c.id,
                                outcome: "approved",
                                note,
                              }),
                            )
                          }
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy || note.trim().length < 20}
                          className={btnClass}
                          onClick={() =>
                            void act(() =>
                              decideProjectChange({
                                changeId: c.id,
                                outcome: "rejected",
                                note,
                              }),
                            )
                          }
                        >
                          Reject
                        </button>
                      </>
                    )}
                  {c.status === "approved" && (
                    <>
                      <button
                        disabled={busy}
                        className={btnClass}
                        onClick={() =>
                          void act(() => propagateProjectChange(c.id))
                        }
                      >
                        Propagate
                      </button>
                      <button
                        disabled={busy || c.propagationOutstanding > 0}
                        className={btnClass}
                        onClick={() =>
                          void act(() => implementProjectChange(c.id))
                        }
                      >
                        Mark implemented
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canPlan && (
        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Raise a change — the baseline it modifies is not optional
          </p>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Change reference"
            className={inputClass}
          />
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value)}
            className={inputClass}
          >
            <option value="">
              Change class (the MOC engine's vocabulary)…
            </option>
            {change.classes.map((c) => (
              <option key={c.changeClass} value={c.changeClass}>
                {c.title} — signed by {c.requiredRole}
              </option>
            ))}
          </select>
          <select
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            className={inputClass}
          >
            <option value="">Baseline this change modifies…</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <input
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            placeholder="What is proposed (20 characters minimum)"
            className={inputClass}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why (20 characters minimum)"
            className={inputClass}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note used for sign-off, decision and propagation closure"
            className={inputClass}
          />
          <button
            disabled={busy || ref === "" || cls === "" || baseline === ""}
            className={btnClass}
            onClick={() =>
              void act(() =>
                raiseProjectChange({
                  caseId,
                  changeRef: ref,
                  changeClass: cls,
                  baselineId: baseline,
                  proposedChange: proposed,
                  reason,
                }),
              )
            }
          >
            Raise change
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          className={btnClass}
          onClick={() => void act(() => computeCaseChangeControl(caseId))}
        >
          Compute change position
        </button>
        {stale && (
          <span className="text-[11px] text-amber-300">
            The change register has moved since this run was recorded.
          </span>
        )}
      </div>
      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ═════════ D3.12 / D3.13 / D3.21 / D3.36 — decision latency ══════════ */

function DecisionSection({
  caseId,
  latency,
  debt,
  latencyRun,
  debtRun,
  latencyStale,
  debtStale,
  onChanged,
  canPlan,
}: {
  caseId: string;
  latency: CaseDecisionLatency;
  debt: CaseDecisionDebt;
  latencyRun: PerformanceCalculationRun | null;
  debtRun: PerformanceCalculationRun | null;
  latencyStale: boolean;
  debtStale: boolean;
  onChanged: () => void;
  canPlan: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [activityKey, setActivityKey] = useState("");
  const [linkBasis, setLinkBasis] = useState("");
  const [impact, setImpact] = useState("");
  const [probability, setProbability] = useState("");
  const [exposureBasis, setExposureBasis] = useState("");
  const [exposureCurrency, setExposureCurrency] = useState("CAD");

  const openDecisions = latency.decisions.filter((d) => d.isOpen);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Timer className="h-4 w-4 text-signal-cyan" />}
      title="Decision latency, exposure and debt"
      subtitle="Spec §54: DL = DecisionDate − DecisionRequiredDate, with the critical-path impact of the delayed ones. Spec II.17: decision debt is what the decisions nobody has taken are expected to cost."
    >
      <ErrorLine error={error} />
      {/* THE PUBLISHED FIGURES COME OFF THE RECORDED RUN, not off the live
          read. These two lines used to render the live read directly above a
          lineage caption describing an older run — 213.6 days over two
          decisions under a caption for a run that measured 91.3 over one, with
          a clean code version and no staleness mark. That is the exact 4B
          failure this convention exists to prevent. The live read below
          supplies the ROWS, the refusals and the authoring controls; it does
          not supply a headline. */}
      <p className="text-sm text-slate-100">
        {recordedLatencyHeadline(latencyRun, latencyStale)}
      </p>
      <p className="text-sm text-slate-100">
        {recordedDebtHeadline(debtRun, debtStale)}
      </p>
      <p className="text-[11px] text-slate-500">
        Live read, for comparison — recompute to publish it:{" "}
        {decisionLatencyHeadline(latency)} {decisionDebtHeadline(debt)}
      </p>
      <Refusal text={latency.averageRefusal} />
      <Refusal text={debt.criticalPathCapableRefusal} />

      {latency.decisions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-3">Decision</th>
                <th className="py-1 pr-3">Due</th>
                <th className="py-1 pr-3">Latency (days)</th>
                <th className="py-1 pr-3">Critical path</th>
              </tr>
            </thead>
            <tbody>
              {latency.decisions.map((d) => (
                <tr key={d.decisionId} className="align-top text-slate-300">
                  <td className="py-1 pr-3">{d.question ?? d.decisionId}</td>
                  <td className="py-1 pr-3">{d.requiredDate ?? "—"}</td>
                  <td className="py-1 pr-3">
                    {d.latencyRefusal != null ? (
                      <span className="text-amber-200">unmeasurable</span>
                    ) : (
                      `${d.latencyDays} (${d.latencyKind})`
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    {d.onCriticalPath == null ? (
                      <span className="text-slate-500">unknown</span>
                    ) : d.onCriticalPath ? (
                      "yes"
                    ) : (
                      "no"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canPlan && openDecisions.length > 0 && (
        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            What is this decision holding up, and what will the delay cost?
          </p>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
          >
            <option value="">Open decision…</option>
            {openDecisions.map((d) => (
              <option key={d.decisionId} value={d.decisionId}>
                {d.question ?? d.decisionId}
              </option>
            ))}
          </select>
          {/* D3.13 — which activities the decision gates. Whether they are
              CRITICAL is read from P6's imported float, never recomputed. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={activityKey}
              onChange={(e) => setActivityKey(e.target.value)}
              placeholder="Schedule activity id it gates"
              className={inputClass}
            />
            <input
              value={linkBasis}
              onChange={(e) => setLinkBasis(e.target.value)}
              placeholder="Why it gates that activity"
              className={`${inputClass} sm:col-span-2`}
            />
          </div>
          <button
            disabled={busy || target === "" || activityKey === ""}
            className={btnClass}
            onClick={() =>
              void act(() =>
                linkDecisionToActivity({
                  decisionId: target,
                  activityKey,
                  basis: linkBasis,
                }),
              )
            }
          >
            Link to activity
          </button>
          {/* D3.21 — spec II.17 needs two numbers, and neither is derivable
              from anything the schema holds. They are STATED, with a basis. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="Expected impact if it slips"
              className={inputClass}
            />
            <input
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              placeholder="Probability of delay (0–1)"
              className={inputClass}
            />
            <input
              value={exposureBasis}
              onChange={(e) => setExposureBasis(e.target.value)}
              placeholder="What both were estimated from (20 characters minimum)"
              className={inputClass}
            />
          </div>
          <input
            value={exposureCurrency}
            onChange={(e) => setExposureCurrency(e.target.value.toUpperCase())}
            placeholder="Currency of the expected impact (e.g. CAD)"
            maxLength={3}
            className={inputClass}
          />
          <button
            disabled={
              busy || target === "" || impact === "" || probability === ""
            }
            className={btnClass}
            onClick={() =>
              void act(() =>
                recordDecisionDelayExposure({
                  decisionId: target,
                  expectedImpact: impact,
                  probabilityOfDelay: probability,
                  currency: exposureCurrency,
                  basis: exposureBasis,
                }),
              )
            }
          >
            State the delay exposure
          </button>
        </div>
      )}

      {canPlan && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            className={btnClass}
            onClick={() => void act(() => computeCaseDecisionLatency(caseId))}
          >
            Compute latency
          </button>
          <button
            disabled={busy}
            className={btnClass}
            onClick={() => void act(() => computeCaseDecisionDebt(caseId))}
          >
            Compute decision debt
          </button>
        </div>
      )}
      <LineageBlock run={latencyRun} stale={latencyStale} />
      <LineageBlock run={debtRun} stale={debtStale} />
    </Section>
  );
}

/* ═══════════════ D5.21 — the composed assurance engine ═══════════════ */

function AssuranceEngineSection({ engine }: { engine: CaseAssuranceEngine }) {
  const items = [
    ["Estimate quality", engine.constituents.estimateQuality],
    ["Schedule quality", engine.constituents.scheduleQuality],
    ["Progress integrity", engine.constituents.progressIntegrity],
    ["Independent challenge", engine.constituents.independentChallenge],
  ] as const;
  return (
    <Section
      icon={<ShieldCheck className="h-4 w-4 text-signal-cyan" />}
      title="Sync Assurance"
      subtitle="Estimate quality, schedule quality, progress integrity, independent challenge — composed from what each already recorded. Nothing here is computed a second time."
    >
      <p className="text-xs text-slate-400">
        {engine.constituentsLive} of {engine.constituentsTotal} constituents are
        live on this case.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map(([label, c]) => (
          <div
            key={label}
            className="rounded-lg border border-white/6 bg-white/[0.02] p-3"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {label}
            </p>
            {c.refusal != null ? (
              <p className="mt-1 text-xs text-amber-200">{c.refusal}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-300">
                {"run" in c && c.run != null
                  ? `Recorded ${new Date(c.run.computedAt).toLocaleDateString()} · ${c.run.status}`
                  : "Recorded on this case."}
              </p>
            )}
            {/* A REFUSED run used to render "Recorded <date> · refused" with
                no reasons at all, and was counted as a live constituent. The
                count is fixed in SQL; the reasons are shown here — the data
                was always in the payload. */}
            {"run" in c &&
              c.run != null &&
              c.run.status === "refused" &&
              (c.run.refusals ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/80">
                  {(c.run.refusals ?? []).slice(0, 3).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
          </div>
        ))}
      </div>
      <Refusal text={engine.compositeRefusal} />
    </Section>
  );
}

/* ═════════════ D13.08 — the Integrated Controls screen ═══════════════ */

function IntegratedControlsSection({
  controls,
}: {
  controls: CaseIntegratedControls;
}) {
  const stale: Record<string, boolean | null> = {};
  for (const dim of controls.dimensions) {
    const fp = dimensionFingerprint(dim, controls);
    // null means "this screen cannot check it" — NOT "checked and fresh".
    stale[dim.key] =
      fp == null ? null : performanceRunIsStale(dim.run ?? undefined, fp);
  }
  return (
    <Section
      icon={<LayoutGrid className="h-4 w-4 text-signal-cyan" />}
      title="Integrated Controls"
      subtitle="Spec §44: scope, schedule, cost, risk, change and procurement in one coherent view — every figure read from a recorded run, none of them computed here."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {controls.dimensions.map((dim) => {
          const d = dimensionDisplay(dim);
          return (
            <div
              key={dim.key}
              className="rounded-lg border border-white/6 bg-white/[0.02] p-3"
            >
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                {dim.label}
              </p>
              {d.state === "figures" ? (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-200">
                  {/* THE FIELDS THIS DIMENSION IS ABOUT, NAMED. This used to
                      be `Object.entries(outputs).slice(0, 5)` — and jsonb
                      orders keys by (length, bytewise), so the cost tile
                      showed ac/es/ev/pv/bac and silently dropped cpi, spi,
                      eac, vac and the currency. */}
                  {d.fields.map(({ key, value }) => (
                    <li key={key}>
                      <span className="text-slate-500">{key}: </span>
                      {value == null
                        ? "withheld"
                        : typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                    </li>
                  ))}
                  {d.otherFieldCount > 0 && (
                    <li className="text-slate-500">
                      +{d.otherFieldCount} further field
                      {d.otherFieldCount === 1 ? "" : "s"} on the recorded run
                    </li>
                  )}
                </ul>
              ) : (
                /* NO BLANK TILES. A dimension with no run says so. */
                <p className="mt-1 text-xs text-amber-200">{d.sentence}</p>
              )}
              {d.refusals.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/80">
                  {d.refusals.slice(0, 3).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {dim.run != null && (
                /* THE CAPTION SAYS WHETHER IT WAS CHECKED. Every tile used to
                   print `codeVersion · date` unconditionally: an earned-value
                   run from before three cost re-baselines rendered identically
                   to a fresh one, and the contingency tile printed a clean
                   caption directly above a section reading "the ledger has
                   moved since this run was recorded". Three states now, and
                   none of them looks like another. */
                <p
                  className={`mt-1 text-[11px] ${
                    stale[dim.key] === true
                      ? "text-amber-300"
                      : "text-slate-500"
                  }`}
                >
                  {stale[dim.key] === true
                    ? "superseded inputs — recompute"
                    : dim.stalenessCheckable
                      ? dim.run.codeVersion
                      : `${dim.run.codeVersion} · currency not checked here`}{" "}
                  · {new Date(dim.run.computedAt).toLocaleDateString()}
                </p>
              )}
              {dim.run != null && dim.stalenessNote != null && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {dim.stalenessNote}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">
        {controls.composedNotComputed}
      </p>
    </Section>
  );
}

/* ═══════════════════════════ the panel ═══════════════════════════════ */

export function ChangeAndControlsPanel({
  caseId,
  canPlan,
  canReview,
  reloadKey,
  baselines,
}: {
  caseId: string;
  canPlan: boolean;
  canReview: boolean;
  reloadKey?: number;
  baselines: { id: string; label: string }[];
}) {
  const [contingency, setContingency] = useState<CaseContingency | null>(null);
  const [change, setChange] = useState<CaseChangeControl | null>(null);
  const [latency, setLatency] = useState<CaseDecisionLatency | null>(null);
  const [debt, setDebt] = useState<CaseDecisionDebt | null>(null);
  const [engine, setEngine] = useState<CaseAssuranceEngine | null>(null);
  const [controls, setControls] = useState<CaseIntegratedControls | null>(null);
  const [delegations, setDelegations] = useState<AuthorityDelegations | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, ch, l, d, e, ic, ad] = await Promise.all([
        getCaseContingency(caseId),
        getCaseChangeControl(caseId),
        getCaseDecisionLatency(caseId),
        getCaseDecisionDebt(caseId),
        getCaseAssuranceEngine(caseId),
        getCaseIntegratedControls(caseId),
        getAuthorityDelegations("contingency_drawdown"),
      ]);
      setDelegations(ad);
      setContingency(c);
      setChange(ch);
      setLatency(l);
      setDebt(d);
      setEngine(e);
      setControls(ic);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error != null) {
    return (
      <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
        <ErrorLine error={error} />
      </div>
    );
  }
  if (
    contingency == null ||
    change == null ||
    latency == null ||
    debt == null ||
    engine == null ||
    controls == null ||
    delegations == null
  ) {
    return null;
  }

  const dim = (key: string) =>
    controls.dimensions.find((d) => d.key === key)?.run ?? null;
  const contingencyRun = dim("contingency");
  const changeRun = dim("change");

  return (
    <>
      <IntegratedControlsSection controls={controls} />
      {canPlan && (
        <AuthorityDelegationSection
          delegations={delegations}
          onChanged={() => void load()}
        />
      )}
      <ContingencySection
        caseId={caseId}
        contingency={contingency}
        run={contingencyRun}
        stale={performanceRunIsStale(
          contingencyRun ?? undefined,
          contingencyFingerprint(controls),
        )}
        canPlan={canPlan}
        onChanged={() => void load()}
        baselines={baselines}
      />
      <ChangeSection
        caseId={caseId}
        change={change}
        run={changeRun}
        stale={performanceRunIsStale(
          changeRun ?? undefined,
          changeFingerprint(controls),
        )}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
        baselines={baselines}
      />
      <DecisionSection
        caseId={caseId}
        latency={latency}
        debt={debt}
        latencyRun={controls.decisionLatency}
        debtRun={controls.decisionDebt}
        latencyStale={performanceRunIsStale(
          controls.decisionLatency ?? undefined,
          decisionLatencyFingerprint(controls),
        )}
        debtStale={performanceRunIsStale(
          controls.decisionDebt ?? undefined,
          decisionDebtFingerprint(controls),
        )}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <AssuranceEngineSection engine={engine} />
    </>
  );
}
