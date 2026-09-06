// engineering-model-supply-chain — the only production boundary for importing,
// independently verifying and executing engineering model packs. Authoring-tool
// output is data, never executable code; every runtime is explicitly allowlisted.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assessModelApplicability,
  validatePhysicsModelPack,
} from "../../../src/lib/engineering-models/validation.ts";
import {
  evaluateShaftResonance,
  type ShaftResonanceInput,
} from "../../../src/lib/engineering-models/resonance.ts";
import type {
  ModelEvaluationContext,
  ModelRefusal,
  PhysicsModelPackManifest,
  VerificationCheckDefinition,
  VerificationResultInput,
} from "../../../src/lib/engineering-models/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INGEST_ROLES = new Set(["admin", "reliability_engineer"]);
const EXECUTE_ROLES = new Set([
  "admin",
  "reliability_engineer",
  "maintenance_manager",
]);

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

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function positiveInput(context: ModelEvaluationContext, key: string): number {
  const value = context.inputs[key]?.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be finite and greater than zero`);
  }
  return value;
}

function hasEvaluationContextShape(
  value: unknown,
): value is ModelEvaluationContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  if (
    typeof context.assetFamily !== "string" ||
    typeof context.componentCategory !== "string" ||
    typeof context.operatingState !== "string" ||
    !Array.isArray(context.activeConditionCodes) ||
    !context.activeConditionCodes.every((code) => typeof code === "string") ||
    !context.inputs ||
    typeof context.inputs !== "object" ||
    Array.isArray(context.inputs)
  )
    return false;
  return Object.values(context.inputs).every(
    (input) => input && typeof input === "object" && !Array.isArray(input),
  );
}

function runResonanceEvaluator(
  context: ModelEvaluationContext,
): ReturnType<typeof evaluateShaftResonance> {
  const tolerance = context.inputs.match_tolerance_pct;
  const input: ShaftResonanceInput = {
    rpm: positiveInput(context, "rpm"),
    forcingOrder: positiveInput(context, "forcing_order"),
    dominantPeakHz: positiveInput(context, "dominant_peak_hz"),
    modalMassKg: positiveInput(context, "modal_mass_kg"),
    modalStiffnessNPerM: positiveInput(context, "modal_stiffness_n_m"),
    approvedMatchTolerancePct: positiveInput(context, "match_tolerance_pct"),
    toleranceSourceReference: tolerance?.sourceReference,
  };
  return evaluateShaftResonance(input);
}

function verifyResonance(
  checks: VerificationCheckDefinition[],
): VerificationResultInput[] {
  const reference = evaluateShaftResonance({
    rpm: 60,
    forcingOrder: 1,
    dominantPeakHz: 1,
    modalMassKg: 1,
    modalStiffnessNPerM: 4 * Math.PI * Math.PI,
    approvedMatchTolerancePct: 0.1,
    toleranceSourceReference: "pinned-independent-reference",
  });
  const limiting = evaluateShaftResonance({
    rpm: 1e-12,
    forcingOrder: 1,
    dominantPeakHz: 1e-12 / 60,
    modalMassKg: 1,
    modalStiffnessNPerM: 4 * Math.PI * Math.PI,
    approvedMatchTolerancePct: 0.1,
    toleranceSourceReference: "pinned-independent-limiting-reference",
  });
  let adversarialRefused = false;
  try {
    evaluateShaftResonance({
      rpm: 0,
      forcingOrder: 1,
      dominantPeakHz: 1,
      modalMassKg: 1,
      modalStiffnessNPerM: 1,
    });
  } catch {
    adversarialRefused = true;
  }
  const verdict: Record<string, boolean> = {
    dimensional: checks.every(
      (check) => check.kind !== "dimensional" || check.expectedResult === "Hz",
    ),
    limiting_case:
      limiting.shaftFrequencyHz > 0 && limiting.shaftFrequencyHz < 1e-12,
    benchmark: Math.abs(reference.shaftFrequencyHz - 1) <= 1e-12,
    numerical_stability: Object.values(reference)
      .filter((value) => typeof value === "number")
      .every(Number.isFinite),
    regression:
      reference.conclusion === "screen_supports_resonance_hypothesis" &&
      reference.refusals.length === 0,
    adversarial: adversarialRefused,
  };
  return checks
    .filter((check) => check.disposition === "required")
    .map((check) => ({
      checkId: check.id,
      passed: verdict[check.kind] === true,
      runReference: `engineering-model-supply-chain@1.0.0:${check.id}`,
    }));
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
    .select("organization_id,role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id)
    return json({ error: "organization_membership_required" }, 403);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      return json({ error: "request_too_large" }, 413);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const action = body.action;
  if (!["ingest", "verify", "execute"].includes(String(action)))
    return json({ error: "unsupported_action" }, 400);

  if (action === "ingest") {
    if (!INGEST_ROLES.has(profile.role))
      return json(
        { error: "engineering_model_ingestion_authority_denied" },
        403,
      );
    if (
      !body.manifest ||
      typeof body.manifest !== "object" ||
      Array.isArray(body.manifest)
    )
      return json({ error: "manifest_object_required" }, 400);
    const manifest = body.manifest as unknown as PhysicsModelPackManifest;
    let issues;
    try {
      issues = validatePhysicsModelPack(manifest);
    } catch {
      return json({ error: "invalid_manifest_shape" }, 400);
    }
    if (issues.length > 0)
      return json({ error: "manifest_validation_failed", issues }, 422);
    const checksum = await sha256(manifest);
    const { data, error } = await service.rpc("ingest_engineering_model_pack", {
      p_organization_id: profile.organization_id,
      p_actor_id: userData.user.id,
      p_manifest: manifest,
      p_manifest_checksum: checksum,
    });
    if (error) return json({ error: error.message }, 422);
    const persisted = data as { error?: string } | null;
    if (persisted?.error) return json({ error: persisted.error }, 422);
    return json({ persisted, manifestChecksum: checksum }, 201);
  }

  const modelRegisterId = body.modelRegisterId;
  if (!Number.isSafeInteger(modelRegisterId) || Number(modelRegisterId) <= 0)
    return json({ error: "valid_model_register_id_required" }, 400);
  const { data: model, error: modelError } = await service
    .from("model_register")
    .select("id,organization_id,model_key,version,calculation_key,manifest")
    .eq("id", modelRegisterId)
    .eq("organization_id", profile.organization_id)
    .eq("is_engineering_model", true)
    .maybeSingle();
  if (modelError || !model)
    return json({ error: "engineering_model_not_found" }, 404);
  const manifest = model.manifest as unknown as PhysicsModelPackManifest;
  try {
    if (validatePhysicsModelPack(manifest).length > 0)
      return json({ error: "registered_manifest_invalid" }, 422);
  } catch {
    return json({ error: "registered_manifest_invalid" }, 422);
  }
  if (
    model.calculation_key !== "pof_shaft_resonance_screening" ||
    model.model_key !== "pof.shaft-resonance.screening"
  ) {
    return json({ error: "calculation_key_not_allowlisted" }, 422);
  }

  if (action === "verify") {
    if (!INGEST_ROLES.has(profile.role))
      return json(
        { error: "engineering_model_verification_authority_denied" },
        403,
      );
    const results = verifyResonance(manifest.verification.checks);
    const refusals = results
      .filter((result) => !result.passed)
      .map((result) => ({
        code: "verification_check_failed",
        path: result.checkId,
        message: `Independent verification check ${result.checkId} failed.`,
      }));
    const { data, error } = await service.rpc(
      "record_engineering_model_verification",
      {
        p_organization_id: profile.organization_id,
        p_actor_id: userData.user.id,
        p_model_register_id: modelRegisterId,
        p_results: results,
        p_environment: {
          runtime: "Supabase Edge/Deno",
          evaluator: `${model.model_key}@${model.version}`,
          networkUsed: false,
        },
        p_refusals: refusals,
      },
    );
    if (error) return json({ error: error.message }, 422);
    return json(
      { verification: data, results },
      (data as { passed?: boolean } | null)?.passed ? 200 : 422,
    );
  }

  if (!EXECUTE_ROLES.has(profile.role))
    return json({ error: "engineering_model_execution_authority_denied" }, 403);
  if (typeof body.assetId !== "string" || !UUID.test(body.assetId))
    return json({ error: "valid_asset_id_required" }, 400);
  if (
    body.recommendationId != null &&
    (typeof body.recommendationId !== "string" ||
      !UUID.test(body.recommendationId))
  )
    return json({ error: "invalid_recommendation_id" }, 400);
  if (
    body.configurationBaselineId != null &&
    (!Number.isSafeInteger(body.configurationBaselineId) ||
      Number(body.configurationBaselineId) <= 0)
  )
    return json({ error: "invalid_configuration_baseline_id" }, 400);
  if (!hasEvaluationContextShape(body.context))
    return json({ error: "model_context_required" }, 400);
  const context = body.context;
  if (
    String(context.configurationBaselineId ?? "") !==
    String(body.configurationBaselineId ?? "")
  ) {
    return json({ error: "configuration_baseline_context_mismatch" }, 400);
  }
  const assessment = assessModelApplicability(manifest, context);
  let refusals: ModelRefusal[] = [...assessment.refusals];
  let outputs: ReturnType<typeof evaluateShaftResonance> | null = null;
  if (refusals.length === 0) {
    try {
      outputs = runResonanceEvaluator(context);
      refusals = [...outputs.refusals];
    } catch (error) {
      refusals.push({
        code: "deterministic_evaluation_refused",
        message:
          error instanceof Error
            ? error.message
            : "The evaluator refused the supplied inputs.",
      });
    }
  }
  const evidenceBindings = Object.entries(context.inputs ?? {})
    .filter(([, input]) => Boolean(input.evidenceItemId))
    .map(([inputCode, input]) => ({
      inputCode,
      evidenceItemId: input.evidenceItemId,
      sourceReference: input.sourceReference,
      evidenceGrade: input.evidenceGrade,
    }));
  const { data, error } = await service.rpc("record_engineering_model_run", {
    p_organization_id: profile.organization_id,
    p_actor_id: userData.user.id,
    p_model_register_id: modelRegisterId,
    p_asset_id: body.assetId,
    p_recommendation_id: body.recommendationId ?? null,
    p_configuration_baseline_id: body.configurationBaselineId ?? null,
    p_input_envelope: { context, evidenceBindings },
    p_outputs: outputs,
    p_refusals: refusals,
    p_execution_environment: {
      runtime: "Supabase Edge/Deno",
      evaluator: `${model.model_key}@${model.version}`,
      networkUsed: false,
    },
  });
  if (error) return json({ error: error.message }, 422);
  const persisted = data as { error?: string; status?: string } | null;
  if (persisted?.error) return json({ error: persisted.error }, 422);
  return json(
    { result: persisted },
    persisted?.status === "computed" ? 200 : 422,
  );
});
