import { describe, expect, it } from "vitest";
import {
  grantsAuthenticated,
  isRestrictive,
  migrationFiles,
  resolveChainPolicies,
  usingOf,
} from "./support/migrationPolicies";

// Replay the ACTUAL final chain, not the historical uncertainty file alone.
// This is a source composition gate; native pg_policies/privacy remains required.
const chain = resolveChainPolicies();
const compact = (text: string) => text.replace(/\s+/g, " ").trim();

describe("U18 current-main final-policy composition", () => {
  it("keeps one restrictive seven-family audit gate after the deployed risk-preview migration", () => {
    const policies = [...chain.values()]
      .filter((policy) => policy.table === "audit_events")
      .flatMap((policy) =>
        policy.statements.map((text) => ({ ...policy, text })),
      )
      .filter((policy) => grantsAuthenticated(policy.text));
    expect(policies).toHaveLength(2);
    expect(
      policies.filter((policy) => !isRestrictive(policy.text)),
    ).toHaveLength(1);
    const gates = policies.filter((policy) => isRestrictive(policy.text));
    expect(gates).toHaveLength(1);
    const gate = gates[0];
    expect(gate.policy).toBe("risk_decision_audit_sensitivity");
    expect(compact(gate.text)).toContain("for select to authenticated");
    const deployed = migrationFiles()
      .filter((file) => file.endsWith("_risk_decision_preview_context.sql"))
      .at(-1);
    expect(deployed).toBeDefined();
    expect(gate.source > (deployed ?? "")).toBe(true);
    const predicate = compact(usingOf(gate.text) ?? "");
    expect(predicate).toContain("organization_id = public.app_current_org()");
    expect(predicate).toContain(
      "public.can_read_risk(public.sync_text_as_uuid(event_data->>'risk_id'))",
    );
    expect(predicate).toContain(
      "public.can_read_risk(public.sync_text_as_uuid(event_data->>'parent_risk_id'))",
    );
    for (const family of [
      "risk_analysis",
      "risk_value_of_information",
      "risk_treatment",
      "risk_treatment_readiness_correction",
      "risk_secondary_created",
      "risk_uncertainty_analysis_submitted",
      "risk_uncertainty_analysis_reviewed",
    ])
      expect(predicate).toContain(`'${family}'`);
  });

  it("leaves packet SELECT scoped to both canonical organization and risk visibility", () => {
    const policy = chain.get(
      "risk_uncertainty_analyses.risk_uncertainty_select_org",
    );
    expect(policy).toBeDefined();
    expect(policy?.statements).toHaveLength(1);
    const text = compact(policy?.statements[0] ?? "");
    expect(text).toContain("for select to authenticated");
    expect(text).toContain(
      "organization_id=public.app_current_org() and public.can_read_risk(risk_id)",
    );
  });

  it("leaves binding SELECT tied to an actual visible same-tenant packet", () => {
    const policy = chain.get(
      "risk_uncertainty_analysis_evidence.risk_uncertainty_evidence_select_org",
    );
    expect(policy).toBeDefined();
    expect(policy?.statements).toHaveLength(1);
    const text = compact(policy?.statements[0] ?? "");
    expect(text).toContain("for select to authenticated");
    expect(text).toContain(
      "a.id=risk_uncertainty_analysis_evidence.analysis_id",
    );
    expect(text).toContain("a.organization_id=public.app_current_org()");
    expect(text).toContain(
      "a.organization_id=risk_uncertainty_analysis_evidence.organization_id",
    );
    expect(text).toContain("public.can_read_risk(a.risk_id)");
  });
});
