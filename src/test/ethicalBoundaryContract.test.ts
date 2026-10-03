import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101680000_explicit_ethical_boundaries.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/ethicalBoundaryService.ts",
  "utf8",
);
const panel = readFileSync("src/components/EthicalBoundariesPanel.tsx", "utf8");
const governancePage = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");
const smoke = readFileSync("scripts/ci-ethical-boundaries-smoke.sh", "utf8");

const boundaryKeys = [
  "uncertainty_visibility",
  "metric_integrity",
  "safe_staffing",
  "nondiscrimination",
  "verified_surveillance",
  "individual_due_process",
  "safety_over_finance",
  "named_accountability",
  "no_fabricated_authority",
];

describe("U24.01 explicit ethical-boundary contract", () => {
  it("governs all nine named prohibitions exactly once", () => {
    expect(boundaryKeys).toHaveLength(9);
    expect(new Set(boundaryKeys).size).toBe(9);
    for (const key of boundaryKeys) {
      expect(migration.match(new RegExp(`\\('${key}'`, "g"))).toHaveLength(1);
    }
    expect(migration).toContain("every governed ethical boundary requires a determination");
  });

  it("reuses canonical evidence, recommendations, approvals, people and audit", () => {
    expect(migration).toContain("references public.evidence_items(organization_id,id)");
    expect(migration).toContain("insert into public.recommendations");
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("references public.user_profiles(id)");
    expect(migration).not.toMatch(
      /create table if not exists public\.(recommendations|approvals|audit_events|evidence_items|user_profiles)/,
    );
  });

  it("makes tenant, provenance and separation-of-duties boundaries unbypassable", () => {
    expect(migration).toContain("recommendations_ethical_boundary_review_tenant_fk");
    expect(migration).toContain("approvals_ethical_boundary_review_tenant_fk");
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain("verified_by is distinct from auth.uid()");
    expect(migration).toContain("a determination assessor cannot perform the independent ethical review");
    expect(migration).toContain("ethical boundary records move only through governed functions");
    expect(migration).toContain("revoke all on table public.ethical_boundary_reviews");
    expect(smoke).toContain("FOREIGN_EVIDENCE");
    expect(smoke).toContain("SELF_VERIFIED");
    expect(smoke).toContain("ASSESSOR_REVIEW");
    expect(smoke).toContain("DIRECT_WRITE");
  });

  it("keeps remediation advisory and adoption human-final", () => {
    expect(migration).toContain("approval_required");
    expect(migration).toContain("Independent accountable-owner approval is required.");
    expect(migration).toContain("'automation_authority',false");
    expect(migration).toContain("'automationAuthority',false");
    expect(migration).toContain("v_role not in ('admin','executive')");
    expect(panel).toContain("No current adopted posture");
    expect(panel).toContain("Independent disposition");
  });

  it("is reachable through a typed service and the signed-in governance page", () => {
    for (const rpc of [
      "get_ethical_boundary_workspace",
      "create_ethical_boundary_review",
      "set_ethical_boundary_determination",
      "submit_ethical_boundary_review",
      "review_ethical_boundaries",
    ]) {
      expect(service).toContain(`"${rpc}"`);
    }
    expect(governancePage).toContain(
      'import { EthicalBoundariesPanel } from "../components/EthicalBoundariesPanel"',
    );
    expect(governancePage).toContain("<EthicalBoundariesPanel />");
  });
});
