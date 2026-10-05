import { CheckCircle2, ClipboardCheck, ShieldAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getRecommendationContractPosture,
  type RecommendationContractPostureRow,
} from "../services/operatingLoopService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

function count(
  rows: RecommendationContractPostureRow[],
  key: "total" | "releasable_rows" | "blocked_rows",
) {
  return Number(rows[0]?.[key] ?? 0);
}

function pct(share: number) {
  return `${Math.round(Number(share) * 100)}%`;
}

export function RecommendationContractPosturePanel() {
  const { data, loading, error, refetch } = useAsyncData(
    getRecommendationContractPosture,
    [],
  );

  if (loading) {
    return <LoadingState label="Loading recommendation release readiness" />;
  }
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const rows = data ?? [];
  const total = count(rows, "total");
  const releasable = count(rows, "releasable_rows");
  const blocked = count(rows, "blocked_rows");

  return (
    <section
      aria-labelledby="recommendation-contract-posture-heading"
      className="rounded-2xl border border-white/6 bg-[#0D1520] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="recommendation-contract-posture-heading"
            className="flex items-center gap-2 text-sm font-semibold text-slate-200"
          >
            <ClipboardCheck className="h-4 w-4 text-teal-400" aria-hidden />
            Recommendation release readiness
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Every recommendation must state its evidence, assumptions,
            consequence, alternatives, confidence, accountable approver, due
            date, and how effectiveness will be verified. Failure mode or risk
            basis is tracked separately as advisory coverage because some
            organization-level recommendations are not failure-driven.
          </p>
        </div>
        {total > 0 && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
              {releasable} releasable
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-200">
              {blocked} blocked
            </span>
          </div>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-4 rounded-xl border border-white/6 bg-black/20 p-4 text-sm text-slate-400">
          No recommendations are recorded for this organization. Release
          readiness will be measured when the first recommendation exists.
        </p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {rows.map((row) => {
            const complete = Number(row.populated) === Number(row.total);
            return (
              <div
                key={row.register}
                className={`rounded-xl border p-3 ${complete ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-300">
                    {row.register}
                  </span>
                  {complete ? (
                    <CheckCircle2
                      className="h-3.5 w-3.5 text-emerald-400"
                      aria-label="Fully populated"
                    />
                  ) : (
                    <ShieldAlert
                      className="h-3.5 w-3.5 text-amber-300"
                      aria-label={
                        row.blocking
                          ? "Release-blocking gaps"
                          : "Advisory coverage gap"
                      }
                    />
                  )}
                </div>
                <p className="mt-1 min-h-10 text-xs leading-5 text-slate-300">
                  {row.label}
                </p>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-white">
                    {pct(row.share)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {row.populated}/{row.total}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        A recommendation remains blocked if any required field is missing,
        regardless of its overall percentage. Rows marked advisory expose
        provenance coverage without inventing a failure claim. Approval does
        not prove the outcome; the stated verification method creates the
        later measurement obligation.
      </p>
    </section>
  );
}
