/**
 * Sync Develop Slice 5B — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice5b-smoke.sh against
 * a real local database: an un-dispositioned frontline recommendation refused
 * at a real gate through the SHIPPED wall, a participation flag refused when
 * it is typed rather than derived, a finding refused when it is attributed to
 * somebody who was not in the room, the AI-operator identity refused at five
 * doors and five walls, a composite that refuses the axis nobody scored, and
 * one dependency graph carrying both interface edges and asset edges.
 *
 * This file pins the CONTRACT in the migration text so a later edit that drops
 * one of the eight I.25 dimensions, loses the constructor discipline, makes a
 * disposition reason optional, lets the raiser answer their own finding,
 * averages five axes, forks the blocker predicate into a second evaluator, or
 * admits a machine to any of it fails before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  DESIGN_AXES,
  DESIGN_AXIS_SCALE,
  DISPOSITION_DISCIPLINES,
  DISPOSITION_OUTCOMES,
  FRONTLINE_DIMENSIONS,
  FRONTLINE_DISCIPLINES,
} from "../lib/design";
import { INTERFACE_STATUSES, INTERFACE_TYPES } from "../lib/develop/interfaces";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const REVIEW_FILE = "20261205090000_develop_frontline_design_review.sql";
const SCORING_FILE = "20261205090100_develop_design_axis_scoring.sql";
const INTERFACE_FILE = "20261205090200_develop_case_interfaces.sql";
const SLICE_FILES = [REVIEW_FILE, SCORING_FILE, INTERFACE_FILE];

const review = read(REVIEW_FILE);
const scoring = read(SCORING_FILE);
const interfaces = read(INTERFACE_FILE);
const joined = [review, scoring, interfaces].join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");

/** The executable text, with `comment on … is '…'` documentation removed. */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n$$;", at);
  return source.slice(at, end === -1 ? undefined : end);
}

/* ───────────────── the migrations land after 5A, in order ─────────────── */

describe("the slice lands strictly after Slice 5A", () => {
  it("every 5B filename sorts after 20261204090300", () => {
    for (const f of SLICE_FILES) {
      expect(f > "20261204090300_develop_slice5a_repair.sql").toBe(true);
    }
  });

  it("orders itself by dependency: review, then scoring, then interfaces", () => {
    // Scoring and interfaces both reuse the review file's ONE §70 trigger
    // function, so they must land after it.
    expect(REVIEW_FILE < SCORING_FILE).toBe(true);
    expect(SCORING_FILE < INTERFACE_FILE).toBe(true);
    expect(scoring).toContain("enforce_frontline_judgement_is_human");
    expect(interfaces).toContain("enforce_frontline_judgement_is_human");
  });
});

/* ─────────── D4.10 — the eight dimensions and three disciplines ────────── */

describe("D4.10 — spec I.25's eight dimensions and three disciplines", () => {
  it("names all eight dimensions server-side, and TypeScript agrees", () => {
    const fn = review.slice(
      review.indexOf("sync_frontline_review_dimensions()"),
      review.indexOf(
        "comment on function public.sync_frontline_review_dimensions",
      ),
    );
    for (const d of FRONTLINE_DIMENSIONS) {
      expect(fn, `${d.key} missing from the SQL vocabulary`).toContain(
        `'${d.key}'`,
      );
    }
    expect(FRONTLINE_DIMENSIONS).toHaveLength(8);
  });

  it("names all three disciplines including the constructor role design_studies never had", () => {
    const fn = review.slice(
      review.indexOf("sync_frontline_disciplines()"),
      review.indexOf("comment on function public.sync_frontline_disciplines"),
    );
    for (const d of FRONTLINE_DISCIPLINES) expect(fn).toContain(`'${d.key}'`);
    expect(fn).toContain("'construction'");
    expect(review).toContain("constructor_participated");
  });

  it("the disposition disciplines are the three plus engineering, derived not retyped", () => {
    const fn = body(review, "sync_disposition_disciplines");
    // Derived from the frontline list, so the two can never disagree.
    expect(fn).toContain("sync_frontline_disciplines()");
    expect(fn).toContain("'engineering'");
    expect(DISPOSITION_DISCIPLINES).toHaveLength(4);
  });

  it("adds the frontline_design_review kind as a UNION and RAISES rather than widening blind", () => {
    expect(review).toContain("'frontline_design_review'");
    // The transform-or-raise idiom: a migration that cannot find what it came
    // to change fails loudly instead of installing a check nobody reviewed.
    expect(review).toContain("Do not widen a constraint blind");
    for (const kept of [
      "equipment_selection",
      "maintainability_review",
      "access_and_lifting",
      "removal_route",
      "standardisation_review",
      "sparing_review",
      "instrumentation_review",
      "ram_study",
    ]) {
      expect(review, `${kept} was dropped from the study kinds`).toContain(
        `'${kept}'`,
      );
    }
  });

  it("keeps the project side of design_studies untouched: NOT NULL is transformed with a CHECK in the same block", () => {
    expect(review).toContain("alter column project_id drop not null");
    expect(review).toContain("design_studies_scoped_somewhere");
    expect(review).toContain(
      "check (project_id is not null or development_case_id is not null)",
    );
  });

  it("case-scoped studies are definer-RPC-only, stated RESTRICTIVELY", () => {
    for (const cmd of ["ins", "upd", "del"]) {
      expect(review).toContain(
        `design_studies_case_no_${cmd} on public.design_studies as restrictive`,
      );
    }
  });
});

