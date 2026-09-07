/**
 * Sync Develop Slice 7A — migration contract (static, no database).
 *
 * Every sibling slice ships one of these, and 5D shipped without one: six
 * defects in its migration text got past a live transcript as a direct result.
 *
 * THIS CHUNK OPENED WITH THREE LIVE WORK-GROUPING MODELS AND TWO CONSTRAINT
 * FAMILIES ALREADY IN THE TREE, so the clauses below are the ones whose
 * absence would not show up as a failing transcript step:
 *
 *   * a FOURTH work store, or a THIRD constraint family — the defect this
 *     programme has found in six consecutive chunks;
 *   * a chain that is typed in the RPC and not at the DATABASE, so a second
 *     writer skips a level;
 *   * the satisfied-requires-verifier rule weakened, or the event anchor
 *     merely dropped instead of generalized;
 *   * a §70 wall that loses its UPDATE branch, or is bound to a column that
 *     does not exist;
 *   * a release that reports "0 open constraints" for a package nobody
 *     assessed;
 *   * a burn-down that recomputes its own past;
 *   * the portfolio constraint-free ratio (D7.08/D7.20) built here as well,
 *     which would be two implementations of one number before the row that
 *     owns it is opened;
 *   * the TypeScript vocabulary drifting from the SQL one.
 *
 * A later edit that re-opens one of those fails HERE, before it reaches a
 * database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  AWP_CHAIN,
  AWP_PACKAGE_TYPES,
  BURNDOWN_FORECASTS,
  CONSTRAINT_KINDS_NOT_HAND_CLEARABLE,
  CONSTRAINT_STATES,
  SPEC28_CONSTRAINT_TYPES,
  SPEC28_TO_CANONICAL_KIND,
  WORK_PACKAGE_STATUSES,
} from "../lib/develop/workPackaging";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const PACKAGE_FILE = "20261210090000_develop_work_package_object.sql";
const CONSTRAINT_FILE = "20261210090100_develop_constraint_object.sql";
const BURNDOWN_FILE = "20261210090200_develop_constraint_burndown.sql";
const SLICE_FILES = [PACKAGE_FILE, CONSTRAINT_FILE, BURNDOWN_FILE];

/** The 2026-09-21 file the Constraint ruling adopts rather than replaces. */
const RECOVERY_FILE = "20260921090000_sync_recovery.sql";

const pkg = read(PACKAGE_FILE);
const constraint = read(CONSTRAINT_FILE);
const burndown = read(BURNDOWN_FILE);
const joined = SLICE_FILES.map(read).join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");
const recovery = read(RECOVERY_FILE);

function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n$$;", at);
  return source.slice(at, end === -1 ? undefined : end);
}

function table(source: string, name: string): string {
  const at = source.indexOf(`create table if not exists public.${name} (`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n);", at);
  return source.slice(at, end === -1 ? undefined : end);
}

