import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source/transcript guards only. These tests do not execute PostgreSQL or prove
// native special-value/date behavior; the rollback transcript remains required.
const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const transcript = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);
const submit = migration.match(
  /create or replace function public\.submit_risk_uncertainty_analysis\([^]*?as \$\$([^]*?)\$\$;/,
)?.[1];
if (!submit) throw new Error("Canonical uncertainty submit body missing");
const compact = submit.replace(/\s+/g, " ");
const topNumeric = [
  ["probability_lower", "v_probability_lower"],
  ["probability_central", "v_probability_central"],
  ["probability_upper", "v_probability_upper"],
  ["confidence_level", "v_confidence_level"],
  ["confidence_interval_lower", "v_ci_lower"],
  ["confidence_interval_upper", "v_ci_upper"],
  ["best_case_loss", "v_best"],
  ["expected_case_loss", "v_expected"],
  ["worst_case_loss", "v_worst"],
  ["voi_information_cost", "v_info_cost"],
  ["voi_decision_cost_if_wrong", "v_wrong_cost"],
  ["voi_uncertainty_reduction", "v_uncertainty_reduction"],
  ["voi_probability_decision_changes", "v_change_probability"],
] as const;
const sensitivityNumeric = [
  "low_input",
  "base_input",
  "high_input",
  "low_output",
  "base_output",
  "high_output",
] as const;

describe("U18 local finite/object/date refusal source contract", () => {
  it("checks the actual top-level object after scoped authority and before input casts", () => {
    const guard = submit.indexOf(
      "jsonb_typeof(p_analysis) is distinct from 'object'",
    );
    expect(guard).toBeGreaterThan(
      submit.indexOf("and public.can_read_risk(id)"),
    );
    expect(guard).toBeLessThan(submit.indexOf("v_probability_lower:="));
    expect(submit).toContain(
      "return jsonb_build_object('error','uncertainty analysis must be an object')",
    );
  });

  it.each(topNumeric)(
    "refuses non-finite %s before range rules and writes",
    (field, variable) => {
      expect(submit).toContain(
        `${variable}:=nullif(p_analysis->>'${field}','')::numeric`,
      );
      const guard = submit.indexOf(
        `${variable}::text in ('NaN','Infinity','-Infinity')`,
      );
      expect(guard).toBeGreaterThan(submit.indexOf(`${variable}:=`));
      expect(guard).toBeLessThan(
        submit.indexOf("if v_probability_lower is null"),
      );
      expect(guard).toBeLessThan(submit.indexOf("v_voi_expected:="));
      expect(guard).toBeLessThan(
        submit.indexOf("perform set_config('app.risk_uncertainty_write'"),
      );
      expect(submit).toContain(
        "probability, confidence, loss and value-of-information inputs must be finite numbers",
      );
    },
  );

  it("qualifies the sensitivity array before length or recordset evaluation", () => {
    const type = submit.indexOf(
      "if jsonb_typeof(v_sensitivity) is distinct from 'array' then",
    );
    const length = submit.indexOf(
      "if jsonb_array_length(v_sensitivity) not between 1 and 20 then",
    );
    expect(type).toBeGreaterThan(-1);
    expect(length).toBeGreaterThan(type);
    expect(length).toBeLessThan(
      submit.indexOf("jsonb_to_recordset(v_sensitivity)"),
    );
  });

  it("refuses every nonobject sensitivity member before numeric record conversion", () => {
    const guard = submit.indexOf(
      "jsonb_typeof(item) is distinct from 'object'",
    );
    expect(guard).toBeGreaterThan(
      submit.indexOf("jsonb_array_length(v_sensitivity)"),
    );
    expect(guard).toBeLessThan(
      submit.indexOf("jsonb_to_recordset(v_sensitivity)"),
    );
    expect(submit).toContain("each sensitivity factor must be an object");
  });

  it.each(sensitivityNumeric)(
    "refuses non-finite sensitivity %s before swing arithmetic",
    (field) => {
      const guard = submit.indexOf(
        `${field}::text in ('NaN','Infinity','-Infinity')`,
      );
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(
        submit.indexOf("round(abs(high_output-low_output),4)"),
      );
      expect(submit).toContain(
        "sensitivity factor ranges must contain finite numbers",
      );
    },
  );

  it("catches explicit PostgreSQL date-format and date-overflow conditions separately from numbers", () => {
    expect(compact).toContain(
      "begin v_review_due:=nullif(p_analysis->>'review_due_at','')::timestamptz; exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('error','review due date must be a valid timestamp'); end;",
    );
    expect(submit).not.toMatch(/exception when others/i);
    expect(submit).toContain(
      "exception when invalid_text_representation or numeric_value_out_of_range then",
    );
  });

  it("uses canonical timestamp finiteness without changing timestamp casts or future limits", () => {
    const guard = submit.indexOf("if not isfinite(v_review_due) then");
    expect(guard).toBeGreaterThan(submit.indexOf("::timestamptz"));
    expect(guard).toBeLessThan(
      submit.indexOf("if v_review_due is null or v_review_due<=now() then"),
    );
    expect(submit).toContain("review due date must be a finite timestamp");
    expect(submit).toContain("review due date must be in the future");
    expect(submit).not.toContain("AT TIME ZONE");
  });

  it("preserves original numerical bounds and sensitivity math while matching canonical unrounded VOI classification", () => {
    for (const original of [
      "v_probability_lower<0 or v_probability_upper>1",
      "v_probability_lower<=v_probability_central and v_probability_central<=v_probability_upper",
      "v_confidence_level<=0 or v_confidence_level>1",
      "v_ci_lower<0 or v_ci_upper>1 or v_ci_lower>v_ci_upper",
      "v_best<=v_expected and v_expected<=v_worst",
      "low_input>base_input or base_input>high_input",
      "low_output<0 or base_output<0 or high_output<0",
      "round(abs(high_output-low_output),4)",
      "v_uncertainty_reduction not between 0 and 1",
      "v_change_probability not between 0 and 1",
      "v_voi_expected_raw:=v_wrong_cost*v_uncertainty_reduction*v_change_probability",
      "v_voi_net_raw:=v_voi_expected_raw-v_info_cost",
      "v_voi_expected:=round(v_voi_expected_raw,2)",
      "v_voi_net:=round(v_voi_net_raw,2)",
      "v_voi_net_raw>0 then 'GATHER_INFORMATION' else 'DECIDE_WITH_CURRENT_INFORMATION'",
    ])
      expect(submit).toContain(original);
  });

  it("adds every special value in all numeric fields to the same rollback-only transcript", () => {
    const cases =
      transcript
        .split("-- U18 FINITE INPUT REFUSALS BEGIN")[1]
        ?.split("-- U18 FINITE INPUT REFUSALS END")[0] ?? "";
    expect(cases).not.toBe("");
    for (const [field] of topNumeric) expect(cases).toContain(`'${field}'`);
    for (const field of sensitivityNumeric)
      expect(cases).toContain(`'${field}'`);
    expect(cases).toContain("array['NaN','+Infinity','-Infinity']");
    expect(cases).toContain(
      "result is distinct from jsonb_build_object('error',",
    );
    expect(cases).toContain("pg_temp.u18_state() is distinct from baseline");
    expect(transcript.indexOf("begin;")).toBeLessThan(
      transcript.indexOf("-- U18 FINITE INPUT REFUSALS BEGIN"),
    );
    expect(transcript.indexOf("-- U18 FINITE INPUT REFUSALS END")).toBeLessThan(
      transcript.indexOf("rollback;"),
    );
    expect(cases).not.toMatch(/\b(commit|truncate|update|delete)\b/i);
  });

  it("requires native nonobject, invalid-date and infinite-date exact refusal witnesses", () => {
    const cases =
      transcript
        .split("-- U18 FINITE INPUT REFUSALS BEGIN")[1]
        ?.split("-- U18 FINITE INPUT REFUSALS END")[0] ?? "";
    for (const value of [
      "null::jsonb",
      "'null'::jsonb",
      "'[]'::jsonb",
      "'1'::jsonb",
      "'true'::jsonb",
      "'\"scalar\"'::jsonb",
      "not-a-calendar-instant",
      "2027-02-30T00:00:00Z",
      "999999999-01-01T00:00:00Z",
      "array['infinity','+infinity','-infinity']",
    ])
      expect(cases).toContain(value);
    expect(cases).toContain("jsonb_set(f.input,'{sensitivity}',bad)");
    expect(cases).toContain("jsonb_build_array(bad)");
    expect(cases).toContain("uncertainty analysis must be an object");
    expect(cases).toContain("each sensitivity factor must be an object");
    expect(cases).toContain("review due date must be a valid timestamp");
    expect(cases).toContain("review due date must be a finite timestamp");
  });

  it("compares full canonical artifact rows rather than only decisions/work counts", () => {
    expect(transcript).toContain(
      "'decisions',(select jsonb_agg(to_jsonb(d) order by d.id) from decisions d",
    );
    expect(transcript).toContain(
      "'work',(select jsonb_agg(to_jsonb(w) order by w.id) from work_orders w",
    );
    for (const key of [
      "risks",
      "packets",
      "bindings",
      "approvals",
      "audit",
      "evidence",
      "decisions",
      "work",
    ])
      expect(transcript).toContain(`'${key}',`);
  });
});
