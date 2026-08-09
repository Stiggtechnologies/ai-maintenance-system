/**
 * SupplyExposure — who supplies it, and what happens when they cannot
 * (capability register E7.01–E7.14).
 *
 * The three lists are kept apart on purpose. "One approved supplier" is a risk
 * to carry or mitigate; "one recorded, none approved" is a sourcing job half
 * done; "no supplier at all" is a lead time nobody can be held to. Merging
 * them produces a list nobody can action.
 *
 * The bid comparison shows its refusal rather than hiding it: where a bid
 * states no productivity assumption, the panel names the cheapest price and
 * says in the same breath that this is a fact about the prices and not a
 * recommendation.
 */
import { useMemo, useState } from "react";
import { Truck, Info, TriangleAlert, Scale, CalendarClock } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  soleSourceRisk,
  assessObsolescence,
  compareBids,
  type SourceCount,
  type ObsolescenceInput,
  type LifecycleStatus,
  type Bid,
  type PackageClarity,
} from "../lib/supply";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  suppliers_total: number;
  approved_vendors: number;
  safety_qual_expired: number;
  sole_approved_source: number;
  unassessed_advisories: number;
  mandatory_overdue_advisories: number;
  open_suspect_parts: number;
  unclaimed_warranty_candidates: number;
  basis: string;
}

interface ExposureRow {
  material_code: string;
  description: string;
  criticality: string | null;
  lead_time_days: number | null;
  approved_suppliers: number;
  recorded_suppliers: number;
  worst_lifecycle: string;
  last_time_buy_date: string | null;
  assets_using: number;
}

interface BidsPayload extends PackageClarity {
  packageCode: string;
  title: string;
  bids: Bid[];
}

/** The SQL orders lifecycle with a sort prefix; strip it back to the value. */
function lifecycleOf(v: string): LifecycleStatus {
  return (v?.split("_").slice(1).join("_") || "unknown") as LifecycleStatus;
}

