/**
 * Sync Develop Slice 3C — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice3c-smoke.sh
 * against a real local database (multi-role transcript: commitments and the
 * coverage detector, the regulatory chain end to end with propagation into
 * delivery AND operations, breach escalation through the ONE sweep, the
 * II.15 competency/conflict refusals, design-vs-operating control
 * assessment, treatment secondary-risk creation, and the §46 refusal).
 *
 * This file pins the CONTRACT in the migration text so a later edit that
 * loosens an invariant, forks a canonical store, drops a refusal or lets a
 * vocabulary drift from the TypeScript fails CI before it reaches a
 * database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  APPLICABILITY_GRADES,
  ASSURANCE_CONCLUSIONS,
  ASSURANCE_LEVEL_RANK,
  CONTROL_EFFECTIVENESS_VALUES,
  OBLIGATION_DOMAINS,
  QUALITY_GRADES,
  TREATMENT_STRATEGIES,
} from "../lib/develop/chains";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

const commitments = read("20261122090000_develop_stakeholder_commitments.sql");
const chain = read("20261122090100_regulatory_approval_chain.sql");
const propagation = read("20261122090200_regulatory_condition_propagation.sql");
const assurance = read("20261122090300_assurance_competency_conflicts.sql");
const controlAssessment = read(
  "20261122090400_control_assessment_design_operating.sql",
);
const secondaryRisk = read("20261122090500_treatment_secondary_risk.sql");
const confidence = read("20261122090600_evidence_confidence.sql");
const chainsRead = read("20261122090700_develop_case_chains_read.sql");

const all = [
  commitments,
  chain,
  propagation,
  assurance,
  controlAssessment,
  secondaryRisk,
  confidence,
  chainsRead,
];
const lowerAll = all.join("\n").toLowerCase();

/** Every table this slice creates ships org-scoped RLS in the same file. */
const NEW_TABLES = [
  ["stakeholder_commitments", commitments],
  ["regulatory_requirements", chain],
  ["regulatory_applications", chain],
  ["regulatory_information_requests", chain],
  ["regulatory_approvals", chain],
  ["regulatory_conditions", chain],
  ["evidence_confidence_profiles", confidence],
] as const;

