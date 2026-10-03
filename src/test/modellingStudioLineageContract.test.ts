import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("D11.29 Modelling Studio calculation lineage", () => {
  const migration = read(
    "supabase/migrations/20270101920000_modelling_studio_calculation_lineage.sql",
  );
  const edge = read("supabase/functions/calculation-service/index.ts");
  const component = read("src/components/ModellingStudio.tsx");
  const service = read("src/services/modellingStudioService.ts");

  it("pins every displayed model family to the one immutable ledger", () => {
    for (const key of [
      "fault_tree_quantification",
      "shutdown_schedule_risk",
      "organization_rbd",
      "fleet_production_simulation",
      "maintenance_cost_forecast",
    ]) {
      expect(migration).toContain(`('${key}'`);
      expect(edge).toContain(`key: "${key}"`);
    }
    expect(edge).toContain('body.action === "modelling_studio"');
    expect(edge).toContain('service.rpc("record_calculation_run"');
    expect(edge).toContain('inputRef("asset_economics"');
    expect(edge).toContain('inputRef("common_cause_groups"');
    expect(edge).toContain('inputRef("common_cause_members"');
  });

  it("validates narrow tenant subjects and preserves advisory authority", () => {
    expect(migration).toContain("p_subject_type='fault_tree'");
    expect(migration).toContain("p_subject_type='shutdown_event'");
    expect(migration).toContain("t.organization_id=p_organization_id");
    expect(migration).toContain("e.organization_id=p_organization_id");
    expect(edge).toContain("operationalAuthorization: false");
    expect(edge).toContain("humanApprovalRequired: true");
  });

  it("keeps trusted calculations out of the browser", () => {
    expect(service).toContain('"calculation-service"');
    expect(service).toContain('action: "modelling_studio"');
    expect(component).toContain("runModellingStudio");
    expect(component).toContain("data.lineage");
    expect(component).not.toContain("runId.slice");
    expect(component).not.toContain("supabase.rpc");
    expect(component).not.toContain("analyseFaultTree");
    expect(component).not.toContain("simulateProduction");
    expect(component).not.toContain("forecastMaintenanceCost");
  });

  it("keeps the calculation-service static import closure bootable by Deno", () => {
    const visited = new Set<string>();
    const visit = (relativeFile: string) => {
      if (visited.has(relativeFile)) return;
      visited.add(relativeFile);
      const source = read(relativeFile);
      const imports = [
        ...source.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g),
      ].map((match) => match[1]);

      for (const specifier of imports) {
        expect(
          specifier,
          `${relativeFile} must use an explicit .ts extension for Deno`,
        ).toMatch(/\.ts$/);
        const resolved = path
          .resolve(root, path.dirname(relativeFile), specifier)
          .slice(root.length + 1);
        expect(
          fs.existsSync(path.join(root, resolved)),
          `${relativeFile} imports missing module ${specifier}`,
        ).toBe(true);
        visit(resolved);
      }
    };

    visit("supabase/functions/calculation-service/index.ts");
    expect(visited).toContain("src/lib/modelling/studio.ts");
  });
});
