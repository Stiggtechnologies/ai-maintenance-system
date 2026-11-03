import { describe, expect, it, vi } from "vitest";
import {
  SAP_WRITE_APPROVAL_ROLES,
  decideSapWrite,
  executeApprovedSapWrite,
  normalizeSapWriteExecuteRequest,
  runSapWriteExecution,
  sapWriteTarget,
  sha256Hex,
  type SapWriteExecutionClaim,
} from "../../supabase/functions/_shared/sap-s4-write";

const root = "https://sap.example.com/sap/opu/odata/sap/API_MAINTNOTIFICATION";
const hosts = ["sap.example.com"];
const payloadJson =
  '{"NotificationText":"Pump seal leak","NotificationType":"M1"}';

function claim(
  overrides: Partial<SapWriteExecutionClaim> = {},
): SapWriteExecutionClaim {
  return {
    callSap: true,
    requestId: "00000000-0000-4000-8000-000000000010",
    statusAtClaim: "approved",
    tenantWriteEnabled: true,
    connectorWriteEnabled: true,
    operation: "maintenance_notification_create",
    serviceRoot: root,
    payloadJson,
    payloadSha256: "",
    idempotencyKey: "idem-key-1",
    ...overrides,
  };
}

function fetchMock(writeStatus = 201) {
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (String(init?.method) === "GET") {
      return new Response("", {
        status: 200,
        headers: {
          "x-csrf-token": "csrf-from-sap",
          "set-cookie": "sap-XSRF_COOKIE=abc; path=/; secure",
        },
      });
    }
    return new Response(
      JSON.stringify({ d: { MaintenanceNotification: "10000001" } }),
      { status: writeStatus, headers: { "content-type": "application/json" } },
    );
  });
  return { fetchImpl, calls };
}

