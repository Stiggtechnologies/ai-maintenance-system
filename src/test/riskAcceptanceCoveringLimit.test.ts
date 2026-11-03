/**
 * E4.04 — a recorded risk acceptance is refused when no adopted
 * authority_limits row covers the act.
 *
 * Static contract on the migration text. The six-argument accept_risk used
 * by GovernanceStandards previously inserted and returned ceiling_checked
 * false. The trigger on risk_acceptances returned early for every subject
 * other than risk, and for a risk subject it did not refuse a missing ladder.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const sql = stripComments(
  readFileSync(
    "supabase/migrations/20271106140000_risk_acceptance_covering_limit.sql",
    "utf8",
  ),
);

function body(name: string): string {
  const marker = `function public.${name}(`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  const next = sql.indexOf("create or replace function", start + marker.length);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("E4.04 risk acceptance requires a covering adopted limit", () => {
  const accept = body("accept_risk");
  const guard = body("enforce_extended_risk_acceptance_authority");

  it("does not touch the delegation instrument PR 746 owns", () => {
    expect(sql).not.toMatch(/alter table\s+(?:public\.)?authority_limits/i);
    expect(sql).not.toContain("state_general_delegation");
    expect(sql).not.toContain("state_authority_ceiling");
    expect(sql).not.toContain("adopt_authority_limit");
    expect(sql).not.toContain("risk_stated");
  });

  it("the six-argument door refuses before insert when nothing covers the act", () => {
    const refusal = accept.indexOf(
      "no adopted authority limit covers this risk acceptance for your role",
    );
    const insert = accept.indexOf("insert into risk_acceptances");
    expect(refusal).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(refusal);
    expect(accept).toContain(
      "every ADOPTED general delegation for the %s role is scoped to one organization node whose subtree does not cover this organization",
    );
    expect(accept).toContain("and al.action_type = 'general' and al.status = 'adopted'");
    expect(accept).toContain(
      "order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc",
    );
    expect(accept).toContain("'ceiling_checked', true");
    expect(accept).toContain("'authority_limit_id', l.id");
    expect(accept).not.toContain("'ceiling_checked', found");
  });

  it("a stated ceiling that the acceptance exceeds is still refused", () => {
    expect(accept).toContain(
      "l.max_risk_level is not null",
    );
    expect(accept).toContain(
      "risk_rank(p_risk_level) > risk_rank(l.max_risk_level)",
    );
    expect(accept).toContain("Escalate to %s.");
  });

  it("keeps the named human refusals already on the door", () => {
    expect(accept).toContain(
      "a §70 human determination — the AI-operator identity cannot record one",
    );
    expect(accept).toContain(
      "you own the treatment on this recommendation and cannot also accept its residual risk",
    );
    expect(accept).toContain("organization_id = v_org");
    expect(accept).not.toMatch(/p_org|p_organization/);
  });

  it("the table refuses every writer, including a non-risk subject", () => {
    expect(guard).toContain(
      "no adopted authority limit covers this risk acceptance for your role",
    );
    expect(guard).toContain(
      "the recorded acceptor has no role in this organization",
    );
    expect(guard).toContain(
      "accepted_role does not match the recorded acceptor role in this organization",
    );
    expect(guard).toContain("al.role_key = v_acceptor_role");
    expect(guard).toContain("al.organization_id = new.organization_id");
    expect(guard).toContain("and al.status = 'adopted'");
    const earlyReturn = guard.indexOf("if new.subject_type <> 'risk'");
    const coveringRefusal = guard.indexOf(
      "no adopted authority limit covers this risk acceptance for your role",
    );
    expect(coveringRefusal).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(coveringRefusal);
  });

  it("a status-only update, such as the expiry sweep, does not re-litigate the ceiling", () => {
    expect(guard).toContain("tg_op <> 'UPDATE'");
    expect(guard).toContain(
      "new.risk_level is distinct from old.risk_level",
    );
    expect(guard).toContain(
      "new.accepted_by is distinct from old.accepted_by",
    );
    expect(guard).toContain(
      "new.organization_id is distinct from old.organization_id",
    );
  });

  it("keeps the extended risk-subject checks that already sat on the trigger", () => {
    expect(guard).toContain(
      "extended authority: jurisdiction is outside the accepting authority scope",
    );
    expect(guard).toContain(
      "extended authority: asset criticality is outside the accepting authority scope",
    );
    expect(guard).toContain(
      "extended authority: accepted value exceeds the authority ceiling",
    );
    expect(guard).toContain(
      "extended authority: independent assurance by a different person is required for acceptance",
    );
  });

  it("revokes the definer functions from public", () => {
    expect(sql).toContain(
      "revoke all on function public.accept_risk(text, uuid, text, text, text, timestamptz) from public, anon",
    );
    expect(sql).toContain(
      "revoke all on function public.enforce_extended_risk_acceptance_authority() from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz) to authenticated",
    );
  });
});
