import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { submitPilotIntake } from "../../services/pilotIntake";
import { PublicAskEmpty } from "./PublicAskEmpty";

vi.mock("../../services/pilotIntake", () => ({
  submitPilotIntake: vi.fn().mockResolvedValue({ id: "lead-1" }),
}));

describe("PublicAskEmpty", () => {
  it("renders a credible offer, live product entry, and five intent pills", () => {
    const onSelectIntent = vi.fn();
    render(
      <PublicAskEmpty
        askBar={<div>ask-slot</div>}
        onSelectIntent={onSelectIntent}
      />,
    );
    expect(screen.getByRole("heading", { name: "SyncAI" })).toBeTruthy();
    expect(screen.getByText("pro")).toBeTruthy();
    expect(screen.getByText(/defensible engineering decisions/i)).toBeTruthy();
    expect(screen.getByText("US$35,000")).toBeTruthy();
    expect(screen.getByText("6–8 weeks")).toBeTruthy();
    expect(screen.getByText("ask-slot")).toBeTruthy();
    expect(
      screen
        .getAllByTestId("hero-intent-pill")
        .map((item) => item.textContent),
    ).toEqual(["Compare", "Troubleshoot", "Health", "Learn", "Fact Check"]);
    expect(
      screen
        .getAllByTestId("ask-intent-pill")
        .map((item) => item.querySelector("strong")?.textContent),
    ).toEqual(["Compare", "Troubleshoot", "Health", "Learn", "Fact Check"]);
    fireEvent.click(screen.getByRole("button", { name: "Explore Health" }));
    expect(onSelectIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "health",
        module: "Run-or-intervene decision",
        recordTab: "decision",
        seedIndex: 1,
      }),
    );
  });

  it("opens the governed assessment request form from the primary CTA", () => {
    render(
      <PublicAskEmpty askBar={<div>ask-slot</div>} onSelectIntent={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /start an assessment/i }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /where reliability is getting expensive/i,
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Work email")).toBeTruthy();
    expect(
      screen.getByText(/do not include confidential operating data/i),
    ).toBeTruthy();
  });

  it("offers a persistent dark appearance mode", () => {
    window.localStorage.removeItem("syncai-public-theme");
    render(
      <PublicAskEmpty askBar={<div>ask-slot</div>} onSelectIntent={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use dark mode" }));
    expect(screen.getByTestId("first-paint-empty").dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("syncai-public-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light mode" })).toBeTruthy();
  });

  it("submits the minimum buyer context through the existing intake contract", async () => {
    render(
      <PublicAskEmpty askBar={<div>ask-slot</div>} onSelectIntent={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /start an assessment/i }),
    );
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Dana Singh" },
    });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "dana@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "North Plant" },
    });
    fireEvent.change(screen.getByLabelText("Asset or system scope"), {
      target: { value: "Process pumps" },
    });
    fireEvent.change(
      screen.getByLabelText("What reliability problem matters most?"),
      { target: { value: "Repeat seal failures" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /request assessment/i }),
    );

    await waitFor(() => expect(submitPilotIntake).toHaveBeenCalledOnce());
    expect(submitPilotIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Dana Singh",
        company: "North Plant",
        assetScope: "Process pumps",
        primaryPain: "Repeat seal failures",
        commercialModel:
          "Reliability Intelligence Assessment - Standard - US$35,000",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: /scope the right first decision/i,
      }),
    ).toBeTruthy();
  });
});
