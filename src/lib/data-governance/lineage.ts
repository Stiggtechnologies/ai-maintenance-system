/**
 * E12.08 data-lineage proposals.
 *
 * The database records a named-human attestation. This module only checks
 * that attestation before it is sent, and it can prefill one proposal from a
 * stock row the existing SAP mapper has already reviewed. It does not call
 * SAP, invent a quantity, or decide that a mapped row is true.
 */

export const LINEAGE_SUBJECT_CLASSES = [
  "asset",
  "sensor",
  "work_order",
  "material_stock",
  "evidence_item",
] as const;

export type LineageSubjectClass = (typeof LINEAGE_SUBJECT_CLASSES)[number];
export type LineageRelationship = "sourced_from" | "derived_from";

export const SAP_MATERIAL_STOCK_SOURCE = "sap_s4_material_stock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const RAW_SAP_KEYS = [
  "Material",
  "Plant",
  "StorageLocation",
  "InventoryStockType",
  "MatlWrhsStkQtyInMatlBaseUnit",
] as const;

export interface LineageDraft {
  domainId: string;
  relationship: LineageRelationship | "";
  subjectClass: LineageSubjectClass | "";
  subjectId: string;
  sourceSystem: string;
  sourceObject: string;
  sourceKey: string;
  transformation: string;
  observedAt: string;
  basis: string;
  evidenceReference: string;
  parentEdgeId: string;
  supersedesEdgeId: string;
  connectorId: string;
}

export type LineageProposal =
  { ok: true; draft: LineageDraft } | { ok: false; reason: string };

function trimmed(value: string): string {
  return value.trim();
}

function uuidOrEmpty(value: string, label: string): string | null {
  const text = trimmed(value);
  if (text === "") return null;
  return UUID.test(text) ? null : `${label} must be a UUID`;
}

export function validateLineageDraft(
  draft: LineageDraft,
  nowIso: string,
): string | null {
  if (!/^[1-9]\d*$/.test(trimmed(draft.domainId))) {
    return "A data domain id is required";
  }
  if (
    draft.relationship !== "sourced_from" &&
    draft.relationship !== "derived_from"
  ) {
    return "Relationship must be sourced from or derived from";
  }
  if (
    !LINEAGE_SUBJECT_CLASSES.includes(draft.subjectClass as LineageSubjectClass)
  ) {
    return "A canonical subject class is required";
  }
  if (!UUID.test(trimmed(draft.subjectId))) {
    return "Canonical subject id must be a UUID";
  }
  const sourceSystem = trimmed(draft.sourceSystem);
  const sourceObject = trimmed(draft.sourceObject);
  const sourceKey = trimmed(draft.sourceKey);
  const transformation = trimmed(draft.transformation);
  const basis = trimmed(draft.basis);
  const evidence = trimmed(draft.evidenceReference);
  if (sourceSystem.length < 2 || sourceSystem.length > 80) {
    return "Source system must be a short explicit name";
  }
  if (sourceObject.length < 2 || sourceObject.length > 120) {
    return "Source object must name the record type in the source system";
  }
  if (sourceKey.length < 1 || sourceKey.length > 240) {
    return "Source key is required";
  }
  if (transformation.length < 12 || transformation.length > 2000) {
    return "Transformation must state how the source became this canonical row";
  }
  if (basis.length < 12 || basis.length > 2000) {
    return "Basis must state why this lineage attestation is justified";
  }
  if (evidence.length < 3 || evidence.length > 240) {
    return "An evidence reference is required";
  }
  if (!ISO_TIME.test(trimmed(draft.observedAt))) {
    return "Observation time must be an explicit ISO-8601 timestamp with a timezone";
  }
  const observed = Date.parse(draft.observedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) {
    return "Observation time must be an explicit ISO-8601 timestamp with a timezone";
  }
  if (observed > now) {
    return "Observation time cannot be in the future";
  }
  const parentError = uuidOrEmpty(draft.parentEdgeId, "Parent edge id");
  if (parentError) return parentError;
  const supersedesError = uuidOrEmpty(
    draft.supersedesEdgeId,
    "Superseded edge id",
  );
  if (supersedesError) return supersedesError;
  const connectorError = uuidOrEmpty(draft.connectorId, "Connector id");
  if (connectorError) return connectorError;
  if (
    draft.relationship === "sourced_from" &&
    trimmed(draft.parentEdgeId) !== ""
  ) {
    return "A sourced-from edge has no parent; record derivation separately";
  }
  if (
    draft.relationship === "derived_from" &&
    trimmed(draft.parentEdgeId) === ""
  ) {
    return "A derived lineage edge must name the parent edge it was derived from";
  }
  if (
    trimmed(draft.parentEdgeId) !== "" &&
    trimmed(draft.parentEdgeId).toLowerCase() ===
      trimmed(draft.supersedesEdgeId).toLowerCase()
  ) {
    return "A lineage edge cannot replace the same edge it cites as its parent";
  }
  return null;
}

