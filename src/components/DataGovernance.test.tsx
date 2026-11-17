import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataGovernance } from "./DataGovernance";
import type { TimeAssuranceWorkspace } from "../services/timeSynchronization";

const rpc = vi.fn();
const status = vi.fn();
const configure = vi.fn();
let role = "admin";

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    profile: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role,
    },
  }),
}));
vi.mock("./DataStewardAgentWorkbench", () => ({
  DataStewardAgentWorkbench: () => null,
}));
vi.mock("../services/timeSynchronization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/timeSynchronization")>();
  return {
    ...actual,
    timeSynchronizationActions: {
      ...actual.timeSynchronizationActions,
      status: (...args: unknown[]) => status(...args),
      configure: (...args: unknown[]) => configure(...args),
    },
  };
});

// Explicit synthetic component fixtures, not database approval receipts.
const workspace: TimeAssuranceWorkspace = {
  generatedAt: "2026-10-03T12:00:00Z",
  operationalAuthority: false,
  setsSourceClocks: false,
  connectors: [
    {
      connectorId: "11111111-1111-4111-8111-111111111111",
      connectorKey: "synthetic-parent-error-clock",
      name: "Synthetic independent clock",
      enabled: false,
      protocol: null,
      referenceAuthority: null,
      toleranceMs: null,
      maxObservationAgeMinutes: null,
      configurationRevision: 0,
      configurationEvidenceReference: null,
      configuredAt: null,
      state: "unconfigured",
      eligibleForTimeSensitiveEvidence: false,
      withinClockContract: false,
      configurationEvidenceVerified: false,
      reason: "Synthetic disabled source; no approved clock evidence.",
      observationId: null,
      sourceClockAt: null,
      referenceClockAt: null,
      receivedAt: null,
      offsetMs: null,
      measurementUncertaintyMs: null,
      worstCaseOffsetMs: null,
      observationEvidenceReference: null,
    },
  ],
};
type RpcResult = { data: unknown; error: { message: string } | null };
const success = (): RpcResult => ({ data: [], error: null });

beforeEach(() => {
  vi.clearAllMocks();
  role = "admin";
  rpc.mockImplementation(async () => success());
  status.mockResolvedValue(workspace);
  configure.mockRejectedValue(new Error("Synthetic lost acknowledgement"));
});

describe("independent governance and event-time read lifecycles", () => {
  it("starts the real clock read while unrelated governance reads are still pending", async () => {
    rpc.mockImplementation(() => new Promise<RpcResult>(() => {}));
    render(<DataGovernance />);
    expect(
      screen.getByRole("status", { name: "Loading data governance" }),
    ).toBeVisible();
    await screen.findByRole("region", { name: "Event-time assurance" });
    expect(status).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("heading", { name: "Data Governance" }),
    ).toBeNull();
  });

  it.each([
    "get_identity_posture",
    "get_asset_identities",
    "get_sensor_validation",
  ])(
    "keeps clock reachable and governance fail-closed when %s refuses",
    async (endpoint) => {
      rpc.mockImplementation(async (name) =>
        name === endpoint
          ? { data: null, error: { message: `Synthetic ${endpoint} refusal` } }
          : success(),
      );
      render(<DataGovernance />);
      const label = {
        get_identity_posture: "Identity posture unavailable",
        get_asset_identities: "Asset identities unavailable",
        get_sensor_validation: "Sensor validation unavailable",
      }[endpoint];
      await screen.findByText(`${label}: Synthetic ${endpoint} refusal`);
      await screen.findByRole("region", { name: "Event-time assurance" });
      expect(status).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Showing no data rather than stale values."),
      ).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Data Governance" }),
      ).toBeNull();
      expect(
        screen.getByText(/opaque evidence reference is not verified/i),
      ).toBeVisible();
    },
  );

  it("does not remount the clock or discard an unresolved intent during governance retry and recovery", async () => {
    let recovered = false;
    let resolvePosture!: (value: RpcResult) => void;
    rpc.mockImplementation(async (name) => {
      if (name !== "get_identity_posture") return success();
      if (!recovered)
        return {
          data: null,
          error: { message: "Synthetic governance outage" },
        };
      return new Promise<RpcResult>((resolve) => {
        resolvePosture = resolve;
      });
    });
    render(<DataGovernance />);
    await screen.findByText(/Synthetic governance outage/);
    await screen.findByRole("region", { name: "Event-time assurance" });
    fireEvent.change(screen.getByLabelText("Time-assurance connector"), {
      target: { value: workspace.connectors[0].connectorId },
    });
    fireEvent.change(screen.getByPlaceholderText(/Authoritative source/i), {
      target: { value: "Synthetic reference" },
    });
    fireEvent.change(screen.getByLabelText(/Recorded tolerance/i), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText(/Maximum observation age/i), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Evidence reference/i), {
      target: { value: "SYNTHETIC-ONLY" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Clock authority/i), {
      target: {
        value:
          "Synthetic component test basis, not approved engineering authority.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    await screen.findByRole("button", {
      name: "Retry same configuration safely",
    });
    const proposal = configure.mock.calls[0][0];
    expect(Object.isFrozen(proposal)).toBe(true);

    recovered = true;
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
    await screen.findByRole("status", { name: "Loading data governance" });
    expect(
      screen.getByRole("region", { name: "Event-time assurance" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save clock contract" }),
    ).toBeDisabled();
    expect(status).toHaveBeenCalledTimes(1);
    resolvePosture(success());
    await screen.findByRole("heading", { name: "Data Governance" });
    expect(status).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Save clock contract" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry same configuration safely" }),
    );
    await waitFor(() => expect(configure).toHaveBeenCalledTimes(2));
    expect(configure.mock.calls[1][0]).toBe(proposal);
  });

  it("preserves the clock own read failure instead of fabricating clock success", async () => {
    status.mockRejectedValue(new Error("Synthetic clock read refusal"));
    render(<DataGovernance />);
    await screen.findByRole("heading", { name: "Data Governance" });
    await screen.findByText("Synthetic clock read refusal");
    expect(
      screen.queryByRole("region", { name: "Event-time assurance" }),
    ).toBeNull();
    expect(configure).not.toHaveBeenCalled();
  });

  it("does not grant clock configuration to a non-administrator after governance failure", async () => {
    role = "reliability_engineer";
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Synthetic governance outage" },
    });
    render(<DataGovernance />);
    await screen.findByText(/Synthetic governance outage/);
    await screen.findByRole("region", { name: "Event-time assurance" });
    expect(
      screen.queryByRole("button", { name: "Save clock contract" }),
    ).toBeNull();
    expect(configure).not.toHaveBeenCalled();
  });
});
