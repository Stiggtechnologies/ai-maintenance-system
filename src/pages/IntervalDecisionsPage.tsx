/**
 * Interval Decisions — /reliability/intervals.
 *
 * IntervalOptimization is the one screen that answers "how was this interval
 * decided" from the customer's own work-order history, and it refuses to
 * return an interval when the fitted β ≤ 1. It was buried as the fourth of
 * eight stacked panels on /reliability; the spec gives it its own route so
 * the executive question is one click deep (navigation-lifecycle-ia.md §2
 * Group 3). The panel is remounted, not modified.
 */
import { IntervalOptimization } from "../components/IntervalOptimization";

export function IntervalDecisionsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Interval Decisions
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Replacement intervals derived from your own failure history — with the
          basis shown, or a refusal
        </p>
      </div>
      <IntervalOptimization />
    </div>
  );
}
