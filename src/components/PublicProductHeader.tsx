import { Activity, ArrowUpRight, ShieldCheck } from "lucide-react";

type PublicProductHeaderProps = {
  active: "copilot" | "proof";
};

export function PublicProductHeader({ active }: PublicProductHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080C11]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="/demo/copilot"
          className="flex min-w-0 items-center gap-3"
          aria-label="SyncAI live workspace"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-teal-300/25 bg-teal-300/10 text-teal-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <Activity size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-[#F8FAFC]">
              SyncAI
            </span>
            <span className="hidden text-xs text-slate-500 sm:block">
              Reliability Decision Intelligence
            </span>
          </span>
        </a>

        <nav
          className="flex items-center gap-1 sm:gap-2"
          aria-label="Public navigation"
        >
          <a
            href="/demo/copilot#syncai-chat"
            aria-current={active === "copilot" ? "page" : undefined}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${
              active === "copilot"
                ? "bg-white/[0.07] text-white"
                : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            <span className="hidden h-1.5 w-1.5 rounded-full bg-teal-300 sm:block" />
            Live workspace
          </a>
          <a
            href="/setup#value-proof-intake"
            aria-current={active === "proof" ? "page" : undefined}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${
              active === "proof"
                ? "bg-teal-400 text-slate-950"
                : "border border-white/[0.09] text-slate-200 hover:bg-white/[0.05]"
            }`}
          >
            <ShieldCheck size={15} />
            <span className="hidden sm:inline">48-hour value proof</span>
            <span className="sm:hidden">Value proof</span>
            <ArrowUpRight size={14} className="hidden sm:block" />
          </a>
        </nav>
      </div>
    </header>
  );
}
