import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101840000_privileged_access_mfa.sql",
  "utf8",
);
const app = readFileSync("src/App.tsx", "utf8");
const gate = readFileSync("src/components/MfaAccessGate.tsx", "utf8");
const manager = readFileSync("src/components/MfaManager.tsx", "utf8");
const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");
const policyPanel = readFileSync(
  "src/components/OrganizationMfaPolicyPanel.tsx",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync("scripts/ci-privileged-access-mfa-smoke.sh", "utf8");

describe("tenant MFA and privileged-access contract", () => {
  it("extends the canonical tenant resolver with both verified-factor and AAL2 gates", () => {
    expect(migration).toContain(
      "create or replace function public.app_current_org()",
    );
    expect(migration).toContain("public.app_org_has_commercial_entitlement");
    expect(migration).toContain("public.app_actor_mfa_satisfied");
    expect(migration).toContain("from auth.mfa_factors");
    expect(migration).toContain("public.app_current_aal() = 'aal2'");
  });

  it("keeps posture discovery pre-workspace and policy mutation governed", () => {
    expect(migration).toContain(
      "create or replace function public.get_current_security_posture()",
    );
    expect(migration).toContain(
      "grant execute on function public.get_current_security_posture() to authenticated",
    );
    const posture = migration.slice(
      migration.indexOf(
        "create or replace function public.get_current_security_posture()",
      ),
      migration.indexOf("-- Governed policy lifecycle."),
    );
    expect(posture).not.toContain("'policyId'");
    expect(posture).not.toContain("'organizationId'");
    expect(posture).not.toContain("'role'");
    expect(migration).toContain(
      "MFA policy changes require the governed named-human workflow",
    );
    expect(migration).toContain(
      "The proposer cannot independently adopt or reject the same policy",
    );
    expect(migration).toContain(
      "requires a verified factor and an AAL2 session",
    );
    expect(migration).toContain("status='adopted' and effective_at<=now()");
    expect(migration).toContain("'scheduled',(");
    expect(migration).not.toContain(
      "unique index if not exists organization_mfa_policy_one_adopted",
    );
    expect(smoke).toContain("scheduled_replacement_no_gap=true");
    expect(migration).toMatch(
      /revoke all on table public\.organization_mfa_policies[\s\S]*service_role/,
    );
  });

  it("gates the whole authenticated shell and exposes governed tenant policy controls", () => {
    expect(app).toContain("<MfaAccessGate>");
    expect(app).toMatch(/<MfaAccessGate>[\s\S]*<AppShell/);
    expect(gate).toContain("getCurrentSecurityPosture");
    expect(gate).toContain("Tenant records remain unavailable");
    expect(manager).toContain("protectLastFactor");
    expect(settings).toContain("<OrganizationMfaPolicyPanel />");
    expect(policyPanel).toContain("New proposals remain closed");
  });

  it("keeps MFA separate from engineering and operational authority and runs live proof", () => {
    expect(migration).toContain("operational_authority',false");
    expect(gate).toMatch(/does not approve\s+engineering/);
    expect(workflow).toContain(
      "bash scripts/ci-privileged-access-mfa-smoke.sh",
    );
  });
});
