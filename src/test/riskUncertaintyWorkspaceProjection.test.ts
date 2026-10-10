import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const body = migration.match(
  /create or replace function public\.get_risk_uncertainty_workspace\(p_risk_id uuid\)([^]*?)\$\$;/,
)?.[1];

describe("uncertainty workspace canonical identity projection, source only", () => {
  it("echoes the authenticated canonical reader scope without client-selected organization or actor arguments", () => {
    expect(body).toBeDefined();
    expect(body).toContain("'organizationId',v_org,'actorId',auth.uid()");
    expect(body).toContain("v_org uuid:=public.app_current_org()");
    expect(body).toContain(
      "organization_id=v_org and public.can_read_risk(id)",
    );
    expect(body).not.toMatch(/p_(organization|actor|user)_id/);
    expect(body).toContain("'operationalAuthorization',false");
  });

  it("binds each nested canonical identity and retains the stored lifecycle separately from digest staleness", () => {
    for (const projection of [
      "'id',r.id,'organizationId',r.organization_id",
      "'id',c.id,'organizationId',c.organization_id",
      "'id',e.id,'organizationId',e.organization_id,'riskId',e.risk_id",
      "'id',a.id,'organizationId',a.organization_id,'riskId',a.risk_id",
      "'storedStatus',a.status",
    ])
      expect(body).toContain(projection);
    expect(body).toContain(
      "when a.analysis_digest is distinct from v_current then 'stale'",
    );
    expect(body).toContain("'sensitivityInputs',a.sensitivity_inputs");
    expect(body).toContain("'digestVersion',a.digest_version");
    expect(body).toContain("'digestCoverage',case a.digest_version");
    expect(body).toContain("when 1 then 'legacy_metadata'");
    expect(body).toContain(
      "when 2 then 'evidence_content_and_current_criteria'",
    );
    expect(body).toContain("where x.organization_id=v_org and x.risk_id=r.id");
  });

  it("specifies native and real HTTP controls for valid PostgreSQL values beyond JavaScript Date/positive-number representation", () => {
    const sql = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const http = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-http-smoke.mjs",
      "utf8",
    );
    expect(sql).toContain("-- U18 READ REPRESENTATION CONTROL BEGIN");
    expect(sql).toContain("'confidence_level',1e-999::numeric");
    expect(sql).toContain("'280000-01-01T00:00:00+00:00'");
    expect(sql).toContain(
      "read representation qualification or no-artifact rollback failed",
    );
    expect(http).toContain("// U18 READ REPRESENTATION HTTP BEGIN");
    expect(http).toContain('confidence_level: "1e-999"');
    expect(http).toContain("representationPacket.confidence.level, 0");
    expect(http).toContain("representation-only pending authority ledger");
  });
});