export function SupplyExposure() {
  const [showAll, setShowAll] = useState(false);

  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    exposure: ExposureRow[];
    bids: BidsPayload | null;
  }>(async () => {
    const [p, e, b] = await Promise.all([
      supabase.rpc("get_supply_posture"),
      supabase.rpc("get_supply_exposure", { p_limit: 25 }),
      supabase.rpc("get_package_bids", { p_package_code: "DEMO-PKG-01" }),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (e.error) throw new Error(e.error.message);
    if (b.error) throw new Error(b.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      exposure: (e.data as ExposureRow[]) ?? [],
      bids: (b.data as BidsPayload) ?? null,
    };
  }, []);

  const rows = useMemo(() => data?.exposure ?? [], [data]);

  const sole = useMemo(() => {
    const counts: SourceCount[] = rows.map((r) => ({
      materialCode: r.material_code,
      criticality: r.criticality,
      leadTimeDays: r.lead_time_days,
      approvedSuppliers: Number(r.approved_suppliers),
      recordedSuppliers: Number(r.recorded_suppliers),
    }));
    return soleSourceRisk(counts);
  }, [rows]);

  const obsolescence = useMemo(() => {
    const items: ObsolescenceInput[] = rows.map((r) => ({
      materialCode: r.material_code,
      description: r.description,
      lifecycleStatus: lifecycleOf(r.worst_lifecycle),
      lastTimeBuyDate: r.last_time_buy_date,
      // Remaining asset life is not recorded per material, and the engine is
      // built to say so rather than guess it.
      assetRemainingLifeYears: null,
      assetsUsing: Number(r.assets_using),
      criticality: r.criticality,
    }));
    return assessObsolescence(items, new Date()).filter(
      (o) => o.urgency !== "none",
    );
  }, [rows]);

  const bidResult = useMemo(() => {
    const b = data?.bids;
    if (!b || !b.bids) return null;
    return compareBids(b.bids, {
      scopeStated: b.scopeStated,
      exclusionsStated: b.exclusionsStated,
      acceptanceStated: b.acceptanceStated,
      siteConditionsStated: b.siteConditionsStated,
    });
  }, [data]);

  if (loading) return <LoadingState label="Loading supply exposure" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;

  return (
    <section aria-labelledby="supply-heading" className="space-y-4">
      <div>
        <h2
          id="supply-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Truck className="h-5 w-5 text-signal-cyan" aria-hidden />
          Supply Exposure
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A lead time is only a commitment if somebody is behind it.
        </p>
      </div>

      {posture && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            posture.mandatory_overdue_advisories > 0
              ? "border-rose-500/30 bg-rose-500/5 text-rose-100"
              : "border-white/6 bg-white/2 text-slate-300"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{posture.basis}</p>
            <p className="mt-1 text-xs text-slate-500">
              {posture.unassessed_advisories} unassessed vendor advisory/ies ·{" "}
              {posture.open_suspect_parts} open suspect-part case(s) ·{" "}
              {posture.unclaimed_warranty_candidates} work order(s) inside a
              warranty period with no claim raised.
            </p>
          </div>
        </div>
      )}

      {/* Sole source — three buckets, kept apart. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <TriangleAlert className="h-4 w-4 text-amber-400" aria-hidden />
          Sole-source exposure
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {sole.reason}
        </p>
        {sole.soleApproved.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">
                Materials with exactly one approved supplier
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Material
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Criticality
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Lead time
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Recorded / approved
                  </th>
                </tr>
              </thead>
              <tbody>
                {sole.soleApproved.map((s) => (
                  <tr key={s.materialCode} className="border-t border-white/6">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-200">
                      {s.materialCode}
                    </td>
                    <td className="py-2 pr-4 text-slate-400">
                      {s.criticality ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-300 tabular-nums">
                      {s.leadTimeDays ?? "—"} d
                    </td>
                    <td className="py-2 font-mono text-slate-400 tabular-nums">
                      {s.recordedSuppliers} / {s.approvedSuppliers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(sole.unfinishedSourcing.length > 0 || sole.noSource.length > 0) && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
            className="mt-3 text-xs text-signal-cyan hover:underline"
          >
            {showAll ? "Hide" : "Show"} the {sole.unfinishedSourcing.length}{" "}
            unfinished and {sole.noSource.length} unsourced
          </button>
        )}
        {showAll && (
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {sole.unfinishedSourcing.map((s) => (
              <li key={s.materialCode}>
                <span className="font-mono text-slate-300">
                  {s.materialCode}
                </span>{" "}
                — supplier recorded, none approved for the part.
              </li>
            ))}
            {sole.noSource.map((s) => (
              <li key={s.materialCode}>
                <span className="font-mono text-slate-300">
                  {s.materialCode}
                </span>{" "}
                — no supplier at all.
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Obsolescence. */}
      {obsolescence.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock className="h-4 w-4 text-signal-cyan" aria-hidden />
            Obsolescence
          </h3>
          <ul className="mt-2 space-y-2">
            {obsolescence.map((o) => (
              <li key={o.materialCode} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-slate-200">
                    {o.materialCode}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs uppercase tracking-wide ${
                      o.urgency === "urgent"
                        ? "bg-rose-500/10 text-rose-300"
                        : o.urgency === "act"
                          ? "bg-amber-500/10 text-amber-300"
                          : "bg-white/5 text-slate-400"
                    }`}
                  >
                    {o.urgency}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {o.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bid comparison, refusal included. */}
      {bidResult && data?.bids && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Scale className="h-4 w-4 text-signal-cyan" aria-hidden />
            {data.bids.title}
          </h3>
          <p
            className={`mt-1 text-xs leading-relaxed ${bidResult.comparable ? "text-slate-400" : "text-amber-300"}`}
          >
            {bidResult.reason}
          </p>
          {bidResult.bids.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Bids received</caption>
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Supplier
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Price
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Hours / factor
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Per normalised hour
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bidResult.bids.map((b) => (
                    <tr key={b.supplier} className="border-t border-white/6">
                      <td className="py-2 pr-4 text-slate-200">
                        {b.supplier}{" "}
                        {b.supplier === bidResult.bestValue && (
                          <span className="ml-2 text-xs text-signal-cyan">
                            best value
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-300 tabular-nums">
                        ${b.price.toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-400 tabular-nums">
                        {b.labourHours ?? "—"} /{" "}
                        {b.assumedProductivityFactor ?? "not stated"}
                      </td>
                      <td className="py-2 font-mono text-slate-300 tabular-nums">
                        {b.pricePerNormalisedHour !== null
                          ? `$${b.pricePerNormalisedHour.toFixed(2)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
