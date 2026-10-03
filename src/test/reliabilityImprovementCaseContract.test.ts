import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101930000_reliability_improvement_case.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/reliabilityImprovementCaseService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ReliabilityImprovementCasePanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");
const casePage = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const smoke = readFileSync(
  "scripts/ci-reliability-improvement-case-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("Reliability Engineer composite improvement workflow", () => {
  it("reuses canonical incidents, cases, asset scope and RAM instead of twinning them", () => {
    expect(migration).toContain(
      "create table if not exists public.fracas_improvement_case_links",
    );
    expect(migration).toContain("public.create_development_case(");
    expect(migration).toContain("public.bind_asset_to_development_case(");
    expect(migration).toContain("'reliability_improvement'");
    expect(migration).toContain("public.fracas_investigation_packs");
    expect(migration).toContain("public.development_cases");
    expect(migration).toContain("public.development_case_assets");
    expect(migration).not.toContain(
      "create table if not exists public.reliability_improvement_cases",
    );
    expect(migration).not.toContain("insert into public.development_cases");
    expect(migration).not.toContain(
      "create table if not exists public.reliability_fmea",
    );
  });

  it("fails closed on tenancy, role, named FRACAS ownership and immutable provenance", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("requires a named reliability engineer");
    expect(migration).toContain("assign a named human investigator");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain(
      "where id=p_fracas_pack_id and organization_id=v_org\n  for update",
    );
    expect(migration).toContain(
      "reliability improvement links are append-only",
    );
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.fracas_improvement_case_links",
    );
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain(
      "before truncate on public.fracas_improvement_case_links",
    );
    expect(migration).toContain("if tg_op='truncate'");
  });

  it("keeps the workflow advisory and preserves every human act", () => {
    expect(migration).toContain("'humanapprovalrequired',true");
    expect(migration).toContain("'mayapprovestrategy',false");
    expect(migration).toContain("'mayauthorizework',false");
    expect(migration).toContain("'maysanctioncase',false");
    expect(migration).not.toContain("sanction_development_case(");
    expect(migration).not.toContain("approve_recommendation(");
  });

  it("is customer-reachable from Reliability into the canonical case RAM surface", () => {
    expect(service).toContain('"get_reliability_improvement_workspace"');
    expect(service).toContain('"start_reliability_improvement_case"');
    expect(panel).toContain("Start governed improvement case");
    expect(panel).toContain("Open case RAM / FMEA / strategy");
    expect(page).toContain("<ReliabilityImprovementCasePanel />");
    expect(casePage).toContain('id="case-ram"');
  });

  it("has a clean-stack runtime proof wired into the migration gate", () => {
    for (const proof of [
      "tenant_rank=true",
      "named_fracas_owner=true",
      "canonical_case=true",
      "canonical_asset_scope=true",
      "immutable_link=true",
      "idempotent_handoff=true",
      "role_gate=true",
      "tenant_wall=true",
      "no_execution_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-reliability-improvement-case-smoke.sh",
    );
  });
});
