import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");
const page = readFileSync("src/pages/SystemHandoverPage.tsx", "utf8");
const cases = readFileSync("src/pages/DevelopCasesPage.tsx", "utf8");
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/SystemHandoverPanel.tsx",
  "utf8",
);

describe("D13.11 System Handover screen contract", () => {
  it("is reachable from Develop and from a specific case", () => {
    expect(app).toContain('path="/develop/handover"');
    expect(cases).toContain('navigate("/develop/handover")');
    expect(workspace).toContain("`/develop/handover?case=${caseId}`");
  });

  it("selects only a case returned by the existing tenant-scoped case read", () => {
    expect(page).toContain("listDevelopmentCases()");
    expect(page).toContain("items.some(");
    expect(page).toContain("item.id === requestedCaseId");
    expect(page).toContain("cases.find(");
    expect(page).toContain("<SystemHandoverPanel");
  });

  it("reuses the canonical seven-column package and human acceptance module", () => {
    for (const column of [
      "System",
      "Commissioning",
      "Punchlist",
      "As-built",
      "Asset data",
      "Residual risk",
      "Operations acceptance",
    ]) {
      expect(panel).toContain(column);
    }
    expect(panel).toContain("acceptSystemHandoverPackage");
    expect(page).toContain("only the named receiving owner");
  });

  it("does not cross the equipment return-to-service boundary", () => {
    expect(page).toContain("equipment return-to-service workflow");
    expect(page).not.toContain("accept_equipment");
    expect(page).not.toContain('from "./HandoverPage"');
  });
});
