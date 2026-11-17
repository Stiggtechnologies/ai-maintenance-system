import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270105110500_case_decision_import_idempotency.sql",
  "utf8",
);
const body = migration.slice(
  migration.indexOf("as $$"),
  migration.indexOf("exception"),
);

describe("browser-draft import idempotency", () => {
  it("reuses the canonical decision and does not frame a second audit", () => {
    expect(migration).toContain("idx_audit_case_decision_import_intent");
    expect(migration).toContain("p_idempotency_key uuid");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'replay', true");
    expect(migration).toContain("app_current_org()");
    expect(body.indexOf("'replay', true")).toBeLessThan(
      body.indexOf("insert into decisions"),
    );
    expect(body.indexOf("'replay', true")).toBeLessThan(
      body.indexOf("insert into audit_events"),
    );
    expect(migration).not.toMatch(/create table/i);
  });

  it("keeps the import function tenant-scoped and revoked from anon", () => {
    expect(migration).toContain(
      "revoke all on function public.create_case_decision(uuid, text, date, uuid, uuid, text, uuid)",
    );
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated, service_role");
    expect(migration).toContain("and d.organization_id = v_org");
    expect(migration).toContain(
      "this import identity already belongs to a different development case",
    );
  });
});