/* ─────────── D4.10 — participation is derived, not decorative ─────────── */

describe("D4.10 — the participation flags are DERIVED (ruling 3)", () => {
  it("a case-bound study refuses a typed participation flag", () => {
    const fn = body(review, "enforce_case_study_derivation");
    expect(fn).toContain("maintainer_participated is distinct from v_maint");
    expect(fn).toContain("operator_participated is distinct from v_ops");
    expect(fn).toContain("constructor_participated is distinct from v_cons");
    expect(fn.toLowerCase()).toContain("cannot be typed");
    // Project rows keep their typed booleans exactly as they were.
    expect(fn).toContain("if new.development_case_id is null");
  });

  it("...and refuses a typed finding aggregate for the same reason", () => {
    const fn = body(review, "enforce_case_study_derivation");
    expect(fn).toContain("findings_count is distinct from v_count");
    expect(fn).toContain("findings_closed is distinct from v_closed");
  });

  it("the derivation trigger covers INSERT and UPDATE", () => {
    expect(review).toMatch(
      /create trigger trg_case_study_derivation\s+before insert or update on public\.design_studies/,
    );
  });

  it("the refresh fires from all three child tables", () => {
    for (const t of [
      "trg_refresh_study_from_participants",
      "trg_refresh_study_from_findings",
      "trg_refresh_study_from_dispositions",
    ]) {
      expect(review).toContain(t);
    }
    // and on every operation, because a deleted child changes the count too.
    expect(
      review.match(/after insert or update or delete on public\.design_/g) ??
        [],
    ).toHaveLength(3);
  });

  it("a finding may only be raised by a recorded participant, at the WALL", () => {
    const fn = body(review, "enforce_design_finding_from_participant");
    expect(fn).toContain("from design_study_participants p");
    expect(fn).toContain("p.discipline = new.raised_by_discipline");
    expect(fn.toLowerCase()).toContain("was in the room");
    expect(review).toMatch(
      /create trigger trg_design_finding_from_participant\s+before insert or update/,
    );
  });

  it("the raiser's discipline is read from the roster, never taken from the caller", () => {
    const fn = body(review, "raise_design_review_finding");
    expect(fn).toContain(
      "select discipline into v_discipline from design_study_participants",
    );
    // A person on the roster twice is REFUSED with the ambiguity named rather
    // than having one silently picked.
    expect(fn).toContain("if v_seen > 1 then");
  });
});

/* ─────────────────── D4.11 — the disposition record ──────────────────── */

