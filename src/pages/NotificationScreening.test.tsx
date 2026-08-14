/**
 * The point of these tests is REACHABILITY, not cosmetics.
 *
 * The migrations behind this page shipped before it and sat unreachable: a
 * grep for maintenance_notifications across src/ returned nothing, so the
 * screening lifecycle had never had a transition written from the product and
 * the duplicate detector had no surface. These tests assert that each database
 * function actually has a caller and is invoked with the arguments it expects —
 * which is the specific failure that let three slices ship as schema only.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationScreening from "./NotificationScreening";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

const NOTIFICATION = {
  id: "n1",
  notification_no: "NOTIF-1",
  description: "Oil leak at pump outboard seal",
  notification_type: "fault",
  reported_by: "Day shift operator",
  reported_at: "2026-08-13T06:00:00.000Z",
  status: "open",
  asset_id: "a1",
  asset_name: "Conveyor C-22",
  work_order_id: null,
};

const CANDIDATE = {
  keep_id: "n1",
  keep_no: "NOTIF-1",
  keep_description: "Oil leak at pump outboard seal",
  duplicate_id: "n2",
  duplicate_no: "NOTIF-2",
  duplicate_description: "Oil leaking from outboard seal",
  hours_apart: 4,
  similarity: 0.75,
  rationale: "Same asset, reported 4 hours apart.",
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_open_notifications") return Promise.resolve({ data: [NOTIFICATION], error: null });
    if (fn === "get_duplicate_notification_candidates")
      return Promise.resolve({ data: [CANDIDATE], error: null });
    return Promise.resolve({ data: { id: "n1", status: "ok" }, error: null });
  });
  from.mockReturnValue({
    select: () => ({ order: () => Promise.resolve({ data: [{ id: "a1", name: "Conveyor C-22" }], error: null }) }),
  });
});

describe("NotificationScreening", () => {
  it("calls the queue and duplicate-candidate functions on mount", async () => {
    render(<NotificationScreening />);
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("get_open_notifications", {});
      expect(rpc).toHaveBeenCalledWith("get_duplicate_notification_candidates", {});
    });
  });

  it("renders the open queue and the duplicate pair", async () => {
    render(<NotificationScreening />);
    // The description appears twice by design — once in the open queue, once as
    // the surviving report of the duplicate pair — so assert on both surfaces
    // rather than pretending it is unique.
    expect((await screen.findAllByText(/Oil leak at pump outboard seal/)).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText(/4h apart, 75% similar/)).toBeInTheDocument();
    expect(await screen.findByText(/Conveyor C-22/)).toBeInTheDocument();
  });

  it("screens a notification into planning through the database function", async () => {
    render(<NotificationScreening />);
    fireEvent.click(await screen.findByText("Accept into planning"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("screen_maintenance_notification", {
        p_id: "n1",
        p_status: "in_planning",
        p_reason: null,
      }),
    );
  });

  it("requires a human confirmation before merging, and never merges without one", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NotificationScreening />);
    fireEvent.click(await screen.findByText("Confirm duplicate"));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalledWith("merge_maintenance_notification", expect.anything());

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText("Confirm duplicate"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("merge_maintenance_notification", {
        p_duplicate_id: "n2",
        p_keep_id: "n1",
        p_note: null,
      }),
    );
    confirmSpy.mockRestore();
  });

  it("surfaces the database's own refusal sentence rather than a generic error", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_open_notifications") return Promise.resolve({ data: [NOTIFICATION], error: null });
      if (fn === "get_duplicate_notification_candidates") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({
        data: { error: "screening a notification requires a planning, engineering or administrator role" },
        error: null,
      });
    });
    render(<NotificationScreening />);
    fireEvent.click(await screen.findByText("Accept into planning"));
    expect(
      await screen.findByText(/requires a planning, engineering or administrator role/),
    ).toBeInTheDocument();
  });
});
