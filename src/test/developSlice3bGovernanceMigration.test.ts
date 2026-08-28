/**
 * Sync Develop Slice 3B — migration contract (static, no database).
 *
 * The live behavior is proven by scripts/ci-develop-slice3b-smoke.sh against
 * a real local database (multi-role transcript: condition lifecycle +
 * overdue escalation, waiver request/authority-routed decision/expiry
 * reversion, the four SoD pairs refused at the DB, composite-rule
 * enforcement through gate/advance/sanction, ABAC refusals, and the
 * append-only ledger negative proof). This file pins the CONTRACT in the
 * migration text so a later edit that loosens an invariant, forks a
 * canonical store, or drops a refusal fails CI before it reaches a
 * database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));

const audit = read("20261121090000_audit_ledger_hardening.sql");
const waivers = read("20261121090100_gate_requirement_waivers.sql");
const conditions = read("20261121090200_gate_condition_lifecycle.sql");
const sod = read("20261121090300_sod_four_pairs.sql");
const composite = read("20261121090400_composite_authority_rules.sql");
const abac = read("20261121090500_abac_authority_scope.sql");
const workspace = read("20261121090600_develop_workspace_read_v5.sql");
const extendedAuthority = read(
  "20261121090700_extended_risk_authority_update_coverage.sql",
);
const lowerAll = [
  audit,
  waivers,
  conditions,
  sod,
  composite,
  abac,
  workspace,
  extendedAuthority,
]
  .join("\n")
  .toLowerCase();

describe("audit ledger hardening (D11.31)", () => {
  it("EXTENDS the one audit_events table — previous/new snapshots + approval linkage, no parallel ledger", () => {
    expect(audit).toContain("alter table public.audit_events");
    expect(audit).toContain("add column if not exists previous_state jsonb");
    expect(audit).toContain("add column if not exists new_state jsonb");
    expect(audit).toContain("add column if not exists approval_reference uuid");
    expect(lowerAll).not.toMatch(/create table[^;]*audit_log/);
    expect(lowerAll).not.toMatch(/create table[^;]*audit_ledger/);
  });

  it("the append-only backstop raises for EVERY caller — no marker, no service branch, no admit-and-audit", () => {
    const fn = audit.slice(
      audit.indexOf("function public.audit_events_append_only"),
      audit.indexOf("drop trigger if exists trg_audit_events_append_only"),
    );
    expect(fn).toContain(
      "append-only for every caller, the service path included",
    );
    expect(fn).not.toContain("current_setting");
    expect(fn).not.toContain("current_user not in ('authenticated', 'anon')");
    expect(fn).not.toContain("return new");
    expect(audit).toContain("before update or delete on public.audit_events");
  });

  it("TRUNCATE — the erase-everything verb — has its own statement trigger AND is revoked from every API role", () => {
    // A row-level UPDATE/DELETE trigger never fires for TRUNCATE and RLS
    // does not gate it: without both lines below, one statement from any
    // service surface erases the whole decision history without a trace.
    expect(audit).toContain("before truncate on public.audit_events");
    expect(audit).toContain(
      "for each statement execute function public.audit_events_append_only()",
    );
    expect(audit).toContain(
      "revoke truncate on table public.audit_events from anon, authenticated, service_role",
    );
  });
});

describe("gate-requirement waivers (D3.19) on the ONE waiver model", () => {
  it("standard_site_variances is GENERALIZED, not twinned — subject shape keeps the old contract for old rows", () => {
    expect(waivers).toContain("alter table public.standard_site_variances");
    expect(waivers).toContain("add constraint ssv_subject_shape check");
    expect(waivers).toContain("subject_type = 'standard'");
    expect(waivers).toContain("subject_type = 'gate_requirement'");
    // No third waiver table anywhere in the slice.
    expect(lowerAll).not.toMatch(/create table[^;]*waiver/);
  });

  it("D3.20: expiry is NOT NULL after a stated backfill, and one active waiver per requirement", () => {
    expect(waivers).toContain(
      "set expires_at = requested_at + interval '2 years'",
    );
    expect(waivers).toContain("alter column expires_at set not null");
    expect(waivers).toContain("idx_ssv_one_active_requirement_waiver");
    expect(waivers).toMatch(
      /where subject_type = 'gate_requirement' and status = 'approved'/,
    );
  });

  it("the approver routes through the ONE authority store — new action_type, fail-closed decide", () => {
    expect(waivers).toContain(
      "check (action_type in ('general','sanction','regulatory_variance','gate_requirement_waiver'))",
    );
    expect(waivers).toContain(
      "action_type = 'gate_requirement_waiver' and status = 'adopted'",
    );
    expect(waivers).toContain(
      "no ADOPTED gate-requirement-waiver authority exists",
    );
    expect(lowerAll).not.toMatch(/create table[^;]*authority/);
  });

  it("§70: the AI-operator identity cannot decide a waiver — new path and legacy path alike", () => {
    const decideNew = waivers.slice(
      waivers.indexOf("function public.decide_gate_requirement_waiver"),
      waivers.indexOf("function public.decide_standard_variance"),
    );
    expect(decideNew).toContain("= 'ai_admin'");
    const decideLegacy = waivers.slice(
      waivers.indexOf("function public.decide_standard_variance"),
    );
    expect(decideLegacy).toContain("= 'ai_admin'");
    expect(decideLegacy).not.toContain("('admin', 'ai_admin')");
  });

  it("a gate-requirement waiver names its risk assessment (spec II.16) and its requester cannot decide it", () => {
    expect(waivers).toContain(
      "names the risk assessment covering what is being waived",
    );
    expect(waivers).toContain(
      "you requested this waiver and cannot also decide it",
    );
  });

  it("the risk link is load-bearing at BOTH doors: shape-required, undeletable, and fail-closed at decide", () => {
    // Severed link refused by the shape check on every writer.
    expect(waivers).toMatch(
      /subject_type = 'gate_requirement'\s*\n\s*and requirement_id is not null and development_case_id is not null\s*\n\s*and risk_id is not null/,
    );
    // The anchoring risk is not silently removable.
    expect(waivers).toContain("references risks(id) on delete restrict");
    expect(waivers).not.toContain("references risks(id) on delete set null");
    // Decide fails CLOSED, never skips: missing row and unrated risk are
    // each refused by name before any ceiling comparison.
    expect(waivers).toContain("no longer carries its linked risk assessment");
    expect(waivers).toContain("no longer exists on the register");
    expect(waivers).toContain("carries no rated level");
    // The fail-open shape this replaces must never come back.
    expect(waivers).not.toContain(
      "coalesce(risk_rank(r.current_risk_level), 0)",
    );
  });

  it("a lapsed-but-unswept slot is expired AT THE ACT and a genuine conflict refuses by name — no raw 23505", () => {
    const decide = waivers.slice(
      waivers.indexOf("function public.decide_gate_requirement_waiver"),
      waivers.indexOf("function public.decide_standard_variance"),
    );
    expect(decide).toContain("and expires_at <= now() and id <> w.id");
    expect(decide).toContain("set status = 'expired' where id = v_slot.id");
    expect(decide).toContain(
      "an active approved waiver already covers this requirement for this case",
    );
  });

  it("org-node scope lands on the ONE store here, restrict-anchored, so every later act site consumes one rule", () => {
    expect(waivers).toContain(
      "add column if not exists org_node_id uuid references organizations(id) on delete restrict",
    );
    // The scope-aware selection: most specific covering scope, version as
    // tie-break — the same ORDER BY at the waiver decide as everywhere else.
    expect(waivers).toContain(
      "order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc",
    );
    expect(waivers).toContain(
      "scoped to one organization node whose subtree does not cover",
    );
  });
});

describe("gate condition lifecycle (D3.18)", () => {
  it("closure requires linked evidence for EVERY writer — both trigger branches raise on an evidence-free closure", () => {
    const fn = conditions.slice(
      conditions.indexOf("function public.enforce_gate_condition_provenance"),
      conditions.indexOf("function public.close_gate_condition"),
    );
    const raises = fn.split("closed by linked evidence").length - 1;
    expect(raises).toBeGreaterThanOrEqual(2);
    expect(fn).toContain("check_violation");
  });

  it("close_gate_condition demands case-scoped evidence and refuses the AI-operator identity by name", () => {
    const fn = conditions.slice(
      conditions.indexOf("function public.close_gate_condition"),
      conditions.indexOf("function public.expire_governance_instruments"),
    );
    expect(fn).toContain("= 'ai_admin'");
    expect(fn).toContain(
      "evidence item is not recorded against this condition''s case",
    );
    expect(fn).toContain("record_case_evidence");
  });

  it("overdue escalation EXTENDS the one sweep — same function, same job name, consequence read at breach", () => {
    expect(conditions).toContain(
      "create or replace function public.expire_governance_instruments",
    );
    expect(conditions).toContain("'expire-governance-instruments'");
    expect(conditions).toContain("status = 'missed', breached_at = now()");
    expect(conditions).toContain("Recorded consequence if missed");
    expect(conditions).toContain("gate_conditions_escalated");
    // Waiver expiry leaves the reversion on the record.
    expect(conditions).toContain("ENFORCEMENT REVERTED");
    expect(lowerAll).not.toMatch(/cron\.schedule\('expire-gate-conditions/);
  });

  it("D3.07: the funding answer column is non-empty when present (the conditions-text idiom)", () => {
    expect(conditions).toContain("funding_continuation_answer text");
    expect(conditions).toContain(
      "funding_continuation_answer is null or btrim(funding_continuation_answer) <> ''",
    );
  });

  it("BORN COMPLETE binds every writer: a conditional case review with zero condition rows dies at commit", () => {
    // Deferred, because the review row is inserted before its children in
    // the one governed transaction; scoped to the reconciled case
    // vocabulary so legacy asset reviews keep their text-only contract.
    expect(conditions).toContain(
      "create constraint trigger trg_conditional_review_has_conditions",
    );
    expect(conditions).toContain("deferrable initially deferred");
    expect(conditions).toContain("at least one first-class gate condition");
    expect(conditions).toContain("new.development_case_id is not null");
  });
});

describe("the four SoD pairs at the database (D3.33 + D3.17)", () => {
  it("pair 1 extended to project scope: development_case subject + cross-table independence wall with no service admit", () => {
    expect(sod).toContain(
      "check (subject_type in ('risk','control','scenario','decision','acceptance','development_case'))",
    );
    const fn = sod.slice(
      sod.indexOf("function public.enforce_case_assurance_independence"),
      sod.indexOf("drop trigger if exists trg_case_assurance_independence"),
    );
    expect(fn).toContain("cannot independently assure their own case");
    expect(fn).toContain("check_violation");
    expect(fn).not.toContain("current_user not in ('authenticated', 'anon')");
  });

  it("the assurance RPC forces the case's own accountable pair as subject owner — never caller-stated", () => {
    expect(sod).toContain(
      "v_owner := coalesce(v_case.sponsor_id, v_case.created_by)",
    );
    expect(sod).toContain(
      "the case sponsor or creator cannot independently assure their own case",
    );
  });

  it("pair 2 (requester != final approver) is a row-local check on the sanction record", () => {
    expect(sod).toContain("dc_sanction_requester_sod");
    expect(sod).toContain(
      "(sanctioned_by is null or created_by is null or sanctioned_by <> created_by)",
    );
  });

  it("pair 3 (contractor != owner acceptance) is a row-local check where the acceptance act lives", () => {
    expect(sod).toContain("dd_producer_not_acceptor_sod");
    expect(sod).toContain("(accepted_by is null or accepted_by <> owner_id)");
  });

  it("pair 4 (treatment owner != risk acceptor) refuses cross-table for recommendation AND risk subjects", () => {
    const fn = sod.slice(
      sod.indexOf("function public.enforce_treatment_owner_not_acceptor"),
      sod.indexOf("drop trigger if exists trg_treatment_owner_not_acceptor"),
    );
    expect(fn).toContain("treatment_owner_id");
    expect(fn).toContain("check_violation");
    // Both accept_risk signatures carry the named refusal.
    const refusals = sod.split("cannot also accept its residual").length - 1;
    expect(refusals).toBeGreaterThanOrEqual(3);
  });

  it("pair 4 covers BOTH verbs — an UPDATE that re-points accepted_by is the same conflict", () => {
    expect(sod).toContain("before insert or update on public.risk_acceptances");
    // Attribution-change gating: bookkeeping updates (the expiry sweep's
    // status flip) pass; re-attribution re-litigates.
    const fn = sod.slice(
      sod.indexOf("function public.enforce_treatment_owner_not_acceptor"),
      sod.indexOf("drop trigger if exists trg_treatment_owner_not_acceptor"),
    );
    expect(fn).toContain(
      "new.accepted_by is not distinct from old.accepted_by",
    );
  });

  it("the extended-authority ceiling on the SAME table covers both verbs too — no INSERT-only sibling left", () => {
    // trg_treatment_owner_not_acceptor and trg_extended_risk_acceptance_authority
    // both sit on risk_acceptances. Hardening only the first left the identical
    // verb-coverage hole one trigger over: insert at 'Low' (passes the ceiling),
    // then UPDATE risk_level to 'Critical' — the ceiling never re-ran. Proven
    // exploitable live, and closed by re-creating the trigger with both verbs.
    expect(extendedAuthority).toContain(
      "before insert or update on public.risk_acceptances",
    );
    expect(extendedAuthority).toContain(
      "trg_extended_risk_acceptance_authority",
    );
    // The function body is NOT re-created here: this migration widens WHEN the
    // guard runs, never WHAT it refuses.
    expect(extendedAuthority).not.toContain(
      "create or replace function public.enforce_extended_risk_acceptance_authority",
    );
    // It still points at the ORIGINAL function, unmodified.
    expect(extendedAuthority).toContain(
      "execute function public.enforce_extended_risk_acceptance_authority()",
    );
  });

  it("§70: the AI-operator identity can neither accept a risk nor stand as INDEPENDENT case assurer — RPC and boundary", () => {
    // Both accept_risk signatures refuse by name.
    const acceptRefusals =
      sod.split(
        "a §70 human determination — the AI-operator identity cannot record one",
      ).length - 1;
    expect(acceptRefusals).toBeGreaterThanOrEqual(2);
    // The persistence backstop refuses the AI as recorded acceptor for
    // every writer and verb.
    expect(sod).toContain("cannot stand as the recorded acceptor");
    // The assurance RPC refuses the AI for the demand-releasing review …
    expect(sod).toContain(
      "releases gate enforcement — a §70 human determination the AI-operator identity cannot record",
    );
    // … and the cross-table wall refuses the AI reviewer for every writer.
    expect(sod).toContain("cannot stand as the reviewer");
  });

  it("D3.32: both accept_risk ladders use the scope-aware selection with the named covering-nothing refusal", () => {
    const selections =
      sod.split(
        "order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc",
      ).length - 1;
    expect(selections).toBeGreaterThanOrEqual(2);
    const scopedRefusals =
      sod.split("scoped to one organization node whose subtree does not cover")
        .length - 1;
    expect(scopedRefusals).toBeGreaterThanOrEqual(2);
  });
});

describe("composite authority rules (D3.34 + D11.28)", () => {
  it("the rules RIDE the versioned rule-set family — no parallel rules engine, succession clones them", () => {
    expect(composite).toContain(
      "rule_set_id uuid not null references governance_tailoring_rule_sets(id) on delete cascade",
    );
    expect(composite).toContain("insert into governance_composite_rules");
    const clone = composite.slice(
      composite.indexOf("function public.create_governance_rule_set_version"),
      composite.indexOf("function public.enforce_intensity_governance_binding"),
    );
    expect(clone).toContain(
      "from governance_composite_rules where rule_set_id = rs.id",
    );
  });

  it("only ENFORCED consequences are recordable — the vocabulary is a check constraint", () => {
    expect(composite).toContain(
      "consequence text not null check (consequence in ('independent_assurance_required'))",
    );
    expect(composite).toContain("at least one condition");
  });

  it("the ONE predicate carries its arms and always returns every key", () => {
    const fn = composite.slice(
      composite.indexOf(
        "create or replace function public.case_binding_gate_demands",
      ),
      composite.indexOf("function public.governance_demands_message"),
    );
    for (const key of [
      "'unlinked_mandatory'",
      "'non_independent_gates'",
      "'waiver_reverted'",
      "'criteria_unmet'",
      "'composite_unmet'",
    ]) {
      expect(fn).toContain(key);
    }
    // The lapsed-waiver arm names only gaps a waiver actually covered; a
    // never-waived gap is criteria_unmet — a refusal that says "your
    // waiver lapsed" to a case that never held one misdirects the remedy.
    expect(fn).toContain("as waiver_lapsed");
    expect(composite).toContain("never covered by a waiver");
    // The demand is met only by a COMPLETED acceptable INDEPENDENT review.
    expect(fn).toContain(
      "assurance_level = 'independent' and ar.status = 'completed'",
    );
    expect(fn).toContain("('acceptable','acceptable_with_actions')");
    // The evidence arm exempts actively-waived criteria.
    const evidenceArm = fn.slice(
      fn.indexOf("evidence_linked_deliverables_required"),
    );
    expect(evidenceArm).toContain("standard_site_variances");
  });

  it("the acts consume the shared builder — refusals name the failing arm, and the needle survives", () => {
    expect(composite).toContain("function public.governance_demands_message");
    expect(composite).toContain("binding is not met");
    expect(composite).toContain("LAPSED");
    const advanceBody = composite.slice(
      composite.indexOf("function public.advance_development_case_stage"),
    );
    expect(advanceBody).toContain("governance_demands_message(v_demands)");
    const sanctionBody = composite.slice(
      composite.indexOf("function public.sanction_development_case"),
    );
    expect(sanctionBody).toContain("governance_demands_message(v_demands)");
  });

  it("record_case_gate_review: funding refusal at sanction-type gates, waiver stand-in, composite refusal", () => {
    const fn = composite.slice(
      composite.indexOf("function public.record_case_gate_review"),
      composite.indexOf("function public.advance_development_case_stage"),
    );
    expect(fn).toContain("this is a sanction-type gate");
    expect(fn).toContain("would we still fund it?");
    expect(fn).toContain("stage_key = 'sanction'");
    expect(fn).toContain("composite authority rule(s) of the adopted rule set");
    // Waiver stand-in appears in BOTH the unmet exclusion and the waived list.
    const waiverJoins =
      fn.split("subject_type = 'gate_requirement'").length - 1;
    expect(waiverJoins).toBeGreaterThanOrEqual(2);
    expect(fn).toContain("w.status = 'approved' and w.expires_at > now()");
    // The prior signature is dropped, not overloaded.
    expect(composite).toContain(
      "drop function if exists public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid);",
    );
  });

  it("sanction carries the SoD refusal and the D11.31 snapshot with the authority row as approval_reference", () => {
    const fn = composite.slice(
      composite.indexOf("function public.sanction_development_case"),
    );
    expect(fn).toContain(
      "you raised this case and cannot also record its sanction",
    );
    expect(fn).toContain("previous_state, new_state, approval_reference");
    expect(fn).toContain("l.id);");
  });
});

describe("ABAC on the ONE authority store (D3.32)", () => {
  it("org-node scope: adoption supersedes per scope, and the general path selects by COVERING scope", () => {
    // (The column itself lands in 20261121090100 §3 — pinned there — so
    // every act site defined between there and here consumes one rule.)
    expect(abac).toContain("org_node_id is not distinct from l.org_node_id");
    expect(abac).toContain("org_ancestry(new.organization_id)");
    // Scope-aware selection: covering scopes only, most specific first,
    // version as tie-break — a newer non-covering adoption can neither
    // shadow the org-wide ladder nor be silently skipped past.
    expect(abac).toContain(
      "and (al.org_node_id is null or anc.node_id is not null)",
    );
    expect(abac).toContain(
      "order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc",
    );
    // Covering NOTHING refuses by name; only a role with no adopted ladder
    // at all falls through to the no-delegation default.
    expect(abac).toContain("scoped to one organization node");
    expect(abac).toContain("this act sits outside every such subtree");
  });

  it("sanction consumes the same scope rule — a recorded scope is never dead data on the ladder the audit cites", () => {
    const sanctionBody = composite.slice(
      composite.indexOf("function public.sanction_development_case"),
    );
    expect(sanctionBody).toContain(
      "order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc",
    );
    expect(sanctionBody).toContain(
      "scoped to one organization node whose subtree does not cover",
    );
  });

  it("criticality and competency now bind the general approval path", () => {
    const fn = abac.slice(
      abac.indexOf("function public.enforce_authority_limit"),
      abac.indexOf("function public.configure_risk_authority_scope"),
    );
    expect(fn).toContain("asset_criticality_levels");
    expect(fn).toContain("required_competency_keys");
    expect(fn).toContain("member_competencies");
    expect(fn).toContain(
      "mc.expires_on is null or mc.expires_on >= current_date",
    );
  });

  it("scope authoring validates tree membership — no authority over someone else's tree", () => {
    expect(abac).toContain(
      "must name this organization or a node inside its own tree",
    );
    expect(abac).toContain(
      "org_node_id=nullif(p_scope->>'org_node_id','')::uuid",
    );
  });

  // THE BOUNDARY OF THE TREE DIMENSION, pinned so the register cannot drift
  // back into claiming more than the code does. Every act site matches the
  // ladder's organization_id against the ACTING row's organization BEFORE the
  // node predicate, so org_node_id refines and refuses among ladders stored at
  // the same organization row — it never routes authority across org rows (a
  // delegation adopted at a parent organization cannot govern a child
  // organization's acts, whatever its org_node_id). If a future edit drops the
  // organization_id equality to make scope route across the tree, that is a
  // tenancy change and must fail here first.
  it("org-node scope refines within an organization row and cannot route across them", () => {
    const sites: Array<[string, string]> = [
      ["enforce_authority_limit", "al.organization_id = new.organization_id"],
      [
        "accept_risk (6-arg)",
        "al.organization_id = v_org and al.role_key = v_role",
      ],
      [
        "accept_risk (7-arg)",
        "al.organization_id=v_org and al.role_key=v_role",
      ],
      [
        "decide_gate_requirement_waiver",
        "al.organization_id = v_org and al.role_key = coalesce(v_role, '')",
      ],
    ];
    const haystack = `${abac}\n${sod}\n${waivers}`;
    for (const [site, predicate] of sites) {
      expect(
        haystack,
        `${site} must scope its ladder to the acting organization`,
      ).toContain(predicate);
    }
    // Sanction too, read from its own body so a drift there cannot hide.
    const sanctionBody = composite.slice(
      composite.indexOf("function public.sanction_development_case"),
    );
    expect(sanctionBody).toContain("al.organization_id = v_org");
    // The node predicate is ancestry-of-the-acting-org, never descendant-of:
    // a ladder scoped BELOW the acting organization covers nothing.
    const selections =
      `${abac}\n${sod}\n${waivers}\n${composite}`.split(
        "and (al.org_node_id is null or anc.node_id is not null)",
      ).length - 1;
    expect(selections).toBeGreaterThanOrEqual(5);
  });
});

describe("the workspace read v5 renders what the DB enforces", () => {
  it("funding, waivers, condition lifecycle and composite rules all reach the surface", () => {
    expect(workspace).toContain("'fundingQuestionRequired'");
    expect(workspace).toContain(
      "'fundingContinuationAnswer', r.funding_continuation_answer",
    );
    expect(workspace).toContain("'activeWaiver'");
    expect(workspace).toContain("'waivers'");
    expect(workspace).toContain("'breachedAt', gc.breached_at");
    expect(workspace).toContain("'compositeRules'");
  });
});
