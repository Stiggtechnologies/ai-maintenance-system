import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102320000_maintenance_induced_failure_identification.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/maintenanceInducedFailureService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/MaintenanceInducedFailureReview.tsx",
  "utf8",
);
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("governed maintenance-induced failure contract", () => {
  it("reuses canonical work, FRACAS, evidence and audit records", () => {
    for (const canonical of [
      "public.work_orders",
      "public.damage_mechanisms",
      "public.fracas_investigation_packs",
      "public.evidence_items",
      "public.audit_events",
    ]) {
      expect(migration).toContain(canonical);
    }
    expect(migration.match(/create table if not exists/gi)).toHaveLength(1);
    expect(migration).toContain(
      "create table if not exists public.maintenance_induced_failure_reviews",
    );
  });

  it("keeps candidates separate from named-human causal classification", () => {
    expect(migration).toContain(
      "Temporal proximity is never causation; only a named human may classify",
    );
    expect(migration).toContain("fracas_investigation_pack_id uuid not null");
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain(
      "coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin')",
    );
    expect(component).toMatch(
      /Time\s+proximity alone is never promoted into causation/,
    );
  });

  it("enforces same-tenant, exact-source and append-only review provenance", () => {
    expect(migration).toContain(
      "failure, intervention and FRACAS pack must name the same asset and failure",
    );
    expect(migration).toContain(
      "stored exposure must exactly match the source records",
    );
    expect(migration).toContain(
      "supporting evidence must be unique, verified and same-tenant",
    );
    expect(migration).toContain(
      "confirmed maintenance origin requires independently verified supporting evidence",
    );
    expect(
      migration.match(/public\.can_read_risk/g)?.length,
    ).toBeGreaterThanOrEqual(8);
    expect(migration).toContain(
      "maintenance-induced failure reviews are append-only",
    );
    expect(migration).toContain("unique (supersedes_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("makes the review reachable and preserves explicit no-authority limits", () => {
    expect(service).toContain('"review_maintenance_induced_failure"');
    expect(page).toContain("<MaintenanceInducedFailureReview />");
    expect(component).toContain("no work, approval, risk");
    for (const boundary of [
      "'mayChangeWork',false",
      "'mayApprove',false",
      "'mayAcceptRisk',false",
      "'mayCommitSpend',false",
      "'mayChangeOperatingLimits',false",
      "'mayReturnToService',false",
    ]) {
      expect(migration).toContain(boundary);
    }
  });

  it("ships a clean-stack runtime proof in CI", () => {
    expect(workflow).toContain(
      "Smoke — governed maintenance-induced failure identification",
    );
    expect(workflow).toContain("ci-maintenance-induced-failure-smoke.sh");
  });
});
