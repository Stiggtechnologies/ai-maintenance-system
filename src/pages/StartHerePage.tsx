/**
 * Post-eval-signup "Start here" — moat floor toward Orville acceptance bar.
 * Sequential checklist: Ask → Recommend → Approve → LEARN → optional connector → Stage-1.
 * Does NOT claim seamless onboarding is complete/live.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckSquare, Square, Shield } from "lucide-react";

const STORAGE_KEY = "syncai.start-here-checklist.v1";

type StepId =
  | "ask"
  | "recommend"
  | "approve"
  | "learn"
  | "connector"
  | "stage1";

type Step = {
  id: StepId;
  title: string;
  body: string;
  href: string;
  optional?: boolean;
};

const STEPS: readonly Step[] = [
  {
    id: "ask",
    title: "Ask",
    body: "Open Decision Workspace. Ask on a live subject or honest empty — no silent demo case.",
    href: "/decision-cases",
  },
  {
    id: "recommend",
    title: "Recommend",
    body: "Get a governed recommendation. Sync recommends; it does not authorize.",
    href: "/decision-cases",
  },
  {
    id: "approve",
    title: "Approve",
    body: "A named human approves (or rejects). Recommend is not authorize.",
    href: "/decision-cases",
  },
  {
    id: "learn",
    title: "LEARN",
    body: "Record verification so the outcome persists — or see a visible failure if it cannot.",
    href: "/decision-cases",
  },
  {
    id: "connector",
    title: "Optional: one thin connector",
    body: "Historian HTTPS JSON or CMMS read — your systems, read-only. Not certified PI/CMMS. Not write-back.",
    href: "/integrations",
    optional: true,
  },
  {
    id: "stage1",
    title: "Stage-1 status",
    body: "Open Mission Control runbook. Mark gates locally; honest green/yellow only — not a certification.",
    href: "/mission-control",
  },
] as const;

function readDone(): Partial<Record<StepId, boolean>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<StepId, boolean>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function StartHerePage() {
  const navigate = useNavigate();
  const [done, setDone] = useState(readDone);

  const requiredDone = useMemo(
    () => STEPS.filter((s) => !s.optional).every((s) => done[s.id]),
    [done],
  );

  const toggle = useCallback((id: StepId) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <main
      data-testid="start-here-page"
      className="min-h-full bg-[#0B0F14] p-4 text-[#E6EDF3] md:p-8"
    >
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-2xl border border-teal-500/30 bg-[#0D1520] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-teal-300">
            Set up Sync for your site · ~20 min
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            Start here
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            One evaluation path. Work the checklist in order. Local checkmarks
            only — they do not certify your site.
          </p>
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Recommend is not authorize. No plant execute. No silent demo
              case. Self-guided onboarding is the floor we are shipping — not a
              finished seamless claim until a no-walker rehearsal passes.
            </span>
          </div>
        </header>

        <ol className="space-y-3">
          {STEPS.map((step, index) => {
            const checked = Boolean(done[step.id]);
            return (
              <li
                key={step.id}
                data-testid={`start-here-step-${step.id}`}
                className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    aria-pressed={checked}
                    className="mt-0.5 text-teal-300"
                    onClick={() => toggle(step.id)}
                  >
                    {checked ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">
                      {index + 1}. {step.title}
                      {step.optional ? (
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          Optional
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      {step.body}
                    </p>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-teal-300 hover:text-teal-200"
                      onClick={() => navigate(step.href)}
                    >
                      Open step
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="text-center text-xs text-slate-500">
          {requiredDone
            ? "Required steps marked locally — open Mission Control for Stage-1 runbook detail."
            : "Work required steps in order. Use Help (when mounted) for questions."}
        </p>

        <button
          type="button"
          className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/5"
          onClick={() => navigate("/mission-control")}
        >
          Mission Control — Stage-1 runbook
        </button>
      </div>
    </main>
  );
}
