import { AlertTriangle, CircleHelp, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { DevelopmentPortfolioRow } from "../../lib/develop/developmentPortfolio";
import {
  buildProjectInterventionTriage,
  type InterventionPosture,
} from "../../lib/develop/projectInterventionTriage";

const POSTURE: Record<
  InterventionPosture,
  { label: string; className: string; icon: typeof ShieldAlert }
> = {
  intervene: {
    label: "Investigate now",
    className: "border-red-400/30 bg-red-400/[0.05] text-red-100",
    icon: ShieldAlert,
  },
  attention: {
    label: "Management attention",
    className: "border-amber-400/30 bg-amber-400/[0.05] text-amber-100",
    icon: AlertTriangle,
  },
  evidence_gap: {
    label: "Evidence gap",
    className: "border-sky-400/30 bg-sky-400/[0.05] text-sky-100",
    icon: CircleHelp,
  },
};

export function ProjectInterventionTriagePanel({
  rows,
}: {
  rows: DevelopmentPortfolioRow[];
}) {
  const triage = useMemo(() => buildProjectInterventionTriage(rows), [rows]);

  return (
    <section
      className="space-y-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.025] p-5"
      data-testid="project-intervention-triage"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
            D12.04 · advisory project intervention triage
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Which projects need attention—and why
          </h2>
          <p className="mt-1 max-w-4xl text-xs text-slate-400">
            {triage.method}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Metric label="Investigate" value={triage.interventionCount} />
          <Metric label="Attention" value={triage.attentionCount} />
          <Metric label="Evidence gaps" value={triage.evidenceGapCount} />
        </div>
      </header>

      {triage.items.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
          No explicit intervention trigger was returned across the {triage.reviewedCaseCount} visible case(s).
          This is not proof that the portfolio is healthy; review the source records and interpretation limits below.
        </div>
      ) : (
        <ol className="space-y-3">
          {triage.items.map((item, index) => {
            const presentation = POSTURE[item.posture];
            const Icon = presentation.icon;
            return (
              <li
                key={item.caseId}
                className={`rounded-xl border p-4 ${presentation.className}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-current/30 text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" aria-hidden />
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          {presentation.label}
                        </span>
                      </div>
                      <Link
                        to={`/develop/cases/${item.caseId}`}
                        className="mt-1 inline-block font-semibold text-white hover:underline"
                      >
                        {item.project}
                      </Link>
                      <p className="text-xs opacity-75">
                        {item.stage ?? "Stage not established"}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] opacity-70">
                    {item.reasons.length} recorded reason(s)
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {item.reasons.map((reason, reasonIndex) => (
                    <li
                      key={`${reason.code}-${reasonIndex}`}
                      className="rounded-lg border border-white/10 bg-black/15 p-3 text-xs"
                    >
                      <p className="font-semibold text-white">{reason.title}</p>
                      <p className="mt-1 opacity-80">{reason.detail}</p>
                      <RecordTrail refs={reason.sourceRefs} />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}

      <aside className="rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300">
        <h3 className="font-semibold text-white">Interpretation limits</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {triage.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </aside>
      <footer className="text-xs font-medium text-amber-50">
        {triage.decisionBoundary}
      </footer>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function RecordTrail({ refs }: { refs: string[] }) {
  if (refs.length === 0) {
    return <p className="mt-2 text-[10px] opacity-60">No record reference returned</p>;
  }
  return (
    <details className="mt-2 text-[10px] opacity-60">
      <summary className="cursor-pointer">Record trail</summary>
      <ul className="mt-1 space-y-0.5 font-mono">
        {refs.map((ref) => (
          <li key={ref}>{ref}</li>
        ))}
      </ul>
    </details>
  );
}
