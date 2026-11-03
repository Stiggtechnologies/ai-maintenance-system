import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271105131000_data_lineage.sql",
  "utf8",
);
const service = readFileSync("src/services/dataLineageService.ts", "utf8");
const panel = readFileSync("src/components/DataLineagePanel.tsx", "utf8");
const proposal = readFileSync("src/lib/data-governance/lineage.ts", "utf8");
const host = readFileSync("src/components/DataGovernance.tsx", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);
const row = register.split("\n").find((line) => line.startsWith("| E12.08 |"));

describe("E12.08 data lineage", () => {
  it("extends canonical domains and the audit ledger without a second store", () => {
    expect(migration).toContain("references public.data_domains(id)");
    expect(migration).toContain("references public.connectors(id)");
    expect(migration).toContain("insert into public.audit_events(");
    expect(migration).not.toMatch(/create table[^;]+audit/i);
    expect(migration).not.toMatch(/insert into public\.material_stock/i);
    expect(migration).not.toMatch(/update public\.material_stock/i);
    expect(migration).not.toMatch(/insert into public\.assets/i);
    expect(migration).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps writes on the named-human function and reads inside the tenant", () => {
    expect(migration).toContain("using (organization_id = app_current_org())");
    expect(migration).not.toMatch(/using\s*\([^)]*organization_id is null/i);
    expect(migration).toContain("new.organization_id is null");
    expect(migration).toContain(
      "revoke insert, update, delete, truncate on public.data_lineage_edges",
    );
    expect(migration).toContain("before truncate on public.data_lineage_edges");
    expect(migration).toContain("data lineage is append-only");
    expect(migration).toContain("data_governance_human_role_allowed()");
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain("canonical subject is not in this tenant");
    expect(migration).toContain("lineage parent chain contains a cycle");
    expect(migration).toContain(
      "lineage chain exceeds 20 hops and is refused rather than stored as a complete path",
    );
    expect(migration).toContain(
      "chain longer than 20 hops; remaining hops are not shown and are not treated as absent",
    );
    expect(migration).toContain("parent edge is not visible in this tenant");
    expect(migration).toContain("'writesSourceSystem', false");
    expect(migration).toContain("'changesCanonicalValues', false");
    expect(migration).toContain("'authorizesWork', false");
    expect(migration).toContain("'status', 'already_recorded'");
    expect(migration).toContain(
      "an open lineage edge already cites this source; supersede it",
    );
  });

  it("is reachable from Data Governance and only mocks a reviewed SAP mapping", () => {
    for (const fn of [
      "record_data_lineage_edge",
      "get_data_lineage",
      "get_data_lineage_register",
    ]) {
      expect(service).toContain(`"${fn}"`);
    }
    expect(panel).toContain("recordDataLineageEdge");
    expect(panel).toContain("readDataLineage");
    expect(panel).toContain("loadDataLineageRegister");
    expect(panel).toContain("lineageProposalFromMappedSapStock");
    expect(panel).toContain("does not call SAP");
    expect(host).toContain("<DataLineagePanel />");
    expect(proposal).not.toContain("supabase");
    expect(proposal).not.toMatch(/\bfetch\s*\(/);
    expect(proposal).toContain("does not call SAP");
    expect(proposal).toContain("will not infer zero");
  });

  it("promotes only the lineage row with resolvable evidence", () => {
    expect(row).toContain("| ✅ ");
    for (const citation of [
      "record_data_lineage_edge",
      "get_data_lineage",
      "get_data_lineage_register",
      "data_lineage_edges",
      "lineageProposalFromMappedSapStock",
      "20271105131000_data_lineage.sql",
    ]) {
      expect(row).toContain(`\`${citation}\``);
    }
  });
});
