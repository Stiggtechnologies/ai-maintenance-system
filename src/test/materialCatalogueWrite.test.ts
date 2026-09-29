import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const read = (name: string) =>
  stripComments(readFileSync(`supabase/migrations/${name}`, "utf8"));
const catalogue = read("20261225170100_material_catalogue_write.sql");
const supplier = read("20261225170200_material_supplier_link.sql");
const bom = read("20261225170300_material_bom_link.sql");

describe("material relationship persistence contracts", () => {
  for (const [name, sql] of Object.entries({ catalogue, supplier, bom })) {
    it(`${name} binds the human actor to the tenant and writes the canonical audit`, () => {
      expect(sql).toContain("auth.uid()");
      expect(sql).toContain("id = v_actor and organization_id = v_org");
      expect(sql).toContain(
        "'maintenance_manager', 'reliability_engineer', 'planner'",
      );
      expect(sql).toContain("insert into public.audit_events");
      expect(sql).toContain("'actorId', v_actor");
      expect(sql).toContain("'basis', btrim(p_basis)");
      expect(sql).toContain("from public, anon, service_role");
    });
  }
  it("cannot silently overwrite a material or supplier qualification", () => {
    expect(catalogue).toContain(
      "on conflict (organization_id, material_code) do nothing",
    );
    expect(supplier).toContain(
      "on conflict (material_id, supplier_id) do nothing",
    );
    expect(supplier).toContain(
      "nullif(btrim(p_supplier_part_number), ''), false",
    );
    expect(supplier).not.toMatch(/do update|set approved_for_this_material/i);
  });
  it("validates both supplier relationship endpoints before writing", () => {
    expect(supplier).toContain(
      "id = p_material_id and organization_id = v_org for share",
    );
    expect(supplier).toContain(
      "id = p_supplier_id and organization_id = v_org for share",
    );
  });
  it("extends the existing BOM with same-parent component enforcement", () => {
    expect(bom).toContain(
      "alter table public.bom_lines add column if not exists component_id",
    );
    expect(bom).toContain("c.asset_id = new.asset_id");
    expect(bom).toContain("c.organization_id = new.organization_id");
    expect(bom).toContain("before insert or update on public.bom_lines");
    expect(bom).toContain(
      "p_qty_per::text in ('NaN', 'Infinity', '-Infinity')",
    );
    expect(bom).toContain("select exactly one asset or asset class");
    expect(bom).not.toMatch(/create table/i);
  });
});
