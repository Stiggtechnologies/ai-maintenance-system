import { ArrowUpRight, ClipboardCheck, LogIn } from "lucide-react";
import { BrandWordmark } from "./BrandWordmark";

type PublicProductHeaderProps = {
  active: "copilot" | "proof";
  signInHref?: string;
  onSignIn?: () => void;
  showSignIn?: boolean;
};

export function PublicProductHeader({
  active,
  signInHref = "/signin",
  onSignIn,
  showSignIn = true,
}: PublicProductHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080C11]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-[64px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="/workspace"
          className="flex min-w-0 flex-col items-start justify-center gap-0"
          aria-label="SyncAI Reliability Engineer"
        >
          <BrandWordmark />
          <span
            data-testid="brand-job-title"
            className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-slate-400 leading-none"
          >
            Reliability Engineer
          </span>
        </a>
        <nav
          className="flex items-center gap-1 sm:gap-2"
          aria-label="Public navigation"
        >
          <a
            href="/setup"
            aria-current={active === "proof" ? "page" : undefined}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${active === "proof" ? "bg-teal-400 text-slate-950" : "border border-white/[0.09] text-slate-200 hover:bg-white/[0.05]"}`}
          >
            <ClipboardCheck size={15} />
            <span className="hidden sm:inline">Reliability Assessment</span>
            <span className="sm:hidden">Assess</span>
            <ArrowUpRight size={14} className="hidden sm:block" />
          </a>
          {showSignIn && (
            <a
              href={signInHref}
              onClick={onSignIn}
              aria-label="Sign in"
              title="Sign in"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.09] px-3 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white sm:px-4 sm:text-sm"
            >
              <LogIn size={15} />
              <span className="hidden sm:inline">Sign in</span>
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
