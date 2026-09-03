/**
 * Sync Develop Slice 7B — ONE field-readiness engine, two doors.
 *
 * WHAT THIS FILE IS FOR. The chunk's whole risk is a SECOND readiness verdict:
 * the defect this programme has found in seven consecutive chunks and the one
 * Slice 7A had to delete from its own read path. So the assertions that matter
 * most here are negative — that `sync_work_package_release_verdict` was not
 * touched, that no surface restates a readiness rule, and that the material
 * and permit/isolation rules now exist ONCE, in the shared predicate, with
 * Recovery's door reading them from there rather than holding a copy.
 *
 * The rest pins the SQL to `src/lib/develop/fieldReadiness.ts`, so a renamed,
 * reordered or re-mapped element cannot land on one side only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  FIELD_READY_ELEMENTS,
  FIELD_READY_ELEMENT_TO_KIND,
  FIELD_READY_STATES,
  RECOVERY_START_GATE_ELEMENTS,
  fieldReadyCoverage,
} from "../lib/develop/fieldReadiness";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const ENGINE_FILE = "20261211090000_develop_field_readiness_engine.sql";
const RECORD_FILE = "20261211090100_develop_field_readiness_record.sql";
/** Part 3: the ONE verdict's seventh state, and the toggle it closes. */
const CURRENCY_FILE = "20261211090200_develop_field_readiness_currency.sql";
const SLICE_FILES = [ENGINE_FILE, RECORD_FILE, CURRENCY_FILE];
/** The two files that must state no readiness rule at all. */
const READ_FILES = [ENGINE_FILE, RECORD_FILE];

/** Slice 7A's constraint file — the one verdict lives here and stays here. */
const SLICE7A_CONSTRAINT_FILE = "20261210090100_develop_constraint_object.sql";
/** Slice 7A's burn-down file — where sync_calculation_code_version last stood. */
const SLICE7A_BURNDOWN_FILE = "20261210090200_develop_constraint_burndown.sql";
/** The 2026-09-21 Recovery file whose two element rules this slice absorbs. */
const RECOVERY_FILE = "20260921090000_sync_recovery.sql";
/** Recovery's own derived-readiness refresh, the thing D7.05 generalizes. */
const RECOVERY_REFRESH_FILE =
  "20261001090000_sync_recovery_control_closeout.sql";

const engine = read(ENGINE_FILE);
const record = read(RECORD_FILE);
const currency = read(CURRENCY_FILE);
const joined = SLICE_FILES.map(read).join("\n");
const readPaths = READ_FILES.map(read).join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");
const slice7a = read(SLICE7A_CONSTRAINT_FILE);
const recovery = read(RECOVERY_FILE);
const recoveryRefresh = read(RECOVERY_REFRESH_FILE);

