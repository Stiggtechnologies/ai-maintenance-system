import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ReliabilityCopilotPage } from "./ReliabilityCopilotPage";

const FREE_TRIAL_USAGE_STORAGE_KEY = "syncai.reliability.freeUsage.v1";

describe("ReliabilityCopilotPage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/demo/copilot");
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  it("carries value-proof context into the copilot prompt", async () => {
    window.history.replaceState(
      {},
      "",
      "/demo/copilot?asset=P-101%20pump%20train&pain=Repeat%20failures&role=Executive%20sponsor",
    );

    render(<ReliabilityCopilotPage />);

    await waitFor(() => {
      const value = (
        screen.getByLabelText("SyncAI chat input") as HTMLTextAreaElement
      ).value;
      expect(value).toContain("Analyze P-101 pump train");
      expect(value).toContain(
        "Prepare the decision for the Executive sponsor role",
      );
    });
  });

  it("renders a generated reliability report on first load", () => {
    render(<ReliabilityCopilotPage />);

    expect(
      screen.getByText("Know where the next reliability dollar should go."),
    ).toBeTruthy();
    expect(screen.getByText("Full governed value proof included")).toBeTruthy();
    expect(screen.getAllByText("End-to-end").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("SyncAI chat input")).toBeTruthy();
    expect(
      screen.getByText("From approved intent to measured outcome."),
    ).toBeTruthy();
    expect(screen.getByText("Technical authority")).toBeTruthy();
    expect(screen.getAllByText("RCA Report").length).toBeGreaterThan(0);
    expect(screen.getByText(/# RCA Reliability Analysis/)).toBeTruthy();
    expect(screen.getAllByText(/P-101/).length).toBeGreaterThan(0);
    expect(screen.getByText("MTBF")).toBeTruthy();
    expect(screen.getByText("Source Grounding")).toBeTruthy();
    expect(screen.getByText("Governed Recommendation")).toBeTruthy();
    expect(screen.getByText("Data Quality")).toBeTruthy();
    expect(screen.getByText("Guided Asset Onboarding")).toBeTruthy();
    expect(screen.getByText("Analyze a reliability problem")).toBeTruthy();
    expect(screen.getByText("Secure workspace capabilities")).toBeTruthy();
    expect(screen.queryByText(/^disabled$/i)).toBeNull();
  });

  it("regenerates reports from pasted failure history", async () => {
    render(<ReliabilityCopilotPage />);

    const csv = [
      "asset_id,failure_mode,event_date,downtime_hours,repair_hours,maintenance_cost,description",
      "HX-9,Tube leak,2026-05-01,44,12,18000,Heat exchanger tube leak",
      "HX-9,Tube leak,2026-05-12,30,10,14000,Repeat tube leak",
      "P-22,Coupling failure,2026-05-15,3,2,900,Small pump coupling failure",
    ].join("\n");

    fireEvent.click(screen.getByRole("button", { name: "FRACAS" }));
    fireEvent.click(screen.getByText("Add failure-history data"));
    fireEvent.change(screen.getByLabelText("Failure history CSV"), {
      target: { value: csv },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Build decision packet/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("FRACAS Report")).toBeTruthy();
    });
    expect(screen.getByText(/# FRACAS Reliability Analysis/)).toBeTruthy();
    expect(screen.getAllByText(/HX-9/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/74 downtime hours, 2 failures/).length,
    ).toBeGreaterThan(0);
  });

  it("starts asset onboarding from a slash command and advances progress", () => {
    render(<ReliabilityCopilotPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Guided Asset Onboarding/i }),
    );

    fireEvent.change(screen.getByLabelText("Asset onboarding command"), {
      target: { value: "/onboard conveyor CV-204" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start Onboarding/i }));

    expect(screen.getAllByText(/CV-204/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Conveyor/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Current step: Asset identity/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Save Step And Continue/i }),
    );

    expect(screen.getByText(/Current step: Hierarchy/)).toBeTruthy();
  });

  it("shows the secure workspace cutoff when free capacity is exhausted", async () => {
    window.localStorage.setItem(
      FREE_TRIAL_USAGE_STORAGE_KEY,
      JSON.stringify({ tokensUsed: 60000, decisionPackets: 3 }),
    );
    render(<ReliabilityCopilotPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /Build decision packet/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/included free analysis capacity/i)).toBeTruthy();
    });
    expect(
      screen.getAllByText(/Start 48-hour value proof/i).length,
    ).toBeGreaterThan(0);
  });
});
