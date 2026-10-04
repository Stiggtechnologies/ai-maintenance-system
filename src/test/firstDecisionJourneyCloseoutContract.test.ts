import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const migration = read(
  "supabase/migrations/20270102170000_decision_case_workspace_invitation.sql",
);
const edge = read("supabase/functions/decision-case-invite/index.ts");
const edgeCore = read(
  "supabase/functions/_shared/decision-case-invite-core.ts",
);
const page = read("src/pages/DecisionCaseSpine.tsx");
const opening = read("src/pages/InvertedOpeningPage.tsx");
const spine = read("src/lib/onboarding/decision-case-spine.ts");
const workflow = read(".github/workflows/deploy-migrations.yml");
const boundary = read("config/edge-function-boundary.json");
const config = read("supabase/config.toml");

describe("First Decision Journey closeout contract", () => {
  it("extends canonical case, membership, evidence, and audit records", () => {
    expect(migration).toMatch(/cowork_workspaces/);
    expect(migration).toMatch(/auth\.users/);
    expect(migration).toMatch(/user_profiles/);
    expect(migration).toMatch(/audit_events/);
    expect(migration).not.toMatch(/create\s+table/i);
    expect(page).toMatch(/ingestKbDocument/);
    expect(page).toMatch(/attachGovernedSpineEvidence/);
    expect(spine).toMatch(/sourceReceipt/);
    expect(opening).toMatch(/listRecentPersistedDecisionCases/);
  });

  it("keeps workspace membership distinct from engineering authority", () => {
    expect(migration).toMatch(/'viewer'/);
    expect(migration).toMatch(/'decision_authority_granted', false/);
    expect(migration).not.toMatch(/'approved'/);
    expect(page).toMatch(
      /Workspace access never grants engineering or decision authority/,
    );
    expect(page).toMatch(
      /Delivery, acceptance, sign-in, and decision authority/,
    );
    expect(page).toMatch(/Record required person/);
    expect(page).toMatch(/Send secure workspace invitation/);
  });

  it("makes invitation mutation service-only and preserves tenant/AAL2 gates", () => {
    expect(migration).toMatch(/auth\.role\(\)/);
    expect(migration).toMatch(/service_role/);
    expect(migration).toMatch(/organization_id = p_organization_id/);
    expect(migration).toMatch(
      /revoke all on function public\.register_decision_case_invitation/,
    );
    expect(edgeCore).toMatch(/\["admin", "executive"\]/);
    expect(edgeCore).toMatch(/aal2/);
    expect(edge).toMatch(/auth\.getUser/);
    expect(edge).toMatch(/inviteUserByEmail/);
    expect(edge).toMatch(/deleteUser/);
    expect(edge).toMatch(/mayRollbackFreshInvite/);
    expect(edge).toMatch(/providerFailureReceipt/);
    expect(edge).not.toMatch(/rolled back because tenant registration failed:/);
  });

  it("derives acceptance from Auth and retains lifecycle transitions in the audit ledger", () => {
    expect(migration).toMatch(/observe_decision_case_invitation/);
    expect(migration).toMatch(/email_confirmed_at/);
    expect(migration).toMatch(/last_sign_in_at/);
    expect(migration).toMatch(/workspace_invitation_observation/);
    expect(migration).toMatch(
      /revoke all on function public\.observe_decision_case_invitation[\s\S]*authenticated/,
    );
    expect(edge).toMatch(/observe_decision_case_invitation/);
    expect(spine).toMatch(/\["already_member", "accepted", "active"\]/);
  });

  it("deploys the protected edge boundary and probes anonymous refusal", () => {
    expect(boundary).toMatch(/decision-case-invite/);
    expect(config).toMatch(
      /\[functions\.decision-case-invite\][\s\S]*verify_jwt\s*=\s*true/,
    );
    expect(workflow).toMatch(/functions deploy decision-case-invite/);
    expect(workflow).toMatch(/decision-case-invite[\s\S]*401/);
  });

  it("guides the novice to the first unmet earned gate", () => {
    expect(page).toMatch(/spine-next-action/);
    expect(page).toMatch(/nextWalkthroughAction/);
    expect(page).toMatch(/spine-gate-/);
    expect(spine).toMatch(/Person recorded; no invitation sent/);
  });
});
