import { describe, expect, it, vi } from "vitest";
import {
  RELIABILITY_PROMPT_VERSION,
  buildReliabilityEngineerPrompt,
  formatReliabilityKnowledge,
  retrieveReliabilityKnowledge,
  sanitizeReliabilityCitations,
} from "./reliability-engineer-core";

describe("canonical Reliability Engineer core", () => {
  it("preserves the Stigg GPT methodology and public safety boundary", () => {
    const prompt = buildReliabilityEngineerPrompt({
      industry: "mining",
      accessMode: "public",
      structuredOutput: true,
    });

    expect(prompt).toContain(RELIABILITY_PROMPT_VERSION);
    expect(prompt).toContain("ANSWER THE USER'S SPECIFIC QUESTION");
    expect(prompt).toContain("Weibull, exponential, lognormal");
    expect(prompt).toContain("reliability block diagrams");
    expect(prompt).toContain("FRACAS corrective action is not closed");
    expect(prompt).toContain("No tenant files");
    expect(prompt).toContain("Do not create operational write-backs");
    expect(prompt).toContain("Do not invent citations");
  });

  it("formats only sufficiently similar page-aware knowledge passages", () => {
    const knowledge = formatReliabilityKnowledge([
      {
        chunk_id: "dod-ram-001",
        title: "DoD RAM Guide",
        page_start: 188,
        page_end: 189,
        content: "Verification must be evidence-led.",
        similarity: 0.82,
      },
      {
        chunk_id: "weak",
        title: "Weak match",
        page_start: 1,
        page_end: 1,
        content: "Unrelated material.",
        similarity: 0.2,
      },
    ]);

    expect(knowledge.context).toContain("[DoD RAM Guide, p.188-189]");
    expect(knowledge.context).not.toContain("Weak match");
    expect(knowledge.citations).toEqual([
      expect.objectContaining({
        title: "DoD RAM Guide",
        pageRange: "p.188-189",
      }),
    ]);
  });

  it("uses the 768-dimension vector RPC used by the approved RAG corpus", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        chunk_id: "mil-338-001",
        title: "MIL-HDBK-338B",
        page_start: 123,
        page_end: 123,
        content: "A supported reliability passage.",
        similarity: 0.76,
      }],
      error: null,
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      embedding: { values: [0.1, 0.2, 0.3] },
    }), { status: 200 }));

    const result = await retrieveReliabilityKnowledge({
      client: { rpc },
      query: "Why is the process pump seal repeatedly failing?",
      embeddingApiKey: "test-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("gemini-embedding-2:embedContent"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(rpc).toHaveBeenCalledWith("match_reliability_kb", {
      query_embedding: JSON.stringify([0.1, 0.2, 0.3]),
      match_count: 4,
    });
    expect(result.citations[0]).toMatchObject({
      title: "MIL-HDBK-338B",
      pageRange: "p.123",
    });
  });

  it("rejects model-invented citations that were not retrieved", () => {
    const allowed = formatReliabilityKnowledge([{
      title: "DoD RAM Guide",
      page_start: 188,
      page_end: 189,
      content: "Approved passage.",
      similarity: 0.9,
    }]).citations;

    expect(sanitizeReliabilityCitations([
      { title: "DoD RAM Guide", pageRange: "p.188-189" },
      { title: "Invented Standard", pageRange: "p.1" },
    ], allowed)).toEqual([
      { title: "DoD RAM Guide", pageRange: "p.188-189" },
    ]);
  });
});
