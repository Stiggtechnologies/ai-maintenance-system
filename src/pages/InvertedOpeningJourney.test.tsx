import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvertedOpeningPage } from "./InvertedOpeningPage";
import {
  PRODUCT_ENTRY_PATHS,
  productEntryDestination,
} from "../lib/product-entry-paths";
import { createPersistedDecisionCase } from "../services/decisionCaseService";
vi.mock("../components/AuthProvider", () => ({ useOptionalAuth: () => null }));
vi.mock("./DecisionCaseSpine", () => ({
  DecisionCaseSpine: ({ question }: { question: string }) => (
    <div data-testid="spine-fixture">{question}</div>
  ),
}));
vi.mock("../services/decisionCaseService", () => ({
  createPersistedDecisionCase: vi.fn(),
  isPersistedDecisionCase: () => false,
  loadPersistedDecisionCase: vi.fn(),
}));
afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});
describe("ask-first contextual walkthrough", () => {
  it.each(PRODUCT_ENTRY_PATHS)(
    "$id starts empty with bounded context",
    (entry) => {
      window.history.replaceState(
        {},
        "",
        productEntryDestination(entry, {
          source: "microsoft-marketplace",
          campaign: "synthetic-test",
        }),
      );
      render(<InvertedOpeningPage />);
      expect(screen.getByTestId("entry-context")).toHaveTextContent(entry.name);
      expect(screen.getByTestId("inverted-ask")).toHaveValue("");
      expect(screen.queryByTestId("spine-fixture")).toBeNull();
      expect(createPersistedDecisionCase).not.toHaveBeenCalled();
    },
  );
  it("returns, edits and repeats an anonymous question without persisting or mixing cases", () => {
    render(<InvertedOpeningPage />);
    for (const question of [
      "Should we change this inspection interval?",
      "How should we investigate this repeated stoppage?",
    ]) {
      fireEvent.change(screen.getByTestId("inverted-ask"), {
        target: { value: question },
      });
      fireEvent.click(screen.getByTestId("inverted-continue"));
      fireEvent.click(screen.getByTestId("inverted-save-continue"));
      expect(screen.getByTestId("spine-fixture")).toHaveTextContent(question);
      fireEvent.click(
        screen.getByRole("button", { name: "Back to your question" }),
      );
      expect(screen.queryByTestId("spine-fixture")).toBeNull();
      expect(screen.getByTestId("inverted-ask")).toHaveValue(question);
    }
    expect(createPersistedDecisionCase).not.toHaveBeenCalled();
  });
  it("rejects unknown entry or role query as permissions or seeded input", () => {
    window.history.replaceState(
      {},
      "",
      "/get-started?entry=fiction&role=admin&asset=FortMcMurray",
    );
    render(<InvertedOpeningPage />);
    expect(screen.queryByTestId("entry-context")).toBeNull();
    expect(screen.getByTestId("inverted-ask")).toHaveValue("");
    expect(createPersistedDecisionCase).not.toHaveBeenCalled();
  });
});
