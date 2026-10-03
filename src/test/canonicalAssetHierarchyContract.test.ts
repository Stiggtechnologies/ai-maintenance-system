import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270101740000_canonical_asset_hierarchy.sql",
  "utf8",
);
const service = readFileSync("src/services/assetHierarchyService.ts", "utf8");
const panel = readFileSync("src/components/AssetHierarchyPanel.tsx", "utf8");
const ontology = readFileSync("src/components/AssetOntology.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-canonical-asset-hierarchy-smoke.sh",
  "utf8",
);

describe("U3.17 canonical asset hierarchy contract", () => {
  it("extends canonical identities instead of creating a shadow hierarchy", () => {
    expect(sql).toContain("alter table public.components");
    expect(sql).toContain("alter table public.asset_failure_mode_libraries");
    expect(sql).not.toMatch(/create table[^;]*(hierarchy|node)/i);
    for (const home of [
      "public.organizations",
      "public.asset_service_levels",
      "public.assets",
      "public.sites",
      "public.components",
      "public.asset_failure_mode_libraries",
    ]) {
      expect(sql).toContain(home);
    }
  });

  it("enforces exact physical parentage and evidence-backed FMMEA leaves", () => {
    for (const requirement of [
      "assembly",
      "maintainable_item",
      "component",
      "a maintainable item must sit directly below an assembly",
      "a component must sit directly below a maintainable item",
      "verification_status='verified'",
      "canonical_asset_id is not null and mechanism_id is not null",
      "failure_mode_hierarchy_component_fk",
      "failure_mode_binding_invalidated",
      "governed failure-mode hierarchy leaves are retained",
    ]) {
      expect(sql).toContain(requirement);
    }
  });

  it("changes the governed Data Steward fingerprint with hierarchy state", () => {
    expect(sql).toContain("sync_data_steward_source_snapshot");
    expect(sql).toContain("'hierarchyLevel',hierarchy_level");
    expect(sql).toContain("'parentComponentId',parent_component_id");
    expect(sql).toContain("'failureModeHierarchy'");
    expect(sql).toContain("'componentId',hierarchy_component_id");
  });

  it("walls hierarchy writes by tenant, role, workflow and audit provenance", () => {
    for (const control of [
      "public.app_current_org()",
      "syncai.asset_hierarchy_workflow",
      "record_component_hierarchy_node",
      "bind_failure_mode_to_component",
      "named same-tenant",
      "audit_events",
      "revoke all on function",
    ]) {
      expect(sql).toContain(control);
    }
    expect(sql).not.toMatch(/not in \([^)]*'ai_admin'/);
  });

  it("is customer-reachable and keeps missing layers and authority explicit", () => {
    expect(service).toContain('"get_canonical_asset_hierarchy_workspace"');
    expect(service).toContain('"record_component_hierarchy_node"');
    expect(service).toContain('"bind_failure_mode_to_component"');
    expect(panel).toContain("Missing:");
    expect(panel).toMatch(/Every\s+layer reuses its canonical record/);
    expect(panel).toContain("No engineering or operating determination");
    expect(ontology).toContain("<AssetHierarchyPanel />");
    expect(smoke).toContain("complete_path=true");
    expect(smoke).toContain("direct_write_refused=true");
  });
});
