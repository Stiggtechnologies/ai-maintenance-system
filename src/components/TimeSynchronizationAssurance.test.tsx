import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeSynchronizationAssurance } from "./TimeSynchronizationAssurance";

const status = vi.fn();
const configure = vi.fn();
const evaluateEventTime = vi.fn();
let role = "admin";
let actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let tenantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class TimeAssuranceRefusalError extends Error {
  override name = "TimeAssuranceRefusalError";
}

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    profile: { role, id: actorId, organization_id: tenantId },
  }),
}));

vi.mock("../services/timeSynchronization", () => ({
  get TimeAssuranceRefusalError() {
    return TimeAssuranceRefusalError;
  },
  timeSynchronizationActions: {
    status: (...args: unknown[]) => status(...args),
    configure: (...args: unknown[]) => configure(...args),
    evaluateEventTime: (...args: unknown[]) => evaluateEventTime(...args),
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
      withinClockContract: true,
      configurationEvidenceVerified: false,
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

function qualifiedAcknowledgement(intent: {
  connectorId: string;
  idempotencyKey: string;
}) {
  return {
    ok: true,
    connector_id: intent.connectorId,
    idempotency_key: intent.idempotencyKey,
    audit_id: "44444444-4444-4444-8444-444444444444",
    configuration_revision: 3,
    current_configuration_revision: 3,
    replay: false,
    state: "unproven",
    operational_authority: false,
    configuration_evidence_verified: false,
    eligible_for_time_sensitive_evidence: false,
    note: "Clock contract recorded. A current service observation is still required.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  role = "admin";
  actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  tenantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  status.mockResolvedValue(workspace);
  configure.mockImplementation(async (intent) =>
    qualifiedAcknowledgement(intent),
  );
  evaluateEventTime.mockResolvedValue({
    state: "synchronized",
    within_clock_contract: true,
    configuration_revision: 1,
    tolerance_ms: 20,
    max_observation_age_minutes: 15,
    configuration_audit_id: "receipt-at-event",
    history_integrity: "verified_recorded_chain",
    configuration_evidence_verified: false,
    eligible_for_time_sensitive_evidence: false,
    operational_authority: false,
  });
});

async function fillConfiguration() {
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
}

describe("TimeSynchronizationAssurance", () => {
  it("locks an immutable proposal and retries the same UUID after a lost acknowledgement", async () => {
    configure.mockRejectedValueOnce(
      new Error("Synthetic lost acknowledgement"),
    );
    render(<TimeSynchronizationAssurance />);
    await fillConfiguration();
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    const retry = await screen.findByRole("button", {
      name: "Retry same configuration safely",
    });
    expect(
      screen.getByRole("button", { name: "Save clock contract" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Time-assurance connector")).toBeDisabled();
    expect(screen.getByPlaceholderText(/Authoritative source/i)).toBeDisabled();
    expect(screen.getByLabelText(/Recorded tolerance/i)).toBeDisabled();
    expect(screen.getByLabelText(/Maximum observation age/i)).toBeDisabled();
    expect(screen.getByPlaceholderText(/Evidence reference/i)).toBeDisabled();
    expect(screen.getByPlaceholderText(/Clock authority/i)).toBeDisabled();
    expect(
      screen.getByLabelText("Clock synchronization protocol"),
    ).toBeDisabled();
    expect(screen.getByText(/outcome is unknown/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Clock contract recorded\./i),
    ).not.toBeInTheDocument();
    const first = configure.mock.calls[0][0];
    expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.isFrozen(first)).toBe(true);
    fireEvent.click(retry);
    await waitFor(() => expect(configure).toHaveBeenCalledTimes(2));
    expect(configure.mock.calls[1][0]).toBe(first);
    await screen.findByText(/Clock contract recorded as revision 3/i);
    expect(screen.getByLabelText(/Recorded tolerance/i)).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Retry same configuration safely" }),
    ).not.toBeInTheDocument();
  });

  it("locks edits while the save is pending and sends no simultaneous second intent", async () => {
    let resolve!: (value: unknown) => void;
    configure.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<TimeSynchronizationAssurance />);
    await fillConfiguration();
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    expect(screen.getByLabelText(/Recorded tolerance/i)).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    expect(configure).toHaveBeenCalledTimes(1);
    resolve(qualifiedAcknowledgement(configure.mock.calls[0][0]));
    await screen.findByText(/Clock contract recorded as revision 3/i);
  });

  it("clears a known refusal without pretending the contract was recorded", async () => {
    configure.mockRejectedValue(
      new TimeAssuranceRefusalError("Intent collision refused"),
    );
    render(<TimeSynchronizationAssurance />);
    await fillConfiguration();
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    await screen.findByText("Intent collision refused");
    expect(
      screen.getByRole("button", { name: "Save clock contract" }),
    ).toBeEnabled();
    expect(screen.getByLabelText(/Recorded tolerance/i)).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Retry same configuration safely" }),
    ).not.toBeInTheDocument();
  });

  it("labels replay as a historical receipt without claiming the current contract", async () => {
    configure.mockImplementation(async (intent) => ({
      ...qualifiedAcknowledgement(intent),
      configuration_revision: 1,
      current_configuration_revision: 4,
      replay: true,
    }));
    render(<TimeSynchronizationAssurance />);
    await fillConfiguration();
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    expect(
      await screen.findByText(/original revision 1; current revision 4/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not establish the active contract/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Clock contract recorded as revision/i),
    ).not.toBeInTheDocument();
  });

  it("does not accept a stale completion after authority changed and returned", async () => {
    let resolve!: (value: unknown) => void;
    configure.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = render(<TimeSynchronizationAssurance />);
    await fillConfiguration();
    fireEvent.click(
      screen.getByRole("button", { name: "Save clock contract" }),
    );
    role = "reliability_engineer";
    view.rerender(<TimeSynchronizationAssurance />);
    role = "admin";
    view.rerender(<TimeSynchronizationAssurance />);
    resolve(qualifiedAcknowledgement(configure.mock.calls[0][0]));
    await screen.findByRole("button", {
      name: "Retry same configuration safely",
    });
    expect(screen.getByText(/outcome is unknown/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Clock contract recorded as revision/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save clock contract" }),
    ).toBeDisabled();
  });

  it.each(["actor", "tenant"])(
    "does not replay a locked intent from a changed %s context",
    async (change) => {
      configure.mockRejectedValue(new Error("Synthetic lost acknowledgement"));
      const view = render(<TimeSynchronizationAssurance />);
      await fillConfiguration();
      fireEvent.click(
        screen.getByRole("button", { name: "Save clock contract" }),
      );
      await screen.findByRole("button", {
        name: "Retry same configuration safely",
      });
      if (change === "actor") actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      else tenantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      view.rerender(<TimeSynchronizationAssurance />);
      const retry = await screen.findByRole("button", {
        name: "Retry same configuration safely",
      });
      expect(retry).toBeDisabled();
      fireEvent.click(retry);
      fireEvent.click(
        screen.getByRole("button", { name: "Save clock contract" }),
      );
      expect(configure).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Time-assurance connector")).toBeDisabled();
    },
  );
  it("lets an authorized reader inspect a historical revision without granting approval", async () => {
    role = "reliability_engineer";
    render(<TimeSynchronizationAssurance />);
    await screen.findAllByText("Site A OPC UA");
    fireEvent.change(screen.getByLabelText("Event assessment connector"), {
      target: { value: workspace.connectors[0].connectorId },
    });
    fireEvent.change(screen.getByLabelText("Event timestamp with timezone"), {
      target: { value: "2026-10-03T11:30:00.000Z" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Assess recorded event time" }),
    );
    await waitFor(() =>
      expect(evaluateEventTime).toHaveBeenCalledWith(
        workspace.connectors[0].connectorId,
        "2026-10-03T11:30:00.000Z",
      ),
    );
    expect(
      await screen.findByText(/Recorded revision 1 · synchronized/),
    ).toBeInTheDocument();
    expect(screen.getByText("receipt-at-event")).toBeInTheDocument();
    expect(
      screen.getByText(/Time-sensitive evidence remains ineligible/i),
    ).toBeInTheDocument();
    expect(configure).not.toHaveBeenCalled();
  });

  it("refuses ambiguous timezone-free event input before calling the service", async () => {
    render(<TimeSynchronizationAssurance />);
    await screen.findAllByText("Site A OPC UA");
    fireEvent.change(screen.getByLabelText("Event assessment connector"), {
      target: { value: workspace.connectors[0].connectorId },
    });
    fireEvent.change(screen.getByLabelText("Event timestamp with timezone"), {
      target: { value: "2026-10-03T11:30:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Assess recorded event time" }),
    );
    expect(
      await screen.findByText(/Include an explicit timezone/i),
    ).toBeInTheDocument();
    expect(evaluateEventTime).not.toHaveBeenCalled();
  });

  it("does not display an old in-flight result after the event input changes", async () => {
    let resolve!: (value: unknown) => void;
    evaluateEventTime.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<TimeSynchronizationAssurance />);
    await screen.findAllByText("Site A OPC UA");
    fireEvent.change(screen.getByLabelText("Event assessment connector"), {
      target: { value: workspace.connectors[0].connectorId },
    });
    fireEvent.change(screen.getByLabelText("Event timestamp with timezone"), {
      target: { value: "2026-10-03T11:30:00Z" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Assess recorded event time" }),
    );
    fireEvent.change(screen.getByLabelText("Event timestamp with timezone"), {
      target: { value: "2026-10-03T11:31:00Z" },
    });
    resolve({
      state: "synchronized",
      configuration_revision: 1,
      configuration_audit_id: "wrong-event-receipt",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Assess recorded event time" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByText("wrong-event-receipt")).not.toBeInTheDocument();
  });
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
