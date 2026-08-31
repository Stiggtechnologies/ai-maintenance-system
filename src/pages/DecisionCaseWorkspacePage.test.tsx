import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionCaseWorkspacePage } from "./DecisionCaseWorkspacePage";

const recordVerificationResult = vi.fn();

vi.mock("../services/operatingLoopService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/operatingLoopService")
  >("../services/operatingLoopService");
  return {
    ...actual,
    recordVerificationResult: (...args: unknown[]) =>
      recordVerificationResult(...args),
  };
});

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
    recordVerificationResult.mockReset();
  });

  it("first paint is a transcript + composer, not a packet or 4-tab nav", async () => {
    renderWorkspace();
    expect(screen.getAllByText("SyncAI").length).toBeGreaterThan(0);
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
    expect(
      screen.getByText(/Authority: M\. Tran, Reliability Engineer/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Request changes" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delegate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("after Simulate, LEARN is a pointer — not a recorded verification", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(
      await screen.findByText(/M\. Tran approved the controlled plan/),
    ).toBeTruthy();
    expect(screen.getByTestId("disposition-record")).toBeTruthy();
    expect(screen.getByTestId("learn-unpersisted")).toBeTruthy();
    expect(screen.getByText(/no verification obligation/i)).toBeTruthy();
    expect(screen.getByText(/nothing was written/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Learning Loop" })).toHaveAttribute(
      "href",
      "/learning-loop",
    );
    expect(screen.queryByTestId("learn-recorder")).toBeNull();
    expect(screen.queryByText(/Outcome recorded/i)).toBeNull();
    expect(screen.queryByText(/retained/i)).toBeNull();
    expect(screen.queryByText(/LR-/i)).toBeNull();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });

  it("fails if this page claims a recorded verification without the RPC", () => {
    const src = readFileSync("src/pages/DecisionCaseWorkspacePage.tsx", "utf8");
    expect(src).not.toMatch(/Outcome recorded/);
    expect(src).not.toMatch(/recordOutcome/);
    expect(src).not.toMatch(/InThreadLearnRecorder/);
    expect(src).not.toMatch(/recordVerificationResult/);
    expect(src).not.toMatch(/record_verification_result/);
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
    expect(
      screen.queryByText("Reviewing evidence and authority boundary"),
    ).toBeNull();
  });

  it("deep-links a mining conversation without an industry switcher", () => {
    renderWorkspace("/workspace/cases/demo?industry=mining");
    expect(
      screen.getAllByText(/CR-01 primary crusher/i).length,
    ).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/PR-07 stamping press/i).length).toBeGreaterThan(
      0,
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(
      await screen.findByText("What is the reliability question?"),
    ).toBeTruthy();
    expect(screen.queryByTestId("recommendation-turn")).toBeNull();
  });
});
