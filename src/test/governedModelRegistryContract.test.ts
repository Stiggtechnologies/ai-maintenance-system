import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220010000_governed_model_registry.sql",
  "utf8",
);
const panel = readFileSync(
  "src/components/ModelRegistryGovernancePanel.tsx",
  "utf8",
);
const host = readFileSync("src/components/ModelRisk.tsx", "utf8");
const service = readFileSync("src/services/modelRegistryService.ts", "utf8");
const smoke = readFileSync(
  "scripts/ci-governed-model-registry-smoke.sh",
  "utf8",
);

describe("D11.30 governed model registry contract", () => {
  it("extends the one canonical registry with all seven attributes", () => {
    expect(migration).toContain("alter table public.model_register");
    for (const field of [
      "version",
      "purpose",
      "training_data",
      "validation_summary",
      "applicability_summary",
      "limitations",
      "approval_status",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).not.toMatch(
      /create table (if not exists )?public\.[a-z_]*model_registry/i,
    );
  });

  it("requires independent evidence-backed re-approval before a version swap", () => {
    expect(migration).toContain("submitter cannot independently review");
    expect(migration).toContain(
      "same-tenant verified review evidence is required",
    );
    expect(migration).toContain("idx_model_register_current_decision_version");
    expect(migration).toContain("require_current_model_version");
    expect(smoke).toContain("reapproval_before_swap=true");
  });

  it("is customer reachable on the existing governance surface", () => {
    expect(host).toContain("<ModelRegistryGovernancePanel");
    expect(panel).toContain("Submit immutable version");
    expect(panel).toContain("Approve exact version");
    expect(service).toContain('"submit_model_registry_version"');
    expect(service).toContain('"review_model_registry_version"');
  });
});
