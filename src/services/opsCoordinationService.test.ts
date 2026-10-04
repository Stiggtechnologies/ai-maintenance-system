import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

import {
  getOpsCoordination,
  returnEquipmentToOperations,
  verifyAndAcceptEquipment,
} from "./opsCoordinationService";

describe("ops coordination service", () => {
  beforeEach(() => rpcMock.mockReset());

  it("loads the canonical equipment handback read model", async () => {
    rpcMock.mockResolvedValue({
      data: { open_releases: [], production_loss: { by_asset: [] } },
      error: null,
    });

    await getOpsCoordination();
    expect(rpcMock).toHaveBeenCalledWith("get_ops_coordination", {});
  });

  it("records the maintenance handback through the existing canonical act", async () => {
    rpcMock.mockResolvedValue({ data: { returned: "asset-1" }, error: null });

    await returnEquipmentToOperations({
      assetId: "asset-1",
      note: "Maintenance complete; guards and containment restored.",
    });
    expect(rpcMock).toHaveBeenCalledWith("return_equipment", {
      p_asset_id: "asset-1",
      p_note: "Maintenance complete; guards and containment restored.",
    });
  });

  it("passes the exact release and independently released acceptance test to the governed RTS act", async () => {
    rpcMock.mockResolvedValue({
      data: {
        accepted: "asset-1",
        releaseId: "release-1",
        acceptanceTestId: 42,
      },
      error: null,
    });

    await verifyAndAcceptEquipment({
      releaseId: "release-1",
      acceptanceTestId: 42,
      note: "Operations reviewed the released test and confirmed the asset condition.",
    });
    expect(rpcMock).toHaveBeenCalledWith("verify_and_accept_equipment", {
      p_release_id: "release-1",
      p_acceptance_test_id: 42,
      p_note:
        "Operations reviewed the released test and confirmed the asset condition.",
    });
  });

  it("surfaces an in-band refusal instead of reporting success", async () => {
    rpcMock.mockResolvedValue({
      data: { error: "released return-to-service acceptance test required" },
      error: null,
    });

    await expect(
      verifyAndAcceptEquipment({
        releaseId: "release-1",
        acceptanceTestId: 42,
        note: "Operations reviewed the released test and confirmed the asset condition.",
      }),
    ).rejects.toThrow(/acceptance test required/i);
  });
});
