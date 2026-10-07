import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source contracts only: these inspect the actual canonical trigger/RPC bodies.
// Native pending/terminal/internal-marker mutation and rollback witnesses remain
// mandatory. Passing this file does not prove PostgreSQL runtime behavior,
// source standing, stale-pending replacement, or complete U18 qualification.
const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const native = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);

function body(name: string): string {
  const value = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    ),
  )?.[1];
  if (!value) throw new Error(`Canonical uncertainty body missing: ${name}`);
  return value
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const trigger = body("enforce_risk_uncertainty_analysis_write");
const review = body("review_risk_uncertainty_analysis");
const submit = body("submit_risk_uncertainty_analysis_internal");
const packetSchema = migration
  .split("create table if not exists public.risk_uncertainty_analyses (")[1]
  ?.split("create unique index")[0]
  .replace(/\s+/g, " ");
const lifecycleFields = [
  "status",
  "analysis_digest",
  "reviewer_id",
  "reviewed_at",
  "review_note",
  "approval_id",
  "derived_evidence_item_id",
] as const;
const reviewFields = lifecycleFields.slice(2);
const immutableFields = [
  "id",
  "organization_id",
  "risk_id",
  "version",
  "author_id",
  "created_at",
  "method",
  "basis",
  "probability_lower",
  "probability_central",
  "probability_upper",
  "confidence_level",
  "confidence_interval_lower",
  "confidence_interval_upper",
  "best_case_loss",
  "expected_case_loss",
  "worst_case_loss",
  "currency",
  "sensitivity_inputs",
  "sensitivity_results",
  "threshold_profile_id",
  "decision_thresholds",
  "reassessment_triggers",
  "review_due_at",
  "voi_action",
  "voi_information_cost",
  "voi_decision_cost_if_wrong",
  "voi_uncertainty_reduction",
  "voi_probability_decision_changes",
  "voi_expected_value",
  "voi_net_value",
  "voi_recommendation",
  "operational_authorization",
] as const;

