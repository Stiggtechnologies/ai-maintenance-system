import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReliabilityLifeDataWorkbench } from "./ReliabilityLifeDataWorkbench";
import {
  LifeEventIdentityCollisionError,
  loadReliabilityLifeData,
  recordComponentLifeEvent,
  runReliabilityLifeDataAgent,
} from "../services/reliabilityLifeDataService";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../services/reliabilityLifeDataService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../services/reliabilityLifeDataService")
  >()),
  loadReliabilityLifeData: vi.fn(),
  recordComponentLifeEvent: vi.fn(),
  runReliabilityLifeDataAgent: vi.fn(),
}));
vi.mock("./CovariateSurvivalWorkbench", () => ({
  CovariateSurvivalWorkbench: () => <div>Stubbed numerical workbench</div>,
}));

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function openCapture() {
  render(<ReliabilityLifeDataWorkbench />);
  await waitFor(() =>
    expect(screen.getByLabelText("Component population")).toHaveValue(
      "synthetic drive",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Record evidence" }));
  fill("Operating hours at removal", "1200");
  fill("Event date", "2026-09-02");
  fill("Work-order reference", "second-explicit-physical-life");
  fill("Source reference", "Independent synthetic removal record");
  fill("Evidence basis", "Explicit synthetic evidence, not customer data.");
}

describe("known missing-life capture remains visible and is not treated as a complete population", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadReliabilityLifeData).mockResolvedValue({
      groups: [
        {
          component: "synthetic drive",
          units: 1,
          failureHours: [1200],
          censoredHours: [],
          otherHours: [],
          plannedIntervalHours: null,
          censoredShare: 0,
          basis: "Explicit synthetic persisted population only.",
        },
      ],
      assets: [
        {
          id: "synthetic-asset",
          name: "Synthetic asset",
          asset_tag: "SYNTHETIC",
        },
      ],
      reports: [],
    });
  });

  it("preserves rejected input, shows the identity gap, and blocks both analysis entry points for that component", async () => {
    vi.mocked(recordComponentLifeEvent).mockRejectedValue(
      new LifeEventIdentityCollisionError(),
    );
    await openCapture();
    fireEvent.click(screen.getByRole("button", { name: "Record life event" }));
    await screen.findByText(/Life event was not recorded/);
    expect(
      screen.getByText(
        /This component has an unresolved physical-life capture/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Operating hours at removal")).toHaveValue(
      1200,
    );
    expect(screen.getByLabelText("Event date")).toHaveValue("2026-09-02");
    expect(screen.getByLabelText("Work-order reference")).toHaveValue(
      "second-explicit-physical-life",
    );
    expect(screen.getByLabelText("Source reference")).toHaveValue(
      "Independent synthetic removal record",
    );
    expect(screen.getByLabelText("Evidence basis")).toHaveValue(
      "Explicit synthetic evidence, not customer data.",
    );
    expect(recordComponentLifeEvent).toHaveBeenCalledTimes(1);
    expect(loadReliabilityLifeData).toHaveBeenCalledTimes(1);
    const run = screen.getByRole("button", { name: "Run governed analysis" });
    const openSurvival = screen.getByRole("button", {
      name: "Open covariate survival workbench",
    });
    expect(run).toBeDisabled();
    expect(openSurvival).toBeDisabled();
    fireEvent.click(run);
    fireEvent.click(openSurvival);
    expect(runReliabilityLifeDataAgent).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Stubbed numerical workbench"),
    ).not.toBeInTheDocument();

    // Merely switching away and back, or recording another event, is not
    // evidence that the previously missing physical life has been reconciled.
    fill("Component population", "another component");
    expect(run).toBeEnabled();
    expect(openSurvival).toBeEnabled();
    fill("Component population", "  SYNTHETIC DRIVE  ");
    expect(run).toBeDisabled();
    expect(openSurvival).toBeDisabled();
    // An independently sourced DIFFERENT synthetic life is not a resolution
    // of the previously rejected source. No production values are invented.
    fill("Operating hours at removal", "1300");
    fill("Work-order reference", "another-synthetic-life");
    fill("Source reference", "Another independent synthetic source");
    vi.mocked(recordComponentLifeEvent).mockResolvedValue(43);
    fireEvent.click(screen.getByRole("button", { name: "Record life event" }));
    await screen.findByText(/Life event 43 recorded/);
    expect(run).toBeDisabled();
    expect(openSurvival).toBeDisabled();
  });

  it("does not invent an identity-gap decision for an unrelated authorization refusal", async () => {
    vi.mocked(recordComponentLifeEvent).mockRejectedValue(
      new Error("authentication required"),
    );
    await openCapture();
    fireEvent.click(screen.getByRole("button", { name: "Record life event" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "authentication required",
    );
    expect(
      screen.queryByText(
        /This component has an unresolved physical-life capture/,
      ),
    ).not.toBeInTheDocument();
    expect(runReliabilityLifeDataAgent).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Operating hours at removal")).toHaveValue(
      1200,
    );
  });

  it("binds a delayed capture collision to its original component, not the component selected while waiting", async () => {
    let rejectCapture!: (error: Error) => void;
    vi.mocked(recordComponentLifeEvent).mockImplementation(
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectCapture = reject;
        }),
    );
    await openCapture();
    fireEvent.click(screen.getByRole("button", { name: "Record life event" }));
    await waitFor(() =>
      expect(recordComponentLifeEvent).toHaveBeenCalledTimes(1),
    );
    fill("Component population", "another component");
    rejectCapture(new LifeEventIdentityCollisionError());
    await screen.findByText(/Life event was not recorded/);
    expect(
      screen.queryByText(
        /This component has an unresolved physical-life capture/,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run governed analysis" }),
    ).toBeEnabled();
    fill("Component population", "synthetic drive");
    expect(
      screen.getByRole("button", { name: "Run governed analysis" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Open covariate survival workbench" }),
    ).toBeDisabled();
    expect(runReliabilityLifeDataAgent).not.toHaveBeenCalled();
  });
});
