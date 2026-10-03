// Governed adapter for the Azure P&ID digitization service.
//
// start: upload the immutable controlled image to symbol detection, pass its
// output to text detection, then submit asynchronous graph construction.
// poll: read job status and persist bounded nodes/edges into SyncAI. The
// upstream graph-persistence endpoint is deliberately never called: only the
// canonical SyncAI dependency-candidate review may affect the asset graph.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BASE_URL_RAW = Deno.env.get("AZURE_PID_DIGITIZATION_BASE_URL") ?? "";
const API_KEY = Deno.env.get("AZURE_PID_DIGITIZATION_API_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_BYTES = 10 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function configuredBaseUrl(): URL {
  if (!BASE_URL_RAW) {
    throw new Error(
      "Diagram inference is not configured: AZURE_PID_DIGITIZATION_BASE_URL is empty.",
    );
  }
  const url = new URL(BASE_URL_RAW);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "AZURE_PID_DIGITIZATION_BASE_URL must be a credential-free HTTPS origin/path.",
    );
  }
  return url;
}

function providerUrl(path: string): URL {
  const base = configuredBaseUrl();
  const normalized = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;
  base.pathname = `${normalized}${path.replace(/^\//, "")}`;
  return base;
}

function providerHeaders(jsonBody = false): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (jsonBody) headers.set("Content-Type", "application/json");
  if (API_KEY) headers.set("x-api-key", API_KEY);
  return headers;
}

