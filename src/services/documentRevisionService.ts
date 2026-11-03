import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

async function callRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export type DocumentRevisionKind =
  "policy" | "data_standard" | "form" | "specification" | "work_instruction";

export type DocumentRevisionStatus =
  "under_review" | "effective" | "superseded" | "rejected";

export interface DocumentRevisionCandidate {
  id: string;
  source_id: string;
  title: string;
  original_filename: string | null;
  document_class: string;
  security_status: "cleared" | "released";
  uploaded_at: string;
}

export interface DocumentRevision {
  id: string;
  sourceId: string;
  title: string;
  documentClass: string;
  kind: DocumentRevisionKind;
  documentNumber: string;
  revisionLabel: string;
  controlStatus: DocumentRevisionStatus;
  securityStatus: "cleared" | "released" | "quarantined" | "rejected";
  applicability: string;
  effectiveAt: string | null;
  reviewDueAt: string | null;
  supersedesDocumentId: string | null;
  supersededByDocumentId: string | null;
  controlBasis: string;
  controlledBy: string;
  controlledAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewBasis: string | null;
}

export interface DocumentRevisionRegister {
  documents: DocumentRevision[];
  coverage: Record<DocumentRevisionKind, number>;
  missingEffectiveKinds: DocumentRevisionKind[];
  decisionBoundary: string;
}

export interface SubmitDocumentRevisionInput {
  documentId: string;
  kind: DocumentRevisionKind;
  documentNumber: string;
  revisionLabel: string;
  applicability: string;
  basis: string;
  reviewDueAt?: string | null;
  supersedesDocumentId?: string | null;
}

export async function listDocumentRevisionCandidates(): Promise<
  DocumentRevisionCandidate[]
> {
  const { data, error } = await supabase
    .from("kb_intake_documents")
    .select(
      "id, source_id, title, original_filename, document_class, security_status, uploaded_at",
    )
    .is("controlled_kind", null)
    .in("security_status", ["cleared", "released"])
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentRevisionCandidate[];
}

export async function getDocumentRevisionRegister() {
  return callRpc<DocumentRevisionRegister>("get_document_revision_register");
}

export async function submitDocumentRevision(
  input: SubmitDocumentRevisionInput,
) {
  return callRpc<{
    documentId: string;
    controlStatus: "under_review";
    documentNumber: string;
    revisionLabel: string;
    kind: DocumentRevisionKind;
    operationalAuthorization: false;
  }>("submit_document_revision", {
    p_document_id: input.documentId,
    p_record: {
      kind: input.kind,
      documentNumber: input.documentNumber.trim(),
      revisionLabel: input.revisionLabel.trim(),
      applicability: input.applicability.trim(),
      basis: input.basis.trim(),
      reviewDueAt: input.reviewDueAt || null,
      supersedesDocumentId: input.supersedesDocumentId?.trim() || null,
    },
  });
}

export async function decideDocumentRevision(input: {
  documentId: string;
  decision: "approved" | "rejected";
  basis: string;
}) {
  return callRpc<{
    documentId: string;
    controlStatus: "effective" | "rejected";
    decision: "approved" | "rejected";
    supersededDocumentId: string | null;
    segregationOfDuties: true;
    operationalAuthorization: false;
  }>("decide_document_revision", {
    p_document_id: input.documentId,
    p_decision: input.decision,
    p_basis: input.basis.trim(),
  });
}
