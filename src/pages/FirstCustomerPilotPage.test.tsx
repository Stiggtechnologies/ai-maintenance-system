import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstCustomerPilotPage } from "./FirstCustomerPilotPage";

vi.mock("../services/pilotIntake", () => ({
  submitPilotIntake: vi.fn().mockResolvedValue({ id: "pilot-intake-1" }),
  createPilotOnboardingPackage: vi
    .fn()
    .mockResolvedValue({ id: "onboarding-package-1" }),
}));

describe("FirstCustomerPilotPage", () => {
  it("renders the value proof intake as the primary experience", () => {
    render(<FirstCustomerPilotPage />);

    expect(
      screen.getByText("See your first reliability value proof in 48 hours."),
    ).toBeTruthy();
    expect(screen.getByText("48-hour value proof intake")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Request 48-hour value proof/i }),
    ).toBeTruthy();
    expect(screen.getByText("One-click automated onboarding")).toBeTruthy();
    expect(screen.getByLabelText("Preferred buying path")).toBeTruthy();
    expect(
      screen.getAllByText("Pay per governed agent packet").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Trust and engineering boundary")).toBeTruthy();
  });

  it("confirms the request after a qualified intake is submitted", async () => {
    render(<FirstCustomerPilotPage />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Jordan Lee" },
    });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "jordan@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "North Plant Operations" },
    });
    fireEvent.change(screen.getByLabelText("Asset or system in scope"), {
      target: { value: "P-101 pump train" },
    });
    fireEvent.change(screen.getByLabelText("Primary reliability pain"), {
      target: { value: "Repeat failures on critical assets" },
    });
    fireEvent.change(screen.getByLabelText("Preferred buying path"), {
      target: { value: "Pay per governed agent packet" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Request 48-hour value proof/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Request captured.")).toBeTruthy();
    });
    expect(screen.getByText(/P-101 pump train/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Generate one-click onboarding checklist/i,
      }),
    );
    expect(
      screen.getByText("Automated onboarding package generated"),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByText("Saved to the pilot onboarding queue."),
      ).toBeTruthy();
    });
    expect(screen.getAllByText("Workspace shell").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /Send intake by email/i }),
    ).toBeTruthy();
  });
});
