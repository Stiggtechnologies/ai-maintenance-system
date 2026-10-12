import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createSeedDecisionCases,
  DECISION_CASE_STORAGE_KEY,
  type DecisionCase,
} from "../lib/decision-case";
import { DecisionCaseWorkspacePage } from "./DecisionCaseWorkspacePage";

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), ask: vi.fn() }));
vi.mock("../services/decisionCaseService", () => ({
  isPersistedDecisionCase: (id: string) =>
    id === "11111111-1111-4111-8111-111111111111",
  loadPersistedDecisionCase: api.load,
  savePersistedDecisionCase: api.save,
  askDecisionCase: api.ask,
  createPersistedDecisionCase: vi.fn(),
}));
vi.mock("../components/AuthProvider", () => ({
  useOptionalAuth: () => ({
    user: { id: "test-human" },
    profile: null,
    loading: false,
  }),
}));
vi.mock("../services/operatingLoopService", () => ({
  getOpenVerifications: vi.fn().mockResolvedValue([]),
  getOpenObligationIdForRecommendation: vi.fn().mockResolvedValue(null),
  recordVerificationResult: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let seed: DecisionCase;
beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  seed = {
    ...createSeedDecisionCases()[0],
    id: "11111111-1111-4111-8111-111111111111",
    revision: 1,
  };
  window.localStorage.setItem(
    DECISION_CASE_STORAGE_KEY,
    JSON.stringify([seed]),
  );
  api.load.mockResolvedValue(seed);
});
afterEach(() => vi.useRealTimers());
function mount() {
  render(
    <MemoryRouter initialEntries={[`/workspace/cases/${seed.id}`]}>
      <Routes>
        <Route
          path="/workspace/cases/:caseId"
          element={<DecisionCaseWorkspacePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
it("serializes a delayed user-message save and retains the later assistant reply", async () => {
  const save = deferred<DecisionCase>();
  const reply = deferred<{
    message: DecisionCase["messages"][number];
    estimatedTokens: number;
    source: string;
  }>();
  api.save
    .mockImplementationOnce(() => save.promise)
    .mockImplementation((value: DecisionCase) =>
      Promise.resolve({ ...value, revision: (value.revision ?? 0) + 1 }),
    );
  api.ask.mockReturnValue(reply.promise);
  mount();
  await waitFor(() => expect(api.load).toHaveBeenCalledOnce());
  vi.useFakeTimers();
  fireEvent.change(document.querySelector("textarea")!, {
    target: { value: "What additional evidence should I collect?" },
  });
  fireEvent.click(screen.getByTitle("Send message"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
  expect(api.save).toHaveBeenCalledOnce();
  const submitted = api.save.mock.calls[0][0] as DecisionCase;
  await act(async () => {
    reply.resolve({
      message: {
        id: "later-reply",
        role: "assistant",
        author: "SyncAI",
        text: "Collect the scoped observation.",
        createdAt: "2026-10-10T00:00:00Z",
      },
      estimatedTokens: 240,
      source: "live",
    });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
  expect(api.save).toHaveBeenCalledOnce();
  await act(async () => {
    save.resolve({ ...submitted, revision: 2 });
  });
  expect(screen.getByText("Collect the scoped observation.")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
  expect(api.save).toHaveBeenCalledTimes(2);
  const next = api.save.mock.calls[1][0] as DecisionCase;
  expect(next.revision).toBe(2);
  expect(next.messages.some((message) => message.id === "later-reply")).toBe(
    true,
  );
  expect(next.tokensUsed).toBeGreaterThanOrEqual(submitted.tokensUsed + 240);
});

it("ignores an initial load that arrives after a newer save receipt", async () => {
  const load = deferred<DecisionCase>();
  api.load.mockReturnValue(load.promise);
  api.ask.mockResolvedValue({
    message: {
      id: "new-analysis",
      role: "assistant",
      author: "SyncAI",
      text: "Fresh analysis survives.",
      createdAt: "2026-10-10T00:00:00Z",
    },
    estimatedTokens: 100,
    source: "live",
  });
  api.save.mockImplementation((value: DecisionCase) =>
    Promise.resolve({ ...value, revision: (value.revision ?? 0) + 1 }),
  );
  mount();
  await waitFor(() => expect(api.load).toHaveBeenCalledOnce());
  vi.useFakeTimers();
  fireEvent.change(document.querySelector("textarea")!, {
    target: { value: "What evidence is still missing?" },
  });
  fireEvent.click(screen.getByTitle("Send message"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
  expect(api.save).toHaveBeenCalledOnce();
  await act(async () => {
    load.resolve(seed);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(701);
  });
  for (const [value] of api.save.mock.calls.slice(1)) {
    expect((value as DecisionCase).revision).toBeGreaterThanOrEqual(2);
  }
  expect(screen.getByText("Fresh analysis survives.")).toBeTruthy();
});
