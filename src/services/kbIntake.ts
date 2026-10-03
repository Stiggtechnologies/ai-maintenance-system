/**
 * KB intake service — C2.15 Reliability Knowledge Activation surface.
 * List + ingest + class reference. The ingest call goes through the
 * kb-document-intake edge function; the list reads the tenant-scoped
 * register via RLS.
 */
import { supabase } from "../lib/supabase";

export interface KbIntakeDocument {
  id: string;
  source_id: string;
  title: string;
  document_class: string | null;
  document_type: string | null;
  original_filename: string | null;
  status: string;
  chunk_count: number;
  page_count: number | null;
  uploaded_at: string;
  error_message: string | null;
  security_status: "cleared" | "quarantined" | "released" | "rejected";
  security_findings: Array<{
    chunkIndex: number;
    signals: Array<{
      signal: string;
      severity: "warning" | "critical";
      explanation: string;
    }>;
  }>;
  security_scan_version: string;
  security_scanned_at: string | null;
  security_reviewed_by: string | null;
  security_reviewed_at: string | null;
  security_review_basis: string | null;
}

export interface KbDocumentClass {
  class_key: string;
  label: string;
  trust_rank: number;
}

export interface IngestKbDocumentInput {
  source_id: string;
  title: string;
  document_class: string;
  document_type?: string | null;
  original_filename?: string | null;
  content?: string;
  file_base64?: string;
  filename?: string;
  page_start?: number | null;
  page_end?: number | null;
}

export interface IngestResult {
  source_id: string;
  document_class: string;
  chunks_created: number;
  status: string;
  security_status: "cleared" | "quarantined" | "released" | "rejected";
  security_findings_count: number;
}

export async function listKbIntakeDocuments(): Promise<KbIntakeDocument[]> {
  const { data, error } = await supabase
    .from("kb_intake_documents")
    .select(
      "id, source_id, title, document_class, document_type, original_filename, status, chunk_count, page_count, uploaded_at, error_message, security_status, security_findings, security_scan_version, security_scanned_at, security_reviewed_by, security_reviewed_at, security_review_basis",
    )
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KbIntakeDocument[];
}

export interface ReviewKbDocumentSecurityResult {
  sourceId: string;
  securityStatus: "released" | "rejected";
  chunksReviewed: number;
  retrievable: boolean;
  segregationOfDuties: boolean;
  engineeringAuthority: false;
}

export async function reviewKbDocumentSecurity(
  sourceId: string,
  decision: "release" | "reject",
  basis: string,
): Promise<ReviewKbDocumentSecurityResult> {
  const { data, error } = await supabase.rpc("review_kb_document_security", {
    p_source_id: sourceId,
    p_decision: decision,
    p_basis: basis,
  });
  if (error) throw new Error(error.message);
  if (
    data &&
    typeof data === "object" &&
    "error" in (data as Record<string, unknown>)
  ) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as ReviewKbDocumentSecurityResult;
}

export async function listKbDocumentClasses(): Promise<KbDocumentClass[]> {
  const { data, error } = await supabase
    .from("kb_document_classes")
    .select("class_key, label, trust_rank")
    .order("trust_rank", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KbDocumentClass[];
}

export async function ingestKbDocument(
  input: IngestKbDocumentInput,
): Promise<IngestResult> {
  const { data, error } = await supabase.functions.invoke(
    "kb-document-intake",
    {
      body: input,
    },
  );
  if (error) throw new Error(error.message);
  if (
    data &&
    typeof data === "object" &&
    "error" in (data as Record<string, unknown>)
  ) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as IngestResult;
}
