import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { DevelopmentPortfolioRow } from "../../lib/develop/developmentPortfolio";
import { ProjectInterventionTriagePanel } from "./ProjectInterventionTriagePanel";

const blockedRow = {
  caseId: "case-1",
  project: "North plant renewal",
  status: "active",
  stage: "Execute",
  nextGate: { id: 11, name: "Ready for startup" },
  gateReadiness: {
    percent: 70,
    blocked: true,
    blockers: 2,
    sourceRefs: ["stage_gates:11", "criterion:7"],
  },
  costForecast: {
    currency: "CAD",
    deterministic: 100,
    p80: 130,
    refusal: null,
    sourceRefs: ["calculation_runs:run-1"],
  },
  scheduleForecast: {
    deterministicFinish: "2027-01-01",
    p80Finish: "2027-02-01",
    refusal: null,
    sourceRefs: ["calculation_runs:run-1"],
  },
  risk: {
    openHighCritical: 1,
    leading: [{ id: "risk-1", title: "Barrier unavailable", level: "Critical" }],
    absenceNote: null,
    sourceRefs: ["risk_register:risk-1"],
  },
  operationalReadiness: {
    percent: 80,
    hardBlockers: 0,
    refusal: null,
    sourceRefs: ["assets:asset-1"],
  },
  benefits: [],
  forecastCurrent: true,
} satisfies DevelopmentPortfolioRow;

describe("ProjectInterventionTriagePanel", () => {
  it("renders ordered reasons, source trails and the human decision boundary", () => {
    render(
      <MemoryRouter>
        <ProjectInterventionTriagePanel rows={[blockedRow]} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Which projects need attention—and why")).toBeInTheDocument();
    expect(screen.getByText("Open Critical project risk")).toBeInTheDocument();
    expect(screen.getByText("Next gate is blocked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "North plant renewal" })).toHaveAttribute(
      "href",
      "/develop/cases/case-1",
    );
    expect(screen.getByText(/named human must investigate/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence gaps are not adverse findings/i)).toBeInTheDocument();
  });
});
