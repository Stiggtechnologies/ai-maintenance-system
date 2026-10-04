import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvertedOpeningPage } from "./InvertedOpeningPage";
import { DecisionCaseSpine } from "./DecisionCaseSpine";
import { readFileSync } from "node:fs";
import { INVERTED_EXAMPLE_PROMPTS } from "../lib/onboarding/inverted-opening";
import type { DecisionCase } from "../lib/decision-case";
import {
  applyDisposition,
  applyInvite,
  applyVerificationPlan,
  buildSpineDecisionCase,
  recordSourceCheck,
} from "../lib/onboarding/decision-case-spine";

const authHolder = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { role: string } | null,
}));

const persist = vi.hoisted(() => ({
  caseState: null as DecisionCase | null,
  createPersistedDecisionCase: vi.fn(async (seed: DecisionCase) => {
    const created = {
      ...seed,
      id: "11111111-1111-4111-8111-111111111111",
      revision: 1,
    };
    persist.caseState = created;
    return created;
  }),
  savePersistedDecisionCase: vi.fn(
    async (next: DecisionCase, command?: string) => {
      const canonical = {
        ...next,
        revision: (next.revision ?? 0) + 1,
        humanDecision:
          command === "record_disposition" && next.humanDecision
            ? {
                ...next.humanDecision,
                actor: {
                  id: "user-1",
                  name: "Ada",
                  role: "reliability_engineer",
                },
              }
            : next.humanDecision,
      };
      persist.caseState = canonical;
      return canonical;
    },
  ),
  loadPersistedDecisionCase: vi.fn(async () => persist.caseState),
  listRecentPersistedDecisionCases: vi.fn(async () => []),
  listDecisionCaseAuthorityDirectory: vi.fn(async () => [
    {
      userId: "22222222-2222-4222-8222-222222222222",
      name: "Kai Manager",
      email: "kai@example.com",
      role: "maintenance_manager",
    },
  ]),
  recordDecisionCaseApproval: vi.fn(
    async (next: DecisionCase, decision: string, reason: string) => ({
      ...next,
      revision: (next.revision ?? 0) + 1,
      humanApproval: {
        decision,
        reason,
        recordedAt: "2026-10-03T12:00:00.000Z",
        basisVersion: next.revision ?? 0,
        basisSha256: "a".repeat(64),
        approvalVersion: (next.revision ?? 0) + 1,
        actor: {
          id: authHolder.user?.id ?? "",
          name: "Kai Manager",
          role: "maintenance_manager",
        },
      },
    }),
  ),
}));

const invitation = vi.hoisted(() => ({
  send: vi.fn(async () => ({
    name: "Kai Manager",
    email: "kai@example.com",
    status: "submitted" as const,
    detail:
      "Secure invitation submitted; delivery and acceptance are not confirmed.",
    invitedUserId: "22222222-2222-4222-8222-222222222222",
    submittedAt: "2026-10-02T12:00:00.000Z",
    lastCheckedAt: "2026-10-02T12:00:00.000Z",
  })),
  status: vi.fn(async () => ({
    name: "Kai Manager",
    email: "kai@example.com",
    status: "active" as const,
    detail:
      "Invitation accepted and the invited member has signed in. Workspace membership does not grant decision authority.",
    invitedUserId: "22222222-2222-4222-8222-222222222222",
    submittedAt: "2026-10-02T12:00:00.000Z",
    lastCheckedAt: "2026-10-02T13:00:00.000Z",
  })),
}));

const kb = vi.hoisted(() => ({
  ingest: vi.fn(async () => ({
    source_id: "decision-case-dc-1-documents",
    document_class: "unclassified",
    chunks_created: 2,
    status: "indexed",
    security_status: "cleared" as const,
    security_findings_count: 0,
  })),
}));

vi.mock("../services/decisionCaseService", () => ({
  createPersistedDecisionCase: persist.createPersistedDecisionCase,
  savePersistedDecisionCase: persist.savePersistedDecisionCase,
  loadPersistedDecisionCase: persist.loadPersistedDecisionCase,
  listRecentPersistedDecisionCases: persist.listRecentPersistedDecisionCases,
  listDecisionCaseAuthorityDirectory:
    persist.listDecisionCaseAuthorityDirectory,
  recordDecisionCaseApproval: persist.recordDecisionCaseApproval,
  isPersistedDecisionCase: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ),
}));

