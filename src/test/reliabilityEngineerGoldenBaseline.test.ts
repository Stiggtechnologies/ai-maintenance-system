import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELIABILITY_PROMPT_VERSION,
  buildReliabilityEngineerPrompt,
} from "../../supabase/functions/_shared/reliability-engineer-core";
import { selectReliabilitySpecialists } from "../../supabase/functions/_shared/reliability-specialists";

type GoldenCase = {
  id: string;
  domain: string;
  question: string;
  expectedSpecialists: string[];
  hardRequirements: string[];
  forbidden: string[];
};

type GoldenSuite = {
  baselineId: string;
  caseCount: number;
  cases: GoldenCase[];
};

const suite = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "benchmarks/reliability-engineer/re-2026.08/cases.json",
    ),
    "utf8",
  ),
) as GoldenSuite;

const HARD_REQUIREMENTS = new Set([
  "separate_evidence",
  "identify_evidence_gaps",
  "no_unsupported_math",
  "show_math",
  "rank_hypotheses",
  "lowest_regret",
  "approval_boundary",
  "verification",
  "severity_confidence",
  "citation_integrity",
  "protective_function",
  "complete_deliverable",
  "asset_onboarding",
  "mro_risk",
  "planning_readiness",
  "knowledge_conflict",
  "false_premise",
  "fracas_closure",
]);

const FORBIDDEN = new Set([
  "invent_numbers",
  "invent_citation",
  "unsafe_setpoint_change",
  "claim_root_cause",
  "claim_no_failure_equals_safe",
  "autonomous_high_consequence",
  "cross_tenant",
  "manufactured_precision",
]);

describe("RE-2026.08 golden baseline", () => {
  it("pins the accepted methodology version and engineering charter", () => {
    const prompt = buildReliabilityEngineerPrompt({
      industry: "asset-intensive industry",
      accessMode: "authenticated",
      deliverable: true,
    });

    expect(suite.baselineId).toBe("RE-2026.08");
    expect(RELIABILITY_PROMPT_VERSION).toBe("syncai-reliability-engineer-v4");
    expect(prompt).toContain("ANSWER THE USER'S SPECIFIC QUESTION");
    expect(prompt).toContain("Separate verified facts");
    expect(prompt).toContain("Distinguish the failed component from the causal mechanism");
    expect(prompt).toContain("Never calculate MTBF, Weibull parameters, availability, financial impact, or ROI without the required denominator");
    expect(prompt).toContain("rank plausible mechanisms");
    expect(prompt).toContain("lowest-regret containment");
    expect(prompt).toContain("FRACAS corrective action is not closed until implementation and effectiveness are verified");
    expect(prompt).toContain("qualified human authority always prevail");
    expect(prompt).toContain("Never invent citations, thresholds, operating limits, costs, measurements, standards, customer evidence, or precision");
    expect(prompt).toContain("Keep severity separate from confidence");
    expect(prompt).toContain("complete professional work product");
  });

  it("keeps public and authenticated evidence boundaries distinct", () => {
    const publicPrompt = buildReliabilityEngineerPrompt({ accessMode: "public" });
    const privatePrompt = buildReliabilityEngineerPrompt({ accessMode: "authenticated" });

    expect(publicPrompt).toContain("limited public access");
    expect(publicPrompt).toContain("No tenant files");
    expect(publicPrompt).toContain("Do not imply access to private systems");
    expect(privatePrompt).toContain("authenticated, tenant-scoped workflow");
    expect(privatePrompt).toContain("Preserve tenant isolation, evidence lineage, decision authority, and accountable human approval");
  });

  it("contains at least 30 unique qualification cases with explicit pass/fail contracts", () => {
    expect(suite.caseCount).toBe(suite.cases.length);
    expect(suite.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(suite.cases.map((item) => item.id)).size).toBe(suite.cases.length);

    for (const item of suite.cases) {
      expect(item.question.trim().length).toBeGreaterThan(30);
      expect(item.expectedSpecialists.length).toBeGreaterThan(0);
      expect(item.hardRequirements.length).toBeGreaterThan(0);
      expect(item.forbidden.length).toBeGreaterThan(0);
      for (const requirement of item.hardRequirements) {
        expect(HARD_REQUIREMENTS.has(requirement), `${item.id}: ${requirement}`).toBe(true);
      }
      for (const forbidden of item.forbidden) {
        expect(FORBIDDEN.has(forbidden), `${item.id}: ${forbidden}`).toBe(true);
      }
    }
  });

  it("keeps specialist routing active across the golden suite", () => {
    for (const item of suite.cases) {
      const selected = selectReliabilitySpecialists(item.question).map((specialist) => specialist.id);
      expect(
        item.expectedSpecialists.some((expected) => selected.includes(expected)),
        `${item.id}: selected ${selected.join(", ")} but expected one of ${item.expectedSpecialists.join(", ")}`,
      ).toBe(true);
    }
  });

  it("does not collapse the suite into generic reliability routing", () => {
    const selected = suite.cases.map((item) =>
      selectReliabilitySpecialists(item.question).map((specialist) => specialist.id),
    );
    const specialistCases = selected.filter(
      (ids) => ids.some((id) => id !== "general-reliability"),
    ).length;
    expect(specialistCases / selected.length).toBeGreaterThanOrEqual(0.9);
  });
});
