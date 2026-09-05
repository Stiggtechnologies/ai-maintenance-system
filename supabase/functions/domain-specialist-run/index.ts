// domain-specialist-run — authenticated, deterministic server execution for
// the domain-depth specialist registry. The client submits inputs and evidence
// references; it never submits a trusted result. This function imports the
// exact evaluator exercised by the application test suite, recalculates the
// draft, then asks the tenant-bound database RPC to persist it.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  evaluateDomainSpecialist,
  type DomainSpecialistModuleKey,
  type DomainSpecialistRequest,
} from "../../../src/lib/domain-specialists/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES)
    return json({ error: "request_too_large" }, 413);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: profile, error: profileError } = await service
    .from("user_profiles")
    .select("organization_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id)
    return json({ error: "organization_membership_required" }, 403);

  let body: {
    riskId?: unknown;
    request?: unknown;
    evidenceItemIds?: unknown;
  };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      return json({ error: "request_too_large" }, 413);
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof body.riskId !== "string" || !UUID.test(body.riskId))
    return json({ error: "valid riskId is required" }, 400);
  if (!body.request || typeof body.request !== "object")
    return json({ error: "specialist request is required" }, 400);
  const candidate = body.request as Record<string, unknown>;
  if (
    typeof candidate.moduleKey !== "string" ||
    typeof candidate.methodKey !== "string" ||
    !candidate.inputs ||
    typeof candidate.inputs !== "object" ||
    Array.isArray(candidate.inputs) ||
    !Array.isArray(candidate.evidence)
  ) {
    return json({ error: "invalid specialist request contract" }, 400);
  }
  const evidenceItemIds = Array.isArray(body.evidenceItemIds)
    ? body.evidenceItemIds
    : [];
  if (
    evidenceItemIds.length > 100 ||
    evidenceItemIds.some((id) => typeof id !== "string" || !UUID.test(id))
  ) {
    return json(
      { error: "evidenceItemIds must contain at most 100 UUIDs" },
      400,
    );
  }

  const specialistRequest: DomainSpecialistRequest = {
    moduleKey: candidate.moduleKey as DomainSpecialistModuleKey,
    methodKey: candidate.methodKey,
    inputs: candidate.inputs as Record<string, unknown>,
    evidence: candidate.evidence.filter(
      (item): item is DomainSpecialistRequest["evidence"][number] =>
        Boolean(
          item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).key === "string" &&
          typeof (item as Record<string, unknown>).sourceReference === "string",
        ),
    ),
  };
  const result = evaluateDomainSpecialist(specialistRequest);
  const { data, error } = await service.rpc("record_domain_specialist_run", {
    p_organization_id: profile.organization_id,
    p_actor_id: userData.user.id,
    p_risk_id: body.riskId,
    p_run: {
      moduleKey: result.moduleKey,
      methodKey: result.methodKey,
      modelKey: result.modelKey,
      modelVersion: result.modelVersion,
      status: result.status,
      authoritative: result.authoritative,
      humanApprovalRequired: result.humanApprovalRequired,
      inputs: specialistRequest.inputs,
      result,
    },
    p_evidence_item_ids: evidenceItemIds,
  });
  if (error) return json({ error: error.message }, 422);
  const persisted = data as { error?: string } | null;
  if (persisted?.error) return json({ error: persisted.error, result }, 422);
  return json({ result, persisted }, 200);
});
