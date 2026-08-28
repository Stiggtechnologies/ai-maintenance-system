/**
 * Field page — E6.13 mobile technician surface. The fieldReports service is
 * mocked (RLS invariants proved elsewhere); these assertions pin: list with
 * loading/empty/loaded states, the QR-scan guidance block, and refresh.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldPage } from "./FieldPage";

const listRecentFieldReports = vi.fn();

vi.mock("../services/fieldReports", () => ({
  listRecentFieldReports: () => listRecentFieldReports(),
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
  it("renders the QR-scan guidance and an empty report list", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Report a failure on the equipment/i)).toBeTruthy();
    expect(screen.getByText(/asset QR label/i)).toBeTruthy();
    expect(screen.getByText(/No field reports filed yet/i)).toBeTruthy();
  });

  it("lists filed reports with type, status and reporter", async () => {
    listRecentFieldReports.mockResolvedValue([REPORT]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Hydraulic leak at the boom joint")).toBeTruthy();
    expect(screen.getByText("fault")).toBeTruthy();
    expect(screen.getByText(/reported by Technician 2/)).toBeTruthy();
    expect(screen.getByText(/T301/)).toBeTruthy();
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

  it("refreshes on demand", async () => {
    listRecentFieldReports.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <FieldPage />
      </MemoryRouter>,
    );
    await screen.findByText(/No field reports filed yet/i);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(listRecentFieldReports).toHaveBeenCalledTimes(2));
  });
});
