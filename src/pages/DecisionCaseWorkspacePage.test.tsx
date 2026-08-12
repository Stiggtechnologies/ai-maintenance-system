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
  });

  it("keeps conversation central and generates a governed reply", async () => {
    renderWorkspace();
    expect(screen.getByText("Decision Workspace")).toBeTruthy();
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
      screen.getByRole("button", { name: /Approve controlled plan/i }),
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
});
