import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DecisionCaseContinuation } from "./DecisionCaseContinuation";
import { buildSpineDecisionCase } from "../lib/onboarding/decision-case-spine";
import {
  nextRolloutPhase,
  verificationReturnDue,
} from "../lib/decision-case-continuation";
const mocks = vi.hoisted(() => ({
  command: vi.fn(async () => true),
  replay: vi.fn(),
  scope: vi.fn(),
}));
vi.mock("../services/decisionCaseService", () => ({
  loadDecisionCaseReplay: mocks.replay,
  listDecisionCaseRolloutScope: mocks.scope,
}));
const owner = "11111111-1111-4111-8111-111111111111";
const approver = "22222222-2222-4222-8222-222222222222";
function seed() {
  return {
    ...buildSpineDecisionCase({
      question: "Should we review the supplied inspection evidence?",
      intent: "solve",
    }),
    id: owner,
    revision: 1,
  };
}
beforeEach(() => vi.clearAllMocks());
it("retains an internal overdue obligation without sending or claiming completion", async () => {
  const decisionCase = {
    ...seed(),
    verificationReturn: {
      ownerId: owner,
      dueAt: "2020-01-01",
      status: "scheduled" as const,
      delivery: "in_app_only" as const,
    },
  };
  expect(verificationReturnDue(decisionCase)).toBe(true);
  render(
    <DecisionCaseContinuation
      decisionCase={decisionCase}
      userId={owner}
      directory={[]}
      busy={false}
      command={mocks.command}
    />,
  );
  expect(mocks.command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Decision or reminder reason"), {
    target: { value: "I am returning to review the scheduled measurement." },
  });
  fireEvent.click(screen.getByText("Acknowledge verification return"));
  await waitFor(() =>
    expect(mocks.command).toHaveBeenCalledWith("verification_return", {
      action: "acknowledge",
      reason: "I am returning to review the scheduled measurement.",
    }),
  );
});
it("does not offer reopen or reminder ownership to another actor", () => {
  const decisionCase = {
    ...seed(),
    verificationReturn: {
      ownerId: owner,
      dueAt: "2020-01-01",
      status: "scheduled" as const,
      delivery: "in_app_only" as const,
    },
  };
  render(
    <DecisionCaseContinuation
      decisionCase={decisionCase}
      userId={approver}
      directory={[]}
      busy={false}
      command={mocks.command}
    />,
  );
  fireEvent.change(screen.getByLabelText("Decision or reminder reason"), {
    target: { value: "A sufficiently detailed but unauthorized request." },
  });
  expect(screen.getByText("Acknowledge verification return")).toBeDisabled();
  expect(screen.getByText("Reopen for changed evidence")).toBeDisabled();
});
it("a revoked reference offers no live link and a refused historical read exposes no snapshot", async () => {
  mocks.replay.mockRejectedValue(new Error("Saved replay is unavailable"));
  const decisionCase = {
    ...seed(),
    shares: [
      {
        id: approver,
        recipientId: approver,
        createdBy: owner,
        createdAt: "2026-01-01",
        expiresAt: "2030-01-01",
        version: 1,
        status: "revoked" as const,
      },
    ],
  };
  render(
    <DecisionCaseContinuation
      decisionCase={decisionCase}
      userId={owner}
      directory={[]}
      busy={false}
      command={mocks.command}
    />,
  );
  expect(screen.queryByText("Open authenticated replay")).toBeNull();
  fireEvent.click(screen.getByText("Load read-only revision"));
  expect(await screen.findByRole("status")).toHaveTextContent("unavailable");
  expect(screen.queryByText(/current case is unchanged/)).toBeNull();
});
it("the next gate starts with pilot and only advances from accepted standing", () => {
  expect(nextRolloutPhase(seed())).toBe("pilot");
  const accepted = {
    ...seed(),
    rollout: {
      status: "accepted" as const,
      acceptedPhase: "enterprise" as const,
      proposedBy: owner,
      proposal: {} as never,
    },
  };
  expect(nextRolloutPhase(accepted)).toBe("handover");
  expect(
    nextRolloutPhase({
      ...accepted,
      rollout: { ...accepted.rollout, acceptedPhase: "handover" },
    }),
  ).toBeNull();
});
