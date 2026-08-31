import { describe, expect, it } from "vitest";
import {
  conversationIsEmpty,
  establishedFromEvidence,
  frozenDisposition,
  isNamedAuthority,
  isRecommendationTurn,
  notProvenFromEvidence,
  shouldShowLearnPointer,
} from "./recommendation-turn";
import type { DecisionApproval, DecisionEvidence } from "../decision-case";

const evidence: DecisionEvidence[] = [
  {
    id: "a",
    title: "CMMS",
    summary: "history",
    quality: "high",
    state: "ok",
    record: "WO-1",
    finding: "Five seal failures in nine months.",
    lineage: "P-101",
    sourceSystem: "CMMS",
  },
  {
    id: "b",
    title: "Sample",
    summary: "missing",
    quality: "missing",
    state: "Missing",
    record: "none",
    finding: "Startup solids are not measured.",
    lineage: "EP-1",
    sourceSystem: "Lab",
  },
];

describe("recommendation-turn helpers", () => {
  it("treats only assistant messages with recommendation meta as recommendation turns", () => {
    expect(
      isRecommendationTurn({
        id: "1",
        role: "assistant",
        author: "SyncAI",
        text: "Plan",
        createdAt: "2026-08-12T16:00:00.000Z",
        meta: "Deterministic analysis · governed recommendation",
      }),
    ).toBe(true);
    expect(
      isRecommendationTurn({
        id: "2",
        role: "assistant",
        author: "SyncAI",
        text: "Hello",
        createdAt: "2026-08-12T16:00:00.000Z",
        meta: "Conversation",
      }),
    ).toBe(false);
  });

  it("splits evidence into established facts and not-proven gaps", () => {
    expect(establishedFromEvidence(evidence).map((item) => item.fact)).toEqual([
      "Five seal failures in nine months.",
    ]);
    expect(notProvenFromEvidence(evidence)).toEqual([
      "Startup solids are not measured.",
    ]);
  });

  it("matches the named authority by name and freezes after a disposition", () => {
    expect(isNamedAuthority("M. Tran", "M. Tran")).toBe(true);
    expect(isNamedAuthority("Other Person", "M. Tran")).toBe(false);
    const approvals: DecisionApproval[] = [
      {
        id: "1",
        initials: "MT",
        name: "M. Tran",
        role: "Reliability Engineer",
        responsibility: "scope",
        status: "approved",
        decidedAt: "2026-08-12T16:10:00.000Z",
      },
    ];
    expect(frozenDisposition(approvals)).toBe("approved");
  });

  it("shows the unpersisted LEARN pointer after Approve and does not treat Outcome recorded as closure", () => {
    const approvals: DecisionApproval[] = [
      {
        id: "1",
        initials: "MT",
        name: "M. Tran",
        role: "Reliability Engineer",
        responsibility: "scope",
        status: "approved",
      },
    ];
    expect(shouldShowLearnPointer(approvals)).toBe(true);
    expect(
      shouldShowLearnPointer([{ ...approvals[0], status: "reviewing" }]),
    ).toBe(false);
  });

  it("treats a draft with only a system line as an empty conversation", () => {
    expect(
      conversationIsEmpty([
        {
          id: "d",
          role: "system",
          author: "SyncAI",
          text: "What decision?",
          createdAt: "2026-08-12T16:00:00.000Z",
        },
      ]),
    ).toBe(true);
  });
});
