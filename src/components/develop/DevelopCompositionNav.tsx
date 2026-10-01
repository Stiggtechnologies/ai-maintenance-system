import { ArrowUpRight, Boxes, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DEVELOP_COMPOSITION_BOUNDARY,
  DEVELOP_ENGINES,
  DEVELOP_MODULES,
  DEVELOP_OVERLAYS,
  developModuleHref,
} from "../../lib/develop/composition";

/**
 * The case-level composition surface for D11.02 and D11.13.
 *
 * It is intentionally a map over canonical surfaces. No state is stored here,
 * no verdict is recomputed here, and following a link grants no authority.
 */
export function DevelopCompositionNav({ caseId }: { caseId: string }) {
  return (
    <section
      aria-labelledby="develop-composition-title"
      className="rounded-xl border border-white/8 bg-gradient-to-br from-[#101C2A] to-[#0A111B] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.18)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-signal-cyan" aria-hidden />
            <h2
              id="develop-composition-title"
              className="text-sm font-semibold text-slate-100"
            >
              Eight engines. One governed case.
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            Move from framing to realized value without creating another copy of
            the project. Every destination below opens the existing records,
            controls and evidence for this case.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Human authority preserved
        </div>
      </div>

      <nav
        aria-label="Sync Develop engines"
        className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8"
      >
        {DEVELOP_ENGINES.map((engine, index) => (
          <a
            key={engine.key}
            href={`#${engine.anchor}`}
            className="group rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2.5 transition hover:border-signal-cyan/35 hover:bg-signal-cyan/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan/70"
          >
            <span className="text-[10px] font-semibold tabular-nums text-slate-600">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="mt-0.5 flex items-center justify-between text-xs font-semibold text-slate-200 group-hover:text-signal-cyan">
              {engine.label}
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </span>
            <span className="mt-1 block text-[10px] leading-4 text-slate-500">
              {engine.question}
            </span>
          </a>
        ))}
      </nav>

      <details className="mt-3 rounded-lg border border-white/6 bg-black/10">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">
          All 15 product modules
        </summary>
        <div className="grid grid-cols-1 gap-px border-t border-white/6 bg-white/6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {DEVELOP_MODULES.map((module) => {
            const href = developModuleHref(module, caseId);
            const body = (
              <>
                <span className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  {module.label}
                  <ArrowUpRight
                    className="h-3 w-3 text-slate-500"
                    aria-hidden
                  />
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">
                  {module.purpose}
                </span>
              </>
            );
            const className =
              "bg-[#0B141F] px-3 py-2.5 transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-cyan/70";
            return module.target.kind === "anchor" ? (
              <a key={module.key} href={href} className={className}>
                {body}
              </a>
            ) : (
              <Link key={module.key} to={href} className={className}>
                {body}
              </Link>
            );
          })}
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
        <span className="mr-1 font-semibold uppercase tracking-wide text-slate-600">
          Cross-cutting
        </span>
        {DEVELOP_OVERLAYS.map((overlay) => (
          <span
            key={overlay}
            className="rounded-full border border-white/6 px-2 py-0.5"
          >
            {overlay}
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-1 text-[10px] leading-4 text-slate-500 lg:grid-cols-3">
        <p>{DEVELOP_COMPOSITION_BOUNDARY.data}</p>
        <p>{DEVELOP_COMPOSITION_BOUNDARY.authority}</p>
        <p>{DEVELOP_COMPOSITION_BOUNDARY.ai}</p>
      </div>
    </section>
  );
}
