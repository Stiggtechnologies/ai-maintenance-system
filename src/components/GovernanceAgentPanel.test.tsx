import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernanceAgentPanel } from "./GovernanceAgentPanel";

const runGovernanceAgent = vi.fn();
vi.mock("../services/governanceAgentService", () => ({
  runGovernanceAgent: (...args: unknown[]) => runGovernanceAgent(...args),
}));

describe("GovernanceAgentPanel", () => {
  beforeEach(() => runGovernanceAgent.mockReset());

  it("runs the detection-only agent and exposes provenance plus human action", async () => {
    runGovernanceAgent.mockResolvedValue({
      advisory: true,
      asOf: "2026-12-19T00:00:00Z",
      narrativeSource: "deterministic_governed_records",
      disclaimer: "Detection only",
      analysis: {
        verdict: "critical_findings_detected",
        headline: "1 governance finding requires human review.",
        counts: { critical: 1, warning: 0, notice: 0 },
        coverage: {
          caseCount: 1,
          caseLimit: 100,
          casesTruncated: false,
          lookbackDays: 30,
          blockedAttemptCount: 0,
          blockedAttemptsTruncated: false,
        },
        basis: "Canonical records",
        limitations: ["The agent cannot approve anything."],
        findings: [
          {
            id: "finding-a",
            kind: "separation_of_duty",
            severity: "critical",
            headline: "Independence requirement not met",
            detail: "Define gate",
            caseId: "case-a",
            caseTitle: "North plant expansion",
            occurredAt: null,
            sourceRefs: [
              "development_cases:case-a",
              "rpc:case_binding_gate_demands",
            ],
            humanAction:
              "Have an independent reviewer record the determination.",
          },
        ],
      },
    });
    render(<GovernanceAgentPanel />);
    expect(screen.getByText("Detection only")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Run governance screen" }),
    );
    await waitFor(() => expect(runGovernanceAgent).toHaveBeenCalledWith(30));
    expect(
      screen.getByText("Independence requirement not met"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Have an independent reviewer/),
    ).toBeInTheDocument();
    expect(screen.getByText(/development_cases:case-a/)).toBeInTheDocument();
  });

  it("shows the administrator-only refusal without fabricating a result", async () => {
    runGovernanceAgent.mockImplementationOnce(async () => {
      throw new Error("Governance findings are restricted to administrators.");
    });
    render(<GovernanceAgentPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Run governance screen" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "restricted to administrators",
    );
    expect(
      screen.queryByText(/governance finding requires/),
    ).not.toBeInTheDocument();
  });
});
