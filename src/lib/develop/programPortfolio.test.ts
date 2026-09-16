import { describe, expect, it } from "vitest";
import { analyzeProgramSchedule } from "./programPortfolio";

describe("Sync Portfolio program schedule", () => {
  it("turns a green standalone project red when a late predecessor moves its finish", () => {
    const result = analyzeProgramSchedule(
      [
        {
          caseId: "A",
          title: "Power",
          durationMonths: 8,
          earliestStart: "2027-01-01",
          standaloneFinish: "2027-09-01",
        },
        {
          caseId: "B",
          title: "Crusher",
          durationMonths: 6,
          earliestStart: "2027-04-01",
          standaloneFinish: "2027-10-01",
        },
      ],
      [{ predecessorCaseId: "A", successorCaseId: "B" }],
    );
    expect(result.valid).toBe(true);
    expect(result.criticalPathCaseIds.sort()).toEqual(["A", "B"]);
    expect(result.rows.find((row) => row.caseId === "B")).toMatchObject({
      status: "red",
      dependencyAdjustedFinish: "2028-03-01",
    });
  });

  it("refuses a complete forecast when duration evidence is missing", () => {
    const result = analyzeProgramSchedule(
      [
        {
          caseId: "A",
          title: "Power",
          durationMonths: null,
          earliestStart: null,
          standaloneFinish: null,
        },
      ],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.refusals.join(" ")).toContain("Duration is missing");
    expect(result.rows[0].status).toBe("unassessed");
  });

  it("carries the kernel's cycle refusal", () => {
    const result = analyzeProgramSchedule(
      [
        {
          caseId: "A",
          title: "A",
          durationMonths: 1,
          earliestStart: "2027-01-01",
          standaloneFinish: "2027-02-01",
        },
        {
          caseId: "B",
          title: "B",
          durationMonths: 1,
          earliestStart: "2027-01-01",
          standaloneFinish: "2027-02-01",
        },
      ],
      [
        { predecessorCaseId: "A", successorCaseId: "B" },
        { predecessorCaseId: "B", successorCaseId: "A" },
      ],
    );
    expect(result.valid).toBe(false);
    expect(result.refusals.join(" ")).toContain("contains a cycle");
  });
});
