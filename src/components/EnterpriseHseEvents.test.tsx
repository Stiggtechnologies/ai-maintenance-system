import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseHseEvents } from "./EnterpriseHseEvents";

const getWorkspace = vi.fn();
const recordEvent = vi.fn();
const recordSource = vi.fn();
const verifyEvent = vi.fn();

vi.mock("../services/enterpriseHseEventsService", () => ({
  getEnterpriseHseWorkspace: (...args: unknown[]) => getWorkspace(...args),
  recordHseEvent: (...args: unknown[]) => recordEvent(...args),
  recordHseReportingSource: (...args: unknown[]) => recordSource(...args),
  verifyHseEvent: (...args: unknown[]) => verifyEvent(...args),
}));

const workspace = {
  canRecord: true,
  requiredAal: "aal2" as const,
  metrics: {
    window: { from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" },
    safety: {
      reportingCoverageComplete: false,
      actualEvents: null,
      nearMisses: null,
      independentlyVerified: 0,
      pendingClassification: 1,
      humanRecordedContainmentLosses: 1,
      basis: "Awaiting reporting coverage; no zero is inferred.",
    },
    environmental: {
      reportingCoverageComplete: true,
      actualEvents: 1,
      nearMisses: 0,
      independentlyVerified: 1,
      pendingClassification: 0,
      humanRecordedContainmentLosses: 1,
      basis: "Linked events and losses are counted once.",
    },
    gaps: { unverifiedEvents: 1, eventsWithoutAsset: 0, eventsWithoutSite: 0 },
    decisionBoundary: "Counts do not close incidents.",
  },
  sites: [{ id: "site-1", name: "North plant" }],
  assets: [
    { id: "asset-1", name: "Pump P-101", tag: "P-101", siteId: "site-1" },
  ],
  connectors: [],
  verifiedEvidence: [
    {
      id: "evidence-1",
      description: "Independent event review",
      sourceSystem: "HSE",
      assetId: "asset-1",
      verifiedBy: "reviewer-1",
      verifiedAt: "2026-10-01T00:00:00Z",
    },
  ],
  reportingSources: [],
  events: [],
  containmentLosses: [],
  decisionBoundary:
    "HSE reporting does not close an incident or authorize work.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  recordEvent.mockResolvedValue({
    id: "event-1",
    version: 1,
    incidentClosed: false,
    complianceCertified: false,
    riskAccepted: false,
    workAuthorized: false,
    returnToServiceAuthorized: false,
  });
});

describe("EnterpriseHseEvents", () => {
  it("keeps uncovered safety unknown while showing covered environmental facts", async () => {
    render(<EnterpriseHseEvents />);
    expect(
      await screen.findByText("Enterprise safety & environmental events"),
    ).toBeVisible();
    expect(screen.getByText("Coverage required")).toBeVisible();
    expect(screen.getByText("Reporting covered")).toBeVisible();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(
      screen.getByText(/A zero is shown only for an attested source/i),
    ).toBeVisible();
  });

  it("makes the governed event writer customer-operable", async () => {
    render(<EnterpriseHseEvents />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Record event/i }),
    );
    fireEvent.change(screen.getByLabelText("Stable event reference"), {
      target: { value: "HSE-001" },
    });
    fireEvent.change(screen.getByLabelText("Occurred at"), {
      target: { value: "2026-10-01T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: {
        value:
          "Observed coupling guard condition during the documented field inspection.",
      },
    });
    fireEvent.change(screen.getByLabelText("Source reference"), {
      target: { value: "HSE-LOG-001" },
    });
    fireEvent.change(screen.getByLabelText("Human classification basis"), {
      target: {
        value:
          "Named human classification from the controlled field observation record.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record immutable event" }),
    );
    await waitFor(() =>
      expect(recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventRef: "HSE-001",
          domain: "occupational_safety",
          recordability: "pending_determination",
        }),
      ),
    );
    expect(
      await screen.findByText(/immutable, human-classified version/i),
    ).toBeVisible();
  });

  it("hides all mutation controls from a read-only session", async () => {
    getWorkspace.mockResolvedValue({ ...workspace, canRecord: false });
    render(<EnterpriseHseEvents />);
    await screen.findByText("Enterprise safety & environmental events");
    expect(
      screen.queryByRole("button", { name: /Record event/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Attest reporting source/i }),
    ).not.toBeInTheDocument();
  });
});
