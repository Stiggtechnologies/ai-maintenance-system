/**
 * Operator Help M3 — thin first-run next-step strip.
 * Dismissible. No LMS. No plant data invent. Recommend ≠ authorize.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";

const STORAGE_KEY = "syncai.firstrun-next-step.v1";

function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function FirstRunNextStepStrip() {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(alreadyDismissed);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  }, []);

  if (hidden) return null;

  return (
    <div
      data-testid="firstrun-next-step-strip"
      className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-100">
            First-run next step
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
            For Stage-1 proof: open Decision Workspace and ask on a live subject
            (or honest empty). Field captures observations. Admin configures one
            thin connector under Integrations. Recommend is not authorize —
            no plant execute.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500/90 px-3 py-1.5 text-xs font-bold text-slate-950"
              onClick={() => navigate("/decision-cases")}
            >
              Decision Workspace
              <ArrowRight className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100"
              onClick={() => navigate("/field")}
            >
              Field
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100"
              onClick={() => navigate("/setup")}
            >
              RIA / setup
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100"
              onClick={() => navigate("/integrations")}
            >
              Integrations
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss first-run strip"
          className="shrink-0 text-amber-200/80 hover:text-white"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
