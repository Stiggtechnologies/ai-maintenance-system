import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

// Inspect the effective definition, not an obsolete migration that happened
// to carry a guard. Runtime mixed-subject fixtures must accompany these checks.
function latestFunction(name: string): string {
  let body = "";
  for (const file of readdirSync("supabase/migrations").sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = stripComments(
      readFileSync(`supabase/migrations/${file}`, "utf8"),
    );
    const start = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(`,
      "ig",
    );
    for (const match of sql.matchAll(start)) {
      const tail = sql.slice(match.index);
      const delimiter = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);
      if (!delimiter) throw new Error(`Cannot read ${name} in ${file}`);
      const contentStart = delimiter.index + delimiter[0].length;
      const end = tail.indexOf(delimiter[1], contentStart);
      if (end < 0) throw new Error(`Unterminated ${name} in ${file}`);
      body = tail.slice(contentStart, end);
    }
  }
  if (!body) throw new Error(`No definition for ${name}`);
  return body;
}

describe("project FRACAS must not enter asset effectiveness", () => {
  it("carries only approved same-tenant standard references through the existing matcher", () => {
    const body = latestFunction("screen_applicable_project_lessons");
    expect(body).toContain("public.sync_lesson_applies_to_case(");
    expect(body).toContain("sw.organization_id=v_org");
    expect(body).toContain("a.organization_id=v_org");
    expect(body).toContain("cv.organization_id=v_org");
    expect(body).toContain("a.status='approved'");
    expect(body).toContain("sw.source_project_ca_id=cv.id");
  });
  it("refuses project records through both legacy asset mutation paths", () => {
    for (const name of ["attest_ca_stage", "screen_similar_assets"]) {
      expect(latestFunction(name)).toContain(
        "if v.project_lesson_id is not null then",
      );
    }
  });
  it("starts closure with a tenant-bound human and one audited source", () => {
    const body = latestFunction("start_project_ca_verification");
    expect(body).toMatch(
      /id\s*=\s*v_actor\s+and\s+organization_id\s*=\s*v_org/i,
    );
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toMatch(
      /id\s*=\s*p_lesson_id\s+and\s+organization_id\s*=\s*v_org\s+for\s+share/i,
    );
    expect(body).toContain("on conflict (project_lesson_id)");
    expect(body).toContain("'actorId',v_actor");
    expect(body).toContain("insert into public.audit_events");
    expect(body).toContain("null,null,null,'open'");
  });
  for (const name of [
    "evaluate_ca_effectiveness",
    "get_ca_effectiveness_rate",
    "snapshot_ca_effectiveness_kpi",
  ]) {
    it(`${name} explicitly restricts its source to asset work orders`, () => {
      const body = latestFunction(name);
      expect(body).toMatch(/cv\.work_order_id\s+is\s+not\s+null/i);
      expect(body).toMatch(/cv\.asset_id\s+is\s+not\s+null/i);
    });
  }
});
