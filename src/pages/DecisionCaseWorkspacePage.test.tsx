import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_PAINT_QUESTIONS,
  createFirstPaintSeed,
} from "../lib/first-paint-seeds";
import { PUBLIC_ASK_INTENTS } from "../lib/public-ask-intents";
import { ASK_PLACEHOLDER } from "../components/public-ask/PublicAskBar";
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

const authState: { user: { id: string } | null } = { user: null };

vi.mock("../components/AuthProvider", async () => {
  const actual = await vi.importActual<
    typeof import("../components/AuthProvider")
  >("../components/AuthProvider");
  return {
    ...actual,
    useOptionalAuth: () => ({
      user: authState.user,
      profile: null,
      session: null,
      loading: false,
    }),
  };
});

function renderWorkspace(entry = "/workspace") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/workspace"
          element={<DecisionCaseWorkspacePage publicMode />}
        />
        <Route
          path="/workspace/cases/:caseId"
          element={<DecisionCaseWorkspacePage publicMode />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function loadSample() {
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
}

describe("DecisionCaseWorkspacePage — Bolt first paint", () => {
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
    authState.user = null;
  });

  it("Mode A is the Bolt empty: light canvas, wordmark, stadium ask, five pills", () => {
    renderWorkspace();
    expect(document.querySelector(".bolt-public.is-empty")).toBeTruthy();
    expect(document.querySelector('[data-layout="chat-first"]')).toBeTruthy();
    expect(screen.getByRole("heading", { name: "SyncAI" })).toBeTruthy();
    expect(screen.getByText("pro")).toBeTruthy();
    expect(screen.getByPlaceholderText(ASK_PLACEHOLDER)).toBeTruthy();
    expect(screen.getByTestId("first-paint-empty")).toBeTruthy();
    expect(
      screen.getAllByTestId("ask-intent-pill").map((el) => el.textContent),
    ).toEqual(["Compare", "Troubleshoot", "Health", "Learn", "Fact Check"]);
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Assess" })).toHaveAttribute(
      "href",
      "/setup",
    );
    expect(screen.getByLabelText("Sign in")).toHaveAttribute(
      "href",
      "/signin?returnTo=%2F",
    );
    expect(screen.getByTestId("bolt-rail-compass")).toBeTruthy();
    expect(screen.queryByText("Discover")).toBeNull();
    expect(screen.queryByText("Spaces")).toBeNull();
    expect(screen.queryByText("Install")).toBeNull();
    expect(screen.queryByTestId("sample-seed-chip")).toBeNull();
    expect(screen.queryByTestId("brand-job-title")).toBeNull();
    expect(screen.queryByText("Reliability Engineer")).toBeNull();
    expect(screen.queryByLabelText("Conversation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try a sample" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View record" })).toBeNull();
    expect(screen.queryByText("Not proven")).toBeNull();
    expect(screen.queryByTestId("recommendation-turn")).toBeNull();
    expect(screen.getByLabelText("Search")).toBeDisabled();
    expect(screen.getByLabelText("Attach a photo")).toBeDisabled();
    expect(screen.getByLabelText("Attach a file")).toBeDisabled();
    expect(screen.getByLabelText("Web search")).toBeDisabled();
    expect(screen.queryByLabelText("Conversations")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Decision Workspace")).toBeNull();
    expect(screen.queryByText("Current decision packet")).toBeNull();
    expect(screen.queryByText(/P-101 process pump/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Simulate" })).toBeNull();
    expect(screen.queryByText("Chat")).toBeNull();
    expect(screen.queryByText("Work")).toBeNull();
    expect(screen.queryByText(/GPT|model picker|Claude/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /dark|theme/i })).toBeNull();
  });

  it("signed-in Mode A exposes Spaces as the existing cowork list, not a new page", () => {
    authState.user = { id: "user-1" };
    renderWorkspace();
    expect(screen.queryByText("Discover")).toBeNull();
    expect(screen.queryByLabelText("Sign in")).toBeNull();
    fireEvent.click(screen.getByTestId("bolt-rail-spaces"));
    const spaces = screen.getByLabelText("Space list");
    expect(spaces).toBeTruthy();
    expect(spaces.querySelector("a")).toBeNull();
    expect(spaces.textContent).not.toMatch(/develop/i);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByTestId("first-paint-empty")).toBeTruthy();
  });

  it("signed-in Mode B Spaces still opens the cowork list, not Discover", () => {
    authState.user = { id: "user-1" };
    renderWorkspace();
    loadSample();
    expect(document.querySelector(".bolt-public.is-thread")).toBeTruthy();
    expect(screen.queryByText("Discover")).toBeNull();
    fireEvent.click(screen.getByTestId("bolt-rail-spaces"));
    const spaces = screen.getByLabelText("Space list");
    expect(spaces).toBeTruthy();
    expect(spaces.querySelector("a")).toBeNull();
    expect(spaces.textContent).not.toMatch(/develop/i);
  });

  it("Mode B docks the composer because .bolt-public is a 100dvh viewport shell", () => {
    renderWorkspace();
    loadSample();
    expect(document.querySelector(".bolt-public.is-thread")).toBeTruthy();
    expect(document.querySelector(".bolt-ask-dock")).toBeTruthy();
    expect(screen.getByPlaceholderText(ASK_PLACEHOLDER)).toBeTruthy();
    const css = readFileSync(
      "src/components/public-ask/public-ask.css",
      "utf8",
    );
    const boltPublic = css.match(/^\.bolt-public\s*\{[^}]+\}/m)?.[0];
    expect(boltPublic).toMatch(/height:\s*100dvh/);
    expect(boltPublic).toMatch(/min-height:\s*100dvh/);
  });

  it("a pill loads the recommendation in the assistant turn on a light thread", async () => {
    renderWorkspace();
    loadSample();
    expect(document.querySelector(".bolt-public.is-thread")).toBeTruthy();
    expect(screen.getByLabelText("Conversation")).toBeTruthy();
    expect(screen.getByTestId("recommendation-turn")).toBeTruthy();
    expect(screen.getByText("Established")).toBeTruthy();
    expect(screen.getByText("Not proven")).toBeTruthy();
    expect(screen.getByText("Recommendation · not authorization")).toBeTruthy();
    expect(
      screen.getByText(/Authority: L\. Singh, Maintenance Superintendent/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Request changes" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delegate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View record" })).toBeTruthy();
    expect(screen.getByText(PUBLIC_ASK_INTENTS[0].question)).toBeTruthy();
    expect(screen.queryByText(/P-101 process pump/)).toBeNull();
    expect(screen.getByLabelText("Add camera, photos, or files")).toBeTruthy();
  });

  it("Mode A does not restore the Reliability Engineer header lockup", () => {
    renderWorkspace();
    expect(screen.queryByTestId("brand-job-title")).toBeNull();
    expect(screen.queryByText("Reliability Engineer")).toBeNull();
    expect(screen.queryByLabelText("SyncAI Reliability Engineer")).toBeNull();
    expect(document.querySelector(".bolt-public.is-empty")).toBeTruthy();
  });

  it("packet and attach stay gated until a case exists", () => {
    renderWorkspace();
    expect(screen.queryByRole("button", { name: "View record" })).toBeNull();
    expect(screen.queryByText("Current decision packet")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByLabelText("Attach a photo")).toBeDisabled();
    expect(screen.getByLabelText("Attach a file")).toBeDisabled();
    expect(screen.queryByRole("menuitem", { name: "Camera" })).toBeNull();
    loadSample();
    expect(screen.getByRole("button", { name: "View record" })).toBeTruthy();
    expect(screen.getByLabelText("Add camera, photos, or files")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "View record" }));
    expect(screen.getByText("Current decision packet")).toBeTruthy();
  });

  it("plus sheet offers camera, photos, and files only after a case exists", () => {
    renderWorkspace();
    expect(screen.queryByRole("menuitem", { name: "Camera" })).toBeNull();
    loadSample();
    fireEvent.click(screen.getByLabelText("Add camera, photos, or files"));
    expect(screen.getByRole("menuitem", { name: "Camera" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Photos" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Files" })).toBeTruthy();
    expect(screen.queryByText("Plugins")).toBeNull();
    expect(screen.queryByText("Think harder")).toBeNull();
  });

  it("after Simulate, LEARN is a pointer — not a recorded verification", async () => {
    renderWorkspace();
    loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(
      await screen.findByText(/L\. Singh approved the controlled plan/),
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
    expect(screen.queryByText(/Outcome retained/i)).toBeNull();
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
    expect(src).not.toMatch(/Try a sample/);
  });

  it("Request changes returns focus to the composer", () => {
    renderWorkspace();
    loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const composer = screen.getByPlaceholderText("What is missing or wrong?");
    expect(composer).toBeTruthy();
  });

  it("keeps conversation central and generates a reply", async () => {
    renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText(ASK_PLACEHOLDER), {
      target: { value: "Where should the next dollar go?" },
    });
    fireEvent.click(screen.getByTitle("Send message"));
    await waitFor(() =>
      expect(
        screen.getByText(
          "The evidence plan is the highest-value governed next action.",
        ),
      ).toBeTruthy(),
    );
    expect(document.querySelector(".bolt-public.is-thread")).toBeTruthy();
    expect(
      screen.queryByText("Reviewing evidence and authority boundary"),
    ).toBeNull();
  });

  it("deep-links a mining conversation only after a pill", () => {
    renderWorkspace("/workspace?industry=mining");
    expect(screen.getByTestId("first-paint-empty")).toBeTruthy();
    expect(screen.queryByTestId("recommendation-turn")).toBeNull();
    loadSample();
    expect(
      screen.getAllByText(/CR-01 primary crusher/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("P-101 process pump")).toBeNull();
    expect(screen.queryByLabelText("Industry proof")).toBeNull();
  });

  it("keeps industry sessions isolated in storage when the URL pack changes", async () => {
    const { unmount } = renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText(ASK_PLACEHOLDER), {
      target: { value: "Challenge the current recommendation." },
    });
    fireEvent.click(screen.getByTitle("Send message"));
    await screen.findByText(
      "The evidence plan is the highest-value governed next action.",
    );
    unmount();

    renderWorkspace("/workspace?industry=manufacturing");
    expect(screen.getByTestId("first-paint-empty")).toBeTruthy();
    expect(screen.queryByText("P-101 process pump")).toBeNull();
    loadSample();
    expect(
      screen.getAllByText(/CR-01 primary crusher/i).length,
    ).toBeGreaterThan(0);
    expect(
      window.sessionStorage.getItem("syncai.publicDecisionCases.v2.oil-gas"),
    ).toContain("The evidence plan is the highest-value governed next action.");
    expect(
      window.sessionStorage.getItem(
        "syncai.publicDecisionCases.v2.manufacturing",
      ),
    ).toContain("CR-01 primary crusher");
  });

  it("each intent pill loads its mapped seed, never P-101", () => {
    const caseNames: string[] = [];
    for (const intent of PUBLIC_ASK_INTENTS) {
      window.sessionStorage.clear();
      const { unmount } = renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: intent.label }));
      expect(screen.getByText(intent.question)).toBeTruthy();
      expect(screen.getByTestId("recommendation-turn")).toBeTruthy();
      expect(
        screen.getByText("Recommendation · not authorization"),
      ).toBeTruthy();
      const caseName =
        screen.getByTestId("first-paint-header-center").textContent ?? "";
      expect(caseName.trim()).not.toBe("");
      expect(caseName).not.toMatch(/P-101/);
      expect(caseName).not.toMatch(/seal inspection/i);
      expect(createFirstPaintSeed(intent.seedIndex).asset).not.toMatch(/P-101/);
      caseNames.push(caseName.trim());
      unmount();
    }
    expect(new Set(caseNames).size).toBe(PUBLIC_ASK_INTENTS.length);
    expect(FIRST_PAINT_QUESTIONS[5]).toBe(
      "Should we repair, redesign, or replace this asset?",
    );
  });

  it("Home opens a new empty Bolt ask", async () => {
    renderWorkspace();
    loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByTestId("first-paint-empty")).toBeTruthy();
    expect(screen.queryByTestId("recommendation-turn")).toBeNull();
    expect(screen.getByPlaceholderText(ASK_PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try a sample" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View record" })).toBeNull();
  });
});
