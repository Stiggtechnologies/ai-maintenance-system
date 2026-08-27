import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildIntakeChunks,
  KB_DOCUMENT_CLASSES,
  KB_INTAKE_ROLES,
  suggestDocumentClass,
  validateIntakeInput,
} from "../_shared/kb-intake-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":
    Deno.env.get("ALLOWED_ORIGIN") || "https://app.syncai.ca",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

/** Decode a UTF-8 text file payload (plain text, csv, markdown, json). */
function decodeTextFile(base64: string, filename: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.trim().length < 20) {
    throw new Error(
      `"${filename}" contains no readable text. Binary or scanned files are not supported yet — the OCR lane is not wired (C2.15 v1).`,
    );
  }
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method not allowed", 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("not authenticated", 401);
  }

  // Role gate: KB writes are reliability/admin-only.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !(KB_INTAKE_ROLES as readonly string[]).includes(profile.role)) {
    return errorResponse("kb intake requires the admin or reliability_engineer role", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }

  const sourceId = String(body.source_id ?? "").trim();
  const title = String(body.title ?? "").trim();
  const documentClass = String(body.document_class ?? "").trim() || "unclassified";
  const documentType = body.document_type ? String(body.document_type) : null;
  const pageStart = body.page_start != null ? Number(body.page_start) : null;
  const pageEnd = body.page_end != null ? Number(body.page_end) : null;

  let content = "";
  if (typeof body.content === "string" && body.content.trim().length > 0) {
    content = body.content;
  } else if (typeof body.file_base64 === "string" && typeof body.filename === "string") {
    const filename = String(body.filename).toLowerCase();
    if (/\.(pdf)$/.test(filename)) {
      return errorResponse(
        "PDF intake is not wired yet — text-extractable and scanned PDFs arrive with the OCR lane (C2.15 v1 ships text/csv/markdown/paste).",
        400,
      );
    }
    content = decodeTextFile(String(body.file_base64), filename);
  }

  const suggested = suggestDocumentClass(title || sourceId);
  const effectiveClass = documentClass === "unclassified" ? suggested : documentClass;
  if (!(KB_DOCUMENT_CLASSES as readonly string[]).includes(effectiveClass)) {
    return errorResponse(
      `document_class must be one of: ${KB_DOCUMENT_CLASSES.join(", ")}`,
      400,
    );
  }

  const validation = validateIntakeInput({ source_id: sourceId, title, document_class: effectiveClass, content });
  if (!validation.ok) {
    return errorResponse(validation.errors.join("; "), 400);
  }

  const chunks = buildIntakeChunks(content, pageStart, pageEnd);
  if (chunks.length === 0) {
    return errorResponse("content produced no chunks (min 50 characters per chunk)", 400);
  }

  const { data, error } = await supabase.rpc("kb_ingest_document", {
    p_source_id: sourceId,
    p_title: title,
    p_document_class: effectiveClass,
    p_document_type: documentType,
    p_original_filename: body.filename ? String(body.filename) : null,
    p_page_count: pageEnd != null && pageStart != null ? Math.max(1, pageEnd - pageStart + 1) : null,
    p_chunks: chunks.map((c) => ({
      chunk_index: c.chunk_index,
      content: c.content,
      page_start: c.page_start,
      page_end: c.page_end,
    })),
  });

  if (error) {
    return errorResponse(`intake failed: ${error.message}`, 500);
  }
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    return errorResponse(String((data as Record<string, unknown>).error), 400);
  }

  return jsonResponse({
    source_id: sourceId,
    document_class: effectiveClass,
    chunks_created: chunks.length,
    status: "indexed",
  });
});