vi.mock("../services/decisionCaseInvitationService", () => ({
  sendDecisionCaseInvitation: invitation.send,
  getDecisionCaseInvitationStatus: invitation.status,
}));

vi.mock("../services/kbIntake", () => ({
  ingestKbDocument: kb.ingest,
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
      profile: authHolder.profile,
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
    authHolder.profile = null;
    persist.createPersistedDecisionCase.mockClear();
    persist.savePersistedDecisionCase.mockClear();
    persist.loadPersistedDecisionCase.mockClear();
    persist.listRecentPersistedDecisionCases.mockClear();
    persist.listDecisionCaseAuthorityDirectory.mockClear();
    persist.recordDecisionCaseApproval.mockClear();
    invitation.send.mockClear();
    invitation.status.mockClear();
    kb.ingest.mockClear();
    persist.savePersistedDecisionCase.mockImplementation(
      async (next: DecisionCase, command?: string) => {
        const canonical = {
          ...next,
          revision: (next.revision ?? 0) + 1,
          humanDecision:
            command === "record_disposition" && next.humanDecision
              ? {
                  ...next.humanDecision,
                  actor: {
                    id: "user-1",
                    name: "Ada",
                    role: "reliability_engineer",
                  },
                }
              : next.humanDecision,
        };
        persist.caseState = canonical;
        return canonical;
      },
    );
    persist.loadPersistedDecisionCase.mockImplementation(
      async () => persist.caseState,
    );
    persist.caseState = null;
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
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
    expect(screen.getByText("First Decision Journey")).toBeTruthy();
    expect(screen.getByText(/not the full 20-step journey/i)).toBeTruthy();
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

  it("does not earn the workspace audit gate from a session-only save", () => {
    renderOpening();
    openSpine();
    fireEvent.click(screen.getByTestId("spine-save-workspace"));
    expect(
      screen.getByText(/Sign in to create the evaluation workspace/i),
    ).toBeTruthy();
    expect(screen.getByTestId("spine-gate-audit_trail").textContent).toMatch(
      /Open/i,
    );
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
    fireEvent.change(screen.getByTestId("spine-person-verificationOwner"), {
      target: { value: "Ada" },
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
    expect(
      screen
        .getByTestId("spine-verification")
        .compareDocumentPosition(screen.getByTestId("spine-invite")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    fireEvent.click(screen.getByTestId("spine-connect-fallback-manual"));
    expect(document.activeElement).toBe(screen.getByTestId("spine-evidence"));
  });

  it("renders the supported first-time journey in evidence-before-recommendation order", () => {
    renderOpening();
    openSpine();
    const ordered = [
      screen.getByTestId("spine-save-workspace"),
      screen.getByTestId("spine-evidence"),
      screen.getByTestId("spine-recommendation"),
      screen.getByTestId("spine-disposition"),
      screen.getByTestId("spine-invite"),
      screen.getByTestId("spine-connect-source"),
      screen.getByTestId("spine-readiness"),
    ];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      expect(
        ordered[index].compareDocumentPosition(ordered[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("does not earn saved readiness after an update failure and reloads the last persisted case", async () => {
    authHolder.user = { id: "user-1" };
    renderOpening();
    openSpine();
    expect(await screen.findByTestId("spine-save-notice")).toHaveTextContent(
      /Decision Case is on your evaluation workspace/i,
    );

    persist.savePersistedDecisionCase.mockRejectedValueOnce(
      new Error("workspace write refused"),
    );
    fireEvent.change(screen.getByTestId("spine-evidence-body"), {
      target: { value: "Customer-supplied inspection note." },
    });
    fireEvent.click(screen.getByTestId("spine-add-evidence"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /workspace write refused/i,
    );
    expect(screen.getByTestId("spine-gate-audit_trail")).toHaveTextContent(
      /Open/i,
    );
    expect(screen.getByTestId("spine-gate-evidence_path")).toHaveTextContent(
      /Open/i,
    );

    fireEvent.click(screen.getByTestId("spine-reload-audit"));
    await waitFor(() =>
      expect(screen.getByTestId("spine-save-notice")).toHaveTextContent(
        /reloaded from the evaluation workspace/i,
      ),
    );
    expect(screen.getByTestId("spine-gate-audit_trail")).toHaveTextContent(
      /Met/i,
    );
    expect(screen.getByTestId("spine-gate-evidence_path")).toHaveTextContent(
      /Open/i,
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

  it("moves focus to the next step and exposes live save/readiness status", async () => {
    authHolder.user = { id: "user-1" };
    renderOpening();
    openSpine();
    await screen.findByTestId("spine-evidence");

    expect(screen.getByTestId("spine-save-notice")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByTestId("spine-readiness")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    fireEvent.click(screen.getByTestId("spine-next-action-open"));
    expect(document.activeElement).toBe(screen.getByTestId("spine-evidence"));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("prevents an out-of-order second mutation while a save is in flight", async () => {
    authHolder.user = { id: "user-1" };
    type SavedCase = Awaited<
      ReturnType<typeof persist.savePersistedDecisionCase>
    >;
    let resolveSave: ((value: SavedCase) => void) | undefined;
    persist.savePersistedDecisionCase.mockImplementationOnce(
      (next: DecisionCase) =>
        new Promise<SavedCase>((resolve) => {
          resolveSave = resolve;
          persist.caseState = next;
        }),
    );
    renderOpening();
    openSpine();
    await screen.findByTestId("spine-evidence");
    fireEvent.change(screen.getByTestId("spine-evidence-body"), {
      target: { value: "Customer supplied inspection finding." },
    });
    const add = screen.getByTestId("spine-add-evidence");
    fireEvent.click(add);
    fireEvent.click(add);
    expect(persist.savePersistedDecisionCase).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(add).toBeDisabled());
    fireEvent.click(add);
    expect(persist.savePersistedDecisionCase).toHaveBeenCalledTimes(1);

    const pending = persist.caseState!;
    resolveSave?.({
      ...pending,
      revision: (pending.revision ?? 1) + 1,
      humanDecision: pending.humanDecision,
    });
    await waitFor(() => expect(add).not.toBeDisabled());
  });

  it("creates the evaluation workspace case when a signed-in user saves", async () => {
    authHolder.user = { id: "user-1" };
    authHolder.profile = { role: "admin" };
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

  it("binds tenant authority and earns collaboration only after Auth confirms access", async () => {
    authHolder.user = { id: "user-1" };
    renderOpening();
    openSpine();
    await screen.findByText(/Kai Manager · maintenance_manager/);
    const select = await screen.findByTestId("spine-required-person");
    expect(screen.queryByTestId("spine-invite-name")).toBeNull();
    fireEvent.change(select, {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    fireEvent.click(screen.getByTestId("spine-record-invite"));
    await waitFor(() =>
      expect(persist.savePersistedDecisionCase).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredPerson: expect.objectContaining({
            userId: "22222222-2222-4222-8222-222222222222",
            authorityRole: "maintenance_manager",
          }),
        }),
        "record_required_person",
      ),
    );
    expect(screen.getByTestId("spine-approval-pending")).toHaveTextContent(
      /cannot approve on their behalf/i,
    );
    expect(
      screen.getByTestId("spine-gate-invitation_delivery").textContent,
    ).toMatch(/Open/);
    expect(screen.getByTestId("spine-invite-status").textContent).toMatch(
      /no workspace invitation has been sent/i,
    );

    fireEvent.click(screen.getByTestId("spine-refresh-invite"));
    await waitFor(() => expect(invitation.status).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("spine-invite-status").textContent).toMatch(
        /active/i,
      ),
    );
    expect(
      screen.getByTestId("spine-gate-invitation_delivery").textContent,
    ).toMatch(/Met/);
  });

  it("sends a secure workspace invitation only after binding a tenant authority", async () => {
    authHolder.user = { id: "user-1" };
    authHolder.profile = { role: "admin" };
    renderOpening();
    openSpine();

    await screen.findByText(/Kai Manager · maintenance_manager/);
    const select = await screen.findByTestId("spine-required-person");
    expect(screen.getByTestId("spine-send-invite")).toBeDisabled();
    fireEvent.change(select, {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    fireEvent.click(screen.getByTestId("spine-record-invite"));

    await waitFor(() =>
      expect(screen.getByTestId("spine-send-invite")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("spine-send-invite"));

    await waitFor(() =>
      expect(invitation.send).toHaveBeenCalledWith({
        decisionCaseId: "11111111-1111-4111-8111-111111111111",
        name: "Kai Manager",
        email: "kai@example.com",
      }),
    );
    expect(await screen.findByTestId("spine-invite-status")).toHaveTextContent(
      /submitted/i,
    );
    expect(screen.getByTestId("spine-invite-status")).toHaveTextContent(
      /decision authority are separate states/i,
    );
  });

  it("routes governed evidence through security intake before attaching it to the case", async () => {
    authHolder.user = { id: "user-1" };
    authHolder.profile = { role: "reliability_engineer" };
    renderOpening();
    openSpine();
    await screen.findByTestId("spine-audit");

    fireEvent.change(screen.getByTestId("spine-evidence-body"), {
      target: {
        value:
          "Customer-provided inspection evidence with source identity and review context.",
      },
    });
    fireEvent.click(screen.getByTestId("spine-ingest-evidence"));

    await waitFor(() =>
      expect(kb.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/Work history/i),
          document_class: "unclassified",
          content: expect.stringMatching(
            /Customer-provided inspection evidence/,
          ),
        }),
      ),
    );
    await waitFor(() =>
      expect(persist.savePersistedDecisionCase).toHaveBeenCalledWith(
        expect.objectContaining({
          evidence: expect.arrayContaining([
            expect.objectContaining({
              sourceReceipt: expect.objectContaining({
                sourceId: "decision-case-dc-1-documents",
                securityStatus: "cleared",
              }),
            }),
          ]),
        }),
        "add_evidence",
      ),
    );
    expect(
      await screen.findByTestId("spine-evidence-notice"),
    ).toHaveTextContent(/indexed with 2 governed chunk/i);
  });

  it("exposes approval only to the authenticated bound required person", async () => {
    const base = buildSpineDecisionCase({
      question: "May this bounded recommendation proceed?",
      intent: "coordinate",
    });
    const disposition = applyDisposition(
      {
        ...base,
        id: "11111111-1111-4111-8111-111111111111",
        revision: 3,
      },
      "accept",
      "The bounded recommendation remains inside the reviewed evidence.",
      {
        decisionOwner: "Ada Owner",
        recommendationAuthor: "Riley Author",
        requiredApprover: "",
        verificationOwner: "Vera Owner",
      },
      { counterfactual: "A contradictory inspection finding." },
    );
    disposition.humanDecision = {
      ...disposition.humanDecision!,
      actor: {
        id: "user-1",
        name: "Ada Owner",
        role: "reliability_engineer",
      },
    };
    const scheduled = applyVerificationPlan(disposition, {
      question: "Did the bounded outcome occur?",
      expected: "No adverse condition change",
      actual: "",
      evidence: "",
      scheduledFor: "2026-10-10",
      effectiveness: "",
      attributedTo: "Vera Owner",
    });
    const initialCase = recordSourceCheck(
      applyInvite(scheduled, {
        userId: "22222222-2222-4222-8222-222222222222",
        name: "Kai Manager",
        email: "kai@example.com",
        authority: "maintenance_manager",
      }),
      {
        ok: false,
        reason: "No governed integration is connected.",
      },
    );
    authHolder.user = { id: "22222222-2222-4222-8222-222222222222" };
    render(
      <MemoryRouter>
        <DecisionCaseSpine
          question={initialCase.objective}
          intent="coordinate"
          initialCase={initialCase}
          initiallySaved
        />
      </MemoryRouter>,
    );
    expect(
      await screen.findByTestId("spine-required-person-approval"),
    ).toBeTruthy();
    fireEvent.change(screen.getByTestId("spine-approval-reason"), {
      target: { value: "Evidence and conditions were independently reviewed." },
    });
    fireEvent.click(screen.getByTestId("spine-approval-approved"));
    await waitFor(() =>
      expect(persist.recordDecisionCaseApproval).toHaveBeenCalledWith(
        expect.objectContaining({ id: initialCase.id }),
        "approved",
        "Evidence and conditions were independently reviewed.",
      ),
    );
  });

  it("withholds approval controls until the source-check prerequisite is recorded", async () => {
    const base = buildSpineDecisionCase({
      question: "May this bounded recommendation proceed?",
      intent: "coordinate",
    });
    const initialCase = applyInvite(
      {
        ...base,
        id: "11111111-1111-4111-8111-111111111111",
        revision: 3,
      },
      {
        userId: "22222222-2222-4222-8222-222222222222",
        name: "Kai Manager",
        email: "kai@example.com",
        authority: "maintenance_manager",
      },
    );
    authHolder.user = { id: "22222222-2222-4222-8222-222222222222" };
    render(
      <MemoryRouter>
        <DecisionCaseSpine
          question={initialCase.objective}
          intent="coordinate"
          initialCase={initialCase}
          initiallySaved
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("spine-approval-prerequisites"),
    ).toHaveTextContent(/source connection check/i);
    expect(screen.queryByTestId("spine-approval-reason")).toBeNull();
    expect(screen.queryByTestId("spine-approval-approved")).toBeNull();
  });

  it("locks the approved basis and permits only one post-approval outcome", async () => {
    const base = buildSpineDecisionCase({
      question: "May this bounded recommendation proceed?",
      intent: "coordinate",
    });
    const disposition = applyDisposition(
      {
        ...base,
        id: "11111111-1111-4111-8111-111111111111",
        revision: 8,
      },
      "accept",
      "The bounded recommendation remains inside the reviewed evidence.",
      {
        decisionOwner: "Ada Owner",
        recommendationAuthor: "Riley Author",
        requiredApprover: "",
        verificationOwner: "Vera Owner",
      },
      { counterfactual: "A contradictory inspection finding." },
    );
    const scheduled = applyVerificationPlan(disposition, {
      question: "Did the bounded outcome occur?",
      expected: "No adverse condition change",
      actual: "",
      evidence: "",
      scheduledFor: "2026-10-10",
      effectiveness: "",
      attributedTo: "Vera Owner",
    });
    const approved: DecisionCase = {
      ...scheduled,
      humanApproval: {
        decision: "approved",
        reason: "The reviewed basis is accepted.",
        recordedAt: "2026-10-03T12:00:00.000Z",
        basisVersion: 8,
        basisSha256: "a".repeat(64),
        approvalVersion: 9,
        actor: {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Kai Manager",
          role: "maintenance_manager",
        },
      },
    };
    const view = render(
      <MemoryRouter>
        <DecisionCaseSpine
          question={approved.objective}
          intent="coordinate"
          initialCase={approved}
          initiallySaved
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("spine-evidence-locked")).toBeTruthy();
    expect(screen.getByTestId("spine-disposition-locked")).toBeTruthy();
    expect(screen.getByTestId("spine-required-person-locked")).toBeTruthy();
    expect(screen.getByTestId("spine-source-check-locked")).toBeTruthy();
    expect(screen.getByTestId("spine-add-evidence")).toBeDisabled();
    expect(screen.getByTestId("spine-record-disposition")).toBeDisabled();
    expect(screen.getByTestId("spine-record-invite")).toBeDisabled();
    expect(screen.getByTestId("spine-connect-check")).toBeDisabled();
    expect(screen.getByTestId("spine-verify-expected")).toBeDisabled();
    expect(screen.getByTestId("spine-verify-date")).toBeDisabled();
    expect(screen.getByTestId("spine-verify-actual")).not.toBeDisabled();
    expect(screen.getByTestId("spine-verify-evidence")).not.toBeDisabled();
    expect(screen.getByTestId("spine-record-verification")).toHaveTextContent(
      /one-time verification outcome/i,
    );

    view.unmount();
    const recorded = applyVerificationPlan(approved, {
      question: "Did the bounded outcome occur?",
      expected: "No adverse condition change",
      actual: "No adverse change observed",
      evidence: "Signed inspection result",
      scheduledFor: "2026-10-10",
      effectiveness: "effective",
      attributedTo: "Vera Owner",
    });
    render(
      <MemoryRouter>
        <DecisionCaseSpine
          question={recorded.objective}
          intent="coordinate"
          initialCase={recorded}
          initiallySaved
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("spine-verify-actual")).toBeDisabled();
    expect(screen.getByTestId("spine-verify-evidence")).toBeDisabled();
    expect(screen.getByTestId("spine-record-verification")).toBeDisabled();
    expect(screen.getByTestId("spine-record-verification")).toHaveTextContent(
      /already recorded/i,
    );
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
    expect(
      screen.getByTestId("spine-help-action").getAttribute("data-locked"),
    ).toBe("true");

    fireEvent.change(screen.getByTestId("spine-person-decisionOwner"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByTestId("spine-person-verificationOwner"), {
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