describe("D4.11 — the accountability record", () => {
  it("carries the three I.25 outcomes and TypeScript agrees", () => {
    const fn = body(review, "sync_design_finding_outcomes");
    for (const o of DISPOSITION_OUTCOMES) expect(fn).toContain(`'${o.key}'`);
    expect(DISPOSITION_OUTCOMES).toHaveLength(3);
  });

  it("a reason is NOT NULL and length-checked, on every outcome", () => {
    expect(review).toContain(
      "reason text not null check (length(btrim(reason)) >= 20)",
    );
    const fn = body(review, "disposition_design_finding");
    expect(fn.toLowerCase()).toContain("every outcome");
  });

  it("conditions exist exactly when the outcome is conditional", () => {
    expect(review).toContain("design_disposition_conditions_shape");
    expect(review).toContain(
      "(outcome = 'accepted_with_conditions')\n      = (conditions is not null and btrim(conditions) <> '')",
    );
  });

  it("the raiser cannot answer their own finding — door AND wall", () => {
    expect(body(review, "disposition_design_finding")).toContain(
      "if f.raised_by = auth.uid() then",
    );
    const wall = body(review, "enforce_disposition_integrity");
    expect(wall).toContain("if new.dispositioned_by = f.raised_by then");
  });

  it("dispositions are append-only and numbered, and a revision supersedes", () => {
    expect(review).toContain("unique (finding_id, disposition_no)");
    expect(body(review, "disposition_design_finding")).toContain(
      "coalesce(max(disposition_no), 0) + 1",
    );
  });

  it("audit_events carries previous_state AND new_state for a revision", () => {
    const fn = body(review, "disposition_design_finding");
    expect(fn).toContain("previous_state, new_state");
    expect(fn).toContain("v_prev,");
  });

  it("a recommendation is carried into a requirement only AFTER it is answered", () => {
    const fn = body(review, "carry_design_finding_to_requirement");
    // It reads the LATEST disposition rather than merely asserting one exists,
    // because the outcome decides whether there is anything to carry at all.
    expect(fn).toContain("from design_finding_dispositions dd");
    expect(fn).toContain("order by dd.disposition_no desc limit 1");
    expect(fn.toLowerCase()).toContain("has not been dispositioned");
  });

  /* ── 5B-R7 — a carrier that carries nothing ─────────────────────────── */

  it("only an ACCEPTANCE is carried, and never onto a requirement already known not to hold", () => {
    const fn = body(review, "carry_design_finding_to_requirement");
    expect(fn).toContain(
      "v_outcome not in ('accepted', 'accepted_with_conditions')",
    );
    expect(fn.toLowerCase()).toContain("there is nothing to carry");
    expect(fn).toContain("d.verification_status in ('failed', 'waived')");
    expect(fn.toLowerCase()).toContain(
      "cannot carry an accepted recommendation",
    );
  });

  it("an acceptance whose only carrier FAILED verification is a named blocker, on the one predicate", () => {
    const fn = body(review, "case_frontline_design_obligations");
    expect(fn).toContain("frontline_acceptance_carried_by_failed_requirement");
    expect(fn).toContain("dr.verification_status in ('failed', 'waived')");
    // ...and the gate wall refuses over it, rather than the read merely saying so.
    expect(review).toContain(
      "'frontline_acceptance_carried_by_failed_requirement',",
    );
  });

  it("the carrier's verification state travels onto the screen", () => {
    const fn = body(review, "get_case_frontline_review");
    expect(fn).toContain("'requirementVerification', dr.verification_status");
  });

  /* ── 5B-R3 — the scribe column ──────────────────────────────────────── */

  it("a finding records WHO TYPED IT as well as whose opinion it is", () => {
    // `raised_by` may be somebody other than the caller — recording for the
    // room is ordinary — so without `recorded_by` one person could put a
    // recommendation in a colleague's mouth and leave no trace of having done
    // it. The column is NOT NULL, set to auth.uid(), and frozen.
    expect(review).toMatch(
      /recorded_by uuid not null references auth\.users\(id\),/,
    );
    const rpc = body(review, "raise_design_review_finding");
    expect(rpc).toContain(
      "dimension, raised_by, recorded_by, raised_by_discipline",
    );
    expect(rpc).toContain("v_raised_by, auth.uid()");
    expect(rpc).toContain("'recorded_by', auth.uid()");
    const wall = body(review, "enforce_design_finding_immutable");
    expect(wall).toContain("new.recorded_by is distinct from old.recorded_by");
  });

  it("the SCRIBE cannot answer the finding they typed — at the door and at the wall", () => {
    // The raiser-is-not-dispositioner rule compares the ATTRIBUTED raiser, so
    // proxy attribution walked straight through it: raise it in a colleague's
    // name, then answer it yourself.
    const door = body(review, "disposition_design_finding");
    expect(door).toContain("f.recorded_by = auth.uid()");
    expect(door.toLowerCase()).toContain("you recorded this finding");
    const wall = body(review, "enforce_disposition_integrity");
    expect(wall).toContain("new.dispositioned_by = f.recorded_by");
  });

  it("the scribe is human and a member of the tenant", () => {
    expect(review).toContain(
      "'recorded_by', 'record a frontline design-review finding for somebody'",
    );
    const wall = body(review, "enforce_design_finding_from_participant");
    expect(wall).toContain("u.id = new.recorded_by");
  });

  /* ── 5B-R5 — the discipline claim is checked against the room ────────── */

  it("a FRONTLINE disposition discipline must be one the answerer attended in", () => {
    // `disposition_discipline` is the sentence "maintenance accepted this".
    // It was a free choice among four while `raised_by_discipline` was read
    // from the roster — an asymmetry inside one file.
    const door = body(review, "disposition_design_finding");
    expect(door).toContain("v_discipline <> 'engineering'");
    expect(door).toContain("p.discipline = v_discipline");
    const wall = body(review, "enforce_disposition_integrity");
    expect(wall).toContain("new.disposition_discipline <> 'engineering'");
    expect(wall).toContain("p.discipline = new.disposition_discipline");
  });

  /* ── 5B-R4 — membership on the accountability columns ────────────────── */

  it("the dispositioner and the scorer must be members of the tenant", () => {
    // Without this §70 is string equality against a user_profiles row that
    // need not exist, so an identity with no profile — an unprovisioned system
    // account — was admitted, and a foreign tenant's member was admitted and
    // then rendered onto this tenant's screen by the read's name join.
    const dw = body(review, "enforce_disposition_integrity");
    expect(dw).toContain("u.id = new.dispositioned_by");
    expect(dw).toContain("u.organization_id = new.organization_id");
    const aw = body(scoring, "enforce_axis_score_integrity");
    expect(aw).toContain("u.id = new.scored_by");
    expect(aw).toContain("u.organization_id = new.organization_id");
  });

  it("every user_profiles name join in the reads is tenant-scoped", () => {
    for (const fn of [
      body(review, "get_case_frontline_review"),
      body(scoring, "get_case_design_scorecard"),
      body(interfaces, "get_case_interface_graph"),
    ]) {
      // The join may wrap across lines, so each one is taken up to the next
      // statement keyword rather than to the first newline.
      const joins =
        fn.match(
          /left join user_profiles[\s\S]*?(?=\n\s*(?:left join|where|from|order by|\)))/g,
        ) ?? [];
      expect(joins.length).toBeGreaterThan(0);
      for (const j of joins) {
        expect(j).toContain("organization_id = v_org");
      }
    }
  });
});

/* ── 5B-R6 — the parent of every frontline ledger ──────────────────────── */

