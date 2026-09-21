import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220070000_spec34_graph_completion.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/spec34RelationshipService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/CoreGraphRelationshipsPanel.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const smoke5c = readFileSync("scripts/ci-develop-slice5c-smoke.sh", "utf8");
const smoke5d = readFileSync("scripts/ci-develop-slice5d-smoke.sh", "utf8");
const smoke7a = readFileSync("scripts/ci-develop-slice7a-smoke.sh", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("D11.21 final §34 relationships", () => {
  it("adds associations over canonical identities rather than duplicate objects", () => {
    expect(migration).toContain("create table if not exists public.contract_asset_links");
    expect(migration).toContain("references public.contract_packages(id)");
    expect(migration).toContain("references public.assets(id)");
    expect(migration).toContain("create table if not exists public.asset_objective_links");
    expect(migration).toContain("references public.risk_objectives(id)");
    expect(migration).toContain("public.development_case_assets ca");
    expect(migration).not.toMatch(/create table if not exists public\.(contracts|objectives|assets)\b/);
  });

  it("enforces tenancy, independent evidence, immutability, and human authorship", () => {
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain("e.verification_status<>'verified'");
    expect(migration).toContain("e.verified_by=new.recorded_by");
    expect(migration).toContain("A recorded core-graph relationship is immutable");
    expect(migration).toContain("requires an authorized named human");
    expect(migration).not.toMatch(/'ai_admin'\s*\)/);
    expect(migration).toContain("revoke insert,update,delete,truncate");
  });

  it("closes the governed ledger only after both homes exist", () => {
    expect(migration).toContain("contract_asset_links (20261220070000)");
    expect(migration).toContain("asset_objective_links (20261220070000)");
    expect(migration).toContain("'implementedEdgeCount',19");
    expect(migration).toContain("'absentEdgeCount',0");
  });

  it("is reachable from the case workspace with provenance and no authority claim", () => {
    expect(service).toContain('"get_case_spec34_relationships"');
    expect(service).toContain('"link_contract_to_asset"');
    expect(service).toContain('"link_asset_to_objective"');
    expect(panel).toContain("Contract PROVIDES Asset");
    expect(panel).toContain("Asset SUPPORTS Objective");
    expect(panel).toContain('verificationStatus === "verified"');
    expect(workspace).toContain("<CoreGraphRelationshipsPanel");
    expect(migration).toContain("not contract acceptance");
  });

  it("moves downstream §34 absence assertions to zero rather than leaving stale twos", () => {
    expect(smoke5c).toMatch(
      /spec34Edges'\] if e\['status'\]=='absent'\]\)"\)" = "0"/,
    );
    expect(smoke5c).toContain(
      "if e['edge']=='Contract PROVIDES Asset'][0]\")\" = \"live_elsewhere\"",
    );
    expect(smoke5c).toContain(
      "if e['edge']=='Asset SUPPORTS Objective'][0]\")\" = \"live_elsewhere\"",
    );
    expect(smoke5d).toContain("x->>'status'='absent'\")\" = \"0\"");
    expect(smoke5d).toContain(
      "sync_spec34_absent_edge_audit()->>'absentEdgeCount')\")\" = \"0\"",
    );
    expect(smoke5d).toContain("x['graph']['absentEdgeCount']\")\" = \"0\"");
    expect(smoke7a).toContain(
      "sync_spec34_absent_edge_audit()->>'absentEdgeCount'\")\" = \"0\"",
    );
    expect(smoke7a).toContain(
      "jsonb_array_length(sync_spec34_absent_edge_audit()->'edges')\")\" = \"0\"",
    );
    expect(ci).toContain("scripts/ci-spec34-graph-completion-smoke.sh");
  });
});
