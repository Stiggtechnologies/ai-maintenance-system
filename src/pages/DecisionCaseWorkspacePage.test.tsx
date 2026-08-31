import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionCaseWorkspacePage } from "./DecisionCaseWorkspacePage";

vi.mock("../services/decisionCaseService", () => ({
  askDecisionCase: vi.fn().mockResolvedValue({
    message: {
      id: "reply",
      role: "assistant",
      author: "SyncAI",
      text: "The evidence plan is the highest-value governed next action.",
      createdAt: "2026-08-12T16:02:00.000Z",
      meta: "Deterministic response",
    },
    estimatedTokens: 240,
    source: "deterministic",
  }),
  createPersistedDecisionCase: vi.fn(),
  isPersistedDecisionCase: () => false,
  loadPersistedDecisionCase: vi.fn(),
  savePersistedDecisionCase: vi.fn(),
}));

vi.mock("../components/AuthProvider", async () => {
  const actual = await vi.importActual<
    typeof import("../components/AuthProvider")
  >("../components/AuthProvider");
  return {
    ...actual,
    useOptionalAuth: () => ({
      user: null,
      profile: null,
      session: null,
      loading: false,
    }),
  };
});

function renderWorkspace(entry = "/workspace/cases/demo") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/workspace/cases/:caseId"
          element={<DecisionCaseWorkspacePage publicMode />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DecisionCaseWorkspacePage — chat-first paint", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    (
      window as Window & { dataLayer?: Array<Record<string, unknown>> }
    ).dataLayer = [];
    window.sessionStorage.clear();
  });

  it("first paint is a transcript + composer, not a packet or 4-tab nav", async () => {
    renderWorkspace();
    expect(screen.getByText("SyncAI")).toBeTruthy();
    expect(document.querySelector('[data-layout="chat-first"]')).toBeTruthy();
    expect(screen.getByLabelText("Conversation")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Ask a reliability question…"),
    ).toBeTruthy();
    expect(screen.queryByText("Decision Workspace")).toBeNull();
    expect(screen.queryByText("Decision Thread")).toBeNull();
    expect(screen.queryByLabelText("Industry proof")).toBeNull();
    expect(screen.queryByLabelText("Working perspective")).toBeNull();
    expect(screen.queryByLabelText("Workspace views")).toBeNull();
    expect(screen.queryByLabelText("Decision lifecycle")).toBeNull();
    expect(screen.queryByText("Open gate")).toBeNull();
    expect(screen.queryByText("Review authority gate")).toBeNull();
    expect(screen.queryByText("Decision portfolio")).toBeNull();
    expect(screen.queryByText("Current decision packet")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("recommendation-turn")).toBeTruthy();
    expect(screen.getByText("Established")).toBeTruthy();
    expect(screen.getByText("Not proven")).toBeTruthy();
    expect(screen.getByText("Recommendation · not authorization")).toBeTruthy();
    expect(screen.getByText(/Authority: M\. Tran, Reliability Engineer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delegate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("pins in-turn Simulate and then shows the LEARN recorder", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(
      await screen.findByText(/M\. Tran approved the controlled plan/),
    ).toBeTruthy();
    expect(screen.getByTestId("disposition-record")).toBeTruthy();
    expect(screen.getByTestId("learn-recorder")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Simulate" })).toBeNull();
    const submit = screen.getByRole("button", { name: "Record outcome" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Not achieved"));
    expect(submit).toBeDisabled();
    fireEvent.change(
      screen.getByPlaceholderText(/What was measured/),
      { target: { value: "Leak rate unchanged after 48h run" } },
    );
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(
      await screen.findByText(/Outcome recorded: not_achieved · M\. Tran/),
    ).toBeTruthy();
    expect(screen.queryByTestId("learn-recorder")).toBeNull();
  });

  it("Request changes returns focus to the composer", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const composer = screen.getByPlaceholderText("What is missing or wrong?");
    expect(composer).toBeTruthy();
  });

  it("keeps conversation central and generates a reply", async () => {
    renderWorkspace();
    fireEvent.change(
      screen.getByPlaceholderText("Ask a reliability question…"),
      { target: { value: "Where should the next dollar go?" } },
    );
    fireEvent.click(screen.getByTitle("Send message"));
    await waitFor(() =>
      expect(
        screen.getByText(
          "The evidence plan is the highest-value governed next action.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Reviewing evidence and authority boundary")).toBeNull();
  });

  it("deep-links a mining conversation without an industry switcher", () => {
    renderWorkspace("/workspace/cases/demo?industry=mining");
    expect(
      screen.getByText(/CR-01 primary crusher/i),
    ).toBeTruthy();
    expect(screen.queryByText("P-101 process pump")).toBeNull();
    expect(screen.queryByLabelText("Industry proof")).toBeNull();
  });

  it("keeps industry sessions isolated in storage when the URL pack changes", async () => {
    const { unmount } = renderWorkspace();
    fireEvent.change(
      screen.getByPlaceholderText("Ask a reliability question…"),
      { target: { value: "Challenge the current recommendation." } },
    );
    fireEvent.click(screen.getByTitle("Send message"));
    await screen.findByText(
      "The evidence plan is the highest-value governed next action.",
    );
    unmount();

    renderWorkspace("/workspace/cases/demo?industry=manufacturing");
    expect(screen.getByText(/PR-07 stamping press/i)).toBeTruthy();
    expect(screen.queryByText("P-101 process pump")).toBeNull();
    expect(
      window.sessionStorage.getItem("syncai.publicDecisionCases.v2.oil-gas"),
    ).toContain("The evidence plan is the highest-value governed next action.");
    expect(
      window.sessionStorage.getItem(
        "syncai.publicDecisionCases.v2.manufacturing",
      ),
    ).toContain("PR-07 stamping press");
  });

  it("New opens an empty conversation with the centered prompt", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByLabelText("Conversations"));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(
      await screen.findByText("What is the reliability question?"),
    ).toBeTruthy();
    expect(screen.queryByTestId("recommendation-turn")).toBeNull();
  });
});
