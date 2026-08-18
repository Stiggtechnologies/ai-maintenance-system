/**
 * What these tests protect is the truthfulness of the org-wide broadcast.
 * handleApprove/handleReject/handleEditAndApprove shipped with a bare
 * .update().eq() — no error check, no row count — followed by an
 * unconditional broadcast_to_channel. An RLS refusal surfaces as zero
 * updated rows, not as an error, so a write the database refused still
 * announced "decision_approved" to every screen in the organisation. The
 * failure-path tests assert the one thing that matters: when the database
 * writes nothing, nothing is broadcast, and the person clicking the button
 * is told instead of the whole org being misled.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "./ApprovalQueue";

const rpc = vi.fn();
const from = vi.fn();
const getUser = vi.fn();
const alertMock = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
  },
}));

const DECISION = {
  id: "d1",
  decision_type: "create_work_order",
  decision_data: { asset: "P-101" },
  confidence_score: 92,
  status: "pending",
  created_at: new Date().toISOString(),
  approval_deadline: new Date(Date.now() + 7_200_000).toISOString(),
  workflows: [],
};

type UpdateResult = {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
};

let decisionUpdateResult: UpdateResult;

// The defective code awaited .update().eq() directly; the fixed code awaits
// .update().eq().select(). The stub answers both shapes so the failure test
// demonstrates the defect when run against the unfixed component: a bare
// await resolves quietly (data null, as supabase-js returns without
// .select()), while .select() reports the configured row count.
function updateChain(result: UpdateResult) {
  return Object.assign(
    Promise.resolve({ data: null, error: null } as UpdateResult),
    { select: () => Promise.resolve(result) },
  );
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  getUser.mockReset();
  alertMock.mockReset();
  vi.stubGlobal("alert", alertMock);
  getUser.mockResolvedValue({ data: { user: { id: "approver-1" } } });
  rpc.mockResolvedValue({ data: null, error: null });
  decisionUpdateResult = { data: [{ id: "d1" }], error: null };
  from.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: [DECISION], error: null }),
      }),
    }),
    update: () => ({
      eq: () =>
        updateChain(
          table === "autonomous_decisions"
            ? decisionUpdateResult
            : { data: [{ id: "w1" }], error: null },
        ),
    }),
  }));
});

async function renderExpanded() {
  render(<ApprovalQueue />);
  // The expand chevron is the only button until the card is opened.
  fireEvent.click(await screen.findByRole("button"));
  await screen.findByText("Approve");
}

describe("ApprovalQueue", () => {
  it("does not broadcast approval when the database writes zero rows", async () => {
    decisionUpdateResult = { data: [], error: null }; // the RLS-refusal shape
    await renderExpanded();
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(alertMock.mock.calls[0][0]).toMatch(/Failed to approve/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("broadcasts approval only after the database confirms the row", async () => {
    await renderExpanded();
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "broadcast_to_channel",
        expect.objectContaining({
          p_message_type: "decision_approved",
          p_payload: { decision_id: "d1" },
        }),
      ),
    );
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("does not broadcast rejection when the database writes zero rows", async () => {
    decisionUpdateResult = { data: [], error: null };
    await renderExpanded();
    fireEvent.change(
      screen.getByPlaceholderText(/Add your comments or reason/),
      { target: { value: "not safe to execute" } },
    );
    fireEvent.click(screen.getByText("Reject"));
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(alertMock.mock.calls[0][0]).toMatch(/Failed to reject/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not broadcast an edited approval when the database writes zero rows", async () => {
    decisionUpdateResult = { data: [], error: null };
    await renderExpanded();
    fireEvent.click(screen.getByText("Edit & Approve"));
    fireEvent.click(await screen.findByText("Save & Approve"));
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(alertMock.mock.calls[0][0]).toMatch(/Failed to save and approve/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a database error instead of broadcasting", async () => {
    decisionUpdateResult = {
      data: null,
      error: { message: "permission denied for table autonomous_decisions" },
    };
    await renderExpanded();
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(alertMock.mock.calls[0][0]).toMatch(/permission denied/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
