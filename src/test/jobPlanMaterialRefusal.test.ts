/**
 * C8.07 residual: upsert_job_plan used to skip material lines whose code
 * did not resolve, and the draft still saved. The live function refuses
 * those codes before it writes. adopt_job_plan and apply_job_plan stay on
 * the original definition.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationFiles, stripComments } from "./support/migrationPolicies";

const ORIGINAL = "20260811090000_job_plans.sql";
const REFUSAL = "20261225140000_job_plan_unresolved_material_refusal.sql";

function functionBodies(): Map<string, { file: string; body: string }> {
  const defs = new Map<string, { file: string; body: string }>();
  for (const file of migrationFiles()) {
    const sql = stripComments(
      readFileSync(`supabase/migrations/${file}`, "utf8"),
    );
    for (const match of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)(\$\w*\$)([\s\S]*?)\4\s*;/gi,
    )) {
      const name = match[1].replace(/^public\./i, "").toLowerCase();
      defs.set(name, { file, body: match[5] });
    }
  }
  return defs;
}

const defs = functionBodies();
const upsert = defs.get("upsert_job_plan");

describe("upsert_job_plan refuses unresolved material codes", () => {
  it("the live definition is the refusal migration, not the historical skip", () => {
    expect(upsert?.file).toBe(REFUSAL);
    const historical = stripComments(
      readFileSync(`supabase/migrations/${ORIGINAL}`, "utf8"),
    );
    expect(historical).toMatch(/if\s+v_mat\s+is\s+not\s+null\s+then/i);
  });

  it("returns the refusal before inserting a plan", () => {
    const body = upsert?.body ?? "";
    const refuseAt = body.search(
      /unresolved material code\(s\) refused; nothing was saved/i,
    );
    const insertAt = body.search(/insert\s+into\s+job_plans/i);
    expect(refuseAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(refuseAt);
  });

  it("does not skip an unresolved code, and does not invent a catalogue row", () => {
    const body = upsert?.body ?? "";
    expect(body).not.toMatch(/if\s+v_mat\s+is\s+not\s+null\s+then/i);
    expect(body).toMatch(/if\s+v_mat\s+is\s+null\s+then/i);
    expect(body).toMatch(/raise\s+exception/i);
    expect(body).not.toMatch(/insert\s+into\s+(public\.)?materials\b/i);
    expect(body).toMatch(/organization_id\s*=\s*v_org\s+and\s+material_code/i);
  });

  it("keeps the planning-role gate and the required plan fields", () => {
    const body = upsert?.body ?? "";
    expect(body).toContain(
      "'planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin'",
    );
    expect(body).toContain("plan_key, title and scope are required");
    expect(body).toContain(
      "this plan is adopted — revise it as a new version rather than editing an adopted plan",
    );
  });

  it("revokes execute from public on the replaced definer", () => {
    const sql = readFileSync(`supabase/migrations/${REFUSAL}`, "utf8");
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.upsert_job_plan\(jsonb\)\s+from\s+public/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.upsert_job_plan\(jsonb\)\s+to\s+authenticated/i,
    );
  });
});

describe("adopt and apply authority is unchanged", () => {
  it("adopt_job_plan still requires a named basis, a step, and an acceptance check", () => {
    expect(defs.get("adopt_job_plan")?.file).toBe(ORIGINAL);
    const body = defs.get("adopt_job_plan")?.body ?? "";
    expect(body).toContain("record the basis for adopting this plan");
    expect(body).toContain("a job plan with no steps is a title, not a plan");
    expect(body).toContain(
      "a plan whose completion cannot be verified is not executable",
    );
    expect(body).not.toMatch(/insert\s+into\s+(public\.)?materials\b/i);
  });

  it("apply_job_plan still refuses a draft and does not become plant execute", () => {
    expect(defs.get("apply_job_plan")?.file).toBe(ORIGINAL);
    const body = defs.get("apply_job_plan")?.body ?? "";
    expect(body).toContain("A draft plan may not be applied to real work");
    expect(body).toMatch(/status\s*=\s*'adopted'/i);
    expect(body).not.toMatch(/insert\s+into\s+(public\.)?materials\b/i);
  });
});
