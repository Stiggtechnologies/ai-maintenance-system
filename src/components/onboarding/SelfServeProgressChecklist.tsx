import { FIRST_DECISION_HELP } from "../../lib/onboarding/first-decision-help";
import type { SelfServeProgress } from "../../lib/onboarding/self-serve-progress";
import { SelfServeNarration } from "./SelfServeNarration";

const STATUS_LABEL = {
  done: "Done",
  now: "Now",
  open: "Not yet",
} as const;

export function SelfServeProgressChecklist({
  progress,
  signupHref,
  narrationScript,
}: {
  progress: SelfServeProgress;
  signupHref: string;
  /** Spoken step. The open Decision Case stage replaces the checklist line. */
  narrationScript?: string;
}) {
  return (
    <section
      aria-label="Your progress"
      data-testid="self-serve-progress"
      className="space-y-3 rounded-2xl border border-white/10 bg-[#0D1520] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">
            Your path to a first Decision Case
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            A browser draft is not done. The Decision Case and first value count
            only after they are saved on the workspace.
          </p>
        </div>
        <SelfServeNarration script={narrationScript ?? progress.narration} />
      </div>
      <ol className="space-y-2">
        {progress.steps.map((step, index) => (
          <li
            key={step.id}
            data-testid={`self-serve-step-${step.id}`}
            data-status={step.status}
            className={`rounded-xl border px-3 py-2 ${
              step.status === "now"
                ? "border-teal-400/40 bg-teal-400/5"
                : "border-white/10"
            }`}
          >
            <p className="text-xs font-semibold text-white">
              {index + 1}. {step.title}
              <span className="ml-2 font-medium text-teal-200">
                {STATUS_LABEL[step.status]}
              </span>
            </p>
            <p
              data-testid={
                step.status === "done"
                  ? `self-serve-done-${step.id}`
                  : `self-serve-empty-${step.id}`
              }
              className="mt-1 text-xs leading-relaxed text-slate-300"
            >
              {step.status === "done" ? step.doneDetail : step.empty}
            </p>
            {step.id === "signup" && progress.offerWorkspace ? (
              <a
                className="mt-2 inline-flex text-xs font-semibold text-teal-300"
                href={signupHref}
              >
                Create your evaluation workspace
              </a>
            ) : null}
          </li>
        ))}
      </ol>
      <details
        id="first-decision-help"
        data-testid="first-decision-help"
        className="rounded-xl border border-white/10 px-3 py-2"
      >
        <summary className="cursor-pointer text-xs font-semibold text-teal-200">
          Help: reach your first Decision Case
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
          {FIRST_DECISION_HELP.content}
        </p>
      </details>
    </section>
  );
}
