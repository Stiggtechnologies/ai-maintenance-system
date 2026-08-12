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
 * Authority limits ship as DRAFTS. Only ADOPTED limits are enforced by the
 * database trigger, so a placeholder ceiling can never silently block a real
 * approval — and the panel says so rather than implying the numbers are the
 * organization's own delegation instrument.
 */
import { useState } from "react";
import { Scale, FileCheck2, Lock, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Limit {
  id: string;
  role_key: string;
  tier_label: string;
  max_commitment_usd: number | null;
  max_risk_level: string | null;
  max_production_downtime_hours: number | null;
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
  limits: Limit[];
  enforcement_note: string;
  packs: Pack[];
}

const money = (v: number | null) =>
  v === null
    ? "No ceiling"
    : v === 0
      ? "No spend authority"
      : `$${v.toLocaleString()}`;

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
                  {money(l.max_commitment_usd)}
                </td>
                <td className="px-4 py-2.5 text-slate-300">
                  {l.max_risk_level ?? "—"}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {l.max_production_downtime_hours === null
                    ? "—"
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

      {adopted === 0 && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          Every ceiling above is a <strong>proposal</strong>, not your approved
          delegation of authority — the amounts are placeholders drawn from the
          decision-rights tiers. Nothing is enforced until an executive replaces
          them with the figures from your delegation instrument and adopts them.
        </p>
      )}

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
