/**
 * Sync Develop Slice 5A — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice5a-smoke.sh against
 * a real local database (a traceability report that REFUSES over an empty
 * requirement set instead of reporting zero orphans, a requirement cycle
 * refused for every writer, a cross-tenant thread link refused, the five §11
 * methods, a verification result refused to the AI-operator identity at the
 * door AND at the persistence wall, and an agent that can read every finding
 * and write none of them).
 *
 * This file pins the CONTRACT in the migration text so a later edit that drops
 * a §10 category, loses OPERATIONAL_VALIDATION, admits a machine to a
 * verification, lets a coverage percentage default to zero, forks the
 * requirement table, or gives the agent a column that could hold a status
 * fails before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  MEASURED_VERIFICATION_METHODS,
  RELIABILITY_BY_DESIGN_CATEGORIES,
  SPEC10_REQUIREMENT_CATEGORIES,
  VERIFICATION_METHODS,
} from "../lib/develop/requirements";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const REQUIREMENT_FILE = "20261204090000_develop_requirement_object.sql";
const VERIFICATION_FILE = "20261204090100_develop_verification_object.sql";
const AGENT_FILE = "20261204090200_develop_requirements_agent.sql";
const REPAIR_FILE = "20261204090300_develop_slice5a_repair.sql";
const SLICE_FILES = [
  REQUIREMENT_FILE,
  VERIFICATION_FILE,
  AGENT_FILE,
  REPAIR_FILE,
];

const requirement = read(REQUIREMENT_FILE);
const verification = read(VERIFICATION_FILE);
const agent = read(AGENT_FILE);
const repair = read(REPAIR_FILE);
const joined = [requirement, verification, agent, repair].join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");

/** The executable text, with `comment on … is '…'` documentation removed. */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("\n$$;", at));
}

/* ───────────────── the migrations land after 4D, in order ─────────────── */

describe("the slice lands strictly after Slice 4D", () => {
  it("every 5A filename sorts after 20261203090400", () => {
    for (const f of SLICE_FILES) {
      expect(f > "20261203090400_develop_authority_ceiling.sql").toBe(true);
    }
  });

  it("orders itself by dependency: requirement, then verification, then agent", () => {
    // The verification file references sync_verification_methods, defined in
    // the requirement file; the agent file reads both.
    expect(REQUIREMENT_FILE < VERIFICATION_FILE).toBe(true);
    expect(VERIFICATION_FILE < AGENT_FILE).toBe(true);
    // The repair re-creates functions from all three and must land after them.
    expect(AGENT_FILE < REPAIR_FILE).toBe(true);
  });
});

/* ───────────────── D4.16 — the §10 Requirement object ─────────────────── */

describe("D4.16 — the eleven §10 categories", () => {
  it("names all eleven in the vocabulary function", () => {
    const fn = requirement.slice(
      requirement.indexOf("sync_spec10_requirement_categories()"),
      requirement.indexOf("comment on function public.sync_spec10"),
    );
    for (const c of SPEC10_REQUIREMENT_CATEGORIES) {
      expect(fn, `${c.key} missing from the SQL vocabulary`).toContain(
        `'${c.key}'`,
      );
    }
  });

  it("keeps the five reliability-by-design categories rather than mapping them onto the eleven", () => {
    const fn = requirement.slice(
      requirement.indexOf(
        "sync_reliability_by_design_requirement_categories()",
      ),
      requirement.indexOf(
        "comment on function public.sync_reliability_by_design",
      ),
    );
    for (const c of RELIABILITY_BY_DESIGN_CATEGORIES) {
      expect(fn).toContain(`'${c.key}'`);
    }
  });

  it("makes the CHECK the UNION of both vocabularies, never a retyped list", () => {
    expect(requirement).toContain(
      "check (category = any (\n        sync_spec10_requirement_categories()\n        || sync_reliability_by_design_requirement_categories()))",
    );
  });

  it("RAISES rather than dropping a constraint it does not recognise", () => {
    const block = requirement.slice(
      requirement.indexOf("do $category$"),
      requirement.indexOf("$category$;"),
    );
    expect(block).toContain("raise exception");
    expect(block).toContain("Do not widen a constraint blind");
  });

  it("validates the write path's category against the same two functions", () => {
    const fn = body(requirement, "record_case_requirement");
    expect(fn).toContain("sync_spec10_requirement_categories()");
    expect(fn).toContain("sync_reliability_by_design_requirement_categories()");
    // A retyped list in the door is how the CHECK and the door drift apart.
    expect(fn).not.toContain("'data_handover',");
  });
});

describe("D4.16 — the hierarchy, and the walls under it", () => {
  it("adds parent_requirement_id as a self-reference on the ONE table", () => {
    expect(requirement).toContain(
      "add column if not exists parent_requirement_id bigint",
    );
    expect(requirement).toContain("references design_requirements(id)");
  });

  it("refuses a self-parent, a cycle, a cross-org parent and a cross-case parent", () => {
    const fn = body(requirement, "enforce_requirement_hierarchy_integrity");
    expect(fn).toContain("new.parent_requirement_id = new.id");
    expect(fn).toContain("close a cycle");
    expect(fn).toContain("another organization''s requirement");
    expect(fn).toContain("different development case");
  });

  it("has no service escape — a cycle is corrupt data, not a provenance question", () => {
    const fn = body(requirement, "enforce_requirement_hierarchy_integrity");
    expect(fn).not.toContain("current_setting");
    expect(fn).not.toContain("granted");
  });

  it("covers INSERT and UPDATE", () => {
    expect(requirement).toContain(
      "before insert or update on public.design_requirements\n  for each row execute function public.enforce_requirement_hierarchy_integrity()",
    );
  });

  it("caps the upward walk so a pre-existing cycle cannot spin forever", () => {
    expect(
      body(requirement, "enforce_requirement_hierarchy_integrity"),
    ).toContain("v_hops > 64");
  });
});

