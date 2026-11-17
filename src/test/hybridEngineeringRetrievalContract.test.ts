import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100200_hybrid_engineering_retrieval.sql",
  ),
  "utf8",
);
const wrapperMarker = "-- The hybrid query turns index scans off";
const plannerRestore = migration.slice(migration.indexOf(wrapperMarker));

describe("hybrid engineering retrieval contract", () => {
  it("searches the canonical chunk store and does not create another embedding column", () => {
    expect(migration).toContain("from public.reliability_kb_chunks c");
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/add column[^;]*embedding/i);
    expect(migration).toContain("kb_untrusted_evidence_envelope");
    expect(migration).toContain("c.security_status in ('cleared', 'released')");
    expect(migration).toContain("s.review_state = 'approved'");
    expect(migration).toContain("s.superseded_by_source_id is null");
    expect(migration).toContain("c.organization_id is null");
    expect(migration).toContain("app_current_org()");
  });

  it("blends semantic and lexical scores and treats a hit as non-authorizing", () => {
    expect(migration).toContain("scored.semantic * 0.55");
    expect(migration).toContain(
      "(scored.lexical_raw / (scored.lexical_raw + 1)) * 0.45",
    );
    expect(migration).toContain(
      "replace(websearch_to_tsquery('english', p_query)::text, '&', '|')::tsquery",
    );
    expect(migration).toContain("engineering_knowledge_mappings");
    expect(migration).toContain(
      "A hit grants no permission, work release, or approval.",
    );
    expect(migration).not.toMatch(/p_organization_id/i);
    expect(migration).not.toMatch(
      /insert\s+into\s+(public\.)?(approval_workflows|autonomous_actions|work_orders)\b/i,
    );
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain(
      "revoke all on function public.retrieve_engineering_knowledge_hybrid(text, text, vector, text, text, text, double precision, int) from public, anon",
    );
  });

  it("restores the caller's planner settings after the exact-similarity query", () => {
    expect(migration.indexOf(wrapperMarker)).toBeGreaterThan(0);
    expect(migration).toContain(
      "rename to retrieve_engineering_knowledge_hybrid_core",
    );
    expect(migration).toContain(
      "perform set_config('enable_indexscan', 'off', true)",
    );
    expect(plannerRestore).toContain("current_setting('enable_indexscan')");
    expect(plannerRestore).toContain("current_setting('enable_bitmapscan')");
    expect(plannerRestore).toContain(
      "perform set_config('enable_indexscan', v_indexscan, true)",
    );
    expect(plannerRestore).toContain(
      "perform set_config('enable_bitmapscan', v_bitmapscan, true)",
    );
    expect(plannerRestore).not.toMatch(/set_config\('enable_indexscan', 'on'/);
    expect(plannerRestore).not.toMatch(
      /\b(retrieve_kb_context|kb_document_classes|kb_claim_types)\b/,
    );
    expect(plannerRestore).toContain("set search_path = public");
    expect(plannerRestore).toContain(
      "revoke all on function public.retrieve_engineering_knowledge_hybrid_core(",
    );
  });

  it("wires the slice smoke into the migration job", () => {
    const ci = fs.readFileSync(
      path.resolve(".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).toContain("scripts/ci-ekg-slice-*.sh");
    expect(fs.existsSync("scripts/ci-ekg-slice-2-hybrid-retrieval.sh")).toBe(
      true,
    );
  });
});
