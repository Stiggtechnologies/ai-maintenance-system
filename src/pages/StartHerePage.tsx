/**
 * Post-eval-signup "Start here" — moat-critical self-guided entry.
 * Does not claim seamless onboarding is complete. Recommend ≠ authorize.
 */
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ClipboardCheck,
  MapPin,
  MessageSquare,
  Plug,
  Shield,
} from "lucide-react";

const DOORS = [
  {
    title: "Decision Workspace",
    body: "Ask on a live subject or honest empty state. Recommendations need a named human to approve.",
    href: "/decision-cases",
    icon: MessageSquare,
  },
  {
    title: "Field",
    body: "Capture an observation as your turn — not a fake asset hop.",
    href: "/field",
    icon: MapPin,
  },
  {
    title: "RIA / assessment",
    body: "Bounded assessment path. Commercial terms are proposal/SOW — not in-app checkout.",
    href: "/setup",
    icon: ClipboardCheck,
  },
  {
    title: "Integrations",
    body: "Configure one thin read-only connector later with your systems. Not certified PI/CMMS. Not plant write-back.",
    href: "/integrations",
    icon: Plug,
  },
] as const;

export function StartHerePage() {
  const navigate = useNavigate();

  return (
    <main
      data-testid="start-here-page"
      className="min-h-full bg-[#0B0F14] p-4 text-[#E6EDF3] md:p-8"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-2xl border border-teal-500/30 bg-[#0D1520] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-300">
            Start here
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            Your evaluation workspace
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Pick one door. Sync recommends; humans authorize. There is no plant
            execute. Sample or seed data is never your live site unless you
            connect it.
          </p>
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Self-guided onboarding is the product floor we are shipping — Help
              and Stage-1 runbook land via Mission Control after you continue.
              This page is the required first path after signup.
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {DOORS.map((door) => {
            const Icon = door.icon;
            return (
              <button
                key={door.href}
                type="button"
                onClick={() => navigate(door.href)}
                className="rounded-2xl border border-white/10 bg-[#0D1520] p-4 text-left transition-colors hover:border-teal-400/40"
              >
                <div className="flex items-center gap-2 text-teal-300">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-semibold text-white">
                    {door.title}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {door.body}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-300">
                  Open
                  <ArrowRight className="h-3 w-3" />
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/5"
          onClick={() => navigate("/mission-control")}
        >
          Continue to Mission Control (Stage-1 runbook + Help)
        </button>
      </div>
    </main>
  );
}
