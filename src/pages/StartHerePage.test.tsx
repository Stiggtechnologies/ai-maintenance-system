import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { StartHerePage } from "./StartHerePage";

function renderPage() {
  return render(
    <MemoryRouter>
      <StartHerePage />
    </MemoryRouter>,
  );
}

describe("StartHerePage (self-guided moat floor)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is routed and used as signup returnTo", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const signup = readFileSync("src/pages/Signup.tsx", "utf8");
    expect(app).toMatch(/path=\"\/start\"/);
    expect(app).toMatch(/StartHerePage/);
    expect(signup).toMatch(/returnTo=\/start/);
    expect(signup).not.toMatch(/returnTo=\/mission-control/);
    expect(app).toMatch(/path="\/get-started"/);
    expect(app).toMatch(/path="\/decision-cases"/);
    expect(app).toMatch(/path="\/integrations"/);
    expect(app).toMatch(/path="\/field"/);
  });

  it("states ~20 min setup, sequential checklist, and honesty bars", () => {
    const src = readFileSync("src/pages/StartHerePage.tsx", "utf8");
    expect(src).toMatch(/~20 min/);
    expect(src).toMatch(/Recommend is not authorize/);
    expect(src).toMatch(/No plant execute/);
    expect(src).toMatch(/start-here-role-pick/);
    expect(src).toMatch(/id: \"ask\"/);
    expect(src).toMatch(/id: \"learn\"/);
    expect(src).toMatch(/id: \"connector\"/);
    expect(src).toMatch(/href: "\/decision-cases"/);
    expect(src).toMatch(/href: "\/integrations"/);
    expect(src).toMatch(/href: "\/mission-control"/);
    expect(src).toMatch(/href: "\/field"/);
    expect(src).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(src).not.toMatch(/seamless onboarding is live/i);
    expect(src).not.toMatch(/seamless self-guided onboarding is complete/i);
  });

  it("renders the authenticated Start here surface with role pick and doors", () => {
    renderPage();
    expect(screen.getByTestId("start-here-page")).toBeTruthy();
    expect(screen.getByTestId("start-here-role-pick")).toBeTruthy();
    expect(screen.getByTestId("start-here-step-ask")).toBeTruthy();
    expect(screen.getByTestId("start-here-step-recommend")).toBeTruthy();
    expect(screen.getByTestId("start-here-step-approve")).toBeTruthy();
    expect(screen.getByTestId("start-here-step-learn")).toBeTruthy();
    expect(screen.getByTestId("start-here-step-connector")).toBeTruthy();
    expect(screen.getByTestId("start-here-step-stage1")).toBeTruthy();
    expect(screen.getByTestId("start-here-secondary-doors")).toBeTruthy();
    expect(screen.getByRole("button", { name: "RE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ops" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Admin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Field" })).toBeTruthy();
    expect(screen.getByText(/Recommend is not authorize/)).toBeTruthy();
    expect(screen.getByText(/No plant execute/)).toBeTruthy();
  });

  it("persists the local role pick without claiming a server role change", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "RE" }));
    expect(localStorage.getItem("syncai.start-here-role.v1")).toBe(
      "reliability_engineer",
    );
  });
});
