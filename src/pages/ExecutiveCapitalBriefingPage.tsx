import { useEffect, useState } from "react";
import { ArrowLeft, Landmark } from "lucide-react";
import { Link } from "react-router-dom";
import { ExecutiveCapitalBriefing } from "../components/develop/ExecutiveCapitalBriefing";
import { useAsyncData } from "../hooks/useAsyncData";
import { buildExecutiveCapitalBriefing } from "../lib/develop/executiveCapitalBriefing";
import type { ExecutiveCapitalBriefingModel } from "../lib/develop/executiveCapitalBriefing";
import {
  getCaseBenefitsScreen,
  getCasePerformance,
  getDevelopmentCase,
  getSinceSanctionDelta,
  listDevelopmentCases,
} from "../services/developService";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../components/ui/AsyncStates";

function SelectedCaseBriefing({ caseId }: { caseId: string }) {
  const { data, loading, error, refetch } =
    useAsyncData<ExecutiveCapitalBriefingModel>(async () => {
      const [workspace, performance, sinceSanction, benefits] =
        await Promise.all([
          getDevelopmentCase(caseId),
          getCasePerformance(caseId),
          getSinceSanctionDelta(caseId),
          getCaseBenefitsScreen(caseId),
        ]);
      if (workspace == null) throw new Error("Development case not found");
      return buildExecutiveCapitalBriefing(
        workspace,
        performance,
        sinceSanction,
        benefits,
      );
    }, [caseId]);

  if (loading)
    return <LoadingState label="Assembling recorded capital evidence" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  return data ? <ExecutiveCapitalBriefing model={data} /> : null;
}

export function ExecutiveCapitalBriefingPage() {
  const {
    data: cases,
    loading,
    error,
    refetch,
  } = useAsyncData(() => listDevelopmentCases(), []);
  const [caseId, setCaseId] = useState("");

  useEffect(() => {
    if (!caseId && cases?.[0]) setCaseId(cases[0].id);
  }, [caseId, cases]);

  return (
    <main className="space-y-6 p-6" data-testid="executive-capital-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/executive"
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Executive intelligence
          </Link>
          <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold text-white">
            <Landmark className="h-5 w-5 text-signal-cyan" aria-hidden />
            Does this project deserve the next dollar?
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            A decision briefing assembled from sanctioned capital, recorded
            forecast confidence, benefits, lifecycle value evaluations and case
            risks. It informs the authority; it never replaces them.
          </p>
        </div>
        {!loading && (cases?.length ?? 0) > 0 && (
          <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Development case
            <select
              aria-label="Development case"
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
              className="mt-1 block min-w-64 rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm normal-case tracking-normal text-white"
            >
              {(cases ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {loading && <LoadingState label="Loading development cases" />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && (cases?.length ?? 0) === 0 && (
        <EmptyState message="No development cases are visible to your organization." />
      )}
      {caseId && <SelectedCaseBriefing caseId={caseId} />}
    </main>
  );
}
