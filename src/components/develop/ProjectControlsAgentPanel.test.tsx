import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectControlsAgentPanel } from "./ProjectControlsAgentPanel";

vi.mock("../../services/projectControlsAgentService", () => ({ getProjectControlsAgent: vi.fn().mockResolvedValue({ reviewedCaseCount: 1, findingCount: 1, method: "Canonical deterministic composition; no blended score.", limitations: ["Findings do not diagnose cause."], decisionBoundary: "A named human investigates and authorizes any decision.", cases: [{ caseId: "case-1", caseTitle: "Plant expansion", status: "active", posture: "intervene", findings: [{ code: "progress_low", posture: "intervene", title: "Claimed progress materially conflicts with independent evidence", detail: "Claimed 80%; observed 40%.", sourceRefs: ["project_progress_periods:period-1"] }] }] }) }));

describe("ProjectControlsAgentPanel", () => {
  it("renders evidence-backed findings and the human boundary", async () => {
    render(<MemoryRouter><ProjectControlsAgentPanel /></MemoryRouter>);
    expect(await screen.findByText("Controls signals requiring review")).toBeInTheDocument();
    expect(screen.getByText("Claimed progress materially conflicts with independent evidence")).toBeInTheDocument();
    expect(screen.getByText(/named human investigates/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plant expansion" })).toHaveAttribute("href", "/develop/cases/case-1");
  });
});
