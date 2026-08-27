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
}

export async function listKbIntakeDocuments(): Promise<KbIntakeDocument[]> {
  const { data, error } = await supabase
    .from("kb_intake_documents")
    .select(
      "id, source_id, title, document_class, document_type, original_filename, status, chunk_count, page_count, uploaded_at, error_message",
    )
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KbIntakeDocument[];
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
