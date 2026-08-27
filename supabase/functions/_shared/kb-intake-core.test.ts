import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";import {
  buildIntakeChunks,
  chunkDocument,
  KB_DOCUMENT_CLASSES,
  KB_INTAKE_ROLES,
  suggestDocumentClass,
  validateIntakeInput,
} from "./kb-intake-core";

describe("chunkDocument (ported legacy chunker)", () => {
  it("preserves paragraphs and joins them with double newlines", () => {
    const text = "First paragraph with enough words to be meaningful.\n\nSecond paragraph here.";
    const chunks = chunkDocument(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("First paragraph");
    expect(chunks[0]).toContain("Second paragraph");
    expect(chunks[0]).toContain("\n\n");
  });

  it("splits long content at maxChunkSize with overlap", () => {
    const para = "The quick brown fox jumps over the lazy dog and continues running. ".repeat(60);
    const chunks = chunkDocument(para, { maxChunkSize: 400, overlapSize: 100, preserveParagraphs: true });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    // Character-level overlap: the next chunk re-carries the previous tail so
    // no meaning is lost across the boundary.
    expect(chunks[1]).toContain(chunks[0].slice(-60).trim());
  });

  it("drops chunks shorter than 50 characters", () => {
    const chunks = chunkDocument("tiny", { maxChunkSize: 100, overlapSize: 20, preserveParagraphs: true });
    expect(chunks).toEqual([]);
  });

  it("handles a single paragraph without splitting when it fits", () => {
    const text = "A single paragraph that comfortably fits inside the configured maximum chunk size.";
    const chunks = chunkDocument(text);
    expect(chunks).toEqual([text]);
  });
});

describe("suggestDocumentClass", () => {
  it("maps service manuals to oem_service_manual", () => {
    expect(suggestDocumentClass("HT-027 Service Manual")).toBe("oem_service_manual");
  });
  it("maps brochures/datasheets to oem_marketing", () => {
    expect(suggestDocumentClass("Komatsu 980E Datasheet")).toBe("oem_marketing");
  });
  it("maps incident reports to incident_investigation", () => {
    expect(suggestDocumentClass("Pump 101 Failure Investigation")).toBe("incident_investigation");
  });
  it("maps work-order history to operator_history", () => {
    expect(suggestDocumentClass("AHS Fleet Work Order History 2025")).toBe("operator_history");
  });
  it("maps procedures/standards to engineering_standard", () => {
    expect(suggestDocumentClass("Lockout Tagout Procedure — Field Standard")).toBe("engineering_standard");
  });
  it("defaults everything else to unclassified (silence, not trust)", () => {
    expect(suggestDocumentClass("Quarterly Meeting Notes Q3")).toBe("unclassified");
  });
});

describe("validateIntakeInput", () => {
  const good = { source_id: "ht027-service-manual", title: "HT-027 Service Manual", document_class: "oem_service_manual", content: "x".repeat(100) };
  it("accepts a valid payload", () => {
    expect(validateIntakeInput(good).ok).toBe(true);
  });
  it("rejects a short source_id", () => {
    expect(validateIntakeInput({ ...good, source_id: "ab" }).ok).toBe(false);
  });
  it("rejects source_id with illegal characters", () => {
    expect(validateIntakeInput({ ...good, source_id: "has space" }).ok).toBe(false);
  });
  it("rejects an unknown document class", () => {
    expect(validateIntakeInput({ ...good, document_class: "not_a_class" }).ok).toBe(false);
  });
  it("rejects missing content", () => {
    expect(validateIntakeInput({ ...good, content: "" }).ok).toBe(false);
  });
});

describe("buildIntakeChunks", () => {
  it("returns zero-indexed chunks with page attribution", () => {
    const chunks = buildIntakeChunks("word ".repeat(300), 12, 14);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].page_start).toBe(12);
    expect(chunks[0].page_end).toBe(14);
  });
});

describe("C2.15 intake contract", () => {
  const migration = readFileSync(
    "supabase/migrations/20261027090010_kb_document_intake.sql",
    "utf8",
  );
  const edgeFunction = readFileSync(
    "supabase/functions/kb-document-intake/index.ts",
    "utf8",
  );

  it("creates kb_intake_documents tenant-scoped with read-only RLS", () => {
    expect(migration).toContain("create table if not exists public.kb_intake_documents");
    expect(migration).toContain("organization_id uuid not null references organizations(id)");
    expect(migration).toContain("kb_intake_documents_read");
    expect(migration).toContain("for select to authenticated");
  });

  it("defines kb_ingest_document as the single sanctioned write path", () => {
    expect(migration).toContain("create or replace function public.kb_ingest_document");
    expect(migration).toContain("security definer");
    expect(migration).toContain("reliability_kb_chunks");
    expect(migration).toContain("security_events");
    expect(migration).toContain("revoke execute");
    expect(migration).toContain("grant execute");
  });

  it("gates on admin/ai_admin/reliability_engineer roles", () => {
    expect(migration).toContain("not in ('admin', 'ai_admin', 'reliability_engineer')");
  });

  it("the edge function authenticates, role-gates, chunks and calls the RPC", () => {
    expect(edgeFunction).toContain("supabase.auth.getUser()");
    expect(edgeFunction).toContain("user_profiles");
    expect(edgeFunction).toContain('"kb_ingest_document"');
    expect(edgeFunction).toContain("buildIntakeChunks");
    expect(edgeFunction).toContain("PDF intake is not wired yet");
  });

  it("the shared core is imported by the edge function", () => {
    expect(edgeFunction).toContain("../_shared/kb-intake-core.ts");
  });

  it("exposes exactly the documented classes and roles", () => {
    expect(KB_DOCUMENT_CLASSES).toContain("unclassified");
    expect(KB_DOCUMENT_CLASSES).toContain("oem_service_manual");
    expect(KB_INTAKE_ROLES).toEqual(["admin", "ai_admin", "reliability_engineer"]);
  });
});
