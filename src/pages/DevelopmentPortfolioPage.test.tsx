import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { DevelopmentPortfolioResult } from "../services/developmentPortfolioService";

const getDevelopmentPortfolio = vi.fn();
vi.mock("../services/developmentPortfolioService", () => ({
  getDevelopmentPortfolio: () => getDevelopmentPortfolio(),
}));

import { DevelopmentPortfolioPage } from "./DevelopmentPortfolioPage";

describe("D13.03 Development Portfolio page", () => {
  it("renders all nine specified columns and the human decision boundary", async () => {
    getDevelopmentPortfolio.mockResolvedValue({
      rows: [
        {
          caseId: "case-1",
          project: "North plant expansion",
          status: "active",
          stage: "Concept select",
          nextGate: { id: 12, name: "Sanction gate" },
          gateReadiness: {
            percent: 60,
            blocked: true,
            blockers: 1,
            sourceRefs: ["stage_gates:12"],
          },
          costForecast: {
            currency: "CAD",
            deterministic: 100,
            p80: 140,
            refusal: null,
            sourceRefs: ["calculation_runs:run-1"],
          },
          scheduleForecast: {
            deterministicFinish: "2027-01-01",
            p80Finish: "2027-02-15",
            refusal: null,
            sourceRefs: ["calculation_runs:run-1"],
          },
          risk: { openHighCritical: 0, leading: [], absenceNote: "Not proof." },
          operationalReadiness: { percent: 75, hardBlockers: 1, refusal: null },
          benefits: [],
          forecastCurrent: true,
        },
      ],
      caseCount: 1,
      limitations: ["Units are not normalized."],
      decisionBoundary: "Gate passage remains a named human decision.",
    } satisfies DevelopmentPortfolioResult);

    render(
      <MemoryRouter>
        <DevelopmentPortfolioPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText("North plant expansion")).toBeInTheDocument(),
    );
    for (const heading of [
      "Project",
      "Stage",
      "Next gate",
      "Gate readiness",
      "Cost forecast",
      "Schedule forecast",
      "Risk",
      "Operational readiness",
      "Benefit forecast",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    expect(screen.getByText(/BLOCKED.*1 blocker/)).toBeInTheDocument();
    expect(screen.getByText("Units are not normalized.")).toBeInTheDocument();
    expect(
      screen.getByText("Gate passage remains a named human decision."),
    ).toBeInTheDocument();
  });
});
