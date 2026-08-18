/**
 * Job Plans & Task Library — /job-plans.
 *
 * JobPlans is the standing task library — the maintenance programme's
 * building blocks — and it was mounted as one of eight panels bolted under
 * the Operational Briefing. It is remounted here unmodified
 * (navigation-lifecycle-ia.md §2 Group 4).
 */
import { JobPlans } from "../components/JobPlans";

export function JobPlansPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Job Plans &amp; Task Library
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Reusable task procedures linked to the damage mechanisms they manage
        </p>
      </div>
      <JobPlans />
    </div>
  );
}
