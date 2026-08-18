/**
 * Reliability by Design — /design. In the sidebar (Whole Life) since the
 * project code became a parameter: the panel now enumerates the org's own
 * capital_projects and states plainly when there are none, so the P-7
 * disqualifier — a menu entry that renders permanently empty for real
 * tenants — no longer applies (navigation-lifecycle-ia.md §2 Group 5, §5
 * Step 8). Granted to the roles with read access on the destination
 * (reliability_engineer, executive, and the admin roles); every table behind
 * it is SELECT-only RLS, so the surface is read-only for everyone.
 */
import { ReliabilityByDesign } from "../components/ReliabilityByDesign";

export function ReliabilityByDesignPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Reliability by Design
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Availability targets, design requirements and early-life failures —
          the decisions made before anything is bought
        </p>
      </div>
      <ReliabilityByDesign />
    </div>
  );
}
