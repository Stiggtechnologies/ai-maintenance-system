/**
 * Reliability Assessment Leads renders the admin conversion surface. The
 * service is mocked — RLS/definer invariants are proved in their own lane — so
 * these assertions pin customer reachability: lead -> acceptance form ->
 * activate_ria_from_intake caller -> refresh into persisted state.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotLeads } from "./PilotLeads";
import { formatAlbertaStamp, isOverdue } from "../lib/leads/pilotLeadSla";
import type { PilotIntakeLead } from "../services/pilotIntake";

const listPilotIntakeRequests = vi.fn();
const markPilotLeadResponded = vi.fn();
const listRiaActivationOrganizations = vi.fn();
const activateRiaFromIntake = vi.fn();

vi.mock("../services/pilotIntake", () => ({
  listPilotIntakeRequests: () => listPilotIntakeRequests(),
  markPilotLeadResponded: (id: string) => markPilotLeadResponded(id),
  listRiaActivationOrganizations: () => listRiaActivationOrganizations(),
  activateRiaFromIntake: (input: unknown) => activateRiaFromIntake(input),
}));

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

const orgId = "11111111-1111-4111-8111-111111111111";
const assessmentId = "44444444-4444-4444-8444-444444444444";

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
  first_response_due: "2026-09-14T15:00:00Z",
  first_responded_at: null,
  ria_assessment_id: null,
  activated_organization_id: null,
  activated_by: null,
  activated_at: null,
  commercial_acceptance_reference: null,
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function renderPage() {
  return render(
    <MemoryRouter>
      <PilotLeads />
    </MemoryRouter>,
  );
}

describe("PilotLeads", () => {
  beforeEach(() => {
    listPilotIntakeRequests.mockReset();
    markPilotLeadResponded.mockReset();
    listRiaActivationOrganizations.mockReset();
    activateRiaFromIntake.mockReset();
    markPilotLeadResponded.mockResolvedValue(undefined);
    listRiaActivationOrganizations.mockResolvedValue({
      available: true,
      organizations: [{ id: orgId, name: "Acme Mining" }],
    });
    activateRiaFromIntake.mockResolvedValue({ assessmentId });
  });

  it("shows a plain empty state when there are no leads", async () => {
    listPilotIntakeRequests.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(/No Reliability Intelligence Assessment leads yet/i),
    ).toBeTruthy();
  });

  it("states the current RIA offer rather than the retired 48-hour value proof", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    renderPage();

    expect(await screen.findByText(/US\$35,000 fixed fee/i)).toBeTruthy();
    expect(screen.getByText(/6–8 weeks/i)).toBeTruthy();
    expect(screen.queryByText(/48-hour value-proof/i)).toBeNull();
  });

  it("lists a submitted lead with its queued status and no invented fields", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    renderPage();

    expect(await screen.findByText("Dana Ops")).toBeTruthy();
    expect(screen.getByText("dana@acme.example")).toBeTruthy();
    expect(screen.getByText("Acme Mining")).toBeTruthy();
    expect(screen.getByText("Haul truck fleet")).toBeTruthy();
    expect(screen.getByText("Repeat gearbox failures")).toBeTruthy();
    expect(
      screen.getByText("queued", { selector: "span.rounded-full" }),
    ).toBeTruthy();
  });

  it("shows the first-response deadline in the zone the SLA is defined in", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    renderPage();

    await screen.findByText("Dana Ops");
    const due = formatAlbertaStamp("2026-09-14T15:00:00Z");
    expect(due).toContain("9:00");
    expect(due).toMatch(/MDT|GMT-6/);
    expect(screen.getByText(new RegExp(escapeRegExp(due)))).toBeTruthy();
  });

  it("labels every timestamp with its zone rather than the browser's", () => {
    const stamp = formatAlbertaStamp("2026-01-15T20:30:00Z");
    expect(stamp).toContain("1:30");
    expect(stamp).toMatch(/MST|GMT-7/);
    expect(formatAlbertaStamp(null)).toBe("\u2014");
    expect(formatAlbertaStamp("not a date")).toBe("\u2014");
  });

  it("flags a lead nobody answered by its deadline", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_response_due: "2020-01-06T16:00:00Z" },
    ]);
    renderPage();

    await screen.findByText("Dana Ops");
    expect(screen.getByText(/overdue/i)).toBeTruthy();
  });

  it("does not flag a lead whose deadline has not passed", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_response_due: future },
    ]);
    renderPage();

    await screen.findByText("Dana Ops");
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("does not flag a past deadline once the lead has moved out of 'new'", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      {
        ...lead,
        status: "contacted",
        first_response_due: "2020-01-06T16:00:00Z",
      },
    ]);
    renderPage();

    await screen.findByText("Dana Ops");
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("clears the overdue flag on the field a human can actually write", () => {
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
    renderPage();

    await screen.findByText("Dana Ops");
    expect(screen.getByText(/overdue/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /mark answered/i }));

    await waitFor(() =>
      expect(markPilotLeadResponded).toHaveBeenCalledWith("lead-1"),
    );
    await waitFor(() =>
      expect(listPilotIntakeRequests.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("surfaces a rejected response write instead of pretending it landed", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    markPilotLeadResponded.mockRejectedValue(
      new Error("Pilot leads are administrator-only"),
    );
    renderPage();

    await screen.findByText("Dana Ops");
    fireEvent.click(screen.getByRole("button", { name: /mark answered/i }));

    expect(await screen.findByText(/administrator-only/i)).toBeTruthy();
  });

  it("shows when a lead was answered rather than offering the button again", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      { ...lead, first_responded_at: "2026-09-14T15:30:00Z" },
    ]);
    renderPage();

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
    renderPage();

    await screen.findByText("Dana Ops");
    expect(screen.getByText("\u2014")).toBeTruthy();
    expect(screen.queryByText(/invalid date/i)).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("requires recorded commercial acceptance and sends the bounded scope to activation", async () => {
    listPilotIntakeRequests.mockResolvedValue([lead]);
    renderPage();

    await screen.findByText("Dana Ops");
    fireEvent.click(screen.getByRole("button", { name: /^activate ria$/i }));

    const dialog = await screen.findByRole("dialog", {
      name: /activate reliability intelligence assessment/i,
    });

    fireEvent.change(
      within(dialog).getByLabelText(/commercial acceptance reference/i),
      { target: { value: "SOW-2026-081" } },
    );

    const submit = within(dialog).getByRole("button", {
      name: /^activate ria$/i,
    });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(activateRiaFromIntake).toHaveBeenCalledWith({
        leadId: "lead-1",
        organizationId: orgId,
        scopeLabel: "Haul truck fleet",
        targetEndOn: null,
        acceptanceReference: "SOW-2026-081",
      }),
    );
    expect(
      await screen.findByText(/RIA 44444444.*activated for Acme Mining/i),
    ).toBeTruthy();
    await waitFor(() =>
      expect(listPilotIntakeRequests.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("does not offer a second activation for an already converted lead", async () => {
    listPilotIntakeRequests.mockResolvedValue([
      {
        ...lead,
        ria_assessment_id: assessmentId,
        activated_organization_id: orgId,
        activated_at: "2026-09-15T16:30:00Z",
        activated_by: "admin-user",
        commercial_acceptance_reference: "PO-8841",
      },
    ]);
    renderPage();

    expect(await screen.findByText("Activated")).toBeTruthy();
    expect(screen.getByText(/PO-8841/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^activate ria$/i })).toBeNull();
    const link = screen.getByRole("link", { name: /44444444/i });
    expect(link.getAttribute("href")).toBe(`/assessments/${assessmentId}`);
  });

  it("surfaces a load error instead of a blank surface", async () => {
    listPilotIntakeRequests.mockRejectedValue(new Error("permission denied"));
    renderPage();
    expect(await screen.findByText(/permission denied/i)).toBeTruthy();
  });
});
