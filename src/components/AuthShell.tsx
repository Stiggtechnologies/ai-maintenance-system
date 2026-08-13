import { ReactNode } from "react";
import { Activity, BadgeCheck, FileCheck2, ShieldCheck } from "lucide-react";
import { OperationsLattice } from "./visual/OperationsLattice";

interface AuthShellProps {
  children: ReactNode;
  journey?: {
    caseNumber: string;
    asset: string;
    organization: string;
    site: string;
    statusLabel: string;
    version: string;
  } | null;
}

const PROOF = [
  {
    icon: FileCheck2,
    label: "Decision record",
    value: "context retained",
  },
  { icon: BadgeCheck, label: "Human authority", value: "identity verified" },
  { icon: Activity, label: "Value proof", value: "outcomes traced" },
];

export function AuthShell({ children, journey }: AuthShellProps) {
  return (
    <div className="bg-overlook-void text-overlook-paper relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 lg:right-[min(560px,42%)]">
        <OperationsLattice />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 18% 88%, rgba(18,54,87,0.55) 0%, rgba(6,17,29,0) 62%)",
          }}
        />
        <div className="from-overlook-void/85 via-overlook-void/45 to-overlook-void lg:to-overlook-void/95 absolute inset-0 bg-linear-to-r" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[1500px] flex-col lg:flex-row">
        <section className="hidden flex-1 flex-col justify-between p-10 lg:flex xl:p-14">
          <div className="reveal-rise flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="bg-signal-cyan/60 absolute inline-flex h-full w-full animate-ping rounded-full" />
              <span className="bg-signal-cyan relative inline-flex h-2.5 w-2.5 rounded-full" />
            </span>
            <span className="text-overlook-paper/90 text-sm font-semibold tracking-[0.24em] uppercase">
              SyncAI
            </span>
            <span className="text-overlook-mist/70 text-xs tracking-[0.18em] uppercase">
              Secure Decision Workspace
            </span>
          </div>

          <div className="reveal-rise reveal-d1 max-w-[42rem]">
            <p className="text-signal-gold text-xs font-medium tracking-[0.3em] uppercase">
              Governed engineering intelligence
            </p>
            <h1 className="mt-5 max-w-2xl text-4xl leading-[1.08] font-semibold tracking-normal text-balance xl:text-5xl">
              {journey
                ? `Continue ${journey.caseNumber}.`
                : "Sign in to your governed workspace."}
            </h1>
            <p className="text-overlook-mist mt-6 max-w-xl text-base leading-relaxed">
              {journey
                ? "Your question, evidence, recommendation, approval boundary, controlled work, and value trail will move with you."
                : "Return to the decisions, evidence, approvals, controlled work, and measured outcomes your team is governing."}
            </p>
            {journey && (
              <div className="mt-8 max-w-xl border-y border-white/10 py-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-signal-cyan/25 bg-signal-cyan/10 text-signal-cyan">
                    <ShieldCheck size={17} />
                  </span>
                  <div className="min-w-0">
                    <span className="text-overlook-haze block text-[0.68rem] font-semibold tracking-[0.16em] uppercase">
                      Decision Case ready to secure
                    </span>
                    <strong className="mt-1 block text-base text-overlook-paper">
                      {journey.asset}
                    </strong>
                    <span className="text-overlook-mist mt-1 block text-sm">
                      {journey.organization} · {journey.site}
                    </span>
                    <span className="text-signal-cyan mt-3 block text-xs font-semibold">
                      {journey.statusLabel} · {journey.version}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <dl className="reveal-rise reveal-d3 flex flex-wrap gap-x-10 gap-y-5">
            {PROOF.map(({ icon: Icon, label, value }) => (
              <div key={label} className="min-w-[9rem]">
                <dt className="text-overlook-mist/70 flex items-center gap-2 text-[0.7rem] tracking-[0.14em] uppercase">
                  <Icon className="text-signal-cyan h-3.5 w-3.5" aria-hidden />
                  {label}
                </dt>
                <dd className="text-overlook-paper/90 mt-1.5 font-mono text-sm">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex w-full flex-1 items-center justify-center p-5 sm:p-8 lg:w-[min(560px,42%)] lg:flex-none">
          <div className="reveal-settle w-full max-w-md">
            <div className="mb-6 lg:hidden">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="bg-signal-cyan/60 absolute inline-flex h-full w-full animate-ping rounded-full" />
                  <span className="bg-signal-cyan relative inline-flex h-2.5 w-2.5 rounded-full" />
                </span>
                <span className="text-sm font-semibold tracking-[0.24em] uppercase">
                  SyncAI
                </span>
              </div>
              {journey && (
                <p className="text-overlook-mist mt-3 text-sm">
                  Continue {journey.caseNumber} · {journey.asset}
                </p>
              )}
            </div>

            <div className="border-white/10 bg-overlook-hull/70 relative rounded-2xl border shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl">
              <div
                className="absolute inset-x-6 top-0 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(56,200,244,0.7), transparent)",
                }}
              />
              <div className="p-7 sm:p-8">{children}</div>
            </div>

            <p className="text-overlook-haze mt-5 text-center text-xs">
              Protected session · MFA enforced for enrolled accounts
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
