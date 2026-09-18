import { supabase } from "../lib/supabase";

export interface GovernanceAgentFinding {
  id: string;
  kind: string;
  severity: "notice" | "warning" | "critical";
  headline: string;
  detail: string;
  caseId: string | null;
  caseTitle: string | null;
  occurredAt: string | null;
  sourceRefs: string[];
  humanAction: string;
}

export interface GovernanceAgentResult {
  advisory: true;
  asOf: string;
  analysis: {
    verdict:
      | "critical_findings_detected"
      | "findings_detected"
      | "no_findings_detected";
    headline: string;
    findings: GovernanceAgentFinding[];
    counts: { critical: number; warning: number; notice: number };
    coverage: {
      caseCount: number;
      caseLimit: number;
      casesTruncated: boolean;
      lookbackDays: number;
      blockedAttemptCount: number;
      blockedAttemptsTruncated: boolean;
    };
    basis: string;
    limitations: string[];
  };
  narrativeSource: "deterministic_governed_records";
  disclaimer: string;
}

export async function runGovernanceAgent(
  lookbackDays = 30,
): Promise<GovernanceAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-governance-agent",
    {
      body: { lookback_days: lookbackDays },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as
    GovernanceAgentResult | { error?: string; reason?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(
      payload.reason || payload.error || "Governance screening unavailable",
    );
  }
  return payload as GovernanceAgentResult;
}
