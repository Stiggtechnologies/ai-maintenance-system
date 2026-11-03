/**
 * AccountabilityCascade — delegation of authority and the board record
 * (capability register E4.03, E4.02/E4.12).
 *
 * Two things a board actually asks for and the platform could not answer:
 *
 *   1. "Up to what amount may each layer commit us?" The decision-rights
 *      matrix named which ROLE approves but never up to what VALUE.
 *   2. "What were we told, and when?" A live dashboard is not a governance
 *      record — it changes after the meeting.
 *
 * The general ladder has no platform amount. A named human states commitment,
 * risk and downtime; a different named human adopts. Only ADOPTED limits are
 * enforced. An unstated draft blocks nothing, and the panel says "Not stated"
 * rather than showing a placeholder figure.
 */
import { useState } from "react";
import { Scale, FileCheck2, Lock, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import {
  adoptAuthorityLimit,
  stateGeneralDelegation,
  type GeneralCommitment,
  type GeneralDowntime,
  type GeneralRisk,
} from "../services/stage1PilotPack";

interface Limit {
  id: string;
  role_key: string;
  tier_label: string;
  max_commitment_usd: number | null;
  max_commitment_currency: string | null;
  max_risk_level: string | null;
  max_production_downtime_hours: number | null;
  commitment_stated: boolean;
  risk_stated: boolean;
  downtime_stated: boolean;
  ceilings_stated_by: string | null;
  escalates_to_role: string | null;
  basis: string;
  status: "draft" | "adopted";
  adopted_at: string | null;
}

interface Pack {
  id: string;
  period_label: string;
  period_end: string;
  status: "draft" | "attested" | "superseded";
  attested_at: string | null;
  attestation_note: string | null;
  kpi_count: number;
  measured_count: number;
  governance: Record<string, number>;
}

interface Cascade {
  role: string;
  viewer_id: string | null;
  limits: Limit[];
  enforcement_note: string;
  packs: Pack[];
}

const money = (limit: Limit) => {
  if (!limit.commitment_stated && limit.status !== "adopted")
    return "Not stated";
  if (limit.max_commitment_usd === null) return "Unlimited — stated";
  const currency = limit.max_commitment_currency ?? "";
  if (limit.max_commitment_usd === 0) {
    return currency ? `No spend authority (${currency})` : "No spend authority";
  }
  return `${currency} ${limit.max_commitment_usd.toLocaleString()}`.trim();
};

const GOV_LABEL: Record<string, string> = {
  recommendations_raised: "Recommendations raised",
  recommendations_approved: "Approved",
  safety_gates_pending: "Safety gates pending",
  authority_limits_adopted: "Authority limits adopted",
  authority_limits_draft: "Authority limits still draft",
  taxonomy_definitions_adopted: "Taxonomy definitions adopted",
};

export function AccountabilityCascade() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [limitId, setLimitId] = useState("");
  const [instrument, setInstrument] = useState("");
  const [commitmentMode, setCommitmentMode] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [riskMode, setRiskMode] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [downtimeMode, setDowntimeMode] = useState("");
  const [downtimeHours, setDowntimeHours] = useState("");
  const { data, loading, error, refetch } = useAsyncData<Cascade>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_accountability_cascade",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Cascade;
  }, []);

  async function preparePack() {
    setBusy(true);
    setMsg(null);
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 3);
    const q = `Q${Math.floor(end.getMonth() / 3) + 1} ${end.getFullYear()}`;
    const { data: r, error: e } = await supabase.rpc("generate_board_pack", {
      p_period_label: q,
      p_period_start: start.toISOString().slice(0, 10),
      p_period_end: end.toISOString().slice(0, 10),
    });
    setBusy(false);
    const res = r as {
      error?: string;
      kpis?: number;
      measured?: number;
    } | null;
    if (e || res?.error) {
      setMsg(e?.message ?? res?.error ?? "Could not prepare the pack");
      return;
    }
    setMsg(
      `Prepared ${q}: ${res?.measured} of ${res?.kpis} board-tier KPIs measured.`,
    );
    refetch();
  }

  const drafts = (data?.limits ?? []).filter((l) => l.status === "draft");
  const selected = drafts.find((l) => l.id === limitId) ?? null;
  const canAdopt = ["executive", "admin"].includes(data?.role ?? "");

  const commitmentReady =
    commitmentMode === "unlimited" ||
    (commitmentMode === "none" && currency.length === 3) ||
    (commitmentMode === "amount" &&
      amount.trim() !== "" &&
      currency.length === 3);
  const riskReady =
    riskMode === "unlimited" || (riskMode === "ceiling" && riskLevel !== "");
  const downtimeReady =
    downtimeMode === "unlimited" ||
    (downtimeMode === "hours" && downtimeHours.trim() !== "");
  const samePerson =
    selected?.ceilings_stated_by != null &&
    selected.ceilings_stated_by === data?.viewer_id;

  async function stateCeiling() {
    if (!selected || !commitmentReady || !riskReady || !downtimeReady) return;
    const commitment: GeneralCommitment =
      commitmentMode === "unlimited"
        ? { mode: "unlimited" }
        : commitmentMode === "none"
          ? { mode: "none", currency }
          : { mode: "amount", amount: amount.trim(), currency };
    const risk: GeneralRisk =
      riskMode === "unlimited"
        ? { mode: "unlimited" }
        : { mode: "ceiling", level: riskLevel };
    const downtime: GeneralDowntime =
      downtimeMode === "unlimited"
        ? { mode: "unlimited" }
        : { mode: "hours", hours: downtimeHours.trim() };
    setBusy(true);
    setMsg(null);
    try {
      await stateGeneralDelegation({
        limitId: selected.id,
        basis: instrument,
        commitment,
        risk,
        downtime,
      });
      setMsg(
        `Stated ${selected.tier_label}. A different named human adopts it before it is enforced.`,
      );
      refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not state the ceiling");
    } finally {
      setBusy(false);
    }
  }

  async function adoptLimit() {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adoptAuthorityLimit({
        limitId: selected.id,
        note: instrument,
      });
      setMsg(`Adopted ${r.role_key}. Only adopted limits are enforced.`);
      setInstrument("");
      refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not adopt the limit");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return <LoadingState label="Loading the accountability cascade" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const limits = data?.limits ?? [];
  const packs = data?.packs ?? [];
  const adopted = limits.filter((l) => l.status === "adopted").length;
  const canPrepare = ["executive", "admin", "ai_admin"].includes(
    data?.role ?? "",
  );

  return (
    <section aria-labelledby="cascade-heading" className="space-y-4">
      <div>
        <h2
          id="cascade-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Scale className="h-5 w-5 text-signal-gold" aria-hidden />
          Delegation of Authority
          <span className="text-xs font-normal text-slate-500">
            {adopted}/{limits.length} adopted
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">{data?.enforcement_note}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <caption className="sr-only">
            Commitment, risk and downtime ceilings by organizational layer
          </caption>
          <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Layer
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Commitment
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Max risk
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Downtime
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Escalates to
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {limits.map((l) => (
              <tr key={l.id} className="border-t border-white/6 align-top">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-200">{l.tier_label}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {l.role_key}
                  </p>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {money(l)}
                </td>
                <td className="px-4 py-2.5 text-slate-300">
                  {!l.risk_stated && l.status !== "adopted"
                    ? "Not stated"
                    : (l.max_risk_level ?? "Unlimited — stated")}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {!l.downtime_stated && l.status !== "adopted"
                    ? "Not stated"
                    : l.max_production_downtime_hours === null
                      ? "Unlimited — stated"
                      : `${l.max_production_downtime_hours} h`}
                </td>
                <td className="px-4 py-2.5 text-slate-400">
                  {l.escalates_to_role?.replace(/_/g, " ") ?? "Reserved matter"}
                </td>
                <td className="px-4 py-2.5">
                  {l.status === "adopted" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-300">
                      <Lock className="h-3 w-3" aria-hidden />
                      Enforced
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                      <TriangleAlert className="h-3 w-3" aria-hidden />
                      Draft
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {limits.some(
        (l) =>
          l.status === "draft" &&
          (!l.commitment_stated || !l.risk_stated || !l.downtime_stated),
      ) && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          Unstated layers have no commitment, risk or downtime ceiling. The
          platform does not supply one. A named human states every dimension
          from your delegation instrument, and a different named human adopts
          it. Nothing is enforced until then.
        </p>
      )}

      <div
        data-testid="stage1-doa-adopt"
        className="rounded-xl border border-white/8 bg-black/20 p-4"
      >
        <h3 className="text-sm font-semibold text-white">
          State and adopt a delegation limit
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          AI cannot state or adopt. Every dimension is required: leaving a field
          blank does not keep a previous figure and does not invent one. The
          person who states the ceiling cannot be the person who adopts it.
        </p>
        {!canAdopt ? (
          <p className="mt-3 text-xs text-amber-200/90">
            An executive or administrator must state and adopt. Your role (
            {data?.role ?? "unknown"}) can read the ladder, not install it.
          </p>
        ) : drafts.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">
            No draft limits remain. Adopted rows are immutable — draft a
            replacement through the existing ceiling door if the instrument
            changes.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-slate-400">
              Draft layer
              <select
                data-testid="stage1-doa-limit"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={limitId}
                onChange={(e) => setLimitId(e.target.value)}
              >
                <option value="">Select a draft layer…</option>
                {drafts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.tier_label} ({l.role_key})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-400">
              Delegation instrument (20+ characters)
              <input
                data-testid="stage1-doa-note"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                placeholder="Name the instrument this limit comes from"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Commitment
              <select
                data-testid="stage1-doa-commitment-mode"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={commitmentMode}
                onChange={(e) => setCommitmentMode(e.target.value)}
              >
                <option value="">Choose…</option>
                <option value="amount">Stated amount</option>
                <option value="none">No spend authority</option>
                <option value="unlimited">Unlimited — stated</option>
              </select>
            </label>
            {commitmentMode === "amount" && (
              <label className="block text-xs text-slate-400">
                Amount
                <input
                  data-testid="stage1-doa-ceiling"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="Amount from the instrument"
                />
              </label>
            )}
            {(commitmentMode === "amount" || commitmentMode === "none") && (
              <label className="block text-xs text-slate-400">
                Currency
                <input
                  data-testid="stage1-doa-currency"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="ISO code"
                />
              </label>
            )}
            <label className="block text-xs text-slate-400">
              Risk ceiling
              <select
                data-testid="stage1-doa-risk-mode"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={riskMode}
                onChange={(e) => setRiskMode(e.target.value)}
              >
                <option value="">Choose…</option>
                <option value="ceiling">Stated level</option>
                <option value="unlimited">Unlimited — stated</option>
              </select>
            </label>
            {riskMode === "ceiling" && (
              <label className="block text-xs text-slate-400">
                Risk level
                <select
                  data-testid="stage1-doa-risk-level"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {["Low", "Medium", "High", "Critical"].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-xs text-slate-400">
              Downtime
              <select
                data-testid="stage1-doa-downtime-mode"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={downtimeMode}
                onChange={(e) => setDowntimeMode(e.target.value)}
              >
                <option value="">Choose…</option>
                <option value="hours">Stated hours</option>
                <option value="unlimited">Unlimited — stated</option>
              </select>
            </label>
            {downtimeMode === "hours" && (
              <label className="block text-xs text-slate-400">
                Hours
                <input
                  data-testid="stage1-doa-downtime-hours"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                  value={downtimeHours}
                  onChange={(e) => setDowntimeHours(e.target.value)}
                  inputMode="decimal"
                  placeholder="Hours from the instrument"
                />
              </label>
            )}
          </div>
        )}
        {canAdopt && drafts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="stage1-doa-state"
              disabled={
                busy ||
                !selected ||
                !commitmentReady ||
                !riskReady ||
                !downtimeReady ||
                instrument.trim().length < 20
              }
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40"
              onClick={() => void stateCeiling()}
            >
              State ceiling
            </button>
            <button
              type="button"
              data-testid="stage1-doa-adopt-btn"
              disabled={
                busy ||
                !selected ||
                !selected.commitment_stated ||
                !selected.risk_stated ||
                !selected.downtime_stated ||
                samePerson ||
                instrument.trim().length < 10
              }
              className="rounded-lg bg-teal-500/90 px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40"
              onClick={() => void adoptLimit()}
            >
              Adopt limit
            </button>
          </div>
        )}
        {samePerson && (
          <p className="mt-2 text-xs text-amber-200/90">
            You stated this ceiling. A different named administrator or
            executive has to adopt it.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <FileCheck2 className="h-4.5 w-4.5 text-signal-cyan" aria-hidden />
          Board packs
          <span className="text-xs font-normal text-slate-500">
            frozen at preparation, immutable once attested
          </span>
        </h3>
        {canPrepare && (
          <button
            onClick={preparePack}
            disabled={busy}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Prepare this quarter"}
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-slate-300">{msg}</p>}

      {packs.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No board pack has been prepared. A pack freezes the board- and
          executive-tier KPIs with their full RACI chain and records which
          figures were measured versus still awaiting a source.
        </p>
      ) : (
        <ul className="space-y-2">
          {packs.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-200">{p.period_label}</p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    p.status === "attested"
                      ? "border-green-500/30 bg-green-500/10 text-green-300"
                      : "border-slate-600 bg-slate-800/60 text-slate-400"
                  }`}
                >
                  {p.status === "attested" ? "Attested" : "Draft"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {p.measured_count} of {p.kpi_count} board-tier KPIs measured
                {p.attested_at &&
                  ` · attested ${new Date(p.attested_at).toLocaleDateString()}`}
              </p>
              {p.attestation_note && (
                <p className="mt-1 text-xs italic text-slate-500">
                  “{p.attestation_note}”
                </p>
              )}
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                {Object.entries(p.governance ?? {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-slate-500">{GOV_LABEL[k] ?? k}</dt>
                    <dd className="font-mono text-slate-300 tabular-nums">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
