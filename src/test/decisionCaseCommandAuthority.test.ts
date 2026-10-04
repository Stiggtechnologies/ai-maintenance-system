import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102200000_decision_case_command_authority.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/decisionCaseService.ts", "utf8");
const page = readFileSync("src/pages/DecisionCaseSpine.tsx", "utf8");

describe("Decision Case command authority contract", () => {
  it("locks the canonical tenant row and enforces optimistic concurrency", () => {
    expect(migration).toContain("security definer");
    expect(migration).toMatch(
      /where id=p_workspace_id and organization_id=v_org and workspace_kind<>'sync' for update/,
    );
    expect(migration).toContain("v_workspace.case_version<>p_expected_version");
    expect(migration).toContain("errcode='pt409'");
    expect(migration).not.toContain("errcode='40001'");
    expect(migration).toContain(
      "decision case state must be changed through apply_decision_case_command",
    );
  });

  it("uses a whitelist that admits admin and excludes sponsors and machine roles", () => {
    expect(migration).toContain(
      "('admin','executive','maintenance_manager','reliability_engineer','planner')",
    );
    expect(migration).not.toMatch(
      /decision_case_(authority|contributor)_role_allowed[\s\S]{0,500}(assessment_sponsor|ai_admin|system|service_role)/,
    );
    expect(migration).toContain(
      "an authorized internal human profile is required",
    );
    expect(migration).toContain(
      "your role may not record a decision case disposition",
    );
  });

  it("binds required authority to canonical tenant identity and actual role", () => {
    expect(migration).toContain(
      "required person must be bound to a tenant user id",
    );
    expect(migration).toContain(
      "a person may not bind themselves as required authority",
    );
    expect(migration).toMatch(
      /from public\.user_profiles where id=v_required_user and organization_id=v_org/,
    );
    expect(migration).toContain("'authorityrole',v_required_role");
    expect(migration).toContain(
      "bound authority role no longer matches the canonical user profile",
    );
    expect(page).toContain("listDecisionCaseAuthorityDirectory");
    expect(page).toContain('data-testid="spine-required-person"');
    expect(page).not.toContain('data-testid="spine-invite-name"');
  });

  it("reduces narrow command payloads rather than accepting whole-case side loads", () => {
    for (const command of [
      "record_conversation",
      "add_evidence",
      "record_disposition",
      "define_verification",
      "record_required_person",
      "record_source_check",
      "record_approval",
    ]) {
      expect(migration).toContain(`when '${command}' then array[`);
    }
    expect(migration).toContain(
      "payload contains unrelated decision case fields",
    );
    expect(migration).toContain(
      "initialization may not pre-seed governed decision case records",
    );
    expect(migration).toContain(
      "conversation command may append valid messages but may not rewrite history",
    );
    expect(migration).toContain(
      "disposition actor and record metadata are server-owned",
    );
    expect(service).toContain("function commandPayload");
    expect(service).not.toContain('"update_case"');
  });

  it("fails closed on browser-only and unproven governed evidence", () => {
    expect(migration).toContain("(selected|attached).+text was not extracted");
    expect(migration).toContain("'persistence','pending','quality','missing'");
    expect(migration).toContain("from public.evidence_items");
    expect(migration).toContain("canonical.organization_id=v_org");
    expect(migration).toContain(
      "decision case contains unproven supplied evidence",
    );
  });

  it("makes legacy normalization versioned and replayable", () => {
    expect(migration).toContain("(c.case_version+1) next_version");
    expect(migration).toContain("decision_case_legacy_normalization");
    expect(migration).toContain("previous_state,new_state");
    expect(migration).toContain("fail-closed legacy evidence normalization");
  });

  it("server-validates verification/source commands and stamps human records", () => {
    expect(migration).toContain(
      "verification requires expected outcome and scheduled date",
    );
    expect(migration).toContain(
      "recorded verification requires effectiveness, actual result, and evidence",
    );
    expect(migration).toContain(
      "record a bound required person before checking sources",
    );
    expect(migration).toContain("'actorid',v_actor,'actorrole',v_actor_role");
    expect(migration).toContain("'invitationstatus','not_sent'");
  });

  it("keeps approval immutable, reconstructable, and bound-person-only", () => {
    expect(migration).toContain(
      "decision case approval is immutable; no governed reopen path exists",
    );
    expect(migration).toContain(
      "only the bound required person may record approval",
    );
    expect(migration).toContain(
      "a governed approval decision and reason are required",
    );
    expect(migration).toContain("'reason',nullif(v_reason,'')");
    expect(migration).not.toContain("'delegated'");
    expect(migration).not.toContain("'delegatedto'");
    expect(migration).toContain("decision_case_approval_basis_sha256");
    expect(migration).toContain("'basisversion',v_workspace.case_version");
    expect(migration).toContain("'basissha256',v_basis_digest");
    expect(migration).toContain(
      "approval requires a governed human disposition",
    );
    expect(migration).toContain(
      "approval requires a server-stamped scheduled verification plan",
    );
    expect(migration).toContain(
      "approval requires a server-stamped source check",
    );
    expect(migration).toContain("decision case approval basis is locked");
    expect(migration).toContain(
      "post-approval verification outcome is one-time",
    );
    expect(migration).toContain(
      "decision case approval basis is stale or unverifiable",
    );
    expect(migration).toContain(
      "'postapprovalverificationoutcome',v_post_approval_outcome",
    );
    expect(migration).toContain("jsonb_agg(m order by ordinality)");
    expect(page).toContain('data-testid="spine-required-person-approval"');
    expect(page).toContain('data-testid="spine-approval-basis"');
    expect(page).toContain('data-testid="spine-approval-prerequisites"');
    expect(page).toContain("First Decision Journey");
    expect(page).toContain("not the full 20-step journey");
  });

  it("bounds command growth and refuses malformed identities and counters", () => {
    expect(migration).toContain(
      "command payload exceeds the 2 mb governed limit",
    );
    expect(migration).toContain(
      "initialization exceeds governed collection limits",
    );
    expect(migration).toContain("invalid or duplicate messages");
    expect(migration).toContain(
      "evidence identities must be unique, nonempty, and bounded",
    );
    expect(migration).toContain("may not remove existing evidence identities");
    expect(migration).toContain(
      "conversation token count must be a bounded nonnegative integer",
    );
    expect(migration).toContain(
      "decision case exceeds governed persistence limits",
    );
    expect(migration).toContain("sourcecheck,detail");
  });

  it("preserves unrelated canonical arrays and creates server learning only from a complete outcome", () => {
    expect(migration).toContain(
      "item->>'id' not in ('verify-expected','verify-evidence')",
    );
    expect(migration).toContain("c->>'id'<>'outcome-attribution'");
    expect(migration).toContain("'status','candidate'");
    expect(migration).toContain(
      "association is recorded; causality is not asserted",
    );
    expect(migration).toContain(
      "case when a->>'id'='required-approver' then v_plan else a end",
    );
    expect(migration).toContain(
      "disposition people must be bounded informational role labels",
    );
    expect(page).not.toContain("spine-person-requiredApprover");
  });
});