function excludedFields(source: string): string[] {
  return [...source.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("U18 submitted-history immutable source contract", () => {
  it("separates nested audit-failure dollar delimiters without removing the rollback witness", () => {
    // Adjacent tagged delimiters contain $$ and prematurely terminate the
    // enclosing DO $$ body. This source check is not PostgreSQL execution.
    expect(/\$[a-z_]\w*\$\$[a-z_]\w*\$/i.test(native)).toBe(false);
    const auditFailure =
      native
        .split("-- A final audit failure MUST unwind")[1]
        ?.split("-- U18 ATOMIC REPLACEMENT CONTROLS END")[0] ?? "";
    expect(auditFailure).toContain("end; $body$ $ddl$");
    expect(auditFailure).toContain("public.replace_risk_uncertainty_analysis");
    expect(auditFailure).toContain("exception when sqlstate 'ZX016'");
    expect(auditFailure).toContain(
      "pg_temp.u18_state() is distinct from snapshot",
    );
    expect(auditFailure).toContain(
      "no matching committed replacement receipt is visible",
    );
    expect(auditFailure).not.toMatch(
      /disable trigger|session_replication_role|when others/i,
    );
  });
  it("types literal polymorphic JSON conversions without removing the committed-intent collision witness", () => {
    // PostgreSQL cannot resolve to_jsonb(anyelement) from an unknown string
    // literal. This is a native-source regression guard, not SQL execution.
    expect(
      /\b(?:to_jsonb|to_json)\s*\(\s*(?:'(?:''|[^'])*'|null)\s*\)/i.test(
        native,
      ),
    ).toBe(false);
    expect(native).toContain(
      "to_jsonb('A different request must never reuse the same committed intent.'::text)",
    );
    const collision =
      native
        .split("-- U18 COMMITTED INTENT COLLISION WITNESS BEGIN")[1]
        ?.split("-- U18 COMMITTED INTENT COLLISION WITNESS END")[0] ?? "";
    expect(collision).toContain("public.replace_risk_uncertainty_analysis");
    expect(collision).toContain(
      "replacement intent is already bound to a different request",
    );
    expect(collision).toContain(
      "pg_temp.u18_state() is distinct from snapshot",
    );
  });
  it("executes deferred pair checks before testing the actual truncate-retention guard", () => {
    const block =
      native
        .split("-- U18 TRUNCATE RETENTION WITNESS BEGIN")[1]
        ?.split("-- U18 TRUNCATE RETENTION WITNESS END")[0] ?? "";
    expect(block).not.toBe("");
    expect(block.indexOf("set constraints all immediate;")).toBeGreaterThan(-1);
    expect(block.indexOf("set constraints all immediate;")).toBeLessThan(
      block.indexOf("begin truncate table risk_uncertainty_analyses cascade;"),
    );
    expect(block.indexOf("set constraints all deferred;")).toBeGreaterThan(
      block.indexOf("set constraints all immediate;"),
    );
    expect(block.indexOf("set constraints all deferred;")).toBeLessThan(
      block.indexOf("begin truncate table risk_uncertainty_analyses cascade;"),
    );
    expect(block).toContain("exception when raise_exception");
    expect(block).toContain(
      "detail='risk uncertainty history is retained; truncate refused'",
    );
    expect(block).not.toMatch(
      /disable trigger|session_replication_role|when others|object_in_use/i,
    );
  });
  it("freezes the whole submitted row except exactly the digest/finalization and review transition fields", () => {
    // Select the ordinary initialization/review projection, not the separately
    // qualified four-field supersession branch. Neither guard is weakened.
    const projection = [
      ...trigger.matchAll(
        /\(to_jsonb\(new\)\s*-\s*array\[([^\]]+)\](?:::\s*text\[\])?\)\s+is distinct from\s+\(to_jsonb\(old\)\s*-\s*array\[([^\]]+)\](?:::\s*text\[\])?\)/g,
      ),
    ].find((match) => excludedFields(match[1]).includes("analysis_digest"));
    expect(
      projection,
      "ordinary whole-row NEW/OLD projection exists",
    ).toBeDefined();
    const newExceptions = excludedFields(projection?.[1] ?? "");
    const oldExceptions = excludedFields(projection?.[2] ?? "");
    expect([...newExceptions].sort()).toEqual([...lifecycleFields].sort());
    expect([...oldExceptions].sort()).toEqual([...lifecycleFields].sort());
    for (const field of immutableFields) {
      expect(migration, `${field} is a real packet column`).toMatch(
        new RegExp(`\\b${field}\\s+`),
      );
      expect(
        newExceptions,
        `${field} must remain in NEW projection`,
      ).not.toContain(field);
      expect(
        oldExceptions,
        `${field} must remain in OLD projection`,
      ).not.toContain(field);
    }
    expect(trigger).not.toContain(
      "if tg_op='UPDATE' and old.status in ('validated','rejected') and",
    );
    expect(trigger).toMatch(/if tg_op='UPDATE' then[^]*to_jsonb\(new\)/);
  });

  it("refuses every update to terminal reviewed rows, not only selected engineering-field changes", () => {
    expect(trigger).toMatch(
      /if old\.status in \('validated','rejected','superseded'\) then\s+raise exception '(?:''|[^'])*';\s+end if;/,
    );
    expect(
      trigger.indexOf(
        "if old.status in ('validated','rejected','superseded') then",
      ),
    ).toBeLessThan(trigger.indexOf("to_jsonb(new)"));
  });

  it("permits initialization only for a governed pending row with the original zero digest and empty review tuple", () => {
    expect(trigger).toMatch(
      /if tg_op='INSERT' then[^]*new\.status[^]*pending_review/,
    );
    expect(trigger).toContain(
      "new.analysis_digest is distinct from repeat('0',64)",
    );
    for (const field of reviewFields)
      expect(trigger).toContain(`new.${field} is not null`);
    expect(trigger.indexOf("if v_marker<>'granted' then")).toBeLessThan(
      trigger.indexOf("if tg_op='INSERT' then"),
    );
  });

  it("limits digest finalization to the actual initial pending-to-pending update", () => {
    expect(trigger).toContain("if old.analysis_digest=repeat('0',64) then");
    expect(trigger).toContain("old.status is distinct from 'pending_review'");
    expect(trigger).toContain("new.status is distinct from 'pending_review'");
    expect(trigger).toContain("new.analysis_digest=repeat('0',64)");
    expect(trigger).toContain(
      "new.analysis_digest is distinct from public.risk_uncertainty_analysis_digest(old.organization_id,old.id)",
    );
    const finalization =
      trigger
        .split("if old.analysis_digest=repeat('0',64) then")[1]
        ?.split("else")[0] ?? "";
    expect(finalization).not.toBe("");
    for (const field of reviewFields)
      expect(finalization).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    expect(finalization).toContain("raise exception");
  });

  it("never changes a finalized submitted digest during review or a pending-row update", () => {
    const afterInitial =
      trigger
        .split("if old.analysis_digest=repeat('0',64) then")[1]
        ?.split("else")[1] ?? "";
    expect(afterInitial).not.toBe("");
    expect(afterInitial).toContain(
      "new.analysis_digest is distinct from old.analysis_digest",
    );
    expect(afterInitial).toContain("raise exception");
    expect(afterInitial).toContain(
      "old.status is distinct from 'pending_review'",
    );
    expect(afterInitial).toContain(
      "new.status not in ('validated','rejected')",
    );
  });

  it("requires an actual complete named-human review transition rather than metadata-only pending changes", () => {
    expect(packetSchema).toContain(
      "status='pending_review' and reviewer_id is null and reviewed_at is null and review_note is null and approval_id is null and derived_evidence_item_id is null",
    );
    expect(packetSchema).toContain(
      "status in ('validated','rejected') and reviewer_id is not null and reviewer_id<>author_id and reviewed_at is not null and length(btrim(coalesce(review_note,'')))>=20 and approval_id is not null and (status='rejected' or derived_evidence_item_id is not null)",
    );
    // Rejected historical packets may legally carry a derived-evidence reference;
    // do not invent a new rejected=>NULL constraint absent the canonical schema.
    expect(trigger).not.toContain(
      "new.status='rejected' and new.derived_evidence_item_id is not null",
    );
  });

  it("permits new evidence bindings only before initial pending digest finalization", () => {
    const link = body("enforce_risk_uncertainty_evidence_link");
    expect(link).toContain("a.status='pending_review'");
    expect(link).toContain("a.analysis_digest=repeat('0',64)");
    expect(link).toContain(
      "e.organization_id=new.organization_id and e.risk_id=a.risk_id",
    );
    expect(link).toContain("e.verification_status='verified'");
  });

  it("preserves the exact canonical initial-finalization and independent-review writers", () => {
    expect(submit).toContain("repeat('0',64),v_user");
    const bind = submit.indexOf(
      "insert into public.risk_uncertainty_analysis_evidence",
    );
    const digest = submit.indexOf(
      "v_digest:=public.risk_uncertainty_analysis_digest(v_org,v_id)",
    );
    const finalization = submit.indexOf(
      "set analysis_digest=v_digest where id=v_id",
    );
    expect(bind).toBeGreaterThan(-1);
    expect(digest).toBeGreaterThan(bind);
    expect(finalization).toBeGreaterThan(digest);
    expect(review).toContain("a.status<>'pending_review'");
    expect(review).toContain("a.author_id=v_user");
    expect(review).toContain("v_locked_org is distinct from v_org");
    expect(review).toContain("public.app_current_org() is distinct from v_org");
    expect(review).toContain(
      "('reliability_engineer','maintenance_manager','executive','admin')",
    );
    expect(review).toContain("set status=p_decision,reviewer_id=v_user");
    expect(review).toContain("approval_id=v_approval");
    expect(review).toContain("derived_evidence_item_id=v_evidence");
  });

  it("preserves immutable evidence bindings, delete/truncate refusal and private helper/client write ACLs", () => {
    expect(body("enforce_risk_uncertainty_evidence_link")).toContain(
      "if tg_op<>'INSERT' then",
    );
    expect(trigger).toContain("if tg_op='DELETE' then");
    expect(trigger).toContain("if v_marker<>'granted' then");
    expect(body("refuse_risk_uncertainty_truncate")).toContain(
      "raise exception",
    );
    expect(migration).toContain(
      "revoke all on public.risk_uncertainty_analyses from anon,authenticated,service_role",
    );
    expect(migration).toContain(
      "revoke all on public.risk_uncertainty_analysis_evidence from anon,authenticated,service_role",
    );
    expect(migration).toContain(
      "revoke all on function public.risk_uncertainty_analysis_digest(uuid,uuid) from public,anon,authenticated,service_role",
    );
    expect(migration).toContain(
      "before insert or update or delete on public.risk_uncertainty_analyses",
    );
    expect(migration).toContain(
      "before truncate on public.risk_uncertainty_analyses",
    );
    // Superseded is retained terminal history, not an invented human rejection.
    expect(trigger).toContain(
      "if old.status in ('validated','rejected','superseded') then",
    );
    expect(body("enforce_risk_uncertainty_replacement_pair")).toContain(
      "p.superseded_by_analysis_id is distinct from a.id",
    );
  });
});
