import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import { getDevelopmentPortfolio } from "../services/developmentPortfolioService";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../components/ui/AsyncStates";

function number(value: number | null, suffix = ""): string {
  return value == null
    ? "Not assessed"
    : `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function money(value: number | null, currency: string | null): string {
  if (value == null) return "Not available";
  return `${number(value)} ${currency ?? "· currency not established"}`;
}

function date(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Not available";
}

function Trail({ refs }: { refs: string[] }) {
  if (refs.length === 0) {
    return (
      <p className="mt-1 text-[10px] text-slate-500">
        No record trail available
      </p>
    );
  }
  return (
    <details className="mt-1 text-[10px] text-slate-500">
      <summary className="cursor-pointer">Record trail</summary>
      <ul className="mt-1 space-y-0.5 font-mono">
        {refs.map((ref) => (
          <li key={ref}>{ref}</li>
        ))}
      </ul>
    </details>
  );
}

export function DevelopmentPortfolioPage() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAsyncData(
    () => getDevelopmentPortfolio(),
    [],
  );
  if (loading)
    return <LoadingState label="Assembling the development portfolio" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data || data.rows.length === 0)
    return (
      <EmptyState message="No development cases are visible to your organization." />
    );

  return (
    <main className="space-y-5 p-6" data-testid="development-portfolio">
      <header>
        <Link
          to="/develop"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Sync Develop
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-white">
          <BriefcaseBusiness className="h-5 w-5 text-signal-cyan" aria-hidden />{" "}
          Development Portfolio
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          Project, stage, next gate, readiness, cost, schedule, risk, operations
          and benefits—each from its canonical case record.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="min-w-[118rem] text-left text-xs">
          <thead className="border-b border-white/8 bg-white/[0.03] uppercase tracking-wide text-slate-400">
            <tr>
              {[
                "Project",
                "Stage",
                "Next gate",
                "Gate readiness",
                "Cost forecast",
                "Schedule forecast",
                "Risk",
                "Operational readiness",
                "Benefit forecast",
              ].map((label) => (
                <th key={label} className="px-3 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.caseId}
                className="border-b border-white/6 align-top last:border-0 hover:bg-white/[0.02]"
              >
                <td className="px-3 py-3">
                  <button
                    className="text-left font-semibold text-signal-cyan hover:underline"
                    onClick={() => navigate(`/develop/cases/${row.caseId}`)}
                  >
                    {row.project}
                  </button>
                  <p className="mt-1 text-slate-500">
                    {row.status.replaceAll("_", " ")}
                  </p>
                </td>
                <td className="px-3 py-3 text-slate-200">
                  {row.stage ?? "Not established"}
                </td>
                <td className="px-3 py-3 text-slate-200">
                  {row.nextGate?.name ?? "No pending gate"}
                </td>
                <td className="px-3 py-3 text-slate-200">
                  {row.gateReadiness ? (
                    <>
                      <p>{number(row.gateReadiness.percent, "%")}</p>
                      <p
                        className={
                          row.gateReadiness.blocked
                            ? "mt-1 text-red-300"
                            : "mt-1 text-slate-400"
                        }
                      >
                        {row.gateReadiness.blocked ? "BLOCKED" : "Context only"}{" "}
                        · {row.gateReadiness.blockers} blocker(s)
                      </p>
                      <Trail refs={row.gateReadiness.sourceRefs} />
                    </>
                  ) : (
                    "No pending gate"
                  )}
                </td>
                <td className="px-3 py-3 text-slate-200">
                  <p>
                    Det.{" "}
                    {money(
                      row.costForecast.deterministic,
                      row.costForecast.currency,
                    )}
                  </p>
                  <p className="mt-1">
                    P80 {money(row.costForecast.p80, row.costForecast.currency)}
                  </p>
                  {row.costForecast.refusal && (
                    <p className="mt-1 text-amber-200">
                      {row.costForecast.refusal}
                    </p>
                  )}
                  <Trail refs={row.costForecast.sourceRefs} />
                </td>
                <td className="px-3 py-3 text-slate-200">
                  <p>Det. {date(row.scheduleForecast.deterministicFinish)}</p>
                  <p className="mt-1">
                    P80 {date(row.scheduleForecast.p80Finish)}
                  </p>
                  {row.scheduleForecast.refusal && (
                    <p className="mt-1 text-amber-200">
                      {row.scheduleForecast.refusal}
                    </p>
                  )}
                  <Trail refs={row.scheduleForecast.sourceRefs} />
                </td>
                <td className="px-3 py-3 text-slate-200">
                  <p>{row.risk.openHighCritical} open High/Critical</p>
                  {row.risk.leading.slice(0, 3).map((risk) => (
                    <p key={risk.id} className="mt-1 text-amber-200">
                      {risk.level}: {risk.title}
                    </p>
                  ))}
                  {row.risk.absenceNote && (
                    <p className="mt-1 text-slate-500">
                      {row.risk.absenceNote}
                    </p>
                  )}
                  <Trail refs={row.risk.sourceRefs} />
                </td>
                <td className="px-3 py-3 text-slate-200">
                  <p>{number(row.operationalReadiness.percent, "%")}</p>
                  <p className="mt-1 text-slate-400">
                    {row.operationalReadiness.hardBlockers} hard blocker(s)
                  </p>
                  {row.operationalReadiness.refusal && (
                    <p className="mt-1 text-amber-200">
                      {row.operationalReadiness.refusal}
                    </p>
                  )}
                  <Trail refs={row.operationalReadiness.sourceRefs} />
                </td>
                <td className="px-3 py-3 text-slate-200">
                  {row.benefits.length === 0 ? (
                    <p className="text-amber-200">
                      No benefit commitments recorded
                    </p>
                  ) : (
                    row.benefits.map((benefit) => (
                      <div key={benefit.id} className="mb-2 last:mb-0">
                        <p className="font-medium">{benefit.label}</p>
                        <p className="text-slate-400">
                          Expected {number(benefit.expected)} {benefit.unit}
                        </p>
                        <p className="text-slate-400">
                          Forecast {number(benefit.currentForecast)}{" "}
                          {benefit.unit}
                        </p>
                        <p className="text-slate-500">
                          {benefit.owner} · {date(benefit.expectedDate)}
                        </p>
                        <Trail
                          refs={[
                            `value_metrics:${benefit.id}`,
                            ...(benefit.forecastMetricId
                              ? [`value_metrics:${benefit.forecastMetricId}`]
                              : []),
                            ...(benefit.actualMetricId
                              ? [`value_metrics:${benefit.actualMetricId}`]
                              : []),
                          ]}
                        />
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4 text-xs text-amber-50">
        <h2 className="font-semibold">Portfolio interpretation limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {data.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </aside>
      <footer className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 text-sm text-cyan-50">
        {data.decisionBoundary}
      </footer>
    </main>
  );
}
