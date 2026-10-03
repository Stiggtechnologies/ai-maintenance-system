import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const sql = stripComments(
  readFileSync(
    "supabase/migrations/20261225170000_material_commercial_feedback.sql",
    "utf8",
  ),
);

describe("material commercial feedback migration contract", () => {
  it("promotes every material relationship tenant key only through explicit historical validation", () => {
    const validation = stripComments(
      readFileSync(
        "supabase/migrations/20270101100000_validate_material_relationship_tenant_constraints.sql",
        "utf8",
      ),
    );
    const constraints = [
      "material_suppliers_material_tenant_fk",
      "material_suppliers_supplier_tenant_fk",
      "bom_lines_material_tenant_fk",
      "bom_lines_asset_tenant_fk",
      "bom_lines_component_parent_fk",
    ];

    for (const constraint of constraints) {
      expect(validation).toContain(`validate constraint ${constraint}`);
    }
    expect(validation.match(/validate constraint/g)).toHaveLength(
      constraints.length,
    );
    expect(validation).not.toMatch(
      /\b(insert|update|delete|truncate|drop|disable)\b/i,
    );
  });

  it("exposes canonical component BOM links without inventing component failure attribution", () => {
    const thread = stripComments(
      readFileSync(
        "supabase/migrations/20261225170400_material_commercial_component_thread.sql",
        "utf8",
      ),
    );
    expect(thread).toContain("from get_design_feedback_loop() f");
    expect(thread).not.toContain("top fifteen");
    expect(thread).toContain(
      "join public.components c on c.id = b.component_id",
    );
    expect(thread).toContain("c.asset_id = b.asset_id");
    expect(thread).toContain(
      "b.organization_id = v_org and c.organization_id = v_org",
    );
    expect(thread).toContain("'componentLinks'");
    expect(thread).toContain("'bomAssets'");
    expect(thread).toContain("Corrective work orders are asset-level history");
    expect(thread).not.toContain("w.component_id");
    expect(
      thread.match(/p\.id = l\.package_id and p\.organization_id = v_org/g),
    ).toHaveLength(2);
    expect(
      thread.match(/b\.package_id = p\.id and b\.organization_id = v_org/g),
    ).toHaveLength(2);
    expect(thread).toContain(
      "s.id = p.awarded_supplier_id and s.organization_id = v_org",
    );
    expect(thread).toContain(
      "s.id = any (v_suppliers) and s.organization_id = v_org",
    );
  });
  it("extends the canonical reverse traversal without a top-N cutoff", () => {
    expect(sql).toContain(
      "create or replace function public.get_design_feedback_loop()",
    );
    expect(sql).not.toMatch(/\blimit\s+\d+/i);
    expect(sql).toContain("order by m.n desc, m.fm");
    expect(sql).not.toMatch(/create\s+table/i);
  });

  it("retains invoker security and organization filters on both canonical sources", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("w.organization_id = app_current_org()");
    expect(sql.match(/d\.organization_id = app_current_org\(\)/g)).toHaveLength(
      2,
    );
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });

  it("keeps failure counts separate from requirement-reference counts", () => {
    expect(sql).toContain("w.work_type = 'corrective'");
    expect(sql).toContain("count(distinct w.asset_id)::bigint assets");
    expect(sql).toContain("d.derived_from_failure_mode = m.fm");
    expect(sql).toContain("requirements_referencing bigint");
    expect(sql).toContain("loop_closed boolean");
  });
});
