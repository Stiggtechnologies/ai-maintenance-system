import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { InvertedOpeningPage } from "./InvertedOpeningPage";
import type { DecisionCase } from "../lib/decision-case";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
const state = vi.hoisted(() => ({
  auth: {
    user: { id: "first" },
    profile: { id: "first", organization_id: "org-one", role: "planner" },
  } as {
    user: { id: string };
    profile: { id: string; organization_id: string; role: string };
  } | null,
  read: vi.fn(),
  replay: vi.fn(),
}));
vi.mock("../components/AuthProvider", () => ({
  useOptionalAuth: () => state.auth,
}));
vi.mock("../services/decisionCaseService", () => ({
  isPersistedDecisionCase: (id: string) => /^[a-f0-9-]{36}$/.test(id),
  loadPersistedDecisionCase: state.read,
  loadDecisionCaseReplay: state.replay,
  createPersistedDecisionCase: vi.fn(),
  listRecentPersistedDecisionCases: vi.fn(),
  listDecisionCaseVerificationReturns: vi.fn(),
}));
vi.mock("./DecisionCaseSpine", () => ({
  DecisionCaseSpine: ({ initialCase }: { initialCase?: DecisionCase }) => (
    <div>{initialCase?.objective}</div>
  ),
}));
vi.mock("../components/PublicJourneyHeader", () => ({
  PublicJourneyHeader: () => <div>Journey</div>,
}));
vi.mock("../lib/use-public-journey-theme", () => ({
  usePublicJourneyTheme: () => "dark",
}));
const id = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  ...createHonestEmptyDecisionCase("Reliability Engineer"),
  id,
  revision: 3,
  objective: "Private saved assessment",
};
beforeEach(() => {
  state.auth = {
    user: { id: "first" },
    profile: { id: "first", organization_id: "org-one", role: "planner" },
  };
  state.read.mockReset();
  state.replay.mockReset();
  window.history.replaceState(
    {},
    "",
    `/get-started?case=${id}&view=evaluation`,
  );
});
it("hides prior tenant content immediately and ignores its late read receipt", async () => {
  let finish!: (value: typeof snapshot) => void;
  state.read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(null);
  const view = render(<InvertedOpeningPage />);
  state.auth = {
    user: { id: "second" },
    profile: { id: "second", organization_id: "org-two", role: "planner" },
  };
  view.rerender(<InvertedOpeningPage />);
  await act(async () => finish(snapshot));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("unavailable"),
  );
  expect(screen.queryByText(snapshot.objective)).toBeNull();
});
it("clears a historical snapshot after revoked-reference refresh and sign out", async () => {
  window.history.replaceState(
    {},
    "",
    `/get-started?case=${id}&replayVersion=3&share=${id}`,
  );
  state.replay.mockResolvedValue(snapshot);
  const view = render(<InvertedOpeningPage />);
  expect(await screen.findByText(/Private saved assessment/)).toBeTruthy();
  state.replay.mockRejectedValue(new Error("revoked"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  await waitFor(() =>
    expect(screen.queryByText(/Private saved assessment/)).toBeNull(),
  );
  state.auth = null;
  view.rerender(<InvertedOpeningPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Sign in");
  expect(screen.queryByText(/Private saved assessment/)).toBeNull();
});
