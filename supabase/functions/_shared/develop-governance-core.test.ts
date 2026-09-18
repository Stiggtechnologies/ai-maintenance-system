import { describe, expect, it } from "vitest";
import {
  analyzeGovernanceScreen,
  type GovernanceAgentScreen,
} from "./develop-governance-core.ts";

const screen = (): GovernanceAgentScreen => ({
  organizationId: "org-a",
  asOf: "2026-12-19T00:00:00Z",
  lookbackDays: 30,
  caseCount: 1,
  caseLimit: 100,
  casesTruncated: false,
  cases: [
    {
      caseId: "case-a",
      caseTitle: "North plant expansion",
      currentStageKey: "define",
      demands: {
        waiver_reverted: ["Define gate — approved design basis"],
        non_independent_gates: ["Define gate"],
        criteria_unmet: ["Approved operating philosophy"],
        unlinked_mandatory: [],
        composite_unmet: [],
      },
    },
  ],
  instruments: [
    {
      id: "waiver-a",
      subjectType: "gate_requirement",
      caseId: "case-a",
      status: "pending",
      requestedAt: "2026-12-18T00:00:00Z",
      expiresAt: "2027-01-18T00:00:00Z",
      subjectLabel: "Approved operating philosophy",
    },
  ],
  blockedAttemptCount: 1,
  blockedAttemptsTruncated: false,
  blockedAttempts: [
    {
      id: "event-a",
      severity: "critical",
      detail: "Blocked client-side privilege update",
      actorLabel: "admin@example.invalid",
      createdAt: "2026-12-18T01:00:00Z",
    },
  ],
  basis: "canonical sources",
});

describe("Governance Agent governed analysis", () => {
  it("preserves exact canonical categories and sources", () => {
    const result = analyzeGovernanceScreen(screen());
    expect(result.verdict).toBe("critical_findings_detected");
    expect(result.counts).toEqual({ critical: 3, warning: 1, notice: 1 });
    expect(
      result.findings.some((row) => row.kind === "expired_waiver_reliance"),
    ).toBe(true);
    expect(
      result.findings.some((row) => row.kind === "separation_of_duty"),
    ).toBe(true);
    const deviation = result.findings.find((row) =>
      row.id.startsWith("criterion:"),
    );
    expect(deviation?.kind).toBe("policy_requirement_gap");
    expect(deviation?.sourceRefs).toEqual([
      "development_cases:case-a",
      "rpc:case_binding_gate_demands",
    ]);
  });

  it("keeps zero findings bounded and never claims compliance", () => {
    const input = screen();
    input.cases = [];
    input.instruments = [];
    input.blockedAttempts = [];
    input.blockedAttemptCount = 0;
    const result = analyzeGovernanceScreen(input);
    expect(result.verdict).toBe("no_findings_detected");
    expect(result.limitations.join(" ")).toContain("not proof");
  });

  it("discloses coverage truncation", () => {
    const input = screen();
    input.casesTruncated = true;
    input.blockedAttemptsTruncated = true;
    const result = analyzeGovernanceScreen(input);
    expect(result.limitations.join(" ")).toContain("case screen reached");
    expect(result.limitations.join(" ")).toContain("200-event limit");
  });
});