describe("SAP S/4HANA write approval and transport", () => {
  it("uses the human approval roles and blocks a non-approver and the requester", () => {
    expect([...SAP_WRITE_APPROVAL_ROLES]).toEqual([
      "admin",
      "manager",
      "maintenance_manager",
      "plant_manager",
      "operations_manager",
      "reliability_engineer",
    ]);
    expect(
      decideSapWrite({
        role: "technician",
        requesterId: "requester",
        approverId: "approver",
        currentStatus: "pending",
        decision: "approved",
      }),
    ).toEqual({ ok: false, error: "approval_authority_required" });
    expect(
      decideSapWrite({
        role: "ai_admin",
        requesterId: "requester",
        approverId: "approver",
        currentStatus: "pending",
        decision: "approved",
      }).ok,
    ).toBe(false);
    expect(
      decideSapWrite({
        role: "maintenance_manager",
        requesterId: "same-person",
        approverId: "same-person",
        currentStatus: "pending",
        decision: "approved",
      }),
    ).toEqual({
      ok: false,
      error: "the requester cannot approve their own SAP write",
    });
    expect(
      decideSapWrite({
        role: "maintenance_manager",
        requesterId: "requester",
        approverId: "approver",
        currentStatus: "pending",
        decision: "rejected",
      }),
    ).toEqual({ ok: true, status: "rejected" });
  });

  it("does not call SAP for an unapproved request", async () => {
    const { fetchImpl, calls } = fetchMock();
    const pending = await executeApprovedSapWrite({
      claim: claim({ callSap: false, statusAtClaim: "pending" }),
      fetchImpl,
      accessToken: "x".repeat(32),
      allowedHosts: hosts,
    });
    expect(pending.httpCalls).toBe(0);
    expect(pending.mutatingCalls).toBe(0);
    expect(calls).toEqual([]);

    const complete = vi.fn();
    const run = await runSapWriteExecution({
      claim: async () => ({
        call_sap: true,
        status_at_claim: "pending",
        request_id: "00000000-0000-4000-8000-000000000010",
        payload_sha256: "ab".repeat(32),
      }),
      complete,
      fetchImpl,
      accessToken: "x".repeat(32),
      allowedHosts: hosts,
    });
    expect(run.httpCalls).toBe(0);
    expect(run.mutatingCalls).toBe(0);
    expect(calls).toEqual([]);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "request_not_approved",
        succeeded: false,
        mutatingCalls: 0,
      }),
    );
  });

  it("posts only an approved notification and records the audit completion", async () => {
    const payloadSha256 = await sha256Hex(payloadJson);
    const { fetchImpl, calls } = fetchMock();
    const complete = vi.fn();
    const approved = claim({ payloadSha256 });
    const result = await runSapWriteExecution({
      claim: async () => ({
        call_sap: true,
        request_id: approved.requestId,
        status_at_claim: "approved",
        tenant_write_enabled: true,
        connector_write_enabled: true,
        operation: approved.operation,
        service_root: approved.serviceRoot,
        payload_json: payloadJson,
        payload_sha256: payloadSha256,
        idempotency_key: approved.idempotencyKey,
      }),
      complete,
      fetchImpl,
      accessToken: "y".repeat(40),
      allowedHosts: hosts,
    });
    expect(result.sapCalled).toBe(true);
    expect(result.mutatingCalls).toBe(1);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(calls[0].headers["X-CSRF-Token"]).toBe("Fetch");
    expect(calls[1].url).toContain("/MaintenanceNotification");
    expect(calls[1].headers["X-CSRF-Token"]).toBe("csrf-from-sap");
    expect(calls[1].headers.Cookie).toContain("sap-XSRF_COOKIE=abc");
    expect(calls[1].headers.Authorization).toBe(`Bearer ${"y".repeat(40)}`);
    expect(calls[1].body).toBe(payloadJson);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        httpStatus: 201,
        succeeded: true,
        payloadSha256,
        error: null,
        mutatingCalls: 1,
      }),
    );
  });

  it("does not repeat a write when the claim is an idempotent replay", async () => {
    const { fetchImpl, calls } = fetchMock();
    const result = await runSapWriteExecution({
      claim: async () => ({
        call_sap: false,
        idempotent_replay: true,
        status: "executed",
        sap_http_status: 201,
        payload_sha256: "cd".repeat(32),
      }),
      complete: vi.fn(),
      fetchImpl,
      accessToken: "y".repeat(40),
      allowedHosts: hosts,
    });
    expect(result.idempotentReplay).toBe(true);
    expect(result.sapCalled).toBe(false);
    expect(calls).toEqual([]);
  });

  it("stops before the mutating request when CSRF is refused", async () => {
    const payloadSha256 = await sha256Hex(payloadJson);
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 }));
    const result = await executeApprovedSapWrite({
      claim: claim({ payloadSha256 }),
      fetchImpl,
      accessToken: "y".repeat(40),
      allowedHosts: hosts,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.mutatingCalls).toBe(0);
    expect(result.sapCalled).toBe(false);
    expect(result.error).toBe("sap_csrf_fetch_failed");
  });

  it("builds the allowlisted PATCH and release targets and refuses a widened payload", () => {
    const patch = sapWriteTarget(
      root,
      "maintenance_notification_text_update",
      {
        MaintenanceNotification: "10000001",
        NotificationText: "Updated seal note",
      },
      hosts,
    );
    expect(patch.method).toBe("PATCH");
    expect(patch.url.pathname).toContain(
      "/MaintenanceNotification('10000001')",
    );
    expect(patch.body).toBe('{"NotificationText":"Updated seal note"}');

    const release = sapWriteTarget(
      "https://sap.example.com/sap/opu/odata/sap/API_MAINTENANCEORDER;v=2",
      "maintenance_order_release",
      { MaintenanceOrder: "400000123" },
      hosts,
    );
    expect(release.method).toBe("POST");
    expect(release.url.pathname).toContain("/ReleaseMaintenanceOrder");
    expect(release.url.search).toContain("400000123");
    expect(release.body).toBeNull();
    expect(() =>
      sapWriteTarget(
        root,
        "maintenance_notification_create",
        { NotificationType: "M1", NotificationText: "Leak", Priority: "1" },
        hosts,
      ),
    ).toThrow(/allowlisted/i);
    expect(() =>
      normalizeSapWriteExecuteRequest({
        request_id: "00000000-0000-4000-8000-000000000010",
        service_root: "https://evil.example",
      }),
    ).toThrow(/only request_id/);
  });
});
