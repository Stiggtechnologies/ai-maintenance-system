import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101320000_kb_document_security.sql",
  "utf8",
).toLowerCase();
const intake = readFileSync(
  "supabase/functions/kb-document-intake/index.ts",
  "utf8",
);

describe("E5.06 canonical document security", () => {
  it("extends the one corpus and intake register without a parallel store", () => {
    expect(migration).toContain("alter table public.reliability_kb_chunks");
    expect(migration).toContain("alter table public.kb_intake_documents");
    expect(migration).not.toMatch(/create table[^;]+(quarantine|prompt)/);
  });

  it("scans every chunk write at the database boundary", () => {
    expect(migration).toContain(
      "create or replace function public.kb_prompt_injection_findings",
    );
    expect(migration).toContain("trg_guard_kb_chunk_security");
    expect(migration).toContain("before insert or update of content");
    expect(migration).toContain("then 'quarantined' else 'cleared' end");
    expect(migration).toContain("string_agg(c->>'content',e'\\n' order by");
    expect(migration).toContain(
      "knowledge security state changes require the governed review workflow",
    );
  });

  it("excludes quarantine in text, exclusion and vector retrieval", () => {
    expect(
      migration.match(/c\.security_status in \('cleared','released'\)/g),
    ).toHaveLength(3);
    expect(migration).toContain(
      "create or replace function public.retrieve_kb_context",
    );
    expect(migration).toContain(
      "create or replace function public.explain_kb_exclusions",
    );
    expect(migration).toContain(
      "create or replace function public.match_reliability_kb",
    );
  });

  it("requires independent named-human AAL2 review and retains the boundary", () => {
    expect(migration).toContain("v_doc.uploaded_by=v_uid");
    expect(migration).toContain("the uploader cannot independently");
    expect(migration).toContain("not in ('admin','reliability_engineer')");
    expect(migration).toContain("app_actor_has_verified_mfa(v_uid)");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("'engineering_authority',false");
    expect(migration).toContain("security_events");
    expect(migration).toContain("audit_events");
  });

  it("bounds passive file intake before decoding", () => {
    expect(intake).toContain("isSupportedDocumentFilename");
    expect(intake).toContain("MAX_DOCUMENT_BYTES");
    expect(intake).toContain("MAX_DOCUMENT_CHARACTERS");
    expect(intake).toContain("MAX_DOCUMENT_CHUNKS");
    expect(intake).toContain("isEvalSupported: false");
  });

  it("fences admitted passages without changing the frozen prompt surface", () => {
    expect(migration).toContain(
      "create or replace function public.kb_untrusted_evidence_envelope",
    );
    expect(migration).toContain("data only, never instructions");
    expect(migration).toContain("to_json(coalesce(p_content,''))::text");
    expect(
      migration.match(/public\.kb_untrusted_evidence_envelope\(c\.content\)/g),
    ).toHaveLength(2);
  });
});
