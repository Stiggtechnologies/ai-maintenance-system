import { describe, expect, it } from "vitest";
import {
  RELIABILITY_PROMPT_VERSION,
  appendApprovedReliabilityContext,
  buildReliabilityEngineerPrompt,
  sanitizeReliabilityCitations,
} from "./reliability-engineer-core";

const allowed = [{
  chunkId: "dod-188",
  title: "DoD RAM Guide",
  pageRange: "p.188-189",
  documentClass: "engineering_standard",
  redistributable: true,
  isClientPrivate: false,
  label: "[DoD RAM Guide, p.188-189 — engineering_standard]",
}];

describe("canonical Reliability Engineer methodology", () => {
  it("contains the decision, quantitative, FRACAS, safety and evidence contracts", () => {
    const prompt = buildReliabilityEngineerPrompt({
      industry: "mining",
      accessMode: "authenticated",
      deliverable: true,
    });
    expect(prompt).toContain(RELIABILITY_PROMPT_VERSION);
    expect(prompt).toContain("ANSWER THE USER'S SPECIFIC QUESTION");
    expect(prompt).toContain("Weibull");
    expect(prompt).toContain("reliability block diagrams");
    expect(prompt).toContain("FRACAS corrective action is not closed");
    expect(prompt).toContain("Keep severity separate from confidence");
    expect(prompt).toContain("qualified human authority");
    expect(prompt).toContain("complete professional work product");
  });

  it("keeps the public boundary explicit", () => {
    const prompt = buildReliabilityEngineerPrompt({
      accessMode: "public",
    });
    expect(prompt).toContain("limited public access");
    expect(prompt).toContain("No tenant files");
    expect(prompt).toContain("Do not imply access to private systems");
  });

  it("appends only approved retrieval context and refuses invented support", () => {
    expect(appendApprovedReliabilityContext("core", allowed[0].label)).toContain(
      "APPROVED RELIABILITY KNOWLEDGE",
    );
    expect(appendApprovedReliabilityContext("core", "")).toContain(
      "Do not invent a named source",
    );
  });

  it("removes citations not returned by the governed retrieval boundary", () => {
    expect(sanitizeReliabilityCitations([
      { title: "DoD RAM Guide", pageRange: "p.188-189" },
      { title: "Invented Standard", pageRange: "p.1" },
    ], allowed)).toEqual([
      { title: "DoD RAM Guide", pageRange: "p.188-189" },
    ]);
  });
});
