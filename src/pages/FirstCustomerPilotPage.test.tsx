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
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeTruthy();
    expect(screen.getByText("1. Decision")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Try the live copilot/i }),
    ).toBeTruthy();
    expect(screen.getByText("One-click automated onboarding")).toBeTruthy();
    expect(screen.getByText("Trust and engineering boundary")).toBeTruthy();
  });

  it("uses role outcome tiles to personalize the intake", () => {
    render(<FirstCustomerPilotPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Executive.*finance sponsor/i }),
    );

    expect(screen.getByLabelText("Your role")).toHaveValue(
      "Executive / finance sponsor",
    );
    expect(screen.getByLabelText("Decision you need to improve")).toHaveValue(
      "Need to prove whether actions created value",
    );
  });

  it("confirms the request after a qualified intake is submitted", async () => {
    render(<FirstCustomerPilotPage />);

    fireEvent.change(screen.getByLabelText("Your role"), {
      target: { value: "Reliability leader" },
    });
    fireEvent.change(screen.getByLabelText("Industry"), {
      target: { value: "Oil and gas" },
    });
    fireEvent.change(
      screen.getByLabelText("Asset, system, line, or failure pattern"),
      {
        target: { value: "P-101 pump train" },
      },
    );
    fireEvent.change(screen.getByLabelText("Decision you need to improve"), {
      target: { value: "Repeat failures on critical assets" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    fireEvent.change(screen.getByLabelText("CMMS / EAM"), {
      target: { value: "SAP PM / S/4HANA" },
    });
    fireEvent.change(screen.getByLabelText("Work-order history available"), {
      target: { value: "12-24 months with failure history" },
    });
    fireEvent.change(
      screen.getByLabelText("Preferred path after value is proven"),
      {
        target: { value: "Pay per governed agent packet" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Jordan Lee" },
    });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "jordan@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "North Plant Operations" },
    });
    fireEvent.change(
      screen.getByLabelText("Anything we should know? (optional)"),
      {
        target: { value: "P-101 pump train" },
      },
    );

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
      screen.getByRole("link", { name: /Open personalized copilot/i }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Email a copy/i })).toBeTruthy();
  });
});