describe("design_studies is guarded as hard as the tables that hang off it", () => {
  it("a case-bound study cannot be deleted, truncated or detached by ANY caller", () => {
    // Each child's DELETE branch steps aside mid-cascade, so deleting the
    // parent once erased every participant, finding and disposition AND
    // cleared every gate blocker, in one unguarded statement.
    const fn = body(review, "enforce_case_study_immutable");
    expect(fn).toContain("tg_op = 'TRUNCATE'");
    expect(fn).toContain("tg_op = 'DELETE'");
    expect(fn.toLowerCase()).toContain("not deleted");
    // The case, the kind and the org all decide which obligations it raises.
    expect(fn).toContain(
      "new.development_case_id is distinct from old.development_case_id",
    );
    expect(fn).toContain("new.study_kind is distinct from old.study_kind");
    expect(fn).toContain(
      "new.organization_id is distinct from old.organization_id",
    );
    // The project side keeps its pre-existing contract exactly.
    expect(fn).toContain("if old.development_case_id is null then");
  });

  it("the trigger covers UPDATE, DELETE and statement-level TRUNCATE, and TRUNCATE is revoked", () => {
    expect(review).toContain(
      "before update or delete on public.design_studies",
    );
    expect(review).toContain("before truncate on public.design_studies");
    expect(review).toContain(
      "revoke truncate on table public.design_studies from anon, authenticated, service_role;",
    );
  });
});

/* ── 5B-R2 — the provenance backstop ───────────────────────────────────── */

