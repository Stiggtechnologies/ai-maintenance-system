import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldPage } from "./FieldPage";

const listRecentFieldReports = vi.fn();
const reportFailure = vi.fn();

vi.mock("../services/fieldReports", () => ({
  listRecentFieldReports: () => listRecentFieldReports(),
}));

vi.mock("../services/fieldCapture", () => ({
  reportFailure: (...args: unknown[]) => reportFailure(...args),
}));

const REPORT = {
  id: "n-1",
  description: "Hydraulic leak at the boom joint",
  notification_type: "fault",
  status: "open",
  reported_by: "Technician 2",
  created_at: "2026-08-28T06:00:00Z",
  asset_id: "a-1",
  asset_tag: "T301",
  asset_name: "Haul truck T301",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FieldPage", () => {
  it("first paint is the composer, not a how-to landing or /assets hop", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByPlaceholderText("What did you observe?"),
    ).toBeTruthy();
    expect(screen.getByTestId("sample-seed-chip")).toHaveTextContent(
      "Seal weep on the inboard gland",
    );
    expect(screen.queryByLabelText("Camera")).toBeNull();
    expect(screen.queryByLabelText("QR")).toBeNull();
    expect(screen.queryByText(/Find the asset \(then scan its label\)/i)).toBeNull();
    expect(screen.queryByText(/Report a failure on the equipment/i)).toBeNull();
    expect(document.querySelector('[data-layout="chat-first"]')).toBeTruthy();
  });

  it("renders a filed report as a user turn, not a home list", async () => {
    listRecentFieldReports.mockResolvedValue([REPORT]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Hydraulic leak at the boom joint/)).toBeTruthy();
    expect(screen.getByText(/T301/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("surfaces load errors", async () => {
    listRecentFieldReports.mockRejectedValue(new Error("rls refused"));
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/rls refused/i);
  });

  it("sending a note creates a user turn in the thread", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.change(screen.getByPlaceholderText("What did you observe?"), {
      target: { value: "Seal weep on the inboard gland" },
    });
    fireEvent.click(screen.getByTitle("Send message"));
    expect(await screen.findByText("Seal weep on the inboard gland")).toBeTruthy();
  });

  it("QR is a composer tool that attaches to the turn", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText("What did you observe?");
    fireEvent.click(screen.getByTestId("sample-seed-chip"));
    fireEvent.click(screen.getByLabelText("QR"));
    fireEvent.change(screen.getByLabelText("Asset tag or QR payload"), {
      target: { value: "T301" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(screen.getByText("T301")).toBeTruthy();
    expect(screen.getByText(/Asset tag will be sent with this turn/)).toBeTruthy();
    expect(screen.getByLabelText("Camera")).toBeTruthy();
  });
});
