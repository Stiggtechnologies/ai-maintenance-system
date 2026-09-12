import { ClipboardCheck, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import type { CaseSystemHandoverPackages } from "../../services/handoverPackageService";
import { buildOperationsReadinessBriefing } from "../../lib/develop/operationsReadinessBriefing";

export function OperationsReadinessBriefing({
  model,
}: {
  model: CaseSystemHandoverPackages;
}) {
  const briefing = useMemo(
    () => buildOperationsReadinessBriefing(model),
    [model],
  );

  return (
    <section
      aria-label="Operations readiness briefing"
      className="rounded-xl border border-signal-cyan/20 bg-gradient-to-br from-signal-cyan/[0.07] via-[#0D1520] to-[#0D1520] p-5"
    >
      <div className="flex items-start gap-3">
        <span className="rounded-lg border border-signal-cyan/20 bg-signal-cyan/10 p-2 text-signal-cyan">
          <ClipboardCheck className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal-cyan">
            Operations manager brief · governed live records
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Pre-handover readiness by system
          </h2>
          <p className="mt-1 max-w-4xl text-xs text-slate-400">
            The handover package&apos;s physical, information and operational
            dimensions are shown unchanged. No blended score is created.
          </p>
        </div>
      </div>

      {briefing.emptyState ? (
        <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200">
          {briefing.emptyState}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {briefing.systems.map((system) => (
            <article
              key={system.systemId}
              className="rounded-xl border border-white/8 bg-black/10 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {system.systemRef} · {system.title}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Operations owner: {system.operationsOwner} · required by{" "}
                    {system.requiredAcceptanceDate}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                    system.position === "accepted"
                      ? "bg-emerald-400/15 text-emerald-300"
                      : system.position === "accepted_with_current_gaps"
                        ? "bg-amber-400/15 text-amber-300"
                        : system.position === "ready_for_human_acceptance"
                          ? "bg-signal-cyan/15 text-signal-cyan"
                          : "bg-rose-400/15 text-rose-300"
                  }`}
                >
                  {system.positionLabel}
                </span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {system.measures.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-white/8 bg-white/[0.02] p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {item.label}
                    </p>
                    <p className="mt-1 text-xl font-bold text-white">
                      {item.value}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-400">
                      {item.explanation}
                    </p>
                    <details className="mt-2 text-[10px] text-slate-500">
                      <summary className="cursor-pointer text-slate-400">
                        Record trail
                      </summary>
                      <ul className="mt-1 space-y-0.5 font-mono">
                        {item.recordRefs.map((ref) => (
                          <li key={ref}>{ref}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ))}
              </div>

              {system.blockers.length > 0 && (
                <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-300">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Named
                    blockers
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-rose-200">
                    {system.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="mt-3 text-[10px] text-slate-500">
                <summary className="cursor-pointer text-slate-400">
                  System and package record trail
                </summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {system.recordRefs.map((ref) => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] p-3 text-[11px] text-amber-200">
        <p>{briefing.decisionBoundary}</p>
        <p className="mt-1 text-amber-300/80">
          {briefing.equipmentReleaseBoundary}
        </p>
      </div>
    </section>
  );
}
