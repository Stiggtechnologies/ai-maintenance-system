import { ArrowLeft, Grid3X3, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import type { OperationalReadinessMatrixCell } from "../lib/develop/operationalReadinessMatrix";
import {
  listDevelopmentCases,
  type DevelopmentCaseSummary,
} from "../services/developService";
import { getOperationalReadinessMatrix } from "../services/operationalReadinessMatrixService";
import { ErrorState, LoadingState } from "../components/ui/AsyncStates";

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Cell({ cell }: { cell: OperationalReadinessMatrixCell }) {
  if (cell.total === 0) {
    return (
      <td className="min-w-52 border-l border-white/6 px-3 py-3 text-slate-500">
        Not scoped
      </td>
    );
  }
  return (
    <td className="min-w-52 border-l border-white/6 px-3 py-3 align-top">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-white">
          {cell.percent}%
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            cell.open === 0
              ? "bg-emerald-400/10 text-emerald-300"
              : cell.overdueOpen > 0
                ? "bg-rose-400/10 text-rose-300"
                : "bg-amber-400/10 text-amber-300"
          }`}
        >
          {cell.evidenced}/{cell.total} evidenced
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Earliest required by {date(cell.earliestRequiredBefore)}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Owners: {cell.owners.join(", ") || "Not recorded"}
      </p>
      {cell.gaps.length > 0 && (
        <details className="mt-2 text-[11px] text-amber-100">
          <summary className="cursor-pointer">
            {cell.gaps.length} named gap(s)
            {cell.overdueOpen > 0 ? ` · ${cell.overdueOpen} overdue` : ""}
          </summary>
          <ul className="mt-1 space-y-1">
            {cell.gaps.map((gap) => (
              <li key={gap.itemId} className={gap.overdue ? "text-rose-200" : ""}>
                {gap.asset} · {gap.label} · {gap.owner} · {date(gap.requiredBefore)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="mt-2 text-[10px] text-slate-500">
        <summary className="cursor-pointer">Record trail</summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {cell.recordRefs.map((ref) => (
            <li key={ref}>{ref}</li>
          ))}
        </ul>
      </details>
    </td>
  );
}

export function OperationalReadinessMatrixPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cases, setCases] = useState<DevelopmentCaseSummary[]>([]);
  const [casesError, setCasesError] = useState<string | null>(null);
  const caseId = searchParams.get("case") ?? "";

  useEffect(() => {
    let cancelled = false;
    listDevelopmentCases()
      .then((items) => {
        if (cancelled) return;
        setCases(items);
        setCasesError(null);
        if (!caseId && items[0])
          setSearchParams({ case: items[0].id }, { replace: true });
      })
      .catch((caught) => {
        if (!cancelled)
          setCasesError(
            caught instanceof Error ? caught.message : "Case list failed",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, setSearchParams]);

  const request = useMemo(() => caseId, [caseId]);
  const { data, loading, error, refetch } = useAsyncData(
    () => (request ? getOperationalReadinessMatrix(request) : Promise.resolve(null)),
    [request],
  );

  if (loading && caseId)
    return <LoadingState label="Assembling operational readiness by system" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <main className="space-y-5 p-6" data-testid="operational-readiness-matrix">
      <header>
        <Link to="/develop" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Sync Develop
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
              <Grid3X3 className="h-5 w-5 text-signal-cyan" aria-hidden /> Operational Readiness Matrix
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              System-by-dimension evidence coverage, named owners, due dates and gaps—visible before handover.
            </p>
          </div>
          <label className="text-xs text-slate-400">
            Development case
            <select
              aria-label="Development case"
              value={caseId}
              onChange={(event) => setSearchParams({ case: event.target.value })}
              className="mt-1 block min-w-72 rounded-lg border border-white/10 bg-[#0D1520] px-3 py-2 text-sm text-slate-100"
            >
              <option value="" disabled>Select a case…</option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {casesError && <ErrorState message={casesError} />}

      {cases.length === 0 && !loading && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          No development cases are visible to your organization.
        </p>
      )}
      {data?.emptyState && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          {data.emptyState}
        </p>
      )}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/8">
          <table className="min-w-max text-left text-xs">
            <thead className="border-b border-white/8 bg-white/[0.03] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="sticky left-0 z-10 min-w-72 bg-[#111923] px-4 py-3">System</th>
                {data.categories.map((category) => (
                  <th key={category} className="min-w-52 border-l border-white/6 px-3 py-3 font-medium">
                    {category.replaceAll("_", " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.systemId} className="border-b border-white/6 last:border-0">
                  <th className="sticky left-0 z-10 bg-[#0D1520] px-4 py-3 align-top">
                    <Link to={`/develop/cases/${data.caseId}`} className="font-semibold text-signal-cyan hover:underline">
                      {row.systemRef} · {row.title}
                    </Link>
                    <p className="mt-1 font-normal text-slate-400">
                      {row.currentState?.replaceAll("_", " ") ?? "State not recorded"} · {row.assetCount} asset(s)
                    </p>
                    <p className="mt-1 font-normal text-slate-500">
                      {row.evidenced}/{row.total} evidenced · {row.open} open · {row.overdueOpen} overdue
                    </p>
                  </th>
                  {data.categories.map((category) => (
                    <Cell key={category} cell={row.cells[category]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <aside className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4 text-xs text-amber-50">
          <h2 className="flex items-center gap-1.5 font-semibold"><ShieldAlert className="h-4 w-4" aria-hidden /> Interpretation and authority boundary</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {data.interpretationLimits.map((limit) => <li key={limit}>{limit}</li>)}
          </ul>
          <p className="mt-3 border-t border-amber-400/15 pt-3">{data.decisionBoundary}</p>
          <p className="mt-1 text-amber-200/70">Canonical store: {data.readinessStore}</p>
        </aside>
      )}
    </main>
  );
}
