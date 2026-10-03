import { useCallback, useEffect, useState } from "react";
import {
  getCaseInformationReadinessIndex,
  type InformationReadinessIndexResult,
} from "../../services/informationReadinessIndexService";
export function InformationReadinessIndexPanel({ caseId }: { caseId: string }) {
  const [model, setModel] = useState<InformationReadinessIndexResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      getCaseInformationReadinessIndex(caseId)
        .then((x) => {
          setModel(x);
          setError(null);
        })
        .catch((x) =>
          setError(
            x instanceof Error
              ? x.message
              : "Information readiness index failed",
          ),
        ),
    [caseId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Information Readiness Index
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Accepted evidence-backed required information objects ÷ scoped
            required information objects. Regulatory and safety-critical gaps
            always block.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      )}
      {model && (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <p className="text-3xl font-semibold text-white">
              {model.project.index == null
                ? "Not assessed"
                : `${model.project.index}%`}
            </p>
            <span
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${model.project.status === "READY" ? "border-emerald-400/30 text-emerald-300" : model.project.status === "BLOCKED" ? "border-rose-400/30 text-rose-300" : "border-amber-400/30 text-amber-300"}`}
            >
              {model.project.status.replaceAll("_", " ")}
            </span>
            <span className="text-xs text-slate-500">
              {model.project.accepted}/{model.project.required} accepted
            </span>
          </div>
          {model.hardBlockers.length > 0 && (
            <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3">
              <p className="text-xs font-semibold text-rose-300">
                {model.hardBlockers.length} hard blocker(s)
              </p>
              <ul className="mt-2 space-y-1">
                {model.hardBlockers.map((b) => (
                  <li key={b.itemId} className="text-[11px] text-rose-200">
                    {b.systemRef} · {b.asset} · {b.item} (
                    {b.class.replaceAll("_", " ")};{" "}
                    {b.evidenceReady ? "evidence present" : "evidence missing"})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {model.systems.map((s) => (
              <div
                key={s.systemId}
                className="rounded-lg border border-white/8 p-3"
              >
                <div className="flex justify-between gap-2">
                  <strong className="text-xs text-slate-200">
                    {s.systemRef} · {s.title}
                  </strong>
                  <span className="text-[10px] text-slate-400">
                    {s.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-lg font-semibold text-white">
                  {s.index == null ? "Not assessed" : `${s.index}%`}
                </p>
                <p className="text-[11px] text-slate-500">
                  {s.accepted}/{s.required} accepted · {s.hardBlockerCount} hard
                  blocker(s)
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            {model.decisionBoundary}
          </p>
        </>
      )}
    </section>
  );
}
