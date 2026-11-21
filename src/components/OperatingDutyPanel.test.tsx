import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatingDutyPanel } from "./OperatingDutyPanel";

const previewOperatingDuty = vi.fn();
const getOperatingDutyReadings = vi.fn();
const recordOperatingDutyReading = vi.fn();

vi.mock("../services/operatingDutyService", () => ({
  previewOperatingDuty: (...args: unknown[]) => previewOperatingDuty(...args),
  getOperatingDutyReadings: (...args: unknown[]) =>
    getOperatingDutyReadings(...args),
  recordOperatingDutyReading: (...args: unknown[]) =>
    recordOperatingDutyReading(...args),
}));

const picture = {
  asset_id: "a1",
  window_days: 90,
  window_from: "2026-08-01T00:00:00Z",
  window_to: "2026-11-03T00:00:00Z",
  starts: 2,
  stops: 1,
  cycles_completed: 1,
  running_open: 1,
  source_start_events: 0,
  source_stop_events: 0,
  excursions: 3,
  trips: 1,
  alarms: 4,
  interlocks: 0,
  states: [
    {
      state: "running",
      hours: 10,
      load_known_hours: 0,
      load_unknown_hours: 10,
      load_pct_time_weighted: null,
    },
  ],
  hours_covered: 10,
  coverage_pct: 0.5,
  source_digest: "digest-a",
  basis: "State hours are covered, but load was not recorded on them. No load is inferred.",
  condition_alerts_consulted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  previewOperatingDuty.mockResolvedValue(picture);
  getOperatingDutyReadings.mockResolvedValue([]);
  recordOperatingDutyReading.mockResolvedValue({
    reading: {
      ...picture,
      id: 9,
      note: "Reviewed with operations",
      recorded_by: "user-1",
      recorded_at: "2026-11-03T12:00:00Z",
    },
    replayed: false,
  });
});

describe("OperatingDutyPanel", () => {
  it("shows counted duty and refuses to present missing load as zero", async () => {
    render(<OperatingDutyPanel assetId="a1" windowDays={90} />);
    expect(await screen.findByText("2 starts")).toBeInTheDocument();
    expect(screen.getByText("1 stop")).toBeInTheDocument();
    expect(screen.getByText("1 cycle")).toBeInTheDocument();
    expect(screen.getByText("3 excursions")).toBeInTheDocument();
    expect(screen.getByText("1 trip")).toBeInTheDocument();
    expect(screen.getByText("not recorded")).toBeInTheDocument();
    expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
    expect(screen.getByTestId("operating-duty-panel")).toHaveTextContent(
      /not condition alerts/,
    );
    expect(previewOperatingDuty).toHaveBeenCalledWith("a1", 90);
  });

  it("retains the reading through the governed caller", async () => {
    render(<OperatingDutyPanel assetId="a1" windowDays={90} />);
    fireEvent.change(await screen.findByLabelText("Operating duty note"), {
      target: { value: "Reviewed with operations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retain this duty reading" }));
    await waitFor(() =>
      expect(recordOperatingDutyReading).toHaveBeenCalledWith(
        "a1",
        90,
        "Reviewed with operations",
      ),
    );
    expect(
      await screen.findByText(/Duty reading retained/),
    ).toBeInTheDocument();
  });

  it("shows a refusal and does not claim the reading was retained", async () => {
    recordOperatingDutyReading.mockRejectedValue(
      new Error("AI cannot record an operating-duty reading; a named human must retain it"),
    );
    render(<OperatingDutyPanel assetId="a1" windowDays={90} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retain this duty reading" }));
    expect(await screen.findByText(/AI cannot record/)).toBeInTheDocument();
    expect(screen.queryByText(/Duty reading retained/)).not.toBeInTheDocument();
  });

  it("says when a retry did not write a second audit row", async () => {
    recordOperatingDutyReading.mockResolvedValue({
      reading: {
        ...picture,
        id: 9,
        note: null,
        recorded_by: "user-1",
        recorded_at: "2026-11-03T12:00:00Z",
      },
      replayed: true,
    });
    render(<OperatingDutyPanel assetId="a1" windowDays={90} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retain this duty reading" }));
    expect(
      await screen.findByText(/No second audit row was written, and the stored note was left as it is/),
    ).toBeInTheDocument();
  });
});
