import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StartHerePage } from "./StartHerePage";

vi.mock("../services/decisionCaseService", () => ({
  createPersistedDecisionCase: vi.fn(),
  savePersistedDecisionCase: vi.fn(),
  loadPersistedDecisionCase: vi.fn(async () => null),
  isPersistedDecisionCase: () => false,
}));

vi.mock("../services/operatingLoopService", () => ({
  getIntegrations: vi.fn(async () => []),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <StartHerePage />
    </MemoryRouter>,
  );
}

describe("StartHerePage (ask-first Decision Case)", () => {
  it("is routed and used as signup returnTo", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const signup = readFileSync("src/pages/Signup.tsx", "utf8");
    const page = readFileSync("src/pages/StartHerePage.tsx", "utf8");
    expect(app).toMatch(/path="\/start"/);
    expect(app).toMatch(/StartHerePage/);
    expect(signup).toMatch(/returnTo=\/start/);
    expect(signup).not.toMatch(/returnTo=\/mission-control/);
    expect(page).toMatch(/InvertedOpeningPage/);
    expect(page).not.toMatch(/start-here-role-pick/);
    expect(readFileSync("src/pages/DecisionCaseSpine.tsx", "utf8")).toMatch(
      /spine-stage-help/,
    );
    expect(page).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(page).not.toMatch(/US\$35/);
  });

  it("opens the ask-first path instead of a permission-role checklist", () => {
    renderPage();
    expect(screen.getByTestId("inverted-opening")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /Get one real engineering decision through Sync in 20 minutes/i,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Ask a real question/i)).toBeTruthy();
    expect(screen.getByTestId("inverted-ask")).toBeTruthy();
    expect(screen.getByTestId("inverted-intent-solve")).toBeTruthy();
    expect(screen.getByTestId("inverted-intent-coordinate")).toBeTruthy();
    expect(screen.getByTestId("inverted-intent-connect")).toBeTruthy();
    expect(screen.queryByTestId("start-here-role-pick")).toBeNull();
    expect(screen.queryByRole("button", { name: "RE" })).toBeNull();
  });
});
