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
const developRegister = readFileSync("docs/sync-develop/register.md", "utf8");

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
    for (const metric of QUALITY_METRIC_DEFINITIONS) {
      expect(migration).toContain(`'key','${metric.key}'`);
      expect(migration).toContain(`'formula','${metric.formula}'`);
    }
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
    expect(migration).toContain(
      "ITP inspection requires assigned role ' || v_inspector_role",
    );
    expect(migration).toContain(
      "ITP release requires assigned role ' || v_witness_role",
    );
    expect(migration).not.toContain("'reliability_engineer','supervisor'");
    expect(migration).toContain("independent NCR closure is required");
    expect(migration).toContain("independent acceptance release is required");
    expect(migration).toContain(
      "acceptance performer provenance is required before independent release",
    );
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

  it("flips the Slice 7D D-family rows only where the 7D chain is cited", () => {
    const row = (id: string) => {
      const line = developRegister
        .split("\n")
        .find((candidate) => candidate.startsWith(`| ${id} `));
      expect(line, id).toBeTruthy();
      return line!;
    };
    expect(row("D4.03")).toMatch(/^\| D4\.03 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.03")).toContain("`quality_ncrs`");
    expect(row("D4.03")).toContain("`record_quality_ncr`");
    expect(row("D4.03")).toContain("`QualityManagementWorkbench`");
    expect(row("D4.06")).toMatch(/^\| D4\.06 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.06")).toContain("`QUALITY_METRIC_DEFINITIONS`");
    expect(row("D4.06")).toContain("`get_quality_cockpit`");
    expect(row("D4.02")).toMatch(/^\| D4\.02 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.04")).toMatch(/^\| D4\.04 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.05")).toMatch(/^\| D4\.05 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.01")).toMatch(/^\| D4\.01 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D4.01")).toContain("ONE project requirement table");
    expect(row("D4.07")).toMatch(/^\| D4\.07 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D4.07")).toContain("six terms");
  });
});
