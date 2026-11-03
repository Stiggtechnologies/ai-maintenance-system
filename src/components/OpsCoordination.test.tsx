import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOps, returnEquipment, verifyAccept, recordLoss } = vi.hoisted(() => ({
  getOps: vi.fn(),
  returnEquipment: vi.fn(),
  verifyAccept: vi.fn(),
  recordLoss: vi.fn(),
}));

vi.mock("../services/opsCoordinationService", () => ({
  getOpsCoordination: getOps,
  returnEquipmentToOperations: returnEquipment,
  verifyAndAcceptEquipment: verifyAccept,
  recordEquipmentProductionLossReceipt: recordLoss,
}));

import { OpsCoordination } from "./OpsCoordination";

const releasedTest = {
  id: 42,
  test_ref: "RTS-P101-042",
  performed_on: "2026-10-01",
  acceptance_criteria: "All approved return-to-service criteria satisfied",
  evidence_description:
    "Signed functional-test and protection-restoration record",
  released_at: "2026-10-02T00:00:00Z",
};

function payload(eligible = [releasedTest]) {
  return {
    open_releases: [
      {
        release_id: "release-1",
        asset_id: "asset-1",
        asset: "Pump P-101",
        status: "returned",
        released_at: "2026-10-01T00:00:00Z",
        returned_at: "2026-10-01T04:00:00Z",
        isolation_confirmed: true,
        hours_out_of_service: 4,
        awaiting_acceptance: true,
        returned_by_me: false,
        eligible_rts_tests: eligible,
      },
    ],
    production_loss: {
      window_days: 30,
      by_asset: [],
      assets_measurable: 0,
      assets: 1,
      basis: "Measured from demonstrated operating rate.",
      totals_by_unit: [],
      exclusions: [],
      decision_boundary:
        "This total does not release work, accept risk, commit spend, change an operating limit, or return equipment to service.",
    },
    note: "A returned asset remains out of service until governed acceptance.",
  };
}

describe("OpsCoordination governed return to service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOps.mockResolvedValue(payload());
    verifyAccept.mockResolvedValue({ accepted: "asset-1" });
    vi.spyOn(window, "prompt").mockReturnValue(
      "Operations reviewed the released test and confirmed the asset condition.",
    );
  });

  it("binds operations acceptance to the selected independently released RTS test", async () => {
    render(<OpsCoordination />);

    expect(
      await screen.findByRole("option", { name: /RTS-P101-042/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /accept back into service/i }),
    );

    await waitFor(() => expect(verifyAccept).toHaveBeenCalledTimes(1));
    expect(verifyAccept).toHaveBeenCalledWith({
      releaseId: "release-1",
      acceptanceTestId: 42,
      note: "Operations reviewed the released test and confirmed the asset condition.",
    });
  });

  it("blocks the button and points to Quality assurance when no eligible test exists", async () => {
    getOps.mockResolvedValue(payload([]));
    render(<OpsCoordination />);

    expect(
      await screen.findByText(/no eligible return-to-service acceptance test/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Quality assurance/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /accept back into service/i }),
    ).toBeDisabled();
  });

  it("shows separate equipment-loss totals and records an audit receipt", async () => {
    getOps.mockResolvedValue({
      ...payload(),
      production_loss: {
        window_days: 90,
        by_asset: [
          {
            asset: "Pump P-101",
            down_hours: 4,
            demonstrated_rate: 10,
            unit_of_measure: "t",
            units_lost: 40,
          },
        ],
        assets_measurable: 1,
        assets: 2,
        basis: "Equipment-failure downtime times demonstrated rate.",
        totals_by_unit: [
          { unit_of_measure: "bbl", assets: 1, down_hours: 2, units_lost: 8 },
          { unit_of_measure: "t", assets: 1, down_hours: 4, units_lost: 40 },
        ],
        exclusions: [
          { classification: "planned_maintenance", events: 1, down_hours: 6 },
          { classification: "unclassified", events: 2, down_hours: 3 },
        ],
        not_measurable_equipment_hours: 1.5,
        mixed_unit_assets: 1,
        decision_boundary:
          "This total does not release work, accept risk, commit spend, change an operating limit, or return equipment to service.",
      },
    });
    recordLoss.mockResolvedValue({
      recorded: true,
      audit_event_id: "audit-1",
    });

    render(<OpsCoordination />);

    expect(await screen.findByText(/Enterprise total/i)).toBeInTheDocument();
    expect(screen.getAllByText(/40 t/).length).toBeGreaterThan(0);
    expect(screen.getByText(/8 bbl/)).toBeInTheDocument();
    expect(screen.getByText(/These units are not added together/i)).toBeInTheDocument();
    expect(screen.getByText(/Excluded planned maintenance: 6 h/i)).toBeInTheDocument();
    expect(screen.getByText(/Excluded unclassified: 3 h/i)).toBeInTheDocument();
    expect(screen.getByText(/1.5 equipment-failure hours/i)).toBeInTheDocument();
    expect(screen.getByText(/mixed production units/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /record measurement receipt/i }),
    );
    await waitFor(() => expect(recordLoss).toHaveBeenCalledWith(90));
    expect(await screen.findByText(/audit-1 recorded/i)).toBeInTheDocument();
    expect(screen.getAllByText(/does not release work/i).length).toBeGreaterThan(0);
  });
});
