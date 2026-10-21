import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100500_failure_detection_paths.sql",
  ),
  "utf8",
);

describe("failure detection path contract", () => {
  it("reads canonical edges and does not copy chunk text or invent a probability", () => {
    expect(migration).toContain(
      "create table if not exists public.engineering_knowledge_relationships",
    );
    expect(migration).toContain("query_failure_detection_paths");
    expect(migration).not.toMatch(/embedding\s+vector/i);
    expect(migration).not.toMatch(/\bcontent\s+text\b/i);
    expect(migration).not.toMatch(
      /propagation_probability|propagationProbability/i,
    );
    expect(migration).toContain(
      "review_state in ('draft', 'in_review', 'approved')",
    );
    expect(migration).not.toMatch(
      /insert\s+into\s+public\.engineering_knowledge_relationships/i,
    );
    expect(migration).not.toMatch(
      /insert\s+into\s+(public\.)?(approval_workflows|work_orders|autonomous_actions)\b/i,
    );
  });

  it("is organization-scoped and non-authorizing", () => {
    expect(migration).toContain("using (organization_id = app_current_org())");
    expect(migration).toContain("e.organization_id = v_org");
    expect(migration).toContain(
      "revoke all on public.engineering_knowledge_relationships from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant select on public.engineering_knowledge_relationships to authenticated",
    );
    expect(migration).toContain("'grantsAuthority', false");
    expect(migration).toContain(
      "revoke all on function public.query_failure_detection_paths(text, int) from public, anon",
    );
    expect(migration).not.toMatch(/p_organization_id|p_org\b/i);
  });

  it("wires the slice smoke", () => {
    const ci = fs.readFileSync(
      path.resolve(".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).toContain("scripts/ci-ekg-slice-*.sh");
    expect(fs.existsSync("scripts/ci-ekg-slice-5-failure-paths.sh")).toBe(true);
  });
});
