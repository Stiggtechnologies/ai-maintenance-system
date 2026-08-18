/**
 * Lifecycle Position — /lifecycle.
 *
 * LifecycleStages renders the seeded EN 16646 whole-life model, but it was
 * mounted under the fabricated Conveyor C-22 page with no nav entry.
 * Remounted here unmodified (navigation-lifecycle-ia.md §2 Group 5).
 *
 * The link to /design remains from when Reliability by Design was route-only
 * (its RAM allocation was pinned to the demo project code — spec §2, P-7
 * rule). The pin is gone and /design is now a Whole Life sidebar item for
 * the design-review roles; the in-page link stays because the design gate is
 * part of the lifecycle story this page tells.
 */
import { useNavigate } from "react-router-dom";
import { DraftingCompass } from "lucide-react";
import { LifecycleStages } from "../components/LifecycleStages";

export function LifecyclePositionPage() {
  const navigate = useNavigate();
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Lifecycle Position
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Where each asset sits in the whole-life model, and what each stage
          gate requires
        </p>
      </div>
      <LifecycleStages />
      <button
        onClick={() => navigate("/design")}
        className="flex w-full items-start gap-3 rounded-xl border border-white/6 bg-[#0D1520] p-4 text-left hover:bg-white/4 transition-colors"
      >
        <DraftingCompass
          className="mt-0.5 h-4 w-4 shrink-0 text-signal-cyan"
          aria-hidden
        />
        <span>
          <span className="block text-sm font-semibold text-slate-200">
            Reliability by Design
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">
            The decisions made before anything is bought — RAM allocation,
            design requirements and the operations-to-design feedback loop.
            Currently scoped to the demo capital project, so it is reachable
            from here rather than the sidebar.
          </span>
        </span>
      </button>
    </div>
  );
}
