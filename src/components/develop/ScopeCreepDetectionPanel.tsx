import { ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getScopeCreepDetection } from "../../services/scopeCreepDetectionService";
import { ErrorState, LoadingState } from "../ui/AsyncStates";

export function ScopeCreepDetectionPanel() {
  const { data, loading, error, refetch } = useAsyncData(
    () => getScopeCreepDetection(),
    [],
  );

  if (loading) return <LoadingState label="Checking governed scope movement" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <section
      className="space-y-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.025] p-5"
      data-testid="scope-creep-detection"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
            D12.01 · scope-creep detection agent
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
            <ScanSearch className="h-5 w-5 text-violet-300" aria-hidden />
            Scope movement requiring human review
          </h2>
          <p className="mt-1 max-w-4xl text-xs text-slate-400">{data.method}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-right text-xs">
          <p className="text-xl font-semibold text-white">{data.flaggedCaseCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            of {data.reviewedCaseCount} active cases flagged
          </p>
        </div>
      </header>

      {data.cases.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
          No explicit scope-movement flag was returned. This is not proof that scope is stable; unrecorded movement remains undetectable.
        </p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.cases.map((item) => (
            <article key={item.caseId} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link
                    to={`/develop/cases/${item.caseId}`}
                    className="font-semibold text-white hover:underline"
                  >
                    {item.caseTitle}
                  </Link>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
                    {item.status.replaceAll("_", " ")}
                  </p>
                </div>
                <p className="text-right text-[10px] text-slate-400">
                  {item.potentialScopeCreepCount} potential creep · {item.evidenceGapCount} evidence gap(s)
                </p>
              </div>
              <ul className="mt-3 space-y-2">
                {item.flags.map((flag, index) => (
                  <li
                    key={`${flag.kind}-${index}`}
                    className={`rounded-lg border p-3 text-xs ${
                      flag.classification === "potential_scope_creep"
                        ? "border-amber-400/25 bg-amber-400/[0.04] text-amber-50"
                        : "border-sky-400/20 bg-sky-400/[0.03] text-sky-50"
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                      {flag.classification.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 font-semibold text-white">{flag.title}</p>
                    <p className="mt-1 opacity-80">{flag.detail}</p>
                    <details className="mt-2 text-[10px] opacity-60">
                      <summary className="cursor-pointer">Record trail</summary>
                      <ul className="mt-1 space-y-0.5 font-mono">
                        {flag.sourceRefs.map((ref) => <li key={ref}>{ref}</li>)}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}

      <aside className="rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300">
        <h3 className="font-semibold text-white">Interpretation limits</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      </aside>
      <footer className="text-xs font-medium text-violet-50">{data.decisionBoundary}</footer>
    </section>
  );
}
