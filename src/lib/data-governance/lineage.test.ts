import { describe, expect, it } from "vitest";
import {
  lineageProposalFromMappedSapStock,
  SAP_MATERIAL_STOCK_SOURCE,
  validateLineageDraft,
  type LineageDraft,
} from "./lineage";

const now = "2026-11-03T12:00:00Z";
const stockId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";

function draft(overrides: Partial<LineageDraft> = {}): LineageDraft {
  return {
    domainId: "12",
    relationship: "sourced_from",
    subjectClass: "asset",
    subjectId: stockId,
    sourceSystem: "cmms",
    sourceObject: "Equipment",
    sourceKey: "EQ-100",
    transformation: "The equipment record was loaded as this canonical asset.",
    observedAt: "2026-01-01T00:00:00Z",
    basis: "Named human compared the source key with the asset tag.",
    evidenceReference: "WO-14",
    parentEdgeId: "",
    supersedesEdgeId: "",
    connectorId: "",
    ...overrides,
  };
}

const mapped = {
  external_id: `1000:0001:MAT-1`,
  material_code: "MAT-1",
  unit_of_measure: "EA",
  qty_on_hand: 4,
  site_id: siteId,
  observed_at: "2026-01-01T00:00:00Z",
};

describe("validateLineageDraft", () => {
  it("accepts a complete sourced-from attestation", () => {
    expect(validateLineageDraft(draft(), now)).toBeNull();
  });

  it("refuses a future observation instead of treating it as current", () => {
    expect(
      validateLineageDraft(draft({ observedAt: "2099-01-01T00:00:00Z" }), now),
    ).toMatch(/cannot be in the future/);
  });

  it("refuses a derived edge with no parent and a sourced edge with one", () => {
    expect(
      validateLineageDraft(draft({ relationship: "derived_from" }), now),
    ).toMatch(/must name the parent/);
    expect(
      validateLineageDraft(
        draft({
          parentEdgeId: "33333333-3333-4333-8333-333333333333",
        }),
        now,
      ),
    ).toMatch(/has no parent/);
  });
});

describe("lineageProposalFromMappedSapStock", () => {
  it("prefills a sourced-from material stock edge from a reviewed mapping", () => {
    const proposal = lineageProposalFromMappedSapStock({
      mapped,
      materialStockId: stockId,
      dataDomainId: "12",
      basis: "The stock row was loaded from this reviewed mapping.",
      evidenceReference: "MAP-1",
      nowIso: now,
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.draft.sourceSystem).toBe(SAP_MATERIAL_STOCK_SOURCE);
    expect(proposal.draft.sourceObject).toBe("MaterialStock");
    expect(proposal.draft.sourceKey).toBe(mapped.external_id);
    expect(proposal.draft.subjectClass).toBe("material_stock");
    expect(proposal.draft.relationship).toBe("sourced_from");
    expect(proposal.draft.transformation).toContain("qty_on_hand 4");
    expect(proposal.draft.transformation).toContain("does not call SAP");
  });

  it("refuses a raw SAP payload and does not invent a mapped identity", () => {
    const proposal = lineageProposalFromMappedSapStock({
      mapped: { Material: "MAT-1", Plant: "1000", InventoryStockType: "01" },
      materialStockId: stockId,
      dataDomainId: "12",
      basis: "The stock row was loaded from this reviewed mapping.",
      evidenceReference: "MAP-1",
      nowIso: now,
    });
    expect(proposal).toEqual({
      ok: false,
      reason:
        "A raw SAP payload is not a reviewed mapping. Lineage does not call SAP and does not reinterpret OData fields.",
    });
  });

  it("refuses a missing quantity instead of inferring zero", () => {
    const withoutQuantity = Object.fromEntries(
      Object.entries(mapped).filter(([key]) => key !== "qty_on_hand"),
    );
    const proposal = lineageProposalFromMappedSapStock({
      mapped: withoutQuantity,
      materialStockId: stockId,
      dataDomainId: "12",
      basis: "The stock row was loaded from this reviewed mapping.",
      evidenceReference: "MAP-1",
      nowIso: now,
    });
    expect(proposal.ok).toBe(false);
    if (proposal.ok) return;
    expect(proposal.reason).toMatch(/will not infer zero/);
  });
});
