import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const migration = stripComments(
  readFileSync(
    "supabase/migrations/20270101440000_lifecycle_decision_authority.sql",
    "utf8",
  ),
);

const start = migration.indexOf(
  "create or replace function public.decide_lifecycle_evaluation(",
);
const end = migration.indexOf(
  "revoke all on function public.decide_lifecycle_evaluation",
  start,
);
const body = migration.slice(start, end);

describe("governed lifecycle decision authority", () => {
  it("fails closed for absent, AI and non-authority identities", () => {
    expect(body).toContain("if v_org is null then");
    expect(body).toContain("coalesce(v_role, '') = 'ai_admin'");
    expect(body).toMatch(
      /coalesce\(v_role, ''\) not in \(\s*'maintenance_manager',\s*'reliability_engineer',\s*'executive',\s*'admin'\s*\)/,
    );
    expect(body).not.toMatch(/not in \([^)]*'planner'/);
    expect(body).not.toMatch(/not in \([^)]*'technician'/);
  });

  it("keeps high-uncertainty acceptance behind the stricter authority", () => {
    expect(body).toMatch(
      /e\.uncertainty_level = 'high' and p_decision = 'accepted'[\s\S]*v_role not in \('reliability_engineer', 'executive', 'admin'\)/,
    );
    expect(body).toContain(
      "accepting it requires engineering or executive authority",
    );
  });

  it("scopes the target to the tenant and records the named human act", () => {
    expect(body).toMatch(
      /where id = p_id and organization_id = v_org/,
    );
    expect(body).toContain("decided_by = auth.uid()");
    expect(body).toContain("decision_note = trim(p_note)");
    expect(body).toContain("'lifecycle_decision'");
    expect(body).toContain("'evaluation_id', p_id");
  });

  it("keeps the RPC unavailable to public and anonymous roles", () => {
    expect(migration).toMatch(
      /revoke all on function public\.decide_lifecycle_evaluation\(uuid, text, text\)\s+from public, anon/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.decide_lifecycle_evaluation\(uuid, text, text\)\s+to authenticated/,
    );
  });
});
