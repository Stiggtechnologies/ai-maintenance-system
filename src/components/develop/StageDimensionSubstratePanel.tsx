import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCaseStageDimensions,
  type CaseStageDimensionSubstrate,
} from "../../services/developStageDimensionService";

const stateStyle = {
  recorded: "border-emerald-400/20 bg-emerald-400/5 text-emerald-200",
  attention: "border-amber-400/25 bg-amber-400/5 text-amber-200",
  missing: "border-white/8 bg-white/[0.02] text-slate-300",
};

export function StageDimensionSubstratePanel({ caseId }: { caseId: string }) {
  const [substrate, setSubstrate] =
    useState<CaseStageDimensionSubstrate | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await getCaseStageDimensions(caseId);
      setSubstrate(result);
      setSelected((current) =>
        result.stages.some((stage) => stage.stageKey === current)
          ? current
          : (result.currentStageKey ?? result.stages[0]?.stageKey ?? null),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load lifecycle dimensions",
      );
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stage = useMemo(
    () => substrate?.stages.find((item) => item.stageKey === selected) ?? null,
    [selected, substrate],
  );

  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-signal-cyan">
            Lifecycle substrate
          </p>
          <h2 className="mt-1 text-sm font-semibold text-white">
            Eight dimensions beneath every stage
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            Objective, Value, Risk, Evidence, Decision, Configuration, Work and
            Outcome remain visible as the case advances. These are views of the
            canonical records—not a parallel register or composite score.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 hover:border-signal-cyan/40 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </p>
      )}

      {substrate && (
        <>
          <div
            className="mt-4 flex gap-2 overflow-x-auto pb-2"
            aria-label="Lifecycle stages"
          >
            {substrate.stages.map((item) => (
              <button
                key={item.stageKey}
                type="button"
                aria-pressed={selected === item.stageKey}
                onClick={() => setSelected(item.stageKey)}
                className={`min-w-fit rounded-lg border px-3 py-2 text-left text-xs transition ${
                  selected === item.stageKey
                    ? "border-signal-cyan/50 bg-signal-cyan/10 text-white"
                    : "border-white/8 bg-white/[0.02] text-slate-400 hover:text-slate-200"
                }`}
              >
                <span className="block font-medium">{item.stageName}</span>
                <span className="mt-0.5 block text-[10px] uppercase tracking-wide opacity-70">
                  {item.progress}
                </span>
              </button>
            ))}
          </div>

          {stage && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  {stage.stageName} · {stage.gateReviewCount} recorded gate
                  review{stage.gateReviewCount === 1 ? "" : "s"}
                </span>
                <span>Stage {stage.sequence}</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {stage.dimensions.map((dimension) => (
                  <article
                    key={dimension.key}
                    className={`rounded-lg border p-3 ${stateStyle[dimension.state]}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold">
                        {dimension.label}
                      </h3>
                      <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                        {dimension.state}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {dimension.count}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      {dimension.basis}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-500">
                      Source: {dimension.sourceTables.join(" + ")}
                      {dimension.attentionCount > 0
                        ? ` · ${dimension.attentionCount} needs attention`
                        : ""}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 text-[11px] text-slate-500">
            {substrate.authorityBoundary}
          </p>
        </>
      )}
    </section>
  );
}
