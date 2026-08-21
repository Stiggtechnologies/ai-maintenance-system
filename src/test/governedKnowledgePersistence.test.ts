import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve("supabase/migrations/20260920005000_governed_engineering_knowledge.sql"),
  "utf8",
);
const hardening = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260920006000_governed_engineering_knowledge_review_invalidation.sql",
  ),
  "utf8",
);

describe("governed engineering knowledge persistence", () => {
  it("extends the canonical Reliability KB rather than creating another chunk store", () => {
    expect(migration).toContain("alter table public.reliability_kb_chunks");
    expect(migration).not.toMatch(/create table if not exists public\.engineering_knowledge_chunks/i);
    expect(migration).toContain("governed_source_id uuid");
    expect(migration).toContain("content_checksum text");
    expect(migration).toContain("provenance jsonb");
  });

  it("requires source governance and human steward approval", () => {
    expect(migration).toContain("app_is_knowledge_steward");
    expect(migration).toContain("AI-generated material cannot be approved as authoritative source knowledge");
    expect(migration).toContain("Source cannot be approved without provenance-bearing canonical chunks");
    expect(migration).toContain("Source cannot be approved without an approved applicability mapping");
  });

  it("keeps SECURITY DEFINER tenant selection session-safe", () => {
    expect(migration).toContain(
      "case when auth.uid() is not null then public.app_current_org() else p_organization_id end",
    );
  });

  it("requires approved non-superseded sources for tenant retrieval", () => {
    expect(migration).toMatch(/c\.governed_source_id is not null[\s\S]*s\.review_state = 'approved'[\s\S]*s\.superseded_by_source_id is null/);
  });

  it("restores OR semantics for natural-language KB retrieval", () => {
    expect(migration).toContain(
      "replace(websearch_to_tsquery('english', coalesce(p_query, ''))::text, '&', '|')::tsquery",
    );
  });

  it("invalidates approval when reviewed source material changes", () => {
    expect(hardening).toContain("enforce_engineering_source_reapproval");
    expect(hardening).toContain("new.review_state := 'in_review'");
    expect(hardening).toContain("new.approved_by := null");
    expect(hardening).toContain("new.approved_at := null");
    expect(hardening).toContain("Superseded engineering knowledge sources are immutable");
  });

  it("invalidates approval when applicability or canonical chunks change", () => {
    expect(hardening).toContain("invalidate_engineering_source_approval_from_mapping");
    expect(hardening).toContain("trg_engineering_mapping_invalidates_source_approval");
    expect(hardening).toContain("invalidate_engineering_source_approval_from_chunk");
    expect(hardening).toContain("trg_engineering_chunk_invalidates_source_approval");
    expect(hardening).toMatch(/where id = v_old_source[\s\S]*review_state = 'approved'/);
  });

  it("keeps trigger-only governance helpers out of API execution", () => {
    expect(hardening).toContain(
      "revoke all on function public.enforce_engineering_source_reapproval() from public, anon, authenticated",
    );
    expect(hardening).toContain(
      "revoke all on function public.invalidate_engineering_source_approval_from_mapping() from public, anon, authenticated",
    );
    expect(hardening).toContain(
      "revoke all on function public.invalidate_engineering_source_approval_from_chunk() from public, anon, authenticated",
    );
  });
});
