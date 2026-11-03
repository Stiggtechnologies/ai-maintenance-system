import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleRegulatoryEvidencePack,
  releaseRegulatoryEvidencePack,
  withdrawRegulatoryEvidencePack,
} from "./regulatoryEvidenceService";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const authority = {
  legalComplianceDetermined: false,
  workAuthorized: false,
  riskAccepted: false,
  operatingLimitChanged: false,
  returnToServiceAuthorized: false,
};

const input = {
  capabilityPackLayerId: "layer-1",
  expectedLayerVersion: 4,
  requirementKey: "pressure_shutdown_test",
  title: "2026 inspection dossier",
  purpose: "Present the verified shutdown-test record for inspection.",
  supersedesId: null,
  items: [
    {
      evidenceItemId: "evidence-1",
      citationBasis:
        "This verified record is the inspection citation for the adopted requirement.",
    },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { id: "dossier-1", status: "assembled", version: 1, ...authority },
    error: null,
  });
});

describe("regulatory evidence service", () => {
  it("refuses a dossier with no verified citation before calling the writer", async () => {
    await expect(
      assembleRegulatoryEvidencePack({ ...input, items: [] }),
    ).rejects.toThrow(/at least one independently verified evidence item/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a short inspection purpose before calling the writer", async () => {
    await expect(
      assembleRegulatoryEvidencePack({ ...input, purpose: "too short" }),
    ).rejects.toThrow(/inspection purpose/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the adopted requirement and citation to the governed assembler", async () => {
    await assembleRegulatoryEvidencePack(input);
    expect(rpc).toHaveBeenCalledWith("assemble_regulatory_evidence_pack", {
      p_pack: {
        capability_pack_layer_id: "layer-1",
        expected_layer_version: 4,
        requirement_key: "pressure_shutdown_test",
        title: "2026 inspection dossier",
        purpose: "Present the verified shutdown-test record for inspection.",
        supersedes_id: null,
        items: [
          {
            evidence_item_id: "evidence-1",
            citation_basis:
              "This verified record is the inspection citation for the adopted requirement.",
          },
        ],
      },
    });
  });

  it("releases and withdraws through their own governed doors", async () => {
    await releaseRegulatoryEvidencePack({
      dossierId: "dossier-1",
      expectedVersion: 1,
      releaseBasis: "I release this exact dossier for inspection only.",
    });
    await withdrawRegulatoryEvidencePack({
      dossierId: "dossier-1",
      expectedVersion: 1,
      reason: "The adopted requirement changed before release.",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "release_regulatory_evidence_pack", {
      p_release: {
        dossier_id: "dossier-1",
        expected_version: 1,
        release_basis: "I release this exact dossier for inspection only.",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "withdraw_regulatory_evidence_pack",
      {
        p_withdrawal: {
          dossier_id: "dossier-1",
          expected_version: 1,
          reason: "The adopted requirement changed before release.",
        },
      },
    );
  });
});
