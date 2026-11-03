import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlAssurance } from "./ControlAssurance";

const rpc = vi.fn();
const adoptRetentionPolicy = vi.fn();
const setRetentionLegalHold = vi.fn();
const recordRetentionReview = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

vi.mock("../services/retentionGovernance", () => ({
  adoptRetentionPolicy: (...args: unknown[]) => adoptRetentionPolicy(...args),
  setRetentionLegalHold: (...args: unknown[]) => setRetentionLegalHold(...args),
  recordRetentionReview: (...args: unknown[]) => recordRetentionReview(...args),
}));

const DRAFT = {
  id: "draft-1",
  record_class: "Work-order history",
  table_name: "work_orders",
  retain_years: 7,
  status: "draft",
  legal_hold: false,
  legal_hold_reason: null,
  records: 12,
  beyond_policy: 2,
  oldest_record: "2018-01-02T00:00:00.000Z",
  disposition:
    "Policy is a draft — no disposition until a named human adopts a period",
  basis: "Proposed period pending the operator's own determination.",
  last_review_at: null,
  last_review_note: null,
  counted: true,
};

const ADOPTED = {
  ...DRAFT,
  id: "adopted-1",
  record_class: "Security audit events",
  table_name: "audit_events",
  retain_years: 2,
  status: "adopted",
  beyond_policy: 4,
  disposition:
    "Eligible for review; a review records the human decision and does not destroy records",
  basis: "Adopted from the corporate schedule.",
};

function assurance(canGovern: boolean, canRun = canGovern) {
  return {
    role: canGovern ? "admin" : "ai_admin",
    can_run: canRun,
    can_govern_retention: canGovern,
    latest_run: null,
    retention: {
      policies: [DRAFT, ADOPTED],
      note: "This report counts records against the live policy. It never deletes.",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  adoptRetentionPolicy.mockResolvedValue({ outcome: "adopted" });
  setRetentionLegalHold.mockResolvedValue({ outcome: "hold_placed" });
  recordRetentionReview.mockResolvedValue({ outcome: "reviewed" });
});

describe("ControlAssurance records retention", () => {
  it("shows the live position, including records beyond policy and the oldest record", async () => {
    rpc.mockResolvedValue({ data: assurance(true), error: null });
    render(<ControlAssurance />);
    expect(
      await screen.findByText(
        "This report counts records against the live policy. It never deletes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Work-order history")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(
      screen.getByText(/no disposition until a named human adopts a period/),
    ).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("get_control_assurance", {});
  });

  it("adopts a draft period as the organization's determination", async () => {
    rpc.mockResolvedValue({ data: assurance(true), error: null });
    render(<ControlAssurance />);
    fireEvent.change(
      await screen.findByLabelText("Years for Work-order history"),
      { target: { value: "8" } },
    );
    fireEvent.change(screen.getByLabelText("Basis for Work-order history"), {
      target: {
        value: "Corporate records schedule adopted by the named executive.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Adopt retention period for Work-order history",
      }),
    );
    await waitFor(() =>
      expect(adoptRetentionPolicy).toHaveBeenCalledWith({
        policyId: "draft-1",
        retainYears: 8,
        basis: "Corporate records schedule adopted by the named executive.",
      }),
    );
  });

  it("places a legal hold and records a review without a delete call", async () => {
    rpc.mockResolvedValue({ data: assurance(true), error: null });
    render(<ControlAssurance />);
    fireEvent.change(
      await screen.findByLabelText(
        "Legal hold reason for Security audit events",
      ),
      {
        target: {
          value: "Preserve the audit trail for the open regulator inquiry.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Place legal hold for Security audit events",
      }),
    );
    await waitFor(() =>
      expect(setRetentionLegalHold).toHaveBeenCalledWith({
        policyId: "adopted-1",
        hold: true,
        reason: "Preserve the audit trail for the open regulator inquiry.",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Record retention review for Security audit events",
        }),
      ).toBeEnabled(),
    );
    fireEvent.change(
      screen.getByLabelText("Review note for Security audit events"),
      {
        target: {
          value:
            "Counted four events beyond the adopted period and left them stored.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Record retention review for Security audit events",
      }),
    );
    await waitFor(() =>
      expect(recordRetentionReview).toHaveBeenCalledWith({
        policyId: "adopted-1",
        note: "Counted four events beyond the adopted period and left them stored.",
      }),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      expect.stringMatching(/delete/i),
      expect.anything(),
    );
    expect(
      screen.queryByRole("button", {
        name: "Record retention review for Security audit events",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Adopt retention period for Work-order history",
      }),
    ).toBeInTheDocument();
  });

  it("hides retention acts from an AI administrator who can still run the audit", async () => {
    rpc.mockResolvedValue({ data: assurance(false, true), error: null });
    render(<ControlAssurance />);
    expect(
      await screen.findByRole("button", { name: "Run internal audit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Adopt retention period for Work-order history",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Place legal hold for Work-order history",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the database refusal and does not describe the act as saved", async () => {
    rpc.mockResolvedValue({ data: assurance(true), error: null });
    adoptRetentionPolicy.mockRejectedValue(
      new Error("the human who placed the legal hold cannot release it"),
    );
    render(<ControlAssurance />);
    fireEvent.change(
      await screen.findByLabelText("Basis for Work-order history"),
      {
        target: {
          value: "Corporate records schedule adopted by the named executive.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Adopt retention period for Work-order history",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the human who placed the legal hold cannot release it",
    );
  });
});
