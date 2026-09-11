import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219152000_develop_system_handover_package.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/handoverPackageService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/SystemHandoverPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/SyncTransitionPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("D8.09 system HandoverPackage contract", () => {
  it("adds the required per-system accountability object without copying canonical truth", () => {
    expect(migration).toContain("create table if not exists public.system_handover_packages");
    for (const field of [
      "commissioning_system_id",
      "owner_from",
      "owner_to",
      "required_acceptance_date",
      "accepted_at",
    ])
      expect(migration).toContain(field);
    expect(migration).toContain("source','acceptance_tests + commissioning_systems'");
    expect(migration).toContain("source','asset_onboarding_items'");
    expect(migration).toContain("risks + risk_acceptances");
    expect(migration).not.toContain("physical_readiness numeric");
    expect(migration).not.toContain("information_readiness numeric");
    expect(migration).not.toContain("operational_readiness numeric");
  });

  it("keeps transition handover separate from equipment return-to-service", () => {
    expect(migration).toContain("does not replace or mutate equipment_releases");
    expect(migration).not.toMatch(/insert into public\.equipment_releases/);
    expect(migration).not.toMatch(/update public\.equipment_releases/);
    expect(migration).not.toMatch(/delete from public\.equipment_releases/);
  });

  it("derives distinct physical, information, and operational dimensions", () => {
    expect(migration).toContain("'physicalreadiness'");
    expect(migration).toContain("'informationreadiness'");
    expect(migration).toContain("'operationalreadiness'");
    for (const category of [
      "asset_master",
      "bom",
      "task_list",
      "procedure",
      "documentation",
      "cyber",
      "spares",
      "pm",
      "training",
      "inspection",
      "condition_monitoring",
      "vendor_support",
      "emergency_response",
    ])
      expect(migration).toContain(`'${category}'`);
    expect(migration).toContain("'not_assessed'");
    expect(migration).toContain("i.evidence_item_id is not null");
    expect(migration).toContain("public.red_line_markups");
    expect(migration).toContain("open or in-review red-line markup(s) block");
  });

  it("assembles references to all current case/system risks and refuses stale drafts", () => {
    expect(migration).toContain("create table if not exists public.system_handover_residual_risks");
    expect(migration).toContain("r.development_case_id=s.development_case_id");
    expect(migration).toContain("commissioning_system_assets");
    expect(migration).toContain("the draft is stale: reassemble it");
    expect(migration).toContain("subject_type='risk'");
    expect(migration).toContain("a.expires_at>now()");
  });

  it("makes final acceptance a human, evidence-backed, segregated canonical transition", () => {
    expect(migration).toContain("accept_system_handover_package");
    expect(migration).toContain("only the named owner-to may accept operations ownership");
    expect(migration).toContain("the package preparer or outgoing owner cannot accept");
    expect(migration).toContain("v_transition:=public.transition_commissioning_system");
    expect(migration).toContain("v_role not in ('operator','maintenance_manager','executive','admin')");
    expect(migration).toContain("public.transition_commissioning_system(s.id,'accepted'");
    expect(migration).toContain("final commissioning acceptance requires the governed system handoverpackage workflow");
    expect(migration).toContain("same-tenant handover acceptance evidence is required");
    expect(migration).not.toMatch(/v_role\s*=\s*'ai_admin'.*accepted_at/s);
  });

  it("enforces tenant scope, immutable accepted evidence, and governed writes", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain("accepted system handover packages are immutable");
    expect(migration).toContain("handover residual-risk references are append-only");
    expect(migration).toContain("revoke all on function public.guard_system_handover_package() from public,anon,authenticated");
    expect(migration).toContain("revoke all on function public.guard_system_handover_residual_risk() from public,anon,authenticated");
  });

  it("is reachable from the Sync Transition customer surface and clean-chain smoke", () => {
    expect(service).toContain("get_case_system_handover_packages");
    expect(service).toContain("assemble_system_handover_package");
    expect(service).toContain("accept_system_handover_package");
    expect(panel).toContain("Physical readiness");
    expect(panel).toContain("Information readiness");
    expect(panel).toContain("Operational readiness");
    expect(panel).toContain("Residual risks");
    for (const column of [
      "Commissioning",
      "Punchlist",
      "As-built",
      "Asset data",
      "Operations acceptance",
    ])
      expect(panel).toContain(column);
    expect(page).toContain("<SystemHandoverPanel");
    expect(workflow).toContain("ci-develop-system-handover-package-smoke.sh");
  });
});
