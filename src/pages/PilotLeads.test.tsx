/**
 * PilotLeads renders the admin leads surface: the queued lead the RLS scope
 * returns, and the plain empty-state when there are none (the leads table is
 * empty today). The service is mocked — RLS admin-scoping is proven separately
 * in src/test/pilotLeadsAdminOnly.test.ts — so these assertions are only about
 * what the page does with the rows it is handed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotLeads } from "./PilotLeads";
import { formatAlbertaStamp, isOverdue } from "../lib/leads/pilotLeadSla";
import type { PilotIntakeLead } from "../services/pilotIntake";

const listPilotIntakeRequests = vi.fn();
const markPilotLeadResponded = vi.fn();

vi.mock("../services/pilotIntake", () => ({
  listPilotIntakeRequests: () => listPilotIntakeRequests(),
  markPilotLeadResponded: (id: string) => markPilotLeadResponded(id),
}));

// Realtime is the page's other Supabase dependency; the rendered rows do not
// depend on the stream, only on the data the service returns.
vi.mock("../lib/supabase", () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return {
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

const lead: PilotIntakeLead = {
  id: "lead-1",
  created_at: "2026-09-13T10:00:00Z",
  status: "new",
  name: "Dana Ops",
  email: "dana@acme.example",
  company: "Acme Mining",
  role: "Reliability leader",
  industry: "Mining",
  asset_scope: "Haul truck fleet",
  primary_pain: "Repeat gearbox failures",
  notification_status: "queued",
  source_path: "/pilot/reliability",
  // created_at is Sunday 2026-09-13, outside Alberta business hours, so the
  // one-business-hour deadline is Monday 09:00 MDT — exactly what
  // public.business_hours_deadline writes for this row.
  first_response_due: "2026-09-14T15:00:00Z",
  first_responded_at: null,
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("PilotLeads", () => {
  beforeEach(() => {
    listPilotIntakeRequests.mockReset();
    markPilotLeadResponded.mockReset();
    markPilotLeadResponded.mockResolvedValue(undefined);
  });

  it("shows a plain empty state when there are no leads", async () => {
    listPilotIntakeRequests.mockResolvedValue([]);
    render(<PilotLeads />);
    expect(await screen.findByText(/No pilot-intake leads yet/i)).toBeTruthy();
  });

  it("lists a submitted lead with its queued status and no invented fields", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    render(<PilotLeads />);

    expect(await screen.findByText("Dana Ops")).toBeTruthy();
    expect(screen.getByText("dana@acme.example")).toBeTruthy();
    expect(screen.getByText("Acme Mining")).toBeTruthy();
    expect(screen.getByText("Haul truck fleet")).toBeTruthy();
    expect(screen.getByText("Repeat gearbox failures")).toBeTruthy();
    // The submitted status is shown verbatim in the row's status badge — the
    // lead sits at queued. Scoped to the badge span so it is not confused with
    // the word "queued" in the page's description copy.
    expect(
      screen.getByText("queued", { selector: "span.rounded-full" }),
    ).toBeTruthy();
  });

  it("shows the first-response deadline in the zone the SLA is defined in", async () => {
    // The SLA clock is the whole point of the notification path — an admin has
    // to be able to see when each lead's answer is owed, and in WHICH zone.
    // 15:00Z on 2026-09-14 is 09:00 MDT, the Monday-morning deadline
    // business_hours_deadline writes for a Sunday lead. Rendered in the
    // browser's zone with no label, an owner on a UTC machine reads 15:00.
    listPilotIntakeRequests.mockResolvedValue([lead]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    const due = formatAlbertaStamp("2026-09-14T15:00:00Z");
    expect(due).toContain("9:00");
    expect(due).toMatch(/MDT|GMT-6/);
    expect(screen.getByText(new RegExp(escapeRegExp(due)))).toBeTruthy();
  });

  it("labels every timestamp with its zone rather than the browser's", () => {
    // Pure-function guard: whatever TZ the runner is in, the stamp is Alberta.
    const stamp = formatAlbertaStamp("2026-01-15T20:30:00Z");
    expect(stamp).toContain("1:30");
    expect(stamp).toMatch(/MST|GMT-7/);
    expect(formatAlbertaStamp(null)).toBe("\u2014");
    expect(formatAlbertaStamp("not a date")).toBe("\u2014");
  });

  it("flags a lead nobody answered by its deadline", async () => {
    // Deadline in the past and still sitting at pipeline status 'new'.
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_response_due: "2020-01-06T16:00:00Z" },
    ]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    expect(screen.getByText(/overdue/i)).toBeTruthy();
  });

  it("does not flag a lead whose deadline has not passed", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_response_due: future },
    ]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("does not flag a past deadline once the lead has moved out of 'new'", async () => {
    // A contacted lead is not cold, whatever the clock says.
    listPilotIntakeRequests.mockResolvedValue([
      {
        ...lead,
        status: "contacted",
        first_response_due: "2020-01-06T16:00:00Z",
      },
    ]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("clears the overdue flag on the field a human can actually write", () => {
    // `status` is unwritable: pilot_intake_requests has exactly one RLS policy
    // and it is SELECT. Keying the flag on it meant it could never clear, so
    // within a week every lead is red and the one cold-lead signal in the
    // product is noise. first_responded_at is what mark_pilot_lead_responded
    // sets, and it is what clears the flag.
    const stale = { ...lead, first_response_due: "2020-01-06T16:00:00Z" };
    expect(isOverdue(stale)).toBe(true);
    expect(
      isOverdue({ ...stale, first_responded_at: "2020-01-06T15:00:00Z" }),
    ).toBe(false);
  });

  it("records a response through the admin RPC and refreshes", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_response_due: "2020-01-06T16:00:00Z" },
    ]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    expect(screen.getByText(/overdue/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /mark answered/i }));

    await waitFor(() =>
      expect(markPilotLeadResponded).toHaveBeenCalledWith("lead-1"),
    );
    // A second read is what makes the row stop being red.
    await waitFor(() =>
      expect(listPilotIntakeRequests.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("surfaces a rejected response write instead of pretending it landed", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    markPilotLeadResponded.mockRejectedValue(
      new Error("Pilot leads are administrator-only"),
    );
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    fireEvent.click(screen.getByRole("button", { name: /mark answered/i }));

    expect(await screen.findByText(/administrator-only/i)).toBeTruthy();
  });

  it("shows when a lead was answered rather than offering the button again", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_responded_at: "2026-09-14T15:30:00Z" },
    ]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    expect(screen.queryByRole("button", { name: /mark answered/i })).toBeNull();
    expect(
      screen.getByText(
        new RegExp(escapeRegExp(formatAlbertaStamp("2026-09-14T15:30:00Z"))),
      ),
    ).toBeTruthy();
  });

  it("renders an em dash rather than a blank when no deadline was written", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_response_due: null },
    ]);
    render(<PilotLeads />);

    await screen.findByText("Dana Ops");
    // The em dash itself, not merely the absence of "overdue" — the previous
    // version of this test also passed when the cell rendered nothing at all,
    // or "Invalid Date".
    expect(screen.getByText("\u2014")).toBeTruthy();
    expect(screen.queryByText(/invalid date/i)).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("surfaces a load error instead of a blank surface", async () => {
    listPilotIntakeRequests.mockRejectedValue(new Error("permission denied"));
    render(<PilotLeads />);
    expect(await screen.findByText(/permission denied/i)).toBeTruthy();
  });
});
