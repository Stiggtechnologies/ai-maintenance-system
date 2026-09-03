/**
 * Cowork Studio — one collaboration surface, role-adapted.
 * Persistence is mocked (RLS lives on cowork_workspaces / cowork_messages);
 * these assertions pin reachability, band framing, and the P-101 ban.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoworkStudio } from "./CoworkStudio";

vi.mock("../hooks/useOnboardingOperatingLoop", () => ({
  useOnboardingOperatingLoop: () => ({ workspaces: [] }),
}));

vi.mock("../services/operatingLoopService", () => ({
  getCoworkWorkspaces: () => Promise.resolve([]),
  createCoworkWorkspaceFromObjective: vi.fn(),
  getCoworkMessages: () => Promise.resolve([]),
  sendCoworkMessage: vi.fn(),
}));

let role = "reliability_engineer";
vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

beforeEach(() => {
  role = "reliability_engineer";
});

function openNewWorkspace() {
  fireEvent.click(screen.getAllByRole("button", { name: /new workspace/i })[0]);
}

function templateLabels(): string[] {
  return screen
    .getAllByTestId(/cowork-template-/)
    .map((button) => button.querySelector(".text-xs.font-semibold")?.textContent)
    .filter((label): label is string => Boolean(label));
}

describe("CoworkStudio", () => {
  it("does not mention Pump P-101", async () => {
    render(<CoworkStudio />);
    expect(await screen.findByRole("heading", { name: "Cowork Studio" })).toBeTruthy();
    openNewWorkspace();
    expect(document.body.textContent).not.toMatch(/P-101/i);
  });

  it("does not funnel into Develop", async () => {
    render(<CoworkStudio />);
    await screen.findByRole("heading", { name: "Cowork Studio" });
    expect(document.body.textContent).not.toMatch(/\/develop\/new/i);
    expect(document.body.textContent).not.toMatch(/import into a development case/i);
  });

  it("frames board as portfolio and leads with Executive Briefing", async () => {
    role = "board";
    render(<CoworkStudio />);
    expect(
      await screen.findByText(/Portfolio collaboration — value, risk/),
    ).toBeTruthy();
    openNewWorkspace();
    expect(templateLabels()[0]).toBe("Executive Briefing Builder");
    expect(templateLabels()[0]).not.toBe("Shift Handover");
  });

  it("frames technician as field and does not lead with Executive Briefing", async () => {
    role = "technician";
    render(<CoworkStudio />);
    expect(
      await screen.findByText(/Field and handover collaboration/),
    ).toBeTruthy();
    openNewWorkspace();
    expect(templateLabels()[0]).toBe("Shift Handover");
    expect(templateLabels()[0]).not.toBe("Executive Briefing Builder");
  });

  it("frames supervisor as crew / work / recovery", async () => {
    role = "supervisor";
    render(<CoworkStudio />);
    expect(
      await screen.findByText(/Crew and work collaboration/),
    ).toBeTruthy();
    openNewWorkspace();
    expect(templateLabels()[0]).toBe("Emergency Recovery");
  });

  it("shows an empty-state that is collaboration, not a demo library", async () => {
    render(<CoworkStudio />);
    expect(await screen.findByTestId("cowork-empty")).toHaveTextContent(
      /collaboration of any intent/i,
    );
    expect(screen.queryByText(/demo library/i)).toBeNull();
  });
});
