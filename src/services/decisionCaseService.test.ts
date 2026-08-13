import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDecisionCases } from "../lib/decision-case";
import { askDecisionCase } from "./decisionCaseService";
import { runPublicDecisionCaseAgent } from "./publicReliabilityAgent";

vi.mock("./operatingLoopService", () => ({
  createCoworkWorkspaceFromObjective: vi.fn(),
  getCoworkMessages: vi.fn(),
  sendCoworkMessage: vi.fn(),
}));

vi.mock("./publicReliabilityAgent", () => ({
  runPublicDecisionCaseAgent: vi.fn(),
}));

const runPublicAgentMock = vi.mocked(runPublicDecisionCaseAgent);

describe("decisionCaseService", () => {
  beforeEach(() => {
    runPublicAgentMock.mockReset();
  });

  it("answers from the active case's canonical calculations", async () => {
    const [pump, compressor] = createSeedDecisionCases();

    const pumpReply = await askDecisionCase(
      pump,
      "Show the calculations and exact source records.",
    );
    expect(pumpReply.message.text).toContain("5 failures in 9 months");
    expect(pumpReply.message.text).toContain("180 hours");
    expect(pumpReply.message.text).not.toContain("102 hours");

    const compressorReply = await askDecisionCase(
      compressor,
      "Show the calculations and exact source records.",
    );
    expect(compressorReply.message.text).toContain("4 trips in 5 months");
    expect(compressorReply.message.text).toContain("102 hours");
    expect(compressorReply.message.text).not.toContain("180 hours");
  });

  it("responds conversationally to a greeting without inventing analysis", async () => {
    const [, compressor] = createSeedDecisionCases();
    const reply = await askDecisionCase(compressor, "hi");

    expect(reply.message.text).toContain("DC-1049");
    expect(reply.message.text).toContain("C-204 compressor");
    expect(reply.message.text).not.toContain("P-101");
    expect(reply.message.meta).toContain("Conversation");
  });

  it("asks for the new subject instead of replaying the case recommendation", async () => {
    const [pump] = createSeedDecisionCases();
    const reply = await askDecisionCase(
      pump,
      "i want you look at somethuing else",
    );

    expect(reply.message.text).toContain("What would you like me to examine?");
    expect(reply.message.text).toContain("DC-1048 unchanged");
    expect(reply.message.text).not.toContain(
      "Do not approve the yearly inspection interval",
    );
    expect(reply.message.text).not.toContain("Seal failures: 5");
    expect(reply.message.meta).toContain("preserved");
  });

  it("clarifies an unsupported demo request instead of dumping all metrics", async () => {
    const [pump] = createSeedDecisionCases();
    const reply = await askDecisionCase(pump, "Tell me more");

    expect(reply.message.text).toContain("not yet sure which outcome");
    expect(reply.message.text).toContain(
      "look at a different asset or document",
    );
    expect(reply.message.text).not.toContain("Downtime: 180 h");
    expect(reply.message.meta).toContain("Clarification needed");
  });

  it("uses live RAG for a substantive public Decision Case question", async () => {
    const [pump] = createSeedDecisionCases();
    runPublicAgentMock.mockResolvedValue({
      status: "success",
      response:
        "Test startup contamination before changing the inspection interval.",
      knowledgeBaseUsed: true,
      citations: [
        {
          title: "Reliability handbook",
          pageRange: "p.42",
          documentClass: "handbook",
          label: "[Reliability handbook, p.42 — handbook]",
        },
      ],
    });

    const reply = await askDecisionCase(
      pump,
      "Which failure mechanisms should we test first, and why?",
      { publicMode: true },
    );

    expect(runPublicAgentMock).toHaveBeenCalledWith(
      pump,
      "Which failure mechanisms should we test first, and why?",
    );
    expect(reply.source).toBe("live");
    expect(reply.message.text).toContain("startup contamination");
    expect(reply.message.meta).toContain("RAG-grounded");
    expect(reply.message.meta).toContain("1 approved source");
  });

  it("keeps exact calculations deterministic in public mode", async () => {
    const [pump] = createSeedDecisionCases();
    const reply = await askDecisionCase(
      pump,
      "Show the calculations and exact source records.",
      { publicMode: true },
    );

    expect(runPublicAgentMock).not.toHaveBeenCalled();
    expect(reply.source).toBe("deterministic");
    expect(reply.message.text).toContain("5 failures in 9 months");
  });

  it("explains the live RAG boundary when free capacity is reached", async () => {
    const [pump] = createSeedDecisionCases();
    runPublicAgentMock.mockResolvedValue({
      status: "rate_limited",
      error: "capacity used",
    });

    const reply = await askDecisionCase(
      pump,
      "Challenge the recommendation using approved reliability references.",
      { publicMode: true },
    );

    expect(reply.message.text).toContain("included live RAG analysis capacity");
    expect(reply.message.text).toContain("Sign in");
    expect(reply.message.meta).toContain("capacity reached");
  });
});
