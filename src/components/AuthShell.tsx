/**
 * AuthShell — the front door.
 *
 * A cinematic split: the left is the operations field (live lattice, the
 * platform's promise stated once, and a strip of proof); the right is a
 * disciplined glass credential panel. On mobile the field becomes an ambient
 * backdrop behind the panel so the page never fights for space.
 */
import { ReactNode } from "react";
import { Radio, ShieldCheck, Activity } from "lucide-react";
import { OperationsLattice } from "./visual/OperationsLattice";

interface AuthShellProps {
  children: ReactNode;
}

const PROOF = [
  {
    icon: Activity,
    label: "Autonomous operating loop",
    value: "6 agent passes",
  },
  { icon: Radio, label: "Live asset telemetry", value: "streaming" },
  { icon: ShieldCheck, label: "Governed by design", value: "human-approved" },
];

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="bg-overlook-void text-overlook-paper relative min-h-dvh overflow-hidden">
      {/* Field — full bleed on mobile, left half on desktop */}
      <div className="pointer-events-none absolute inset-0 lg:right-[min(560px,42%)]">
        <OperationsLattice />
        {/* Depth: radial lift from lower-left, then a scrim toward the panel */}
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
        {/* ── Left: the promise ─────────────────────────────────────────── */}
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
              Mission Assurance
            </span>
          </div>

          <div className="reveal-rise reveal-d1 max-w-2xl">
            <p className="text-signal-gold text-xs font-medium tracking-[0.3em] uppercase">
              Operations intelligence
            </p>
            <h1 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-[-0.02em] text-balance xl:text-[3.4rem]">
              Can we safely and reliably
              <br />
              <span className="text-signal-gold">
                deliver the production plan?
              </span>
            </h1>
            <p className="text-overlook-mist mt-6 max-w-xl text-base leading-relaxed">
              Every asset, sensor, and work order — continuously assessed by
              chartered reliability agents, routed to the people accountable,
              and evidenced end to end.
            </p>
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

        {/* ── Right: the credential panel ───────────────────────────────── */}
        <section className="flex w-full flex-1 items-center justify-center p-5 sm:p-8 lg:w-[min(560px,42%)] lg:flex-none">
          <div className="reveal-settle w-full max-w-md">
            {/* Mobile-only lockup — the left column is hidden below lg */}
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="relative flex h-2.5 w-2.5">
                <span className="bg-signal-cyan/60 absolute inline-flex h-full w-full animate-ping rounded-full" />
                <span className="bg-signal-cyan relative inline-flex h-2.5 w-2.5 rounded-full" />
              </span>
              <span className="text-sm font-semibold tracking-[0.24em] uppercase">
                SyncAI
              </span>
            </div>

            <div className="border-white/10 bg-overlook-hull/70 relative rounded-2xl border shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl">
              {/* Hairline of light across the top edge — the HUD tell */}
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
              Governed access · every session recorded to the security audit log
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