describe("house law — every new table, org-scoped and definer-written", () => {
  it.each(NEW_TABLES)(
    "%s enables RLS and carries an org-scoped read policy in its own migration",
    (table, source) => {
      expect(source).toContain(`create table if not exists public.${table} (`);
      expect(source).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(source).toMatch(
        new RegExp(
          `create policy ${table}_read on public\\.${table}[\\s\\S]{0,160}organization_id = app_current_org\\(\\)`,
        ),
      );
    },
  );

  it.each(NEW_TABLES)(
    "%s grants no client INSERT/UPDATE/DELETE policy — every mutation is a definer RPC",
    (table, source) => {
      const permissiveWrite = new RegExp(
        `create policy [a-z_]+ on public\\.${table}\\s+for (insert|update|delete|all)`,
        "g",
      );
      const matches = [...source.matchAll(permissiveWrite)].filter(
        (m) => !m[0].includes("as restrictive"),
      );
      expect(matches).toEqual([]);
    },
  );

  it("every function this slice defines is revoked from public and anon", () => {
    // Including the trigger functions: PostgreSQL does not check EXECUTE on a
    // trigger function when the trigger fires, so revoking costs nothing and
    // closes a direct-call surface (the enforce_risk_objective_link
    // precedent, 20261115090000).
    const defined = all.flatMap((source) =>
      [
        ...source.matchAll(/create or replace function public\.([a-z_]+)\(/g),
      ].map((m) => m[1]),
    );
    expect(new Set(defined).size).toBeGreaterThan(15);
    for (const name of new Set(defined)) {
      // `revoke all` and `revoke execute` are the same protection on a
      // function — EXECUTE is the only privilege one has. The two re-created
      // ROS functions keep their original `revoke execute` wording so the
      // re-creation stays byte-identical where it can.
      expect(lowerAll, `${name} must be revoked from anon`).toMatch(
        new RegExp(`revoke (all|execute) on function public\\.${name}`),
      );
    }
  });
});

describe("D3.08 StakeholderCommitment (spec I.18) — the seven fields", () => {
  it("carries all seven spec fields as columns, with the requirement link NULLABLE", () => {
    const table = commitments.slice(
      commitments.indexOf(
        "create table if not exists public.stakeholder_commitments (",
      ),
      commitments.indexOf(
        "create unique index if not exists idx_stakeholder_commitments_ref",
      ),
    );
    // 1 stakeholder, 2 concern, 3 commitment, 4 requirement, 5 owner,
    // 6 due date, 7 evidence.
    expect(table).toContain(
      "stakeholder_id uuid not null references risk_stakeholders(id) on delete restrict",
    );
    expect(table).toContain("concern text not null");
    expect(table).toContain("commitment text not null");
    expect(table).toContain(
      "requirement_id bigint references design_requirements(id) on delete set null",
    );
    expect(table).toContain("owner_id uuid not null references auth.users(id)");
    expect(table).toContain("due_date date not null");
    expect(table).toContain(
      "evidence_item_id uuid references evidence_items(id) on delete set null",
    );
    // The link must NOT be NOT NULL: D3.09's detection would become a
    // tautology that can only ever return zero.
    expect(table).not.toMatch(/requirement_id bigint not null/);
  });

  it("REUSES the one stakeholder registry and the one requirement table — no forks", () => {
    expect(lowerAll).not.toMatch(/create table[^;]*project_stakeholders/);
    expect(lowerAll).not.toMatch(/create table[^;]*case_stakeholders/);
    expect(lowerAll).not.toMatch(/create table[^;]*project_requirements/);
    expect(lowerAll).not.toMatch(/create table[^;]*case_requirements/);
    // design_requirements is GENERALIZED, never twinned.
    expect(commitments).toContain("alter table public.design_requirements");
    expect(commitments).toContain(
      "add column if not exists development_case_id uuid",
    );
  });

  it("closure is evidence-gated and §70-backstopped for every writer", () => {
    expect(commitments).toContain("constraint sc_closure_complete check (");
    expect(commitments).toContain(
      "status <> 'satisfied'\n    or (evidence_item_id is not null and closed_by is not null and closed_at is not null)",
    );
    const trigger = commitments.slice(
      commitments.indexOf(
        "function public.enforce_stakeholder_commitment_provenance",
      ),
      commitments.indexOf(
        "drop trigger if exists trg_stakeholder_commitment_provenance",
      ),
    );
    expect(trigger).toContain("up.role = 'ai_admin'");
    expect(trigger).toContain("raise exception");
    expect(commitments).toContain(
      "before insert or update or delete on public.stakeholder_commitments",
    );
  });

  it("the discharge RPC refuses the AI-operator identity and demands case-scoped evidence", () => {
    const fn = commitments.slice(
      commitments.indexOf("function public.close_stakeholder_commitment("),
      commitments.indexOf(
        "revoke all on function public.close_stakeholder_commitment",
      ),
    );
    expect(fn).toContain("'ai_admin'");
    expect(fn).toContain("§70 human determination");
    expect(fn).toContain(
      "ev.development_case_id is distinct from sc.development_case_id",
    );
    expect(fn).toContain("already satisfied");
  });
});

describe("D3.09 coverage detection", () => {
  const fn = commitments.slice(
    commitments.indexOf("function public.get_case_commitment_coverage("),
    commitments.indexOf(
      "revoke all on function public.get_case_commitment_coverage",
    ),
  );

  it("detects BOTH directions and returns a null percentage over an empty set", () => {
    expect(fn).toContain("'uncoveredCommitments'");
    expect(fn).toContain("'requirementsWithoutCommitment'");
    expect(fn).toContain("sc.requirement_id is null");
    expect(fn).toContain("case when v_total > 0");
    // No `else 0` / `else 100` fallback on the percentage.
    expect(fn).not.toMatch(/coveragePct[\s\S]{0,120}else 0/);
  });

  it("excludes withdrawn commitments but NOT satisfied ones", () => {
    expect(fn).toContain("sc.status <> 'withdrawn'");
    expect(fn).not.toContain("sc.status = 'open'");
  });
});

describe("D3.10 the regulatory chain (spec I.19)", () => {
  it("builds all five links as real objects, and does NOT fork the onboarding checklist", () => {
    for (const t of [
      "regulatory_requirements",
      "regulatory_applications",
      "regulatory_information_requests",
      "regulatory_approvals",
      "regulatory_conditions",
    ]) {
      expect(chain).toContain(`create table if not exists public.${t} (`);
    }
    expect(lowerAll).not.toContain("onboarding_requirements");
  });

  it("narrows the provenance ladder to the two tiers a regulator can occupy", () => {
    expect(chain).toContain("check (source_authority in ('LAW','REGULATION'))");
  });

  it("expiry is stated, never left null and hoped over (the D3.20 lesson)", () => {
    expect(chain).toContain("constraint rap_expiry_stated check (");
    expect(chain).toContain("perpetual boolean not null default false");
    expect(chain).toContain("constraint rap_perpetual_has_no_expiry check (");
  });

  it("§70: an approval names a human recorder, and never the AI-operator identity", () => {
    const trigger = chain.slice(
      chain.indexOf("function public.enforce_regulatory_approval_human_record"),
      chain.indexOf(
        "drop trigger if exists trg_regulatory_approval_human_record",
      ),
    );
    expect(trigger).toContain("up.role = 'ai_admin'");
    expect(trigger).toContain("Spec §70");
    expect(chain).toContain(
      "before insert or update on public.regulatory_approvals",
    );
  });

  it("a conditional grant carries first-class conditions, enforced at commit", () => {
    expect(chain).toContain(
      "create constraint trigger trg_conditional_approval_has_conditions",
    );
    expect(chain).toContain("deferrable initially deferred");
    expect(chain).toContain(
      "after insert or update on public.regulatory_approvals",
    );
  });

  it("conditions are born complete, on the D3.18 contract", () => {
    const table = chain.slice(
      chain.indexOf(
        "create table if not exists public.regulatory_conditions (",
      ),
      chain.indexOf(
        "create unique index if not exists idx_regulatory_conditions_ref",
      ),
    );
    expect(table).toContain("owner_id uuid not null references auth.users(id)");
    expect(table).toContain("due_date date not null");
    expect(table).toContain("evidence_requirement text not null");
    expect(table).toContain("consequence_if_missed text not null");
  });

  it("the obligation-domain vocabulary matches the TypeScript exactly", () => {
    const domains = OBLIGATION_DOMAINS.map((d) => `'${d.value}'`).join(",");
    expect(chain).toContain(
      `obligation_domain text not null check (obligation_domain in\n    (${domains})`,
    );
  });
});

describe("D3.11 propagation into delivery AND operations", () => {
  const fn = propagation.slice(
    propagation.indexOf("function public.propagate_regulatory_conditions("),
    propagation.indexOf(
      "revoke all on function public.propagate_regulatory_conditions",
    ),
  );

  it("routes to the two canonical stores and creates no third obligation table", () => {
    expect(fn).toContain("insert into design_requirements (");
    expect(fn).toContain("insert into work_orders (");
    expect(lowerAll).not.toMatch(/create table[^;]*compliance_obligations/);
    expect(lowerAll).not.toMatch(/create table[^;]*operational_obligations/);
  });

  it("FAILS CLOSED when an operational condition has nowhere in operations to land", () => {
    expect(fn).toContain("v_asset_count = 0");
    expect(fn).toContain("has nowhere in operations to land");
    expect(fn).toContain("bind_asset_to_development_case");
    // The refusal comes BEFORE any insert: a half-landed permit is worse
    // than none, because it looks done.
    expect(fn.indexOf("has nowhere in operations to land")).toBeLessThan(
      fn.indexOf("insert into design_requirements ("),
    );
  });

  it("records where each condition landed, and is idempotent", () => {
    expect(fn).toContain("propagated_requirement_id = v_req");
    expect(fn).toContain("propagated_work_order_id = v_wo");
    expect(fn).toContain("rec.propagated_requirement_id is not null");
    expect(fn).toContain("rec.propagated_work_order_id is not null");
  });

  it("the approval act propagates in the SAME transaction and aborts on refusal", () => {
    const record = propagation.slice(
      propagation.indexOf("function public.record_regulatory_approval("),
      propagation.indexOf(
        "revoke all on function public.record_regulatory_approval",
      ),
    );
    expect(record).toContain("v_prop := propagate_regulatory_conditions(v_id)");
    expect(record).toContain("raise exception '%', v_prop->>'error'");
    expect(record).toContain("'ai_admin'");
  });

  it("a recurring condition RE-ARMS instead of closing for good", () => {
    const close = propagation.slice(
      propagation.indexOf("function public.close_regulatory_condition("),
      propagation.indexOf(
        "revoke all on function public.close_regulatory_condition",
      ),
    );
    expect(close).toContain("v_recurring := rc.recurrence <> 'one_time'");
    expect(close).toContain("set due_date = v_next, status = 'open'");
  });
});

describe("the ONE governance sweep, extended (ruling 15)", () => {
  const sweep = propagation.slice(
    propagation.indexOf("function public.expire_governance_instruments()"),
    propagation.indexOf(
      "revoke all on function public.expire_governance_instruments",
    ),
  );

  it("is the SAME function re-created, not a second escalator", () => {
    expect(propagation).toContain(
      "create or replace function public.expire_governance_instruments()",
    );
    expect(lowerAll).not.toMatch(
      /create or replace function public\.expire_regulatory/,
    );
    expect(lowerAll).not.toMatch(
      /create or replace function public\.escalate_/,
    );
  });

  it("keeps every pre-existing pass byte-identical", () => {
    expect(sweep).toContain(
      "update standard_site_variances set status = 'expired'",
    );
    expect(sweep).toContain("update risk_acceptances set status = 'expired'");
    expect(sweep).toContain("update gate_conditions gc");
    expect(sweep).toContain("'gate_conditions_escalated', v_cond");
  });

  it("adds regulatory conditions, lapsed permits, overdue RFIs and breached commitments", () => {
    expect(sweep).toContain("update regulatory_conditions rc");
    expect(sweep).toContain("REGULATORY CONDITION BREACHED");
    expect(sweep).toContain("update regulatory_approvals ap");
    expect(sweep).toContain("NO LONGER AUTHORIZED");
    expect(sweep).toContain("update regulatory_information_requests q");
    expect(sweep).toContain("update stakeholder_commitments sc");
    expect(sweep).toContain("STAKEHOLDER COMMITMENT BREACHED");
    expect(sweep).toContain("'permits_expired', v_permits");
    expect(sweep).toContain("'stakeholder_commitments_breached', v_commit");
  });

  it("stays on the same hourly pg_cron slot", () => {
    expect(propagation).toContain(
      "cron.schedule('expire-governance-instruments', '7 * * * *'",
    );
  });
});

describe("D3.16 AssuranceReview (spec II.15)", () => {
  it("EXTENDS risk_assurance_reviews — no second assurance store", () => {
    expect(assurance).toContain("alter table public.risk_assurance_reviews");
    expect(assurance).toContain(
      "add column if not exists reviewer_competency_keys jsonb not null default '[]'::jsonb",
    );
    expect(assurance).toContain(
      "add column if not exists conflicts_declared jsonb not null default '[]'::jsonb",
    );
    expect(assurance).toContain(
      "add column if not exists conflicts_declared_at timestamptz",
    );
    expect(assurance).toContain(
      "add column if not exists gate_id bigint references stage_gates(id)",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*assurance_reviews/);
  });

  it("keeps a declared-with-no-timestamp shape unrepresentable", () => {
    expect(assurance).toContain(
      "constraint rar_conflicts_declaration_coherent check (",
    );
  });

  it("verifies a STATED competency against the ONE roster and fails CLOSED, naming it", () => {
    const trigger = assurance.slice(
      assurance.indexOf(
        "function public.enforce_assurance_competency_and_conflicts",
      ),
      assurance.indexOf("-- TRIGGER NAME IS LOAD-BEARING"),
    );
    expect(trigger).toContain(
      "join member_competencies mc on mc.member_id = wm.id",
    );
    expect(trigger).toContain(
      "mc.expires_on is null or mc.expires_on >= current_date",
    );
    expect(trigger).toContain("does not hold on the roster");
    expect(trigger).toContain("mitigation");
    // Every enforcement trigger covers INSERT and UPDATE — house law.
    expect(assurance).toContain(
      "before insert or update on public.risk_assurance_reviews",
    );
  });

  it("demands II.15 completeness at the act site and the consumption, and says why not at the table", () => {
    const trigger = assurance.slice(
      assurance.indexOf(
        "function public.enforce_assurance_competency_and_conflicts",
      ),
      assurance.indexOf("-- TRIGGER NAME IS LOAD-BEARING"),
    );
    // The trigger does NOT hard-require the two fields — that would have
    // broken the older risk-family write path, which has no form for them.
    expect(trigger).toContain("RESIDUAL, RECORDED HONESTLY IN THE REGISTER");
    // The act site does.
    const act = assurance.slice(
      assurance.indexOf("function public.record_case_assurance_review("),
      assurance.indexOf(
        "revoke all on function public.record_case_assurance_review",
      ),
    );
    expect(act).toContain("declare conflicts of interest");
    expect(act).toContain(
      "name the competencies this independent review requires",
    );
    // And so does the consumption: an incomplete review satisfies nothing.
    const position = assurance.slice(
      assurance.indexOf("function public.get_case_assurance_position("),
      assurance.indexOf(
        "revoke all on function public.get_case_assurance_position",
      ),
    );
    expect(position).toContain(
      "jsonb_array_length(ar.reviewer_competency_keys) > 0",
    );
    expect(position).toContain("ar.conflicts_declared_at is not null");
  });

  it("does not weaken the Slice 3B independence wall, and lets it speak first", () => {
    expect(assurance).not.toContain(
      "drop trigger if exists trg_case_assurance_independence",
    );
    expect(assurance).not.toContain("enforce_case_assurance_independence");
    // Same-timing row triggers fire alphabetically; this one must sort AFTER
    // trg_case_assurance_independence so the SoD refusal is the one a caller
    // sees when both apply.
    expect(assurance).toContain(
      "create trigger trg_case_assurance_review_competency",
    );
    expect(
      "trg_case_assurance_review_competency" >
        "trg_case_assurance_independence",
    ).toBe(true);
  });

  it("consults the ONE binding resolver through a definer helper instead of widening its grant", () => {
    // resolve_case_intensity_binding is deliberately revoked from
    // `authenticated` (20261120090200:233). get_gate_readiness is SECURITY
    // INVOKER, so the position is read through a narrow definer wrapper —
    // granting the resolver to `authenticated` would have disarmed another
    // slice's restriction to make one caller work.
    const helper = assurance.slice(
      assurance.indexOf("function public.get_case_assurance_position("),
      assurance.indexOf(
        "revoke all on function public.get_case_assurance_position",
      ),
    );
    expect(helper).toContain("security definer");
    expect(helper).toContain("resolve_case_intensity_binding");
    expect(assurance).not.toMatch(
      /grant execute on function public\.resolve_case_intensity_binding[^;]*authenticated/,
    );
  });

  it("re-creates get_gate_readiness from its LATEST ancestor, keeping Slice 2's D1.02 blocker", () => {
    const readiness = assurance.slice(
      assurance.indexOf(
        "create or replace function public.get_gate_readiness(",
      ),
    );
    // The regression this pins: rebuilding from 20261110090100 instead of
    // 20261115090400 silently deletes the success-contract blocker.
    expect(readiness).toContain("'type', 'success_contract'");
    expect(readiness).toContain(
      "success is established before design begins (spec I.3)",
    );
    expect(readiness).toContain("'successContract', v_contract");
    expect(readiness).toContain("development_success_contracts sc");
  });

  it("gate readiness consumes assurance and names the unmet demand", () => {
    const readiness = assurance.slice(
      assurance.indexOf(
        "create or replace function public.get_gate_readiness(",
      ),
    );
    // Scoped to THIS gate: a review bound to G1 does not release the demand
    // at G4 (the gate_id the column comment always claimed informed
    // readiness, and which the first draft's satisfaction test ignored).
    expect(readiness).toContain("get_case_assurance_position(c.id, g.id)");
    expect(assurance).toContain("'assurance_not_satisfied'");
    expect(readiness).toContain("'assurance', v_assurance");
    // The readiness arithmetic is untouched: still Σ(w·r)/Σw, still blocked
    // by an unmet mandatory criterion at any percentage.
    expect(readiness).toContain(
      "v_readiness := case when v_weight_sum > 0\n    then round((v_weighted_met / v_weight_sum) * 100, 1) end",
    );
    expect(readiness).toContain(
      "v_blocked := v_criteria_total = 0 or v_mandatory_met < v_mandatory_total",
    );
  });

  it("gate readiness also names regulatory conditions and overdue uncovered commitments", () => {
    const readiness = assurance.slice(
      assurance.indexOf(
        "create or replace function public.get_gate_readiness(",
      ),
    );
    // ONE predicate, three consumers: what the screen renders is what the act
    // site refuses over and what the persistence backstop enforces.
    expect(readiness).toContain(
      "v_blockers := v_blockers || case_gate_outstanding_obligations(c.id, g.id)",
    );
    expect(assurance).toContain("'regulatory_condition'");
    expect(assurance).toContain("'uncovered_commitment'");
    // Only the OVERDUE uncovered subset blocks — read from
    // get_case_commitment_coverage ITSELF, so the banner the user reads and
    // the blocker the server refuses over are one predicate rather than two
    // hand-written copies that happen to agree today.
    expect(assurance).toContain(
      "get_case_commitment_coverage(c.id)->'uncoveredCommitments'",
    );
    expect(assurance).toContain(
      "where coalesce((u->>'overdue')::boolean, false)",
    );
    // And the condition blocker names only what is actually breached: an
    // open, not-yet-due condition of a 25-year permit is being complied with.
    expect(assurance).toContain(
      "and (rc.status = 'missed' or rc.due_date < current_date)",
    );
  });

  it("the three blockers are ONE predicate, and a passing gate is REFUSED over the two this slice owns", () => {
    // The defect this pins: the first draft added three blocker families to
    // the readiness screen and nothing to the act site, so `proceed` was
    // recorded straight over an open permit condition and a broken community
    // promise named on the screen beside it.
    expect(assurance).toContain(
      "create or replace function public.case_gate_outstanding_obligations(",
    );
    const trigger = assurance.slice(
      assurance.indexOf(
        "create or replace function public.enforce_gate_review_outstanding_obligations()",
      ),
    );
    expect(trigger).toContain(
      "case_gate_outstanding_obligations(new.development_case_id, new.gate_id)",
    );
    expect(trigger).toContain(
      "where x->>'type' in ('regulatory_condition', 'uncovered_commitment')",
    );
    expect(trigger).toContain("This gate cannot pass while");
    // INSERT and UPDATE, house law.
    expect(assurance).toContain(
      "create trigger trg_outstanding_obligations_gate\n  before insert or update on public.stage_gate_reviews",
    );
    // Named to sort AFTER Slice 3B's composite-authority wall, so 3B's
    // refusals — and the transcripts asserting them — speak first.
    expect(
      "trg_outstanding_obligations_gate" > "trg_intensity_governance_binding",
    ).toBe(true);
  });

  it("the independence ladder is ordered, and a review satisfies AT OR ABOVE the demand", () => {
    // The defect this pins: only 'independent' was special-cased, so a
    // line_1 SELF-review discharged an organization's line_2 demand.
    expect(assurance).toContain(
      "create or replace function public.assurance_level_rank(",
    );
    const position = assurance.slice(
      assurance.indexOf(
        "create or replace function public.get_case_assurance_position(",
      ),
    );
    expect(position).toContain(
      "assurance_level_rank(ar.assurance_level) >= assurance_level_rank(v_demanded)",
    );
    // independent_assurance_required is a FLOOR, not a variable read and
    // then never used again.
    expect(position).toContain(
      "when coalesce(v_independent_required, false) then 'independent'",
    );
    // The gate binding is load-bearing in the satisfaction test.
    expect(position).toContain(
      "p_gate_id is not null and ar.gate_id = p_gate_id",
    );
  });

  it("§70 covers EVERY level this slice made consequential, not only independent", () => {
    // Slice 3B's wall refuses the AI identity as INDEPENDENT case assurer on
    // the premise that line-1/2 reviews release nothing. This slice made them
    // release a gate blocker, so the wall moves with the premise.
    expect(assurance).toContain("cannot record at any independence level");
    const trigger = assurance.slice(
      assurance.indexOf(
        "create or replace function public.enforce_assurance_competency_and_conflicts()",
      ),
    );
    expect(trigger).toContain(
      "cannot stand as the reviewer at any independence level",
    );
    // Competency is VERIFIED whenever it is stated, at every level — the
    // early return for non-independent reviews is gone.
    expect(trigger).not.toContain(
      "if new.assurance_level <> 'independent' then\n    return new;",
    );
    // The bookkeeping guard covers the SUBJECT, so re-pointing a review at
    // another case re-litigates the gate-framework check.
    expect(trigger).toContain(
      "and new.subject_id is not distinct from old.subject_id",
    );
  });
});

describe("D5.24 ControlAssessment (spec §14)", () => {
  it("EXTENDS risk_control_tests with the two dimensions — no ControlAssessment table", () => {
    expect(controlAssessment).toContain(
      "alter table public.risk_control_tests",
    );
    expect(controlAssessment).toContain(
      "add column if not exists design_effectiveness text",
    );
    expect(controlAssessment).toContain(
      "add column if not exists operating_effectiveness text",
    );
    expect(controlAssessment).toContain(
      "add column if not exists assessment_confidence numeric",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*control_assessments/);
  });

  it("the vocabulary matches the TypeScript the form renders", () => {
    const values = CONTROL_EFFECTIVENESS_VALUES.map((v) => `'${v}'`).join(",");
    expect(controlAssessment).toContain(values);
  });

  it("refuses effective operation over an ineffective design, for every writer", () => {
    const trigger = controlAssessment.slice(
      controlAssessment.indexOf(
        "function public.enforce_control_assessment_coherence",
      ),
      controlAssessment.indexOf(
        "drop trigger if exists trg_control_assessment_coherence",
      ),
    );
    expect(trigger).toContain("new.design_effectiveness = 'ineffective'");
    expect(trigger).toContain(
      "new.operating_effectiveness in ('effective','partially_effective')",
    );
    expect(trigger).toContain("raise exception");
    expect(controlAssessment).toContain(
      "before insert or update on public.risk_control_tests",
    );
  });

  it("the rating cap only ever NARROWS — the existing arithmetic is byte-identical", () => {
    const fn = controlAssessment.slice(
      controlAssessment.indexOf("function public.record_risk_control_test("),
    );
    expect(fn).toContain(
      "v_score := greatest(0,least(100,100.0*v_passed/v_total - 20*v_failures))",
    );
    expect(fn).toContain(
      "v_rating := case when v_score >= 80 and v_failures = 0 then 'effective'",
    );
    // THE CAP READS THE CONTROL'S STANDING DESIGN JUDGEMENT, not this call's
    // payload. Capping on the payload let one routine walkthrough submitting
    // the ROS form's own 'not_assessed' default restore 'effective' on a
    // control whose last real design judgement was 'ineffective'.
    expect(fn).toContain(
      "if v_judged_design = 'ineffective' then\n    v_rating := 'ineffective';",
    );
    expect(fn).toContain(
      "and t.design_effectiveness <> 'not_assessed'\n  order by t.tested_at desc, t.id desc",
    );
    expect(fn).not.toContain("if v_design = 'ineffective' then\n    v_rating");
    // No branch anywhere raises a rating.
    expect(fn).not.toMatch(/v_rating := 'effective';[\s\S]{0,40}elsif/);
  });

  it("refuses a non-finite confidence explicitly (NaN = NaN is TRUE in Postgres)", () => {
    expect(controlAssessment).toContain("v_confidence = 'NaN'::numeric");
  });
});

describe("D5.25 Treatment secondary risk (spec §15)", () => {
  it("creates NO Treatment table and enforces the seven-strategy enum at the database", () => {
    expect(lowerAll).not.toMatch(/create table[^;]*treatments/);
    for (const s of TREATMENT_STRATEGIES) {
      expect(secondaryRisk).toContain(`'${s}'`);
    }
    expect(secondaryRisk).toContain(
      "add constraint scenarios_treatment_strategy_check check (",
    );
    expect(secondaryRisk).toContain(
      "add constraint recommendations_treatment_strategy_check check (",
    );
  });

  it("links the secondary risk with typed columns on the ONE risks table", () => {
    expect(secondaryRisk).toContain("alter table public.risks");
    expect(secondaryRisk).toContain(
      "add column if not exists secondary_to_risk_id uuid references risks(id) on delete set null",
    );
    expect(secondaryRisk).toContain(
      "add column if not exists arising_from_scenario_id uuid references scenarios(id) on delete set null",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*secondary_risks/);
  });

  it("creates the linked risk in the SAME transaction, audited, inheriting the objective", () => {
    const fn = secondaryRisk.slice(
      secondaryRisk.indexOf("function public.create_risk_treatment("),
    );
    expect(fn).toContain("insert into risks (");
    expect(fn).toContain("r.objective_id, r.development_case_id");
    expect(fn).toContain("secondary_to_risk_id, arising_from_scenario_id");
    expect(fn).toContain("'risk_secondary_created'");
  });

  it("refuses an unratable secondary risk BEFORE writing anything", () => {
    const fn = secondaryRisk.slice(
      secondaryRisk.indexOf("function public.create_risk_treatment("),
    );
    expect(fn).toContain("is unrated (current_risk_score)");
    expect(fn).toContain("v_score = 'NaN'::numeric");
    expect(fn).toContain("states no risk level");
    expect(fn).toContain("has no owner in this organization");
    // Fail closed on a missing objective link rather than inventing one.
    expect(fn).toContain("r.objective_id is null");
    // The validation loop precedes the scenario insert.
    expect(fn.indexOf("is unrated (current_risk_score)")).toBeLessThan(
      fn.indexOf("insert into scenarios ("),
    );
  });

  it("keeps introduced_risks as the mandatory assessment it already was", () => {
    const fn = secondaryRisk.slice(
      secondaryRisk.indexOf("function public.create_risk_treatment("),
    );
    expect(fn).toContain(
      "introduced_risks must be assessed, even when the answer is an empty array",
    );
    expect(fn).toContain(
      "a treatment cannot both introduce nothing and introduce something",
    );
  });

  it("refuses a secondary-risk cycle, on INSERT and UPDATE", () => {
    expect(secondaryRisk).toContain("before insert or update on public.risks");
    expect(secondaryRisk).toContain(
      "would close the secondary-risk chain into a cycle",
    );
  });
});

describe("D11.22 Evidence Confidence (spec §46)", () => {
  it("EXTENDS evidence_items with typed Q and A — the ONE evidence model", () => {
    expect(confidence).toContain("alter table public.evidence_items");
    expect(confidence).toContain("add column if not exists quality_grade text");
    expect(confidence).toContain(
      "add column if not exists applicability_grade text",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*evidence_scores/);
  });

  it("the factor grades match the TypeScript exactly", () => {
    expect(confidence).toContain(QUALITY_GRADES.map((g) => `'${g}'`).join(","));
    expect(confidence).toContain(
      APPLICABILITY_GRADES.map((g) => `'${g}'`).join(","),
    );
  });

  it("weights are versioned, adopted data with ONE adopted set per organization", () => {
    expect(confidence).toContain(
      "status text not null default 'draft' check (status in ('draft','adopted','superseded'))",
    );
    expect(confidence).toContain(
      "create unique index if not exists idx_evidence_confidence_one_adopted\n  on evidence_confidence_profiles(organization_id) where status = 'adopted'",
    );
    // Tenant-VISIBLE: the read policy is org-wide, not admin-only.
    expect(confidence).toContain(
      "create policy evidence_confidence_profiles_read on public.evidence_confidence_profiles\n  for select to authenticated",
    );
  });

  it("the seeded profile is a DRAFT — it arms nothing until a human adopts it", () => {
    const seed = confidence.slice(
      confidence.indexOf("insert into evidence_confidence_profiles ("),
      confidence.indexOf(
        "create or replace function public.set_evidence_confidence_weights",
      ),
    );
    expect(seed).toContain("'Default evidence confidence', 1, 'draft'");
    expect(seed).not.toContain("'adopted'");
  });

  it("computes Q × A × F × V and REFUSES by name, never defaulting a factor", () => {
    const fn = confidence.slice(
      confidence.indexOf("function public.compute_evidence_confidence("),
      confidence.indexOf(
        "revoke all on function public.compute_evidence_confidence",
      ),
    );
    expect(fn).toContain("v_ec := v_q * v_a * v_f * v_v");
    expect(fn).toContain("'quality (Q)");
    expect(fn).toContain("'applicability (A)");
    expect(fn).toContain("'freshness (F)");
    expect(fn).toContain("'verification (V)");
    expect(fn).toContain("'refusal', 'missing_factors'");
    expect(fn).toContain("'missingFactors', to_jsonb(v_missing)");
    // No midpoint fallback anywhere.
    expect(fn).not.toMatch(/coalesce\([^)]*0\.5\)/);
    // The refusal returns no number.
    expect(
      fn.slice(
        fn.indexOf("if array_length(v_missing, 1) > 0"),
        fn.indexOf("v_ec :="),
      ),
    ).not.toContain("evidenceConfidence");
  });

  it("refuses when no weight set is adopted, rather than falling back to a built-in", () => {
    expect(confidence).toContain("'refusal', 'no_adopted_profile'");
    expect(confidence).toContain(
      "there is no built-in default to fall back to",
    );
  });

  it("carries every item's raw §46 inputs so a grade can be previewed offline", () => {
    const fn = confidence.slice(
      confidence.indexOf("function public.get_case_evidence_confidence("),
    );
    expect(fn).toContain("'verificationStatus', rec.verification_status");
    expect(fn).toContain("'evidenceClass', rec.evidence_class");
    expect(fn).toContain("'observedAt', rec.ts");
  });

  it("carries the weights out WITH the number", () => {
    expect(confidence).toContain(
      "'profile', jsonb_build_object('id', p.id, 'name', p.name, 'version', p.version",
    );
  });

  it("adoption validates every grade and every §9 class before arming", () => {
    const fn = confidence.slice(
      confidence.indexOf("function public.adopt_evidence_confidence_profile("),
      confidence.indexOf(
        "revoke all on function public.adopt_evidence_confidence_profile",
      ),
    );
    expect(fn).toContain("'MEASURED','INSPECTED','CALCULATED','TESTED'");
    expect(fn).toContain(
      "'DOCUMENTED','HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE'",
    );
    expect(fn).toContain("= 'NaN'::numeric");
    expect(fn).toContain("cannot be adopted");
  });
});

