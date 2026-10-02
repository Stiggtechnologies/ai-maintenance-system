import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOps, returnEquipment, verifyAccept } = vi.hoisted(() => ({
  getOps: vi.fn(),
  returnEquipment: vi.fn(),
  verifyAccept: vi.fn(),
}));

vi.mock("../services/opsCoordinationService", () => ({
  getOpsCoordination: getOps,
  returnEquipmentToOperations: returnEquipment,
  verifyAndAcceptEquipment: verifyAccept,
}));

import { OpsCoordination } from "./OpsCoordination";

const releasedTest = {
  id: 42,
  test_ref: "RTS-P101-042",
  performed_on: "2026-10-01",
  acceptance_criteria: "All approved return-to-service criteria satisfied",
  evidence_description: "Signed functional-test and protection-restoration record",
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

    expect(await screen.findByText("RTS-P101-042")).toBeInTheDocument();
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
});
