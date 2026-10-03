import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvertedOpeningPage } from "./InvertedOpeningPage";
import { readFileSync } from "node:fs";
import { INVERTED_EXAMPLE_PROMPTS } from "../lib/onboarding/inverted-opening";
import type { DecisionCase } from "../lib/decision-case";

const authHolder = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

const persist = vi.hoisted(() => ({
  createPersistedDecisionCase: vi.fn(async (seed: DecisionCase) => ({
    ...seed,
    id: "11111111-1111-4111-8111-111111111111",
  })),
  savePersistedDecisionCase: vi.fn(async () => undefined),
  loadPersistedDecisionCase: vi.fn(async () => null as DecisionCase | null),
}));

vi.mock("../services/decisionCaseService", () => ({
  createPersistedDecisionCase: persist.createPersistedDecisionCase,
  savePersistedDecisionCase: persist.savePersistedDecisionCase,
  loadPersistedDecisionCase: persist.loadPersistedDecisionCase,
  isPersistedDecisionCase: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ),
}));

vi.mock("../services/operatingLoopService", () => ({
  getIntegrations: vi.fn(async () => []),
}));

vi.mock("../components/AuthProvider", async () => {
  const actual = await vi.importActual<
    typeof import("../components/AuthProvider")
  >("../components/AuthProvider");
  return {
    ...actual,
    useOptionalAuth: () => ({
      user: authHolder.user,
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
  beforeEach(() => {
    authHolder.user = null;
    persist.createPersistedDecisionCase.mockClear();
    persist.savePersistedDecisionCase.mockClear();
    persist.loadPersistedDecisionCase.mockClear();
    localStorage.clear();
  });

  it("does not rewrite the P0.1 opening contract", () => {
    const page = readFileSync("src/pages/InvertedOpeningPage.tsx", "utf8");
    expect(page).toMatch(/Save this assessment and continue/);
    expect(page).toMatch(/What are you here to accomplish/);
    expect(page).toMatch(/inverted-example-/);
    expect(page).toMatch(/inverted-intent-/);
    expect(page).toMatch(/DecisionCaseSpine/);
    expect(page).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(readFileSync("src/App.tsx", "utf8")).toMatch("/get-started");
  });

  it("opens the spine after save and auto-builds an honest case", () => {
    renderOpening();
    expect(screen.queryByTestId("decision-case-spine")).toBeNull();
    openSpine();
    expect(screen.getByTestId("decision-case-spine")).toBeTruthy();
    expect(screen.getByTestId("spine-loop").textContent).toMatch(/QUESTION/);
    expect(screen.getByTestId("spine-loop").textContent).toMatch(/LEARNING/);
    expect(screen.getByTestId("spine-stage-help")).toBeTruthy();
    expect(screen.queryByTestId("start-here-role-pick")).toBeNull();
    expect(screen.getByTestId("spine-lineage").textContent).toMatch(
      /Confidence/,
    );
    expect(
      screen.getAllByText(/No connected operating data/).length,
    ).toBeGreaterThan(0);
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
    expect(screen.getByRole("alert").textContent).toMatch(
      /what would change this recommendation/i,
    );
    fireEvent.change(screen.getByTestId("spine-counterfactual"), {
      target: { value: "A vibration route that contradicts the hold." },
    });
    fireEvent.click(screen.getByTestId("spine-record-disposition"));
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("never dead-ends a failed connection", async () => {
    renderOpening();
    openSpine();
    fireEvent.click(screen.getByTestId("spine-method-connect_source"));
    fireEvent.click(screen.getByTestId("spine-connect-check"));
    expect(
      (await screen.findByTestId("spine-connect-fallbacks")).textContent,
    ).toMatch(/Upload a file/);
    expect(screen.getByTestId("spine-connect-fallbacks").textContent).toMatch(
      /Ask an admin later/,
    );
    expect(screen.getByTestId("spine-connect-fallbacks").textContent).toMatch(
      /No source is connected/,
    );
  });

  it("does not persist an Example prompt into a workspace", () => {
    renderOpening();
    fireEvent.click(
      screen.getByTestId(`inverted-example-${INVERTED_EXAMPLE_PROMPTS[0].id}`),
    );
    fireEvent.click(screen.getByTestId("inverted-continue"));
    fireEvent.click(screen.getByTestId("inverted-save-continue"));
    expect(screen.getByTestId("decision-case-spine")).toBeTruthy();
    expect(screen.getByText(/Example preview/i)).toBeTruthy();
    expect(persist.createPersistedDecisionCase).not.toHaveBeenCalled();
  });

  it("creates the evaluation workspace case when a signed-in user saves", async () => {
    authHolder.user = { id: "user-1" };
    renderOpening();
    openSpine();
    expect(await screen.findByTestId("spine-audit")).toBeTruthy();
    expect(persist.createPersistedDecisionCase).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("spine-unknowns").textContent).toMatch(
      /does not know yet|No connected operating data/i,
    );
    fireEvent.click(screen.getByTestId("spine-method-upload_file"));
    expect(screen.getByTestId("spine-evidence-file")).toBeTruthy();
  });

  it("shows class, provenance, expiry, attribution, and a copyable proof summary", async () => {
    renderOpening();
    openSpine();
    expect(screen.getByTestId("spine-case-class").textContent).toMatch(
      /Review/,
    );
    expect(screen.getByTestId("spine-case-class-basis").textContent).toMatch(
      /Criticality, duty, consequence/,
    );
    expect(screen.getByTestId("spine-unknowns").textContent).toMatch(
      /Criticality, duty, and consequence are not stated/,
    );
    fireEvent.click(screen.getByTestId("spine-provenance-toggle"));
    expect(screen.getByTestId("spine-provenance").textContent).toMatch(
      /cannot cite a source/i,
    );
    fireEvent.click(screen.getByTestId("spine-kind-condition"));
    fireEvent.change(screen.getByTestId("spine-evidence-body"), {
      target: { value: "Manual condition note. No historian pull." },
    });
    fireEvent.click(screen.getByTestId("spine-add-evidence"));
    expect(screen.getByTestId("spine-provenance").textContent).toMatch(
      /Condition/,
    );
    expect(screen.getByTestId("spine-provenance").textContent).toMatch(
      /Manual condition note/,
    );
    expect(screen.getByTestId("spine-case-class").textContent).toMatch(
      /Advisory/,
    );
    fireEvent.change(screen.getByTestId("spine-person-verificationOwner"), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByTestId("spine-disp-accept"));
    fireEvent.change(screen.getByTestId("spine-rationale"), {
      target: { value: "Hold until a route exists." },
    });
    fireEvent.change(screen.getByTestId("spine-counterfactual"), {
      target: { value: "A route that contradicts the hold." },
    });
    fireEvent.change(screen.getByTestId("spine-decision-expiry"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.click(screen.getByTestId("spine-record-disposition"));
    fireEvent.change(screen.getByTestId("spine-verify-expected"), {
      target: { value: "Route attached or interval revisited" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-actual"), {
      target: { value: "Still no route" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-evidence"), {
      target: { value: "Planner note" },
    });
    expect(screen.getByTestId("spine-outcome-attribution").textContent).toMatch(
      /Verification Owner Ada/,
    );
    const proof = screen.getByTestId("spine-proof-body").textContent ?? "";
    expect(proof).toMatch(/## Ask/);
    expect(proof).toMatch(/## Evidence/);
    expect(proof).toMatch(/## Recommendation/);
    expect(proof).toMatch(/## Human decision/);
    expect(proof).toMatch(/## Verification/);
    expect(proof).toMatch(/2026-12-01/);
    expect(proof).toMatch(/A route that contradicts the hold/);
    expect(proof).toMatch(/Verification Owner Ada/);
    expect(proof).not.toMatch(/Fort McMurray|P-101/);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByTestId("spine-proof-copy"));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/## Ask/));
    expect(
      (await screen.findByTestId("spine-proof-notice")).textContent,
    ).toMatch(/copied/i);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:proof");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    fireEvent.click(screen.getByTestId("spine-proof-download"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("shows contextual Help for every Decision Case stage on the shared spine", () => {
    renderOpening();
    openSpine();
    const help = screen.getByTestId("spine-stage-help");
    expect(help.textContent).toMatch(/not a role checklist/i);
    expect(help.textContent).not.toMatch(
      /self-guided onboarding is live|Fort McMurray|P-101/i,
    );
    expect(screen.queryByRole("button", { name: /^RE$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ops$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Admin$/ })).toBeNull();
    const expected = [
      ["question", /not invent a plant/i, "false"],
      ["evidence", /not invent readings/i, "true"],
      ["recommendation", /not authorize/i, "false"],
      ["human-decision", /not choose the disposition/i, "false"],
      ["action", /not write a work order/i, "false"],
      ["verification", /not invent an outcome/i, "false"],
      ["learning", /not promote that candidate/i, "false"],
    ] as const;
    for (const [slug, boundary, active] of expected) {
      const item = screen.getByTestId(`spine-help-${slug}`);
      expect(item.textContent).toMatch(/What to do/i);
      expect(item.textContent).toMatch(boundary);
      expect(item.getAttribute("data-active")).toBe(active);
    }
    expect(screen.getByTestId("spine-help-action").textContent).toMatch(
      /ACTION · locked/,
    );
    expect(screen.getByTestId("spine-help-action").getAttribute("data-locked")).toBe(
      "true",
    );

    fireEvent.change(screen.getByTestId("spine-person-decisionOwner"), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByTestId("spine-disp-accept"));
    fireEvent.change(screen.getByTestId("spine-rationale"), {
      target: { value: "Hold until evidence exists." },
    });
    fireEvent.change(screen.getByTestId("spine-counterfactual"), {
      target: { value: "A route that contradicts the hold." },
    });
    fireEvent.click(screen.getByTestId("spine-record-disposition"));
    expect(
      screen.getByTestId("spine-help-verification").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("spine-help-evidence").getAttribute("data-active"),
    ).toBe("false");

    fireEvent.change(screen.getByTestId("spine-verify-expected"), {
      target: { value: "Interval revisited" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-actual"), {
      target: { value: "Still held" },
    });
    fireEvent.change(screen.getByTestId("spine-verify-evidence"), {
      target: { value: "Planner note" },
    });
    fireEvent.click(screen.getByTestId("spine-effect-inconclusive"));
    fireEvent.click(screen.getByTestId("spine-record-verification"));
    expect(
      screen.getByTestId("spine-help-learning").getAttribute("data-active"),
    ).toBe("true");
    expect(
      screen.getByTestId("spine-help-action").getAttribute("data-active"),
    ).toBe("false");
  });
});
