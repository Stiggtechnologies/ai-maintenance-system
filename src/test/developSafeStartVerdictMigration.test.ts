/**
 * D7.06 — safe-to-start requires a completed field-readiness assessment.
 *
 * The migration transforms the ONE verdict rather than minting a parallel
 * decision. These assertions pin the fail-closed state, lineage semantics,
 * tenant-safe call graph and register honesty before any green promotion.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const FILE =
  "supabase/migrations/20261220130000_develop_safe_start_requires_field_assessment.sql";
const CURRENCY =
  "supabase/migrations/20261211090200_develop_field_readiness_currency.sql";

const raw = readFileSync(FILE, "utf8");
const sql = stripComments(raw);
const normalized = sql.toLowerCase();
const predecessor = stripComments(readFileSync(CURRENCY, "utf8"));
const register = readFileSync("docs/sync-develop/register.md", "utf8");

const registerRow = (id: string) => {
  const row = register.split("\n").find((line) => line.startsWith(`| ${id} `));
  expect(row, `register row ${id}`).toBeDefined();
  return row as string;
};

describe("D7.06 safe-to-start verdict", () => {
  it("extends the existing predicate by guarded transformation", () => {
    expect(sql).toContain("pg_get_functiondef");
    expect(sql).toContain("sync_work_package_release_verdict");
    expect(sql).toContain("v_new := replace(v_def, v_anchor, v_replacement)");
    expect(sql).toContain("execute v_new");
    expect(raw).not.toMatch(/create\s+(?:or\s+replace\s+)?function/i);
    expect(raw).not.toMatch(/create\s+table/i);
  });

  it("adds one fail-closed state for a package with no computed assessment", () => {
    expect(normalized).toContain("if v_run.id is null then");
    expect(sql).toContain("'verdict', 'field_unassessed'");
    expect(sql).toContain("'canRelease', false");
    expect(sql).toContain("no field-readiness assessment has been completed");
    expect(normalized).toContain("assess the package first");
  });

  it("counts only a computed lineage run as an assessment", () => {
    expect(predecessor).toContain("r.status = 'computed'");
    expect(sql).toContain("r.status = ''computed''");
    expect(sql).not.toContain("r.status in");
    expect(sql).not.toContain("r.status <> 'refused'");
  });

  it("places the missing-assessment refusal after hard blockers and before currency", () => {
    const hard = predecessor.indexOf("if v_open_hard > 0 then");
    const run = predecessor.indexOf("select r.id, r.computed_at into v_run");
    expect(hard).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(hard);
    const replacement = normalized.slice(normalized.indexOf("$replacement$"));
    expect(replacement.indexOf("if v_run.id is null then")).toBeLessThan(
      replacement.indexOf("if v_run.id is not null then"),
    );
  });

  it("does not widen access or weaken the human release boundary", () => {
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\brevoke\b/i);
    expect(sql).not.toContain("release_work_package(");
    expect(sql).not.toContain("auth.uid()");
    expect(sql).not.toContain("ai_admin");
  });

  it("promotes D7.06 only with runtime proof and exact evidence", () => {
    expect(registerRow("D7.06").split("|")[4]?.trim()).toBe("✅");
    expect(registerRow("D7.06")).toContain(
      "20261220130000_develop_safe_start_requires_field_assessment.sql",
    );
    expect(registerRow("D7.06")).toContain("ci-develop-slice7b-smoke.sh");
    expect(registerRow("D7.06")).toContain("field_unassessed");
  });
});
