import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionCase } from "../lib/decision-case";
import {
  createCaseDecision,
  listDevelopmentCases,
} from "../services/developService";
import { removeStoredDecisionDraft } from "../lib/decision-case-drafts";
import { GovernedDecisionWorkspacePage } from "./GovernedDecisionWorkspacePage";

const draft = {
  id: "draft-old-1",
  caseNumber: "DC-OLD",
  title: "Leftover pump draft",
  objective: "Recover production",
  updatedAt: "2026-08-01T00:00:00.000Z",
  authorityRole: "Maintenance Superintendent",
} as DecisionCase;

vi.mock("../lib/decision-case-drafts", () => ({
  readStoredDecisionDrafts: () => [draft],
  removeStoredDecisionDraft: vi.fn(),
}));

vi.mock("../services/developService", () => ({
  listGovernedDecisions: vi.fn().mockResolvedValue([
    {
      id: "dec-1",
      decision_question: "Governed crusher decision",
      caseTitle: "CR-01",
      approval_level: "superintendent",
      decision_required_date: null,
      selected_at: null,
    },
  ]),
  listDevelopmentCases: vi.fn().mockResolvedValue([]),
  getGovernedDecision: vi.fn(),
  createCaseDecision: vi.fn(),
}));

describe("GovernedDecisionWorkspacePage drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(createCaseDecision).mockReset();
    vi.mocked(listDevelopmentCases).mockReset();
    vi.mocked(listDevelopmentCases).mockResolvedValue([]);
  });

  async function importDraft() {
    await screen.findByRole("option", { name: "Synthetic development case" });
    fireEvent.change(screen.getByLabelText("Import target development case"), {
      target: { value: "case-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
  }

  it("retains the full browser draft after a question-only governed import", async () => {
    vi.mocked(listDevelopmentCases).mockResolvedValueOnce([
      { id: "case-1", title: "Synthetic development case" },
    ] as never);
    vi.mocked(createCaseDecision).mockResolvedValueOnce({
      decision_id: "decision-1",
    } as never);
    render(
      <MemoryRouter>
        <GovernedDecisionWorkspacePage />
      </MemoryRouter>,
    );
    await screen.findByRole("option", { name: "Synthetic development case" });
    fireEvent.change(screen.getByLabelText("Import target development case"), {
      target: { value: "case-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(createCaseDecision).toHaveBeenCalled());
    expect(removeStoredDecisionDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("browser-draft-banner")).toHaveTextContent(
      "Evidence, calculations and discussion remain",
    );
    expect(createCaseDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "case-1",
        question: "Leftover pump draft: Recover production",
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      }),
    );
  });

  it("does not frame a second decision when the same draft is imported again", async () => {
    vi.mocked(listDevelopmentCases).mockResolvedValue([
      { id: "case-1", title: "Synthetic development case" },
    ] as never);
    vi.mocked(createCaseDecision).mockResolvedValue({
      decision_id: "decision-1",
      replay: false,
    } as never);
    render(
      <MemoryRouter>
        <GovernedDecisionWorkspacePage />
      </MemoryRouter>,
    );
    await importDraft();
    await waitFor(() => expect(createCaseDecision).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Import" });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("button", { name: "Import" });
    expect(createCaseDecision).toHaveBeenCalledTimes(1);
    expect(removeStoredDecisionDraft).not.toHaveBeenCalled();
    expect(screen.getByTestId("browser-draft-row")).toHaveTextContent(
      "Leftover pump draft",
    );
  });

  it("retries a lost acknowledgement with the same import identity", async () => {
    vi.mocked(listDevelopmentCases).mockResolvedValue([
      { id: "case-1", title: "Synthetic development case" },
    ] as never);
    vi.mocked(createCaseDecision)
      .mockRejectedValueOnce(new Error("acknowledgement lost"))
      .mockResolvedValueOnce({
        decision_id: "decision-1",
        replay: true,
      } as never);
    render(
      <MemoryRouter>
        <GovernedDecisionWorkspacePage />
      </MemoryRouter>,
    );
    await importDraft();
    await screen.findByText("acknowledgement lost");
    expect(removeStoredDecisionDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(createCaseDecision).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(createCaseDecision).mock.calls;
    expect(calls[0][0].idempotencyKey).toBe(calls[1][0].idempotencyKey);
    expect(calls[1][0].question).toBe(calls[0][0].question);
    expect(screen.getByTestId("browser-draft-banner")).toHaveTextContent(
      "Evidence, calculations and discussion remain",
    );
  });

  it("reads leftover localStorage rows as browser drafts, not clickable cases", async () => {
    render(
      <MemoryRouter>
        <GovernedDecisionWorkspacePage />
      </MemoryRouter>,
    );
    const banner = await screen.findByTestId("browser-draft-banner");
    expect(banner).toHaveTextContent("Browser drafts — import or discard");
    expect(banner).toHaveTextContent("One-time cleanup");
    expect(banner).toHaveTextContent("not how new cowork starts");
    expect(banner).toHaveTextContent("cowork threads, not Spaces");
    expect(banner).toHaveAttribute("data-honesty", "draft-banner-not-spaces");
    expect(screen.getByTestId("browser-draft-row")).toHaveTextContent(
      "Browser draft",
    );
    expect(screen.getByTestId("browser-draft-row").closest("a")).toBeNull();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    const governed = await screen.findByRole("link", {
      name: /Governed crusher decision/i,
    });
    expect(governed).toHaveAttribute("href", "/decision-cases/dec-1");
    expect(
      screen.queryByRole("link", { name: /Leftover pump draft/i }),
    ).toBeNull();
  });
});