function trigger(source: string, name: string): string {
  const at = source.indexOf(`create trigger ${name}`);
  expect(at, `trigger ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", at);
  return source.slice(at, end === -1 ? undefined : end);
}

/** The values of a `check (... in ('a','b'))` list on a named column. */
function checkList(source: string, column: string): string[] {
  const re = new RegExp(
    `${column}\\s+text\\s+not\\s+null[^,]*?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`,
    "s",
  );
  const m = re.exec(source);
  expect(m, `no CHECK list for ${column}`).not.toBeNull();
  return [...(m as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map(
    (x) => x[1],
  );
}

/* ───────────────────────────── the rulings ──────────────────────────────── */

describe("Slice 7A — the ruling is written down before the schema", () => {
  it("orders strictly after Slice 6B", () => {
    for (const f of SLICE_FILES) {
      expect(f.slice(0, 14) > "20261209090500").toBe(true);
    }
  });

  it("states RULING 19 (§27) and names the three live work-grouping models", () => {
    expect(rawJoined).toContain("RULING 19");
    for (const name of [
      "work_orders",
      "restoration_event_work",
      "outage_work",
    ]) {
      expect(raw(PACKAGE_FILE)).toContain(name);
    }
    expect(raw(PACKAGE_FILE)).toContain("THE WORK IDENTITY");
    expect(raw(PACKAGE_FILE)).toContain("ALTERNATIVES REJECTED");
  });

  it("states RULING 20 (§28) and maps the spec's ten onto the canonical kinds", () => {
    expect(rawJoined).toContain("RULING 20");
    // The header carries the field-by-field map, in both directions, so a
    // reader can check the claim without opening the enum.
    for (const spec of SPEC28_CONSTRAINT_TYPES) {
      expect(raw(CONSTRAINT_FILE).toUpperCase()).toContain(spec.toUpperCase());
    }
    expect(raw(CONSTRAINT_FILE)).toContain("richer than the spec");
  });

  it("COUNTS the ruling honestly — a ruling is the one artefact no transcript checks", () => {
    // The ruling is deliverable #1 of this chunk and its first draft refuted
    // itself in a single sentence: "the spec's TEN types are a SUBSET of what
    // it already holds" immediately above a list stating that THREE of the ten
    // were added here. Three added means they were not a subset. The same
    // header then wrote "The other EIGHT kinds …" above a list of TEN — the
    // spelled-count-versus-list drift ci-develop-slice5d-smoke.sh was written
    // to catch. Nothing but this test stands between a wrong ruling and main.
    const header = raw(CONSTRAINT_FILE).slice(
      0,
      raw(CONSTRAINT_FILE).indexOf("\n\n-- ---"),
    );
    // The claim, stated as arithmetic that can be checked against the enum.
    expect(header).toContain("SEVEN of the spec's ten types already existed");
    expect(header).toContain("THREE are added here");
    expect(header).toContain("the ten are NOT a subset");
    expect(header).toContain("strict SUPERSET");
    // …and the arithmetic agrees with the live CHECK list.
    const kinds = [
      ...(
        /constraint_kind in \(([\s\S]*?)\)\s*\n\s*\)/.exec(
          constraint,
        ) as RegExpExecArray
      )[1].matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1]);
    const domain = kinds.filter((k) => k !== "other");
    expect(kinds).toHaveLength(21);
    expect(domain).toHaveLength(20);
    // Seven pre-existing + three added = the spec's ten, all present.
    const mapped = Object.values(SPEC28_TO_CANONICAL_KIND);
    expect(mapped).toHaveLength(10);
    for (const k of mapped) expect(domain).toContain(k);
    const added = ["drawing", "access", "scaffold"];
    expect(mapped.filter((k) => !added.includes(k))).toHaveLength(7);
    // The unmapped remainder is TEN, and the header must say TEN, not EIGHT.
    const unmapped = domain.filter((k) => !mapped.includes(k));
    expect(unmapped).toHaveLength(10);
    expect(header).toContain("The other TEN domain kinds");
    expect(header).not.toContain("The other EIGHT");
    expect(header).toContain(
      "Ten mapped + ten unmapped = the twenty counted above.",
    );
  });

  it("states RULING 21 (I.28) — no new burn-down table", () => {
    expect(raw(BURNDOWN_FILE)).toContain("RULING 21");
    expect(raw(BURNDOWN_FILE)).toContain("NO NEW BURN-DOWN TABLE");
    expect(raw(BURNDOWN_FILE)).toContain("calculation_runs");
  });
});

describe("Slice 7A — no fourth work store, no third constraint family", () => {
  it("creates exactly two tables, and both are the AWP context shape", () => {
    const created = [
      ...joined.matchAll(/create table if not exists public\.(\w+)/g),
    ].map((m) => m[1]);
    expect(created.sort()).toEqual(["work_package_work", "work_packages"]);
  });

  it("creates no second work, constraint or burn-down store", () => {
    // AGENTS invariant 8 and the overlap map's rulings 6 and 8. A table by any
    // of these names beside the canonical ones is the parallel track.
    for (const forbidden of [
      "work_items",
      "package_work_orders",
      "awp_packages",
      "iwp",
      "cwp",
      "ewp",
      "constraints",
      "package_constraints",
      "work_package_constraints",
      "constraint_burndown",
      "burndown_snapshots",
      "burn_down",
      "readiness_items",
    ]) {
      expect(
        joined,
        `a table named ${forbidden} would be the parallel store`,
      ).not.toMatch(new RegExp(`create table[^;]{0,80}\\b${forbidden}\\b`));
    }
  });

  it("copies no work_orders column onto the package — work_orders IS the work", () => {
    const t = table(pkg, "work_packages");
    for (const col of [
      "asset_id",
      "estimated_hours",
      "actual_hours",
      "assignee",
      "priority",
      "wo_number",
      "execution_status",
      "parts_ready",
      "downtime_hours",
    ]) {
      expect(t, `work_packages must not carry ${col}`).not.toContain(`${col} `);
    }
    // …and the membership table is the two-column shape its siblings use.
    const m = table(pkg, "work_package_work");
    expect(m).toContain(
      "work_package_id bigint not null references work_packages(id)",
    );
    expect(m).toContain(
      "work_order_id uuid not null references work_orders(id)",
    );
    expect(m).toContain("unique (work_package_id, work_order_id)");
  });

  it("EXTENDS the canonical constraint store rather than replacing it", () => {
    expect(constraint).toContain("alter table public.restoration_constraints");
    expect(constraint).toContain("add column if not exists work_package_id");
    expect(constraint).toContain("add column if not exists work_order_id");
    // …and does not drop or recreate it.
    expect(constraint).not.toMatch(/drop table[^;]*restoration_constraints/);
    expect(constraint).not.toMatch(/create table[^;]*restoration_constraints/);
  });

  it("reads the execution status from work_orders and never copies it", () => {
    const readBody = body(burndown, "get_case_work_packages");
    expect(readBody).toContain("'executionStatus', w.status");
    expect(readBody).toContain("join work_orders w on w.id = m.work_order_id");
  });
});

/* ──────────────────────── D7.10 — the typed chain ───────────────────────── */

describe("D7.10 — the AWP chain is typed and ordered AT THE DATABASE", () => {
  it("orders the five §27 types once, in sync_awp_level", () => {
    const levels = body(pkg, "sync_awp_level");
    AWP_CHAIN.forEach((type, i) => {
      expect(levels).toContain(`when '${type}'`);
      expect(levels).toMatch(
        new RegExp(`when '${type}'\\s*then\\s*${i + 1}\\b`),
      );
    });
  });

  it("gives each type exactly the parent one level up, in ONE function", () => {
    const parents = body(pkg, "sync_awp_parent_type");
    for (let i = 1; i < AWP_CHAIN.length; i += 1) {
      expect(parents).toMatch(
        new RegExp(`when '${AWP_CHAIN[i]}'\\s*then\\s*'${AWP_CHAIN[i - 1]}'`),
      );
    }
    // Engineering is the head: it is absent from the map, so the function
    // returns NULL for it.
    expect(parents).not.toContain("when 'engineering'");
  });

  it("enforces the chain in a TRIGGER, not only in the RPC", () => {
    // A rule that lives in the door is a rule a second writer does not meet.
    const t = trigger(pkg, "trg_work_package_chain");
    expect(t).toContain(
      "before insert or update or delete on public.work_packages",
    );
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain("sync_awp_level(new.package_type)");
    expect(wall).toContain("sync_awp_parent_type(new.package_type)");
  });

  it("refuses a skipped level and a wrong-typed parent BY NAME", () => {
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain("SKIPPED-LEVEL / WRONG-PARENT");
    expect(wall).toContain("p.package_type <> v_parent_type");
    expect(wall).toContain("sync_awp_level(p.package_type) <> v_level - 1");
  });

  it("refuses a head with a parent, a non-head without one, and a foreign parent", () => {
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain("hangs from nothing");
    expect(wall).toContain("names no parent");
    expect(wall).toContain(
      "in another organization or another development case",
    );
    expect(wall).toContain("cannot be its own parent");
  });

  it("refuses a package type it has no ordering for, rather than defaulting", () => {
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain("has no place in the AWP ordering");
  });

  it("validates the chain DOWNWARD too — a per-row check is not a chain check", () => {
    // THE CRITICAL DEFECT THIS PINS. Every arm above validates the row being
    // written against its PARENT. On INSERT that is the whole rule; on UPDATE
    // it is not. Re-typing or re-homing a package that ALREADY HAS CHILDREN
    // leaves those children holding a parent of the wrong type, at the wrong
    // level, or in another development case — verbatim the states the arms
    // above refuse to create, reached in two ordinary steps through
    // record_work_package's revise branch (build EWP → PWP → CWP, then
    // re-type the PWP to engineering). The database then held the exact row
    // the trigger says is impossible, the read rendered it as a well-formed
    // chain, and the child was WEDGED: every later UPDATE re-ran the parent
    // arm and raised, so it could no longer be released, cancelled or
    // repaired at all.
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain("if tg_op = 'UPDATE'");
    expect(wall).toContain(
      "new.package_type is distinct from old.package_type",
    );
    expect(wall).toContain(
      "new.development_case_id is distinct from old.development_case_id",
    );
    // It looks DOWN — at the rows whose parent this row is.
    expect(wall).toContain("where ch.parent_package_id = new.id");
    expect(wall).toContain(
      "sync_awp_parent_type(ch.package_type) is distinct from new.package_type",
    );
    expect(wall).toContain(
      "ch.development_case_id is distinct from new.development_case_id",
    );
    expect(wall).toContain(
      "SKIPPED-LEVEL / WRONG-PARENT / CROSS-CASE state stated from below",
    );
  });

  it("refuses a package code that already belongs to another case, rather than MOVING it", () => {
    // `work_packages` is `unique (organization_id, package_code)` — per ORG,
    // not per case — and the revise branch wrote `development_case_id = c.id`.
    // So recording "EWP-01" on case B when case A already had one did not
    // refuse and did not create: it MOVED case A's package, with its
    // constraints, its memberships and its release state, to case B. Case A's
    // read then named a parent its own people could not open, and the orphaned
    // child was permanently unwritable. "EWP-01" on two projects is the
    // default naming, not an exotic input.
    const door = body(pkg, "record_work_package");
    expect(door).toContain(
      "if v_revising and v_existing.development_case_id <> c.id then",
    );
    expect(door).toContain("already belongs to another development case");
    // …and the revise UPDATE does not carry development_case_id at all.
    const update = door.slice(door.indexOf("update work_packages"));
    expect(update.slice(0, update.indexOf("returning"))).not.toContain(
      "development_case_id =",
    );
  });

  it("keeps the TypeScript ordering pinned to the SQL ordering", () => {
    // A sixth type or a reordering landing on one side only is the drift this
    // assertion exists to make impossible.
    const levels = body(pkg, "sync_awp_level");
    const sqlOrder = [...levels.matchAll(/when '(\w+)'\s*then\s*(\d+)/g)]
      .sort((a, b) => Number(a[2]) - Number(b[2]))
      .map((m) => m[1]);
    expect(sqlOrder).toEqual([...AWP_PACKAGE_TYPES]);
    expect(
      checkList(table(pkg, "work_packages"), "package_type").sort(),
    ).toEqual([...AWP_PACKAGE_TYPES].sort());
    expect(checkList(table(pkg, "work_packages"), "status").sort()).toEqual(
      [...WORK_PACKAGE_STATUSES].sort(),
    );
  });
});

/* ─────────────────────── D7.18 — the §28 Constraint ─────────────────────── */

describe("D7.18 — the constraint store generalizes without weakening", () => {
  it("keeps the 2026-09-21 satisfied-requires-verifier rule untouched", () => {
    // The rule this slice adopts. If a later edit drops it from the original
    // migration OR overrides it here, both halves of this fail.
    expect(recovery).toContain(
      "check (state <> 'satisfied' or (verified_by is not null and verified_at is not null))",
    );
    expect(constraint).not.toMatch(
      /drop constraint[^;]*restoration_constraints_check\b/,
    );
    expect(constraint).not.toContain("state <> 'satisfied' or true");
  });

  it("replaces the NOT NULL anchor with an XOR, never with nothing", () => {
    // `alter column event_id drop not null` on its own would permit a
    // constraint anchored to NOTHING, which was impossible before.
    expect(constraint).toContain("alter column event_id drop not null");
    expect(constraint).toContain(
      "add constraint restoration_constraint_one_anchor check (\n    num_nonnulls(event_id, work_package_id) = 1)",
    );
  });

  it("preserves every pre-existing constraint kind and adds exactly three", () => {
    const before = [
      "precedence",
      "resource",
      "work_zone",
      "material",
      "labour",
      "tooling",
      "bay",
      "crane",
      "vendor",
      "weather",
      "production",
      "approval",
      "permit",
      "isolation",
      "asset_state",
      "quality_hold",
      "component_life",
      "other",
    ];
    const at = constraint.indexOf(
      "restoration_constraints_constraint_kind_check check",
    );
    expect(at).toBeGreaterThan(-1);
    const list = constraint.slice(at, constraint.indexOf(");", at));
    for (const kind of before) {
      expect(list, `kind ${kind} was dropped`).toContain(`'${kind}'`);
    }
    for (const added of ["drawing", "access", "scaffold"]) {
      expect(list).toContain(`'${added}'`);
    }
    const kinds = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(kinds).size).toBe(before.length + 3);
  });

  it("maps the spec's ten in ONE function, pinned to the TypeScript map", () => {
    const map = body(constraint, "sync_spec28_constraint_kind");
    for (const spec of SPEC28_CONSTRAINT_TYPES) {
      expect(map).toMatch(
        new RegExp(
          `when '${spec}'\\s*then\\s*'${SPEC28_TO_CANONICAL_KIND[spec]}'`,
        ),
      );
    }
    const sqlPairs = [...map.matchAll(/when '(\w+)'\s*then\s*'(\w+)'/g)].map(
      (m) => [m[1], m[2]] as const,
    );
    expect(sqlPairs).toHaveLength(SPEC28_CONSTRAINT_TYPES.length);
    expect(Object.fromEntries(sqlPairs)).toEqual(SPEC28_TO_CANONICAL_KIND);
  });

  it("keeps Recovery's permit / isolation / asset-state rule rather than exempting the project path", () => {
    const clear = body(constraint, "clear_package_constraint");
    for (const kind of CONSTRAINT_KINDS_NOT_HAND_CLEARABLE) {
      expect(clear).toContain(`'${kind}'`);
    }
    expect(clear).toContain("canonical operating and release controls");
    expect(recovery).toContain(
      "permit/isolation/asset-state truth must come from canonical operating/release controls",
    );
  });

  it("accepts only the four states the store has always had", () => {
    const clear = body(constraint, "clear_package_constraint");
    for (const state of CONSTRAINT_STATES) {
      expect(clear).toContain(`'${state}'`);
    }
  });

  it("answers every bad input with a REFUSAL, never with a raw Postgres error", () => {
    // DECLARE runs BEFORE the body, so an unwrapped cast there raises ahead of
    // the authorization gate: `is_hard: "maybe"` returned a raw 22P02 to a
    // caller who was not even authorized to record a constraint — internal
    // error shape where every other bad input gets a refusal. The contingency
    // ledger ruled on exactly this by name (20261203090000).
    const rawDoor = body(raw(CONSTRAINT_FILE), "record_package_constraint");
    const declare = rawDoor
      .slice(0, rawDoor.indexOf("\nbegin"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(declare).not.toMatch(/::\s*(boolean|int|numeric|date|uuid)\b/);
    const b = body(constraint, "record_package_constraint");
    // Parsed behind the role gate, and refused BY NAME.
    expect(
      b.indexOf(
        "requires a planning, engineering, supervisory or governance role",
      ),
    ).toBeLessThan(b.indexOf("v_hard := sync_text_as_boolean(v_hard_raw)"));
    expect(b).toContain("is_hard must be true or false");
  });

  it("distinguishes ABSENT from PRESENT-BUT-UNPARSEABLE, rather than discarding it", () => {
    // `sync_text_as_uuid` returns NULL on unparseable text, and the guards
    // below then skipped it as "not supplied". `work_order_id: "not-a-uuid"`
    // therefore returned SUCCESS with the work order silently dropped — the
    // §34 package-to-constraint edge column left NULL on a constraint the
    // caller believes names a job, and an owner-less constraint in the
    // burn-down that nobody can be asked to clear.
    const b = body(constraint, "record_package_constraint");
    expect(b).toContain("v_wo_raw text :=");
    expect(b).toContain("v_owner_raw text :=");
    expect(b).toContain("if v_wo_raw is not null then");
    expect(b).toContain("if v_owner_raw is not null then");
    expect(b).toContain('It is not treated as "no work order supplied"');
    expect(b).toContain("is not an identifier");
  });

  it("refuses non-finite and out-of-range forward numbers at the TABLE", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so a range check
    // alone does not keep NaN out and every downstream sum becomes NaN.
    expect(constraint).toContain("probability_of_clearance <> 'NaN'::numeric");
    expect(constraint).toContain("probability_of_clearance >= 0");
    expect(constraint).toContain("probability_of_clearance <= 1");
    expect(constraint).toContain("schedule_impact_days <> 'NaN'::numeric");
    expect(constraint).toContain("schedule_impact_days > '-Infinity'::numeric");
    expect(constraint).toContain("schedule_impact_days < 'Infinity'::numeric");
  });

  it("refuses a stated number with no stated basis, at the TABLE", () => {
    expect(constraint).toContain(
      "length(btrim(coalesce(probability_basis, ''))) >= 20",
    );
    expect(constraint).toContain(
      "length(btrim(coalesce(impact_basis, ''))) >= 10",
    );
  });

  it("closes the §34 edge at the column the audit named, and moves the ledger", () => {
    expect(constraint).toContain(
      "work_order_id uuid references work_orders(id)",
    );
    expect(constraint).toContain("sync_spec34_edges");
    expect(constraint).toContain("CORRECTED 20261210090100");
    // The catalogue is asked, not this file's own prose.
    expect(constraint).toContain("information_schema.columns");
    expect(constraint).toContain(
      "would be the false claim it exists to remove",
    );
  });
});

/* ──────────────────────────── §70 and the walls ─────────────────────────── */

describe("Slice 7A — §70 and the walls", () => {
  it("binds ONE human-only wall to both actor columns, on INSERT and UPDATE", () => {
    for (const [name, source, column] of [
      ["trg_work_package_release_human", pkg, "released_by"],
      ["trg_constraint_verifier_human", constraint, "verified_by"],
    ] as const) {
      const t = trigger(source, name);
      expect(t).toContain("before insert or update on");
      expect(t).toContain("enforce_awp_act_is_human(");
      expect(t).toContain(`'${column}'`);
    }
    const wall = body(pkg, "enforce_awp_act_is_human");
    // The 5B lesson: `to_jsonb(new)->>'<missing column>'` is NULL, not an
    // error, so a rename would switch the wall off while it stayed installed.
    expect(wall).toContain("if not (to_jsonb(new) ? v_col)");
    // The 6A lesson: an unresolvable identity is refused, not admitted.
    expect(wall).toContain("if v_role is null then");
    expect(wall).toContain("v_role = 'ai_admin'");
    expect(wall).toContain("organization_id = v_org");
  });

  it("scopes the verifier wall to THIS slice's rows, so Recovery's own callers still work", () => {
    // A guard bound to another module's rows is a guard that breaks the
    // caller it was not written for. The first draft bound this wall to EVERY
    // restoration_constraints row, including Recovery's event-anchored ones —
    // and `refresh_restoration_readiness` (20261001090000) and
    // `refresh_recovery_planning_inputs` (20261002100000) both name `ai_admin`
    // in their OWN authority list and both stamp `verified_by = auth.uid()`
    // on the DERIVED constraints they resolve to `satisfied` (they must: the
    // 2026-09-21 CHECK requires a verifier). An authorized ai_admin caller
    // therefore got an unhandled check_violation instead of a refusal, the
    // surrounding `delete … source_kind='derived'` rolled back with it, and
    // the event kept STALE derived constraints. It fired only when some
    // derived item happened to resolve satisfied, so it was intermittent, and
    // no Recovery smoke covers it — they all drive as a planner.
    const t = trigger(constraint, "trg_constraint_verifier_human");
    expect(t).toContain("when (new.work_package_id is not null)");
    // The two callers this scope protects still list ai_admin and still stamp
    // a verifier — if either changes, this pin should be revisited, not the
    // trigger silently widened.
    for (const [file, fn] of [
      [
        "20261001090000_sync_recovery_control_closeout.sql",
        "refresh_restoration_readiness",
      ],
      [
        "20261002100000_recovery_product_wiring.sql",
        "refresh_recovery_planning_inputs",
      ],
    ] as const) {
      const b = body(read(file), fn);
      expect(b).toContain("'ai_admin'");
      expect(b).toContain("verified_by");
    }
    // …and the residual is NAMED rather than absorbed: nobody may read §70 as
    // closed across the whole table.
    expect(rawJoined).toContain(
      "WHAT REMAINS OPEN, NAMED RATHER THAN ABSORBED",
    );
    // The residual has to name WHOSE identity the stamp records. "the calling
    // human" is FALSE on these rows and was the wording of the first draft:
    // both refresh RPCs admit `ai_admin`, so running one as the AI over an
    // event whose labour item resolves `satisfied` leaves that AI identity's
    // uid in `verified_by` (proven live). Scoping the wall to package rows is
    // correct, and the cost of the scope must be stated as it is.
    const residual = rawJoined.slice(
      rawJoined.indexOf("WHAT REMAINS OPEN, NAMED RATHER THAN ABSORBED"),
    );
    // Wrap-tolerant: this is a SQL comment block, so the phrase breaks across
    // `--    ` continuations and a literal match would pin the line width
    // rather than the claim.
    const unwrapped = residual.slice(0, 1600).replace(/\s*--\s*/g, " ");
    expect(unwrapped).toContain("the CALLING IDENTITY");
    expect(unwrapped).toMatch(/may itself be `ai_admin`/);
    expect(rawJoined).not.toMatch(/auto-stamps? the CALLING\s+--\s+human/);
    expect(rawJoined).not.toMatch(/stamp the calling human/i);
  });

  it("names §70's own words at the release door", () => {
    expect(rawJoined).toContain(
      "no AI or system identity releases a work package",
    );
    const release = body(constraint, "release_work_package");
    expect(release).toContain("§70");
  });

  it("freezes a released package's WORK and CONSTRAINTS on UPDATE, not only on DELETE", () => {
    // An UPDATE performs a removal and an addition in ONE statement, so a
    // freeze that named only INSERT/DELETE admitted exactly what the DELETE
    // arms refuse ("Removing it now rewrites what the release covered"): a
    // released package's membership re-pointed at a different work order, and
    // its hard constraint flipped back to `unknown`, re-pointed at another
    // package, or DETACHED to an event anchor — after which the package's own
    // burn-down answered "UNASSESSED" for work a named person had released.
    const membership = body(pkg, "enforce_work_package_work_integrity");
    expect(membership).toContain(
      "if p.released_at is not null and tg_op in ('INSERT', 'UPDATE')",
    );
    // OLD's package too: either end of a move rewrites what a release covered.
    expect(membership).toContain(
      "select * into old_p from work_packages where id = old.work_package_id",
    );

    const anchor = body(constraint, "enforce_constraint_anchor_integrity");
    expect(anchor).toContain(
      "if tg_op = 'UPDATE' and old.work_package_id is not null then",
    );
    for (const col of [
      "new.work_package_id is distinct from old.work_package_id",
      "new.event_id is distinct from old.event_id",
      "new.work_order_id is distinct from old.work_order_id",
      "new.is_hard is distinct from old.is_hard",
      "new.state is distinct from old.state",
      "new.required_by is distinct from old.required_by",
      "new.expected_clear_date is distinct from old.expected_clear_date",
    ]) {
      expect(anchor).toContain(col);
    }
  });

  it("refuses one work order in two packages at the SAME level", () => {
    // `unique(work_package_id, work_order_id)` allows multi-package
    // membership on purpose — the job named in the CWP is the job the IWP
    // installs, which is the AWP thread. It does NOT license two packages at
    // the same LEVEL: those are two independent release decisions over one
    // job, each checked against a constraint set the other cannot see, and
    // BOTH can be released. Two supervisors each told "READY — a named person
    // said so" for the same work, against disjoint evidence.
    const wall = body(pkg, "enforce_work_package_work_integrity");
    expect(wall).toContain(
      "sync_awp_level(p2.package_type) = sync_awp_level(p.package_type)",
    );
    expect(wall).toContain("which is at the same AWP level");
    // …and answered at the door as a refusal, not left to the exception.
    const door = body(pkg, "assign_work_to_package");
    expect(door).toContain(
      "sync_awp_level(p2.package_type) = sync_awp_level(p.package_type)",
    );
    expect(door).toContain("not to two at the same level");
  });

  it("covers INSERT, UPDATE and DELETE on every enforcement trigger", () => {
    for (const [name, source] of [
      ["trg_work_package_chain", pkg],
      ["trg_work_package_work_integrity", pkg],
      ["trg_constraint_anchor_integrity", constraint],
    ] as const) {
      expect(trigger(source, name)).toContain(
        "before insert or update or delete on",
      );
    }
  });

  it("guards TRUNCATE at the statement AND revokes the verb", () => {
    // A row-level trigger never fires for TRUNCATE (the 20261121090000
    // lesson), and one statement would erase the record.
    for (const [name, source] of [
      ["trg_work_package_no_truncate", pkg],
      ["trg_work_package_work_no_truncate", pkg],
      ["trg_constraint_no_truncate", constraint],
    ] as const) {
      expect(trigger(source, name)).toContain("before truncate on");
      expect(trigger(source, name)).toContain("for each statement");
    }
    for (const t of [
      "work_packages",
      "work_package_work",
      "restoration_constraints",
    ]) {
      expect(joined).toContain(
        `revoke truncate on table public.${t} from anon, authenticated, service_role`,
      );
    }
  });

  it("uses auth.uid() for the dual-caller gate, never current_user", () => {
    // `current_user in ('authenticated','anon')` is DEAD CODE inside a
    // SECURITY DEFINER: the function runs as its owner.
    for (const source of [pkg, constraint, burndown]) {
      expect(source).not.toMatch(
        /current_user\s+in\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/,
      );
    }
    expect(joined).toContain("if auth.uid() is null then");
  });

  it("leaves a provenance backstop on every admitted service path", () => {
    expect(pkg).toContain(
      "create or replace function public.record_awp_service_write",
    );
    expect(pkg).toContain("insert into security_events");
    for (const source of [pkg, constraint]) {
      expect(source).toContain("record_awp_service_write(");
    }
  });

  it("conditions the backstop on the CALLER, never on the forgeable marker", () => {
    // `app.work_package_write` / `app.package_constraint_write` are ordinary
    // custom GUCs, and any role that can reach these tables can `set_config`
    // them. A backstop written only when the marker was ABSENT could
    // therefore be switched off by the very service path it exists to record:
    // one set_config and the security_events row disappears while the write
    // lands. The marker still decides whether a CLIENT is refused; the
    // provenance row is written for every write that arrives with no
    // authenticated identity, marker or not.
    for (const fn of [
      body(pkg, "enforce_work_package_chain"),
      body(pkg, "enforce_work_package_work_integrity"),
      body(constraint, "enforce_constraint_anchor_integrity"),
    ]) {
      const backstop = fn.indexOf("perform record_awp_service_write(");
      expect(backstop).toBeGreaterThan(-1);
      // The nearest guard ABOVE each backstop call is the caller test, not a
      // marker test: `if auth.uid() is null then perform record_...`.
      for (const at of [
        ...fn.matchAll(/perform record_awp_service_write\(/g),
      ].map((m) => m.index as number)) {
        const before = fn.slice(0, at);
        const lastCaller = before.lastIndexOf("if auth.uid() is null then");
        const lastMarker = before.lastIndexOf("v_marker <> 'granted'");
        expect(lastCaller).toBeGreaterThan(-1);
        expect(lastCaller).toBeGreaterThan(lastMarker);
      }
    }
  });

  it("anchors the constraint marker door on coalesce(new, old) so a DETACH is recorded", () => {
    // Gating on NEW alone meant setting `work_package_id` to NULL — moving a
    // released package's constraint onto an event anchor — walked past the
    // door and left NO security_events row: the one act that empties a
    // released package's constraint set was the one act nothing recorded.
    const wall = body(constraint, "enforce_constraint_anchor_integrity");
    expect(wall).toContain(
      "v_anchor := coalesce(new.work_package_id, case when tg_op = 'UPDATE' then old.work_package_id end)",
    );
    expect(wall).toContain("if v_anchor is not null then");
    expect(wall).toContain("DETACHED from its work package");
  });

  it("enables RLS with an org read policy and no client write policy", () => {
    for (const name of ["work_packages", "work_package_work"]) {
      expect(pkg).toContain(
        `alter table public.${name} enable row level security`,
      );
      expect(pkg).toMatch(
        new RegExp(
          `create policy ${name}_read on public\\.${name}[\\s\\S]{0,200}organization_id = app_current_org\\(\\)`,
        ),
      );
      expect(pkg).not.toMatch(
        new RegExp(
          `create policy \\w+ on public\\.${name}\\s+for (insert|update|delete)`,
        ),
      );
    }
  });

  it("never reads FOUND after a PERFORM", () => {
    // THE DEFECT THIS SLICE'S OWN TRANSCRIPT CAUGHT ON ITS FIRST RUN.
    // `perform set_config(...)` sets FOUND, so `if found` after it reads the
    // marker call's result rather than the lookup's: record_work_package took
    // the UPDATE branch for a package that did not exist, updated nothing, and
    // returned a null work_package_id.
    const b = body(pkg, "record_work_package");
    expect(b).toContain("v_revising := found;");
    const marker =
      "perform set_config('app.work_package_write', 'granted', true);";
    const afterPerform = b.slice(b.indexOf(marker) + marker.length);
    expect(afterPerform.indexOf(marker)).toBe(-1);
    expect(afterPerform).not.toMatch(/\bif\s+found\b/);
    expect(afterPerform).not.toMatch(/\bif\s+not\s+found\b/);
  });

  it("audits every mutation with previous_state and new_state", () => {
    for (const fn of [
      "record_work_package",
      "assign_work_to_package",
      "record_package_constraint",
      "forecast_package_constraint",
      "clear_package_constraint",
      "release_work_package",
    ]) {
      const source = pkg.includes(`function public.${fn}(`) ? pkg : constraint;
      const b = body(source, fn);
      expect(b, `${fn} writes no audit row`).toContain(
        "insert into audit_events",
      );
      expect(b).toContain("previous_state, new_state");
    }
  });
});

/* ────────────────── D7.07 — forward, recorded, refusing ─────────────────── */

describe("D7.07 — the burn-down is forward-looking, recorded and refuses", () => {
  it("refuses a package with NO constraints recorded, rather than answering zero", () => {
    const b = body(burndown, "get_package_constraint_burndown");
    expect(b).toContain("if v_total = 0 then");
    expect(b).toContain("UNASSESSED");
    expect(b).toContain("read identically on a screen");
    // …and the release refuses over the same fact, through the ONE verdict.
    const verdict = body(constraint, "sync_work_package_release_verdict");
    expect(verdict).toContain("if v_total = 0 then");
    expect(verdict).toContain("UNASSESSED");
  });

  it("refuses a burn-down over an empty set", () => {
    const b = body(burndown, "get_package_constraint_burndown");
    expect(b).toContain("if v_open = 0 then");
    expect(b).toContain("empty set to project over");
    expect(b).toContain("if v_in_window = 0 then");
    expect(b).toContain("nothing to burn down");
  });

  it("refuses a horizon that projects nothing", () => {
    const b = body(burndown, "get_package_constraint_burndown");
    expect(b).toContain(
      "v_horizon is null or v_horizon <= 0 or v_horizon > 1825",
    );
  });

  it("classifies FORWARD, into the five honest buckets, and never assumes clear", () => {
    const b = body(burndown, "get_package_constraint_burndown");
    for (const bucket of BURNDOWN_FORECASTS) {
      expect(b).toContain(`'${bucket}'`);
    }
    // The forward comparison itself: expected clear against required by.
    expect(b).toContain("r.expected_clear_date > r.required_by");
    // A missing date is a named bucket, never a silent pass.
    expect(b).toContain("elsif r.expected_clear_date is null then");
    expect(b).toContain("if r.required_by is null then");
  });

  it("ASKS WHAT DAY IT IS — a lapsed forecast is not a clearance", () => {
    // The defect this pins: the classifier compared `expected_clear_date`
    // only against `required_by` and against the end of the horizon, never
    // against today. A still-OPEN constraint whose forecast clear date had
    // already passed therefore fell into `expected_clear`, and the projection
    // reported `forecastComplete: true` with a `projectedConstraintFreeDate`
    // in the PAST and an empty `refusals` array — for a package with an open
    // hard constraint. No adversarial write reaches it: a forecast recorded
    // today for ten days' time becomes this on day eleven.
    const b = body(burndown, "get_package_constraint_burndown");
    expect(b).toContain("v_today date := current_date");
    // Compared against TODAY, and asked BEFORE the required-by comparison —
    // the order is the fix, not just the presence of the branch.
    expect(b).toContain("elsif r.expected_clear_date < v_today then");
    const lapsedAt = b.indexOf("elsif r.expected_clear_date < v_today then");
    const requiredAt = b.indexOf(
      "elsif r.expected_clear_date > r.required_by then",
    );
    expect(lapsedAt).toBeGreaterThan(-1);
    expect(requiredAt).toBeGreaterThan(-1);
    expect(lapsedAt).toBeLessThan(requiredAt);
    // It counts into the completeness gate and suppresses the projected date.
    expect(b).toContain("v_lapsed := v_lapsed + 1");
    expect(b).toContain(
      "(v_unforecast = 0 and v_not_assessable = 0 and v_lapsed = 0)",
    );
    // …and it says so, rather than emitting a bare null.
    expect(b).toContain("when v_lapsed > 0");
    expect(b).toContain("a date in the past for work that is still blocked");
  });

  it("sums the stated impact of what BLOCKS, not of everything open", () => {
    // The key is `statedScheduleImpactDays` and the comment above it says
    // "what is forecast to block". The first draft filtered only on state,
    // with no bucket filter — so a package with one blocking constraint worth
    // 3 days and one clearing in time worth 5 reported 8 days of blocking
    // impact, and wrote that number into an immutable lineage row.
    const b = body(burndown, "get_package_constraint_burndown");
    expect(b).toContain(
      "if v_class in ('will_block', 'lapsed') and r.schedule_impact_days is not null then",
    );
    // NULL, not 0, when nothing blocking carries a stated impact: a zero
    // reads as "no impact" where the truth is "nobody stated one".
    expect(b).toContain("if not v_impact_seen then");
    expect(b).toContain("v_impact := null;");
  });

  it("refuses a projected constraint-free date over a partly-forecast set", () => {
    const b = body(burndown, "get_package_constraint_burndown");
    expect(b).toContain(
      "'forecastComplete',\n      (v_unforecast = 0 and v_not_assessable = 0 and v_lapsed = 0)",
    );
    expect(b).toContain("projectedConstraintFreeRefusal");
    expect(b).toContain("invented number wearing a calendar");
    // AND when the open set is soft-only: `v_latest` is computed over HARD
    // rows while the completeness counters count every open row, so a package
    // whose only open constraints are soft-and-forecast returned
    // `forecastComplete: true`, a null date and NO reason — the bare null
    // this file refuses everywhere else, which the panel printed as "not
    // stated".
    expect(b).toContain("when v_latest is null");
    expect(b).toContain(
      "no OPEN HARD constraint carries an expected clear date",
    );
  });

  it("records the projection in calculation_runs and nowhere else", () => {
    const b = body(burndown, "compute_package_constraint_burndown");
    expect(b).toContain("record_calculation_run(");
    expect(b).toContain("'package_constraint_burndown'");
    // The pinned key must be recorded by something, or the pin reads as
    // coverage that does not exist.
    expect(burndown).toContain("('package_constraint_burndown',");
    // No burn-down table anywhere in the slice.
    expect(joined).not.toMatch(/insert into \w*burndown\w*/i);
  });

  it("records REFUSALS as runs too, so a history cannot hide its gaps", () => {
    const b = body(burndown, "compute_package_constraint_burndown");
    expect(b).toContain("if (v_result->>'answered')::boolean is not true then");
    expect(b).toContain("A REFUSAL IS RECORDED TOO");
  });

  it("never rewrites its own past", () => {
    // calculation_runs is immutable by trigger (20261130090600); this slice
    // must not reach around it.
    expect(joined).not.toMatch(/update\s+calculation_runs/i);
    expect(joined).not.toMatch(/delete\s+from\s+calculation_runs/i);
    const history = body(burndown, "get_package_burndown_history");
    expect(history).toContain("'outputs', r.outputs");
    expect(history).toContain("Nothing here is recomputed from today");
    expect(history).toContain("if v_count = 0 then");
  });

  it("computes ONE projection — the recorded call reuses the read", () => {
    // Two implementations of "what will block this package" is the defect
    // this programme has found in six consecutive chunks.
    const compute = body(burndown, "compute_package_constraint_burndown");
    expect(compute).toContain(
      "get_package_constraint_burndown(p.id, p_horizon_days)",
    );
    const projections = [
      ...burndown.matchAll(/r\.expected_clear_date\s*>\s*r\.required_by/g),
    ];
    expect(projections).toHaveLength(1);
  });

  it("does NOT build the portfolio constraint-free ratio (D7.08/D7.20)", () => {
    // I.28's "63% of next month's planned construction is constraint-free" is
    // a portfolio ratio the register carries as D7.08/D7.20 ("one calc, two
    // rows"). Building it here as well would put two implementations of one
    // number in the tree before the row that owns it is opened.
    expect(joined).not.toMatch(/constraint_free_(pct|percent|index|ratio)/i);
    expect(joined).not.toMatch(/constraintFree(Pct|Percent|Index|Ratio)/);
    expect(raw(BURNDOWN_FILE)).toContain("D7.08");
    expect(raw(BURNDOWN_FILE)).toContain("D7.20");
  });

  it("keeps every previously pinned calculation key", () => {
    const pins = body(burndown, "sync_calculation_code_version");
    for (const key of [
      "case_scope_growth",
      "case_cost_reconciliation",
      "case_earned_value",
      "case_performance_trend",
      "case_progress_integrity",
      "case_estimate_confidence",
      "case_forecast_confidence",
      "case_schedule_quality",
      "case_schedule_simulation",
      "case_risk_schedule_economics",
      "case_contingency_consumption",
      "case_change_control",
      "case_decision_latency",
      "case_decision_debt",
      "case_requirement_traceability",
      "case_design_scorecard",
      "case_ram_profile",
      "case_procurement_position",
    ]) {
      expect(pins, `pinned key ${key} was dropped`).toContain(`('${key}',`);
    }
    // Existing versions are not bumped: a version bumped on unchanged code
    // stops meaning anything.
    expect(pins).toContain("'develop-controls/4A/2026-11-24'");
    expect(pins).toContain("'develop-procurement/6A/2026-12-08'");
    expect(pins).toContain("'develop-awp/7A/2026-12-10'");
  });
});

/* ─────────────────────── the release, refusal-first ─────────────────────── */

describe("D7.06/D7.17 — the release refuses before it reports", () => {
  it("refuses an unassessed package, an empty one, an unreleased parent, a cancelled one and open hard constraints", () => {
    const v = body(constraint, "sync_work_package_release_verdict");
    expect(v).toContain(
      "UNASSESSED — no constraint has been recorded against work package",
    );
    expect(v).toContain("contains no work orders");
    expect(v).toContain("which is not released");
    expect(v).toContain("A cancelled work package is not released");
    expect(v).toContain("NOT READY:");
    expect(v).toContain("state in ('unknown', 'blocked')");
    // It NAMES the open constraints rather than returning a count alone.
    expect(v).toContain("'openConstraints', v_open");
  });

  it("states the verdict ONCE — the screen cannot read as ready where the door refuses", () => {
    // THE PROGRAMME'S SIGNATURE DEFECT, in the code written to prevent it.
    // `get_case_work_packages` carried its own inline `case` expression over
    // TWO of the door's conditions, under a comment claiming it was "stated
    // by the same rules release_work_package refuses through — never a second
    // verdict". It missed empty, unreleased-parent and cancelled, so the
    // screen printed "Every hard constraint is cleared; release is a §70
    // human act and has not been performed" for three states the door
    // refuses — the weaker copy on the surface a supervisor acts on.
    const door = body(constraint, "release_work_package");
    const read = body(burndown, "get_case_work_packages");

    // Both consume the one predicate…
    expect(door).toContain(
      "v_verdict := sync_work_package_release_verdict(p.id)",
    );
    expect(door).toContain(
      "if (v_verdict->>'canRelease')::boolean is not true then",
    );
    expect(door).toContain("jsonb_build_object('error', v_verdict->>'reason'");
    expect(read).toContain(
      "sync_work_package_release_verdict(p.id) as verdict",
    );
    expect(read).toContain("'readiness', v.verdict->>'reason'");
    expect(read).toContain("'canRelease', (v.verdict->>'canRelease')::boolean");
    // …and the counts a person reads come from it too, not re-typed beside it.
    expect(read).toContain(
      "'recorded', (v.verdict->>'constraintsRecorded')::int",
    );
    expect(read).toContain("'openHard', (v.verdict->>'openHard')::int");

    // …and NEITHER restates a readiness rule of its own. Every readiness
    // sentence lives in the predicate; a second copy anywhere is the defect.
    for (const sentence of [
      "contains no work orders",
      "which is not released",
      "No constraint has been recorded against work package",
      "A cancelled work package is not released",
      "NOT READY:",
    ]) {
      expect(door).not.toContain(sentence);
      expect(read).not.toContain(sentence);
    }
    // The open-hard predicate itself is written once, in the verdict.
    expect(door).not.toContain("state in ('unknown', 'blocked')");
    expect(read).not.toContain("state in ('unknown', 'blocked')");
  });

  it("reports the parent's ACTUAL type, with a divergence flag", () => {
    // `parentType` was `sync_awp_parent_type(p.package_type)` — the type the
    // parent OUGHT to be — while the parent row was joined and only its code
    // read. That read could not report a mismatch under ANY circumstances: it
    // rendered a broken chain as a well-typed one, printing "under QA-P1
    // (procurement)" over a QA-P1 that is engineering.
    const read = body(burndown, "get_case_work_packages");
    expect(read).toContain("'parentType', parent.package_type");
    expect(read).toContain(
      "'parentTypeExpected', sync_awp_parent_type(p.package_type)",
    );
    expect(read).toContain("'parentTypeDiverges'");
    expect(read).toContain(
      "parent.package_type is distinct from sync_awp_parent_type(p.package_type)",
    );
  });

  it("offers the cancellation three refusals tell the reader to use", () => {
    // Three refusals in this slice say "Cancel it instead" / "Cancel the
    // package instead". A remedy a product names and does not offer is not a
    // remedy: without this door the only route to `cancelled` was a superuser
    // UPDATE, and a released package that should not proceed had no exit.
    expect(joined).toContain("Cancel it instead.");
    expect(joined).toContain("Cancel the package instead.");
    const c = body(pkg, "cancel_work_package");
    // The RELEASE role list, not the wider recording one: an AI may not undo
    // a person's release any more than it may make one.
    expect(c).toContain(
      "'admin', 'executive', 'maintenance_manager', 'supervisor'",
    );
    expect(c).not.toContain("'ai_admin'");
    expect(c).toContain("say why this package is being withdrawn");
    // No live child left hanging from a withdrawn parent.
    expect(c).toContain(
      "ch.parent_package_id = p.id and ch.status <> 'cancelled'",
    );
    // The release record is PRESERVED, not erased.
    expect(c).toContain("The release record is UNCHANGED");
    expect(c).toContain("insert into audit_events");
    // …and every status the CHECK admits is reachable through a door.
    const t = table(pkg, "work_packages");
    for (const s of WORK_PACKAGE_STATUSES) expect(t).toContain(`'${s}'`);
    expect(checkList(pkg, "status")).toEqual([...WORK_PACKAGE_STATUSES]);
  });

  it("says 'its parent is released' only where a parent exists", () => {
    // The success note asserted "its parent is released" on every release,
    // including head (engineering) packages, which have no parent — a claim
    // about a row that does not exist.
    for (const b of [
      body(constraint, "release_work_package"),
      body(constraint, "sync_work_package_release_verdict"),
    ]) {
      expect(b).toContain("case when p.parent_package_id is not null");
      expect(b).toContain("it is the head of its chain");
    }
  });

  it("reports the number of history rows handed back, not the number asked for", () => {
    const b = body(burndown, "get_package_burndown_history");
    expect(b).toContain("'returned', jsonb_array_length(v_runs)");
    expect(b).not.toContain("'returned', v_limit");
  });

  it("checks the role before the constraints, and excludes ai_admin", () => {
    const b = body(constraint, "release_work_package");
    expect(b).toContain(
      "'admin', 'executive', 'maintenance_manager', 'supervisor'",
    );
    expect(b).not.toContain("'ai_admin'");
  });

  it("freezes a released package for every writer", () => {
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain(
      "if tg_op = 'UPDATE' and old.released_at is not null then",
    );
    expect(wall).toContain("new.scope is distinct from old.scope");
    expect(wall).toContain("A released package is not deleted");
  });

  it("cannot be born released", () => {
    const wall = body(pkg, "enforce_work_package_chain");
    expect(wall).toContain(
      "if tg_op = 'INSERT' and new.released_at is not null then",
    );
    const t = table(pkg, "work_packages");
    // Two equalities, not a conjunction — the 6A commitment-line lesson.
    expect(t).toContain("(released_at is null) = (released_by is null)");
    expect(t).toContain("(released_at is null) = (release_note is null)");
  });
});
