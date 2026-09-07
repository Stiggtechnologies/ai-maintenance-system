import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InvertedOpeningPage } from "./InvertedOpeningPage";
import { readFileSync } from "node:fs";

vi.mock("../services/decisionCaseService", () => ({
  createPersistedDecisionCase: vi.fn(),
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

function renderOpening() {
  return render(
    <MemoryRouter>
      <InvertedOpeningPage />
    </MemoryRouter>,
  );
}

function openSpine() {
  fireEvent.change(screen.getByTestId("inverted-ask"), {
    target: {
      value:
        "Should we hold or change the current inspection interval on this rotating asset?",
    },
  });
  fireEvent.click(screen.getByTestId("inverted-continue"));
  fireEvent.click(screen.getByTestId("inverted-save-continue"));
}

describe("P0.2 Decision Case spine on /get-started", () => {
  it("does not rewrite the P0.1 opening contract", () => {
    const page = readFileSync("src/pages/InvertedOpeningPage.tsx", "utf8");
    expect(page).toMatch(/Save this assessment and continue/);
    expect(page).toMatch(/inverted-example-/);
    expect(page).toMatch(/inverted-intent-/);
    expect(page).toMatch(/DecisionCaseSpine/);
    expect(page).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(readFileSync("src/App.tsx", "utf8")).toMatch(
      /path=\"\/get-started\"/,
    );
  });

  it("opens the spine after save and auto-builds an honest case", () => {
    renderOpening();
    expect(screen.queryByTestId("decision-case-spine")).toBeNull();
    openSpine();
    expect(screen.getByTestId("decision-case-spine")).toBeTruthy();
    expect(screen.getByTestId("spine-loop").textContent).toMatch(/QUESTION/);
    expect(screen.getByTestId("spine-loop").textContent).toMatch(/LEARNING/);
    expect(screen.getByTestId("spine-lineage").textContent).toMatch(
      /Confidence/,
    );
    expect(screen.getByText(/No connected operating data/)).toBeTruthy();
    expect(screen.queryByText(/Fort McMurray|P-101/)).toBeNull();
  });

  it("adds type-first evidence, records a disposition, and shows verification on accept", () => {
    renderOpening();
    openSpine();
    fireEvent.click(screen.getByTestId("spine-kind-condition"));
    fireEvent.click(screen.getByTestId("spine-method-paste_data"));
    fireEvent.change(screen.getByTestId("spine-evidence-body"), {
      target: { value: "No vibration route is attached. Manual note only." },
    });
    fireEvent.click(screen.getByTestId("spine-add-evidence"));
    fireEvent.change(screen.getByTestId("spine-person-decisionOwner"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByTestId("spine-person-requiredApprover"), {
      target: { value: "Kai" },
    });
    fireEvent.click(screen.getByTestId("spine-disp-accept"));
    fireEvent.change(screen.getByTestId("spine-rationale"), {
      target: { value: "Accept structure only until vibration exists." },
    });
    fireEvent.click(screen.getByTestId("spine-record-disposition"));
    expect(screen.getByTestId("spine-verification")).toBeTruthy();
    fireEvent.change(screen.getByTestId("spine-verify-expected"), {
      target: { value: "Named vibration set before next review" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-date"), {
      target: { value: "2026-09-21" },
    });
    fireEvent.click(screen.getByTestId("spine-record-verification"));
    expect(screen.getByTestId("spine-gate-verification").textContent).toMatch(
      /Met/i,
    );
  });

  it("never dead-ends a failed connection", () => {
    renderOpening();
    openSpine();
    fireEvent.click(screen.getByTestId("spine-method-connect_source"));
    fireEvent.click(screen.getByTestId("spine-connect-fail"));
    expect(screen.getByTestId("spine-connect-fallbacks").textContent).toMatch(
      /Upload a file/,
    );
    expect(screen.getByTestId("spine-connect-fallbacks").textContent).toMatch(
      /Ask an admin later/,
    );
  });
});
