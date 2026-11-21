// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  edgeBaseEnv,
  edgeRequest,
  installNoNetworkFetch,
  loadEdgeFunction,
  readJson,
  type LoadedEdgeFunction,
} from "../support/edgeFunctionHarness";
import { createSupabaseDouble, eqValue, type QueryCall, type SupabaseDouble } from "../support/supabaseQueryMock";

const derived = {
  code: "mining",
  parent_template_code: "master-os",
  template_type: "derived",
  overlay_config: { industry_note: "mining" },
  template_config: {},
};

const master = {
  code: "master-os",
  template_type: "master",
  template_config: {
    governance: {
      auto_approve_confidence_min: 0.9,
      escalation_levels: ["supervisor", "engineer"],
      require_approval_cost_threshold_cad: 1000,
    },
  },
};

function templates(call: QueryCall) {
  if (!call.asSingle) return { data: [], error: null };
  const type = eqValue(call, "template_type");
  const code = eqValue(call, "code");
  if (type === "derived" && code === "mining") return { data: derived, error: null };
  if (type === "master") return { data: master, error: null };
  if (code === "mining") return { data: { id: "tpl-1" }, error: null };
  if (code === "missing") return { data: null, error: { message: "not found" } };
  return { data: null, error: { message: "not found" } };
}

describe("template-resolver edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/template-resolver/index.ts", { ...edgeBaseEnv });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble((call) => {
      if (call.table === "deployment_templates") return templates(call);
      if (call.table === "template_overrides" && call.op === "select") return { data: [], error: null };
      if (call.table === "template_overrides" && call.op === "insert") {
        return { data: { id: "ov-1", ...(call.payload as object) }, error: null };
      }
      if (call.table === "deployment_instances" && call.op === "insert") {
        return { data: { id: "dep-1", ...(call.payload as object) }, error: null };
      }
      return { data: null, error: null };
    });
    edge.createClient = supabase.createClient;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, authorization = "Bearer user-jwt") {
    return edge.invoke(
      edgeRequest("template-resolver", "", {
        body,
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
  }

  it("answers CORS preflight and rejects a missing Authorization header", async () => {
    expect((await edge.invoke(edgeRequest("template-resolver", "", { method: "OPTIONS" }))).status).toBe(200);
    const response = await post({ action: "list_templates" }, "");
    expect(response.status).toBe(401);
    expect(supabase.clients).toHaveLength(0);
  });

  it("rejects an unknown action and a non-JSON body", async () => {
    expect((await post({ action: "publish" })).status).toBe(400);
    const invalid = await edge.invoke(
      edgeRequest("template-resolver", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: "{",
      }),
    );
    expect(invalid.status).toBe(500);
    expect((await readJson(invalid)).error).toBe("Internal server error");
  });

  it("lists no derived templates when the catalogue is empty", async () => {
    const response = await post({ action: "list_templates" });
    expect(await readJson(response)).toEqual({ templates: [] });
  });

  it("requires a template code and returns 404 when the template is absent", async () => {
    const missing = await post({ action: "get_template_detail", data: {} });
    expect(missing.status).toBe(400);
    const absent = await post({ action: "get_template_detail", data: { template_code: "missing" } });
    expect(absent.status).toBe(404);
  });

  it("keeps governance stricter when an override tries to loosen it", async () => {
    supabase.setFrom((call) => {
      if (call.table === "deployment_templates") return templates(call);
      if (call.table === "template_overrides") {
        return {
          data: [{
            id: "ov-loose",
            site_id: null,
            override_type: "governance_profile",
            override_payload: {
              auto_approve_confidence_min: 0.1,
              escalation_levels: ["supervisor"],
              require_approval_cost_threshold_cad: 50000,
            },
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const response = await post({
      action: "resolve_template",
      data: { template_code: "mining", organization_id: "org-1" },
    });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.resolved_config.governance_profile).toMatchObject({
      auto_approve_confidence_min: 0.9,
      escalation_levels: ["supervisor", "engineer"],
      require_approval_cost_threshold_cad: 1000,
    });
    expect(body.resolved_config.industry_note).toBe("mining");
    expect(body.warnings.join(" ")).toMatch(/cannot be loosened/);
    expect(body.warnings).toHaveLength(3);
  });

  it("applies a governance override that only tightens the profile", async () => {
    supabase.setFrom((call) => {
      if (call.table === "deployment_templates") return templates(call);
      if (call.table === "template_overrides") {
        return {
          data: [{
            id: "ov-tight",
            site_id: null,
            override_type: "governance_profile",
            override_payload: {
              auto_approve_confidence_min: 0.95,
              escalation_levels: ["supervisor", "engineer", "director"],
              require_approval_cost_threshold_cad: 100,
            },
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const response = await post({
      action: "resolve_template",
      data: { template_code: "mining", organization_id: "org-1" },
    });
    const body = await readJson(response);
    expect(body.warnings).toEqual([]);
    expect(body.resolved_config.governance_profile).toMatchObject({
      auto_approve_confidence_min: 0.95,
      require_approval_cost_threshold_cad: 100,
    });
    expect(body.resolved_config.governance_profile.escalation_levels).toHaveLength(3);
  });

  it("rejects an override that is missing fields or uses an unknown type", async () => {
    expect((await post({ action: "save_override", data: { template_code: "mining" } })).status).toBe(400);
    const response = await post({
      action: "save_override",
      data: {
        organization_id: "org-1",
        template_code: "mining",
        override_type: "unapproved_limit",
        override_payload: { value: 1 },
      },
    });
    expect(response.status).toBe(400);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("saves a valid override", async () => {
    const response = await post({
      action: "save_override",
      data: {
        organization_id: "org-1",
        template_code: "mining",
        override_type: "deployment_defaults",
        override_payload: { timezone: "America/Edmonton" },
      },
    });
    expect(response.status).toBe(201);
    expect(supabase.calls.find((call) => call.op === "insert")?.payload).toMatchObject({
      organization_id: "org-1",
      override_type: "deployment_defaults",
    });
  });

  it("creates a deployment draft and does not activate it", async () => {
    const response = await post({
      action: "create_deployment_draft",
      data: {
        organization_id: "org-1",
        site_id: "site-1",
        template_code: "mining",
        deployment_name: "Site A",
      },
    });
    const body = await readJson(response);
    expect(response.status).toBe(201);
    expect(body.deployment_instance.status).toBe("draft");
    expect(body.deployment_instance.name).toBe("Site A");
    const inserted = supabase.calls.find((call) => call.table === "deployment_instances");
    expect(inserted?.payload).toMatchObject({ status: "draft", deployment_template_id: "tpl-1" });
  });

  it("requires the draft identity fields", async () => {
    const response = await post({
      action: "create_deployment_draft",
      data: { template_code: "mining" },
    });
    expect(response.status).toBe(400);
    expect(supabase.calls.filter((call) => call.table === "deployment_instances")).toHaveLength(0);
  });

  // BUG: supabase/functions/template-resolver/index.ts:494-502 treats any
  // Authorization value as authentication and then uses the service role.
  // Impact: a forged bearer can resolve templates and write draft deployments
  // for any organization id in the body.
  it.fails("BUG: a forged bearer token cannot create a deployment draft", async () => {
    const response = await post(
      {
        action: "create_deployment_draft",
        data: {
          organization_id: "org-victim",
          site_id: "site-1",
          template_code: "mining",
          deployment_name: "Intrusion",
        },
      },
      "Bearer not-a-jwt",
    );
    expect(response.status).toBe(401);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});
