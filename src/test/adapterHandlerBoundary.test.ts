// @vitest-environment node
// Execute the actual Edge entrypoints with only synthetic Auth/RPC/source I/O.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as credentials from "../../supabase/functions/_shared/adapter-credentials";
import * as responseCore from "../../supabase/functions/_shared/adapter-response";
import * as p6 from "../../supabase/functions/_shared/p6-schedule-read";
import * as inventory from "../../supabase/functions/_shared/sap-s4-inventory-read";
import * as financial from "../../supabase/functions/_shared/sap-s4-financial-read";
import * as adls from "../../supabase/functions/_shared/adls-data-lake";
const org = "00000000-0000-4000-8000-000000000001";
const binding = "vault://synthetic/adapter";
const token = "SYNTHETIC-ONLY-NOT-A-CREDENTIAL-".repeat(2);
const shared = {
  organization_id: org,
  enabled: true,
  direction: "read_only",
  write_enabled: false,
  credential_binding_ref: binding,
};
const cases = [
  {
    name: "p6-schedule-read-pull",
    env: "P6_READ",
    host: "p6.example.com",
    core: p6,
    module: "p6-schedule-read",
    source: {
      ...shared,
      base_url: "https://p6.example.com/p6ws/restapi",
      project_object_id: 4101,
      max_activities: 50,
      max_relationships: 100,
      duration_to_hours: 1,
      development_case_id: org,
      schedule_name: "Synthetic",
    },
  },
  {
    name: "sap-s4-inventory-read-pull",
    env: "SAP_S4_INVENTORY_READ",
    host: "sap.example.com",
    core: inventory,
    module: "sap-s4-inventory-read",
    source: {
      ...shared,
      service_root: "https://sap.example.com/API_MATERIAL_STOCK_SRV",
      plant: "1000",
      storage_location: "0001",
      site_id: org,
      max_rows: 100,
      page_size: 50,
      max_pages: 3,
    },
  },
  {
    name: "sap-s4-financial-read-pull",
    env: "SAP_S4_FINANCIAL_READ",
    host: "sap.example.com",
    core: financial,
    module: "sap-s4-financial-read",
    source: {
      ...shared,
      service_root: "https://sap.example.com/API_GLACCOUNTLINEITEM_SRV",
      ledger: "0L",
      company_code: "CA01",
      currency: "CAD",
      posting_date_from: "2026-01-01",
      development_case_id: org,
      cost_mappings: [
        {
          wbsElementInternalId: "WB01",
          glAccount: "0041000000",
          costItemRef: "CIVIL",
        },
      ],
      max_rows: 100,
      page_size: 50,
      max_pages: 3,
      contract_hash: "a".repeat(64),
    },
  },
  {
    name: "data-lake-read-pull",
    env: "RECOVERY_CONNECTOR",
    host: "syntheticlake.dfs.core.windows.net",
    core: adls,
    module: "adls-data-lake",
    source: {
      ...shared,
      filesystem_url: "https://syntheticlake.dfs.core.windows.net/landing",
      object_prefix: "assets/",
      object_format: "json",
      max_files: 10,
      max_bytes: 1048576,
      contract_hash: "a".repeat(32),
      last_cursor: null,
      column_mapping: { external_id: "id", name: "name" },
      value_mappings: {},
      constants: {},
    },
  },
];
type Case = (typeof cases)[number];
function harness(
  c: Case,
  entryChange = {},
  sourceChange = {},
  rpcError = false,
  enabled = true,
) {
  let handler!: (request: Request) => Promise<Response>;
  const logs: string[] = [];
  const source = { ...c.source, ...sourceChange };
  const rpc = vi.fn(async (name: string) => {
    if (rpcError)
      return { data: null, error: { message: token, code: "ERROR" } };
    if (name.startsWith("get_")) return { data: source, error: null };
    if (name === "preview_recovery_activation_batch")
      return {
        data: { read: 1, accepted: 1, duplicate: 0, rejected: 0, results: [] },
        error: null,
      };
    throw new Error("Unexpected write RPC in dry-run test");
  });
  const fetch = vi.fn<
    (input: string | URL, init?: RequestInit) => Promise<Response>
  >(async () => {
    throw new Error("Synthetic source not configured");
  });
  const registry = {
    [binding]: {
      type:
        c.name === "data-lake-read-pull"
          ? "azure_service_principal"
          : "oauth_bearer",
      organization_id: org,
      host: c.host,
      access_token: token,
      expires_at: "2099-01-01T00:00:00Z",
      tenant_id: org,
      client_id: org,
      client_secret: token,
      ...entryChange,
    },
  };
  const env: Record<string, string> = {
    [`${c.name === "data-lake-read-pull" ? "ADLS_READ" : c.env}_ENABLED`]:
      String(enabled),
    SUPABASE_URL: "https://synthetic.invalid",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    [`${c.env}_ALLOWED_HOSTS`]: c.host,
    [`${c.env}_CREDENTIALS_JSON`]: JSON.stringify(registry),
  };
  const code = ts.transpileModule(
    readFileSync(`supabase/functions/${c.name}/index.ts`, "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(code, {
    exports: {},
    Deno: {
      env: { get: (key: string) => env[key] },
      serve: (fn: typeof handler) => {
        handler = fn;
      },
    },
    require: (name: string) => {
      if (name.startsWith("npm:"))
        return {
          createClient: () => ({
            rpc,
            auth: {
              getUser: async () => ({
                data: { user: { id: org } },
                error: null,
              }),
            },
          }),
        };
      if (name.includes("adapter-credentials")) return credentials;
      if (name.includes("adapter-response")) return responseCore;
      if (name === `../_shared/${c.module}.ts`) return c.core;
      throw new Error("Unexpected test dependency");
    },
    fetch,
    Response,
    Request,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortSignal,
    Uint8Array,
    crypto: webcrypto,
    atob,
    Error,
    console: { log: (text: string) => logs.push(text) },
  });
  const request = (
    body: unknown = {
      connector_key: "synthetic",
      entity_type: "asset",
      dry_run: true,
    },
  ) =>
    new Request("https://edge.invalid", {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { handler, request, fetch, rpc, logs };
}
describe.each(cases)("$name actual handler boundaries", (c) => {
  it.each([
    { organization_id: "00000000-0000-4000-8000-000000000002" },
    { host: "other.example.com" },
    { organization_id: undefined },
    { host: undefined },
  ])("refuses binding before source I/O %j", async (change) => {
    const h = harness(c, change);
    const response = await h.handler(h.request());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(
      true,
    );
    expect((await response.text()) + h.logs.join()).not.toContain(token);
  });
  it("requires authentication before any source discovery", async () => {
    const h = harness(c);
    expect(
      (await h.handler(new Request("https://edge.invalid", { method: "POST" })))
        .status,
    ).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("refuses write-enabled source before transport", async () => {
    const h = harness(c, {}, { write_enabled: true });
    expect((await h.handler(h.request())).status).toBeGreaterThanOrEqual(400);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { connector_key: "synthetic", entity_type: "asset", dry_run: "false" },
  ])("refuses malformed requests %j", async (body) => {
    const h = harness(c);
    expect((await h.handler(h.request(body))).status).toBe(400);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("does not expose raw database errors", async () => {
    const h = harness(c, {}, {}, true);
    const response = await h.handler(h.request());
    expect((await response.text()) + h.logs.join()).not.toContain(token);
  });
});

it.each(cases)(
  "$name defaults disabled before Auth or source access",
  async (c) => {
    const h = harness(c, {}, {}, false, false);
    expect((await h.handler(h.request())).status).toBe(503);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  },
);
it.each(cases)("$name independently blocks committed pulls", async (c) => {
  const h = harness(c);
  expect(
    (
      await h.handler(
        h.request({
          connector_key: "synthetic",
          entity_type: "asset",
          dry_run: false,
        }),
      )
    ).status,
  ).toBe(403);
  expect(h.rpc).not.toHaveBeenCalled();
  expect(h.fetch).not.toHaveBeenCalled();
});
const jsonResponse = (value: unknown, headers = {}) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", ...headers },
  });
it.each(cases)(
  "$name completes synthetic dry run without writes",
  async (c) => {
    const h = harness(c);
    const object = JSON.stringify([{ id: "A-1", name: "Synthetic asset" }]);
    h.fetch.mockImplementation(async (input, init) => {
      const url = new URL(input);
      expect(init?.redirect).toBe("error");
      if (url.hostname === "login.microsoftonline.com") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ access_token: token, expires_in: 3600 });
      }
      expect(url.hostname).toBe(c.host);
      expect(init?.method).toBe("GET");
      if (c.name === "p6-schedule-read-pull")
        return jsonResponse(
          url.pathname.endsWith("/activity")
            ? [
                {
                  ObjectId: 101,
                  Id: "A-1",
                  Name: "Synthetic",
                  ProjectObjectId: 4101,
                  PlannedDuration: 1,
                  PlannedStartDate: "2026-10-12T08:00:00Z",
                  PlannedFinishDate: "2026-10-12T09:00:00Z",
                  CalendarName: "Synthetic calendar",
                  TotalFloat: 0,
                  PrimaryConstraintType: "None",
                },
              ]
            : [],
        );
      if (c.name === "sap-s4-inventory-read-pull")
        return jsonResponse({
          d: {
            results: [
              {
                Material: "MAT-1",
                Plant: "1000",
                StorageLocation: "0001",
                InventoryStockType: "01",
                InventorySpecialStockType: "",
                MaterialBaseUnit: "EA",
                MatlWrhsStkQtyInMatlBaseUnit: "2",
              },
            ],
          },
        });
      if (c.name === "sap-s4-financial-read-pull")
        return jsonResponse({
          d: {
            results: [
              {
                Ledger: "0L",
                CompanyCode: "CA01",
                WBSElementInternalID: "WB01",
                GLAccount: "0041000000",
                PostingDate: "2026-10-01",
                CompanyCodeCurrency: "CAD",
                AmountInCompanyCodeCurrency: "125.50",
              },
            ],
          },
        });
      if (url.searchParams.has("resource"))
        return jsonResponse({
          paths: [
            {
              name: "assets/a.json",
              contentLength: String(new TextEncoder().encode(object).length),
              lastModified: "Mon, 12 Oct 2026 00:00:00 GMT",
              etag: '"synthetic"',
            },
          ],
        });
      return new Response(object, { headers: { etag: '"synthetic"' } });
    });
    const response = await h.handler(h.request());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ dry_run: true });
    expect(
      h.rpc.mock.calls.every(
        ([name]) =>
          name.startsWith("get_") ||
          name === "preview_recovery_activation_batch",
      ),
    ).toBe(true);
    expect(h.fetch).toHaveBeenCalled();
  },
);
