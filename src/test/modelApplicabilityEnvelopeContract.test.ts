import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219390000_model_applicability_envelopes.sql",
  "utf8",
);
const service = readFileSync("src/services/engineeringModelService.ts", "utf8");
const page = readFileSync("src/pages/EngineeringModelRegistryPage.tsx", "utf8");
const types = readFileSync("src/lib/engineering-models/types.ts", "utf8");
const smoke = readFileSync(
  "scripts/ci-model-applicability-envelope-smoke.sh",
  "utf8",
);

describe("U19.01 governed model applicability envelopes", () => {
  it("extends the canonical model, evidence, approval, calculation and audit stores", () => {
    expect(migration).toContain("alter table public.model_register");
    for (const canonical of [
      "public.engineering_model_evidence_bindings",
      "public.engineering_model_mechanisms",
      "public.evidence_items",
      "public.approvals",
      "public.calculation_runs",
      "public.audit_events",
      "public.assets",
    ]) {
      expect(migration).toContain(canonical);
    }
    expect(migration).not.toMatch(
      /create table if not exists public\.(model_registry|model_approvals|model_evidence|model_calculations)/,
    );
  });

  it("requires every named envelope dimension", () => {
    for (const dimension of [
      "assetTypes",
      "makeModel",
      "mechanismScope",
      "dutyClasses",
      "environmentClasses",
      "dataQuality",
      "rules",
      "trainingPopulation",
      "validationPeriod",
      "limitations",
    ]) {
      expect(types).toContain(dimension);
      expect(migration).toContain(dimension);
    }
  });

  it("requires exact-version independent review and current validation before eligibility", () => {
    expect(migration).toContain(
      "model author cannot independently review the applicability envelope",
    );
    expect(migration).toContain(
      "applicability reviewer requires assigned competency role",
    );
    expect(migration).toContain(
      "verified evidence must be bound to this model version for applicability",
    );
    expect(migration).toContain(
      "applicability_review_checksum is distinct from new.manifest_checksum",
    );
    expect(migration).toContain(
      "production eligibility requires a current independently approved applicability envelope",
    );
    expect(migration).toContain("applicability_validation_expired");
    expect(migration).toContain("applicability_validation_not_started");
    expect(migration).toContain("verified training-population evidence");
  });

  it("rechecks contextual scope at the immutable calculation boundary", () => {
    for (const refusal of [
      "applicability_envelope_unapproved",
      "asset_type_outside_envelope",
      "make_model_outside_envelope",
      "mechanism_outside_envelope",
      "duty_outside_envelope",
      "environment_outside_envelope",
      "data_quality_outside_envelope",
    ]) {
      expect(migration).toContain(refusal);
    }
    expect(migration).toContain(
      "create trigger trg_model_applicability_on_calculation before insert on public.calculation_runs",
    );
    expect(smoke).toContain("FOREIGN_MODEL_ID");
    expect(smoke).toContain("delete from user_role_assignments");
  });

  it("makes the controlled workflow customer-reachable without delegating authority", () => {
    expect(service).toContain("get_engineering_model_applicability_workspace");
    expect(service).toContain("review_engineering_model_applicability");
    expect(page).toContain("Applicability envelope");
    expect(page).toContain("maximum missing fraction");
    expect(page).toContain("Revalidate on:");
    expect(page).toContain("Approve envelope");
    expect(page).toContain("Reject");
    expect(migration).toContain("'operationalAuthorization',false");
    expect(migration).toContain(
      "revoke all on function public.review_engineering_model_applicability(bigint,text,uuid,text) from public,anon,service_role",
    );
  });
});
