import { BriefcaseBusiness, ChevronDown, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import type { GateReviewPack } from "../../services/developService";
import { buildPmGateBriefing } from "../../lib/develop/pmGateBriefing";

export function PmGateBriefing({ pack }: { pack: GateReviewPack }) {
  const briefing = useMemo(() => buildPmGateBriefing(pack), [pack]);
  const tone =
    briefing.position === "blocked"
      ? "border-red-400/25 bg-red-400/[0.04]"
      : briefing.position === "not_blocked"
        ? "border-emerald-400/20 bg-emerald-400/[0.03]"
        : "border-amber-400/20 bg-amber-400/[0.03]";

  return (
    <section
      aria-label="PM gate briefing"
      className={`rounded-xl border p-4 ${tone}`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-signal-cyan/10 p-2 text-signal-cyan">
          <BriefcaseBusiness className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-signal-cyan uppercase">
            PM gate briefing · governed live records
          </div>
          <h2 className="mt-1 text-base font-semibold text-slate-50">
            {briefing.headline}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {pack.caseTitle} · {pack.decisionType}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {briefing.measures.map((measure) => (
          <div
            key={measure.label}
            className="rounded-lg border border-white/8 bg-black/10 p-3"
          >
            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              {measure.label}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {measure.value}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              {measure.explanation}
            </p>
            <details className="mt-2 text-[10px] text-slate-500">
              <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-slate-300">
                <ChevronDown className="h-3 w-3" aria-hidden /> Record trail
              </summary>
              {measure.recordRefs.length === 0 ? (
                <p className="mt-1">No supporting record was returned.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 font-mono">
                  {measure.recordRefs.map((ref) => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              )}
            </details>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/8 bg-black/10 p-3">
          <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Blocking records
          </div>
          {briefing.blockers.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              The governed evaluator returned no blocking record. This does not
              declare the gate ready.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {briefing.blockers.map((blocker) => (
                <li
                  key={`${blocker.recordRef}-${blocker.name}`}
                  className="text-xs"
                >
                  <span className="font-semibold text-red-300">
                    {blocker.label}
                  </span>
                  <span className="text-slate-300"> — {blocker.name}</span>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                    {blocker.recordRef}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-white/8 bg-black/10 p-3">
          <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Closure outlook
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-100">
            {briefing.projection.value}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {briefing.projection.explanation}
          </p>
          <details className="mt-2 text-[10px] text-slate-500">
            <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-slate-300">
              <ChevronDown className="h-3 w-3" aria-hidden /> Record trail
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {briefing.projection.recordRefs.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{briefing.decisionBoundary}</span>
      </div>
    </section>
  );
}
