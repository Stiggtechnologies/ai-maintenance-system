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

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={["/workspace/cases/demo"]}>
      <Routes>
        <Route
          path="/workspace/cases/:caseId"
          element={<DecisionCaseWorkspacePage publicMode />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DecisionCaseWorkspacePage", () => {
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
    window.sessionStorage.clear();
  });

  it("keeps conversation central and generates a governed reply", async () => {
    renderWorkspace();
    expect(screen.getByText("Decision Workspace")).toBeTruthy();
    expect(
      screen.getAllByText("Know where the next reliability dollar should go.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Decision Thread")).toBeTruthy();
    expect(
      screen.getByText(/controlled work, and value trail stay together/i),
    ).toBeTruthy();
    expect(screen.queryByText(/analysis tokens/i)).toBeNull();
    expect(
      screen.getByText("Do not approve the yearly inspection interval."),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByPlaceholderText(/Ask about P-101 process pump/i),
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
  });

  it("closes the governed loop from evidence to verified value", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Evidence5$/i }));
    fireEvent.click(screen.getByRole("button", { name: /CMMS work history/i }));
    expect(screen.getByText("Governed record")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Close evidence"));
    fireEvent.click(screen.getByRole("button", { name: /^Authority$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Simulate controlled approval/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Work$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Record work complete/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Verify measured value/i }),
    );
    expect(screen.getAllByText("Value verified").length).toBeGreaterThan(0);
  });

  it("keeps every production-demo case isolated and excludes drafts from exposure", () => {
    renderWorkspace();
    expect(screen.getByText("$808k governed exposure")).toBeTruthy();
    expect(
      screen.getByText("Active cases").parentElement?.textContent,
    ).toContain("3");

    fireEvent.click(
      screen.getByRole("button", { name: /Decision portfolio/i }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Know where the next reliability dollar should go.",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Decide whether P-101 process pump's seal inspection interval/i,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /C-204 compressorEvidence conflict\$420k/i,
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Determine what is driving C-204 repeat compressor trips",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Evidence5$/i }));
    expect(
      screen.getByText("11 records reconciled to the C-204 hierarchy"),
    ).toBeTruthy();
    expect(
      screen.queryByText("18 records reconciled to the P-101 hierarchy"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Value$/i }));
    expect(screen.getByText("Trip-related downtime")).toBeTruthy();
    expect(screen.getByText("102 h")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /New Decision Case/i }));
    expect(screen.getByText("Define a new governed decision")).toBeTruthy();
    expect(screen.getByText("$808k governed exposure")).toBeTruthy();
  });
});
