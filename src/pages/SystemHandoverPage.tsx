import { ArrowLeft, PackageCheck, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { SystemHandoverPanel } from "../components/develop/SystemHandoverPanel";
import { ErrorState, LoadingState } from "../components/ui/AsyncStates";
import {
  listDevelopmentCases,
  type DevelopmentCaseSummary,
} from "../services/developService";

/**
 * A portfolio entry point for the canonical, case-scoped SystemHandoverPanel.
 * The URL is only a selection hint: a case is mounted after it is returned by
 * the tenant-scoped development_cases read, so a guessed id grants no access.
 */
export function SystemHandoverPage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cases, setCases] = useState<DevelopmentCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestedCaseId = searchParams.get("case") ?? "";

  useEffect(() => {
    let cancelled = false;
    listDevelopmentCases()
      .then((items) => {
        if (cancelled) return;
        setCases(items);
        setError(null);
        setLoading(false);
        const requestedIsVisible = items.some(
          (item) => item.id === requestedCaseId,
        );
        if (!requestedIsVisible && items[0]) {
          setSearchParams({ case: items[0].id }, { replace: true });
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof Error ? caught.message : "Case list failed",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedCaseId, setSearchParams]);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === requestedCaseId) ?? null,
    [cases, requestedCaseId],
  );

  if (loading) return <LoadingState label="Loading visible development cases" />;

  return (
    <main className="space-y-5 p-6" data-testid="system-handover-screen">
      <header>
        <Link
          to="/develop"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Sync Develop
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
              <PackageCheck className="h-5 w-5 text-signal-cyan" aria-hidden />
              System handover
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              Review commissioning, punchlist, as-built, asset-data and
              residual-risk evidence before a named human accepts each system
              into operations.
            </p>
          </div>
          {cases.length > 0 && (
            <label className="text-xs text-slate-400">
              Development case
              <select
                aria-label="Development case"
                value={selectedCase?.id ?? ""}
                onChange={(event) =>
                  setSearchParams({ case: event.target.value })
                }
                className="mt-1 block min-w-72 rounded-lg border border-white/10 bg-[#0D1520] px-3 py-2 text-sm text-slate-100"
              >
                <option value="" disabled>
                  Select a case…
                </option>
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {!error && cases.length === 0 && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
          No development cases are visible to your organization.
        </p>
      )}

      {selectedCase && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {selectedCase.title}
              </p>
              <p className="text-xs text-slate-400">
                Canonical case and system records · tenant-scoped access
              </p>
            </div>
            <Link
              to={`/develop/cases/${selectedCase.id}/transition`}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
            >
              Open Sync Transition
            </Link>
          </div>
          <SystemHandoverPanel caseId={selectedCase.id} role={profile?.role} />
        </>
      )}

      <aside className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/[0.04] p-4 text-xs text-slate-300">
        <h2 className="flex items-center gap-1.5 font-semibold text-slate-100">
          <ShieldCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
          Acceptance boundary
        </h2>
        <p className="mt-2 max-w-4xl">
          This screen governs project-to-operations system acceptance. It does
          not replace the separate equipment return-to-service workflow. SyncAI
          assembles evidence and blockers; only the named receiving owner can
          record final acceptance.
        </p>
      </aside>
    </main>
  );
}
