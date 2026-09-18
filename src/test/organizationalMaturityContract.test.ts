import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ORGANIZATIONAL_MATURITY_DOMAINS,
} from "../services/organizationalMaturityService";

const migration = readFileSync(
  "supabase/migrations/20261219410000_organizational_maturity_assessment.sql",
  "utf8",
);
const page = readFileSync("src/pages/OrganizationalMaturityPage.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const shell = readFileSync("src/components/AppShell.tsx", "utf8");
const smoke = readFileSync("scripts/ci-organizational-maturity-smoke.sh", "utf8");

describe("U22.01 organizational maturity contract", () => {
  it("covers each named domain exactly once", () => {
    expect(ORGANIZATIONAL_MATURITY_DOMAINS).toHaveLength(13);
    expect(new Set(ORGANIZATIONAL_MATURITY_DOMAINS).size).toBe(13);
    for (const domain of ORGANIZATIONAL_MATURITY_DOMAINS) {
      expect(migration).toContain(`'${domain}'`);
      expect(page).toContain(`${domain}:`);
    }
  });

  it("reuses canonical evidence, recommendation, approval and audit records", () => {
    expect(migration).toContain("references public.evidence_items");
    expect(migration).toContain("insert into public.recommendations");
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/create table if not exists public\.(recommendations|approvals|audit_events|evidence_items)/);
  });

  it("refuses partial, unverified, self-reviewed and foreign-tenant paths", () => {
    expect(migration).toContain("each of the 13 canonical maturity domains must appear exactly once");
    expect(migration).toContain("requires same-tenant verified canonical evidence");
    expect(migration).toContain("the assessor cannot independently review their own assessment");
    expect(migration).toContain("assessment not found in this organization");
    expect(migration).toContain("maturity links are created only by the governed review function");
    expect(smoke).toContain("INCOMPLETE");
    expect(smoke).toContain("UNVERIFIED");
    expect(smoke).toContain("SELF_REVIEW");
    expect(smoke).toContain("FOREIGN_REVIEW");
  });

  it("keeps improvement work advisory and human-final", () => {
    expect(migration).toContain("'Human accountable-owner approval is required before implementation.'");
    expect(migration).toContain("'operationalAuthorization',false");
    expect(migration).toContain("'certificationClaim',false");
    expect(page).toContain("Assessment, not certification");
  });

  it("is reachable from the signed-in application", () => {
    expect(app).toContain('path="/organizational-maturity"');
    expect(shell).toContain('id: "organizational-maturity"');
    expect(shell).toContain('label: "Maturity Assessment"');
  });
});
