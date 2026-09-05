import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUALITY_METRIC_DEFINITIONS } from "../lib/quality-management";

const migration = readFileSync(
  "supabase/migrations/20261213090100_quality_management_family.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/qualityManagementService.ts",
  "utf8",
);
const page = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const workflow = readFileSync(
  ".github/workflows/domain-specialists-closeout.yml",
  "utf8",
);

describe("Slice 7D production contract", () => {
  it("owns every requested aggregate without cloning canonical work or acceptance records", () => {
    for (const table of [
      "quality_requirements",
      "quality_itps",
      "quality_itp_points",
      "quality_ncrs",
      "quality_defects",
      "quality_rework_records",
      "quality_cost_entries",
    ])
      expect(migration).toContain(`create table if not exists public.${table}`);
    expect(migration).toContain("alter table public.acceptance_tests");
    expect(migration).not.toContain(
      "create table if not exists public.quality_acceptance_tests",
    );
    expect(migration).toContain(
      "work_order_id uuid not null references public.work_orders(id)",
    );
  });

  it("keeps the seven TypeScript and SQL metric contracts aligned", () => {
    expect(QUALITY_METRIC_DEFINITIONS).toHaveLength(7);
    for (const metric of QUALITY_METRIC_DEFINITIONS)
      expect(migration).toContain(`'key','${metric.key}'`);
    expect(migration).toContain(
      "'costOfPoorQuality',internal_failure+external_failure",
    );
    expect(migration).toContain("group by currency");
  });

  it("enforces tenant evidence, controlled lifecycle, and independent release", () => {
    expect(migration).toContain("quality_scope_in_org(p_record,v_org)");
    expect(migration).toContain("same-tenant evidence is required");
    expect(migration).toContain(
      "hold/witness-point release requires an independent actor",
    );
    expect(migration).toContain("independent NCR closure is required");
    expect(migration).toContain("independent acceptance release is required");
    expect(migration).toContain(
      "release requires a pass outcome and zero open punch items",
    );
    expect(migration).toContain("invalid NCR lifecycle transition");
  });

  it("wires all 13 operations and the cockpit into the live risk workspace", () => {
    expect(service.match(/case "/g) ?? []).toHaveLength(13);
    expect(service).toContain('supabase.rpc("get_quality_cockpit"');
    expect(page).toContain("<QualityManagementWorkbench />");
    expect(workflow).toContain("ci-quality-management-smoke.sh");
  });
});