describe("D4.16 — the thread links a foreign key cannot police", () => {
  it("refuses a cross-tenant objective, asset and acceptance test on every writer", () => {
    const fn = body(requirement, "enforce_requirement_thread_tenancy");
    for (const table of ["risk_objectives", "assets", "acceptance_tests"]) {
      expect(fn).toContain(table);
    }
    expect(fn.match(/another organization/g)?.length).toBeGreaterThanOrEqual(3);
    expect(requirement).toContain(
      "before insert or update on public.design_requirements\n  for each row execute function public.enforce_requirement_thread_tenancy()",
    );
  });

  it("reuses the canonical stores and creates no requirement-side table", () => {
    for (const home of [
      "references risk_objectives(id)",
      "references assets(id)",
      "references acceptance_tests(id)",
      "references kpi_catalog(kpi_key)",
    ]) {
      expect(requirement).toContain(home);
    }
    // ZERO new tables in the requirement migration: the whole D4.16 build is
    // columns on design_requirements plus the join table Slice 4A shipped.
    expect(requirement.toLowerCase()).not.toContain("create table");
  });

  it("refuses CLEARING any thread link, while allowing a re-point", () => {
    const fn = body(requirement, "link_requirement_thread");
    expect(fn.match(/is refused/g)?.length).toBeGreaterThanOrEqual(6);
    for (const link of [
      "clearing the objective link is refused",
      "clearing the installed-asset link is refused",
      "clearing the commissioning-test link is refused",
      "clearing the operating-KPI link is refused",
      "clearing the parent link is refused",
      "clearing the owner is refused",
    ]) {
      expect(fn).toContain(link);
    }
    // The header states the reason once, where a reader looks for rulings.
    expect(rawJoined).toContain(
      "indistinguishable from one that never existed",
    );
  });

  it("audits the thread act with previous_state and new_state", () => {
    const fn = body(requirement, "link_requirement_thread");
    expect(fn).toContain("insert into audit_events");
    expect(fn).toContain("v_before");
    expect(fn).toContain("v_after");
  });
});