function textField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function lineageProposalFromMappedSapStock(input: {
  mapped: unknown;
  materialStockId: string;
  dataDomainId: string;
  basis: string;
  evidenceReference: string;
  connectorId?: string;
  nowIso: string;
}): LineageProposal {
  if (
    !input.mapped ||
    typeof input.mapped !== "object" ||
    Array.isArray(input.mapped)
  ) {
    return {
      ok: false,
      reason: "A reviewed SAP stock mapping must be one JSON object",
    };
  }
  const row = input.mapped as Record<string, unknown>;
  const rawKeys = RAW_SAP_KEYS.filter((key) => key in row);
  if (rawKeys.length > 0) {
    return {
      ok: false,
      reason:
        "A raw SAP payload is not a reviewed mapping. Lineage does not call SAP and does not reinterpret OData fields.",
    };
  }
  const externalId = textField(row, "external_id");
  const materialCode = textField(row, "material_code");
  const unit = textField(row, "unit_of_measure");
  const siteId = textField(row, "site_id");
  const observedAt = textField(row, "observed_at");
  if (!externalId || !materialCode || !unit || !siteId || !observedAt) {
    return {
      ok: false,
      reason:
        "The mapped stock row is missing its identity, unit, site or observation time. Missing quantity or identity is not filled in.",
    };
  }
  if (
    !("qty_on_hand" in row) ||
    typeof row.qty_on_hand !== "number" ||
    !Number.isFinite(row.qty_on_hand)
  ) {
    return {
      ok: false,
      reason:
        "Mapped stock quantity is missing or not a finite number; lineage will not infer zero",
    };
  }
  if (!UUID.test(siteId)) {
    return { ok: false, reason: "Mapped site id must be a UUID" };
  }
  const draft: LineageDraft = {
    domainId: input.dataDomainId,
    relationship: "sourced_from",
    subjectClass: "material_stock",
    subjectId: input.materialStockId,
    sourceSystem: SAP_MATERIAL_STOCK_SOURCE,
    sourceObject: "MaterialStock",
    sourceKey: externalId,
    transformation:
      `Mapped SAP material-stock identity ${externalId} (${materialCode}, ${unit}, ` +
      `mapped qty_on_hand ${row.qty_on_hand}) for site ${siteId} at ${observedAt}. ` +
      "This attests that the named material_stock row was loaded from that reviewed mapping. " +
      "It does not call SAP, change qty_on_hand, or treat a later stock edit as this source observation.",
    observedAt,
    basis: input.basis,
    evidenceReference: input.evidenceReference,
    parentEdgeId: "",
    supersedesEdgeId: "",
    connectorId: input.connectorId ?? "",
  };
  const reason = validateLineageDraft(draft, input.nowIso);
  return reason ? { ok: false, reason } : { ok: true, draft };
}
