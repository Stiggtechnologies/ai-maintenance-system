import { Activity, AlertTriangle, Factory, Wrench } from "lucide-react";
import { useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import { loadAssetOperationalMonitor } from "../services/assetOperationalMonitorService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

function number(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "No evidence in window";
}

export function AssetOperationalMonitor({ assetId }: { assetId: string }) {
  const [windowDays, setWindowDays] = useState(90);
  const { data, loading, error, refetch } = useAsyncData(
    () => loadAssetOperationalMonitor(assetId, windowDays),
    [assetId, windowDays],
  );

  if (loading && !data)
    return <LoadingState label="Reconciling asset operational evidence" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const condition = data.condition.summary;
  const work = data.work.summary;
  const production = data.production.summary;
  const risk = data.risk.summary;

  return (
    <section
      aria-labelledby="asset-operational-monitor-heading"
      className="space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2
            id="asset-operational-monitor-heading"
            className="text-lg font-semibold text-industrial-text"
          >
            Operational evidence monitor
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            One exact-asset view of condition, work history, demonstrated
            production impact and emerging risk. Missing inputs stay visible;
            this read-only monitor cannot create work, approve action or accept
            risk.
          </p>
        </div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Evidence window
          <select
            aria-label="Operational evidence window"
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
            className="ml-2 rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>365 days</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EvidenceCard
          icon={<Activity className="h-4 w-4" aria-hidden />}
          label="Condition"
          primary={`${condition.readings.toLocaleString()} readings`}
          secondary={`${condition.openAlerts} open alerts · ${condition.suspectOrBadReadings} quality exceptions`}
          freshness={when(condition.latestReadingAt)}
          tone={condition.alarmAlerts > 0 ? "danger" : "cyan"}
        />
        <EvidenceCard
          icon={<Wrench className="h-4 w-4" aria-hidden />}
          label="Work history"
          primary={`${work.openOrders} open / ${work.completedOrders} complete`}
          secondary={`${work.correctiveOrders} corrective · ${work.safetyFlagged} safety flagged`}
          freshness={when(work.latestActivityAt)}
          tone={work.safetyFlagged > 0 ? "warning" : "cyan"}
        />
        <EvidenceCard
          icon={<Factory className="h-4 w-4" aria-hidden />}
          label="Production impact"
          primary={
            production.measurementState === "demonstrated_rate"
              ? `${number(production.estimatedUnitsLost)} ${production.unitOfMeasure ?? "units"} at risk`
              : "Not measurable"
          }
          secondary={
            production.measurementRefusal ??
            `${number(production.downHours)} down h · ${number(production.demonstratedRate, 3)} ${production.unitOfMeasure ?? "units"}/running h`
          }
          freshness={when(production.latestProductionAt)}
          tone={production.downHours > 0 ? "warning" : "cyan"}
        />
        <EvidenceCard
          icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
          label="Emerging risk"
          primary={`${risk.emergingRisks} visible signals`}
          secondary={`${risk.warningIndicators} warning · ${risk.criticalIndicators} critical`}
          freshness={when(risk.latestSignalAt)}
          tone={
            risk.criticalIndicators > 0
              ? "danger"
              : risk.warningIndicators > 0
                ? "warning"
                : "cyan"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <EvidenceList
          title="Recent condition evidence"
          empty="No condition evidence in this window."
        >
          {data.condition.readings.slice(0, 8).map((reading) => (
            <li
              key={reading.id}
              className="flex items-start justify-between gap-4 py-2"
            >
              <div>
                <div className="text-sm font-medium text-slate-200">
                  {reading.sensor}
                  {reading.signalType ? ` · ${reading.signalType}` : ""}
                </div>
                <div className="text-xs text-slate-500">
                  {when(reading.takenAt)} · {reading.quality}
                  {reading.sourceSystem ? ` · ${reading.sourceSystem}` : ""}
                </div>
              </div>
              <div className="shrink-0 font-mono text-sm text-slate-200">
                {number(reading.value, 3)} {reading.unit ?? ""}
              </div>
            </li>
          ))}
        </EvidenceList>

        <EvidenceList
          title="Recent work history"
          empty="No work history in this window."
        >
          {data.work.orders.slice(0, 8).map((order) => (
            <li
              key={order.id}
              className="flex items-start justify-between gap-4 py-2"
            >
              <div>
                <div className="text-sm font-medium text-slate-200">
                  {order.number ? `${order.number} · ` : ""}
                  {order.title}
                </div>
                <div className="text-xs text-slate-500">
                  {order.workType ?? "unclassified work"} · {order.priority}
                  {order.safetyFlag ? " · safety flagged" : ""}
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
                {order.status?.replaceAll("_", " ")}
              </span>
            </li>
          ))}
        </EvidenceList>

        <EvidenceList
          title="Operating-state evidence"
          empty="No operating-state evidence in this window."
        >
          {data.production.states.slice(0, 8).map((state) => (
            <li
              key={state.id}
              className="flex items-start justify-between gap-4 py-2"
            >
              <div>
                <div className="text-sm font-medium capitalize text-slate-200">
                  {state.state.replaceAll("_", " ")}
                </div>
                <div className="text-xs text-slate-500">
                  {when(state.startedAt)}
                  {state.reasonCode ? ` · ${state.reasonCode}` : ""}
                  {state.sourceSystem ? ` · ${state.sourceSystem}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-xs text-slate-400">
                {state.loadPct === null
                  ? "load unknown"
                  : `${number(state.loadPct)}% load`}
              </div>
            </li>
          ))}
        </EvidenceList>

        <EvidenceList
          title="Emerging-risk evidence"
          empty="No sensitivity-authorized emerging-risk signals in this window."
        >
          {data.risk.risks.slice(0, 8).map((item) => (
            <li key={item.id} className="py-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    {item.title}
                  </div>
                  <div className="text-xs text-slate-500">
                    {item.level ?? "level not assigned"} · score{" "}
                    {number(item.score)} · velocity {number(item.velocity)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
                  {item.decisionAction ?? "MONITOR"}
                </span>
              </div>
              {item.indicators.length > 0 && (
                <div className="mt-2 text-xs text-slate-400">
                  {item.indicators
                    .map(
                      (indicator) =>
                        `${indicator.name}: ${number(indicator.value)} ${indicator.unit ?? ""} (${indicator.state})`,
                    )
                    .join(" · ")}
                </div>
              )}
            </li>
          ))}
        </EvidenceList>
      </div>

      <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] px-4 py-3 text-xs leading-5 text-slate-400">
        <span className="font-semibold text-cyan-200">Evidence contract:</span>{" "}
        {data.production.basis} Risk visibility remains tenant- and
        sensitivity-filtered. A signal is not a diagnosis, recommendation,
        approval, risk acceptance or return-to-service decision.
      </div>
    </section>
  );
}

function EvidenceCard({
  icon,
  label,
  primary,
  secondary,
  freshness,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary: string;
  freshness: string;
  tone: "cyan" | "warning" | "danger";
}) {
  const toneClass = {
    cyan: "border-cyan-400/20 text-cyan-300",
    warning: "border-amber-400/25 text-amber-300",
    danger: "border-red-400/25 text-red-300",
  }[tone];
  return (
    <div
      className={`rounded-xl border bg-industrial-graphite p-4 ${toneClass}`}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-100">{primary}</div>
      <div className="mt-1 text-xs leading-5 text-slate-400">{secondary}</div>
      <div className="mt-3 border-t border-white/6 pt-2 text-[11px] text-slate-500">
        Latest: {freshness}
      </div>
    </div>
  );
}

function EvidenceList({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className="rounded-xl border border-industrial-border bg-industrial-graphite p-4">
      <h3 className="text-sm font-semibold text-industrial-text">{title}</h3>
      {items.length && items.some(Boolean) ? (
        <ul className="mt-3 divide-y divide-white/6">{children}</ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      )}
    </div>
  );
}
