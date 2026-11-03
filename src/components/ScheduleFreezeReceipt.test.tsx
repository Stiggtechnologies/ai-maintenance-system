import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleFreezeReceipt } from "./ScheduleFreezeReceipt";

const getScheduleFreezeReceipts = vi.fn();

vi.mock("../services/scheduleFreezeService", () => ({
  getScheduleFreezeReceipts: () => getScheduleFreezeReceipts(),
}));

const receipt = {
  organization_id: "org-1",
  receipt_count: 1,
  truncated: false,
  boundary: "Reading them does not freeze a week.",
  receipts: [
    {
      audit_id: "audit-1",
      event_time: "2026-11-02T15:00:00.000Z",
      actor: "user-1",
      option_id: "opt-1",
      week_start: "2026-11-02",
      label: "Risk-first",
      actor_role: "planner",
      warnings_acknowledged: 1,
      acknowledgement_supplied: true,
      feasibility_sha256: "abc123",
      boundary:
        "It does not approve a production interruption, release outage scope, authorize work execution, or return equipment to service.",
      checks: [
        {
          constraint: "Production window",
          severity: "warning",
          passed: null,
          detail: "Missing evidence is not a clearance.",
        },
        {
          constraint: "Safety gate",
          severity: "blocking",
          passed: true,
          detail: "Cleared.",
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScheduleFreezeReceipt", () => {
  it("shows the named freeze and the feasibility that was not a pass", async () => {
    getScheduleFreezeReceipts.mockResolvedValue(receipt);
    render(<ScheduleFreezeReceipt />);

    expect(
      await screen.findByRole("heading", { name: "Frozen-week receipts" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Risk-first/)).toBeInTheDocument();
    expect(screen.getByText(/planner/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.getByText(/cannot freeze a week/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /freeze|release/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /show 1 open feasibility check/i }),
    );
    expect(screen.getByText(/Production window/)).toBeInTheDocument();
    expect(screen.getByText(/not assessable/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Missing evidence is not a clearance/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cleared.")).not.toBeInTheDocument();
  });

  it("states that this tenant has not frozen a week", async () => {
    getScheduleFreezeReceipts.mockResolvedValue({
      ...receipt,
      receipt_count: 0,
      receipts: [],
    });
    render(<ScheduleFreezeReceipt />);
    expect(
      await screen.findByText(/No week has been frozen in this tenant yet/i),
    ).toBeInTheDocument();
  });

  it("shows the load failure instead of an empty ledger", async () => {
    getScheduleFreezeReceipts.mockRejectedValue(
      new Error("no organization in session"),
    );
    render(<ScheduleFreezeReceipt />);
    expect(
      await screen.findByText("no organization in session"),
    ).toBeInTheDocument();
  });

  it("says when older receipts stay in the ledger", async () => {
    getScheduleFreezeReceipts.mockResolvedValue({
      ...receipt,
      receipt_count: 120,
      truncated: true,
    });
    render(<ScheduleFreezeReceipt />);
    expect(
      await screen.findByText(/latest 1 of 120 frozen weeks/i),
    ).toBeInTheDocument();
  });
});
