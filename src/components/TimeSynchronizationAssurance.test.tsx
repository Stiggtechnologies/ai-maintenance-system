import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeSynchronizationAssurance } from "./TimeSynchronizationAssurance";

const status = vi.fn();
const configure = vi.fn();
let role = "admin";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../services/timeSynchronization", () => ({
  timeSynchronizationActions: {
    status: (...args: unknown[]) => status(...args),
    configure: (...args: unknown[]) => configure(...args),
  },
}));

const workspace = {
  generatedAt: "2026-10-03T12:00:00Z",
  operationalAuthority: false as const,
  setsSourceClocks: false as const,
  connectors: [
    {
      connectorId: "11111111-1111-4111-8111-111111111111",
      connectorKey: "site-a-opcua",
      name: "Site A OPC UA",
      enabled: true,
      protocol: "ptp" as const,
      referenceAuthority: "Site A grandmaster",
      toleranceMs: 20,
      maxObservationAgeMinutes: 15,
      configurationRevision: 2,
      configurationEvidenceReference: "ENG-TIME-004",
      configuredAt: "2026-10-03T11:00:00Z",
      state: "synchronized" as const,
      eligibleForTimeSensitiveEvidence: false,
      reason: "Worst-case offset is within the tenant-approved tolerance.",
      observationId: "22222222-2222-4222-8222-222222222222",
      sourceClockAt: "2026-10-03T11:59:59.010Z",
      referenceClockAt: "2026-10-03T11:59:59.000Z",
      receivedAt: "2026-10-03T12:00:00Z",
      offsetMs: 10,
      measurementUncertaintyMs: 2,
      worstCaseOffsetMs: 12,
      observationEvidenceReference: "AIO-PTP-OBS-0001",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  role = "admin";
  status.mockResolvedValue(workspace);
  configure.mockResolvedValue({
    ok: true,
    note: "Clock contract recorded. A current service observation is still required.",
  });
});

describe("TimeSynchronizationAssurance", () => {
  it("does not invent a clock tolerance or freshness interval for the customer", async () => {
    render(<TimeSynchronizationAssurance />);
    await screen.findAllByText("Site A OPC UA");
    expect(screen.getByLabelText(/Recorded tolerance/i)).toHaveValue(null);
    expect(screen.getByLabelText(/Maximum observation age/i)).toHaveValue(null);
    expect(
      screen.getByRole("button", { name: "Save clock contract" }),
    ).toBeDisabled();
    expect(configure).not.toHaveBeenCalled();
  });

  it("shows evidence eligibility without claiming clock control", async () => {
    render(<TimeSynchronizationAssurance />);
    expect(
      (await screen.findAllByText("Site A OPC UA"))[0],
    ).toBeInTheDocument();
    expect(screen.getByText("synchronized")).toBeInTheDocument();
    expect(screen.getByText("12 ms / 20 ms")).toBeInTheDocument();
    expect(screen.getByText(/does not set plant clocks/i)).toBeInTheDocument();
    expect(
      screen.getByText(/an opaque evidence reference is not verified/i),
    ).toBeInTheDocument();
  });

  it("lets a named human administrator record a complete clock contract", async () => {
    render(<TimeSynchronizationAssurance />);
    await screen.findAllByText("Site A OPC UA");
    fireEvent.change(screen.getByLabelText("Time-assurance connector"), {
      target: { value: workspace.connectors[0].connectorId },
    });
    fireEvent.change(screen.getByPlaceholderText(/Authoritative source/i), {
      target: { value: "Site A PTP grandmaster" },
    });
    fireEvent.change(screen.getByLabelText(/Recorded tolerance/i), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText(/Maximum observation age/i), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Evidence reference/i), {
      target: { value: "ENG-TIME-STD-004" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Clock authority/i), {
      target: {
        value:
          "Engineering standard establishes the site clock, tolerance, and freshness limit.",
      },
    });
    fireEvent.click(screen.getByText("Save clock contract"));
    await waitFor(() =>
      expect(configure).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId: workspace.connectors[0].connectorId,
          protocol: "ntp",
          toleranceMs: 25,
          maxObservationAgeMinutes: 10,
        }),
      ),
    );
    expect(
      await screen.findByText(/current service observation is still required/i),
    ).toBeInTheDocument();
  });

  it("keeps clock-policy writes away from non-administrators", async () => {
    role = "reliability_engineer";
    render(<TimeSynchronizationAssurance />);
    await screen.findAllByText("Site A OPC UA");
    expect(screen.queryByText("Save clock contract")).not.toBeInTheDocument();
    expect(
      screen.getByText(/named human administrator must configure/i),
    ).toBeInTheDocument();
  });
});
