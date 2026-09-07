import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261216090101_engineering_model_supply_chain.sql",
  "utf8",
);

describe("engineering model supply-chain migration", () => {
  it("extends the canonical stores and does not create a parallel model registry", () => {
    expect(sql).toContain("alter table public.model_register");
    expect(sql).not.toMatch(
      /create table if not exists public\.(physics_model_packs|engineering_model_registry)\b/,
    );
    for (const store of [
      "calculation_runs",
      "model_predictions",
      "approvals",
      "asset_failure_mode_libraries",
    ]) {
      expect(sql).toContain(`alter table public.${store}`);
    }
  });

  it("makes ingestion, verification and execution service-only", () => {
    expect(sql).toContain("if auth.role()<>'service_role' then");
    expect(sql).toContain(
      "grant execute on function public.ingest_engineering_model_pack(uuid,uuid,jsonb,text) to service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.record_engineering_model_verification(uuid,uuid,bigint,jsonb,jsonb,jsonb) to service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.record_engineering_model_run(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb) to service_role",
    );
    expect(sql).not.toContain(
      "grant execute on function public.ingest_engineering_model_pack(uuid,uuid,jsonb,text) to authenticated",
    );
  });

  it("enforces the complete lifecycle, independent competency and evidence gates", () => {
    for (const state of [
      "draft",
      "derived",
      "verified",
      "bench_validated",
      "field_validated",
      "engineering_approved",
      "production_eligible",
      "revalidation_required",
      "retired",
    ]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toContain(
      "model author cannot complete independent engineering approval",
    );
    expect(sql).toContain(
      "required production evidence binding(s) are missing",
    );
    expect(sql).toContain("blocking or expired verification debt remains open");
    expect(sql).toContain(
      "a dependency is incompatible or not production-eligible",
    );
    expect(sql).toContain("revalidation_started_at");
    expect(sql).toContain(
      "m.revalidation_started_at is null or computed_at>=m.revalidation_started_at",
    );
  });

  it("reuses canonical mechanisms, evidence, configuration, work and outcome records", () => {
    for (const relation of [
      "damage_mechanisms",
      "evidence_items",
      "configuration_baselines",
      "work_orders",
      "recommendations",
      "decisions",
    ]) {
      expect(sql).toContain(`public.${relation}`);
    }
    expect(sql).toContain("record_engineering_model_field_outcome");
    expect(sql).toContain("record_engineering_model_intervention");
    expect(sql).toContain("review_engineering_model_impact");
    expect(sql).toContain("record_fmmea_model_binding");
    expect(sql).toContain(
      "canonical evidence must be human-verified before model binding",
    );
    expect(sql).toContain(
      "declared engineering evidence grade exceeds the canonical evidence quality grade",
    );
  });

  it("keeps child records tenant-readable and function-write-only", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("using (organization_id = public.app_current_org())");
    expect(sql).toContain(
      "revoke insert,update,delete,truncate on table public.%I from anon,authenticated",
    );
    expect(sql).toContain(
      "revoke insert,update,delete,truncate on table public.model_register from anon,authenticated",
    );
  });

  it("reapplies bounded execution controls at the database boundary", () => {
    for (const refusal of [
      "model_not_production_eligible",
      "arbitrary_code_prohibited",
      "configuration_baseline_mismatch",
      "asset_family_not_canonical",
      "input_value_not_allowed",
      "measurement_quality_insufficient",
      "evidence_outside_asset_or_tenant",
      "model_evidence_not_current",
    ]) {
      expect(sql).toContain(`'${refusal}'`);
    }
    expect(sql).toContain(
      "coalesce((p_execution_environment->>'networkUsed')::boolean,true)<>false",
    );
    expect(sql).toContain("as-maintained configuration baseline is required");
  });

  it("requires complete intervention, outcome-learning, and physics FMMEA records", () => {
    expect(sql).toContain(
      "field outcomes can only be attached to a successfully computed engineering run",
    );
    for (const field of [
      "observedBasis",
      "predictionAssessment",
      "designFeedback",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain(
      "current as-maintained configuration is required for an intervention effect",
    );
    expect(sql).toContain("canonical intervention evidence is required");
    expect(sql).toContain(
      "production-eligible engineering model not found",
    );
    expect(sql).toContain("evidence is not human-verified");
    expect(sql).toContain(
      "the selected canonical mechanism is not declared by this model version",
    );
    expect(sql).toContain("idx_model_predictions_engineering_run");
  });
});