async function providerFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(providerUrl(path), {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`Provider HTTP ${response.status}: ${detail}`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PROVIDER_BYTES)
      throw new Error("Provider response exceeds 10 MB.");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_BYTES)
      throw new Error("Provider response exceeds 10 MB.");
    return text ? (JSON.parse(text) as unknown) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is not a JSON object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} is missing or exceeds ${max} entries.`);
  return value;
}

function bbox(value: unknown): Record<string, number> {
  const item = record(value, "bounding box");
  const result = {
    topX: Number(item.topX),
    topY: Number(item.topY),
    bottomX: Number(item.bottomX),
    bottomY: Number(item.bottomY),
  };
  if (
    Object.values(result).some(
      (part) => !Number.isFinite(part) || part < 0 || part > 1,
    ) ||
    result.topX >= result.bottomX ||
    result.topY >= result.bottomY
  )
    throw new Error("Provider returned invalid normalized geometry.");
  return result;
}

function nodeKind(label: string): string {
  const lower = label.toLowerCase();
  if (lower.startsWith("equipment/")) return "equipment";
  if (lower.startsWith("instrumentation/")) return "instrument";
  if (lower.includes("valve")) return "valve";
  if (lower.startsWith("piping/endpoint")) return "connector";
  if (lower.startsWith("piping/")) return "piping";
  return "unknown";
}

type ProviderNode = {
  id: string | number;
  label: string;
  text_associated?: string | null;
  bounding_box: unknown;
  connections?: unknown[];
};

function normalizeGraph(
  symbolPayload: unknown,
  graphPayload: unknown,
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const symbols = record(symbolPayload, "symbol response");
  const scores = new Map<string, number>();
  for (const value of array(symbols.label, "symbol labels", 5_000)) {
    const item = record(value, "symbol label");
    const id = String(item.id ?? "");
    const score = Number(item.score);
    if (!id || !Number.isFinite(score) || score < 0 || score > 1)
      throw new Error("Provider symbol response has an invalid id or score.");
    scores.set(id, score);
  }

  const graph = record(graphPayload, "graph response");
  const connected = array(graph.connected_symbols, "connected symbols", 5_000);
  const byId = new Map<string, ProviderNode>();
  for (const value of connected) {
    const source = record(value, "connected symbol") as ProviderNode;
    byId.set(String(source.id), source);
    for (const nested of array(source.connections ?? [], "connections", 500)) {
      const target = record(nested, "connected symbol target") as ProviderNode;
      byId.set(String(target.id), target);
    }
  }

  const nodes = [...byId.entries()].map(([id, item]) => {
    const confidence = scores.get(id);
    if (confidence == null)
      throw new Error(`Graph node ${id} has no symbol-detection confidence.`);
    const label = String(item.label ?? "").trim();
    if (!label) throw new Error(`Graph node ${id} has no symbol class.`);
    return {
      externalId: id,
      pageNumber: 1,
      nodeKind: nodeKind(label),
      symbolClass: label,
      label,
      tag:
        typeof item.text_associated === "string" && item.text_associated.trim()
          ? item.text_associated.trim().slice(0, 500)
          : null,
      bbox: bbox(item.bounding_box),
      confidence,
      providerPayload: { providerNodeId: id },
    };
  });

  const edges = new Map<string, Record<string, unknown>>();
  for (const value of connected) {
    const source = record(value, "connected symbol") as ProviderNode;
    const sourceId = String(source.id);
    for (const nested of array(source.connections ?? [], "connections", 500)) {
      const target = record(nested, "connected symbol target");
      const targetId = String(target.id ?? "");
      const flow = String(target.flow_direction ?? "unknown");
      if (!targetId || !["downstream", "upstream", "unknown"].includes(flow))
        throw new Error("Provider graph returned an invalid connection.");
      const key = `${sourceId}->${targetId}:${flow}`;
      if (edges.has(key)) continue;
      const sourceScore = scores.get(sourceId);
      const targetScore = scores.get(targetId);
      if (sourceScore == null || targetScore == null)
        throw new Error(`Graph edge ${key} has an unscored endpoint.`);
      const segments = array(
        target.segments ?? [],
        "connection segments",
        200,
      ).map(bbox);
      edges.set(key, {
        externalId: key,
        sourceExternalId: sourceId,
        targetExternalId: targetId,
        flowDirection: flow,
        relationKind: "process_connection",
        confidence: Math.min(sourceScore, targetScore),
        segments,
        providerPayload: { reportedFlowDirection: flow },
      });
    }
  }
  return { nodes, edges: [...edges.values()] };
}

async function rpc<T>(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as { error?: unknown } | null;
  if (typeof body?.error === "string") throw new Error(body.error);
  return data as T;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let input: { run_id?: unknown; action?: unknown };
  try {
    input = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const runId = typeof input.run_id === "string" ? input.run_id : "";
  const action =
    input.action === "poll" ? "poll" : input.action === "start" ? "start" : "";
  if (!/^[0-9a-f-]{36}$/i.test(runId) || !action)
    return json({ error: "run_id and action=start|poll are required" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  try {
    await rpc(userClient, "authorize_engineering_diagram_dispatch", {
      p_run_id: runId,
      p_action: action,
    });
  } catch (caught) {
    const detail =
      caught instanceof Error
        ? caught.message
        : "Diagram dispatch is not authorized.";
    return json({ error: detail, runId, operationalAuthorization: false }, 403);
  }
  // A caller-supplied run id must never gain service-role mutation authority.
  // Only a run that passed tenant authorization and was claimed by this worker
  // may be transitioned to failed in the catch path below.
  let claimedRun = false;
  try {
    configuredBaseUrl();
    const run = await rpc<{
      runId: string;
      objectPath: string;
      mimeType: string;
      inputSha256: string;
      providerPidId: string;
      status: string;
    }>(service, "claim_engineering_diagram_run", { p_run_id: runId });
    claimedRun = true;

    if (action === "start") {
      const { data: file, error } = await service.storage
        .from("engineering-diagrams")
        .download(run.objectPath);
      if (error || !file)
        throw new Error("Controlled diagram object could not be downloaded.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if ((await sha256(bytes)) !== run.inputSha256)
        throw new Error(
          "Controlled diagram bytes no longer match their registered checksum.",
        );
      const form = new FormData();
      form.set(
        "bounding_box_inclusive_str",
        JSON.stringify({ topX: 0, topY: 0, bottomX: 1, bottomY: 1 }),
      );
      form.set("file", new Blob([bytes], { type: run.mimeType }), "diagram");
      const symbol = await providerFetch(
        `/api/pid-digitization/symbol-detection/${encodeURIComponent(run.providerPidId)}`,
        { method: "POST", headers: providerHeaders(false), body: form },
      );
      const textDetection = await providerFetch(
        `/api/pid-digitization/text-detection/${encodeURIComponent(run.providerPidId)}`,
        {
          method: "POST",
          headers: providerHeaders(true),
          body: JSON.stringify(symbol),
        },
      );
      const graphRequest = {
        ...record(textDetection, "text response"),
        hough_threshold: null,
        hough_min_line_length: null,
        hough_max_line_gap: null,
        hough_rho: null,
        hough_theta: null,
        thinning_enabled: null,
        propagation_pass_exhaustive_search: false,
      };
      await providerFetch(
        `/api/pid-digitization/graph-construction/${encodeURIComponent(run.providerPidId)}`,
        {
          method: "POST",
          headers: providerHeaders(true),
          body: JSON.stringify(graphRequest),
        },
      );
      await rpc(service, "mark_engineering_diagram_graph_submitted", {
        p_run_id: runId,
        p_provider_job_id: run.providerPidId,
        p_manifest: {
          symbolResponseSha256: await sha256(JSON.stringify(symbol)),
          textResponseSha256: await sha256(JSON.stringify(textDetection)),
          submittedAt: new Date().toISOString(),
        },
      });
      return json(
        { runId, status: "awaiting_graph", operationalAuthorization: false },
        202,
      );
    }

    if (run.status === "extracted" || run.status === "failed")
      return json({
        runId,
        status: run.status,
        operationalAuthorization: false,
      });
    const job = record(
      await providerFetch(
        `/api/pid-digitization/graph-construction/${encodeURIComponent(run.providerPidId)}/status`,
        { method: "GET", headers: providerHeaders(false) },
      ),
      "job status",
    );
    const providerStatus = String(job.status ?? "");
    if (providerStatus === "failure")
      throw new Error(
        `Provider graph construction failed: ${String(job.message ?? "no detail")}`,
      );
    if (providerStatus !== "done")
      return json({ runId, status: "awaiting_graph", providerStatus }, 202);

    const [symbol, graph] = await Promise.all([
      providerFetch(
        `/api/pid-digitization/symbol-detection/${encodeURIComponent(run.providerPidId)}`,
        { method: "GET", headers: providerHeaders(false) },
      ),
      providerFetch(
        `/api/pid-digitization/graph-construction/${encodeURIComponent(run.providerPidId)}`,
        { method: "GET", headers: providerHeaders(false) },
      ),
    ]);
    const normalized = normalizeGraph(symbol, graph);
    const rawResult = JSON.stringify(graph);
    const result = await rpc<Record<string, unknown>>(
      service,
      "record_engineering_diagram_inference",
      {
        p_run_id: runId,
        p_raw_result_sha256: await sha256(rawResult),
        p_nodes: normalized.nodes,
        p_edges: normalized.edges,
        p_manifest: {
          providerStatus,
          jobStep: job.step ?? null,
          providerUpdatedAt: job.updated_at ?? null,
          imageDetails: record(graph, "graph response").image_details ?? null,
          normalizedAt: new Date().toISOString(),
        },
      },
    );
    return json(result);
  } catch (caught) {
    const detail =
      caught instanceof Error ? caught.message : "Diagram inference failed.";
    if (claimedRun) {
      await service.rpc("fail_engineering_diagram_run", {
        p_run_id: runId,
        p_error_code:
          action === "start" ? "provider_start_failed" : "provider_poll_failed",
        p_error_detail: detail,
      });
    }
    return json({ error: detail, runId, operationalAuthorization: false }, 502);
  }
});
