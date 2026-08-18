/**
 * Weekly Schedule & Crew — /scheduling.
 *
 * SchedulerPanel and WorkforceReadiness are one continuous job that was split
 * across a page: WorkforceReadiness derives the very capacity_hours figure
 * the scheduler levels against, so the labour half of the SOFT release
 * constraints resolves without leaving this page (navigation-lifecycle-ia.md
 * §2 Group 6, P-1; materials is the other half, on /materials). Both panels
 * are remounted, not modified — including WorkforceReadiness's named
 * single-point-of-knowledge column, kept per the spec's A-P6 decision because
 * it is a scheduling input.
 */
import { SchedulerPanel } from "../components/SchedulerPanel";
import { WorkforceReadiness } from "../components/WorkforceReadiness";

export function SchedulingPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Weekly Schedule &amp; Crew
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Schedule options levelled against the crew capacity they commit
        </p>
      </div>
      <SchedulerPanel />
      <WorkforceReadiness />
    </div>
  );
}
