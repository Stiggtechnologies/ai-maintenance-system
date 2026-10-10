import { describe, expect, it } from "vitest";
import {
  CUSTOMER_FIRST_WALKTHROUGH,
  PRODUCT_ENTRY_PATHS,
  PRODUCT_CUSTOMER_FLOW,
  productEntryById,
  productEntryDestination,
  productEntryPath,
} from "./product-entry-paths";

describe("product entry paths", () => {
  it("treats the customer-first walkthrough as one research hypothesis behind every wedge", () => {
    expect(CUSTOMER_FIRST_WALKTHROUGH.map((stage) => stage.id)).toEqual([
      "real-question",
      "evidence-path",
      "bounded-recommendation",
      "human-disposition",
      "controlled-action",
      "verification",
      "learning",
    ]);
    expect(CUSTOMER_FIRST_WALKTHROUGH[0].detail).toContain("not a seeded demo");
    expect(CUSTOMER_FIRST_WALKTHROUGH[2].detail).toContain("uncertainty");
    expect(CUSTOMER_FIRST_WALKTHROUGH[3].detail).toContain("named person");
    expect(CUSTOMER_FIRST_WALKTHROUGH[5].detail).toContain(
      "verification owner",
    );
  });

  it("preserves the governed customer flow behind every acquisition wedge", () => {
    expect(PRODUCT_CUSTOMER_FLOW.map((stage) => stage.id)).toEqual([
      "first-decision",
      "assess-if-needed",
      "bounded-proof",
      "production",
      "expand",
    ]);
    expect(PRODUCT_CUSTOMER_FLOW[1].optional).toBe(true);
  });

  it("maps ten commercial wedges onto the existing public capability routes", () => {
    expect(PRODUCT_ENTRY_PATHS).toHaveLength(10);
    expect(new Set(PRODUCT_ENTRY_PATHS.map((entry) => entry.id)).size).toBe(10);
    expect(
      new Set(PRODUCT_ENTRY_PATHS.map((entry) => entry.intentId)).size,
    ).toBe(5);
    expect(PRODUCT_ENTRY_PATHS[0]).toMatchObject({
      id: "failure-investigation",
      intentId: "troubleshoot",
      priority: "primary",
      name: "Unplanned Downtime Reduction",
      agentProduct: "SyncAI Failure Investigation Agent",
    });
    expect(PRODUCT_ENTRY_PATHS[1]).toMatchObject({
      id: "recovery-coordination",
      intentId: "compare",
      priority: "primary",
    });
    expect(
      PRODUCT_ENTRY_PATHS.every((entry) => entry.platformSurface.length > 0),
    ).toBe(true);
    expect(
      PRODUCT_ENTRY_PATHS.every((entry) =>
        entry.agentProduct.startsWith("SyncAI "),
      ),
    ).toBe(true);
  });

  it("keeps each public product URL separate from its canonical workspace destination", () => {
    const entry = productEntryById("maintenance-cost-reduction");
    expect(entry).toBeDefined();
    expect(productEntryPath(entry!)).toBe(
      "/solutions/maintenance-cost-reduction",
    );
    expect(
      productEntryDestination(entry!, {
        source: "microsoft-marketplace",
        campaign: "october-test",
        variant: "evidence-led",
      }),
    ).toBe(
      "/get-started?entry=maintenance-cost-reduction&source=microsoft-marketplace&campaign=october-test&variant=evidence-led",
    );
  });

  it("drops empty attribution rather than inventing campaign evidence", () => {
    const entry = productEntryById("downtime-evidence-audit");
    expect(productEntryDestination(entry!, {})).toBe(
      "/get-started?entry=downtime-evidence-audit",
    );
    expect(productEntryById("unsupported")).toBeUndefined();
  });

  it("keeps the old downtime route working while canonicalizing new attribution", () => {
    const legacyEntry = productEntryById("downtime-reduction");
    expect(legacyEntry).toMatchObject({
      id: "failure-investigation",
      agentProduct: "SyncAI Failure Investigation Agent",
    });
    expect(productEntryDestination(legacyEntry!)).toBe(
      "/get-started?entry=failure-investigation",
    );
  });
});
