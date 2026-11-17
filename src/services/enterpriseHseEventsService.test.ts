import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  getEnterpriseHseWorkspace,
  recordHseEvent,
  recordHseReportingSource,
  verifyHseEvent,
} from "./enterpriseHseEventsService";

beforeEach(() => vi.clearAllMocks());

describe("enterpriseHseEventsService", () => {
  it("loads the bounded tenant workspace", async () => {
    rpc.mockResolvedValue({ data: { requiredAal: "aal2" }, error: null });
    const result = await getEnterpriseHseWorkspace(30);
    expect(result.requiredAal).toBe("aal2");
    expect(rpc).toHaveBeenCalledWith("get_enterprise_hse_workspace", {
      p_window_days: 30,
    });
  });

  it("records a human classification without inventing authority", async () => {
    rpc.mockResolvedValue({
      data: {
        id: "event-1",
        eventRef: "HSE-001",
        version: 1,
        incidentClosed: false,
        complianceCertified: false,
        riskAccepted: false,
        workAuthorized: false,
        returnToServiceAuthorized: false,
      },
      error: null,
    });
    const result = await recordHseEvent({
      eventRef: " HSE-001 ",
      expectedVersion: 0,
      status: "active",
      domain: "occupational_safety",
      eventType: "unsafe_condition",
      actuality: "actual",
      occurredAt: "2026-10-01T12:00:00Z",
      recordability: "pending_determination",
      regulatoryReportability: "not_applicable",
      description:
        "Observed coupling guard condition during the documented field inspection.",
      sourceReference: "HSE-LOG-001",
      basis:
        "Named human classification from the controlled field observation record.",
    });
    expect(rpc).toHaveBeenCalledWith("record_hse_event", {
      p_event: expect.objectContaining({
        eventRef: "HSE-001",
        assetId: null,
        containmentLossId: null,
      }),
    });
    expect(result.incidentClosed).toBe(false);
    expect(result.workAuthorized).toBe(false);
  });

  it("attests a manual source without claiming an external connector", async () => {
    rpc.mockResolvedValue({
      data: {
        id: "source-1",
        sourceRef: "HSE-SOURCE",
        version: 1,
        incidentClosed: false,
        complianceCertified: false,
        riskAccepted: false,
        workAuthorized: false,
        returnToServiceAuthorized: false,
      },
      error: null,
    });
    await recordHseReportingSource({
      sourceRef: "HSE-SOURCE",
      expectedVersion: 0,
      domain: "environmental",
      scope: "enterprise",
      sourceName: "Controlled HSE register",
      sourceKind: "manual_register",
      connectorId: "must-be-removed",
      status: "active",
      coverageStart: "2026-01-01T00:00:00Z",
      sourceReference: "HSE-REGISTER-2026",
      evidenceItemId: "evidence-1",
      basis: "Independent reconciliation confirms complete reporting coverage.",
    });
    expect(rpc).toHaveBeenCalledWith("record_hse_reporting_source", {
      p_source: expect.objectContaining({
        scope: "enterprise",
        siteId: null,
        connectorId: null,
        coverageEnd: null,
      }),
    });
  });

  it("requires complete independent-verification inputs before the RPC", () => {
    expect(() => verifyHseEvent("event-1", "", "too short")).toThrow(
      /Event and evidence/i,
    );
    expect(() =>
      recordHseReportingSource({
        sourceRef: "HSE-SOURCE",
        expectedVersion: 0,
        domain: "environmental",
        scope: "site",
        sourceName: "Controlled HSE register",
        sourceKind: "external_system",
        status: "active",
        coverageStart: "2026-01-01T00:00:00Z",
        sourceReference: "HSE-REGISTER-2026",
        evidenceItemId: "evidence-1",
        basis:
          "Independent reconciliation confirms complete reporting coverage.",
      }),
    ).toThrow(/site is required/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces fail-closed database refusal envelopes", async () => {
    rpc.mockResolvedValue({
      data: { error: "AAL2 session is required" },
      error: null,
    });
    await expect(
      verifyHseEvent(
        "event-1",
        "evidence-1",
        "Independent review confirms the governed event classification.",
      ),
    ).rejects.toThrow(/AAL2/i);
  });
});
