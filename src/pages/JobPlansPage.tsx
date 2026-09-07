/**
 * Job Plans & Task Library — /job-plans.
 *
 * The standing task library is no longer a read-only remount. A planning or
 * engineering role authors a draft, a named human adopts it, and an adopted
 * plan is applied to a work order (C8.07, C4.05).
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
          Author, adopt, and apply reusable job plans. A draft is a proposal —
          adoption is the named-human act that makes a plan executable.
        </p>
      </div>
      <JobPlans />
    </div>
  );
}
