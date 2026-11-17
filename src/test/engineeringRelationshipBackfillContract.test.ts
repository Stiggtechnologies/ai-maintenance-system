import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20271020100400_engineering_relationship_backfill.sql",
  ),
  "utf8",
);

describe("engineering relationship backfill contract", () => {
  it("stores canonical ids and does not copy chunk text or embeddings", () => {
    expect(migration).toContain(
      "create table if not exists public.engineering_knowledge_relationships",
    );
    expect(migration).not.toMatch(/embedding\s+vector/i);
    expect(migration).not.toMatch(/\bcontent\s+text\b/i);
    expect(migration).toContain("provenance_chunk_ids uuid[]");
    expect(migration).toContain("provenance_canonical_ids text[]");
    expect(migration).toContain("review_state text not null default 'draft'");
    expect(migration).toContain("reliability_kb_chunks");
    expect(migration).toContain("engineering_knowledge_sources");
  });

  it("is organization-scoped, steward-only, and non-authorizing", () => {
    expect(migration).toContain("using (organization_id = app_current_org())");
    expect(migration).toContain(
      "revoke all on public.engineering_knowledge_relationships from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant select on public.engineering_knowledge_relationships to authenticated",
    );
    expect(migration).toContain("app_is_knowledge_steward()");
    expect(migration).toContain(
      "Relationship provenance chunk is outside the current organization",
    );
    expect(migration).toContain("'grantsAuthority', false");
    expect(migration).toContain(
      "when public.app_current_role() = 'ai_admin' then 'agent'",
    );
    expect(migration).toContain("when v_actor is not null then 'human'");
    expect(migration).not.toMatch(/p_confidence,\s*'migration'/);
    expect(migration).toContain(
      "on conflict (organization_id, relationship_code) do nothing",
    );
    expect(migration).toContain(
      "revoke all on function public.insert_knowledge_relationship_edge(text, text, text, text, text, text, uuid[], text[], numeric)",
    );
    expect(migration).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.insert_knowledge_relationship_edge/i,
    );
    expect(migration).not.toMatch(
      /insert\s+into\s+(public\.)?(approval_workflows|work_orders|autonomous_actions)\b/i,
    );
  });

  it("wires the slice smoke", () => {
    const ci = fs.readFileSync(
      path.resolve(".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ci).toContain("scripts/ci-ekg-slice-*.sh");
    expect(fs.existsSync("scripts/ci-ekg-slice-4-backfill.sh")).toBe(true);
  });
});
