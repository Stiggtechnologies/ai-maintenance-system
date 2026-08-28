/**
 * Sync Develop Slice 2 — migration contract (static, no database).
 *
 * The live behavior is proven by scripts/ci-develop-slice2-smoke.sh against
 * a real local database (two-role transcript, refusals exercised, the
 * threshold→invalidation→collapse chain fired end-to-end). This file pins
 * the CONTRACT in the migration text so a later edit that loosens an
 * invariant, forks a canonical store, or teaches SQL to compute what the
 * kernel owns fails CI before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

const objectives = read(
  "20261115090000_develop_objective_nesting_and_risk_link_invariant.sql",
);
const assumptions = read(
  "20261115090100_develop_assumption_family_resolution.sql",
);
const finance = read("20261115090200_develop_finance_model.sql");
const contract = read("20261115090300_develop_success_contract.sql");
const trajectory = read("20261115090400_develop_value_trajectory.sql");
const collapse = read("20261115090500_develop_case_collapse_trigger.sql");
const benefit = read("20261115090600_develop_benefit_owner.sql");
const workspace = read("20261115090700_develop_workspace_read_v4.sql");
const lowerAll = [
  objectives,
  assumptions,
  finance,
  contract,
  trajectory,
  collapse,
  benefit,
  workspace,
]
  .join("\n")
  .toLowerCase();

describe("objective nesting + the risk→objective invariant (D11.15/D11.16)", () => {
  it("extends the ONE objective store — no second objective table anywhere in the slice", () => {
    expect(objectives).toContain("alter table public.risk_objectives");
    expect(lowerAll).not.toMatch(/create table[^;]*objectives/);
  });

  it("a numeric target demands its unit, at the schema and at the RPC", () => {
    expect(objectives).toContain("risk_objectives_typed_target_unit");
    expect(objectives).toContain(
      "a numeric target states its unit — a bare number answers nothing",
    );
  });

  it("nesting integrity refuses cycles for EVERY writer (no service escape)", () => {
    expect(objectives).toContain("enforce_objective_nesting_integrity");
    expect(objectives).toContain("close a cycle");
    const fn = objectives.slice(
      objectives.indexOf("enforce_objective_nesting_integrity"),
      objectives.indexOf("drop trigger if exists trg_objective_nesting_integrity"),
    );
    // A cyclic hierarchy is corrupt data, not a provenance question: the
    // trigger must NOT carry the admit-the-service-path branch.
    expect(fn).not.toContain("current_user not in ('authenticated', 'anon')");
  });

  it("a NEW risk without an objective link is refused as check_violation; the service path is admitted AND audited", () => {
    expect(objectives).toContain("enforce_risk_objective_link");
    expect(objectives).toMatch(/check_violation/);
    expect(objectives).toContain("inserted without an objective link");
    expect(objectives).toContain("A risk always links to an objective (spec §2)");
  });

  it("clearing an existing link is refused — a risk cannot be silently unhooked", () => {
    expect(objectives).toContain(
      "old.objective_id is not null and new.objective_id is null",
    );
    expect(objectives).toContain("cannot be cleared");
  });

  it("grandfathers WITH a per-organization count into audit_events, never silently", () => {
    expect(objectives).toContain("'risk_objective_invariant'");
    expect(objectives).toContain("'unlinked_risks', org.unlinked");
  });

  it("create_risk_assessment requires an ADOPTED objective — the link_risk_objective standard, no weaker creation path", () => {
    expect(objectives).toMatch(
      /from risk_objectives\s+where id = nullif\(p_assessment->>'objective_id',''\)::uuid\s+and organization_id = v_org and status = 'adopted'/,
    );
    expect(objectives).toContain("pass objective_id naming an ADOPTED objective");
  });
});

describe("the assumption family resolved on risk_assumptions (D2.06/D3.29 — ruling 5)", () => {
  it("no fourth assumption store: the slice creates no assumption table", () => {
    expect(lowerAll).not.toMatch(/create table[^;]*assumption/);
  });

  it("an assumption is anchored somewhere, always", () => {
    expect(assumptions).toContain("risk_assumptions_anchor_present");
    expect(assumptions).toContain(
      "risk_id is not null or development_case_id is not null",
    );
  });

  it("the viability predicate is complete or absent, with a bounded comparator set", () => {
    expect(assumptions).toContain("risk_assumptions_predicate_complete");
    expect(assumptions).toContain("('>=','<=','>','<')");
  });

  it("a threshold must name a series the numeric leg actually records", () => {
    expect(assumptions).toContain("alarm wired to nothing");
  });

  it("declared thresholds ride the ONE indicator machinery — assumption_id on risk_indicators, no monitor table", () => {
    expect(assumptions).toContain("alter table public.risk_indicators");
    expect(assumptions).toContain("idx_risk_indicators_assumption");
    expect(lowerAll).not.toMatch(/create table[^;]*(monitor|indicator)/);
  });

  it("read policies learn the null-risk anchor with the established risk_event_scenarios shape — risk-anchored predicates unchanged", () => {
    expect(assumptions).toContain(
      "(organization_id=app_current_org() and (risk_id is null or can_read_risk(risk_id)))",
    );
  });

  it("invalidation has ONE core; the human RPC keeps every check it had", () => {
    expect(assumptions).toContain("apply_assumption_invalidation");
    expect(assumptions).toContain(
      "revoke all on function public.apply_assumption_invalidation(uuid, text, text) from public, anon, authenticated",
    );
    // role/ownership/reason checks survive in the re-created human RPC
    expect(assumptions).toContain("a.owner_id<>auth.uid()");
    expect(assumptions).toContain("record why the assumption is invalid");
  });
});

describe("the finance model on the existing family (D2.04/D2.01)", () => {
  it("creates no parallel finance store", () => {
    expect(lowerAll).not.toMatch(
      /create table[^;]*(finance|business_case|cash_flow)/,
    );
  });

  it("the numeric leg's write path restates the born rule: no unsourced numbers", () => {
    expect(finance).toContain(
      "an assumption with no source is a number somebody liked",
    );
    expect(finance).toContain("the series is the record");
  });

  it("the hypothesis is machine-readable or absent — spend, effect, value, basis together at the schema", () => {
    expect(finance).toContain("business_cases_hypothesis_complete");
    expect(finance).toContain("slogan");
  });

  it("the viability floor carries a stated basis and is never silently removable", () => {
    expect(finance).toContain("business_cases_viability_floor_basis");
    expect(finance).toContain("revised, never removed");
  });

  it("contingency states its basis (the capital_plan_items idiom)", () => {
    expect(finance).toContain("business_case_options_contingency_basis");
  });

  it("a flow with an ABSENT period or amount key is refused — jsonb_typeof(NULL) never slips the guard (repair of the NaN-USD defect)", () => {
    expect(finance).toContain(
      "coalesce(jsonb_typeof(cf->'period'), 'missing') <> 'number'",
    );
    expect(finance).toContain(
      "coalesce(jsonb_typeof(cf->'amount'), 'missing') <> 'number'",
    );
  });

  it("cash-flow shape is an unbypassable schema CHECK for every writer (the D9.10 idiom)", () => {
    expect(finance).toContain("cash_flows_well_formed");
    expect(finance).toContain("business_case_options_cash_flows_shape");
  });

  it("SQL never computes NPV/IRR/payback — the kernel owns the arithmetic; the model returns inputs and NAMED refusals", () => {
    expect(finance).not.toMatch(/power\s*\(\s*1\s*\+/i);
    expect(finance).toContain("NPV unavailable: no discount rate source recorded");
    expect(finance).toContain("npvInputsComplete");
  });

  it("the D2.07 sweep is deterministic and runs where the numeric leg moves", () => {
    expect(finance).toContain("Business case threshold violated (spec I.12)");
    expect(finance).toContain("apply_assumption_invalidation");
    expect(finance).not.toMatch(/\bllm\b|openai|anthropic|gpt/i);
  });
});

describe("the ProjectSuccessContract (D1.01) and its lifecycle invariant (D1.02)", () => {
  it("carries the eleven I.3 dimensions verbatim", () => {
    for (const dim of [
      "'business'",
      "'safety'",
      "'operational'",
      "'reliability'",
      "'availability'",
      "'maintainability'",
      "'quality'",
      "'schedule'",
      "'cost'",
      "'environmental'",
      "'stakeholder'",
    ]) {
      expect(contract).toContain(dim);
    }
  });

  it("every outcome carries basis and owner at the schema", () => {
    expect(contract).toMatch(/basis text not null check \(btrim\(basis\) <> ''\)/);
    expect(contract).toMatch(
      /owner_id uuid not null references user_profiles\(id\)/,
    );
  });

  it("RAM dimensions REFERENCE ram_targets and never duplicate the number", () => {
    expect(contract).toContain(
      "dimension in ('reliability','availability','maintainability')",
    );
    expect(contract).toContain("no second copy of the number");
    expect(contract).toContain("REFERENCES one (pass ram_target_id)");
  });

  it("recording is a human accountability act — ai_admin refused by name; an empty contract is not recordable", () => {
    expect(contract).toContain("the AI-operator identity cannot record it");
    expect(contract).toContain("no outcomes defines no success");
  });

  it("a recorded contract is immutable to clients; the service path is admitted AND audited", () => {
    expect(contract).toContain("enforce_success_contract_immutability");
    expect(contract).toContain("Recorded success-contract content");
    expect(contract).toMatch(/using errcode = 'insufficient_privilege'/);
  });

  it("no client write policy exists on either contract table — reads only", () => {
    const policies = contract.match(/create policy[^;]+;/gi) ?? [];
    const onContractTables = policies.filter((p) =>
      /development_success_(contracts|outcomes)/.test(p),
    );
    expect(onContractTables.length).toBe(2);
    for (const p of onContractTables) {
      expect(p).toMatch(/for select to authenticated/);
    }
  });

  it("D1.02 lands in the gate machinery: design-or-later gates refuse a proceed without a recorded contract, AFTER the segregation check", () => {
    expect(trajectory).toContain(
      "success is established before design begins (spec I.3)",
    );
    const seg = trajectory.indexOf("segregation of duties");
    const d102 = trajectory.indexOf(
      "success is established before design begins (spec I.3)",
    );
    expect(seg).toBeGreaterThan(-1);
    expect(d102).toBeGreaterThan(seg);
    expect(trajectory).toContain("stage_order");
  });

  it("readiness names the missing contract as a blocker with the same predicate", () => {
    expect(trajectory).toContain("'type', 'success_contract'");
  });
});

describe("recorded evaluations, the trajectory, and the delta (D2.02/D2.05)", () => {
  it("extends lifecycle_evaluations — the record gates already link to — rather than creating a second evaluation store", () => {
    expect(trajectory).toContain("alter table public.lifecycle_evaluations");
    expect(lowerAll).not.toMatch(/create table[^;]*evaluation/);
  });

  it("an evaluation refuses with the missing thing named", () => {
    for (const refusal of [
      "no business case is recorded on this case",
      "discount rate has no recorded source",
      "no dated cash flows",
      "must be one of this business case",
      "a value without its basis is a liability",
    ]) {
      expect(trajectory).toContain(refusal);
    }
  });

  it("inputs are frozen SERVER-side from the recorded model, never taken from the caller", () => {
    expect(trajectory).toContain("'discountRateSource', bc.discount_rate_source");
    expect(trajectory).toContain("'evaluatedOption'");
    expect(trajectory).toContain("financialAssumptionVersions");
  });

  it("the trajectory renders recorded points only — the exact words at unevaluated gates, no carry-forward", () => {
    expect(trajectory).toContain("'not evaluated at this gate'");
    expect(trajectory).not.toMatch(/carry.?forward/i);
    expect(trajectory).toContain("r.evaluation_id is not null");
  });

  it("a review may link only a value evaluation of THIS case", () => {
    expect(trajectory).toContain("not a value evaluation of this case");
  });

  it("a recorded evaluation is immutable at the persistence boundary — marker-doored, service admitted AND audited (repair)", () => {
    expect(trajectory).toContain("enforce_case_value_evaluation_immutability");
    expect(trajectory).toContain("trg_case_value_evaluation_immutability");
    expect(trajectory).toContain(
      "set_config('app.case_value_evaluation_write', 'granted', true)",
    );
    expect(trajectory).toContain("A recorded value evaluation is immutable");
    expect(collapse).toContain(
      "set_config('app.case_value_evaluation_write', 'granted', true)",
    );
  });

  it("the delta needs both ends and names the missing side of every non-comparable dimension", () => {
    expect(trajectory).toContain("there is no sanction moment to diff against");
    expect(trajectory).toContain("the sanction baseline is absent");
    expect(trajectory).toContain("the delta needs both ends");
    expect(trajectory).toContain("missing at the sanction baseline");
    expect(trajectory).toContain("missing in the current evaluation");
  });
});

describe("the collapse trigger through the canonical store (D2.03 — §70)", () => {
  it("raises a RECOMMENDATION in the canonical recommendations table — no second queue, no new table", () => {
    expect(collapse).toContain("insert into recommendations");
    expect(collapse).not.toMatch(/create table/i);
  });

  it("is rules-based on RECORDED values and refuses when the floor or the evaluation is missing", () => {
    expect(collapse).toContain("no viability floor is declared");
    expect(collapse).toContain(
      "collapse is judged on recorded values only",
    );
    expect(collapse).not.toMatch(/llm|openai|anthropic/i);
  });

  it("speaks the spec's words and leaves the decision to humans", () => {
    expect(collapse).toContain(
      "Sync recommendation: reconsider sanction (spec I.4)",
    );
    expect(collapse).toContain("a human re-decides; nothing was changed automatically");
  });

  it("deduplicates: one pending reconsideration per case, later signals audited onto the record", () => {
    expect(collapse).toContain("already_open");
    expect(collapse).toContain("'case_collapse_signal'");
  });

  it("re-asserts the caller-validated organization on the case lookup (defense-in-depth, repair)", () => {
    expect(collapse).toMatch(
      /select \* into c from development_cases\s+where id = p_case_id and organization_id = p_organization_id/,
    );
  });

  it("travels the governed case-binding door with the marker, and is client-revoked machinery", () => {
    expect(collapse).toContain(
      "set_config('app.recommendation_case_binding_write', 'granted', true)",
    );
    expect(collapse).toContain(
      "revoke all on function public.evaluate_business_case_collapse(uuid, uuid, text) from public, anon, authenticated",
    );
  });
});

describe("Benefit with a mandatory owner on the ONE value store (D9.10)", () => {
  it("extends value_metrics — no Benefit table beside it", () => {
    expect(benefit).toContain("alter table public.value_metrics");
    expect(lowerAll).not.toMatch(/create table[^;]*benefit/);
  });

  it("a case benefit without owner, date or basis cannot insert — schema CHECK, every writer", () => {
    expect(benefit).toContain("value_metrics_case_benefit_owner");
    expect(benefit).toMatch(
      /development_case_id is null\s+or \(owner_id is not null\s+and expected_date is not null\s+and basis is not null and btrim\(basis\) <> ''\)/,
    );
  });

  it("the owner is held to THIS organization's membership by trigger", () => {
    expect(benefit).toContain("enforce_benefit_owner_membership");
    expect(benefit).toContain("does not cross tenants");
  });

  it("the case the benefit binds to is held to THIS organization too (repair)", () => {
    expect(benefit).toContain(
      "a benefit pointing at another tenant''s development case is refused",
    );
  });

  it("verification stays the one loop", () => {
    expect(benefit).toContain("verify_value_metric");
    expect(benefit).not.toMatch(/create or replace function[^;]*verify/i);
  });
});

describe("the workspace read v4 (D13.04)", () => {
  it("is built on the LATEST prior definition — the P6 'schedule' section is retained", () => {
    expect(workspace).toContain("'schedule', coalesce((");
  });

  it("adds the five value-spine sections", () => {
    for (const key of [
      "'objective',",
      "'successContract',",
      "'businessCases',",
      "'caseAssumptions',",
      "'benefits',",
    ]) {
      expect(workspace).toContain(key);
    }
  });

  it("stays SECURITY INVOKER — RLS is the read boundary", () => {
    expect(workspace).toMatch(
      /function public\.get_development_case[\s\S]*?security invoker/i,
    );
  });
});

describe("definer hygiene (the ratchet)", () => {
  it("every new SECURITY DEFINER function revokes from public and anon", () => {
    for (const name of [
      "get_objective_tree",
      "record_case_assumption",
      "upsert_financial_assumption",
      "create_case_business_case",
      "record_value_hypothesis",
      "set_case_viability_floor",
      "add_business_case_option",
      "draft_success_contract",
      "set_success_outcome",
      "record_success_contract",
      "record_case_value_evaluation",
      "get_case_value_trajectory",
      "get_since_sanction_delta",
      "record_case_gate_review",
      "get_gate_readiness",
      "record_case_benefit",
      "get_development_case",
    ]) {
      expect(lowerAll).toMatch(
        new RegExp(
          `revoke (all|execute) on function public\\.${name}\\([^)]*\\) from public, anon`,
        ),
      );
    }
  });

  it("every new definer RPC resolves the tenant from the session", () => {
    for (const sql of [assumptions, finance, contract, trajectory, benefit]) {
      const definers = sql.match(/create or replace function[\s\S]*?\$\$;/g) ?? [];
      for (const fn of definers) {
        if (!/security definer/i.test(fn)) continue;
        if (/apply_assumption_invalidation|evaluate_business_case_collapse/.test(fn)) {
          // Internal machinery: client-revoked, called inside authenticated
          // definer chains that already org-validated the subject.
          continue;
        }
        expect(fn).toMatch(/app_current_org\(\)/);
      }
    }
  });
});
