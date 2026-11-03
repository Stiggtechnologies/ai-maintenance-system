import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getNetworkSeparation = vi.hoisted(() => vi.fn());
const proposeNetworkZone = vi.hoisted(() => vi.fn());
const decideNetworkZone = vi.hoisted(() => vi.fn());
const proposeConnectorZoneAssignment = vi.hoisted(() => vi.fn());
const decideConnectorZoneAssignment = vi.hoisted(() => vi.fn());

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "admin" } }),
}));
vi.mock("../services/networkSeparationService", () => ({
  getNetworkSeparation,
  proposeNetworkZone,
  decideNetworkZone,
  proposeConnectorZoneAssignment,
  decideConnectorZoneAssignment,
}));

import { NetworkSeparationPanel } from "./NetworkSeparationPanel";

const workspace = {
  unzoned: false,
  boundary:
    "They do not configure firewalls, switches, PLCs or safety systems, and an assignment grants no plant-control authority.",
  operationalAuthority: false,
  zones: [
    {
      id: 4,
      version: 1,
      zoneKey: "enterprise-it",
      label: "Enterprise IT",
      purdueLevel: 4,
      egressPermitted: true,
      egressRoute: "sap-gateway",
      status: "adopted",
      basis: "Declared enterprise zone.",
      proposedBy: "proposer",
      proposedByLabel: "Ada",
      decidedBy: "reviewer",
      decidedByLabel: "Ben",
      supersedesZoneId: null,
      supersededByZoneId: null,
    },
    {
      id: 7,
      version: 1,
      zoneKey: "control",
      label: "Basic control",
      purdueLevel: 1,
      egressPermitted: false,
      egressRoute: null,
      status: "proposed",
      basis: "Declared control zone.",
      proposedBy: "proposer",
      proposedByLabel: "Ada",
      decidedBy: null,
      decidedByLabel: null,
      supersedesZoneId: null,
      supersededByZoneId: null,
    },
  ],
  assignments: [
    {
      id: 8,
      version: 1,
      connectorKey: "sap-plant",
      zoneId: 4,
      zoneKey: "enterprise-it",
      purdueLevel: 4,
      status: "proposed",
      basis: "SAP sits in enterprise IT.",
      proposedBy: "proposer",
      proposedByLabel: "Ada",
      decidedByLabel: null,
      supersedesAssignmentId: null,
      supersededByAssignmentId: null,
    },
  ],
  connectors: [
    {
      connectorKey: "sap-plant",
      name: "SAP plant",
      connectorType: "sap_s4_write",
      direction: "read_write",
      enabled: true,
      writeEnabled: true,
      read: { allowed: true, reason: "adopted_zone_read" },
      write: { allowed: false, reason: "control_zone_write_refused" },
    },
  ],
};

describe("NetworkSeparationPanel", () => {
  beforeEach(() => {
    getNetworkSeparation.mockResolvedValue(workspace);
    proposeNetworkZone.mockResolvedValue({ status: "proposed" });
    decideNetworkZone.mockResolvedValue({ status: "adopted" });
    proposeConnectorZoneAssignment.mockResolvedValue({ status: "proposed" });
    decideConnectorZoneAssignment.mockResolvedValue({ status: "rejected" });
  });
  afterEach(() => cleanup());

  it("shows the boundary and a refused control-zone write without calling SAP", async () => {
    render(<NetworkSeparationPanel />);
    expect(
      await screen.findByText(/do not configure firewalls, switches, PLCs/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/Writes into a declared Purdue 0-2 zone are refused/),
    ).toBeTruthy();
    expect(screen.getByText(/Read allowed by the adopted zone/)).toBeTruthy();
    expect(proposeNetworkZone).not.toHaveBeenCalled();
  });

  it("proposes a zone and records an independent assignment decision", async () => {
    render(<NetworkSeparationPanel />);
    await screen.findByRole("heading", { name: "OT/IT network separation" });

    fireEvent.change(screen.getByLabelText("Zone key"), {
      target: { value: "dmz" },
    });
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Industrial DMZ" },
    });
    fireEvent.change(screen.getByLabelText("Basis"), {
      target: {
        value:
          "DMZ between the control network and enterprise IT, with no PLC write.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose zone" }));
    await waitFor(() =>
      expect(proposeNetworkZone).toHaveBeenCalledWith(
        expect.objectContaining({
          zoneKey: "dmz",
          label: "Industrial DMZ",
          purdueLevel: 4,
          egressPermitted: false,
        }),
      ),
    );
    await screen.findByText(/Zone proposal recorded/);
    await screen.findByRole("button", { name: "Reject assignment" });

    fireEvent.change(screen.getByLabelText("Decision basis for sap-plant"), {
      target: {
        value:
          "Independent review rejects this assignment until the zone is confirmed.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject assignment" }));
    await waitFor(() =>
      expect(decideConnectorZoneAssignment).toHaveBeenCalledWith({
        assignmentId: 8,
        decision: "reject",
        reason:
          "Independent review rejects this assignment until the zone is confirmed.",
      }),
    );
  });
});
