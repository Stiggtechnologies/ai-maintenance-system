import { AlertTriangle, FileClock, ShieldCheck } from "lucide-react";
import type { ExecutiveCapitalBriefingModel } from "../../lib/develop/executiveCapitalBriefing";

function amount(value: number | null, unit: string | null): string {
  if (value == null) return "Not available";
  const formatted = new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 2,
  }).format(value);
  return unit
    ? `${formatted} ${unit}`
    : `${formatted} · currency not established`;
}

function date(value: string | null): string {
  if (value == null) return "Not available";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function RecordTrail({ refs }: { refs: string[] }) {
  return (
    <details className="mt-2 text-[11px] text-slate-500">
      <summary className="cursor-pointer">Record trail</summary>
      {refs.length === 0 ? (
        <p className="mt-1">No record identifier is available.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 font-mono">
          {refs.map((ref) => (
            <li key={ref}>{ref}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function ExecutiveCapitalBriefing({
  model,
}: {
  model: ExecutiveCapitalBriefingModel;
}) {
  const incomplete = model.position === "evidence_incomplete";
  return (
    <article
      data-testid="executive-capital-briefing"
      className="space-y-5 rounded-2xl border border-white/8 bg-white/[0.025] p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal-cyan">
            Executive capital briefing
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {model.caseTitle}
          </h2>
          <p className="mt-1 text-sm text-slate-300">{model.headline}</p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            incomplete
              ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
              : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
          }`}
        >
          {incomplete ? "Evidence incomplete" : "Human review required"}
        </span>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-white/6 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Approved capital
          </p>
          <p className="mt-1 text-xl font-semibold text-white">
            {amount(model.cost.sanctioned, model.cost.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Human sanction record</p>
        </div>
        <div className="rounded-xl border border-white/6 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Deterministic forecast
          </p>
          <p className="mt-1 text-xl font-semibold text-white">
            {amount(model.cost.deterministicForecast, model.cost.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Recorded forecast calculation
          </p>
        </div>
        <div className="rounded-xl border border-white/6 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Cost P80
          </p>
          <p className="mt-1 text-xl font-semibold text-white">
            {amount(model.cost.p80Forecast, model.cost.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {model.forecastCurrent
              ? "Current recorded distribution"
              : "No current recorded distribution"}
          </p>
        </div>
        <div className="rounded-xl border border-white/6 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Completion P80
          </p>
          <p className="mt-1 text-xl font-semibold text-white">
            {date(model.schedule.p80Finish)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Deterministic: {date(model.schedule.deterministicFinish)}
          </p>
        </div>
      </div>

      {(model.cost.comparison || model.cost.refusal) && (
        <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2 text-sm text-slate-300">
          {model.cost.comparison ?? model.cost.refusal}
          <RecordTrail refs={model.forecastSourceRefs} />
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileClock className="h-4 w-4 text-signal-cyan" aria-hidden />
            Expected value since sanction
          </h3>
          {model.value.available ? (
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">At sanction</dt>
                <dd className="mt-1 text-slate-100">
                  {amount(model.value.atSanction, null)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Current</dt>
                <dd className="mt-1 text-slate-100">
                  {amount(model.value.current, null)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Recorded delta</dt>
                <dd className="mt-1 text-slate-100">
                  {amount(model.value.delta, null)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-amber-200">{model.value.refusal}</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Values retain their recorded basis; this briefing does not relabel
            them as NPV or combine them with benefit units.
          </p>
          <RecordTrail refs={model.value.sourceRefs} />
        </div>

        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />
            Major risk and schedule drivers
          </h3>
          {model.majorDrivers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              No current driver is available. This is not evidence that risk is
              absent.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {model.majorDrivers.map((driver) => (
                <li key={driver.id} className="text-sm text-slate-200">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{driver.label}</span>
                    {driver.level && (
                      <span className="text-xs text-amber-300">
                        {driver.level}
                      </span>
                    )}
                    {driver.p80DaysContribution != null && (
                      <span className="text-xs text-signal-cyan">
                        {driver.p80DaysContribution} P80 day(s)
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{driver.reason}</p>
                  <RecordTrail refs={driver.sourceRefs} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/6 p-4">
        <h3 className="text-sm font-semibold text-white">
          Benefit commitments
        </h3>
        {model.benefits.length === 0 ? (
          <p className="mt-2 text-sm text-amber-200">
            No canonical benefit commitments are recorded.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Benefit</th>
                  <th className="pb-2 pr-4 font-medium">Expected</th>
                  <th className="pb-2 pr-4 font-medium">Forecast</th>
                  <th className="pb-2 pr-4 font-medium">Actual</th>
                  <th className="pb-2 font-medium">Owner / date</th>
                </tr>
              </thead>
              <tbody>
                {model.benefits.map((benefit) => (
                  <tr key={benefit.id} className="border-t border-white/6">
                    <td className="py-3 pr-4 text-slate-100">
                      {benefit.label}
                      <RecordTrail refs={benefit.sourceRefs} />
                    </td>
                    <td className="py-3 pr-4 text-slate-200">
                      {amount(benefit.expected, benefit.unit)}
                    </td>
                    <td className="py-3 pr-4 text-slate-200">
                      {amount(benefit.forecast, benefit.unit)}
                    </td>
                    <td className="py-3 pr-4 text-slate-200">
                      {amount(benefit.actual, benefit.unit)}
                    </td>
                    <td className="py-3 text-slate-300">
                      {benefit.owner} · {date(benefit.expectedDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Benefits remain separate by recorded unit; this briefing never adds
          unlike outcomes into a persuasive total.
        </p>
      </section>

      {model.limitations.length > 0 && (
        <details className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-4">
          <summary className="cursor-pointer text-sm font-medium text-amber-100">
            Evidence limitations ({model.limitations.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/80">
            {model.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      <footer className="flex items-start gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 text-sm text-cyan-50">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{model.decisionBoundary}</p>
      </footer>
    </article>
  );
}
