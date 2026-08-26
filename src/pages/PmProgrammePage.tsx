/**
 * PM Programme and operational data import — /pm-programme.
 *
 * The importer was mounted only inside the Asset Onboarding Hub's empty state,
 * so the moment a tenant had one asset the only in-product path to load a PM
 * programme disappeared — while get_work_management_health kept telling them to
 * "Load maintenance_plans to measure compliance". Remounting it here closed
 * that trap (navigation-lifecycle-ia.md §2 Group 4, §5 Step 4).
 *
 * The route and its nav entry keep the name they were given, deliberately: the
 * PM programme is why this page exists and why three roles have it in their
 * navigation, and the roles that can see it (planner, reliability_engineer,
 * maintenance_manager, plus full-nav admin and ai_admin) are exactly the roles
 * begin_manual_import admits. Renaming the route would have churned
 * roleNavigation.ts and a contested IA document to say something the page can
 * say in a sentence.
 *
 * The first line below states the other half of the truth: a stated gap, not a
 * drawn screen.
 */
import { ContractImport } from "../components/ContractImport";

export function PmProgrammePage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          PM Programme &amp; data import
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          The platform can load and count maintenance plans, but it has no view
          that lists them yet — this page imports your programme, and
          work-management health measures compliance against it. The same
          contract carries work orders, notifications, operating states,
          production, condition readings and spares on hand.
        </p>
      </div>
      <ContractImport initialEntity="maintenance_plan" />
    </div>
  );
}
