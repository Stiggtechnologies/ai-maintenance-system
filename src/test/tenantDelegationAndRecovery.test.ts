import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271103150000_tenant_delegation_and_recovery.sql",
  "utf8",
);
const cascade = readFileSync(
  "src/components/AccountabilityCascade.tsx",
  "utf8",
);
const recoveryPanel = readFileSync(
  "src/components/RecoveryObjectivesPanel.tsx",
  "utf8",
);
const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");

describe("E4.03 general delegation has no fabricated default", () => {
  it("clears unstated general drafts and does not insert a new amount", () => {
    expect(migration).toContain("action_type = 'general'");
    expect(migration).toContain("max_commitment_usd = case");
    expect(migration).toContain("else null");
    expect(migration).toContain("max_risk_level = null");
    expect(migration).toContain("max_production_downtime_hours = null");
    expect(migration).toContain(
      "role_key = 'planner' and max_commitment_usd = 5000",
    );
    expect(migration).toContain(
      "role_key = 'executive' and max_commitment_usd = 2000000",
    );
    expect(migration).not.toMatch(
      /insert\s+into\s+(?:public\.)?authority_limits\b/i,
    );
    expect(migration).toContain("new.max_commitment_usd := null");
    expect(migration).toContain("No platform default amount applies.");
  });

  it("requires an explicit instrument and refuses AI, defaults and self-adoption", () => {
    expect(migration).toContain("state_general_delegation");
    expect(migration).toContain(
      "Omitted dimensions are refused, not defaulted.",
    );
    expect(migration).toContain("No default currency is applied.");
    expect(migration).toContain("No risk level is assumed.");
    expect(migration).toContain("No downtime allowance is assumed.");
    expect(migration).not.toContain(
      "coalesce(p_instrument->>'currency', 'USD')",
    );
    expect(migration).toContain("v_role = 'ai_admin'");
    expect(migration).toContain("An unnamed session is not a named human.");
    expect(migration).toContain("new.ceilings_stated_by = new.adopted_by");
    expect(migration).toContain("app.general_delegation_write");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain(
      "revoke all on function public.state_general_delegation(uuid, jsonb) from public, anon, service_role",
    );
    expect(migration).toContain("organization_id = v_org");
  });

  it("keeps the cascade on the general ladder and the existing board filter", () => {
    expect(migration).toContain("and action_type = 'general'");
    expect(migration).toContain(
      "v_role in ('board', 'executive', 'admin', 'ai_admin')",
    );
    expect(cascade).toContain("stateGeneralDelegation");
    expect(cascade).toContain("Not stated");
    expect(cascade).not.toContain('useState("USD")');
    expect(cascade).not.toContain("leave blank to keep draft");
  });
});

describe("E5.13 recovery objectives and restore verification", () => {
  it("stores no seeded duration and refuses a caller-supplied pass", () => {
    expect(migration).toContain(
      "create table if not exists public.recovery_objectives",
    );
    expect(migration).toContain(
      "create table if not exists public.recovery_restore_verifications",
    );
    expect(migration).not.toMatch(/rpo_seconds\s+numeric[^,\n]*default/i);
    expect(migration).not.toMatch(/rto_seconds\s+numeric[^,\n]*default/i);
    expect(migration).toContain("No duration is assumed.");
    expect(migration).toContain("No RPO or RTO is assumed.");
    expect(migration).toContain("p_verification ? 'verification_outcome'");
    expect(migration).toContain(
      "the verification outcome is computed from the measurements and the checks",
    );
    expect(migration).toContain(
      "when v_rows = 'not_run' or v_witness = 'not_run' then 'checks_not_run'",
    );
    expect(migration).toContain("'production_pitr_proven', false");
    expect(migration).toContain("'storage_object_bytes_proven', false");
    expect(migration).toContain("'vault_root_key_proven', false");
    expect(migration).toContain("'edge_secrets_proven', false");
    expect(migration).toContain("recovery records cannot be truncated");
    expect(migration).toContain("a restore verification is append-only");
    expect(migration).toContain(
      "the human who stated this recovery objective cannot adopt it",
    );
    expect(migration).toContain(
      "the recovery owner cannot be the AI-operator identity",
    );
    expect(migration).toContain(
      "using (organization_id = public.app_current_org())",
    );
  });

  it("is reachable from Settings and does not invent the form values", () => {
    expect(settings).toContain("<RecoveryObjectivesPanel />");
    expect(recoveryPanel).toContain("stateRecoveryObjective");
    expect(recoveryPanel).toContain("recordRestoreVerification");
    expect(recoveryPanel).toContain('useState("")');
    expect(recoveryPanel).not.toMatch(/useState\("\d+"\)/);
    expect(recoveryPanel).toContain("No recovery objective has been adopted.");
  });
});
