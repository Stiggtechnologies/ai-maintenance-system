import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100300_engineering_knowledge_conflicts.sql",
  ),
  "utf8",
);

describe("engineering knowledge conflict detection contract", () => {
  it("reads the governed source and mapping tables and writes nothing", () => {
    expect(migration).toContain("engineering_knowledge_sources");
    expect(migration).toContain("engineering_knowledge_mappings");
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+into\b/i);
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("revision_conflict");
    expect(migration).toContain("authority_conflict");
    expect(migration).toContain("supersession_gap");
    expect(migration).toContain("superseded_mapping_still_approved");
    expect(migration).toContain("successor_not_applied");
  });

  it("stays inside the caller organization and grants no authority", () => {
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain("m.organization_id = v_org");
    expect(migration).toContain("'grantsAuthority', false");
    expect(migration).toContain("'grantsWorkRelease', false");
    expect(migration).toContain("'grantsApproval', false");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain(
      "revoke all on function public.detect_engineering_knowledge_conflicts(text, text) from public, anon",
    );
    expect(migration).not.toMatch(/p_organization_id/i);
  });

  it("wires the slice smoke", () => {
    const ci = fs.readFileSync(
      path.resolve(".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).toContain("scripts/ci-ekg-slice-*.sh");
    expect(fs.existsSync("scripts/ci-ekg-slice-3-conflicts.sh")).toBe(true);
  });
});
