import { describe, expect, it } from "vitest";
import { resolvePmoFunctionHref, SYNC_PMO_FUNCTIONS } from "./syncPmoWorkspace";

describe("Sync PMO function manifest", () => {
  it("contains exactly the ten functions named by spec I.31", () => {
    expect(SYNC_PMO_FUNCTIONS.map((item) => item.label)).toEqual([
      "Methodology governance",
      "Framework tailoring",
      "Gate calibration",
      "Portfolio health",
      "Resource conflicts",
      "Benchmarking",
      "Performance trends",
      "Lessons",
      "Assurance",
      "Value realization",
    ]);
  });

  it("refuses case-scoped routing until a project is explicitly selected", () => {
    expect(resolvePmoFunctionHref(SYNC_PMO_FUNCTIONS[0], null)).toBeNull();
    expect(resolvePmoFunctionHref(SYNC_PMO_FUNCTIONS[0], "case-1")).toBe(
      "/develop/cases/case-1#governance",
    );
  });

  it("keeps organization-wide functions reachable without invented case context", () => {
    const resources = SYNC_PMO_FUNCTIONS.find(
      (item) => item.key === "resource_conflicts",
    )!;
    const benchmarking = SYNC_PMO_FUNCTIONS.find(
      (item) => item.key === "benchmarking",
    )!;
    expect(resolvePmoFunctionHref(resources, null)).toBe("/sync-field");
    expect(resolvePmoFunctionHref(benchmarking, null)).toBe("/benchmarking");
  });
});
