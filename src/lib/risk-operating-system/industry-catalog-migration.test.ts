import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getRiskIndustryPackCatalog } from ".";

const baseSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260922090000_industry_catalog_kernel_bound_readiness.sql",
  ),
  "utf8",
).toLowerCase();
const readinessPatch = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261002090000_buildings_industry_pack_readiness.sql",
  ),
  "utf8",
).toLowerCase();
const batteryPatch = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261219139000_battery_energy_storage_pack.sql",
  ),
  "utf8",
).toLowerCase();
const healthcarePatch = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261219230000_healthcare_pack.sql",
  ),
  "utf8",
).toLowerCase();
const sql = `${baseSql}\n${readinessPatch}\n${batteryPatch}\n${healthcarePatch}`;
const allowlistSql = `${baseSql}\n${readinessPatch.replaceAll("''", "'")}\n${batteryPatch.replaceAll("''", "'")}\n${healthcarePatch.replaceAll("''", "'")}`;

describe("ISO 31000 industry-catalog correction migration", () => {
  it("durably records the controlled discovery and roadmap on the canonical context", () => {
    expect(sql).toContain("alter table public.risk_context_nodes");
    expect(sql).toContain("implementation_discovery jsonb");
    expect(sql).toContain("implementation_gap_assessment jsonb");
    expect(sql).toContain("implementation_roadmap jsonb");
    expect(sql).toContain("p_answers,");
    expect(sql).toContain("v_roadmap");
    expect(sql).toContain("v_gap_assessment");
    expect(sql).toContain("'maturity_score', null");
    expect(sql).toContain("'human_review_required', true");
    expect(sql).not.toContain(
      "'gap_assessment', 'pending evidence-based maturity assessment'",
    );
    expect(sql).not.toContain("create table if not exists risk_implementation");
  });

  it("keeps real dependencies separate from industry guidance", () => {
    expect(sql).toContain("p_answers -> 'dependencies'");
    expect(sql).not.toMatch(
      /dependencies[\s\S]{0,120}p_answers\s*->\s*'industry_risk_objects'/,
    );
  });

  it("enforces the complete implementation discovery contract", () => {
    for (const field of [
      "objectives",
      "critical_services",
      "stakeholders",
      "obligations",
      "dependencies",
      "existing_systems",
      "risk_capture_systems",
      "consequence_dimensions",
      "likelihood_scale",
      "risk_tolerances",
      "decision_points",
      "treatment_tracking_systems",
      "risk_owner_role",
      "acceptance_authority",
      "escalation_thresholds",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("implementation discovery exceeds 64 kb");
    expect(sql).toContain("v_role is null or v_role not in");
    expect(sql).toContain("consequence_dimensions[]");
    expect(sql).toContain("likelihood_scale[]");
  });

  it("persists pack provenance without treating draft content as adopted policy", () => {
    expect(sql).toContain("industry_pack_readiness");
    expect(sql).toContain("industry_pack_validation");
    expect(sql).toContain("content validation:");
    expect(sql).toContain(
      "draft: customer governance, domain and legal review required",
    );
    expect(sql).toContain("human_adoption_required");
    expect(sql).toContain(
      "industry pack provenance does not match the governed catalog",
    );
    expect(sql).toContain("industry code is not in the governed catalog");
  });

  it("keeps the database provenance allowlist synchronized with the UI catalog", () => {
    for (const pack of getRiskIndustryPackCatalog().filter(
      (item) => item.readiness !== "custom",
    )) {
      const label = pack.label
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(allowlistSql).toMatch(
        new RegExp(
          `when '${pack.industryCode}' then v_expected_label := '${label}'; v_expected_readiness := '${pack.readiness}'`,
        ),
      );
    }
  });

  it("advances Buildings only after a real template and profile exist", () => {
    expect(readinessPatch).toContain(
      "v_expected_readiness := ''kernel_bound''",
    );
    expect(readinessPatch).toContain(
      "expected focus_draft predecessor is absent",
    );
    expect(readinessPatch).toContain("pg_get_functiondef");
  });

  it("adds Battery only after its executable template/profile/module exist", () => {
    expect(batteryPatch).toContain(
      "when ''battery_energy_storage'' then v_expected_label := ''battery & energy storage''; v_expected_readiness := ''kernel_bound''",
    );
    expect(batteryPatch).toContain(
      "expected kernel-bound buildings predecessor is absent",
    );
    expect(batteryPatch).toContain("pg_get_functiondef");
  });

  it("adds Healthcare only after its executable template/profile/module exist", () => {
    expect(healthcarePatch).toContain(
      "when ''healthcare'' then v_expected_label := ''healthcare''; v_expected_readiness := ''kernel_bound''",
    );
    expect(healthcarePatch).toContain(
      "expected battery & energy storage predecessor is absent",
    );
    expect(healthcarePatch).toContain("pg_get_functiondef");
  });

  it("keeps the corrected RPC private to authenticated tenant roles", () => {
    expect(sql).toContain(
      "revoke execute on function public.start_iso31000_implementation(jsonb) from public, anon",
    );
    expect(sql).toContain(
      "grant execute on function public.start_iso31000_implementation(jsonb) to authenticated, service_role",
    );
    expect(sql).toContain(
      "create or replace function public.get_iso31000_implementation_state()",
    );
    expect(sql).toContain("context.organization_id = v_org");
    expect(sql).toContain(
      "revoke execute on function public.get_iso31000_implementation_state() from public, anon",
    );
  });
});
