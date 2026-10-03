import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeCreepDetectionPanel } from "./ScopeCreepDetectionPanel";

const getScopeCreepDetection = vi.fn();
vi.mock("../../services/scopeCreepDetectionService", () => ({
  getScopeCreepDetection: () => getScopeCreepDetection(),
}));

beforeEach(() => {
  getScopeCreepDetection.mockResolvedValue({
    reviewedCaseCount: 2,
    flaggedCaseCount: 1,
    method: "Deterministic approved-baseline comparison; no model judgement.",
    limitations: ["A flag is a prompt for investigation, not a determination that scope changed."],
    decisionBoundary: "Only a named human may determine scope change and approve it.",
    cases: [
      {
        caseId: "case-1",
        caseTitle: "North plant expansion",
        status: "active",
        potentialScopeCreepCount: 1,
        evidenceGapCount: 0,
        flags: [
          {
            kind: "unapproved_addition",
            classification: "potential_scope_creep",
            title: "Post-baseline scope has no approved change reference",
            detail: "SG-001: Add a second transfer pump",
            sourceRefs: ["project_scope_changes:growth-1", "development_baselines:baseline-1"],
          },
        ],
      },
    ],
  });
});

describe("ScopeCreepDetectionPanel", () => {
  it("renders advisory flags, provenance and the named-human boundary", async () => {
    render(
      <MemoryRouter>
        <ScopeCreepDetectionPanel />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Scope movement requiring human review")).toBeInTheDocument();
    expect(screen.getByText("Post-baseline scope has no approved change reference")).toBeInTheDocument();
    expect(screen.getByText(/not a determination that scope changed/i)).toBeInTheDocument();
    expect(screen.getByText(/Only a named human may determine scope change/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "North plant expansion" })).toHaveAttribute(
      "href",
      "/develop/cases/case-1",
    );
  });
});
