/**
 * PM Programme — /pm-programme.
 *
 * MaintenancePlanImport was mounted only inside the Asset Onboarding Hub's
 * empty state, so the moment a tenant had one asset the only in-product path
 * to load a PM programme disappeared — while get_work_management_health kept
 * telling them to "Load maintenance_plans to measure compliance". Remounting
 * the importer here closes that trap (navigation-lifecycle-ia.md §2 Group 4,
 * §5 Step 4). The first line below states the other half of the truth: a
 * stated gap, not a drawn screen.
 */
import { MaintenancePlanImport } from "../components/MaintenancePlanImport";

export function PmProgrammePage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          PM Programme
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          The platform can load and count maintenance plans, but it has no view
          that lists them yet — this page imports your programme, and
          work-management health measures compliance against it.
        </p>
      </div>
      <MaintenancePlanImport />
    </div>
  );
}
