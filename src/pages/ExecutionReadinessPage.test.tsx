/**
 * Sync Develop Slice 7B — the Execution Readiness board, RENDERED.
 *
 * WHY A RENDER TEST AND NOT ANOTHER STRING ASSERTION. Every other pin on this
 * page is a substring check over its source, and a substring check cannot see
 * how many TIMES something reaches the screen or which branch put it there.
 * Two defects on this surface were of exactly that shape:
 *
 *   * the server's `note` was rendered inside the empty branch AND again
 *     unconditionally below it, so a board that answered with no draft
 *     packages printed the same sentence twice — which reads as two findings
 *     about two different things. The source even carried a comment saying
 *     "ONCE", which is how a claim and its code drift apart unwatched;
 *
 *   * `stale` — the seventh verdict state — must arrive on the screen as a
 *     REFUSAL: red, with the server's own itemized gaps under it, and with
 *     the assessment note kept in its amber register rather than dropped to
 *     quiet grey the moment `assessed` is true. "Assessed on the 3rd" in grey
 *     beside a verdict the door refuses is the reading this slice exists to
 *     prevent.
 *
 * Nothing here asserts a readiness rule: every sentence checked is one the
 * fixture puts in the server's mouth.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExecutionReadinessBoard,
  ExecutionReadinessPackage,
} from "../services/developService";

const getExecutionReadinessBoard = vi.fn();
vi.mock("../services/developService", () => ({
  getExecutionReadinessBoard: (caseId: string | null) =>
    getExecutionReadinessBoard(caseId),
}));

import { ExecutionReadinessPage } from "./ExecutionReadinessPage";

const NOTE =
  "Every work package in this organization has been released or withdrawn; none is waiting on a release decision.";

function pkg(
  over: Partial<ExecutionReadinessPackage> = {},
): ExecutionReadinessPackage {
  return {
    packageId: 1,
    packageCode: "T7B-P1",
    title: "Drive train field works",
    packageType: "engineering",
    level: 1,
    caseId: "11111111-1111-4111-8111-111111111111",
    caseTitle: "Drive train case",
    area: null,
    requiredBy: "2027-03-01",
    status: "draft",
    readiness:
      "Every hard constraint recorded against work package T7B-P1 is cleared, it contains 1 work order(s) and it is the head of its chain. Release is a §70 human act and has not been performed.",
    readinessVerdict: "ready_for_human",
    canRelease: true,
    constraintsRecorded: 3,
    openHard: 0,
    workOrders: 1,
    blockingItems: [],
    fieldReadinessGaps: [],
    fieldReadinessAssessed: true,
    fieldReadinessAssessedAt: "2026-09-03T00:00:00Z",
    fieldReadinessRunId: "22222222-2222-4222-8222-222222222222",
    fieldReadinessOutputs: null,
    fieldReadinessNote:
      "Assessed 2026-09-03: 0 derived blocker(s) recorded, 3 question(s) raised that no store can answer.",
    ...over,
  };
}

function board(over: Partial<ExecutionReadinessBoard> = {}) {
  return {
    answered: true,
    caseId: null,
    packageCount: 1,
    awaitingRelease: 1,
    packages: [pkg()],
    note: NOTE,
    basis: "The work packages awaiting a release decision.",
    ...over,
  } satisfies ExecutionReadinessBoard;
}

const draw = () =>
  render(
    <MemoryRouter>
      <ExecutionReadinessPage />
    </MemoryRouter>,
  );

describe("the Execution Readiness board renders the server's answer", () => {
  beforeEach(() => {
    getExecutionReadinessBoard.mockReset();
  });

  it("prints the server's note ONCE when no package is awaiting release", async () => {
    // THE REGRESSION. The empty branch rendered the note and the line below it
    // rendered the note again, so this returned two nodes.
    getExecutionReadinessBoard.mockResolvedValue(
      board({ packages: [], awaitingRelease: 0 }),
    );
    draw();
    await waitFor(() => expect(screen.getAllByText(NOTE)).toHaveLength(1));
  });

  it("prints it ONCE when packages are listed, too", async () => {
    getExecutionReadinessBoard.mockResolvedValue(board());
    draw();
    await waitFor(() => expect(screen.getAllByText(NOTE)).toHaveLength(1));
    expect(
      screen.getByText("T7B-P1 — Drive train field works"),
    ).toBeInTheDocument();
  });

  it("renders a refusal by name and no package list", async () => {
    const refusal =
      'No work package has been recorded in this organization. An empty execution-readiness board reads as "nothing is waiting on anybody", which is a different fact from "nobody has packaged the work yet".';
    getExecutionReadinessBoard.mockResolvedValue({
      answered: false,
      refusal,
      packageCount: 0,
    });
    draw();
    await waitFor(() => expect(screen.getByText(refusal)).toBeInTheDocument());
    // An unanswered board shows neither the note line nor a list.
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("wears the SEVENTH state as a refusal, with the server's own gaps", async () => {
    const stale = pkg({
      readinessVerdict: "stale",
      canRelease: false,
      readiness:
        "NOT READY — work package T7B-P1 was field-assessed on 2026-09-03 and its recorded constraint set no longer describes the work: Materials staged on work order T7B-W1 is blocked and no open constraint holds it. Releasing against evidence the canonical stores have moved past is releasing against an assessment nobody made. Re-assess it.",
      fieldReadinessGaps: [
        {
          workOrderId: "33333333-3333-4333-8333-333333333333",
          woNumber: "T7B-W1",
          element: "materials",
          label: "Materials staged",
          reason: "blocked_and_unheld",
          detail:
            "1 of 1 material line(s) on work order T7B-W1 remain requested or short — required materials are not ready.",
          sentence:
            "Materials staged on work order T7B-W1 is blocked and no open constraint holds it",
        },
      ],
    });
    getExecutionReadinessBoard.mockResolvedValue(board({ packages: [stale] }));
    draw();

    await waitFor(() =>
      expect(screen.getByText(stale.readiness)).toBeInTheDocument(),
    );
    // The badge says stale, and it is worn in the RED register the door's
    // refusal deserves — not the amber "waiting for a person" one.
    const badge = screen.getByText("stale");
    expect(badge.className).toContain("red");
    expect(badge.className).not.toContain("amber");
    // The gaps are the server's, itemized by element and by job.
    expect(
      screen.getByText("What the stores now say that the assessment does not"),
    ).toBeInTheDocument();
    expect(screen.getByText(/T7B-W1 · Materials staged/)).toBeInTheDocument();
    expect(screen.getByText("blocked and unheld")).toBeInTheDocument();
    // AND THE ASSESSMENT NOTE STAYS AMBER. `assessed: true` with a date, in
    // quiet grey, beside a verdict the door refuses is the exact reassurance
    // the seventh state exists to withhold.
    const note = screen.getByText(stale.fieldReadinessNote);
    expect(note.className).toContain("amber");
  });

  it("keeps an ASSESSED, non-stale package's note out of the alarm register", async () => {
    // The other direction, so the assertion above is about `stale` and not
    // about the note always being amber.
    getExecutionReadinessBoard.mockResolvedValue(board());
    draw();
    await waitFor(() =>
      expect(screen.getByText(/Assessed 2026-09-03/).className).not.toContain(
        "amber",
      ),
    );
  });

  it("says an unassessed package is unassessed, in amber, not as a blank", async () => {
    const unassessed = pkg({
      readinessVerdict: "unassessed",
      canRelease: false,
      fieldReadinessAssessed: false,
      fieldReadinessAssessedAt: null,
      fieldReadinessRunId: null,
      fieldReadinessNote:
        "No field-readiness assessment has been recorded for this package.",
    });
    getExecutionReadinessBoard.mockResolvedValue(
      board({ packages: [unassessed] }),
    );
    draw();
    await waitFor(() =>
      expect(
        screen.getByText(unassessed.fieldReadinessNote).className,
      ).toContain("amber"),
    );
  });
});
