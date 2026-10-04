import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (typeof body?.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export type DiagramRunStatus =
  | "queued"
  | "extracting"
  | "awaiting_graph"
  | "extracted"
  | "failed"
  | "superseded";

export interface DiagramRun {
  id: string;
  document_id: string;
  source_object_path: string;
  input_sha256: string;
  provider_commit_sha: string;
  schema_version: string;
  status: DiagramRunStatus;
  node_count: number;
  edge_count: number;
  error_detail: string | null;
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
}

export interface DiagramNode {
  id: string;
  run_id: string;
  external_id: string;
  node_kind: string;
  symbol_class: string;
  label: string | null;
  tag: string | null;
  bbox: { topX: number; topY: number; bottomX: number; bottomY: number };
  confidence: number;
}

export interface DiagramEdge {
  id: string;
  run_id: string;
  source_node_id: string;
  target_node_id: string;
  flow_direction: "downstream" | "upstream" | "unknown";
  relation_kind: string;
  confidence: number;
}

export interface DiagramMapping {
  id: string;
  run_id: string;
  node_id: string;
  asset_id: string;
  status: "proposed" | "accepted" | "rejected";
  proposal_basis: string;
  proposed_by: string;
  reviewed_by: string | null;
  review_basis: string | null;
}

export interface DiagramAsset {
  id: string;
  tag: string | null;
  name: string;
  asset_class: string | null;
}

export interface EffectiveDiagramDocument {
  id: string;
  title: string;
  document_number: string;
  revision_label: string;
  controlled_kind: "pid" | "drawing";
}

export interface DiagramWorkspace {
  documents: EffectiveDiagramDocument[];
  runs: DiagramRun[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  mappings: DiagramMapping[];
  assets: DiagramAsset[];
}

export async function getEngineeringDiagramWorkspace(): Promise<DiagramWorkspace> {
  const [documents, runs, nodes, edges, mappings, assets] = await Promise.all([
    supabase
      .from("kb_intake_documents")
      .select("id,title,document_number,revision_label,controlled_kind")
      .in("controlled_kind", ["pid", "drawing"])
      .eq("status", "indexed")
      .eq("control_status", "effective")
      .in("security_status", ["cleared", "released"])
      .order("document_number"),
    supabase
      .from("engineering_diagram_runs")
      .select(
        "id,document_id,source_object_path,input_sha256,provider_commit_sha,schema_version,status,node_count,edge_count,error_detail,requested_by,requested_at,completed_at",
      )
      .order("requested_at", { ascending: false }),
    supabase
      .from("engineering_diagram_nodes")
      .select(
        "id,run_id,external_id,node_kind,symbol_class,label,tag,bbox,confidence",
      )
      .order("external_id"),
    supabase
      .from("engineering_diagram_edges")
      .select(
        "id,run_id,source_node_id,target_node_id,flow_direction,relation_kind,confidence",
      )
      .order("created_at"),
    supabase
      .from("engineering_diagram_asset_mappings")
      .select(
        "id,run_id,node_id,asset_id,status,proposal_basis,proposed_by,reviewed_by,review_basis",
      )
      .order("proposed_at", { ascending: false }),
    supabase.from("assets").select("id,tag,name,asset_class").order("name"),
  ]);
  for (const result of [documents, runs, nodes, edges, mappings, assets]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    documents: (documents.data ?? []) as EffectiveDiagramDocument[],
    runs: (runs.data ?? []) as DiagramRun[],
    nodes: (nodes.data ?? []) as unknown as DiagramNode[],
    edges: (edges.data ?? []) as DiagramEdge[],
    mappings: (mappings.data ?? []) as DiagramMapping[],
    assets: (assets.data ?? []) as DiagramAsset[],
  };
}

export async function uploadAndCreateEngineeringDiagramRun(input: {
  documentId: string;
  file: File;
}): Promise<{ runId: string; status: DiagramRunStatus }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.file.type))
    throw new Error(
      "Select a PNG, JPEG or WebP rendering of one controlled drawing sheet.",
    );
  if (input.file.size < 1 || input.file.size > 25 * 1024 * 1024)
    throw new Error(
      "The controlled diagram image must be between 1 byte and 25 MB.",
    );
  const digest = await sha256(input.file);
  const prepared = await rpc<{
    bucket: "engineering-diagrams";
    objectPath: string;
  }>("prepare_engineering_diagram_upload", {
    p_document_id: input.documentId,
    p_filename: input.file.name,
    p_mime_type: input.file.type,
    p_size_bytes: input.file.size,
    p_input_sha256: digest,
  });
  const { error } = await supabase.storage
    .from("engineering-diagrams")
    .upload(prepared.objectPath, input.file, {
      contentType: input.file.type,
      upsert: false,
    });
  if (error && !/already exists|duplicate|resource exists/i.test(error.message))
    throw new Error(error.message);
  return rpc<{ runId: string; status: DiagramRunStatus }>(
    "create_engineering_diagram_run",
    {
      p_document_id: input.documentId,
      p_object_path: prepared.objectPath,
      p_input_sha256: digest,
      p_idempotency_key: `${input.documentId}:${digest}`,
    },
  );
}

export async function dispatchEngineeringDiagramRun(
  runId: string,
  action: "start" | "poll",
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke(
    "engineering-diagram-inference",
    { body: { run_id: runId, action } },
  );
  if (error) throw new Error(error.message);
  const body = data as Record<string, unknown> | null;
  if (typeof body?.error === "string") throw new Error(body.error);
  return body ?? {};
}

export async function proposeDiagramAssetMapping(input: {
  nodeId: string;
  assetId: string;
  basis: string;
}) {
  return rpc<{ mappingId: string; status: "proposed" }>(
    "propose_engineering_diagram_asset_mapping",
    {
      p_node_id: input.nodeId,
      p_asset_id: input.assetId,
      p_basis: input.basis.trim(),
    },
  );
}

export async function reviewDiagramAssetMapping(input: {
  mappingId: string;
  decision: "accepted" | "rejected";
  basis: string;
}) {
  return rpc<{ mappingId: string; status: "accepted" | "rejected" }>(
    "review_engineering_diagram_asset_mapping",
    {
      p_mapping_id: input.mappingId,
      p_decision: input.decision,
      p_basis: input.basis.trim(),
    },
  );
}

export async function publishDiagramDependencyCandidates(input: {
  runId: string;
  candidates: Array<{
    edgeId: string;
    dependentAssetId: string;
    supplierAssetId: string;
    dependencyKind:
      | "functional"
      | "utility"
      | "topological"
      | "control"
      | "geographic"
      | "logistical";
    basis: string;
  }>;
}) {
  return rpc<{ published: number; destination: "dependency_candidates" }>(
    "publish_engineering_diagram_dependency_candidates",
    { p_run_id: input.runId, p_candidates: input.candidates },
  );
}
