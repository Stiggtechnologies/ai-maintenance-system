import { supabase } from "../lib/supabase";
import type { LineageDraft } from "../lib/data-governance/lineage";

export interface DataLineageEdge {
  id: string;
  domainId: number;
  relationship: "sourced_from" | "derived_from";
  subjectClass: string;
  subjectId: string;
  sourceSystem: string;
  sourceObject: string;
  sourceKey: string;
  transformation: string;
  observedAt: string;
  parentEdgeId: string | null;
  supersedesEdgeId: string | null;
  createdAt: string;
  current: boolean;
}

export interface DataLineageRegister {
  edges: DataLineageEdge[];
  writesSourceSystem: false;
  changesCanonicalValues: false;
  authorizesWork: false;
}

export interface DataLineageChain {
  subjectClass: string;
  subjectId: string;
  subjectPresent: boolean;
  currentEdges: DataLineageEdge[];
  history: Array<Record<string, unknown>>;
  ancestors: Array<Record<string, unknown>>;
  gaps: string[];
  truncated: boolean;
  writesSourceSystem: false;
  changesCanonicalValues: false;
  authorizesWork: false;
}

export interface DataLineageReceipt {
  edgeId: string;
  status: "recorded" | "already_recorded";
  writesSourceSystem: false;
  changesCanonicalValues: false;
  authorizesWork: false;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Data lineage returned an unexpected payload.");
  }
  const body = data as { error?: unknown };
  if (typeof body.error === "string" && body.error.length > 0) {
    throw new Error(body.error);
  }
  return data as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Data lineage response is missing ${label}.`);
  }
  return value;
}

function edgeFromPayload(value: unknown): DataLineageEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Data lineage returned an unexpected edge.");
  }
  const row = value as Record<string, unknown>;
  const relationship = row.relationship;
  if (relationship !== "sourced_from" && relationship !== "derived_from") {
    throw new Error("Data lineage returned an unknown relationship.");
  }
  const domainId = Number(row.domainId);
  if (!Number.isSafeInteger(domainId) || domainId < 1) {
    throw new Error("Data lineage response is missing domain id.");
  }
  return {
    id: requiredText(row.id, "edge id"),
    domainId,
    relationship,
    subjectClass: requiredText(row.subjectClass, "subject class"),
    subjectId: requiredText(row.subjectId, "subject id"),
    sourceSystem: requiredText(row.sourceSystem, "source system"),
    sourceObject: typeof row.sourceObject === "string" ? row.sourceObject : "",
    sourceKey: requiredText(row.sourceKey, "source key"),
    transformation:
      typeof row.transformation === "string" ? row.transformation : "",
    observedAt: typeof row.observedAt === "string" ? row.observedAt : "",
    parentEdgeId:
      typeof row.parentEdgeId === "string" ? row.parentEdgeId : null,
    supersedesEdgeId:
      typeof row.supersedesEdgeId === "string" ? row.supersedesEdgeId : null,
    createdAt: requiredText(row.createdAt, "created at"),
    current: row.current === true,
  };
}

function boundary(value: Record<string, unknown>) {
  if (
    value.writesSourceSystem !== false ||
    value.changesCanonicalValues !== false ||
    value.authorizesWork !== false
  ) {
    throw new Error(
      "Data lineage response claimed an authority it does not have.",
    );
  }
  return {
    writesSourceSystem: false as const,
    changesCanonicalValues: false as const,
    authorizesWork: false as const,
  };
}

function optionalUuid(value: string): string | null {
  const text = value.trim();
  return text === "" ? null : text;
}

export async function loadDataLineageRegister(): Promise<DataLineageRegister> {
  const data = await rpc("get_data_lineage_register", { p_limit: 50 });
  if (!Array.isArray(data.edges)) {
    throw new Error("Data lineage returned an unexpected payload.");
  }
  return {
    edges: data.edges.map(edgeFromPayload),
    ...boundary(data),
  };
}

export async function readDataLineage(
  subjectClass: string,
  subjectId: string,
): Promise<DataLineageChain> {
  const data = await rpc("get_data_lineage", {
    p_subject_class: subjectClass,
    p_subject_id: subjectId,
  });
  if (!Array.isArray(data.currentEdges) || !Array.isArray(data.gaps)) {
    throw new Error("Data lineage returned an unexpected payload.");
  }
  return {
    subjectClass: requiredText(data.subjectClass, "subject class"),
    subjectId: requiredText(data.subjectId, "subject id"),
    subjectPresent: data.subjectPresent === true,
    currentEdges: data.currentEdges.map(edgeFromPayload),
    history: Array.isArray(data.history)
      ? data.history.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
    ancestors: Array.isArray(data.ancestors)
      ? data.ancestors.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
    gaps: data.gaps.filter((item): item is string => typeof item === "string"),
    truncated: data.truncated === true,
    ...boundary(data),
  };
}

export async function recordDataLineageEdge(
  draft: LineageDraft,
): Promise<DataLineageReceipt> {
  const data = await rpc("record_data_lineage_edge", {
    p_domain_id: Number(draft.domainId),
    p_relationship: draft.relationship,
    p_subject_class: draft.subjectClass,
    p_subject_id: draft.subjectId.trim(),
    p_source_system: draft.sourceSystem.trim(),
    p_source_object: draft.sourceObject.trim(),
    p_source_key: draft.sourceKey.trim(),
    p_transformation: draft.transformation.trim(),
    p_observed_at: draft.observedAt.trim(),
    p_basis: draft.basis.trim(),
    p_evidence_reference: draft.evidenceReference.trim(),
    p_parent_edge_id: optionalUuid(draft.parentEdgeId),
    p_supersedes_edge_id: optionalUuid(draft.supersedesEdgeId),
    p_connector_id: optionalUuid(draft.connectorId),
  });
  const status = data.status;
  if (status !== "recorded" && status !== "already_recorded") {
    throw new Error("Data lineage returned an unknown recording status.");
  }
  return {
    edgeId: requiredText(data.edgeId, "edge id"),
    status,
    ...boundary(data),
  };
}
