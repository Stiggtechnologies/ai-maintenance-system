import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101170000_mro_materials_agent.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/mroMaterialsAgentService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/MroMaterialsAgentWorkbench.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/MaterialsPage.tsx", "utf8");
const smoke = readFileSync("scripts/ci-mro-materials-agent-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed MRO Materials Specialist execution", () => {
  it("reuses the canonical material, stock, demand, supplier and run models", () => {
    expect(migration).toContain(
      "create or replace function public.run_mro_materials_agent",
    );
    for (const source of [
      "public.material_stock s",
      "public.material_stock_lots l",
      "public.work_order_materials d",
      "public.material_events e",
      "public.bom_lines b",
      "public.component_instances ci",
      "public.material_suppliers ms",
      "public.supplier_deliveries sd",
      "public.material_substitutions",
      "public.approved_substitutions",
    ])
      expect(migration).toContain(source);
    expect(migration).toContain("insert into public.agent_runs");
    expect(migration).toContain("'supplierdeliveries',v_deliveries");
    expect(migration).toContain("'installedcomponents',v_component_instances");
    expect(migration).toContain(
      "s.valid_from is null or s.valid_from<=now()",
    );
    expect(migration).toContain(
      "s.valid_until is null or s.valid_until>=now()",
    );
    expect(migration).not.toContain(
      "create table if not exists public.materials",
    );
    expect(migration).not.toContain(
      "create table if not exists public.material_stock",
    );
  });

  it("executes all five requested MRO modes without inventing thresholds", () => {
    for (const mode of [
      "'criticalspares'",
      "'reorderpolicy'",
      "'repairables'",
      "'stockouts'",
      "'obsolescence'",
    ])
      expect(migration).toContain(mode);
    expect(migration).toContain(
      "this is not safety stock or a recommended reorder point",
    );
    expect(migration).toContain("'turnarounddays',null");
    expect(migration).toContain("'repairyield',null");
    expect(migration).toContain("'remainingassetlife',null");
    expect(migration).toContain(
      "missing inventory has not been converted to zero",
    );
  });

  it("keeps every consequential material action outside agent authority", () => {
    for (const control of [
      "'maycreatepurchaseorder',false",
      "'maychangestock',false",
      "'mayreserveorissuematerial',false",
      "'mayapprovesupplier',false",
      "'maychangereorderpolicy',false",
      "'mayapprovesubstitution',false",
      "'maycommitspend',false",
      "'mayreleasework',false",
    ])
      expect(migration).toContain(control);
    expect(migration).toContain(
      "review owner must be a named human member of this organization",
    );
  });

  it("fails closed on templates, role, tenancy and adopted agent controls", () => {
    expect(migration).toContain(
      "platform advisory baseline: pending drafts only; accountable human approval remains mandatory.",
    );
    expect(migration).toContain(
      "template material classes are not operator inventory evidence",
    );
    expect(migration).toContain(
      "running the mro materials specialist requires a named planner",
    );
    expect(migration).toContain(
      "where id=p_material_id and organization_id=v_org",
    );
    expect(migration).toContain("evaluate_agent_control_internal");
    expect(migration).toContain("analyse_mro_material_position");
    expect(migration).toContain(
      "agent run names a material outside its organization",
    );
  });

  it("is reachable in the canonical materials workspace", () => {
    expect(service).toContain('"run_mro_materials_agent"');
    expect(service).toContain("MroMaterialsAgentRunReceipt");
    expect(service).toContain(
      "did not return a retained assessment receipt",
    );
    expect(service).toContain('"assign_mro_material_review"');
    expect(panel).toContain("Run assessment");
    expect(panel).toContain("setPackId(receipt.packId)");
    expect(panel).toContain("Assign review");
    expect(parent).toContain("<MroMaterialsAgentWorkbench");
  });

  it("keeps runtime proof in the clean migration gate and closes C1.08", () => {
    for (const proof of [
      "five_modes=true",
      "exact_source_snapshot=true",
      "template_refusal=true",
      "missing_stock_unknown=true",
      "role_gate=true",
      "tenant_wall=true",
      "immutable_pack=true",
      "named_review=true",
      "no_execution_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain("bash scripts/ci-mro-materials-agent-smoke.sh");
    expect(register).toMatch(/\| C1\.08 \|[^\n]+\| ✅[^\n]+/i);
  });
});
