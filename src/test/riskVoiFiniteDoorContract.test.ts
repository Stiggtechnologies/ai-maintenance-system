import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const original = readFileSync(
  "supabase/migrations/20260921110101_iso31000_risk_operating_system.sql",
  "utf8",
);
const forward = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const sql = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);
const http = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-http-smoke.mjs",
  "utf8",
);
const guard = `  if not public.sync_is_finite_numeric(v_information_cost)
     or not public.sync_is_finite_numeric(v_decision_cost)
     or not public.sync_is_finite_numeric(v_uncertainty_reduction)
     or not public.sync_is_finite_numeric(v_change_probability) then
    return jsonb_build_object('error','value-of-information inputs must be finite numbers');
  end if;
`;

function definition(source: string, name: string) {
  return source.match(
    new RegExp(`create or replace function public\\.${name}\\([^]*?\\$\\$;`),
  )?.[0];
}

describe("canonical VOI finite-input door, source contract only", () => {
  it("changes the existing private writer only by adding the shared finite guard before calculation and DML", () => {
    const prior = definition(original, "record_risk_value_of_information");
    const next = definition(
      forward,
      "record_risk_value_of_information_authoritative_internal",
    );
    expect(prior).toBeDefined();
    expect(next).toBeDefined();
    if (!prior || !next)
      throw new Error("Canonical writer definitions required");
    expect(next).toContain(guard);
    expect(next?.replace(guard, "")).toBe(
      prior?.replace(
        "public.record_risk_value_of_information(",
        "public.record_risk_value_of_information_authoritative_internal(",
      ),
    );
    expect(next.indexOf(guard)).toBeLessThan(next.indexOf("v_expected:="));
    expect(next.indexOf(guard)).toBeLessThan(next.indexOf("update risks"));
    expect(forward).toContain(
      "revoke all on function public.record_risk_value_of_information_authoritative_internal(uuid, jsonb)\n  from public, anon, authenticated, service_role;",
    );
  });

  it("specifies all twelve quoted special-value refusals with the full canonical artifact witness and original rollback", () => {
    const start = sql.indexOf("-- U18 CANONICAL VOI FINITE DOOR BEGIN");
    const end = sql.indexOf("-- U18 CANONICAL VOI FINITE DOOR END");
    expect(start).toBeGreaterThan(sql.indexOf("set local role authenticated;"));
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(sql.indexOf("-- U18 VOI PARITY BEGIN"));
    const cases = sql.slice(start, end);
    for (const field of [
      "information_cost",
      "decision_cost_if_wrong",
      "uncertainty_reduction",
      "probability_decision_changes",
    ])
      expect(cases).toContain(`'${field}'`);
    expect(cases).toContain("array['NaN','+Infinity','-Infinity']");
    expect(cases).toContain("to_jsonb(special)");
    expect(cases).toContain("public.record_risk_value_of_information(f.risk");
    expect(cases).toContain("pg_temp.u18_state() is distinct from baseline");
    expect(cases).toContain("if attempts<>12 then");
    expect(sql.match(/\brollback;/gi)).toHaveLength(1);
  });

  it("specifies real HTTP special-value strings, exact refusal shape and unchanged state without retry", () => {
    expect(http).toContain("// U18 CANONICAL VOI FINITE HTTP BEGIN");
    expect(http).toContain('["NaN", "+Infinity", "-Infinity"]');
    expect(http).toContain('rpc("record_risk_value_of_information", author,');
    expect(http).toContain("[field]: special");
    expect(http).toContain('Object.keys(response.body), ["error"]');
    expect(http).toContain("canonical finite refusal created artifacts");
  });
});
