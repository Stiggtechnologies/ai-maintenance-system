import { AlertTriangle, Atom, CheckCircle2 } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { getRecommendationEngineeringModelTrace } from "../services/engineeringModelService";

export function EngineeringModelTracePanel({
  recommendationId,
}: {
  recommendationId: string;
}) {
  const { data, loading, error, refetch } = useAsyncData(
    () => getRecommendationEngineeringModelTrace(recommendationId),
    [recommendationId],
  );
  if (loading)
    return (
      <div className="rounded-lg border border-white/6 bg-black/10 p-2 text-xs text-slate-500">
        Checking engineering-model lineage…
      </div>
    );
  if (error)
    return (
      <button
        onClick={refetch}
        className="w-full rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-left text-xs text-red-300"
      >
        Model lineage unavailable: {error}. Select to retry.
      </button>
    );
  if (!data?.length)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/6 bg-black/10 p-2 text-xs text-slate-500">
        <Atom className="h-3.5 w-3.5" /> No engineering model influence is
        recorded for this recommendation.
      </div>
    );
  return (
    <div className="space-y-2 rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
        <Atom className="h-3.5 w-3.5" /> Engineering model lineage · advisory,
        not authorization
      </div>
      {data.map((trace) => {
        const passed =
          trace.calculationStatus === "computed" &&
          trace.verification === "pass" &&
          trace.fieldValidation === "present" &&
          trace.applicability === "within_range" &&
          trace.engineeringApproval === "approved";
        return (
          <div
            key={trace.calculationRunId}
            className="rounded-md border border-white/6 bg-black/15 p-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-slate-200">
                {trace.modelKey}@{trace.modelVersion}
              </span>
              <span className={passed ? "text-emerald-300" : "text-amber-300"}>
                {passed ? (
                  <CheckCircle2 className="mr-1 inline h-3 w-3" />
                ) : (
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                )}
                {trace.calculationStatus}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-400">
              <span>verification: {trace.verification}</span>
              <span>field: {trace.fieldValidation}</span>
              <span>applicability: {trace.applicability}</span>
              <span>approval: {trace.engineeringApproval}</span>
            </div>
            {trace.refusals.length > 0 ? (
              <p className="mt-1 text-amber-200">
                Refused: {trace.refusals.map((item) => item.code).join(", ")}
              </p>
            ) : null}
            <p className="mt-1 text-slate-500">
              Human approval remains required. This result grants no operational
              authority.
            </p>
          </div>
        );
      })}
    </div>
  );
}