describe("an ADMITTED service-path write leaves something to find", () => {
  it("every new table's integrity trigger records the writes it admits", () => {
    expect(review).toContain(
      "create or replace function public.record_frontline_service_write(",
    );
    for (const fn of [
      body(review, "enforce_design_participant_tenancy"),
      body(review, "enforce_design_finding_from_participant"),
      body(review, "enforce_disposition_integrity"),
      body(review, "enforce_case_study_derivation"),
      body(review, "enforce_case_study_immutable"),
      body(scoring, "enforce_axis_score_integrity"),
      body(interfaces, "enforce_case_interface_integrity"),
    ]) {
      expect(fn).toContain("record_frontline_service_write(");
      // The dual-caller gate is auth.uid(), never the dead `current_user` form.
      expect(fn).toContain("auth.uid() is null");
    }
  });

  it("the backstop is never called on a refusing path (4D-R33)", () => {
    // A BEFORE trigger that logs and then RAISEs loses the log with the
    // aborted statement, so a logging call above a raise is dead code that
    // reads as an audit trail.
    for (const src of [review, scoring, interfaces]) {
      // Only the CALL SITES inside trigger bodies, not the declaration or its
      // grant/comment lines.
      const sites = [
        ...src.matchAll(/perform record_frontline_service_write\(/g),
      ];
      expect(sites.length).toBeGreaterThan(0);
      for (const m of sites) {
        const after = src.slice(m.index ?? 0, (m.index ?? 0) + 1400);
        const ret = after.search(/\breturn (new|old)\b/);
        const raise = after.indexOf("raise exception");
        expect(ret).toBeGreaterThan(-1);
        // A `return` reaches this call before any further refusal does, so the
        // row it writes survives the statement it is recording.
        if (raise > -1) expect(ret).toBeLessThan(raise);
      }
    }
  });
});

/* ── 5B-R1 — the §70 wall fails loud when mis-bound ────────────────────── */

describe("the §70 wall cannot be uninstalled by renaming a column", () => {
  it("a TG_ARGV column the table does not have RAISES instead of admitting", () => {
    // `to_jsonb(new)->>'<missing column>'` is NULL rather than an error, so a
    // typo or a later rename silently disabled §70 while the trigger stayed
    // present and apparently firing.
    const fn = body(review, "enforce_frontline_judgement_is_human");
    expect(fn).toContain("if not (to_jsonb(new) ? v_col) then");
    expect(fn).toContain("raise exception");
    const guardAt = fn.indexOf("if not (to_jsonb(new) ? v_col)");
    const actorAt = fn.indexOf("v_actor := sync_text_as_uuid");
    expect(guardAt).toBeGreaterThan(-1);
    expect(actorAt).toBeGreaterThan(guardAt);
  });
});

/* ── 5B-R8 / R11 / R12 — notes, refusal text and ordering ──────────────── */

describe("what the customer reads is true", () => {
  it("a status note belongs to the status that produced it", () => {
    // `coalesce(v_note, status_note)` carried a dispute's text onto the
    // agreement that resolved it: "Agreed — the vendor disputes the rating".
    const fn = body(interfaces, "set_case_interface_status");
    expect(fn).toContain("status_note = v_note,");
    expect(fn).not.toContain("status_note = coalesce(v_note, status_note)");
    // Reopening clears closed_at, so it demands a stated reason.
    expect(fn).toContain("i.status in ('delivered','closed')");
    expect(fn.toLowerCase()).toContain("reopening it clears the date");
  });

  it("the widened gate refusal names I.25 and carries no doubled quote", () => {
    // R10 (20261202090300): a refusal that names the wrong specification
    // section is a false sentence, and a false sentence is worse than none.
    expect(review).toContain("spec I.18, I.19, I.25");
    expect(review).toContain("frontline design ");
    // The remedy list is ONE dollar-quoted literal: the previous two-literal
    // concatenation re-opened the quote at the seam and rendered
    // "... / 'disposition_design_finding / ...".
    expect(review).not.toContain("'$new$ ||");
  });

  it("findings order by SEVERITY, not alphabetically", () => {
    // `order by f.severity` over text sorts blocking, minor, significant —
    // putting the least serious recommendation above the more serious one in
    // the very list a gate refusal prints.
    expect(review).not.toContain("order by f.severity, f.finding_ref");
    const occurrences =
      review.split(
        "array_position(array['blocking','significant','minor'], f.severity)",
      ).length - 1;
    expect(occurrences).toBe(2);
  });
});

/* ── 5B-R13 — the shared graph has no dangling endpoint ────────────────── */

describe("the shared graph emits no edge whose far endpoint is not a node", () => {
  it("both ends of every asset dependency are resolved into the node set", () => {
    // The asset edges are selected on EITHER endpoint matching an interface
    // asset, so the far endpoint is often an asset no interface names. Left
    // out of `nodes`, the client back-filled `{id, name: id}` — a real asset
    // shown as a bare UUID, and, substantively, a node with no criticality and
    // no service name, so `underrated` and `servicesLost` could never fire
    // across the interface→asset join D4.18 exists to enable.
    const fn = body(interfaces, "get_case_interface_graph");
    const nodesAt = fn.indexOf("into v_nodes");
    const idsAt = fn.indexOf("into v_asset_ids");
    expect(idsAt).toBeGreaterThan(-1);
    expect(nodesAt).toBeGreaterThan(idsAt);
    expect(fn).toContain(
      "join assets a on a.id in (ad.dependent_asset_id, ad.supplier_asset_id)",
    );
    expect(fn).toContain(
      "select a.id::text, a.name, a.asset_tag, a.criticality",
    );
  });
});

/* ── D4.10/D4.11 — consequence rides the SHIPPED blocker machinery ─────── */

describe("consequence: ONE predicate, and no second evaluator (ruling 5)", () => {
  it("the predicate names the three blocker families", () => {
    const fn = body(review, "case_frontline_design_obligations");
    for (const t of [
      "frontline_finding_open",
      "frontline_acceptance_uncarried",
      "frontline_review_unattended",
    ]) {
      expect(fn).toContain(`'${t}'`);
    }
  });

  it("it is APPENDED to the shipped predicate by transformation, and RAISES if the anchor is gone", () => {
    // The whole point: get_gate_readiness renders it without a second query,
    // because the readiness screen reads the same function the wall refuses
    // over.
    expect(review).toContain("case_gate_outstanding_obligations");
    expect(review).toContain(
      "v_out := v_out || case_frontline_design_obligations(c.id);",
    );
    expect(review).toContain("do not append blind");
    // A parallel gate evaluator would be the forbidden move, so nothing here
    // may define one.
    expect(executable).not.toContain(
      "create or replace function public.get_gate_readiness",
    );
    expect(executable).not.toContain(
      "create or replace function public.record_case_gate_review",
    );
    expect(executable).not.toContain(
      "create or replace function public.assessgate",
    );
  });

  it("the persistence wall's refused-type list gains the three families, by transformation", () => {
    expect(review).toContain("enforce_gate_review_outstanding_obligations");
    expect(review).toContain("do not widen a wall blind");
    expect(review).toContain(
      "'frontline_finding_open', 'frontline_acceptance_uncarried'",
    );
    // The two families the wall already refused over are preserved verbatim.
    expect(review).toContain("'regulatory_condition', 'uncovered_commitment'");
  });

  it("the predicate's dual-caller gate is auth.uid(), never the dead current_user form", () => {
    const fn = body(review, "case_frontline_design_obligations");
    expect(fn).toContain(
      "if auth.uid() is not null and v_caller_org is null then",
    );
    expect(rawJoined).not.toContain(
      "current_user in ('authenticated', 'anon')",
    );
  });

  it("/design is scoped to the project side before the first drift", () => {
    expect(review).toContain("case studies are counted on the case");
    expect(review).toContain("get_project_posture");
  });
});

/* ───────────────── refusal-first reads (standing constraint 3) ────────── */

describe("the reads refuse rather than reporting a comfortable zero", () => {
  it("get_case_frontline_review refuses over no review AND over no findings", () => {
    const fn = body(review, "get_case_frontline_review");
    expect(fn).toContain("if v_study_n = 0 then");
    expect(fn).toContain("elsif v_finding_n = 0 then");
    expect(fn.toLowerCase()).toContain("never as zero open findings");
    // ...and the counts are NULL when it refused, not 0.
    expect(fn).toContain("'findingCount', case when v_refused then null");
    expect(fn).toContain("'openFindingCount', case when v_refused then null");
  });

  it("the interface read refuses over an empty register and nulls its counts", () => {
    const fn = body(interfaces, "get_case_interface_graph");
    expect(fn).toContain("if v_total = 0 then");
    expect(fn).toContain("'overdueCount', case when v_refused then null");
    expect(fn.toLowerCase()).toContain("critical brownfield");
  });
});

/* ───────────────────── D4.12 — six-axis scoring ───────────────────────── */

describe("D4.12 — spec I.26's six axes", () => {
  it("names all six server-side, and TypeScript agrees, in the spec's order", () => {
    const fn = body(scoring, "sync_design_axes");
    for (const a of DESIGN_AXES) expect(fn).toContain(`'${a.key}'`);
    expect(DESIGN_AXES.map((a) => a.key)).toEqual([
      "design_readiness",
      "constructability",
      "operability",
      "maintainability",
      "reliability",
      "commissionability",
    ]);
  });

  it("the 1-5 scale is pinned on both sides", () => {
    const fn = body(scoring, "sync_design_axis_scale");
    expect(fn).toContain(`'min', ${DESIGN_AXIS_SCALE.min}`);
    expect(fn).toContain(`'max', ${DESIGN_AXIS_SCALE.max}`);
    expect(scoring).toContain("check (score between 1 and 5)");
  });

  it("a basis is mandatory at the column, not only at the door", () => {
    expect(scoring).toContain(
      "basis text not null check (length(btrim(basis)) >= 20)",
    );
  });

  it("the composite REFUSES on any missing axis and never averages a subset", () => {
    const fn = body(scoring, "get_case_design_scorecard");
    expect(fn).toContain("v_refused := v_missing is not null;");
    expect(fn).toContain("if not v_refused then");
    // The average is computed ONLY inside the not-refused branch.
    const guarded = fn.slice(fn.indexOf("if not v_refused then"));
    expect(guarded).toContain("round(avg(latest.score)::numeric, 2)");
    expect(fn.toLowerCase()).toContain(
      "the mean of the axes that do have scores is deliberately not reported",
    );
  });

  it("scores are append-only and a re-score supersedes", () => {
    expect(scoring).toContain("unique (development_case_id, axis, score_no)");
    expect(body(scoring, "score_design_axis")).toContain(
      "coalesce(max(score_no), 0) + 1",
    );
  });

  it("the lineage key is pinned and the REFUSED run is recorded too (D11.29)", () => {
    expect(scoring).toContain(
      "('case_design_scorecard',          'develop-design/5B/2026-12-05')",
    );
    const fn = body(scoring, "compute_case_design_scorecard");
    expect(fn).toContain("record_calculation_run(");
    // outputs null + refusals populated when it refused.
    expect(fn).toContain("then null\n      else jsonb_build_object(");
    expect(fn).toContain("then jsonb_build_array(v_result->>'refusal')");
  });

  it("every key the re-created version registry pins is still one a compute function records", () => {
    const pinned = [
      ...scoring.matchAll(/\('(case_[a-z_]+)',\s*'develop-[^']+'\)/g),
    ].map((m) => m[1]);
    // The re-creation must not silently drop a prior slice's key.
    expect(pinned.length).toBeGreaterThanOrEqual(16);
    for (const key of [
      "case_scope_growth",
      "case_earned_value",
      "case_schedule_quality",
      "case_contingency_consumption",
      "case_requirement_traceability",
      "case_design_scorecard",
    ]) {
      expect(pinned, `${key} was dropped from the version registry`).toContain(
        key,
      );
    }
  });
});

/* ───────────────────── D4.18 — the §19 Interface ──────────────────────── */

describe("D4.18 — spec III.§19's seven types on the shared graph", () => {
  it("names all seven types server-side, and TypeScript agrees", () => {
    const fn = body(interfaces, "sync_interface_types");
    for (const t of INTERFACE_TYPES) expect(fn).toContain(`'${t.key}'`);
    expect(INTERFACE_TYPES).toHaveLength(7);
  });

  it("the five statuses are pinned on both sides", () => {
    const fn = body(interfaces, "sync_interface_statuses");
    for (const s of INTERFACE_STATUSES) expect(fn).toContain(`'${s.key}'`);
  });

  it("every type maps to a traversal kind, and the mapping is EMITTED on the edge", () => {
    const fn = body(interfaces, "sync_interface_traversal_kind");
    for (const t of INTERFACE_TYPES) expect(fn).toContain(`('${t.key}',`);
    const read = body(interfaces, "get_case_interface_graph");
    expect(read).toContain(
      "'kind', sync_interface_traversal_kind(i.interface_type)",
    );
    expect(read).toContain("'interfaceType', i.interface_type");
  });

  it("does NOT start a second graph: it emits asset_dependencies edges into the SAME payload", () => {
    const read = body(interfaces, "get_case_interface_graph");
    expect(read).toContain("from asset_dependencies ad");
    expect(read).toContain("'source', 'asset_dependency'");
    expect(read).toContain("'source', 'interface'");
    expect(read).toContain(
      "'edges', coalesce(v_edges, '[]'::jsonb) || coalesce(v_asset_edges, '[]'::jsonb)",
    );
    // ...and it does not create, alter or weaken asset_dependencies. The
    // whole ruling turns on that table being left exactly as it is: the
    // obvious build (put the §19 columns on it) would have required dropping
    // its NOT NULL endpoint FKs, which is the widened guard this repository
    // refuses by name.
    const executableInterfaces = interfaces
      .replace(/comment on [\s\S]*?';/g, " ")
      .toLowerCase();
    expect(executableInterfaces).not.toContain("asset_dependencies\n  add");
    expect(executableInterfaces).not.toContain(
      "alter table public.asset_dependencies",
    );
    expect(executableInterfaces).not.toContain(
      "alter table asset_dependencies",
    );
    expect(executableInterfaces).not.toContain("drop not null");
    expect(executableInterfaces).not.toContain("drop constraint");
  });

  it("overdue is DERIVED at read time and never stored", () => {
    expect(interfaces).not.toMatch(/\boverdue\s+boolean/);
    const read = body(interfaces, "get_case_interface_graph");
    expect(read).toContain(
      "'overdue', i.due_date is not null and i.due_date < current_date",
    );
  });

  it("the owner is mandatory and the endpoints must differ", () => {
    expect(interfaces).toContain(
      "owner_id uuid not null references auth.users(id)",
    );
    expect(interfaces).toContain("case_interface_endpoints_distinct");
  });

  it("a closed interface leaves the graph", () => {
    const read = body(interfaces, "get_case_interface_graph");
    expect(read).toContain("and i.status not in ('closed')");
  });
});

/* ─────────────────────────── §70 and the walls ────────────────────────── */

describe("§70 — no machine attends, raises, dispositions, scores or owns", () => {
  it("ONE wall function, parameterised, covering INSERT and UPDATE", () => {
    const fn = body(review, "enforce_frontline_judgement_is_human");
    expect(fn).toContain("v_col text := tg_argv[0]");
    expect(fn).toContain("if tg_op = 'UPDATE'");
    expect(fn).toContain("coalesce(v_role, '') = 'ai_admin'");
    expect(fn).toContain("spec §70");
  });

  it("is bound to all five actor columns across the slice", () => {
    for (const [file, col] of [
      [review, "'recorded_by'"],
      [review, "'participant_id'"],
      [review, "'raised_by'"],
      [review, "'dispositioned_by'"],
      [scoring, "'scored_by'"],
      [interfaces, "'owner_id'"],
    ] as [string, string][]) {
      expect(file).toContain(
        `execute function public.enforce_frontline_judgement_is_human(\n    ${col}`,
      );
    }
  });

  it("every RPC door refuses the AI-operator identity by name", () => {
    for (const fn of [
      "record_case_design_study",
      "add_design_study_participant",
      "raise_design_review_finding",
      "disposition_design_finding",
    ]) {
      expect(body(review, fn), `${fn} admits ai_admin`).toContain(
        "coalesce(v_role, '') = 'ai_admin'",
      );
    }
    expect(body(scoring, "score_design_axis")).toContain(
      "coalesce(v_role, '') = 'ai_admin'",
    );
    expect(body(interfaces, "record_case_interface")).toContain(
      "v_owner_role = 'ai_admin'",
    );
  });

  it("the frontline acts admit the roles that actually do the work", () => {
    // A design review whose findings only a manager may type is not a
    // frontline design review.
    for (const fn of [
      "add_design_study_participant",
      "raise_design_review_finding",
      "disposition_design_finding",
    ]) {
      expect(body(review, fn)).toContain("'supervisor','technician'");
    }
  });
});

describe("the ledgers are append-only for every caller", () => {
  it("TRUNCATE is revoked and refused at statement level on all four tables", () => {
    for (const t of [
      "design_review_findings",
      "design_finding_dispositions",
      "design_study_participants",
      "design_axis_scores",
      "case_interfaces",
    ]) {
      expect(joined).toContain(
        `revoke truncate on table public.${t} from anon, authenticated, service_role;`,
      );
      expect(joined).toMatch(
        new RegExp(`before truncate on public\\.${t}\\s+for each statement`),
      );
    }
  });

  it("DELETE is refused except mid-cascade, on every one of them", () => {
    for (const [file, fn] of [
      [review, "enforce_design_finding_immutable"],
      [review, "enforce_disposition_integrity"],
      [review, "enforce_design_participant_immutable"],
      [scoring, "enforce_axis_score_integrity"],
      [interfaces, "enforce_case_interface_integrity"],
    ] as [string, string][]) {
      const b = body(file, fn);
      expect(b, `${fn} has no DELETE branch`).toContain("if tg_op = 'DELETE'");
      expect(b, `${fn} has no mid-cascade escape`).toContain(
        "from organizations where id = old.organization_id",
      );
    }
  });

  it("what was said, by whom, cannot be rewritten — including by the service path", () => {
    expect(body(review, "enforce_disposition_integrity")).toContain(
      "new.outcome is distinct from old.outcome",
    );
    expect(body(review, "enforce_design_finding_immutable")).toContain(
      "new.recommendation is distinct from old.recommendation",
    );
    expect(body(scoring, "enforce_axis_score_integrity")).toContain(
      "new.score is distinct from old.score",
    );
    expect(body(interfaces, "enforce_case_interface_integrity")).toContain(
      "new.interface_type is distinct from old.interface_type",
    );
  });

  it("every new table is org-scoped with RLS in the same migration and no client write policy", () => {
    for (const t of [
      "design_study_participants",
      "design_review_findings",
      "design_finding_dispositions",
      "design_axis_scores",
      "case_interfaces",
    ]) {
      expect(joined).toContain(
        `alter table public.${t} enable row level security`,
      );
      expect(joined).toMatch(
        new RegExp(
          `on public\\.${t}\\s+for select to authenticated using \\(organization_id = app_current_org\\(\\)\\)`,
        ),
      );
      expect(joined).not.toMatch(
        new RegExp(
          `on public\\.${t}\\s+for (insert|update|delete) to authenticated`,
        ),
      );
    }
  });

  it("every trigger function is definer and search_path-pinned like its siblings", () => {
    const fns = [
      ...joined.matchAll(
        /create or replace function public\.(enforce_[a-z_]+|refresh_[a-z_]+)\(\)\s+returns trigger\s+language plpgsql\s+(security definer)\s+(set search_path = public)/g,
      ),
    ];
    expect(fns.length).toBeGreaterThanOrEqual(8);
  });

  it("every definer RPC is revoked from anon before it is granted", () => {
    for (const fn of [
      "record_case_design_study(uuid, jsonb)",
      "add_design_study_participant(bigint, jsonb)",
      "raise_design_review_finding(bigint, jsonb)",
      "disposition_design_finding(bigint, jsonb)",
      "carry_design_finding_to_requirement(bigint, bigint)",
      "score_design_axis(uuid, jsonb)",
      "record_case_interface(uuid, jsonb)",
      "set_case_interface_status(bigint, text, text)",
    ]) {
      expect(joined).toContain(
        `revoke all on function public.${fn} from public, anon;`,
      );
    }
  });
});

/* ───────────────────────── what is NOT claimed ────────────────────────── */

describe("the deferrals are stated, not silent", () => {
  it("names the gate consequence this slice deliberately does not take", () => {
    // The ABSENCE of a review does not block a gate: that is a governance
    // intensity decision (D3.16), and taking it here would re-decide another
    // slice's contract from inside this one.
    expect(raw(REVIEW_FILE)).toContain("SCOPE, STATED RATHER THAN QUIET");
    expect(raw(INTERFACE_FILE)).toContain(
      "NO GATE CONSEQUENCE IS CLAIMED HERE",
    );
    expect(raw(SCORING_FILE)).toContain(
      "this file gives the scorecard NO gate consequence",
    );
  });

  it("states why the Interface is not a row on asset_dependencies", () => {
    const header = raw(INTERFACE_FILE);
    expect(header).toContain("are NOT NULL\n--   FKs to `assets`");
    expect(header).toContain("would require dropping those NOT NULLs");
    expect(header).toContain(
      "a failing guard is\n--   the answer, not the thing to widen",
    );
  });
});

/* ── 5B-R10 / R9 — the surface matches the server it talks to ──────────── */

describe("the frontline surface admits the frontline", () => {
  const panel = readFileSync(
    "src/components/develop/FrontlineDesignPanels.tsx",
    "utf8",
  );
  const page = readFileSync(
    "src/pages/DevelopmentCaseWorkspacePage.tsx",
    "utf8",
  );

  it("the three RPCs that admit supervisor and technician are gated on canFrontline, not canPlan", () => {
    // This slice is the ONLY place in the migration tree that admits
    // 'supervisor','technician' by name, and it does so deliberately: "a
    // design review whose findings only a manager may type is not a frontline
    // design review". Reusing the workspace's canPlan — which fits every other
    // panel — hid attendance, raising and dispositioning from exactly the
    // people D4.10 exists to give a voice.
    for (const [src, rpc] of [
      [review, "add_design_study_participant"],
      [review, "raise_design_review_finding"],
      [review, "disposition_design_finding"],
      // Operability and maintainability are precisely the axes the people who
      // will run and maintain the thing are qualified to score (I.26).
      [scoring, "score_design_axis"],
    ] as const) {
      const at = src.indexOf(`create or replace function public.${rpc}(`);
      expect(at, rpc).toBeGreaterThan(-1);
      const fn = src.slice(at, src.indexOf("\n$$;", at));
      expect(fn, rpc).toContain("'supervisor','technician'");
    }
    expect(page).toContain('"supervisor"');
    expect(page).toContain('"technician"');
    expect(page).toContain("const FRONTLINE_ROLES = [");
    expect(panel).toContain("canFrontline: boolean;");
    // The three frontline controls hang off canFrontline.
    expect(panel).toContain("{canFrontline ? (");
    expect(panel).toContain("setParticipantFor(");
    expect(panel).toContain("setDispositionFor(");
    // ...and so does axis scoring, whose RPC admits the same two roles.
    const axisAt = panel.indexOf("value={scoreForm.axis}");
    expect(axisAt).toBeGreaterThan(-1);
    expect(
      panel.slice(0, axisAt).lastIndexOf("{canFrontline ? ("),
    ).toBeGreaterThan(panel.slice(0, axisAt).lastIndexOf("{canPlan ? ("));
  });

  it("the AI-operator identity is offered none of the acts §70 refuses it", () => {
    // Every one of these doors refuses ai_admin by name, so rendering it the
    // forms only offers an act the server will reject.
    const frontline = page.slice(
      page.indexOf("const FRONTLINE_ROLES = ["),
      page.indexOf("const DESIGN_PLAN_ROLES = ["),
    );
    expect(frontline).not.toContain("ai_admin");
    const designPlan = page.slice(page.indexOf("const DESIGN_PLAN_ROLES = ["));
    expect(designPlan.slice(0, 200)).not.toContain("ai_admin");
    expect(page).toContain("canPlan={canDesignPlan}");
  });

  it("the panel READS the scorecard on mount and RECORDS a run only on an act", () => {
    // compute_case_design_scorecard appends a calculation_runs row every call
    // and carries a narrower role set than the read, so calling it from load()
    // logged a lineage row per page view AND made the whole panel throw for a
    // supervisor or technician — the Promise.all rejects and review,
    // interfaces, requirements and assets all stay null.
    const load = panel.slice(
      panel.indexOf("const load = useCallback"),
      panel.indexOf("useEffect(() => {"),
    );
    expect(load).toContain("getCaseDesignScorecard(caseId)");
    expect(load).not.toContain("computeCaseDesignScorecard(caseId)");
    expect(panel).toContain(
      "onClick={() => void run(() => computeCaseDesignScorecard(caseId))}",
    );
  });

  it("every blocker family the wall refuses over is declared and labelled client-side", () => {
    const lib = readFileSync("src/lib/develop/index.ts", "utf8");
    const gate = readFileSync("src/pages/GateReviewPage.tsx", "utf8");
    for (const t of [
      "frontline_finding_open",
      "frontline_acceptance_uncarried",
      "frontline_acceptance_carried_by_failed_requirement",
      "frontline_review_unattended",
    ]) {
      expect(lib, t).toContain(`type: "${t}"`);
      expect(gate, t).toContain(t);
    }
  });
});
