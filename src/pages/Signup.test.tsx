import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNUP_INDUSTRY_OPTIONS } from "../lib/industry-catalog";
import {
  attachSpineEvidence,
  buildSpineDecisionCase,
} from "../lib/onboarding/decision-case-spine";
import { stageDecisionCaseHandoff } from "../lib/decision-case";
import { Signup } from "./Signup";

const authHolder = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

const membership = vi.hoisted(() => ({
  hasWorkspace: false,
}));

const signUpMock = vi.hoisted(() => vi.fn());

vi.mock("../components/visual/OperationsLattice", () => ({
  OperationsLattice: () => null,
}));

vi.mock("../hooks/useSpeechOutput", () => ({
  useSpeechOutput: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    speaking: false,
    supported: true,
    engine: "browser",
  }),
}));

vi.mock("../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    enabled: false,
    loading: false,
    error: null,
    refetch: () => undefined,
  }),
}));

vi.mock("../components/AuthProvider", () => ({
  useOptionalAuth: () => ({
    user: authHolder.user,
    profile: null,
    session: null,
    loading: false,
  }),
}));

vi.mock("../lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/auth")>("../lib/auth");
  return {
    ...actual,
    signUp: (...args: unknown[]) => signUpMock(...args),
    hasWorkspaceMembership: vi.fn(async () => membership.hasWorkspace),
  };
});

describe("Signup industry selection", () => {
  beforeEach(() => {
    authHolder.user = null;
    membership.hasWorkspace = false;
    signUpMock.mockReset();
    sessionStorage.clear();
  });

  it("keeps the staged question on the sign-up panel", () => {
    const decision = attachSpineEvidence(
      buildSpineDecisionCase({
        question:
          "Should we hold the inspection interval on the reclaim pump until the next outage?",
        intent: "solve",
      }),
      "inspection",
      "paste_data",
      "Synthetic inspection note kept for signup",
    );
    stageDecisionCaseHandoff(sessionStorage, decision);
    render(<Signup onSuccess={vi.fn()} onTabChange={vi.fn()} />);
    expect(
      screen.getByRole("heading", {
        name: "Create your evaluation workspace.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Sign in to your governed workspace.",
      }),
    ).toBeNull();
    expect(screen.getByTestId("signup-retained-draft")).toHaveTextContent(
      decision.objective,
    );
    expect(screen.getByTestId("signup-retained-draft")).toHaveTextContent(
      "Synthetic inspection note kept for signup",
    );
    expect(screen.getByTestId("signup-retained-draft")).toHaveTextContent(
      "If you open the confirmation link elsewhere, return to this tab and sign in here, or the draft is lost.",
    );
    expect(screen.getByTestId("signup-retained-draft").textContent).not.toMatch(
      /stay with this signup/i,
    );
    expect(document.body.textContent).not.toMatch(/Reliability Engineer case/i);
    expect(document.body.textContent).toMatch(
      /Save the question in this browser as your first Decision Case/,
    );
    expect(document.body.textContent).not.toMatch(
      /Continue the Reliability Engineer work you started/i,
    );
    expect(document.body.textContent).toMatch(
      /This tab still has .* including the question and evidence you started/,
    );
    expect(screen.queryByRole("link", { name: "Talk to us" })).toBeNull();
    expect(screen.getByTestId("self-serve-nav-step")).toHaveTextContent(
      "Finish in this form",
    );
    expect(screen.getByTestId("self-serve-nav-step")).toHaveAttribute(
      "href",
      "#signup-workspace",
    );
  });

  it("uses the canonical catalog and captures a custom industry name", () => {
    render(<Signup onSuccess={vi.fn()} onTabChange={vi.fn()} />);

    const industry = screen.getByLabelText("Industry") as HTMLSelectElement;
    // One unselected placeholder plus every governed catalog option. Keeping
    // this derived prevents a newly shipped pack from being rejected by an
    // unrelated stale cardinality assertion.
    expect(industry.querySelectorAll("option")).toHaveLength(
      SIGNUP_INDUSTRY_OPTIONS.length + 1,
    );
    expect(
      screen.getByRole("option", { name: "Oil Sands" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Buildings & Infrastructure" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).toMatch(
      /Create an isolated evaluation workspace for your first Decision Case/,
    );
    expect(document.body.textContent).not.toMatch(
      /Continue the Reliability Engineer work you started/i,
    );

    fireEvent.change(industry, { target: { value: "custom" } });
    expect(screen.getByLabelText("Industry name")).toBeRequired();
    expect(
      screen.getByRole("link", { name: "Create a workspace" }),
    ).toBeInTheDocument();
  });

  it("does not offer Create a workspace to an account that already exists", async () => {
    authHolder.user = { id: "user-1" };
    membership.hasWorkspace = true;
    render(<Signup onSuccess={vi.fn()} onTabChange={vi.fn()} />);

    expect(
      screen.queryByRole("link", { name: "Create a workspace" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Create your evaluation workspace" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Create a private evaluation workspace",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "You already have an account" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Your workspace is already available/i),
    ).toBeInTheDocument();
  });

  it("does not offer Create a workspace after signup confirmation", async () => {
    signUpMock.mockResolvedValue({
      success: true,
      requiresConfirmation: true,
    });
    render(<Signup onSuccess={vi.fn()} onTabChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Full Name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Analytical Engines" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "reliability" },
    });
    fireEvent.change(screen.getByLabelText("Industry"), {
      target: { value: SIGNUP_INDUSTRY_OPTIONS[0].value },
    });
    fireEvent.change(screen.getByLabelText("Work Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue Reliability Engineer" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Verify your work email" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create a workspace" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Create your evaluation workspace" }),
    ).toBeNull();
    expect(
      screen.getAllByText(/will not create another workspace/i).length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(
      /If you open the confirmation link elsewhere, return to this tab and sign in here, or the draft is lost\./,
    );
    expect(document.body.textContent).not.toMatch(/Reliability Engineer case/i);
  });

  it("sends eval signup through /start, not Mission Control", () => {
    const src = readFileSync("src/pages/Signup.tsx", "utf8");
    expect(src).toContain('"/start"');
    expect(src).toContain("safeAuthReturnTo");
    expect(src).not.toMatch(/returnTo=\/mission-control/);
    expect(src).toContain(
      "window.location.assign(`/signin?returnTo=${encodeURIComponent(returnTo)}`)",
    );
  });
});
