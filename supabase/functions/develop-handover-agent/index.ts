// develop-handover-agent — D12.15 / spec §65.
//
// This deterministic workflow assembles a DRAFT through the one canonical
// HandoverPackage RPC, then reads its governed readiness result. It uses the
// caller's JWT throughout: tenant scope, role, named owners and evidence are
// enforced in the database. There is deliberately no acceptance RPC here.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

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

function bearer(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

interface RequestBody {
  case_id?: string;
  system_id?: number;
  owner_from?: string;
  owner_to?: string;
  required_acceptance_date?: string;
  basis?: string;
  evidence_item_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !ANON_KEY)
    return json({ error: "function is not configured" }, 500);

  const token = bearer(req);
  if (!token) return json({ error: "authentication required" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user)
    return json({ error: "authentication required" }, 401);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "");
  const systemId = Number(body.system_id);
  if (!caseId || !Number.isInteger(systemId) || systemId <= 0)
    return json({ error: "case_id and a valid system_id are required" }, 400);

  // Resolve membership through the tenant-scoped canonical case composition.
  // A caller cannot use this agent to assemble a package for an unreturned
  // system, even if they guess its numeric identifier.
  const { data: caseData, error: caseError } = await caller.rpc(
    "get_case_system_handover_packages",
    { p_case_id: caseId },
  );
  if (caseError) return json({ error: caseError.message }, 400);
  const caseModel = caseData as {
    error?: string;
    systems?: Array<{ systemId: number; package?: { status?: string } | null }>;
  };
  if (caseModel?.error) return json({ error: caseModel.error }, 404);
  const system = caseModel?.systems?.find((item) => item.systemId === systemId);
  if (!system) return json({ error: "commissioning system not found" }, 404);
  if (system.package?.status === "accepted")
    return json({ error: "the accepted handover package is immutable" }, 409);

  const { data: draftData, error: draftError } = await caller.rpc(
    "assemble_system_handover_package",
    {
      p_system_id: systemId,
      p_owner_from: String(body.owner_from ?? ""),
      p_owner_to: String(body.owner_to ?? ""),
      p_required_acceptance_date: String(
        body.required_acceptance_date ?? "",
      ),
      p_basis: String(body.basis ?? ""),
      p_evidence_item_id: String(body.evidence_item_id ?? ""),
    },
  );
  if (draftError) return json({ error: draftError.message }, 400);
  const draft = draftData as {
    error?: string;
    packageId?: number;
    systemId?: number;
    version?: number;
    status?: string;
    residualRiskCount?: number;
    decisionBoundary?: string;
  };
  if (draft?.error) return json({ error: draft.error }, 400);

  const { data: readinessData, error: readinessError } = await caller.rpc(
    "get_system_handover_readiness",
    { p_system_id: systemId, p_package_id: draft.packageId },
  );
  if (readinessError) return json({ error: readinessError.message }, 400);

  return json({
    advisory: true,
    caseId,
    draft,
    readiness: readinessData,
    evidenceRefs: [
      `commissioning_systems:${systemId}`,
      `system_handover_packages:${draft.packageId}`,
      `evidence_items:${String(body.evidence_item_id ?? "")}`,
    ],
    disclaimer:
      "The Handover Agent assembled an evidence-linked draft only. It cannot accept operations ownership or change commissioning state; only the named receiving owner may do that separately.",
  });
});
