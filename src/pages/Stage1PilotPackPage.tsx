/**
 * Stage-1 pilot pack — live ops close beyond the operator runbook checklist.
 *
 * Three product acts, each on an existing canonical door:
 *   1. import plans + WO history (ContractImport + CMMS read #366)
 *   2. adopt DoA limits (adopt_authority_limit / state_authority_ceiling)
 *   3. name KPI owners (raci_assignments overlay on the ISO 55000 catalog)
 *
 * Clone the method, not the pilot. No invented plant data. No demo default.
 */
import { Stage1ImportLivePath } from "../components/Stage1ImportLivePath";
import { AccountabilityCascade } from "../components/AccountabilityCascade";
import { Stage1KpiOwners } from "../components/Stage1KpiOwners";
import { Stage1OperatorRunbook } from "../components/help/Stage1OperatorRunbook";

export function Stage1PilotPackPage() {
  return (
    <div className="space-y-6 p-6" data-testid="stage1-pilot-pack-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Stage-1 pilot pack
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Operable close for one lighthouse site. Sync governs dirty reality; AI
          recommends; a named human owns the call. The runbook is local progress
          only. The three panels below are live write paths. Empty states stay
          empty until this tenant has real rows — historical fleet studies are
          not this site.
        </p>
      </div>
      <Stage1OperatorRunbook />
      <Stage1ImportLivePath />
      <AccountabilityCascade />
      <Stage1KpiOwners />
    </div>
  );
}
