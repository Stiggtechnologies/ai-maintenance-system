/**
 * Materials & Spares — /materials.
 *
 * The three materials panels — readiness against scheduled demand, spares
 * optimisation, supply exposure — were bolted under the Operational Briefing.
 * They are the materials half of the SOFT release constraints and get their
 * own address (navigation-lifecycle-ia.md §2 Group 6). Panels remounted, not
 * modified.
 */
import { RecoveryContextPanel } from "../components/RecoveryContextPanel";
import { MaterialsReadiness } from "../components/MaterialsReadiness";
import { SparesOptimization } from "../components/SparesOptimization";
import { SupplyExposure } from "../components/SupplyExposure";

export function MaterialsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Materials &amp; Spares
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Parts availability against scheduled demand, stocking economics and
          supply exposure
        </p>
      </div>
      <RecoveryContextPanel surface="materials" />
      <MaterialsReadiness />
      <SparesOptimization />
      <SupplyExposure />
    </div>
  );
}
