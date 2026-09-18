import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync(
  "supabase/functions/develop-benefits-agent/index.ts",
  "utf8",
);
const core = readFileSync(
  "supabase/functions/_shared/develop-benefits-core.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20261219160000_develop_benefits_agent_trace.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync("src/components/develop/RealizePanels.tsx", "utf8");
const deployment = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const config = readFileSync("supabase/config.toml", "utf8");
const register = readFileSync("docs/sync-develop/register.md", "utf8");

function registerRow(id: string) {
  return (
    register.split("\n").find((line) => line.startsWith(`| ${id} |`)) ?? ""
  );
}

describe("D12.16 Benefits Agent contract", () => {
  it("consumes the canonical governed benefits screen as the caller", () => {
    expect(edge).toContain('caller.rpc("get_case_benefits_screen"');
    expect(edge).toContain("Authorization: `Bearer ${token}`");
    expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(migration).toContain(
      "create or replace function public.get_case_benefits_screen",
    );
    expect(migration).toContain("'forecastMetricId',f.id");
    expect(migration).toContain("'actualMetricId',a.id");
    expect(migration).not.toMatch(/create table/i);
  });

  it("keeps missing values, residual and attribution limitations explicit", () => {
    expect(core).toContain('"actual_missing"');
    expect(core).toContain("remains explicitly unattributed");
    expect(core).toContain("Recorded attribution exceeds");
    expect(core).not.toMatch(/\?\?\s*0/);
  });

  it("is advisory-only and exposes no record or approval path", () => {
    expect(edge).toContain("advisory: true");
    expect(edge).toContain("not proof of causation");
    expect(edge).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
    expect(edge).not.toContain("verify_value_metric");
  });

  it("is customer reachable and included in controlled deployment", () => {
    expect(service).toContain('"develop-benefits-agent"');
    expect(panel).toContain("runBenefitsAgent(caseId)");
    expect(panel).toContain("Run Benefits Agent");
    expect(deployment).toContain("develop-benefits-agent");
    expect(config).toContain(
      "[functions.develop-benefits-agent]\nverify_jwt = true",
    );
  });

  it("promotes the capability only after the live governed smoke passed", () => {
    expect(registerRow("D12.16")).toMatch(/^\| D12\.16 \|[^|]*\|[^|]*\| ✅/);
  });
});
