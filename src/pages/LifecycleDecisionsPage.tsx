/**
 * Repair / Replace / Retire — /lifecycle/decisions.
 *
 * LifecycleDecisions was the fifth of eight stacked panels on /reliability.
 * It is a whole-life economic decision, not a failure-modes analysis, and
 * decide_lifecycle_evaluation admits executives as well as engineers — so it
 * gets a whole-life address both roles can reach (navigation-lifecycle-ia.md
 * §2 Group 5). The panel is remounted, not modified.
 */
import { LifecycleDecisions } from "../components/LifecycleDecisions";
import { AssetEconomicsAdministration } from "../components/AssetEconomicsAdministration";
import { useAuth } from "../components/AuthProvider";

const ECONOMICS_EDITOR_ROLES = new Set([
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
]);

export function LifecycleDecisionsPage() {
  const { profile } = useAuth();
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Repair / Replace / Retire
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Economic end-of-life evaluations recorded with their inputs and
          decided by a human
        </p>
      </div>
      <AssetEconomicsAdministration
        canEdit={ECONOMICS_EDITOR_ROLES.has(profile?.role ?? "")}
      />
      <LifecycleDecisions />
    </div>
  );
}
