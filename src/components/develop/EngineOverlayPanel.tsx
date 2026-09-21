import { useState } from "react";
import { Layers3, ShieldAlert } from "lucide-react";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getCaseEngineOverlays } from "../../services/developOverlayService";
import { ErrorState, LoadingState } from "../ui/AsyncStates";

const stateClass = {
  recorded: "border-emerald-400/20 bg-emerald-400/5 text-emerald-200",
  attention: "border-amber-400/25 bg-amber-400/5 text-amber-200",
  missing: "border-white/8 bg-white/[0.02] text-slate-400",
};

export function EngineOverlayPanel({ caseId }: { caseId: string }) {
  const workspace = useAsyncData(() => getCaseEngineOverlays(caseId), [caseId]);
  const [selectedKey, setSelectedKey] = useState("frame");
  if (workspace.loading)
    return <LoadingState label="Loading cross-cutting overlays…" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  if (!workspace.data) return null;
  const selected =
    workspace.data.engines.find((engine) => engine.key === selectedKey) ??
    workspace.data.engines[0];

  return (
    <section
      id="engine-overlays"
      className="rounded-2xl border border-signal-cyan/20 bg-signal-cyan/[0.025] p-5"
      aria-labelledby="engine-overlay-title"
    >
      <div className="flex items-start gap-3">
        <Layers3 className="mt-0.5 h-5 w-5 text-signal-cyan" aria-hidden />
        <div>
          <h2
            id="engine-overlay-title"
            className="text-base font-semibold text-white"
          >
            Eight engines · seven cross-cutting overlays
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            Risk, quality, sustainability, HOP, stakeholders, evidence and AI
            remain visible in every engine. Counts come from the same canonical
            case records—this view creates no parallel objects or synthetic
            score.
          </p>
        </div>
      </div>
      <div
        className="mt-4 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Sync Develop engines"
      >
        {workspace.data.engines.map((engine) => (
          <button
            key={engine.key}
            type="button"
            role="tab"
            aria-selected={selected.key === engine.key}
            onClick={() => setSelectedKey(engine.key)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${selected.key === engine.key ? "border-signal-cyan/40 bg-signal-cyan/15 text-signal-cyan" : "border-white/8 text-slate-400 hover:text-slate-200"}`}
          >
            {engine.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <p className="text-xs font-medium text-slate-200">
          {selected.label}: {selected.focus}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {selected.overlays.map((overlay) => (
            <article
              key={overlay.key}
              className={`rounded-xl border p-3 ${stateClass[overlay.state]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">{overlay.label}</h3>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {overlay.count}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                {overlay.basis}
              </p>
              <p className="mt-2 text-[10px] uppercase tracking-wide">
                {overlay.state}
                {overlay.attentionCount > 0
                  ? ` · ${overlay.attentionCount} attention`
                  : ""}
              </p>
            </article>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-start gap-2 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-slate-500">
        <ShieldAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300"
          aria-hidden
        />
        <p>{workspace.data.authorityBoundary}</p>
      </div>
    </section>
  );
}
