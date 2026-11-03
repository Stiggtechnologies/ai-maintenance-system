import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import {
  decideConnectorZoneAssignment,
  decideNetworkZone,
  getNetworkSeparation,
  proposeConnectorZoneAssignment,
  proposeNetworkZone,
} from "./networkSeparationService";

describe("networkSeparationService", () => {
  beforeEach(() => rpc.mockReset());

  it("reads the tenant zone workspace and grants no operational authority", async () => {
    rpc.mockResolvedValue({
      data: {
        unzoned: true,
        boundary: "A tenant with no adopted zone is unzoned.",
        zones: [],
        assignments: [],
        connectors: [],
        operationalAuthority: false,
      },
      error: null,
    });
    await expect(getNetworkSeparation()).resolves.toMatchObject({
      unzoned: true,
      operationalAuthority: false,
    });
    expect(rpc).toHaveBeenCalledWith("get_network_separation");
  });

  it("passes zone and assignment proposals without a client-side authority flag", async () => {
    rpc.mockResolvedValue({ data: { status: "proposed" }, error: null });
    await proposeNetworkZone({
      zoneKey: "enterprise-it",
      label: "Enterprise IT",
      purdueLevel: 4,
      egressPermitted: true,
      egressRoute: "sap-gateway",
      basis:
        "Enterprise IT zone for the SAP connector, with a named egress route.",
      supersedesZoneId: 9,
    });
    expect(rpc).toHaveBeenLastCalledWith("propose_network_zone", {
      p_zone_key: "enterprise-it",
      p_label: "Enterprise IT",
      p_purdue_level: 4,
      p_egress_permitted: true,
      p_egress_route: "sap-gateway",
      p_basis:
        "Enterprise IT zone for the SAP connector, with a named egress route.",
      p_supersedes_zone_id: 9,
    });

    await proposeConnectorZoneAssignment({
      connectorKey: "sap-plant",
      zoneId: 4,
      basis:
        "SAP S/4HANA sits in enterprise IT and is not a control-zone writer.",
    });
    expect(rpc).toHaveBeenLastCalledWith("propose_connector_zone_assignment", {
      p_connector_key: "sap-plant",
      p_zone_id: 4,
      p_basis:
        "SAP S/4HANA sits in enterprise IT and is not a control-zone writer.",
      p_supersedes_assignment_id: null,
    });
  });

  it("passes independent decisions and fails closed on a governed refusal", async () => {
    rpc.mockResolvedValue({ data: { status: "adopted" }, error: null });
    await decideNetworkZone({
      zoneId: 3,
      decision: "adopt",
      reason:
        "Independent review accepts the declared enterprise zone and route.",
    });
    expect(rpc).toHaveBeenLastCalledWith("decide_network_zone", {
      p_zone_id: 3,
      p_decision: "adopt",
      p_reason:
        "Independent review accepts the declared enterprise zone and route.",
    });

    await decideConnectorZoneAssignment({
      assignmentId: 8,
      decision: "reject",
      reason:
        "The connector has not been shown to sit outside the control zone.",
    });
    expect(rpc).toHaveBeenLastCalledWith("decide_connector_zone_assignment", {
      p_assignment_id: 8,
      p_decision: "reject",
      p_reason:
        "The connector has not been shown to sit outside the control zone.",
    });

    rpc.mockResolvedValue({
      data: {
        error:
          "The proposer cannot independently adopt or reject the same network zone",
      },
      error: null,
    });
    await expect(
      decideNetworkZone({
        zoneId: 3,
        decision: "adopt",
        reason:
          "The proposer cannot independently adopt or reject the same network zone.",
      }),
    ).rejects.toThrow(/proposer cannot independently adopt/);
  });
});