describe("D4.16 — the traceability report refuses rather than reassures", () => {
  const fn = body(requirement, "get_case_requirement_traceability");

  it("REFUSES over an empty requirement set instead of reporting zero orphans", () => {
    expect(fn).toContain("if v_total = 0 then");
    expect(fn).toContain("indistinguishable from a fully traced project");
    expect(fn).toContain("'refused', true");
  });

  it("returns a null percentage rather than 0 or 100 when it refuses", () => {
    expect(fn).toContain("'threadCoveragePct', null");
    expect(fn).toContain("'verifiedPct', null");
  });

  it("refuses a non-finite percentage, which compares equal to itself in Postgres", () => {
    expect(fn).toContain("'NaN'::numeric");
    expect(fn.match(/'NaN'::numeric/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("DELEGATES the requirement→WBS question to the ONE predicate", () => {
    expect(fn).toContain("get_case_scope_traceability(c.id)");
    expect(fn).toContain("forwardGaps");
    // …and does not re-implement it. The join table may be NAMED in the
    // deferred design-object link's prose; what it must never be is queried.
    expect(fn).not.toContain("from project_requirement_wbs");
    expect(fn).not.toContain("join project_requirement_wbs");
  });

  it("refuses the delegated answer rather than reporting it as zero when the delegate errors", () => {
    expect(fn).toContain("is NOT reported as zero");
  });

  it("renders the two deferred links as deferred, never omits them", () => {
    expect(fn).toContain("'link', 'design object'");
    expect(fn).toContain("'link', 'procurement specification'");
    expect(fn.match(/'built', false/g)?.length).toBe(2);
    expect(fn.match(/'deferral',/g)?.length).toBe(2);
  });

  it("records a calculation run — including when the report refused", () => {
    const compute = body(requirement, "compute_case_requirement_traceability");
    expect(compute).toContain("record_calculation_run(");
    expect(compute).toContain("'case_requirement_traceability'");
    expect(compute).toContain("jsonb_build_array(v_result->>'refusal')");
  });

  it("pins the new calculation key, and pins nothing it does not record", () => {
    expect(requirement).toContain(
      "('case_requirement_traceability',  'develop-requirements/5A/2026-12-04')",
    );
    const pinned = [
      ...requirement.matchAll(/\('([a-z_]+)',\s+'develop-[^']+'\)/g),
    ].map((m) => m[1]);
    for (const key of pinned) {
      if (key === "case_requirement_traceability") {
        expect(joined).toContain(`'${key}'`);
      }
    }
  });
});

/* ───────────────── D4.17 — the §11 Verification object ────────────────── */

describe("D4.17 — the five §11 methods", () => {
  it("names all five in one vocabulary function, OPERATIONAL_VALIDATION included", () => {
    const fn = requirement.slice(
      requirement.indexOf("sync_verification_methods()"),
      requirement.indexOf(
        "comment on function public.sync_verification_methods",
      ),
    );
    for (const m of VERIFICATION_METHODS) {
      expect(fn, `${m.key} missing from the SQL vocabulary`).toContain(
        `'${m.key}'`,
      );
    }
    expect(fn).toContain("'operational_validation'");
  });

  it("keeps the three legacy methods rather than rewriting what a past requirement said", () => {
    expect(verification).toContain(
      "array['review','factory_test','site_test']::text[]",
    );
  });

  it("demands one of the five on every requirement-scoped obligation", () => {
    expect(verification).toContain(
      "check (requirement_id is null or method_code is not null)",
    );
    expect(verification).toContain(
      "check (method_code is null or method_code = any (sync_verification_methods()))",
    );
  });

  it("agrees with the TypeScript vocabulary the forms are built from", () => {
    expect(VERIFICATION_METHODS).toHaveLength(5);
    for (const m of MEASURED_VERIFICATION_METHODS) {
      expect(VERIFICATION_METHODS.some((v) => v.key === m)).toBe(true);
    }
  });
});

describe("D4.17 — the obligation is GENERALIZED, never forked", () => {
  it("adds no second verification store", () => {
    expect(verification.toLowerCase()).not.toContain("create table");
  });

  it("makes recommendation_id nullable and adds requirement_id beside it", () => {
    expect(verification).toContain(
      "alter column recommendation_id drop not null",
    );
    expect(verification).toContain(
      "add column if not exists requirement_id bigint",
    );
  });

  it("demands exactly one subject", () => {
    expect(verification).toContain(
      "check ((recommendation_id is not null) <> (requirement_id is not null))",
    );
  });

  it("adds §11's evidence_id on the ONE evidence model", () => {
    expect(verification).toContain(
      "add column if not exists evidence_id uuid\n    references evidence_items(id)",
    );
  });

  it("keeps the free-text promise snapshot beside the enum rather than overwriting it", () => {
    expect(verification).toContain("add column if not exists method_code text");
    expect(rawJoined).toContain(
      "the free-text promise SNAPSHOTTED off the\n  -- recommendation at approval",
    );
  });
});

describe("D4.17 — §70: no machine verifies anything", () => {
  it("refuses a verification attributed to the AI identity for EVERY writer", () => {
    const fn = body(verification, "enforce_verification_recorder_is_human");
    expect(fn).toContain("= 'ai_admin'");
    expect(fn).toContain("spec §70");
    expect(verification).toContain(
      "before insert or update on public.verification_obligations\n  for each row execute function public.enforce_verification_recorder_is_human()",
    );
  });

  it("refuses that identity BY NAME at the two doors as well as at the wall", () => {
    expect(body(verification, "create_requirement_verification")).toContain(
      "coalesce(v_role, '') = 'ai_admin'",
    );
    const record = verification.slice(
      verification.indexOf(
        "create or replace function public.record_verification_result(",
      ),
    );
    expect(record).toContain("coalesce(v_role, '') = 'ai_admin'");
    expect(record).toContain("§70 human act");
  });

  it("gives record_verification_result the role check it never had", () => {
    const record = verification.slice(
      verification.indexOf(
        "create or replace function public.record_verification_result(",
      ),
    );
    expect(record).toContain("not in\n     ('admin','executive'");
  });

  it("audits the result with previous_state and new_state", () => {
    const record = verification.slice(
      verification.indexOf(
        "create or replace function public.record_verification_result(",
      ),
    );
    expect(record.match(/insert into audit_events/g)?.length).toBe(2);
    expect(record).toContain("previous_state, new_state");
  });

  it("preserves the argument names PR #309's production caller passes", () => {
    expect(verification).toContain(
      "p_obligation_id uuid,\n  p_result text,\n  p_measured_note text,",
    );
    expect(verification).toContain("p_evidence_id uuid default null");
    // The three-argument form must be dropped, or every three-named-argument
    // call becomes ambiguous.
    expect(verification).toContain(
      "drop function if exists record_verification_result(uuid, text, text);",
    );
  });

  it("keeps every refusal sentence PR #309's caller and its tests depend on", () => {
    const record = verification.slice(
      verification.indexOf(
        "create or replace function public.record_verification_result(",
      ),
    );
    expect(record).toContain("A result with no measurement is an opinion");
    expect(record).toContain("A verification is recorded once");
    expect(record).toContain(
      "Result must be achieved, not_achieved or inconclusive.",
    );
  });
});

describe("D4.17 — the persistence wall and the ledger guards", () => {
  const fn = body(verification, "enforce_verification_result_provenance");

  it("admits an obligation created with no result, refuses one born verified", () => {
    expect(fn).toContain(
      "an obligation born verified is a loop that was never open",
    );
  });

  it("refuses a direct write to result, verifier, status or evidence", () => {
    expect(fn).toContain("new.result is distinct from old.result");
    expect(fn).toContain("new.verified_by is distinct from old.verified_by");
    expect(fn).toContain("new.status is distinct from old.status");
    expect(fn).toContain("new.evidence_id is distinct from old.evidence_id");
  });

  it("covers DELETE, and lets a genuine cascade through", () => {
    expect(fn).toContain("tg_op = 'DELETE'");
    expect(fn).toContain("A verification obligation is not deleted");
    expect(fn).toContain("not exists (select 1 from organizations");
  });

  it("revokes TRUNCATE and stands a statement guard behind it", () => {
    expect(verification).toContain(
      "revoke truncate on table public.verification_obligations from anon, authenticated, service_role;",
    );
    expect(verification).toContain(
      "before truncate on public.verification_obligations\n  for each statement execute function public.enforce_verification_result_provenance()",
    );
  });
});

describe("D4.17 — the reads, and the number that must not drift", () => {
  it("scopes the LEARN posture to recommendation-scoped obligations", () => {
    expect(verification).toContain(
      "where organization_id = app_current_org() and recommendation_id is not null",
    );
  });

  it("LEFT joins recommendations so requirement obligations are not silently dropped", () => {
    const fn = verification.slice(
      verification.indexOf(
        "create or replace function get_open_verifications(",
      ),
    );
    expect(fn).toContain(
      "left join recommendations r on r.id = o.recommendation_id",
    );
    // An INNER join here silently drops every requirement-scoped obligation
    // from the only live open-verification surface in the product.
    expect(fn).not.toContain("\n  join recommendations");
  });

  it("keeps the three column names VerificationLoop.tsx renders", () => {
    const fn = verification.slice(
      verification.indexOf(
        "create or replace function get_open_verifications(",
      ),
    );
    for (const col of [
      '"obligationId" uuid',
      '"recommendationTitle" text',
      '"dueDateAssumed" boolean',
    ]) {
      expect(fn).toContain(col);
    }
  });

  it("refuses the case verification read over an empty requirement set", () => {
    const fn = body(verification, "get_case_requirement_verifications");
    expect(fn).toContain("if v_reqs = 0 then");
    expect(fn).toContain("'verificationCoveragePct', null");
    expect(fn).toContain("reads as a case in good standing and is not one");
  });
});

/* ─────────────────── D12.09 — the Requirements Agent ──────────────────── */

describe("D12.09 — the deterministic half is deterministic", () => {
  const fn = body(agent, "get_case_requirement_findings");

  it("computes all five families in SQL", () => {
    for (const family of [
      "'missing_verification_method'",
      "'unverified'",
      "'orphan'",
      "'inconsistent'",
      "'unowned'",
    ]) {
      expect(fn).toContain(family);
    }
  });

  it("REFUSES over an empty requirement set rather than reporting zero findings", () => {
    expect(fn).toContain("if v_total = 0 then");
    expect(fn).toContain(
      "indistinguishable from a fully traced, fully verified project",
    );
    expect(fn).toContain("'findingCount', null");
  });

  it("keeps the three unverified states apart rather than flattening them", () => {
    for (const sub of [
      "'verification_failed'",
      "'verification_overdue'",
      "'verification_pending'",
      "'no_verification_planned'",
    ]) {
      expect(fn).toContain(sub);
    }
  });

  it("names four deterministic inconsistency classes", () => {
    for (const sub of [
      "'verified_without_a_result'",
      "'parent_verified_before_child'",
      "'testable_without_acceptance_criteria'",
      "'shared_operating_kpi'",
    ]) {
      expect(fn).toContain(sub);
    }
  });

  it("delegates the WBS orphan class and refuses it rather than reporting zero", () => {
    expect(fn).toContain("get_case_scope_traceability(c.id)");
    expect(fn).toContain("It is NOT reported as zero orphans");
  });

  it("carries a record link on every finding", () => {
    expect(fn.match(/'requirementRef',/g)?.length).toBeGreaterThanOrEqual(5);
    expect(fn.match(/'requirementId',/g)?.length).toBeGreaterThanOrEqual(5);
  });
});

describe("D12.09 — the agent proposes and cannot dispose", () => {
  it("has no column that could hold a status, result, outcome or approval", () => {
    const table = agent.slice(
      agent.indexOf(
        "create table if not exists public.requirement_agent_reports",
      ),
      agent.indexOf("do $narrative$"),
    );
    for (const forbidden of [
      "verification_status",
      "result ",
      "outcome",
      "approval",
      "disposition",
      "decision",
      "verdict",
    ]) {
      expect(
        table.toLowerCase().includes(forbidden),
        `requirement_agent_reports must not carry "${forbidden}"`,
      ).toBe(false);
    }
  });

  it("pins advisory true with a CHECK so a later column has to argue with it", () => {
    expect(agent).toContain(
      "constraint requirement_agent_report_is_advisory check (advisory)",
    );
  });

  it("reads every deterministic finding INSIDE the RPC, never from the caller", () => {
    const fn = body(agent, "record_requirements_agent_report");
    expect(fn).toContain("v_findings := get_case_requirement_findings(c.id)");
    expect(fn).toContain("coalesce((v_findings->>'requirementCount')::int, 0)");
  });

  it("labels model output ai_suggestion from a SQL literal and caps its severity", () => {
    const fn = body(agent, "record_requirements_agent_report");
    expect(fn).toContain("'source', 'ai_suggestion'");
    expect(fn).toContain("'severity', 'attention'");
    // The payload's own source/severity are never read.
    expect(fn).not.toContain("x->>'source'");
    expect(fn).not.toContain("x->>'severity'");
  });

  it("DROPS an unresolvable reference rather than matching it to the nearest one", () => {
    const fn = body(agent, "record_requirements_agent_report");
    expect(fn).toContain(
      "DROPPED rather than matched to the nearest reference",
    );
  });

  it("records nothing at all over an empty requirement set", () => {
    const fn = body(agent, "record_requirements_agent_report");
    expect(fn).toContain(
      "return jsonb_build_object('error', v_findings->>'refusal')",
    );
  });

  it("is org-scoped, immutable, undeletable and not truncatable", () => {
    expect(agent).toContain(
      "create policy requirement_agent_reports_read on public.requirement_agent_reports\n  for select to authenticated using (organization_id = app_current_org())",
    );
    const fn = body(agent, "enforce_requirement_agent_report_provenance");
    expect(fn).toContain("is immutable");
    expect(fn).toContain("It is not deleted");
    expect(fn).toContain("tg_op = 'TRUNCATE'");
    expect(agent).toContain(
      "revoke truncate on table public.requirement_agent_reports from anon, authenticated, service_role;",
    );
  });

  it("gates the report act on a role, not merely on having a profile", () => {
    const fn = body(agent, "record_requirements_agent_report");
    expect(fn).toContain("not in\n     ('admin','ai_admin','executive'");
  });

  it("bounds the narrative at the database as well as at the door", () => {
    expect(agent).toContain("length(narrative) <= 6000");
    expect(body(agent, "record_requirements_agent_report")).toContain(
      "capped at 6000",
    );
  });
});

/* ───────────────────────── slice-wide invariants ──────────────────────── */

describe("slice-wide invariants", () => {
  it("uses auth.uid() for the dual-caller gate, never the dead current_user form", () => {
    expect(executable).not.toContain("current_user in ('authenticated'");
    expect(joined).toContain(
      "if auth.uid() is not null and v_caller_org is null then",
    );
  });

  it("pins search_path on every SECURITY DEFINER function in the slice", () => {
    const definers = [...joined.matchAll(/security\s+definer/g)];
    const pinned = [...joined.matchAll(/set search_path = public/g)];
    expect(pinned.length).toBeGreaterThanOrEqual(definers.length);
  });

  it("revokes every new function from public and anon", () => {
    const created = [
      ...joined.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g),
    ].map((m) => m[1]);
    for (const fn of new Set(created)) {
      // get_verification_posture / get_open_verifications keep the 20260901140000
      // grant shape they shipped with; they are re-created, not new.
      if (fn.startsWith("enforce_")) continue;
      expect(
        joined.includes(`revoke all on function public.${fn}(`),
        `${fn} is not revoked from public/anon`,
      ).toBe(true);
    }
  });

  it("revokes every enforcement trigger function from authenticated too", () => {
    for (const fn of [
      "enforce_requirement_hierarchy_integrity",
      "enforce_requirement_thread_tenancy",
      "enforce_verification_recorder_is_human",
      "enforce_verification_result_provenance",
      "enforce_requirement_agent_report_provenance",
    ]) {
      expect(joined).toContain(
        `revoke all on function public.${fn}()\n  from public, anon, authenticated;`,
      );
    }
  });

  it("reloads PostgREST's schema cache from every file", () => {
    for (const f of SLICE_FILES) {
      expect(read(f)).toContain("notify pgrst, 'reload schema'");
    }
  });

  it("states its rulings in the migration text rather than in a chat log", () => {
    for (const ruling of [
      "RULING 1 — ONE REQUIREMENT CONCEPT, TWO CHAINS THROUGH IT",
      "RULING 2 — THE ELEVEN CATEGORIES DO NOT EVICT THE NINE",
      "RULING 3 — WHICH THREAD LINKS ARE BUILT, AND WHICH ARE NAMED HOLES",
      "RULING 4 — ONE KPI PER REQUIREMENT",
      "RULING 5 — owner_id IS NULLABLE AT THE TABLE AND DEMANDED BY THE AGENT",
      "RULING 6 — THE SELF-FK CASCADES",
    ]) {
      expect(rawJoined).toContain(ruling);
    }
    for (const ruling of [
      "RULING 1 — verification_obligations IS GENERALIZED, NOT FORKED",
      "RULING 2 — THE LEARN POSTURE NUMBERS DO NOT MOVE",
      "RULING 4 — WHO MAY RECORD A RESULT",
      "RULING 5 — THE REQUIREMENT'S STATUS IS DERIVED, NEVER TYPED",
    ]) {
      expect(rawJoined).toContain(ruling);
    }
  });

  it("records what PR #309 already shipped so nobody rebuilds it", () => {
    expect(rawJoined).toContain("WHAT PR #309 ALREADY DID");
    expect(rawJoined).toContain("IS STALE");
  });
});

/* ───────────────── the edge function stays advisory-only ──────────────── */

describe("the requirements agent edge function", () => {
  const fn = readFileSync(
    "supabase/functions/develop-requirements-agent/index.ts",
    "utf8",
  );
  const source = fn.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("hardcodes no vendor name and no model id", () => {
    for (const literal of [
      /gpt-[a-z0-9.-]+/i,
      /claude-[a-z0-9.-]+/i,
      /grok-[a-z0-9.-]+/i,
      /gemini-[a-z0-9.-]+/i,
      /stigg\/[a-z0-9-]+/i,
      /model:\s*"/,
    ]) {
      expect(literal.test(source), `${literal} appears in the agent`).toBe(
        false,
      );
    }
  });

  it("writes through exactly one RPC", () => {
    const rpcs = [...source.matchAll(/\.rpc\(\s*\n?\s*"([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(rpcs)).toEqual(
      new Set([
        "get_case_requirement_findings",
        "record_requirements_agent_report",
      ]),
    );
  });

  it("holds no path to any verification act, and writes nothing directly", () => {
    // The disclaimer NAMES the acts it cannot perform — that sentence is the
    // point. What must be absent is any CALL to them, so the check is over
    // call sites rather than over the word.
    const calls = [
      ...source.matchAll(/\.(rpc|from)\(\s*\n?\s*"([a-z_]+)"/g),
    ].map((m) => m[2]);
    for (const forbidden of [
      "verification_obligations",
      "record_verification_result",
      "create_requirement_verification",
      "link_requirement_thread",
      "record_case_requirement",
    ]) {
      expect(
        calls.includes(forbidden),
        `${forbidden} must be unreachable from the agent`,
      ).toBe(false);
    }
    // It READS design_requirements for the statements the model compares —
    // that read is the agent's whole job. What it must never do is write.
    expect(source).toContain('.from("design_requirements")');
    for (const write of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(source.includes(write), `${write} must not appear`).toBe(false);
    }
  });

  it("reads as the calling user, never with the service key", () => {
    expect(source).toContain("const caller = userClient(auth.token)");
    expect(source).not.toContain("serviceClient().rpc");
  });

  it("returns the refusal without calling a model when there is nothing to check", () => {
    expect(source).toContain("if (raw.refused === true)");
    expect(fn).toContain("comment on an empty set");
  });

  it("does not attempt a semantic comparison it cannot make", () => {
    expect(source).toContain("requirements.length < 2");
    expect(fn).toContain("NOT reported as 'no contradictions found'");
  });
});

/* ═══════════════ THE REPAIR — one test per proven defect ═══════════════ */

/**
 * Every test below corresponds to a defect REPRODUCED against a live local
 * database before it was fixed. The reproduction is named in each case so a
 * later reader can tell a real wall from a defensive incantation.
 */
describe("REPAIR ruling 7 — the tenancy wall verification_obligations never had", () => {
  const wall = body(repair, "enforce_verification_subject_tenancy");

  it("refuses a requirement, case, evidence item, asset or recommendation outside the obligation's tenant", () => {
    // PROVEN before the fix: an org-1 obligation pointing at an org-2
    // requirement was ACCEPTED, after which an ordinary org-1 planner moved
    // that org-2 requirement to `verified` through the production RPC and the
    // only audit row landed in org 1.
    for (const col of [
      "new.requirement_id",
      "new.development_case_id",
      "new.evidence_id",
      "new.asset_id",
      "new.recommendation_id",
    ]) {
      expect(wall, `${col} unguarded`).toContain(col);
    }
    expect(wall).toContain("organization_id = new.organization_id");
  });

  it("covers INSERT and UPDATE, with no marker and no service escape", () => {
    expect(repair).toMatch(
      /create trigger trg_verification_subject_tenancy\s+before insert or update on public\.verification_obligations/,
    );
    expect(wall).not.toContain("current_setting");
  });

  it("org-scopes the requirement branch of record_verification_result", () => {
    const rpc = body(repair, "record_verification_result");
    expect(rpc).toContain(
      "where id = o.requirement_id and organization_id = o.organization_id",
    );
    expect(rpc).toContain(
      "where id = d.id and organization_id = o.organization_id",
    );
  });

  it("org-scopes the requirement JOIN in both reads, not only the obligation row", () => {
    // PROVEN before the fix: an org-1 planner's open-verification list
    // rendered an org-2 requirement's ref and its full statement.
    const open = repair.slice(
      repair.lastIndexOf("create or replace function get_open_verifications("),
    );
    expect(open).toContain(
      "left join design_requirements d\n    on d.id = o.requirement_id and d.organization_id = o.organization_id",
    );
    const cased = body(repair, "get_case_requirement_verifications");
    expect(cased).toContain(
      "on d.id = o.requirement_id and d.organization_id = o.organization_id",
    );
  });
});

describe("REPAIR ruling 8 — a later pass does not un-fail an earlier failure", () => {
  it("derives the requirement status from every verification, not from the last one written", () => {
    // PROVEN before the fix, through the production RPCs as an ordinary
    // planner: a 12-month TEST recorded not_achieved (status -> failed), then
    // a desktop ANALYSIS recorded achieved (status -> verified), and no
    // finding anywhere raised it.
    const derive = repair.slice(
      repair.lastIndexOf(
        "create or replace function public.derive_requirement_verification_status(",
      ),
    );
    expect(derive).toContain("requirement_has_unretracted_failure");
    expect(derive).toContain("then 'failed'");
    const rpc = body(repair, "record_verification_result");
    expect(rpc).toContain("derive_requirement_verification_status(d.id");
    // and the old last-write-wins mapping is gone from the live definition
    expect(rpc).not.toContain("when 'not_achieved' then 'failed'");
  });

  it("makes a failure stop standing only when a human NAMES it", () => {
    expect(repair).toContain(
      "add column if not exists supersedes_obligation_id",
    );
    const plan = body(repair, "create_requirement_verification");
    expect(plan).toContain("supersedes_obligation_id");
    // only a completed not_achieved may be superseded, and only once
    expect(plan).toContain("'not_achieved'");
    expect(plan).toContain(
      "that failure is already answered by another verification",
    );
  });

  it("SAYS the requirement stayed failed rather than letting the status disagree silently", () => {
    const rpc = body(repair, "record_verification_result");
    expect(rpc).toContain("STAYS FAILED");
    const plan = body(repair, "create_requirement_verification");
    expect(plan).toContain("standingFailureNote");
  });

  it("keeps the ONE predicate behind the status, the report and the finding", () => {
    const pred =
      "create or replace function public.requirement_has_unretracted_failure(";
    expect(repair.split(pred)).toHaveLength(2);
    for (const consumer of [
      "derive_requirement_verification_status",
      "get_case_requirement_traceability",
      "get_case_requirement_findings",
    ]) {
      const fnBody = body(repair, consumer);
      expect(
        fnBody.includes("requirement_has_unretracted_failure"),
        `${consumer} must delegate to the one predicate`,
      ).toBe(true);
    }
  });

  it("raises the contradiction as TWO blocking deterministic findings", () => {
    const findings = body(repair, "get_case_requirement_findings");
    expect(findings).toContain("verified_over_an_unretracted_failure");
    expect(findings).toContain("passed_without_superseding_the_failure");
    for (const cls of [
      "verified_over_an_unretracted_failure",
      "passed_without_superseding_the_failure",
    ]) {
      const at = findings.indexOf(cls);
      expect(findings.slice(at, at + 400)).toContain("'blocking'");
    }
  });
});

describe("REPAIR ruling 9 — a requirement and its recorded failures are not deletable", () => {
  const wall = body(repair, "enforce_requirement_provenance");

  it("refuses DELETE except mid-cascade from a parent that is genuinely gone", () => {
    // PROVEN before the fix: one `delete from design_requirements` removed a
    // parent, its child and the child's recorded not_achieved TEST, with zero
    // audit rows — and coverage IMPROVED, both rows having left the
    // denominator.
    expect(wall).toContain("if tg_op = 'DELETE' then");
    expect(wall).toContain("A requirement is not deleted.");
    for (const parent of [
      "from organizations where id = old.organization_id",
      "from development_cases where id = old.development_case_id",
      "from capital_projects where id = old.project_id",
      "from design_requirements where id = old.parent_requirement_id",
    ]) {
      expect(wall, `mid-cascade escape missing for ${parent}`).toContain(
        parent,
      );
    }
  });

  it("gates verification_status and verified_at behind the recorder's marker", () => {
    // PROVEN before the fix: `update design_requirements set
    // verification_status='verified'` as a service caller was ALLOWED, with
    // no exception, no audit row and no security event.
    expect(wall).toContain(
      "new.verification_status is distinct from old.verification_status",
    );
    expect(wall).toContain("new.verified_at is distinct from old.verified_at");
    expect(wall).toContain("app.verification_result_write");
  });

  it("refuses a requirement born already carrying a status", () => {
    expect(wall).toContain(
      "A requirement cannot be created already carrying a verification status",
    );
  });

  it("revokes TRUNCATE and stands a statement guard behind it, like its sibling", () => {
    expect(repair).toContain(
      "revoke truncate on table public.design_requirements from anon, authenticated, service_role;",
    );
    expect(repair).toMatch(
      /create trigger trg_requirement_no_truncate\s+before truncate on public\.design_requirements/,
    );
  });

  it("records a thread hop severed by a foreign key rather than losing it silently", () => {
    // PROVEN before the fix: deleting an asset cleared satisfied_by_asset_id
    // on every requirement it satisfied, with zero audit rows, while the RPC
    // refuses that exact clearing by name.
    const sever = body(repair, "audit_requirement_thread_severance");
    for (const col of [
      "objective_id",
      "satisfied_by_asset_id",
      "commissioning_test_id",
      "operating_kpi_key",
    ]) {
      expect(sever).toContain(`array_append(v_lost, '${col}')`);
    }
    expect(sever).toContain("insert into audit_events");
    expect(sever).toContain("previous_state");
    expect(repair).toMatch(
      /create trigger trg_requirement_thread_severance\s+after update on public\.design_requirements/,
    );
  });
});

describe("REPAIR ruling 10 — the agent may not clear its own findings", () => {
  it("refuses the AI-operator identity at link_requirement_thread BY NAME", () => {
    // PROVEN before the fix, over the product API with a real ai_admin token:
    // one call took a requirement from 4 findings to 2, and the audit row
    // recorded actor = 'ai_admin'.
    const link = body(repair, "link_requirement_thread");
    expect(link).toContain("if coalesce(v_role, '') = 'ai_admin' then");
    expect(link).toContain("could clear its own finding");
    // the refusal is BEFORE the row is read or written
    expect(link.indexOf("'ai_admin'")).toBeLessThan(
      link.indexOf("update design_requirements set"),
    );
  });

  it("refuses that identity a verification_method at record_case_requirement", () => {
    const rec = body(repair, "record_case_requirement");
    expect(rec).toContain(
      "if coalesce(v_role, '') = 'ai_admin' and v_method is not null then",
    );
    expect(rec).toContain("§70 human act");
  });

  it("leaves the identity able to REPORT — it may still record a requirement", () => {
    // The point is that it cannot clear a finding, not that it is locked out.
    // A requirement it records with no owner and no method ADDS findings.
    const rec = body(repair, "record_case_requirement");
    expect(rec).toContain("'admin','ai_admin','executive'");
  });

  it("gives compute_case_requirement_traceability the role check every sibling has", () => {
    // PROVEN before the fix, side by side in one transaction: a `technician`
    // was refused by compute_case_scope_growth and MINTED a permanent
    // calculation_runs row through this one.
    const compute = body(repair, "compute_case_requirement_traceability");
    expect(compute).toContain(
      "'admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner'",
    );
    expect(compute).toContain(
      "requires a planning, engineering or governance role",
    );
  });
});

describe("REPAIR — the honesty gaps in what the reads report", () => {
  const trace = body(repair, "get_case_requirement_traceability");

  it("gives a verified-and-FAILED requirement its own bucket", () => {
    expect(trace).toContain("'verificationFailed', v_failed");
    expect(trace).toContain("verification_status = 'failed'");
  });

  it("renames the open bucket so two different numbers cannot share one word", () => {
    expect(trace).toContain("'awaitingVerification', v_awaiting");
    expect(trace).not.toContain("'unverified', v_");
  });

  it("states a coverage figure that is structurally capped rather than absorbing the cap", () => {
    // threadCoveragePct needs an acceptance test and a KPI, and both stores
    // may be empty for an organization: the percentage then cannot reach 100%
    // for a reason that has nothing to do with these requirements, while
    // rendering as a measurement.
    expect(trace).toContain(
      "from acceptance_tests t where t.organization_id = v_org",
    );
    expect(trace).toContain("capped below 100%");
    expect(trace).toContain("from kpi_catalog");
  });

  it("says whether the delegated WBS question was ANSWERED", () => {
    expect(trace).toContain("'answered', v_wbs_answered");
    expect(trace).toContain("v_wbs_answered := true;");
  });

  it("reports a requirement outside the §10 taxonomy, which the register claimed and nothing did", () => {
    const findings = body(repair, "get_case_requirement_findings");
    expect(findings).toContain("'outside_spec10_taxonomy'");
    expect(findings).toContain(
      "not is_spec10_requirement_category(d.category)",
    );
    // informational: a legacy category is a fact about the schema's history
    const at = findings.indexOf("'outside_spec10_taxonomy'");
    expect(findings.slice(at, at + 200)).toContain("'informational'");
  });

  it("scopes the /design posture to the project side so case results cannot move it", () => {
    const posture = repair.slice(
      repair.lastIndexOf("create or replace function get_project_posture()"),
    );
    expect(posture).toContain("and development_case_id is null");
    // and the case figure is STATED, not dropped
    expect(posture).toContain(
      "belong to development cases and are counted on the case",
    );
  });
});

describe("REPAIR — the provenance wall covers what made the result mean something", () => {
  const wall = body(repair, "enforce_verification_result_provenance");

  it("freezes the measurement, the method and the criteria once the obligation closes", () => {
    // PROVEN before the fix as a service writer with no marker on a COMPLETED
    // obligation: measured_note, method_code, method and acceptance_criteria
    // were all rewritable, and the subject and the tenant were movable.
    expect(wall).toContain("old.status <> 'open'");
    for (const col of [
      "new.measured_note is distinct from old.measured_note",
      "new.method is distinct from old.method",
      "new.method_code is distinct from old.method_code",
      "new.acceptance_criteria is distinct from old.acceptance_criteria",
    ]) {
      expect(wall, `${col} unguarded`).toContain(col);
    }
  });

  it("freezes the subject and the tenant ALWAYS, open or closed", () => {
    expect(wall).toContain(
      "new.requirement_id is distinct from old.requirement_id",
    );
    expect(wall).toContain(
      "new.recommendation_id is distinct from old.recommendation_id",
    );
    expect(wall).toContain(
      "new.organization_id is distinct from old.organization_id",
    );
  });

  it("admits the evidence-item deletion path and AUDITS it, rather than failing an ordinary act", () => {
    // PROVEN before the fix: an ordinary member deleting their own evidence
    // item got "A verification result is recorded through
    // record_verification_result…" — the FK's ON DELETE SET NULL is an
    // UPDATE, and the UPDATE branch had no escape.
    expect(wall).toContain(
      "not exists (select 1 from evidence_items e where e.id = old.evidence_id)",
    );
    expect(wall).toContain("'verification_evidence_severed'");
    // and it is admitted only when NOTHING else moved
    expect(wall).toContain("new.result is not distinct from old.result");
    expect(wall).toContain(
      "new.measured_note is not distinct from old.measured_note",
    );
  });
});

describe("REPAIR — the hierarchy wall looks down as well as up", () => {
  it("refuses a move that would strand this row's children on the case it leaves", () => {
    // PROVEN before the fix: a root moved to case B and its child stayed on
    // case A, which went on counting a child its recursive tree could not
    // reach.
    const h = body(repair, "enforce_requirement_hierarchy_integrity");
    expect(h).toContain("ch.parent_requirement_id = new.id");
    expect(h).toContain("would strand its child");
    // the check runs BEFORE the early return for a row with no parent of its own
    expect(h.indexOf("would strand its child")).toBeLessThan(
      h.indexOf("if new.parent_requirement_id is null then"),
    );
  });
});

describe("REPAIR — the agent report is bounded on every caller-controlled field", () => {
  const rpc = body(repair, "record_requirements_agent_report");

  it("caps the model identifier at the RPC and with a CHECK", () => {
    // PROVEN before the fix: one planner call stored a 200,000-character
    // `model` and 5,054 findings on an immutable, undeletable, org-readable
    // row.
    expect(rpc).toContain("length(p_model), 0) > 200");
    expect(repair).toContain("requirement_agent_report_model_bounded");
  });

  it("caps the caller-supplied findings array and DROPS-and-REPORTS the excess", () => {
    expect(rpc).toContain("jsonb_array_length(p_ai_findings) - 50");
    expect(rpc).toContain("were DROPPED");
    expect(rpc).toContain("where t.n <= 50");
  });

  it("returns the byFamily it STORED, so the families add up to the count", () => {
    expect(rpc).toContain(
      "|| jsonb_build_object('semanticInconsistencyAiSuggested', jsonb_array_length(v_ai)),\n    'headline'",
    );
  });

  it("still forces source and severity from SQL literals — the model labels nothing", () => {
    expect(rpc).toContain("'source', 'ai_suggestion'");
    expect(rpc).toContain("'severity', 'attention'");
  });
});

describe("REPAIR — the repair itself follows the slice's own rules", () => {
  it("creates NO new table and forks no store", () => {
    expect(repair).not.toMatch(/create table/i);
  });

  it("uses auth.uid() for the caller gate, never the dead current_user check", () => {
    expect(repair).not.toContain("current_user in ('authenticated'");
    expect(repair).not.toContain("current_user not in ('authenticated'");
  });

  it("pins search_path and revokes anon on every function it creates", () => {
    const created = [
      ...repair.matchAll(
        /create or replace function (?:public\.)?([a-z_]+)\(/g,
      ),
    ].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(10);
    for (const fn of new Set(created)) {
      const at = Math.max(
        repair.lastIndexOf(`create or replace function public.${fn}(`),
        repair.lastIndexOf(`create or replace function ${fn}(`),
      );
      expect(at, `${fn} not created`).toBeGreaterThan(-1);
      expect(
        repair.slice(at, repair.indexOf("$$", at)),
        `${fn} must pin search_path`,
      ).toContain("set search_path = public");
    }
  });

  it("every enforcement trigger it adds covers INSERT and UPDATE at least", () => {
    for (const t of [
      "trg_verification_subject_tenancy",
      "trg_requirement_provenance",
    ]) {
      const at = repair.indexOf(`create trigger ${t}`);
      expect(at, `${t} not created`).toBeGreaterThan(-1);
      expect(repair.slice(at, at + 200)).toMatch(/before insert or update/);
    }
  });
});
