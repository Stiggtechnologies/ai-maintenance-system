import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219330000_asset_condition_knowledge_states.sql",
  "utf8",
);
const service = readFileSync("src/services/conditionStateService.ts", "utf8");
const panel = readFileSync("src/components/ConditionStatePanel.tsx", "utf8");
const monitoring = readFileSync(
  "src/components/ConditionMonitoring.tsx",
  "utf8",
);
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("U18.01 explicit condition knowledge states", () => {
  it("adds an assessment overlay without duplicating canonical condition stores", () => {
    expect(migration).toContain(
      "create table if not exists public.asset_condition_assessments",
    );
    expect(migration).not.toMatch(
      /create table[^;]*(condition_readings|evidence_items|recommendations|approvals|work_orders)/i,
    );
    expect(migration).toContain("references public.assets(id)");
    expect(migration).toContain("uuid[] not null default '{}'");
    expect(migration).toContain(
      "references public.asset_condition_assessments(id)",
    );
  });

  it("models every required state and refuses false precision", () => {
    for (const state of [
      "known",
      "estimated",
      "predicted",
      "unknown",
      "conflicting",
    ]) {
      expect(migration).toContain(`'${state}'`);
      expect(service).toContain(`"${state}"`);
    }
    expect(migration).toContain(
      "unknown condition cannot carry a numeric value",
    );
    expect(migration).toContain(
      "assessed value and unit must be supplied together",
    );
    expect(migration).toContain(
      "known condition requires at least one independently verified evidence item",
    );
    expect(migration).toContain(
      "predicted condition requires an explicit validity horizon",
    );
    expect(migration).toContain(
      "conflicting condition requires at least two canonical evidence items",
    );
  });

  it("enforces tenant-scoped named-human authoring and independent review", () => {
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain(
      "the AI-operator identity may prepare but cannot attest condition",
    );
    expect(migration).toContain("v_row.assessed_by=auth.uid()");
    expect(migration).toContain(
      "the assessment author cannot independently verify",
    );
    expect(migration).toContain("revoke insert,update,delete,truncate");
    expect(migration).toContain("from public,anon");
  });

  it("keeps assessment separate from authority and exposes it on the existing reliability surface", () => {
    expect(migration).toContain(
      "no work, recommendation, limit, or approval changed",
    );
    expect(migration).toContain("No operating or work authority was granted");
    expect(service).toContain('"record_asset_condition_state"');
    expect(service).toContain('"verify_asset_condition_state"');
    expect(panel).toContain("Condition knowledge state");
    expect(panel).toContain("No numeric value asserted");
    expect(monitoring).toContain("<ConditionStatePanel />");
    expect(register).toMatch(/\| U18\.01 \|[^\n]+\| ✅/);
  });
});
