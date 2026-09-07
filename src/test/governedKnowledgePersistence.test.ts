import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIGRATION =
  "supabase/migrations/20261216090000_governed_engineering_knowledge.sql";
const HARDENING =
  "supabase/migrations/20261216090100_governed_engineering_knowledge_review_invalidation.sql";

const migration = fs.readFileSync(path.resolve(MIGRATION), "utf8");
const hardening = fs.readFileSync(path.resolve(HARDENING), "utf8");
const ci = fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8");

describe("governed engineering knowledge persistence", () => {
  it("extends the canonical Reliability KB rather than creating another chunk store", () => {
    expect(migration).toContain("alter table public.reliability_kb_chunks");
    expect(migration).not.toMatch(
      /create table if not exists public\.engineering_knowledge_chunks/i,
    );
    expect(migration).toContain("governed_source_id uuid");
    expect(migration).toContain("content_checksum text");
    expect(migration).toContain("provenance jsonb");
  });

  it("requires source governance and human steward approval", () => {
    expect(migration).toContain("app_is_knowledge_steward");
    expect(migration).toContain(
      "AI-generated material cannot be approved as authoritative source knowledge",
    );
    expect(migration).toContain(
      "Source cannot be approved without provenance-bearing canonical chunks",
    );
    expect(migration).toContain(
      "Source cannot be approved without an approved applicability mapping",
    );
  });

  it("keeps knowledge approval from authorizing operational work", () => {
    expect(migration).toContain(
      "Knowledge approval is evidence governance. It does not authorize work",
    );
    expect(migration).not.toMatch(
      /insert\s+into\s+(public\.)?(approval_workflows|autonomous_actions|autonomous_decisions|work_orders)\b/i,
    );
    expect(hardening).not.toMatch(
      /insert\s+into\s+(public\.)?(approval_workflows|autonomous_actions|autonomous_decisions|work_orders)\b/i,
    );
  });

  it("keeps SECURITY DEFINER tenant selection session-safe", () => {
    expect(migration).toContain(
      "case when auth.uid() is not null then app_current_org() else p_organization_id end",
    );
    expect(migration).not.toMatch(
      /case when auth\.uid\(\) is not null then public\.app_current_org\(\)/,
    );
  });

  it("hides draft or superseded governed sources while keeping C2.15 ungoverned intake retrievable", () => {
    expect(migration).toMatch(
      /c\.governed_source_id is null[\s\S]*s\.review_state = 'approved'[\s\S]*s\.superseded_by_source_id is null/,
    );
    expect(migration).toContain("kb_ingest_document");
    expect(migration).not.toContain(
      "Tenant knowledge requires a governed engineering source before ingestion",
    );
  });

  it("revokes the chunk-attachment trigger from PUBLIC, including anon", () => {
    expect(migration).toContain(
      "revoke all on function public.enforce_governed_client_kb_chunk() from public, anon, authenticated",
    );
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
    expect(hardening).toContain(
      "Superseded engineering knowledge sources are immutable",
    );
  });

  it("invalidates approval when applicability or canonical chunks change", () => {
    expect(hardening).toContain(
      "invalidate_engineering_source_approval_from_mapping",
    );
    expect(hardening).toContain(
      "trg_engineering_mapping_invalidates_source_approval",
    );
    expect(hardening).toContain(
      "invalidate_engineering_source_approval_from_chunk",
    );
    expect(hardening).toContain(
      "trg_engineering_chunk_invalidates_source_approval",
    );
    expect(hardening).toMatch(
      /where id = v_old_source[\s\S]*review_state = 'approved'/,
    );
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

  it("wires both smokes into the existing migration-chain CI job", () => {
    expect(ci).toContain("bash scripts/ci-governed-knowledge-smoke.sh");
    expect(ci).toContain(
      "bash scripts/ci-governed-knowledge-review-invalidation-smoke.sh",
    );
  });
});
