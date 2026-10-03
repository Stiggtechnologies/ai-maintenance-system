import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101860000_data_loss_prevention.sql",
  "utf8",
).toLowerCase();
const panel = readFileSync(
  "src/components/DataEgressGovernancePanel.tsx",
  "utf8",
);
const service = readFileSync(
  "src/services/dataEgressGovernanceService.ts",
  "utf8",
);

describe("E5.07 data-egress governance control plane", () => {
  it("extends the canonical register without a parallel rule or audit store", () => {
    expect(migration).toContain("alter table public.data_egress_rules");
    expect(migration).not.toMatch(/create table[^;]+(dlp|egress)/);
    expect(migration).not.toMatch(
      /create table[^;]+(decision|receipt|audit|event)/,
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("insert into public.security_events");
  });

  it("requires immutable proposal, independent named-human AAL2 review and supersession", () => {
    expect(migration).toContain("propose_data_egress_rule");
    expect(migration).toContain("decide_data_egress_rule");
    expect(migration).toContain("trg_guard_data_egress_rule_write");
    expect(migration).toContain(
      "coalesce(current_setting('app.data_egress_rule_writer',true),'')<>'governed'",
    );
    expect(migration).toContain("the proposer cannot independently");
    expect(migration).toContain("app_actor_has_verified_mfa(v_uid)");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("superseded_by_rule_id");
  });

  it("evaluates exact tenant, destination, class, purpose and redaction state", () => {
    expect(migration).toContain("authorize_data_egress");
    expect(migration).toContain("authorize_service_data_egress");
    expect(migration).toContain("der.organization_id=p_organization_id");
    expect(migration).toContain("der.destination=p_destination");
    expect(migration).toContain("der.data_class=p_data_class");
    expect(migration).toContain("p_purpose=any(der.allowed_purposes)");
    expect(migration).toContain("der.rule_status='adopted'");
    expect(migration).toContain("der.superseded_by_rule_id is null");
    expect(migration).toContain(
      "v_rule.redaction_required and not p_redaction_applied",
    );
    expect(migration).toContain("'allowed',false");
  });

  it("is customer reachable but does not grant operational authority", () => {
    expect(panel).toContain("Data-loss prevention");
    expect(panel).toContain("does not authorize plant action");
    expect(service).toContain('"get_data_egress_rules"');
    expect(service).toContain('"propose_data_egress_rule"');
    expect(service).toContain('"decide_data_egress_rule"');
  });
});
