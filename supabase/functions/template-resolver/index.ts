import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":
    Deno.env.get("ALLOWED_ORIGIN") || "https://app.syncai.ca",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

/**
 * Deep-merge two objects.
 *  - Scalars: `overlay` wins.
 *  - Arrays: concatenated with unique values (by JSON serialisation).
 *  - Objects: recursively merged.
 */
function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const bVal = base[key];
    const oVal = overlay[key];

    if (Array.isArray(oVal) && Array.isArray(bVal)) {
      const seen = new Set(bVal.map((v) => JSON.stringify(v)));
      result[key] = [...bVal, ...oVal.filter((v) => !seen.has(JSON.stringify(v)))];
    } else if (
      oVal !== null && typeof oVal === "object" && !Array.isArray(oVal) &&
      bVal !== null && typeof bVal === "object" && !Array.isArray(bVal)
    ) {
      result[key] = deepMerge(bVal as Record<string, unknown>, oVal as Record<string, unknown>);
    } else {
      result[key] = oVal;
    }
  }
  return result;
}

/**
 * Governance fields may only be tightened (higher confidence, more approval
 * levels). If a loosening is detected we keep the stricter value and return
 * a warning string.
 */
function applyGovernanceGuard(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): { merged: Record<string, unknown>; warnings: string[] } {
  const merged = { ...base };
  const warnings: string[] = [];

  for (const key of Object.keys(overlay)) {
    const bVal = base[key];
    const oVal = overlay[key];

    if (key === "auto_approve_confidence_min" && typeof oVal === "number" && typeof bVal === "number") {
      if (oVal < bVal) {
        warnings.push(
          `Governance guard: auto_approve_confidence_min cannot be loosened (${bVal} -> ${oVal}). Keeping ${bVal}.`,
        );
      } else {
        merged[key] = oVal;
      }
    } else if (key === "escalation_levels" && Array.isArray(oVal) && Array.isArray(bVal)) {
      if (oVal.length < bVal.length) {
        warnings.push(
          `Governance guard: escalation_levels cannot be reduced (${bVal.length} -> ${oVal.length}). Keeping ${bVal.length} levels.`,
        );
      } else {
        merged[key] = oVal;
      }
    } else if (key === "require_approval_cost_threshold_cad" && typeof oVal === "number" && typeof bVal === "number") {
      // Lower threshold = stricter (requires approval at lower cost)
      if (oVal > bVal) {
        warnings.push(
          `Governance guard: require_approval_cost_threshold_cad cannot be loosened (${bVal} -> ${oVal}). Keeping ${bVal}.`,
        );
      } else {
        merged[key] = oVal;
      }
    } else {
      merged[key] = oVal;
    }
  }

  return { merged, warnings };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleListTemplates(supabase: SupabaseClient): Promise<Response> {
  const { data: templates, error } = await supabase
    .from("deployment_templates")
    .select(`
      id, code, name, industry, description, template_type, is_active,
      parent_template_code, overlay_config, template_config,
      kpi_pack_id, asset_library_id, criticality_profile_id,
      governance_profile_id, work_taxonomy_id, failure_mode_pack_id, oee_model_id,
      created_at, updated_at
    `)
    .eq("template_type", "derived")
    .eq("is_active", true);

  if (error) {
    return errorResponse(error.message, 500);
  }

  // Gather counts for each template's linked packs in parallel
  const summaries = await Promise.all(
    (templates ?? []).map(async (t) => {
      const [kpiCount, assetCount, failureModeCount] = await Promise.all([
        t.kpi_pack_id
          ? supabase
              .from("kpi_pack_items")
              .select("id", { count: "exact", head: true })
              .eq("pack_id", t.kpi_pack_id)
          : Promise.resolve({ count: 0 }),
        t.asset_library_id
          ? supabase
              .from("industry_asset_classes")
              .select("id", { count: "exact", head: true })
              .eq("library_id", t.asset_library_id)
          : Promise.resolve({ count: 0 }),
        t.failure_mode_pack_id
          ? supabase
              .from("industry_failure_modes")
              .select("id", { count: "exact", head: true })
              .eq("pack_id", t.failure_mode_pack_id)
          : Promise.resolve({ count: 0 }),
      ]);

      return {
        id: t.id,
        code: t.code,
        name: t.name,
        industry: t.industry,
        description: t.description,
        parent_template_code: t.parent_template_code,
        kpi_count: kpiCount.count ?? 0,
        asset_class_count: assetCount.count ?? 0,
        failure_mode_count: failureModeCount.count ?? 0,
        created_at: t.created_at,
        updated_at: t.updated_at,
      };
    }),
  );

  return jsonResponse({ templates: summaries });
}

async function handleGetDetail(
  supabase: SupabaseClient,
  data: { template_code: string },
): Promise<Response> {
  if (!data?.template_code) {
    return errorResponse("template_code is required");
  }

  const { data: template, error } = await supabase
    .from("deployment_templates")
    .select("*")
    .eq("code", data.template_code)
    .single();

  if (error || !template) {
    return errorResponse("Template not found", 404);
  }

  // Load all linked packs in parallel
  const [kpiPack, assetLibrary, criticalityProfile, governanceProfile, workTaxonomy, failureModePack, oeeModel] =
    await Promise.all([
      template.kpi_pack_id
        ? supabase.from("kpi_packs").select("*, kpi_pack_items(*)").eq("id", template.kpi_pack_id).single()
        : Promise.resolve({ data: null }),
      template.asset_library_id
        ? supabase
            .from("industry_asset_libraries")
            .select("*, industry_asset_classes(*)")
            .eq("id", template.asset_library_id)
            .single()
        : Promise.resolve({ data: null }),
      template.criticality_profile_id
        ? supabase.from("industry_criticality_profiles").select("*").eq("id", template.criticality_profile_id).single()
        : Promise.resolve({ data: null }),
      template.governance_profile_id
        ? supabase.from("industry_governance_profiles").select("*").eq("id", template.governance_profile_id).single()
        : Promise.resolve({ data: null }),
      template.work_taxonomy_id
        ? supabase
            .from("industry_work_taxonomies")
            .select("*, industry_work_types(*)")
            .eq("id", template.work_taxonomy_id)
            .single()
        : Promise.resolve({ data: null }),
      template.failure_mode_pack_id
        ? supabase
            .from("industry_failure_mode_packs")
            .select("*, industry_failure_modes(*)")
            .eq("id", template.failure_mode_pack_id)
            .single()
        : Promise.resolve({ data: null }),
      template.oee_model_id
        ? supabase.from("industry_oee_models").select("*").eq("id", template.oee_model_id).single()
        : Promise.resolve({ data: null }),
    ]);

  return jsonResponse({
    template: {
      ...template,
      kpi_pack: kpiPack.data,
      asset_library: assetLibrary.data,
      criticality_profile: criticalityProfile.data,
      governance_profile: governanceProfile.data,
      work_taxonomy: workTaxonomy.data,
      failure_mode_pack: failureModePack.data,
      oee_model: oeeModel.data,
    },
  });
}

/**
 * Core resolution: master -> derived -> site overrides -> deployment overrides.
 *
 * Returns the fully merged configuration plus `resolved_from` metadata.
 */
async function resolveTemplate(
  supabase: SupabaseClient,
  data: { template_code: string; organization_id?: string; site_id?: string },
): Promise<{ resolved: Record<string, unknown>; resolved_from: Record<string, unknown>; warnings: string[] }> {
  // 1. Load derived template
  const { data: derived, error: derivedErr } = await supabase
    .from("deployment_templates")
    .select("*")
    .eq("code", data.template_code)
    .eq("template_type", "derived")
    .single();

  if (derivedErr || !derived) {
    throw new Error(`Derived template '${data.template_code}' not found`);
  }

  // 2. Load master template via parent_template_code
  let masterConfig: Record<string, unknown> = {};
  let masterCode: string | null = null;

  if (derived.parent_template_code) {
    const { data: master } = await supabase
      .from("deployment_templates")
      .select("*")
      .eq("code", derived.parent_template_code)
      .eq("template_type", "master")
      .single();

    if (master) {
      masterConfig = (master.template_config as Record<string, unknown>) ?? {};
      masterCode = master.code;
    }
  }

  // 3. Merge: master base + derived overlay
  const derivedOverlay = (derived.overlay_config as Record<string, unknown>) ?? {};
  const derivedConfig = (derived.template_config as Record<string, unknown>) ?? {};

  // Start with master, then apply derived template_config, then overlay_config
  let merged = deepMerge(masterConfig, derivedConfig);
  merged = deepMerge(merged, derivedOverlay);

  const warnings: string[] = [];
  const overrideSources: string[] = [];

  // 4. Load and apply template_overrides for this org/site
  if (data.organization_id) {
    let query = supabase
      .from("template_overrides")
      .select("*")
      .eq("template_code", data.template_code)
      .eq("organization_id", data.organization_id)
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (data.site_id) {
      // Get org-level (site_id IS NULL) and site-level overrides
      query = query.or(`site_id.is.null,site_id.eq.${data.site_id}`);
    } else {
      query = query.is("site_id", null);
    }

    const { data: overrides } = await query;

    if (overrides && overrides.length > 0) {
      // Apply org-level overrides first, then site-level overrides
      const orgOverrides = overrides.filter((o) => !o.site_id);
      const siteOverrides = overrides.filter((o) => o.site_id);

      for (const override of [...orgOverrides, ...siteOverrides]) {
        const payload = override.override_payload as Record<string, unknown>;

        if (override.override_type === "governance_profile") {
          const result = applyGovernanceGuard(
            (merged.governance ?? merged.governance_profile ?? {}) as Record<string, unknown>,
            payload,
          );
          merged.governance_profile = result.merged;
          warnings.push(...result.warnings);
        } else {
          // For array-append keys, use deepMerge; for everything else, overlay
          merged = deepMerge(merged, { [override.override_type]: payload });
        }

        overrideSources.push(
          `${override.override_type}:${override.id}${override.site_id ? " (site)" : " (org)"}`,
        );
      }
    }
  }

  const resolvedFrom = {
    master_template_code: masterCode,
    derived_template_code: data.template_code,
    organization_id: data.organization_id ?? null,
    site_id: data.site_id ?? null,
    override_sources: overrideSources,
    resolved_at: new Date().toISOString(),
  };

  return { resolved: merged, resolved_from: resolvedFrom, warnings };
}

async function handleResolve(
  supabase: SupabaseClient,
  data: { template_code: string; organization_id?: string; site_id?: string },
): Promise<Response> {
  if (!data?.template_code) {
    return errorResponse("template_code is required");
  }

  try {
    const result = await resolveTemplate(supabase, data);
    return jsonResponse({
      resolved_config: result.resolved,
      resolved_from: result.resolved_from,
      warnings: result.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resolution failed";
    return errorResponse(message, 404);
  }
}

async function handleSaveOverride(
  supabase: SupabaseClient,
  data: {
    organization_id: string;
    site_id?: string;
    template_code: string;
    override_type: string;
    override_payload: Record<string, unknown>;
  },
): Promise<Response> {
  if (!data?.organization_id || !data?.template_code || !data?.override_type || !data?.override_payload) {
    return errorResponse("organization_id, template_code, override_type, and override_payload are required");
  }

  const validTypes = [
    "kpi_pack",
    "asset_library",
    "criticality_profile",
    "governance_profile",
    "work_taxonomy",
    "failure_mode_pack",
    "oee_model",
    "deployment_defaults",
  ];

  if (!validTypes.includes(data.override_type)) {
    return errorResponse(`override_type must be one of: ${validTypes.join(", ")}`);
  }

  const record: Record<string, unknown> = {
    organization_id: data.organization_id,
    template_code: data.template_code,
    override_type: data.override_type,
    override_payload: data.override_payload,
  };

  if (data.site_id) {
    record.site_id = data.site_id;
  }

  const { data: override, error } = await supabase
    .from("template_overrides")
    .insert(record)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 500);
  }

  return jsonResponse({ override }, 201);
}

async function handleCreateDraft(
  supabase: SupabaseClient,
  data: {
    organization_id: string;
    site_id: string;
    template_code: string;
    deployment_name: string;
    configuration?: Record<string, unknown>;
  },
): Promise<Response> {
  if (!data?.organization_id || !data?.site_id || !data?.template_code || !data?.deployment_name) {
    return errorResponse("organization_id, site_id, template_code, and deployment_name are required");
  }

  // 1. Resolve the template
  let resolved: Record<string, unknown>;
  let resolvedFrom: Record<string, unknown>;
  let warnings: string[];

  try {
    const result = await resolveTemplate(supabase, {
      template_code: data.template_code,
      organization_id: data.organization_id,
      site_id: data.site_id,
    });
    resolved = result.resolved;
    resolvedFrom = result.resolved_from;
    warnings = result.warnings;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template resolution failed";
    return errorResponse(message, 404);
  }

  // 2. Merge any caller-provided configuration on top
  const finalConfig = data.configuration ? deepMerge(resolved, data.configuration) : resolved;

  // 3. Look up the template id for the FK reference
  const { data: templateRow } = await supabase
    .from("deployment_templates")
    .select("id")
    .eq("code", data.template_code)
    .single();

  // 4. Insert deployment instance
  const { data: instance, error } = await supabase
    .from("deployment_instances")
    .insert({
      organization_id: data.organization_id,
      site_id: data.site_id,
      deployment_template_id: templateRow?.id ?? null,
      name: data.deployment_name,
      status: "draft",
      configuration: {
        ...finalConfig,
        _resolved_from: resolvedFrom,
      },
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 500);
  }

  return jsonResponse({ deployment_instance: instance, warnings }, 201);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Missing authorization", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { action, data } = await req.json();

    switch (action) {
      case "list_templates":
        return handleListTemplates(supabase);
      case "get_template_detail":
        return handleGetDetail(supabase, data);
      case "resolve_template":
        return handleResolve(supabase, data);
      case "save_override":
        return handleSaveOverride(supabase, data);
      case "create_deployment_draft":
        return handleCreateDraft(supabase, data);
      default:
        return errorResponse("Unknown action");
    }
  } catch (_error) {
    return errorResponse("Internal server error", 500);
  }
});
