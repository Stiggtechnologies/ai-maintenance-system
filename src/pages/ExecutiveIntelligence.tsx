/**
 * Executive Asset Intelligence — the single-screen ISO 55000 KPI dashboard.
 *
 * Value · OEE · Risk · Cost · AI — with per-KPI RACI ownership, target
 * status, variance, confidence and computation lineage. The KPI list is
 * access-controlled server-side (get_kpi_dashboard): each role receives
 * only the KPIs in its audience. Breached KPIs raise RACI-routed
 * recommendations on the operating loop automatically.
 */
import { useMemo } from "react";
import { SegmentedReliability } from "../components/SegmentedReliability";
import { WorkManagementHealth } from "../components/WorkManagementHealth";
import { OperatingContext } from "../components/OperatingContext";
import { AccountabilityCascade } from "../components/AccountabilityCascade";
import {
  Gauge,
  ShieldAlert,
  Sparkles,
  Landmark,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import { ValueManagement } from "../components/ValueManagement";
import {
  getKpiDashboard,
  formatKpiValue,
  KPI_PAGES,
  type KpiDashboard,
  type KpiRow,
} from "../services/kpiService";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

/** Which organizational layer owns the metric — board through crew. */
const TIER_STYLE: Record<string, string> = {
  board: "bg-signal-gold/15 text-signal-gold border border-signal-gold/30",
  executive: "bg-signal-cyan/10 text-signal-cyan border border-signal-cyan/25",
  functional: "bg-white/5 text-slate-300 border border-white/10",
  site: "bg-white/[0.03] text-slate-400 border border-white/6",
};

const STATUS_STYLE: Record<string, string> = {
  on_target: "bg-green-500/10 text-green-300 border-green-500/30",
  watch: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  breach: "bg-red-500/10 text-red-300 border-red-500/30",
  // Deliberately neutral, never green: the value is real but no threshold
  // exists to call it a pass. See 20260908090000 — an unmeasured number shown
  // as success is the failure this platform refuses everywhere else.
  not_assessed: "bg-white/5 text-slate-400 border-white/10",
};

const HEADLINE_KEYS = [
  "asset_value_realization",
  "oee",
  "asset_risk_index",
  "cost_of_downtime",
  "ai_recommendations_implemented",
];

function KpiCard({ row }: { row: KpiRow }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">{row.name}</p>
        {row.status ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_STYLE[row.status]}`}
          >
            {row.status === "on_target"
              ? "On target"
              : row.status === "watch"
                ? "Watch"
                : row.status === "not_assessed"
                  ? "No target — trend only"
                  : "Breach"}
          </span>
        ) : (
          <span className="rounded-full border border-slate-600 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-400 whitespace-nowrap">
            Awaiting source
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-white">
          {formatKpiValue(row)}
        </span>
        <span className="text-xs text-slate-400">
          target {row.target_label}
        </span>
      </div>
      <p
        className="mt-1 text-xs text-slate-400"
        title={row.computed_from?.source ?? row.formula}
      >
        {row.computable
          ? (row.computed_from?.source ?? row.formula)
          : `Connects with: ${row.source_note}`}
      </p>
      {/* The complete RACI chain. Consulted and Informed were populated on
          every catalog row but were dropped by get_kpi_dashboard, so the
          extended half of the accountability chain never reached a human. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TIER_STYLE[row.accountability_tier ?? "site"]}`}
        >
          {row.accountability_tier ?? "site"}
        </span>
        <span title="Accountable — owns the outcome">
          <span className="text-slate-500">A</span> {row.accountable}
        </span>
        <span aria-hidden>·</span>
        <span title="Responsible — does the work">
          <span className="text-slate-500">R</span> {row.responsible}
        </span>
        {row.consulted && (
          <>
            <span aria-hidden>·</span>
            <span title="Consulted — two-way input before the decision">
              <span className="text-slate-500">C</span> {row.consulted}
            </span>
          </>
        )}
        {row.informed && (
          <>
            <span aria-hidden>·</span>
            <span title="Informed — told after the decision">
              <span className="text-slate-500">I</span> {row.informed}
            </span>
          </>
        )}
        {row.confidence && (
          <>
            <span aria-hidden>·</span>
            <span>{row.confidence} confidence</span>
          </>
        )}
      </div>
    </div>
  );
}

export function ExecutiveIntelligence() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAsyncData<KpiDashboard>(
    () => getKpiDashboard(),
    [],
  );
  const { live } = useRealtimeRefetch(["kpi_values"], refetch);

  const kpis = useMemo(() => data?.kpis ?? [], [data]);
  const headline = HEADLINE_KEYS.map((k) =>
    kpis.find((r) => r.kpi_key === k),
  ).filter(Boolean) as KpiRow[];
  const breaches = kpis.filter((r) => r.status === "breach");

  if (loading) return <LoadingState label="Loading ISO 55000 KPI dashboard" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (kpis.length === 0)
    return (
      <EmptyState message="No KPIs are visible to your role yet — the KPI service publishes hourly." />
    );

  return (
    <div className="space-y-6 p-6" data-testid="executive-intelligence">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-teal-300" aria-hidden />
            <h1 className="text-2xl font-semibold text-white">
              Executive Asset Intelligence
            </h1>
            <LiveBadge live={live} />
          </div>
          <p className="mt-1 text-sm text-slate-300">
            ISO 55000 KPI truth with RACI ownership — computed hourly from live
            operating data, breaches routed to owners automatically.
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Access-controlled view: {kpis.length} KPIs visible to the{" "}
            {data?.role.replace(/_/g, " ")} role.
          </p>
        </div>
        {breaches.length > 0 && (
          <button
            onClick={() => navigate("/mission-control")}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-red-300"
          >
            <ShieldAlert className="h-4 w-4" aria-hidden />
            {breaches.length} KPI breach{breaches.length > 1 ? "es" : ""} —
            review actions
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Headline strip: Value · OEE · Risk · Cost · AI */}
      {headline.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {headline.map((row) => (
            <div
              key={row.kpi_key}
              className={`rounded-xl border p-4 ${STATUS_STYLE[row.status ?? "on_target"] ?? "border-white/6"}`}
            >
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                {row.kpi_key === "oee" ? (
                  <Gauge className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {row.name}
              </div>
              <p className="mt-1 text-2xl font-bold text-white">
                {formatKpiValue(row)}
              </p>
              <p className="text-xs text-slate-400">
                target {row.target_label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Seven standard pages */}
      {KPI_PAGES.map((page) => {
        const rows = kpis.filter((r) => r.page === page.key);
        if (rows.length === 0) return null;
        return (
          <section key={page.key}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              {page.label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <KpiCard key={row.kpi_key} row={row} />
              ))}
            </div>
          </section>
        );
      })}

      <OperatingContext />

      <WorkManagementHealth />
      <SegmentedReliability />
      <AccountabilityCascade />
      <ValueManagement />
    </div>
  );
}