const overlapMap = readFileSync("docs/sync-develop/overlap-map.md", "utf8");
const registerDoc = readFileSync("docs/sync-develop/register.md", "utf8");
const board = readFileSync("src/pages/ExecutionReadinessPage.tsx", "utf8");
const panel = readFileSync(
  "src/components/develop/WorkPackagingPanels.tsx",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");

/** Every `('key', 'version')` pin in a file's sync_calculation_code_version. */
function pinnedVersions(source: string): Map<string, string> {
  const fn = source.slice(
    source.indexOf(
      "create or replace function public.sync_calculation_code_version(",
    ),
  );
  const table = fn.slice(0, fn.indexOf("$$;"));
  return new Map(
    [...table.matchAll(/\('([a-z_]+)',\s+'([^']+)'\)/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

/**
 * ONE function's text, from its header to its own `$$;` terminator.
 *
 * The first version of this helper looked for `"\n$$;"`. Recovery's own
 * functions close with `end $$;` on a single line, so for those the search
 * MISSED and the slice ran to the end of the file — sweeping in the
 * `comment on function` prose that follows. Every negative assertion over such
 * a function was then answering a question about a comment: "the material
 * reading is GONE, not copied" failed against the sentence "…instead of
 * holding a second reading of work_order_materials", and a positive one could
 * have PASSED on a word that appears only in a comment. The terminator is the
 * first `$$;` after the header, since the opening delimiter is `$$` with no
 * semicolon.
 */
function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("$$;", at);
  expect(end, `${fn} has no $$; terminator`).toBeGreaterThan(at);
  return source.slice(at, end);
}

/* ── the prose artefacts, addressed by row rather than by file ───────────────
 * The register and the overlap map are the two places a later author reads
 * BEFORE the code. They drifted once already — describing the first draft of
 * this slice after the code had been corrected — so the tests below address
 * one row at a time and fail loudly when a row is missing rather than passing
 * over an empty string. */
function registerRow(id: string): [string, string] {
  const row = registerDoc.split("\n").find((l) => l.startsWith(`| ${id} `));
  expect(row, `register row ${id}`).toBeDefined();
  return [`register ${id}`, row as string];
}

function overlapRow(prefix: string): [string, string] {
  const row = overlapMap.split("\n").find((l) => l.startsWith(`| ${prefix}`));
  expect(row, `overlap-map row ${prefix}`).toBeDefined();
  return [`overlap-map ${prefix}`, row as string];
}

function overlapIndexEntry(n: number): [string, string] {
  const row = overlapMap.split("\n").find((l) => l.startsWith(`${n}. `));
  expect(row, `overlap-map index entry ${n}`).toBeDefined();
  return [`overlap-map index ${n}`, row as string];
}

/* ───────────────────────────── the ruling ───────────────────────────────── */

describe("Slice 7B — the ruling is written down before the schema", () => {
  it("orders strictly after Slice 7A", () => {
    for (const f of SLICE_FILES) {
      expect(f.slice(0, 14) > "20261210090200").toBe(true);
    }
  });

  it("states RULING 22 and names BOTH live doors it reconciles", () => {
    expect(rawJoined).toContain("RULING 22");
    expect(rawJoined).toContain("start_restoration_work");
    expect(rawJoined).toContain("sync_work_package_release_verdict");
  });

  it("answers the question three ways and says why two are wrong", () => {
    // A ruling that only asserts its own answer is a preference. The rejected
    // options have to be in the file, with the reason, so a later reader can
    // disagree with the reasoning rather than guess at it.
    const header = raw(ENGINE_FILE);
    expect(header).toContain("BOTH CONSUME ONE SHARED PREDICATE");
    expect(header).toContain(
      '"start_restoration_work generalizes to packages"',
    );
    expect(header).toContain(
      '"sync_work_package_release_verdict absorbs the recovery path"',
    );
    // The reason each is refused, not just the fact that it was.
    expect(header).toContain("has no restoration plan and");
    expect(header).toContain("AGENTS invariant 8");
  });

  it("anchors the shared predicate on the WORK IDENTITY, per RULING 19", () => {
    expect(rawJoined).toContain("RULING 19");
    const b = body(engine, "sync_field_readiness_elements");
    // It takes a WORK ORDER, not an event and not a package.
    expect(b).toContain("p_work_order_id uuid");
    expect(b).not.toContain("p_event_id");
    expect(b).not.toContain("p_package_id");
  });

  it("is written into the overlap map as well as the migration", () => {
    // A ruling that lives only in a migration header is invisible to the next
    // author, who reads the overlap map first — the file that exists because
    // this programme keeps rebuilding what it already has.
    expect(overlapMap).toContain("RULING 22");
    expect(overlapMap).toContain("sync_field_readiness_elements");
  });
});

/* ─────────────── there is still exactly ONE release verdict ─────────────── */

describe("D7.06 — the one verdict is not forked, copied or re-armed", () => {
  it("keeps the verdict ONE function: redefined once, never forked", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Slice 7B's first draft left the
    // verdict untouched and the recorded evidence behind it went stale, so
    // three surfaces printed READY over a store that said otherwise. The fix
    // is a SEVENTH REFUSING STATE inside the one predicate — never a second
    // predicate, and never a read-side check the door would contradict.
    //
    // The assessment, the itemized read and the board still state NO
    // readiness rule: the verdict is defined in exactly one file, once.
    expect(readPaths).not.toContain(
      "create or replace function public.sync_work_package_release_verdict",
    );
    expect(readPaths).not.toContain(
      "create or replace function public.release_work_package",
    );
    const definitions = [
      ...joined.matchAll(
        /create or replace function public\.sync_work_package_release_verdict\(/g,
      ),
    ];
    expect(definitions).toHaveLength(1);
    expect(currency).toContain(
      "create or replace function public.sync_work_package_release_verdict(",
    );
    // `release_work_package` is NOT redefined: it refuses through the verdict,
    // so the seventh state reaches the door without the door being edited.
    expect(joined).not.toContain(
      "create or replace function public.release_work_package",
    );
    // And 7A's original is still where 7A put it — this is a change, proven
    // against what it changed, rather than an assertion about an absence.
    expect(slice7a).toContain(
      "create or replace function public.sync_work_package_release_verdict(",
    );
  });

  it("carries every one of 7A's six reason sentences into the redefinition", () => {
    // A redefinition that reworded a branch would silently retune the
    // door/screen agreement 7A proved character for character. Each of the six
    // format strings is lifted from 7A's own body and required verbatim.
    const before = body(slice7a, "sync_work_package_release_verdict");
    const after = body(currency, "sync_work_package_release_verdict");
    const sentences = [
      ...before.matchAll(/'((?:[A-Z][^']|NOT READY|Every )[^']*)'/g),
    ]
      .map((m) => m[1])
      .filter((t) => t.length > 60);
    expect(sentences.length).toBeGreaterThanOrEqual(6);
    for (const sentence of sentences) {
      expect(after, sentence.slice(0, 40)).toContain(sentence);
    }
    // The six verdict names survive, and exactly one is added.
    const namesOf = (b: string) =>
      new Set([...b.matchAll(/'verdict', '([a-z_]+)'/g)].map((m) => m[1]));
    const added = [...namesOf(after)].filter((n) => !namesOf(before).has(n));
    expect(added).toEqual(["stale"]);
    for (const kept of namesOf(before)) {
      expect([...namesOf(after)], kept).toContain(kept);
    }
  });

  it("declares no second verdict function of its own", () => {
    const declared = [
      ...joined.matchAll(/create or replace function public\.(\w+)\(/g),
    ].map((m) => m[1]);
    // The ONLY thing named like a verdict is the one verdict itself.
    expect(
      declared.filter((n) => /verdict|is_ready|ready_for/i.test(n)),
    ).toEqual(["sync_work_package_release_verdict"]);
    // The gaps helper returns FACTS, not an answer: no verdict name, no
    // canRelease, and no readiness sentence of its own. (A blanket ban on the
    // substring "ready" cannot express that — the helper's whole job is to
    // call `sync_field_readiness_elements` into `v_ready` — so the ban names
    // the shapes an ANSWER would actually take.)
    const gaps = body(currency, "sync_work_package_field_readiness_gaps");
    for (const answerShaped of [
      "canRelease",
      "'verdict'",
      "ready_for_human",
      "'readiness'",
      "not_ready",
      "Release is a §70 human act",
    ]) {
      expect(gaps, answerShaped).not.toContain(answerShaped);
    }
    // It reads the ONE predicate and reports per-element facts, nothing more.
    expect(gaps).toContain("sync_field_readiness_elements(m.id, null)");
    expect(gaps).toContain("'gapCount'");
    // The exact surface this slice adds, so a later addition has to be
    // declared here rather than arriving unnoticed.
    expect(declared.sort()).toEqual(
      [
        "assess_package_field_readiness",
        "clear_package_constraint",
        "get_case_work_packages",
        "get_execution_readiness_board",
        "get_package_field_readiness",
        "refresh_restoration_readiness",
        "start_restoration_work",
        "sync_calculation_code_version",
        "sync_field_readiness_blockers",
        "sync_field_readiness_constraint_kind",
        "sync_field_readiness_element",
        "sync_field_readiness_element_keys",
        "sync_field_readiness_elements",
        "sync_field_readiness_owner_role",
        "sync_record_field_readiness_refusal",
        "sync_work_package_field_readiness_gaps",
        "sync_work_package_release_verdict",
      ].sort(),
    );
  });

  it("makes every surface read the one verdict verbatim instead of restating it", () => {
    for (const fn of [
      "assess_package_field_readiness",
      "get_package_field_readiness",
    ]) {
      const b = body(record, fn);
      expect(b, fn).toContain("sync_work_package_release_verdict(p.id)");
      expect(b, fn).toContain("v_verdict->>'reason'");
    }
    const b = body(record, "get_execution_readiness_board");
    expect(b).toContain("sync_work_package_release_verdict(p.id) as verdict");
    expect(b).toContain("'readiness', v.verdict->>'reason'");
    expect(b).toContain("'canRelease', (v.verdict->>'canRelease')::boolean");
    // Every number a person reads comes from the verdict too, not re-counted
    // beside it — the 7A `get_case_work_packages` lesson.
    expect(b).toContain(
      "'constraintsRecorded', (v.verdict->>'constraintsRecorded')::int",
    );
    expect(b).toContain("'openHard', (v.verdict->>'openHard')::int");
  });

  it("writes no readiness sentence of its own into a read path", () => {
    // The three sentences the 7A defect printed. If any appears in the
    // assessment, the itemized read or the board, some surface is claiming
    // readiness. They are legitimate INSIDE the verdict, and nowhere else.
    for (const forbidden of [
      "Every hard constraint recorded against work package",
      "ready_for_human',",
      "'canRelease', true",
    ]) {
      expect(readPaths, forbidden).not.toContain(forbidden);
    }
    // …and the file that DOES hold them holds nothing but the verdict, the
    // gaps it reads, the constraint door and the case read.
    for (const forbidden of [
      "Every hard constraint recorded against work package",
      "'canRelease', true",
    ]) {
      expect(
        body(currency, "sync_work_package_release_verdict"),
        forbidden,
      ).toContain(forbidden);
    }
  });

  it("gives the seventh state a sentence that REFUSES, and a false canRelease", () => {
    const b = body(currency, "sync_work_package_release_verdict");
    const stale = b.slice(b.indexOf("'verdict', 'stale'"));
    expect(stale).toContain("'canRelease', false");
    expect(stale).toContain("no longer describes the work");
    expect(stale).toContain("Re-assess it");
    // It reads the ONE element predicate through the gaps helper rather than
    // deriving anything of its own.
    expect(b).toContain("sync_work_package_field_readiness_gaps(p.id)");
    expect(b).not.toContain("work_order_materials");
    expect(b).not.toContain("job_plan_permits");
  });

  it("fires the seventh state only where an assessment was RECORDED, and says so", () => {
    // The boundary is deliberate and is D7.06's residual restated, not
    // silently widened: a package nobody ever field-assessed still reaches
    // ready_for_human on a person's own cleared constraints, exactly as 7A
    // shipped it — including in 7A's own transcript.
    const b = body(currency, "sync_work_package_release_verdict");
    expect(b).toContain("'package_field_readiness'");
    expect(b).toContain("r.status = 'computed'");
    expect(b).toContain("if v_run.id is not null then");
    expect(raw(CURRENCY_FILE)).toContain("D7.06 stays 🟡 and says so");
  });

  it("counts a REFUSED lineage row as not-assessed everywhere it is read back", () => {
    // The assessment now records its refusals (D7.05's own claim). A refused
    // run says the assessment did NOT happen, so reading it back as "assessed"
    // would turn the refusal into the reassurance it exists to withhold.
    for (const b of [
      body(record, "get_package_field_readiness"),
      body(record, "get_execution_readiness_board"),
      body(currency, "sync_work_package_release_verdict"),
    ]) {
      expect(b).toContain("r.status = 'computed'");
    }
  });
});

/* ──────────────────── D7.12 — the ten, and the three ────────────────────── */

describe("D7.12 — ten elements, and the three that cannot be verified", () => {
  it("reports exactly the ten the TypeScript vocabulary names, in order", () => {
    const b = body(engine, "sync_field_readiness_elements");
    const emitted = [
      ...b.matchAll(/sync_field_readiness_element\(\s*\n?\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);
    expect(emitted).toEqual(FIELD_READY_ELEMENTS.map((e) => e.key));
  });

  it("gives each element the same label, basis kind and source on both sides", () => {
    const b = body(engine, "sync_field_readiness_elements");
    for (const element of FIELD_READY_ELEMENTS) {
      expect(b, element.key).toContain(`'${element.key}', '${element.label}'`);
      expect(b, element.key).toContain(`'${element.basisKind}'`);
      expect(b, element.key).toContain(`'${element.source}'`);
    }
  });

  it("declares `unverifiable` as a state, and never lets it read as ready", () => {
    const b = body(engine, "sync_field_readiness_elements");
    expect(FIELD_READY_STATES).toContain("unverifiable");
    // The three with no store are the ONLY unverifiable ones, and each is
    // emitted as a literal — not defaulted, not computed from an absence.
    const unverifiable = [
      ...b.matchAll(/'([a-z_]+)', '[^']+', 'declared', 'unverifiable'/g),
    ].map((m) => m[1]);
    expect(unverifiable).toEqual(["crew", "access", "predecessor"]);
    expect(fieldReadyCoverage()).toEqual({
      total: 10,
      derived: 7,
      declared: 3,
    });
  });

  it("names WHY each of the three has no store, rather than leaving it blank", () => {
    const b = body(engine, "sync_field_readiness_elements");
    expect(b).toContain("work_orders.assignee is free text");
    expect(b).toContain("No canonical store records physical access");
    expect(b).toContain(
      "No canonical store records work-order-level predecessors",
    );
  });

  it("invents no store for the three — the register's own instruction", () => {
    // If a crew, access or predecessor TABLE ever appears in this slice, the
    // row stopped being honest about its coverage.
    expect(joined).not.toMatch(/create table[^;]*crew_assignments/i);
    expect(joined).not.toMatch(/create table[^;]*work_face_access/i);
    expect(joined).not.toMatch(/create table[^;]*work_order_predecessors/i);
    // No new table at all, in fact: the assessment records into
    // restoration_constraints and calculation_runs, both canonical.
    expect(joined).not.toContain("create table");
  });

  it("maps every element onto a kind the constraint CHECK actually allows", () => {
    // The AUTHORITATIVE list, read from the SQL that declares it rather than
    // from a copy: RULING 20's twenty values.
    const check = slice7a.slice(
      slice7a.indexOf("restoration_constraints_constraint_kind_check check ("),
    );
    const allowed = new Set(
      [...check.slice(0, 600).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    );
    expect(allowed.size).toBeGreaterThan(15);
    const map = body(record, "sync_field_readiness_constraint_kind");
    for (const element of FIELD_READY_ELEMENTS) {
      const kind = FIELD_READY_ELEMENT_TO_KIND[element.key];
      expect(allowed.has(kind), `${element.key} -> ${kind}`).toBe(true);
      expect(map, element.key).toContain(`when '${element.key}'`);
      expect(map, element.key).toContain(`then '${kind}'`);
    }
  });
});

/* ───────────── D7.05 / RULING 22 — the element rules exist ONCE ─────────── */

describe("D7.05 — Recovery's door refuses through the shared predicate", () => {
  it("no longer holds the material rule or the isolation rule inline", () => {
    const b = body(engine, "start_restoration_work");
    // The two inline checks 20260921090000 carried. They moved; they were not
    // copied, so they must be GONE from the door.
    expect(b).not.toContain("from work_order_materials");
    expect(b).not.toContain("from equipment_releases");
    expect(b).not.toContain("from job_plan_permits");
    // …and the 2026-09-21 file still shows what moved, so this assertion is
    // about a change rather than about an absence that was always true.
    const original = body(recovery, "start_restoration_work");
    expect(original).toContain("from work_order_materials");
    expect(original).toContain("from equipment_releases r");
    expect(original).toContain("from job_plan_permits");
  });

  it("consumes the one predicate and states its gate as POLICY, in one line", () => {
    const b = body(engine, "start_restoration_work");
    expect(b).toContain("sync_field_readiness_elements(w.id, e.asset_id)");
    expect(b).toContain(
      `sync_field_readiness_blockers(v_ready, array['materials','isolation'])`,
    );
    // The gate is Recovery's historical one, on both sides.
    expect([...RECOVERY_START_GATE_ELEMENTS]).toEqual([
      "materials",
      "isolation",
    ]);
  });

  it("keeps every refusal sentence the live door already returned", () => {
    // A generalization that reworded a live refusal breaks every caller
    // reading it while claiming to have changed nothing.
    const b = body(engine, "start_restoration_work");
    for (const sentence of [
      "forbidden",
      "field-start authority denied",
      "work is not startable",
      "no released plan exists",
      "scope item is not in the currently released plan",
      "unresolved hard execution constraint blocks work",
    ]) {
      expect(b, sentence).toContain(sentence);
    }
    // …and the two that moved are now the ELEMENT's own words. ONE of them is
    // character-identical and the other is NOT, and the first draft of this
    // slice said in four places that both were — with a substring assertion
    // here that passed over exactly the change it claimed to guard.
    const elements = body(engine, "sync_field_readiness_elements");
    const ISOLATION =
      "job plan requires permit/isolation; canonical equipment release does not confirm active isolation";
    // BYTE-IDENTICAL, asserted as a whole quoted literal rather than as a
    // substring of something longer.
    expect(elements).toContain(`v_detail := '${ISOLATION}';`);
    expect(recovery).toContain(`'${ISOLATION}'`);
    // EXTENDED, deliberately: the materials refusal now names the count and
    // ENDS with Recovery's original wording. The whole format string is pinned
    // so a further reword turns this red; the transcript compares the runtime
    // string by equality (scripts/ci-develop-slice7b-smoke.sh).
    expect(elements).toContain(
      "'%s of %s material line(s) on work order %s remain requested or short — required materials are not ready.'",
    );
    expect(recovery).toContain("required materials are not ready");
    // And the migration says it is an extension, in those words.
    expect(raw(ENGINE_FILE)).toContain("THE MATERIALS REFUSAL IS NOT");
    expect(raw(ENGINE_FILE)).toContain("That is an extension");
  });

  it("refuses a payload it could not answer, at the door and at the gate", () => {
    // The predicate has an explicit `answered` channel and the first draft read
    // past it: an unreadable work order produced an empty element list, the
    // blocker filter turned that into "nothing blocks", and the door STARTED
    // the work while handing the caller ten elements rendered as zero.
    const door = body(engine, "start_restoration_work");
    expect(door).toContain("(v_ready->>'answered')::boolean");
    expect(door).toContain("'error', v_ready->>'refusal'");
    // The gate raises too, because an unanswered payload reaching it is a
    // programming fault rather than a condition in the data.
    const blockers = body(engine, "sync_field_readiness_blockers");
    expect(blockers).toContain("raise exception");
    expect(blockers).toContain("did not answer");
    expect(blockers).toContain("cardinality(p_gate_keys) = 0");
    expect(blockers).toContain("sync_field_readiness_element_keys()");
  });

  it("refuses a job plan it cannot read rather than calling it 'no permit'", () => {
    // The org filter on the plan lookup is a TIGHTENING on the historical
    // count (20260921090000 had none) — and a tightening that fell through to
    // `permits = 0` DISARMED the permit/isolation gate: `not_applicable`, "no
    // isolation is required", and a start the old door refused.
    const b = body(engine, "sync_field_readiness_elements");
    expect(b).toContain("and organization_id = v_org");
    expect(b).toContain("cannot be read in its own organization");
    expect(b).toContain("disarm the permit and isolation gate");
    // NO PLAN AT ALL is `unverifiable`, not `not_applicable`: nothing says
    // whether a permit is required, and "not applicable" is a positive finding
    // from a store that is not there.
    expect(b).toContain("if not v_has_plan then");
    expect(b).toContain("nothing identifies whether a permit");
    expect(b).toContain("not the same finding as");
    // The historical count really did lack the org filter, so this is a
    // statement about a change rather than about an absence.
    expect(body(recovery, "start_restoration_work")).toContain(
      "from job_plan_permits where job_plan_id=w.job_plan_id",
    );
  });

  it("names the ten gate keys once, and the vocabulary agrees", () => {
    const keys = body(engine, "sync_field_readiness_element_keys");
    for (const element of FIELD_READY_ELEMENTS) {
      expect(keys, element.key).toContain(`'${element.key}'`);
    }
    const listed = [...keys.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual(FIELD_READY_ELEMENTS.map((e) => e.key));
  });

  it("passes the EVENT's asset, so the isolation lookup did not silently move", () => {
    const b = body(engine, "start_restoration_work");
    expect(b).toContain("e.asset_id");
    // The original looked for the release against the event's asset too.
    expect(body(recovery, "start_restoration_work")).toContain(
      "r.asset_id=e.asset_id",
    );
  });

  it("does not widen Recovery's gate to the other eight elements", () => {
    // Moving where a rule lives is not licence to change what it refuses. The
    // gate array is the whole policy, and it names two.
    const b = body(engine, "start_restoration_work");
    const gates = [
      ...b.matchAll(/sync_field_readiness_blockers\([^)]*array\[([^\]]*)\]/g),
    ];
    expect(gates).toHaveLength(1);
    expect(gates[0][1].match(/'/g)?.length).toBe(4);
  });

  it("keeps Recovery's authority envelope exactly as it was", () => {
    // RULING 20 declined to edit Recovery's role list under a §27 header and
    // so does this slice. ai_admin was on this door before and still is.
    const b = body(engine, "start_restoration_work");
    expect(b).toContain(
      "array['technician','supervisor','maintenance_manager','admin','ai_admin']",
    );
    expect(body(recovery, "start_restoration_work")).toContain(
      "array['technician','supervisor','maintenance_manager','admin','ai_admin']",
    );
  });

  it("generalizes the DERIVED half that D7.05 was still 🟡 on", () => {
    // Recovery derives readiness items for an EVENT. Slice 7B does the same
    // for a PACKAGE, through the shared predicate rather than a second
    // derivation.
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("sync_field_readiness_elements(m.id, null)");
    expect(b).toContain("from work_package_work k join work_orders w");
  });

  it("leaves NO second material rule anywhere, including Recovery's refresh", () => {
    // RULING 22's central claim — "what they must not have two of is the
    // ELEMENT RULES, and after this file they do not" — was FALSE in the first
    // draft. `refresh_restoration_readiness` still derived its own material
    // position from work_order_materials, with its own predicate and its own
    // sentences, and those rows gate `start_restoration_work` (its exclusion
    // list covers permit, isolation and asset_state only). The two disagreed
    // live: the store said kitted, the predicate said ready, and the recovery
    // row still said blocked.
    const before = body(recoveryRefresh, "refresh_restoration_readiness");
    expect(before).toContain("left join work_order_materials m");
    expect(before).toContain("m.status in ('requested','short')");

    const after = body(engine, "refresh_restoration_readiness");
    expect(after).toContain("sync_field_readiness_elements(r.work_order_id");
    expect(after).toContain("el->>'key'='materials'");
    // The reading is GONE, not copied.
    expect(after).not.toContain("work_order_materials");
    expect(after).not.toContain("'requested','short'");
    // Everything else about the function is preserved: the same delete scope,
    // the same source_ref keys, the same three other loops, the same envelope.
    for (const kept of [
      "source_ref like 'recovery-v2:%'",
      "'recovery-v2:material:'",
      "'recovery-v2:labour:'",
      "'recovery-v2:resource:'",
      "'recovery-v2:zone:'",
      "array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']",
      "'constraints_refreshed'",
    ]) {
      expect(after, kept).toContain(kept);
      expect(before, kept).toContain(kept);
    }
    // A work order the predicate cannot read becomes an UNKNOWN question, not
    // a skipped row that reports "no material blocker".
    expect(after).toContain("(v_ready->>'answered')::boolean");
  });

  it("maps the element state onto the constraint state exactly as the old rule did", () => {
    const before = body(recoveryRefresh, "refresh_restoration_readiness");
    const after = body(engine, "refresh_restoration_readiness");
    // Old: zero demand -> not_applicable, none open -> satisfied, else blocked.
    expect(before).toContain("v_state:='not_applicable'");
    expect(before).toContain("v_state:='satisfied'");
    expect(after).toContain(
      "when 'ready' then 'satisfied' when 'blocked' then 'blocked' when 'not_applicable' then 'not_applicable'",
    );
  });
});

/* ──────────────────────── §70 at the DATABASE ───────────────────────────── */

describe("D7.06 §70 — the machine may assess and may not declare", () => {
  it("never writes `satisfied` and never stamps a verifier", () => {
    const b = body(record, "assess_package_field_readiness");
    expect(b).not.toContain("'satisfied'");
    // IT MAY NOT WRITE A VERIFIER. It MAY read one: the audit row records
    // WHICH derived rows a re-assessment destroyed, and the verifier each
    // carried is the part of that worth being able to name afterwards. So the
    // ban is on the WRITE — the column never appears in an insert column list
    // and is never assigned — rather than on the identifier appearing at all,
    // which would forbid the record-keeping too.
    expect(b).not.toContain("verified_by,");
    expect(b).not.toContain("verified_by =");
    expect(b).not.toContain("verified_at");
    // The only place the column is named at all is the `delete … returning`
    // that records what a re-assessment destroyed — every occurrence sits
    // inside that CTE, ahead of the first insert.
    expect(b).toContain("returning id, source_ref, state, verified_by");
    expect(b).toContain("'verifiedBy', verified_by");
    const firstInsert = b.indexOf("insert into restoration_constraints");
    expect(firstInsert).toBeGreaterThan(-1);
    for (const m of b.matchAll(/verified_by/g)) {
      expect(
        m.index,
        `verified_by at ${m.index} is past the first insert`,
      ).toBeLessThan(firstInsert);
    }
    // And the insert really does omit both columns, so the table CHECK plus
    // the §70 wall make `satisfied` unreachable from here.
    const insert = b.slice(b.indexOf("insert into restoration_constraints"));
    const columns = insert.slice(0, insert.indexOf(")"));
    expect(columns).not.toContain("verified");
    // THE TWO STATES IT MAY WRITE, AND NO OTHERS — asserted against the two
    // state expressions the two inserts actually carry. (The earlier version
    // of this looked for a literal `true, 'blocked',`, which the derived
    // insert has not had since it started recording an unanswerable DERIVED
    // element as a question: it writes a CASE. The regex then matched only the
    // declared insert and the assertion was quietly about one of the two.)
    expect(b).toContain(
      "case el.elem_state when 'blocked' then 'blocked' else 'unknown' end",
    );
    expect(b).toContain("true, 'unknown',");
    // Neither of the two states that would REMOVE a row from the open set is
    // reachable from this function at all.
    expect(b).not.toContain("'satisfied'");
    expect(b).not.toContain("'not_applicable'");
    // …and there are exactly two inserts into the constraint store.
    expect([
      ...b.matchAll(/insert into restoration_constraints/g),
    ]).toHaveLength(2);
  });

  it("ADMITS ai_admin to the assessment, precisely and on purpose", () => {
    // 7A's §70 wall was over-broad in its first draft and refused two Recovery
    // RPCs that legitimately admit ai_admin. A guard that refuses the right
    // thing must not refuse the wrong one, so the scope here is the ACT.
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("'ai_admin'");
    expect(raw(RECORD_FILE)).toContain("ADMITS ai_admin");
  });

  it("and the two acts that DECLARE readiness still refuse it, untouched", () => {
    for (const fn of ["clear_package_constraint", "release_work_package"]) {
      const b = body(slice7a, fn);
      // THE ROLE LIST, not the whole body: `stripComments` keeps
      // dollar-quoted blocks verbatim, so both of these functions still carry
      // a COMMENT naming ai_admin to explain why it is absent. Asserting over
      // the body would fail on the sentence that says the AI is excluded.
      const gate = /not in\s*\(([^)]*)\)/.exec(b);
      expect(gate, `${fn} has no role gate`).not.toBeNull();
      const roles = [
        ...(gate as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g),
      ].map((m) => m[1]);
      expect(roles, fn).not.toContain("ai_admin");
      expect(roles, fn).toContain("admin");
      expect(roles, fn).toContain("maintenance_manager");
    }
    // The §70 wall on verified_by is 7A's and this slice does not move it.
    expect(joined).not.toContain("trg_constraint_verifier_human");
    expect(joined).not.toContain("enforce_awp_act_is_human");
    expect(slice7a).toContain("create trigger trg_constraint_verifier_human");
  });

  it("refuses to assess a released or cancelled package", () => {
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("was released on");
    expect(b).toContain("does not grow afterwards");
    expect(b).toContain("was cancelled");
  });

  it("refuses to assess a package containing no work", () => {
    // "No blockers found" over an empty package is the reading §27 exists to
    // prevent, arriving through a vacuous loop.
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("contains no work orders");
    expect(b).toContain("an assessment of nothing");
  });

  it("writes through the marker door and the audit trail like every other AWP write", () => {
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain(
      "set_config('app.package_constraint_write', 'granted', true)",
    );
    expect(b).toContain("set_config('app.package_constraint_write', '', true)");
    expect(b).toContain("insert into audit_events");
    expect(b).toContain("previous_state");
    expect(b).toContain("new_state");
  });
});

/* ───────── re-assessment: evidence overwrites, judgement does not ───────── */

describe("re-assessment replaces what a store answers and nothing else", () => {
  it("deletes only the DERIVED rows, by their own source_ref prefix", () => {
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("source_ref like 'awp-field-ready:derived:%'");
    expect(b).not.toContain("source_ref like 'awp-field-ready:%'");
    expect(b).not.toContain("source_ref like 'awp-field-ready:declared:%'");
  });

  it("raises a declared question ONCE and never overwrites the answer", () => {
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("if not exists (");
    expect(b).toContain("x.source_ref = v_source");
    // Nor does it re-ask where a person already recorded that class by hand
    // AGAINST THIS WORK ORDER. The `work_order_id is null` arm this assertion
    // used to require was the defect: ONE package-wide row silenced the
    // crew/access/predecessor question for every job in the package, for every
    // job added afterwards, in whatever state it had been left — so a package
    // could reach `ready_for_human` with three of its ten elements never asked
    // about any of its jobs. A package-wide note about the north bay is not an
    // answer to a per-job question.
    expect(b).toContain("coalesce(y.source_kind, '') <> 'derived'");
    expect(b).toContain("y.work_order_id = m.id");
    expect(b).not.toContain("y.work_order_id is null");
  });

  it("records the run in the ONE lineage ledger under a pinned key", () => {
    const b = body(record, "assess_package_field_readiness");
    expect(b).toContain("record_calculation_run(");
    expect(b).toContain("'package_field_readiness'");
    const pins = body(record, "sync_calculation_code_version");
    expect(pins).toContain("('package_field_readiness',");
  });

  it("re-pins every key that was already pinned, and bumps none of them", () => {
    // This slice REDEFINES sync_calculation_code_version to add one key. A
    // redefinition that dropped a key would make record_calculation_run RAISE
    // for that calculation — the pin table is fail-closed by design — and a
    // redefinition that bumped a version would make the version stop meaning
    // anything. Both are checked against 7A's own copy rather than a list
    // retyped here.
    const before = pinnedVersions(read(SLICE7A_BURNDOWN_FILE));
    const after = pinnedVersions(read(RECORD_FILE));
    expect(before.size).toBeGreaterThanOrEqual(19);
    for (const [key, version] of before) {
      expect(after.get(key), `${key} lost its pin`).toBe(version);
    }
    expect([...after.keys()].filter((k) => !before.has(k))).toEqual([
      "package_field_readiness",
    ]);
  });

  it("records every key it pins that this slice owns", () => {
    // The 4B/4C rule, which this file inherits because it redefines the pin
    // table: a pin can never read as coverage that does not exist.
    const b = body(record, "assess_package_field_readiness");
    expect(b).toMatch(
      /record_calculation_run\([\s\S]{0,200}'package_field_readiness'/,
    );
  });
});

/* ───────────────── D7.11 / D13.09 — itemized, and composed ──────────────── */

describe("D7.11 — the itemization says WHICH element, not how many", () => {
  it("returns each element beside the constraint holding it", () => {
    const b = body(record, "get_package_field_readiness");
    expect(b).toContain("sync_field_readiness_elements(m.id, null)");
    expect(b).toContain(
      "'constraintKind', sync_field_readiness_constraint_kind",
    );
    expect(b).toContain("'constraintId', c.id");
    expect(b).toContain("awp-field-ready:derived:%s:%s");
    expect(b).toContain("awp-field-ready:declared:%s:%s");
  });

  it("matches a DECLARED element the same way the assessor skips it", () => {
    // The read must agree with the write. `assess_package_field_readiness`
    // declines to raise a declared question where a person already recorded
    // that kind by hand; without the mirroring fallback here, that element
    // rendered with NOTHING beside it and read as though nobody had addressed
    // it — a screen strictly weaker than the store it reports.
    const read = body(record, "get_package_field_readiness");
    const assess = body(record, "assess_package_field_readiness");
    for (const clause of [
      "coalesce(c.source_kind, '') <> 'derived'",
      // NAMING THIS WORK ORDER, and nothing wider — the same scope the
      // assessor skips on. Mirroring a `work_order_id is null` arm here would
      // put an unrelated clearance ("the north bay access was granted this
      // morning") beside an element about a different work face, on a job
      // nobody had ever considered access for.
      "c.work_order_id = m.id",
    ]) {
      expect(read, clause).toContain(clause);
    }
    expect(read).not.toContain("c.work_order_id is null");
    expect(assess).toContain("coalesce(y.source_kind, '') <> 'derived'");
    // Scoped to DECLARED elements only: a person's constraint about some other
    // material is not evidence about a store-derived element's position.
    expect(read).toContain("e->>'basisKind' = 'declared'");
    // And a tie is decided deterministically, so a re-run cannot flip which of
    // two rows an element is shown against.
    expect(read).toContain("order by (c.source_ref is not null) desc");
  });

  it("says whether an assessment was ever recorded, rather than defaulting", () => {
    const b = body(record, "get_package_field_readiness");
    expect(b).toContain("'assessed', v_run.id is not null");
    expect(b).toContain("No field-readiness assessment has been recorded");
  });
});

describe("D13.09 — the board composes recorded verdicts", () => {
  it("reads the last recorded assessment rather than recomputing one", () => {
    const b = body(record, "get_execution_readiness_board");
    expect(b).toContain("from calculation_runs r");
    expect(b).toContain("'package_field_readiness'");
    expect(b).toContain("'fieldReadinessOutputs', run.outputs");
    // It does NOT call the element predicate: a board that re-derived ten
    // elements for every package would be a second answer to the assessment.
    expect(b).not.toContain("sync_field_readiness_elements(");
  });

  it("names the blocking items and their owners", () => {
    const b = body(record, "get_execution_readiness_board");
    expect(b).toContain("x.is_hard and x.state in ('unknown', 'blocked')");
    expect(b).toContain("'ownerRole', x.owner_role");
    expect(b).toContain("'ownerEmail', own.email");
  });

  it("refuses an empty board by name", () => {
    const b = body(record, "get_execution_readiness_board");
    expect(b).toContain("No work package has been recorded");
    expect(b).toContain("nothing is waiting on anybody");
  });

  it("sorts undated packages last rather than first", () => {
    // A null required-by is "nobody said when". At the top of a board a
    // supervisor works down, it would read as most urgent.
    const b = body(record, "get_execution_readiness_board");
    expect(b).toContain("coalesce(p.required_by::text, '9999-12-31')");
  });
});

/* ───────────────────────── tenancy and grants ───────────────────────────── */

describe("the new surface is tenant-scoped and not callable by anon", () => {
  it("revokes EXECUTE from public on every function it declares", () => {
    for (const fn of [
      "sync_field_readiness_element",
      "sync_field_readiness_elements",
      "sync_field_readiness_blockers",
      "sync_field_readiness_constraint_kind",
      "sync_field_readiness_owner_role",
      "assess_package_field_readiness",
      "get_package_field_readiness",
      "get_execution_readiness_board",
      "start_restoration_work",
    ]) {
      expect(joined, fn).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\(`),
      );
    }
  });

  it("keeps the shared predicate away from clients entirely", () => {
    // It carries no session-derived org filter of its own — the 7A
    // sync_work_package_release_verdict posture, for the same reason.
    expect(engine).toContain(
      "revoke all on function public.sync_field_readiness_elements(uuid, uuid)\n  from public, anon, authenticated",
    );
    expect(engine).not.toMatch(
      /grant execute on function public\.sync_field_readiness_elements/,
    );
  });

  it("resolves the tenant from the row, so a foreign id cannot be named", () => {
    const b = body(engine, "sync_field_readiness_elements");
    expect(b).toContain("v_org := w.organization_id;");
    // Every store it reads is filtered by that org or by the job plan it
    // already resolved inside it.
    expect(b).toContain(
      "where organization_id = v_org and work_order_id = w.id",
    );
    expect(b).toContain("r.organization_id = v_org");
    expect(b).toContain(
      "from job_plans where id = w.job_plan_id and organization_id = v_org",
    );
  });

  it("gates every client-callable function on app_current_org()", () => {
    for (const fn of [
      "assess_package_field_readiness",
      "get_package_field_readiness",
      "get_execution_readiness_board",
    ]) {
      const b = body(record, fn);
      expect(b, fn).toContain("v_org uuid := app_current_org()");
      expect(b, fn).toContain("'forbidden'");
      expect(b, fn).toContain("organization_id = v_org");
    }
  });
});

/* ─────────────────── the surfaces state no rule of their own ────────────── */

describe("the client renders the server's answer and computes none", () => {
  it("wires the three RPCs through the service, and only there", () => {
    for (const rpc of [
      "assess_package_field_readiness",
      "get_package_field_readiness",
      "get_execution_readiness_board",
    ]) {
      expect(service, rpc).toContain(`supabase.rpc("${rpc}"`);
    }
    // The components go through the service, never straight at an RPC.
    expect(panel).not.toContain("supabase.rpc");
    expect(board).not.toContain("supabase.rpc");
  });

  it("renders the readiness sentence verbatim and never assembles one", () => {
    expect(board).toContain("{pkg.readiness}");
    expect(panel).toContain("{view.readiness}");
    for (const forbidden of [
      "Every hard constraint",
      "is ready",
      "READY:",
      "canRelease ?",
    ]) {
      expect(board, forbidden).not.toContain(forbidden);
    }
  });

  it("shows an unassessed package as unassessed rather than as a blank", () => {
    expect(board).toContain("fieldReadinessNote");
    expect(board).toContain("text-amber-200");
    expect(panel).toContain("view.assessed ? null : view.assessmentNote");
  });

  it("gives `unverifiable` its own visual register", () => {
    // If it rendered like `ready`, "nobody has checked" would look like
    // "checked and clear" — the §27 failure, arriving through CSS.
    expect(panel).toContain("caution:");
    expect(panel).toContain("fieldReadyTone");
  });

  it("is reachable from a route and from the case workspace", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('path="/execution-readiness"');
    expect(app).toContain("ExecutionReadinessPage");
    const workspace = readFileSync(
      "src/pages/DevelopmentCaseWorkspacePage.tsx",
      "utf8",
    );
    expect(workspace).toContain('to="/execution-readiness"');
  });
});

/* ──────────────────────────── the register ──────────────────────────────── */

describe("the register says what this slice did and what it did not", () => {
  it("keeps D7.12 honest about the three elements nothing can verify", () => {
    const row = registerDoc.split("\n").find((l) => l.startsWith("| D7.12 "));
    expect(row).toBeDefined();
    expect(row).toContain("crew");
    expect(row).toContain("access");
    expect(row).toContain("predecessor");
    expect(row).toContain("7 of 10");
  });

  it("cites the ruling from every row this slice touched", () => {
    for (const id of ["D7.05", "D7.06", "D7.11", "D7.12", "D7.19", "D13.09"]) {
      const row = registerDoc.split("\n").find((l) => l.startsWith(`| ${id} `));
      expect(row, id).toBeDefined();
      expect(row, id).toContain("RULING 22");
    }
  });

  // ── THE PROSE IS PART OF THE ARTEFACT, AND IT DRIFTED. ────────────────────
  // The three assertions below exist because the register and the overlap map
  // were written against the FIRST draft of this slice and then not revisited
  // when the code was corrected: they went on saying the one verdict was
  // untouched after it had gained a seventh state, and that both moved refusal
  // sentences were character-identical when one had been extended. A ruling
  // that describes code the repository no longer has is worse than no ruling,
  // because the next author reads it first and believes it.
  it("does not claim the ONE verdict was left untouched, and names the state it gained", () => {
    const rows = [
      registerRow("D7.05"),
      registerRow("D7.06"),
      overlapRow("D7.05 Release checklist"),
      overlapIndexEntry(20),
    ];
    for (const [label, text] of rows) {
      // The PRESENT-TENSE claim, not the word. Both documents narrate the
      // history deliberately — "the first draft left it untouched, and that
      // was not survivable" is the sentence a later author most needs — so the
      // ban is on the assertions that were false, spelled out.
      for (const lie of [
        "`sync_work_package_release_verdict` is NOT TOUCHED",
        "`sync_work_package_release_verdict` is untouched",
        "leaves that predicate UNTOUCHED",
        "verdict is untouched and stays",
      ]) {
        expect(text.toLowerCase(), `${label}: "${lie}"`).not.toContain(
          lie.toLowerCase(),
        );
      }
    }
    // …and both places that describe the verdict say what it actually does.
    for (const [label, text] of [
      registerRow("D7.06"),
      overlapRow("D7.05 Release checklist"),
      overlapIndexEntry(20),
    ]) {
      expect(text, `${label}: seventh state`).toContain("stale");
      expect(text, `${label}: 20261211090200`).toContain("20261211090200");
    }
    // The claim is true of the CODE too: one verdict function, and the seventh
    // state is a refusal inside it rather than a twin beside it.
    const b = body(currency, "sync_work_package_release_verdict");
    const stale = b.slice(b.indexOf("'verdict', 'stale'"));
    expect(stale).toContain("'canRelease', false");
  });

  it("does not claim BOTH moved refusal sentences are character-identical", () => {
    // One is and one is not, and the migration header says so in those words.
    // A register that flattened that back to "identical to the character"
    // would be re-asserting the thing three adversarial passes disproved.
    for (const [label, text] of [
      registerRow("D7.05"),
      overlapRow("D7.05 Release checklist"),
    ]) {
      expect(text, `${label}: blanket identity claim`).not.toContain(
        "refusal sentences and authority envelope identical",
      );
      expect(text, `${label}: names the extension`).toMatch(
        /MATERIALS (sentence|one|refusal)/i,
      );
      expect(text, `${label}: names what did survive`).toMatch(
        /ISOLATION (sentence|one|refusal)/i,
      );
    }
    // And the two sentences really are one-of-each in the SQL.
    const elements = body(engine, "sync_field_readiness_elements");
    expect(elements).toContain(
      "v_detail := 'job plan requires permit/isolation; canonical equipment release does not confirm active isolation';",
    );
    expect(elements).not.toContain(
      "v_detail := 'required materials are not ready'",
    );
  });

  it("claims of the lineage ledger only the refusals the code records", () => {
    // The row said "refusals included" while every refusal returned before the
    // ledger write. The code records the refusals it CAN — the ones with a
    // development case to write against — and the row now says which.
    const [, row] = registerRow("D7.05");
    expect(row).toContain("refused");
    expect(row).toMatch(/not recorded and (are|is) not claimed to be/i);
    const assess = body(record, "assess_package_field_readiness");
    // The three unrecordable refusals return a bare object; the recordable
    // ones go through the one wrapper that writes the run and the audit row.
    for (const bare of [
      "'refusal', 'forbidden'",
      "'refusal', 'work package not found'",
    ]) {
      expect(assess, bare).toContain(bare);
    }
    expect(assess).toContain(
      "sync_record_field_readiness_refusal(p, v_role, v_method,",
    );
    expect(body(record, "sync_record_field_readiness_refusal")).toContain(
      "record_calculation_run(",
    );
  });
});
