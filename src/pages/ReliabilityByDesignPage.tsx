/**
 * Reliability by Design — /design. ROUTE ONLY, deliberately not in the
 * sidebar: the panel's RAM allocation is pinned to demo project DEMO-CP-01,
 * which real operator orgs cannot see, so a sidebar item would be a
 * permanently empty menu entry (navigation-lifecycle-ia.md §2 Group 5, the
 * P-7 rule). It is linked from /lifecycle instead, and stays out of every
 * restricted role's menu until the project code is a parameter.
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
