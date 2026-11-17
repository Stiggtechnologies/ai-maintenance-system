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

export type ControlledDocumentKind =
  | "drawing"
  | "pid"
  | "manual"
  | "procedure"
  | "inspection_record"
  | "engineering_standard";

export type ControlledDocumentStatus =
  "under_review" | "effective" | "superseded" | "rejected";

export interface ControlledDocumentCandidate {
  id: string;
  source_id: string;
  title: string;
  original_filename: string | null;
  document_class: string;
  security_status: "cleared" | "released";
  uploaded_at: string;
}

export interface ControlledDocument {
  id: string;
  sourceId: string;
  title: string;
  documentClass: string;
  kind: ControlledDocumentKind;
  documentNumber: string;
  revisionLabel: string;
  controlStatus: ControlledDocumentStatus;
  securityStatus: "cleared" | "released" | "quarantined" | "rejected";
  applicability: string;
  effectiveAt: string | null;
  reviewDueAt: string | null;
  assetId: string | null;
  siteId: string | null;
  standardWorkId: number | null;
  governanceStandardId: string | null;
  evidenceItemId: string | null;
  inspectionPlanId: number | null;
  supersedesDocumentId: string | null;
  supersededByDocumentId: string | null;
  controlBasis: string;
  controlledBy: string;
  controlledAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewBasis: string | null;
}

export interface ControlledDocumentRegister {
  documents: ControlledDocument[];
  coverage: Record<ControlledDocumentKind, number>;
  missingEffectiveKinds: ControlledDocumentKind[];
  decisionBoundary: string;
}

export interface RegisterControlledDocumentInput {
  documentId: string;
  kind: ControlledDocumentKind;
  documentNumber: string;
  revisionLabel: string;
  applicability: string;
  basis: string;
  reviewDueAt?: string | null;
  assetId?: string | null;
  siteId?: string | null;
  standardWorkId?: number | null;
  governanceStandardId?: string | null;
  evidenceItemId?: string | null;
  inspectionPlanId?: number | null;
  supersedesDocumentId?: string | null;
}

export async function listControlledDocumentCandidates(): Promise<
  ControlledDocumentCandidate[]
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
  return (data ?? []) as ControlledDocumentCandidate[];
}

export async function getControlledDocumentRegister() {
  return callRpc<ControlledDocumentRegister>(
    "get_controlled_technical_document_register",
  );
}

export async function registerControlledDocument(
  input: RegisterControlledDocumentInput,
) {
  return callRpc<{
    documentId: string;
    controlStatus: "under_review";
    documentNumber: string;
    revisionLabel: string;
    engineeringAuthority: false;
    operationalAuthorization: false;
  }>("register_controlled_technical_document", {
    p_document_id: input.documentId,
    p_record: {
      kind: input.kind,
      documentNumber: input.documentNumber.trim(),
      revisionLabel: input.revisionLabel.trim(),
      applicability: input.applicability.trim(),
      basis: input.basis.trim(),
      reviewDueAt: input.reviewDueAt || null,
      assetId: input.assetId?.trim() || null,
      siteId: input.siteId?.trim() || null,
      standardWorkId: input.standardWorkId ?? null,
      governanceStandardId: input.governanceStandardId?.trim() || null,
      evidenceItemId: input.evidenceItemId?.trim() || null,
      inspectionPlanId: input.inspectionPlanId ?? null,
      supersedesDocumentId: input.supersedesDocumentId?.trim() || null,
    },
  });
}

export async function reviewControlledDocument(input: {
  documentId: string;
  decision: "effective" | "rejected";
  basis: string;
}) {
  return callRpc<{
    documentId: string;
    controlStatus: "effective" | "rejected";
    supersededDocumentId: string | null;
    segregationOfDuties: true;
    engineeringAuthority: false;
    operationalAuthorization: false;
  }>("review_controlled_technical_document", {
    p_document_id: input.documentId,
    p_decision: input.decision,
    p_basis: input.basis.trim(),
  });
}