describe("the case-surface read", () => {
  it("composes the SAME coverage and confidence functions — no second implementation", () => {
    expect(chainsRead).toContain(
      "v_coverage := get_case_commitment_coverage(c.id)",
    );
    expect(chainsRead).toContain(
      "v_confidence := get_case_evidence_confidence(c.id)",
    );
  });

  it("does not re-create get_development_case — the v5 aggregate is untouched", () => {
    expect(chainsRead).not.toContain(
      "create or replace function public.get_development_case",
    );
  });

  it("renders where each permit condition landed", () => {
    expect(chainsRead).toContain(
      "'propagation', case when rc.propagated_at is null then null",
    );
    expect(chainsRead).toContain("rc.propagated_requirement_id");
    expect(chainsRead).toContain("rc.propagated_work_order_id");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE REPAIR PASS.
 *
 * Every assertion below pins a defect that shipped in the first draft of this
 * slice and was proven live against the local stack. They are grouped by the
 * failure, not by the file, because that is how they will be read the next
 * time one of them goes red.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("repair — caller JSON is refused BY NAME, never as a raw Postgres cast error", () => {
  it("defines parse-or-NULL helpers instead of casting inside DECLARE blocks", () => {
    for (const fn of [
      "sync_text_as_int",
      "sync_text_as_numeric",
      "sync_text_as_date",
      "sync_text_as_uuid",
      "sync_text_as_boolean",
      "sync_text_as_bigint",
    ]) {
      expect(commitments).toContain(
        `create or replace function public.${fn}(p_text text)`,
      );
    }
  });

  it("no act in this slice casts a caller-supplied jsonb field in its DECLARE block", () => {
    // A cast in a DECLARE initializer executes BEFORE the first guard, so
    // `"expected_lead_time_days": "60 days"` raised `invalid input syntax for
    // type integer` — a message that names no field and no expectation.
    // Slices 3A/3B took typed SQL parameters and never had this; 3C moved to
    // jsonb payloads and lost the property, so it is restated as a rule.
    const offenders: string[] = [];
    for (const [name, source] of [
      ["20261122090000", commitments],
      ["20261122090100", chain],
      ["20261122090200", propagation],
      ["20261122090300", assurance],
      ["20261122090400", controlAssessment],
      ["20261122090600", confidence],
    ] as const) {
      for (const block of source.split(/\bdeclare\b/i).slice(1)) {
        const decl = block.split(/\bbegin\b/i)[0] ?? "";
        for (const m of decl.matchAll(
          /(p_[a-z_]+\s*->>?\s*'[a-z_]+'[^\n;]*)::(int|bigint|numeric|date|uuid|boolean|timestamptz)/gi,
        )) {
          offenders.push(`${name}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names the offending value in the refusal", () => {
    expect(chain).toContain(
      'expected_lead_time_days must be a whole number of days — "%s" is not one',
    );
    expect(propagation).toContain(
      'perpetual must be true or false — "%s" is neither',
    );
    expect(controlAssessment).toContain(
      'assessment_confidence must be a number between 0 and 100 — "%s" is not one',
    );
  });

  it("adoption type-checks every weight before casting it", () => {
    // A non-numeric weight survived authoring by design (a draft may be
    // half-written) and then detonated as a raw 22P02 from inside the
    // validation loop, bypassing the v_missing list built for every other
    // failure.
    const fn = confidence.slice(
      confidence.indexOf("function public.adopt_evidence_confidence_profile("),
      confidence.indexOf(
        "revoke all on function public.adopt_evidence_confidence_profile",
      ),
    );
    expect(fn).not.toMatch(/->>\s*v_(grade|class)[^\n;]*\)::numeric/);
    expect(fn).toContain(
      "sync_text_as_numeric(nullif(p.quality_weights->>v_grade",
    );
  });
});

describe("repair — the regulatory chain has a provenance backstop, DELETE included", () => {
  it("covers all five tables on insert, update AND delete", () => {
    expect(chain).toContain(
      "create or replace function public.enforce_regulatory_chain_provenance()",
    );
    for (const t of [
      "regulatory_requirements",
      "regulatory_applications",
      "regulatory_information_requests",
      "regulatory_approvals",
      "regulatory_conditions",
    ]) {
      expect(chain).toMatch(
        new RegExp(
          `before insert or update or delete on public\\.${t}\\n  for each row execute function public\\.enforce_regulatory_chain_provenance`,
        ),
      );
    }
  });

  it("re-asserts the conditional-grant invariant from the CHILD side", () => {
    // The parent-side constraint trigger could not see the last condition
    // being deleted out from under a granted_with_conditions approval.
    expect(chain).toContain(
      "create constraint trigger trg_condition_delete_keeps_grant_honest\n  after delete on public.regulatory_conditions",
    );
    expect(chain).toContain("granted WITH CONDITIONS and carrying none");
  });

  it("scopes the shared case helper to the caller's organization", () => {
    const fn = chain.slice(
      chain.indexOf(
        "create or replace function public.regulatory_condition_case(",
      ),
      chain.indexOf("revoke all on function public.regulatory_condition_case"),
    );
    expect(fn).toContain("rc.organization_id = app_current_org()");
    expect(fn).toContain("c.organization_id = app_current_org()");
  });

  it("every act sets the write marker the backstop demands", () => {
    for (const source of [chain, propagation]) {
      expect(source).toContain(
        "perform set_config('app.regulatory_chain_write', 'granted', true)",
      );
      expect(source).toContain(
        "perform set_config('app.regulatory_chain_write', '', true)",
      );
    }
  });
});

describe("repair — propagation fails closed, is role-gated, and re-arms into operations", () => {
  it("role-checks before writing design_requirements or work_orders", () => {
    const fn = propagation.slice(
      propagation.indexOf(
        "create or replace function public.propagate_regulatory_conditions(",
      ),
      propagation.indexOf(
        "revoke all on function public.propagate_regulatory_conditions",
      ),
    );
    expect(fn).toContain(
      "not in ('admin','executive','maintenance_manager','reliability_engineer')",
    );
    expect(fn).toContain(
      "propagating permit conditions requires a governance or engineering role",
    );
    // A lapsed permit authorizes nothing, so it mints nothing.
    expect(fn).toContain("if ap.status is distinct from 'active' then");
  });

  it("the pre-flight guard covers exactly the statuses the loop processes", () => {
    const fn = propagation.slice(
      propagation.indexOf(
        "create or replace function public.propagate_regulatory_conditions(",
      ),
      propagation.indexOf(
        "revoke all on function public.propagate_regulatory_conditions",
      ),
    );
    // The first draft guarded over status='open' while the loop processed
    // ('open','missed'), so a breached operational condition landed a work
    // order with a NULL asset and was reported as landed.
    expect(fn).not.toMatch(
      /where rc\.approval_id = ap\.id and rc\.status = 'open'/,
    );
    expect(fn).toContain("if v_asset is null then");
    expect(fn).toContain("has no asset to land on");
  });

  it("pre-checks both generated references, so no raw 23505 reaches the caller", () => {
    expect(propagation).toContain("v_dreq_ref := 'REG-' || ap.permit_number");
    expect(propagation).toContain(
      "v_dreq_ref := v_dreq_ref || '-' || rec.id::text",
    );
    expect(propagation).toContain(
      'Condition reference "%" is already recorded',
    );
    expect(propagation).toContain('lists condition reference "%" twice');
  });

  it("a recurring condition re-arms INTO operations, not into a table nobody reads", () => {
    expect(propagation).toContain(
      "propagated_work_order_id = null, propagated_at = null",
    );
    // The work order number carries the period, so each period is its own
    // work order rather than a collision with the last one.
    expect(propagation).toContain(
      "else '-' || to_char(rec.due_date, 'YYYYMMDD') end",
    );
  });

  it("refuses a second decision on an application that already carries one", () => {
    expect(propagation).toContain("already carries a decision");
    expect(propagation).toContain(
      "select 1 from regulatory_approvals ra where ra.application_id = a.id",
    );
  });

  it("validates the permit document against THIS organization", () => {
    expect(propagation).toContain("from kb_intake_documents d");
    expect(propagation).toContain(
      "that permit document is not in this organization''s library",
    );
  });

  it("the operations terminus cannot be silently severed", () => {
    expect(propagation).toContain(
      "create policy work_orders_regulatory_landing_no_del on public.work_orders as restrictive",
    );
    expect(propagation).toContain(
      "create policy work_orders_regulatory_landing_no_upd on public.work_orders as restrictive",
    );
  });
});

describe("repair — a live commitment stays remediable, and withdrawal is an act", () => {
  it("links coverage while a commitment is open OR breached", () => {
    // A breached commitment is LATE, not closed — and 'breached' is exactly
    // the state the D3.09 gate blocker fires on, so refusing the link there
    // made the blocker permanently unclearable once the sweep had run.
    expect(commitments).toContain(
      "if sc.status not in ('open', 'breached') then",
    );
  });

  it("gives 'withdrawn' a governed act, §70-refused for the AI identity", () => {
    expect(commitments).toContain(
      "create or replace function public.withdraw_stakeholder_commitment(",
    );
    expect(commitments).toContain(
      "withdrawn_by uuid references auth.users(id)",
    );
    expect(commitments).toContain(
      "withdrawal_reason is not null and btrim(withdrawal_reason) <> ''\n        and withdrawn_by is not null and withdrawn_at is not null",
    );
    // The persistence backstop covers withdrawal as well as discharge.
    expect(commitments).toContain(
      "Spec §70: withdrawing a stakeholder commitment asserts the organization is no longer ",
    );
  });
});

describe("repair — §14 and §15 arithmetic stands on what the row demands", () => {
  it("refuses an AI-recorded §14 conclusion", () => {
    expect(controlAssessment).toContain(
      "recording a §14 design or operating effectiveness conclusion is a §70 human determination",
    );
    expect(controlAssessment).toContain("name the test method");
  });

  it("presents both §14 dimensions from ONE assessment row", () => {
    // Picking the newest non-null value per column independently let the read
    // reassemble the exact pair the coherence trigger forbids a single row to
    // assert.
    expect(controlAssessment).toContain("'latestAssessment', (");
    expect(controlAssessment).toContain(
      "and (t.design_effectiveness is not null or t.operating_effectiveness is not null)",
    );
  });

  it("the trigger functions are definer and search_path-pinned like their siblings", () => {
    for (const source of [commitments, controlAssessment, secondaryRisk]) {
      const fns = [
        ...source.matchAll(
          /create or replace function public\.(enforce_[a-z_]+)\(\)\nreturns trigger\nlanguage plpgsql\n(security definer\nset search_path = public\n)?/g,
        ),
      ];
      for (const m of fns) {
        expect(
          m[2],
          `${m[1]} must be definer + search_path pinned`,
        ).toBeTruthy();
      }
    }
  });

  it("the rated secondary risks enter net_risk_change", () => {
    // The row demands a rating on every risk a treatment creates and states
    // why; the first draft collected the ratings and then computed the net
    // change from the caller's free-text scalar, cross-checking nothing.
    expect(secondaryRisk).toContain("v_secondary_max");
    expect(secondaryRisk).toContain(
      "introduced_risk must be at least the greatest secondary-risk score",
    );
  });

  it("the secondary-risk read applies the sensitivity ladder", () => {
    const fn = secondaryRisk.slice(
      secondaryRisk.indexOf(
        "create or replace function public.get_risk_secondary_risks(",
      ),
    );
    // A SECURITY DEFINER read does not inherit risks_sensitive_read, so a
    // technician refused the row by RLS could read it — and every child
    // risk's title, score, owner and treatment — straight out of this
    // function.
    expect(fn).toContain("if not can_read_risk(r.id) then");
    expect(fn).toContain("and can_read_risk(s.id)");
    expect(fn).toContain("and can_read_risk(p.id)");
  });

  it("a secondary risk's provenance cannot be silently severed", () => {
    expect(secondaryRisk).toContain(
      "create policy scenarios_secondary_origin_no_del on public.scenarios as restrictive",
    );
  });
});

describe("repair — D11.22 is armable by every tenant, not only the migration's contemporaries", () => {
  it("seeds a draft weight set for every organization that ever exists", () => {
    expect(confidence).toContain(
      "create or replace function public.seed_evidence_confidence_profile()",
    );
    expect(confidence).toContain(
      "create trigger trg_seed_evidence_confidence_profile\n  after insert on public.organizations",
    );
  });

  it("ships the versioning verb its own refusal names", () => {
    expect(confidence).toContain(
      "create or replace function public.create_evidence_confidence_profile_version(",
    );
    expect(confidence).toContain("create a new version and adopt it");
    // Copy forward, never blank: an edit is an argument with a stated
    // position rather than a fresh invention.
    expect(confidence).toContain(
      "'draft', p.quality_weights, p.applicability_weights",
    );
  });
});

describe("repair — the II.15 vocabularies the form offers are the ones the DB accepts", () => {
  it("every conclusion the RPC accepts is offered by the component's vocabulary", () => {
    // The first draft's completion button wrote `acceptable` from a literal,
    // so `not_acceptable` was a state the panel could RENDER and never write.
    const offered = ASSURANCE_CONCLUSIONS.map((c) => c.value).sort();
    expect(offered).toEqual([
      "acceptable",
      "acceptable_with_actions",
      "inconclusive",
      "not_acceptable",
    ]);
    for (const v of offered) {
      expect(assurance).toContain(`'${v}'`);
    }
  });

  it("the TypeScript independence ladder mirrors assurance_level_rank", () => {
    const fn = assurance.slice(
      assurance.indexOf(
        "create or replace function public.assurance_level_rank(",
      ),
      assurance.indexOf("revoke all on function public.assurance_level_rank"),
    );
    for (const [level, rank] of Object.entries(ASSURANCE_LEVEL_RANK)) {
      if (level === "none") continue;
      expect(fn).toContain(`when '${level}' then ${rank}`);
    }
    expect(ASSURANCE_LEVEL_RANK.line_1).toBeLessThan(
      ASSURANCE_LEVEL_RANK.line_2,
    );
    expect(ASSURANCE_LEVEL_RANK.line_2).toBeLessThan(
      ASSURANCE_LEVEL_RANK.independent,
    );
  });
});
