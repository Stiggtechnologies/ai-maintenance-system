/**
 * PilotLeads renders the admin leads surface: the queued lead the RLS scope
 * returns, and the plain empty-state when there are none (the leads table is
 * empty today). The service is mocked — RLS admin-scoping is proven separately
 * in src/test/pilotLeadsAdminOnly.test.ts — so these assertions are only about
 * what the page does with the rows it is handed.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotLeads } from "./PilotLeads";
import type { PilotIntakeLead } from "../services/pilotIntake";

const listPilotIntakeRequests = vi.fn();

vi.mock("../services/pilotIntake", () => ({
  listPilotIntakeRequests: () => listPilotIntakeRequests(),
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
};

describe("PilotLeads", () => {
  beforeEach(() => {
    listPilotIntakeRequests.mockReset();
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

  it("surfaces a load error instead of a blank surface", async () => {
    listPilotIntakeRequests.mockRejectedValue(new Error("permission denied"));
    render(<PilotLeads />);
    expect(await screen.findByText(/permission denied/i)).toBeTruthy();
  });
});
