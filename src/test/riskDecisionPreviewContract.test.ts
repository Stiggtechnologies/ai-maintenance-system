import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103040000_risk_decision_preview_context.sql",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const service = readFileSync("src/services/riskOperatingService.ts", "utf8");
const engine = readFileSync("src/lib/risk-operating-system/index.ts", "utf8");
const runtimeFixture = readFileSync(
  "scripts/tests/risk-decision-preview-postgres-tests.sql",
  "utf8",
);

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    ),
  );
  expect(match, `${name} should be defined in the migration`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("R4.02 / U18.02 / R5.03 governed decision previews", () => {
  it("proves ordinary origin refusals by row count and preserved canonical state", () => {
    const ordinary = runtimeFixture.split(
      "-- Controlled privileged fixture probes",
    )[0];
    for (const field of ["secondary_to_risk_id", "arising_from_scenario_id"]) {
      expect(ordinary).toContain(
        `(select ${field} from risks where id=child) is distinct from`,
      );
    }
    expect(ordinary).toContain(
      "(select risk_id from scenarios where id=scenario) is distinct from parent",
    );
    expect(ordinary.match(/get diagnostics affected=row_count/g)).toHaveLength(
      3,
    );
    expect(ordinary.match(/if affected<>0 or/g)).toHaveLength(3);
  });

  it("independently exercises privileged origin triggers rather than an RLS zero-row refusal", () => {
    const privileged = runtimeFixture
      .split("-- Controlled privileged fixture probes")[1]
      ?.split("set local role authenticated;")[0];
    expect(privileged).toContain(
      "canonical origin trigger target is not bound",
    );
    for (const message of [
      "Secondary risk parent provenance cannot be severed or replaced",
      "Secondary risk treatment provenance cannot be severed or replaced",
      "A secondary risk treatment origin identity, tenant and parent are immutable",
      "A secondary risk treatment origin cannot be deleted",
      "A secondary risk canonical origin receipt already exists",
    ])
      expect(privileged).toContain(`refused:=detail='${message}'`);
    expect(privileged).toContain(
      "(select secondary_to_risk_id from risks where id=c.id) is distinct from c.parent_id",
    );
    expect(privileged).toContain(
      "(select arising_from_scenario_id from risks where id=c.id) is distinct from c.scenario_id",
    );
    expect(privileged).toContain(
      "(select risk_id from scenarios where id=c.scenario_id) is distinct from c.parent_id",
    );
  });

  it("witnesses an actual parent reclassification before claiming inherited-access refusal", () => {
    const reclassification = runtimeFixture
      .split("-- The ordinary derived row is initially visible.")[1]
      ?.split("-- Same-tenant ordinary reader:")[0];
    expect(reclassification).toContain("get diagnostics affected=row_count");
    expect(reclassification).toContain("if affected<>1 or");
    expect(reclassification).toContain(
      "parent reclassification did not change its actual target",
    );
  });

  it("fails fast with rollback-only SQL while retaining the full late SQL and real HTTP gate", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const script = readFileSync(
      "scripts/ci-risk-decision-preview-smoke.sh",
      "utf8",
    );
    const preflight = workflow.indexOf(
      "bash scripts/ci-risk-decision-preview-smoke.sh --sql-preflight",
    );
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(
      workflow.indexOf("Smoke — Sync Develop slice 1"),
    );
    expect(
      workflow.match(
        /run: bash scripts\/ci-risk-decision-preview-smoke\.sh\s*\n/g,
      ),
    ).toHaveLength(1);
    expect(script).toContain("1:--sql-preflight");
    expect(script).toContain('test "${GITHUB_ACTIONS:-}" = true');
    expect(script).toContain("env -i");
    expect(script).toContain('if [[ "${1:-}" != --sql-preflight ]]');
    expect(script).toContain(
      "node scripts/tests/risk-decision-preview-http-smoke.mjs",
    );
    const transactionEnd = runtimeFixture.split(/\brollback;/i);
    expect(transactionEnd).toHaveLength(2);
    // Only the literal success receipt may follow the transaction rollback.
    expect(transactionEnd[1].trim()).toMatch(/^select '[^']*';$/);
  });

  it("does not shadow PL/pgSQL fixture records with SQL relation aliases", () => {
    const blocks = [...runtimeFixture.matchAll(/\bdo\s+\$\$([\s\S]*?)\$\$;/gi)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, body] of blocks) {
      const declarations =
        body.match(/\bdeclare([\s\S]*?)\bbegin\b/i)?.[1] ?? "";
      for (const [, record] of declarations.matchAll(
        /\b([a-z_]\w*)\s+record\b/gi,
      )) {
        expect(
          body,
          `SQL alias must not shadow declared fixture record ${record}`,
        ).not.toMatch(
          new RegExp(
            `\\b(?:from|join)\\s+[a-z_][\\w.]*\\s+(?:as\\s+)?${record}\\b`,
            "i",
          ),
        );
      }
    }
  });

  it("binds the preview to the exact visible risk and its criteria profile", () => {
    expect(migration).toContain(
      "create or replace function public.get_risk_decision_preview_context",
    );
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("public.can_read_risk(id)");
    expect(migration).toContain("id = v_risk.criteria_profile_id");
    expect(migration).toContain("'scoring_weights'");
    expect(migration).toContain("'time_factors'");
    expect(migration).not.toContain("order by v_criteria.version");
  });

  it("derives competency readiness from active, unexpired canonical holdings", () => {
    expect(migration).toContain("join public.member_competencies");
    expect(migration).toContain("join public.workforce_members");
    expect(migration).toContain("and wm.active");
    expect(migration).toContain(
      "mc.expires_on is null or mc.expires_on >= current_date",
    );
    expect(migration).toContain("mc.granted_on <= current_date");
    expect(migration).toContain("select distinct c.competency_key");
  });

  it("is read-only, advisory, and cannot create decision authority", () => {
    const preview = functionBody("get_risk_decision_preview_context");
    expect(preview).toContain("'advisory_only', true");
    expect(preview).toContain("'human_decision_required', true");
    expect(migration).toContain("revoke execute");
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(preview).not.toMatch(/insert\s+into/);
    expect(preview).not.toMatch(/update\s+/);
    expect(preview).not.toMatch(/delete\s+from/);
  });

  it("puts sensitivity and human-role gates in front of every authoritative writer", () => {
    for (const name of [
      "record_risk_analysis",
      "record_risk_value_of_information",
      "create_risk_treatment",
    ]) {
      const body = functionBody(name);
      expect(body).toContain("public.can_read_risk(p_risk_id)");
      expect(body).toContain(
        "select role into v_role from public.user_profiles",
      );
      expect(body).toContain("'reliability_engineer'");
      expect(body).toContain("'maintenance_manager'");
      expect(body).not.toContain("'ai_admin'");
    }
    expect(migration).toContain(
      "revoke all on function public.record_risk_analysis_authoritative_internal",
    );
    expect(migration).toContain(
      "revoke all on function public.record_risk_value_of_information_authoritative_internal",
    );
    expect(migration).toContain(
      "revoke all on function public.create_risk_treatment_authoritative_internal",
    );
  });

  it("cannot treat a future-dated competency as ready", () => {
    const treatment = functionBody("create_risk_treatment");
    expect(treatment).toContain("mc.granted_on <= current_date");
    expect(treatment).toContain("v_competency_gaps");
    expect(treatment).toContain("update public.scenarios");
  });

  it("uses actual locked scenario state for complete readiness correction receipts", () => {
    const treatment = functionBody("create_risk_treatment");
    expect(treatment).toContain("v_previous_executable");
    expect(treatment).toContain("v_previous_gaps");
    expect(treatment).toContain("for update");
    expect(treatment).toContain("'executable', v_previous_executable");
    expect(treatment).toContain("'readiness_gaps', v_previous_gaps");
    expect(treatment).toContain("'readiness_gaps', v_corrected_gaps");
    expect(treatment).not.toContain("jsonb_build_object('executable', true)");
  });

  it("restricts risk-bearing canonical ledger rows by existing risk sensitivity", () => {
    expect(migration).toContain("as restrictive");
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("public.can_read_risk(");
    expect(migration).toContain(
      "public.sync_text_as_uuid(event_data->>'risk_id')",
    );
    for (const family of [
      "risk_analysis",
      "risk_value_of_information",
      "risk_treatment",
      "risk_treatment_readiness_correction",
      "risk_secondary_created",
    ])
      expect(migration).toContain(`'${family}'`);
    expect(
      [...migration.matchAll(/drop\s+policy\s+if\s+exists\s+(\w+)/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["risk_decision_audit_sensitivity"]);
    expect(migration).not.toMatch(/update\s+public\.audit_events/);
  });

  it("binds the information receipt to the exact risk without granting authority", () => {
    const information = functionBody("record_risk_value_of_information");
    expect(information).toContain("'risk_id', p_risk_id");
    expect(information).toContain("'advisory_only', true");
    expect(information).toContain("v_result");
    expect(information).toContain("v_result ? 'error'");
  });

  it("binds only successful canonical treatment receipts to their exact risk", () => {
    const treatment = functionBody("create_risk_treatment");
    expect(treatment.includes("'risk_id', p_risk_id")).toBe(true);
    expect(treatment.includes("'advisory_only', true")).toBe(true);
    expect(treatment.includes("'human_decision_required', true")).toBe(true);
    expect(treatment.includes("not (v_result ? 'error')")).toBe(true);
  });

  it("keeps copied secondary-risk context behind every ancestor's canonical visibility", () => {
    const visibility = functionBody("can_read_risk");
    expect(visibility.includes("while v_cursor is not null")).toBe(true);
    expect(visibility.includes("v_cursor = any(v_seen)")).toBe(true);
    expect(visibility.includes("organization_id = v_org")).toBe(true);
    expect(
      visibility.includes("public.get_risk_secondary_origin_internal(v_row)"),
    ).toBe(true);
    const recordedOrigin = functionBody("get_risk_secondary_origin_internal");
    expect(recordedOrigin.includes("'risk_secondary_created'")).toBe(true);
    expect(
      recordedOrigin.includes("a.new_state->>'secondary_to_risk_id'"),
    ).toBe(true);
    expect(
      recordedOrigin.includes("a.new_state->>'arising_from_scenario_id'"),
    ).toBe(true);
    expect(visibility.includes("coalesce(")).toBe(true);
    expect(visibility.includes("p_risk_id is null")).toBe(true);
    expect(visibility.includes("v_hops < 64")).toBe(false);
  });

  it("cannot sever canonical secondary origins to declassify copied information", () => {
    const origin = functionBody("enforce_secondary_risk_origin");
    expect(origin.includes("old.secondary_to_risk_id")).toBe(true);
    expect(origin.includes("old.arising_from_scenario_id")).toBe(true);
    expect(
      origin.includes("public.get_risk_secondary_origin_internal(old)"),
    ).toBe(true);
    expect(origin.includes("v_cursor = any(v_seen)")).toBe(true);
    expect(origin.includes("organization_id = new.organization_id")).toBe(true);
    expect(migration.includes("create trigger trg_secondary_risk_origin")).toBe(
      true,
    );
  });

  it("inherits parent sensitivity in the one canonical secondary-risk writer", () => {
    const writer = functionBody("create_risk_treatment_authoritative_internal");
    expect(
      writer.includes(
        "secondary_to_risk_id, arising_from_scenario_id, information_sensitivity",
      ),
    ).toBe(true);
    expect(writer.includes("r.id, v_scenario, r.information_sensitivity")).toBe(
      true,
    );
    expect(writer.includes("insert into audit_events")).toBe(true);
  });

  it("preserves every other canonical treatment-writer rule verbatim", () => {
    const original = readFileSync(
      "supabase/migrations/20261122090500_treatment_secondary_risk.sql",
      "utf8",
    ).toLowerCase();
    const body = original.match(
      /create or replace function public\.create_risk_treatment\([^]*?as \$\$([^]*?)\$\$;/,
    )?.[1];
    expect(body).toBeDefined();
    const expected = body
      ?.replace(
        "secondary_to_risk_id, arising_from_scenario_id\n",
        "secondary_to_risk_id, arising_from_scenario_id, information_sensitivity\n",
      )
      .replace(
        "r.id, v_scenario\n",
        "r.id, v_scenario, r.information_sensitivity\n",
      );
    expect(
      functionBody("create_risk_treatment_authoritative_internal") === expected,
    ).toBe(true);
  });

  it("protects origin scenarios and validates append-only secondary receipts", () => {
    const scenario = functionBody("enforce_secondary_scenario_origin");
    expect(scenario.includes("old.id")).toBe(true);
    expect(scenario.includes("'risk_secondary_created'")).toBe(true);
    expect(scenario.includes("new.risk_id is distinct from old.risk_id")).toBe(
      true,
    );
    expect(scenario.includes("tg_op = 'delete'")).toBe(true);
    const receipt = functionBody("enforce_risk_secondary_origin_receipt");
    expect(
      receipt.includes(
        "new.organization_id is distinct from public.app_current_org()",
      ),
    ).toBe(true);
    expect(
      receipt.includes("v_child.created_by is distinct from auth.uid()"),
    ).toBe(true);
    expect(receipt.includes("v_child.status is distinct from 'draft'")).toBe(
      true,
    );
    expect(receipt.includes("pg_advisory_xact_lock")).toBe(true);
    expect(receipt.includes("for v_pass in 1..2 loop")).toBe(true);
    expect(receipt.includes("if v_pass = 2 then")).toBe(true);
    expect([...receipt.matchAll(/for share/g)]).toHaveLength(2);
    expect(receipt.includes("canonical origin receipt already exists")).toBe(
      true,
    );
    for (const name of [
      "get_risk_secondary_origin_internal",
      "enforce_secondary_risk_origin",
      "enforce_secondary_scenario_origin",
      "enforce_risk_secondary_origin_receipt",
    ])
      expect(migration.includes(`revoke all on function public.${name}`)).toBe(
        true,
      );
  });

  it("makes unfiltered legacy risk projections owner-internal instead of bypass doors", () => {
    for (const signature of [
      "get_risk_operating_cockpit()",
      "get_aggregate_risk_exposure(uuid)",
      "get_risk_management_effectiveness()",
      "get_risk_audience_view_internal(uuid, text)",
    ]) {
      expect(
        migration.includes(
          `revoke all on function public.${signature}\n  from public, anon, authenticated, service_role`,
        ),
      ).toBe(true);
    }
    expect(service.includes('"get_sensitive_risk_operating_cockpit"')).toBe(
      true,
    );
  });

  it("keeps the public audience signature behind canonical ancestor-sensitive visibility", () => {
    const audience = functionBody("get_risk_audience_view");
    expect(audience.includes("public.app_current_org()")).toBe(true);
    expect(audience.includes("organization_id = v_org")).toBe(true);
    expect(audience.includes("public.can_read_risk(p_risk_id)")).toBe(true);
    expect(
      audience.includes(
        "public.get_risk_audience_view_internal(p_risk_id, p_audience)",
      ),
    ).toBe(true);
    expect(audience.includes("risk not available to this user")).toBe(true);
    expect(
      migration.includes("rename to get_risk_audience_view_internal"),
    ).toBe(true);
  });

  it("shares one PostgreSQL numeric calculation between advisory preview and recording", () => {
    const calculator = functionBody("calculate_risk_analysis_internal");
    const preview = functionBody("get_risk_analysis_preview");
    const writer = functionBody("record_risk_analysis_authoritative_internal");
    expect(calculator).toContain(
      "100*(v_likelihood/v_max_likelihood)*(v_peak/5)",
    );
    expect(calculator).toContain(
      "when v_current>=(c.thresholds->>'high')::numeric",
    );
    expect(calculator).not.toContain("round(v_current");
    expect(preview).toContain("public.calculate_risk_analysis_internal");
    expect(writer).toContain("public.calculate_risk_analysis_internal");
    expect(writer).toContain("public.risk_contract_gaps(r)");
    expect(writer).toContain("insert into audit_events");
    expect(preview).toContain("id = v_risk.criteria_profile_id");
    expect(preview).toContain("public.can_read_risk(id)");
    expect(preview).toContain("'advisory_only', true");
    expect(preview).toContain("'human_decision_required', true");
    expect(preview).not.toMatch(
      /insert\s+into|update\s+public\.|delete\s+from/,
    );
    expect(migration).toContain(
      "revoke all on function public.calculate_risk_analysis_internal",
    );
  });

  it("filters nested cockpit links by both canonical endpoint permissions", () => {
    const cockpit = functionBody("get_sensitive_risk_operating_cockpit");
    expect(cockpit).toContain(
      "public.get_sensitive_risk_operating_cockpit_internal()",
    );
    expect(cockpit).toContain("public.can_read_risk(l.source_risk_id)");
    expect(cockpit).toContain("public.can_read_risk(l.target_risk_id)");
    expect(cockpit).toContain("l.organization_id = v_org");
    expect(cockpit).toContain("l.id::text = link->>'id'");
    expect(cockpit).toContain("'{links}'");
    expect(migration).toContain(
      "revoke all on function public.get_sensitive_risk_operating_cockpit_internal()",
    );
  });

  it("wires canonical analysis and diagnostic engines into customer-reachable actions", () => {
    expect(service).toContain('"get_risk_decision_preview_context"');
    expect(page).toContain("getRiskDecisionPreviewContext(risk.id)");
    expect(service.includes('"get_risk_analysis_preview"')).toBe(true);
    expect(
      page.includes("getRiskAnalysisPreview(risk.id, analysisInput)"),
    ).toBe(true);
    expect(page.includes("recordRiskAnalysis(risk.id, analysisInput)")).toBe(
      true,
    );
    expect(page.includes("analyzeRisk(")).toBe(false);
    expect(page).toContain("evaluateValueOfInformation({");
    expect(page).toContain("assessTreatmentReadiness({");
    expect(page).toContain('data-testid="risk-analysis-preview"');
    expect(page).toContain('data-testid="value-of-information-preview"');
    expect(page).toContain('data-testid="treatment-readiness-preview"');
  });

  it("uses the risk-bound time factor and keeps recording authoritative", () => {
    expect(engine).toContain("timePressure * criteria.weights.timePressure");
    expect(
      page
        .replace(/\s+/g, " ")
        .includes(
          "Recording recalculates against the current bound criteria and rechecks the complete contract",
        ),
    ).toBe(true);
    expect(page).toContain("requires a separate human approval");
    expect(page).toContain(
      "Competencies come from current, unexpired holdings",
    );
  });
});
