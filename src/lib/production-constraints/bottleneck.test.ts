import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  parseQuantity,
  rankProductionConstraints,
  studyInputError,
  type StudyDraft,
} from "./bottleneck";

const limit = (
  key: string,
  available: string | null,
  unit = "t",
  kind = "equipment",
) => ({ key, kind, availableQuantity: available, unitOfMeasure: unit });

describe("rankProductionConstraints", () => {
  it("names the lowest limit and does not add the others to it", () => {
    const ranked = rankProductionConstraints("50", "t", [
      limit("crusher", "40"),
      limit("feed", "100", "t", "upstream"),
    ]);
    expect(ranked).toMatchObject({
      assessable: true,
      primaryKey: "crusher",
      bottleneckKeys: ["crusher"],
      availableQuantity: "40",
      headroom: "-10",
      binding: true,
    });
    expect(ranked.availableQuantity).not.toBe("140");
  });

  it("keeps every tied minimum and orders the primary by kind then key", () => {
    const ranked = rankProductionConstraints("10", "t", [
      limit("b-line", "40", "t", "material"),
      limit("a-line", "40", "t", "equipment"),
      limit("spare", "90", "t", "utility"),
    ]);
    expect(ranked.bottleneckKeys).toEqual(["a-line", "b-line"]);
    expect(ranked.primaryKey).toBe("a-line");
    expect(ranked.binding).toBe(false);
    expect(ranked.headroom).toBe("30");
  });

  it("treats an exact fit as covered and a zero limit as binding", () => {
    expect(
      rankProductionConstraints("50", "t", [limit("line", "50")]).binding,
    ).toBe(false);
    expect(
      rankProductionConstraints("50", "t", [limit("line", "50")]).headroom,
    ).toBe("0");
    expect(
      rankProductionConstraints("10", "t", [limit("line", "0")]),
    ).toMatchObject({ binding: true, availableQuantity: "0", headroom: "-10" });
  });

  it("refuses to rank when a limit is missing or the units differ", () => {
    expect(rankProductionConstraints("50", "t", []).reasons).toEqual([
      "no_limits_declared",
    ]);
    expect(
      rankProductionConstraints("50", "t", [
        limit("crusher", "40"),
        limit("lab", "10", "kg", "quality"),
      ]).reasons,
    ).toEqual(["mixed_units"]);
    const partial = rankProductionConstraints("50", "t", [
      limit("crusher", "40"),
      limit("feed", null, "t", "upstream"),
    ]);
    expect(partial.assessable).toBe(false);
    expect(partial.reasons).toEqual(["unquantified_limit"]);
    expect(partial.primaryKey).toBeNull();
    expect(partial.availableQuantity).toBeNull();
  });

  it("parses a fixed decimal scale and rejects a float-shaped extra digit", () => {
    expect(parseQuantity("0.10")).toBe(100_000n);
    expect(formatQuantity(100_000n)).toBe("0.1");
    expect(parseQuantity("1.0000001")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("01")).toBeNull();
  });
});

describe("studyInputError", () => {
  const draft = (overrides: Partial<StudyDraft> = {}): StudyDraft => ({
    title: "Week 12 crusher limit",
    siteId: "site-1",
    horizonStart: "2026-11-01T00:00:00Z",
    horizonEnd: "2026-11-08T00:00:00Z",
    requiredQuantity: "50",
    unitOfMeasure: "t",
    basis: "Operations committed this tonne total for the week.",
    limits: [
      {
        key: "crusher",
        kind: "equipment",
        availableQuantity: "40",
        unitOfMeasure: "t",
        basis: "The crusher crew stated the week limit from the current liner.",
        assetId: null,
        constraintSignalId: null,
      },
    ],
    ...overrides,
  });

  it("accepts a complete study and a study with no declared limit", () => {
    expect(studyInputError(draft())).toBeNull();
    expect(studyInputError(draft({ limits: [] }))).toBeNull();
  });

  it("refuses a non-positive requirement, a reversed horizon and a duplicate key", () => {
    expect(studyInputError(draft({ requiredQuantity: "0" }))).toMatch(
      /positive/i,
    );
    expect(
      studyInputError(
        draft({
          horizonStart: "2026-11-08T00:00:00Z",
          horizonEnd: "2026-11-01T00:00:00Z",
        }),
      ),
    ).toMatch(/horizon end/i);
    const limits = draft().limits;
    expect(
      studyInputError(draft({ limits: [limits[0], { ...limits[0] }] })),
    ).toMatch(/unique/i);
  });
});
