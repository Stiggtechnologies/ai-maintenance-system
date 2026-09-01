/**
 * Sync Develop Slice 5C — migration contract (static, no database).
 *
 * DOCKER WAS UNAVAILABLE ON THE MACHINE THIS SLICE WAS WRITTEN ON. The live
 * transcript (scripts/ci-develop-slice5c-smoke.sh) could not be executed
 * locally; CI is its first run. That makes this file, and
 * src/lib/develop/thread.test.ts, the only executable verification the slice
 * had — so it pins the CONTRACT in the migration text rather than trusting a
 * read-through, and every clause below exists because losing it would put a
 * hole in "the digital thread must never break" that nothing else would catch.
 *
 * A later edit that drops a chain kind, admits an unanchored object, lets two
 * revisions be authoritative at once, deletes a thread object, moves an anchor
 * without recording it, lets a machine declare or acknowledge, or reports a
 * comfortable zero over an empty register, fails here before it reaches a
 * database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  SPEC26_CHAIN,
  THREAD_LINK_TYPES,
  THREAD_OBJECT_KINDS,
  THREAD_RECEIPT_STATUSES,
  THREAD_VERSION_STATUSES,
} from "../lib/develop/thread";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const OBJECTS_FILE = "20261206090000_develop_thread_anchor_and_objects.sql";
const VERSIONS_FILE = "20261206090100_develop_thread_authoritative_version.sql";
const CONTINUITY_FILE = "20261206090200_develop_thread_continuity.sql";
const IMPACT_FILE = "20261206090300_develop_thread_impact_receipts.sql";
const SLICE_FILES = [OBJECTS_FILE, VERSIONS_FILE, CONTINUITY_FILE, IMPACT_FILE];

const objects = read(OBJECTS_FILE);
const versions = read(VERSIONS_FILE);
const continuity = read(CONTINUITY_FILE);
const impact = read(IMPACT_FILE);
const joined = [objects, versions, continuity, impact].join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");

/** The executable text, with `comment on … is '…'` documentation removed. */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

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

const NEW_TABLES = [
  { file: objects, name: "thread_severances" },
  { file: objects, name: "thread_objects" },
  { file: objects, name: "thread_links" },
  { file: versions, name: "thread_object_versions" },
  { file: impact, name: "thread_change_receipts" },
];

/* ─────────────────── the slice lands after 5B, in order ─────────────────── */

describe("the slice lands strictly after Slice 5B", () => {
  it("every 5C filename sorts after 20261205090200", () => {
    for (const f of SLICE_FILES) {
      expect(f > "20261205090200_develop_case_interfaces.sql").toBe(true);
    }
  });

  it("orders itself by dependency: objects, versions, continuity, impact", () => {
    expect(OBJECTS_FILE < VERSIONS_FILE).toBe(true);
    expect(VERSIONS_FILE < CONTINUITY_FILE).toBe(true);
    expect(CONTINUITY_FILE < IMPACT_FILE).toBe(true);
    // The later files reuse the earlier ones' tables and vocabulary.
    expect(versions).toContain("thread_objects");
    expect(continuity).toContain("record_thread_severance");
    expect(impact).toContain("thread_object_versions");
  });

  it("reuses Slice 5B's ONE §70 trigger function rather than copying it", () => {
    expect(joined).toContain("enforce_frontline_judgement_is_human");
    expect(joined).not.toContain(
      "create or replace function public.enforce_frontline_judgement_is_human",
    );
  });
});

/* ─────────────── D11.05/D11.19 — ONE chain, ONE anchor ─────────────────── */

describe("the ONE chain (spec II.2 / §26, ruling 5C-R1)", () => {
  it("names all ten kinds server-side, in II.2's order, and TypeScript agrees", () => {
    const fn = body(objects, "sync_thread_object_kinds");
    for (const k of THREAD_OBJECT_KINDS) {
      expect(fn, `${k.key} missing`).toContain(`'${k.key}'`);
    }
    const positions = THREAD_OBJECT_KINDS.map((k) => fn.indexOf(`'${k.key}'`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("does not name the last kind after SAP", () => {
    expect(body(objects, "sync_thread_object_kinds")).not.toMatch(/sap/i);
    expect(body(objects, "sync_thread_object_kinds")).toContain(
      "'eam_equipment'",
    );
  });

  it("expresses §26's chain as a SUBSEQUENCE, not a second vocabulary", () => {
    const fn = body(objects, "sync_thread_spec26_chain");
    for (const k of SPEC26_CHAIN) expect(fn).toContain(`'${k}'`);
    // Every §26 kind is one of the ten.
    const ten = body(objects, "sync_thread_object_kinds");
    for (const k of SPEC26_CHAIN) expect(ten).toContain(`'${k}'`);
  });

  it("derives chain position WITH ORDINALITY, not from an unordered window", () => {
    const fn = body(objects, "sync_thread_chain_position");
    expect(fn).toContain("with ordinality");
    expect(fn).not.toMatch(/row_number/);
  });

  it("names nine link types server-side and TypeScript agrees", () => {
    const fn = body(objects, "sync_thread_link_types");
    for (const t of THREAD_LINK_TYPES) expect(fn).toContain(`'${t.key}'`);
  });

  it("maps every link type onto the SHARED graph's dependency kinds", () => {
    const fn = body(objects, "sync_thread_traversal_kind");
    for (const t of THREAD_LINK_TYPES) expect(fn).toContain(`'${t.key}'`);
    // The six kinds asset_dependencies already declares — no seventh invented.
    const kinds = [
      "functional",
      "utility",
      "topological",
      "control",
      "geographic",
      "logistical",
    ];
    const used = [...fn.matchAll(/,\s*'([a-z]+)'\)/g)].map((m) => m[1]);
    for (const k of used) expect(kinds).toContain(k);
  });

  it("says per kind whether a canonical row exists or it is by reference", () => {
    const fn = body(objects, "sync_thread_object_canonical_home");
    for (const k of THREAD_OBJECT_KINDS) expect(fn).toContain(`'${k.key}'`);
    expect(fn).toContain("design_requirements");
    expect(fn).toContain("acceptance_tests");
    expect(fn).toContain("none — registered by reference");
  });
});

describe("D11.19 — the Asset is the ONE anchor", () => {
  it("adds §26's two missing fields to the ONE asset table, not a new one", () => {
    expect(objects).toContain("alter table public.assets");
    expect(objects).toContain("add column if not exists enterprise_asset_id");
    expect(objects).toContain("add column if not exists functional_location");
    expect(executable).not.toContain("create table if not exists public.asset");
  });

  it("keeps one enterprise identity per organization, partially indexed", () => {
    expect(objects).toContain("idx_assets_enterprise_asset_id");
    expect(objects).toMatch(
      /create unique index if not exists idx_assets_enterprise_asset_id[\s\S]*?where enterprise_asset_id is not null/,
    );
  });

  it("anchor_asset_id is NOT NULL — an unanchored object is not representable", () => {
    expect(table(objects, "thread_objects")).toMatch(
      /anchor_asset_id uuid not null references assets\(id\)/,
    );
  });

  it("refuses to delete an asset that anchors LIVE thread objects", () => {
    const fn = body(objects, "enforce_asset_thread_anchor");
    expect(fn).toContain("raise exception");
    expect(fn).toContain("insufficient_privilege");
    expect(fn).toContain("retire_thread_object");
    // ...and permits the tenant cascade rather than making a tenant undeletable.
    expect(fn).toContain("not exists (select 1 from organizations");
    // ...and RECORDS the cascade it does permit.
    expect(fn).toContain("'asset_cascade'");
    expect(objects).toContain("before delete on public.assets");
  });

  it("populates the enterprise identity through an audited RPC", () => {
    const fn = body(objects, "set_asset_enterprise_identity");
    expect(fn).toContain("app_current_org()");
    expect(fn).toContain("insert into audit_events");
    expect(fn).toContain("previous_state");
    expect(fn).toContain("already belongs to");
  });
});

/* ───────────────── D11.05 — the link model and its walls ────────────────── */

describe("D11.05 — a hop runs forward, and only forward", () => {
  it("refuses a backward hop at the wall, for every writer", () => {
    const fn = body(objects, "enforce_thread_link_integrity");
    expect(fn).toContain("sync_thread_chain_position");
    expect(fn).toMatch(/v_dn_pos <= v_up_pos/);
    expect(fn).toContain("raise exception");
  });

  it("refuses an UNKNOWN position rather than treating it as zero", () => {
    const fn = body(objects, "enforce_thread_link_integrity");
    expect(fn).toMatch(/v_up_pos is null or v_dn_pos is null/);
    expect(fn).toContain(
      "An unknown position is refused, never treated as zero",
    );
  });

  it("refuses a backward hop at the door too", () => {
    expect(body(objects, "link_thread_objects")).toContain(
      "a thread link runs forward along the spec II.2 chain",
    );
  });

  it("refuses a live hop touching a retired object — the dangling endpoint", () => {
    expect(body(objects, "enforce_thread_link_integrity")).toContain(
      "A live link cannot touch a retired thread object",
    );
    expect(body(objects, "link_thread_objects")).toContain("dangling endpoint");
  });

  it("demands a basis on every hop", () => {
    expect(table(objects, "thread_links")).toMatch(
      /basis text not null check \(length\(btrim\(basis\)\) >= 20\)/,
    );
    expect(body(objects, "link_thread_objects")).toContain(
      "an unevidenced thread is a drawing exercise",
    );
  });

  it("refuses cross-tenant and cross-case hops", () => {
    const fn = body(objects, "enforce_thread_link_integrity");
    expect(fn).toContain(
      "belong to the link's own organization".replace("'", "''"),
    );
    expect(fn).toContain("belong to the link''s own development case");
  });

  it("registering does not COPY the canonical row, it points at it", () => {
    const t = table(objects, "thread_objects");
    expect(t).toContain("requirement_id bigint references design_requirements");
    expect(t).toContain(
      "commissioning_test_id bigint references acceptance_tests",
    );
    expect(t).toContain("thread_object_canonical_pointer");
    const fn = body(objects, "register_thread_object");
    expect(fn).toContain("it does not hold a second copy of it");
  });
});

/* ───────────── D11.06 — exactly one authoritative version ──────────────── */

describe("D11.06 — one authoritative revision, held by an index", () => {
  it("is a PARTIAL UNIQUE INDEX, not a trigger that counts rows", () => {
    expect(versions).toMatch(
      /create unique index if not exists idx_thread_version_one_authoritative\s*\n\s*on public\.thread_object_versions\(thread_object_id\)\s*\n\s*where status = 'authoritative'/,
    );
  });

  it("refuses a superseded version with no successor, in the row's own shape", () => {
    expect(table(versions, "thread_object_versions")).toMatch(
      /\(status = 'superseded'\) = \(superseded_by_version_id is not null\)/,
    );
  });

  it("names the three statuses and no fourth", () => {
    const fn = body(versions, "sync_thread_version_statuses");
    for (const s of THREAD_VERSION_STATUSES) expect(fn).toContain(`'${s}'`);
    expect(fn).not.toContain("withdrawn");
  });

  it("supersedes rather than overwrites, writing BOTH pointers", () => {
    const fn = body(versions, "declare_thread_version_authoritative");
    expect(fn).toContain("superseded_by_version_id = v.id");
    expect(fn).toContain("supersedes_version_id = incumbent.id");
    expect(fn).toContain("status = 'superseded'");
  });

  it("demands what changed before a supersession, at the door and at the wall", () => {
    expect(body(versions, "declare_thread_version_authoritative")).toContain(
      "has no statement of what changed",
    );
    expect(body(versions, "enforce_thread_version_integrity")).toContain(
      "change_summary, 20 characters minimum",
    );
  });

  it("separates RECORDING a revision from RELEASING it", () => {
    expect(body(versions, "record_thread_version")).toContain("'draft'");
    expect(body(versions, "record_thread_version")).toContain(
      "Recording a revision does not make it current",
    );
  });

  it("refuses un-superseding and un-releasing for every caller", () => {
    const fn = body(versions, "enforce_thread_version_integrity");
    expect(fn).toContain("A superseded version stays superseded");
    expect(fn).toContain("not returned to draft");
  });

  it("resolution REFUSES and says WHICH empty it is", () => {
    const fn = body(versions, "resolve_thread_authoritative_version");
    expect(fn).toContain("'resolved', false");
    expect(fn).toContain("has been recorded at all");
    expect(fn).toContain("NONE has been declared authoritative");
  });
});

/* ─────────────── D11.20 — the continuity invariant, enforced ────────────── */

describe("D11.20 — the thread cannot be broken silently", () => {
  it("refuses DELETE on every thread table, for every caller", () => {
    for (const { file, name } of NEW_TABLES) {
      const fnName =
        name === "thread_severances"
          ? "enforce_thread_severance_append_only"
          : name === "thread_objects"
            ? "enforce_thread_object_integrity"
            : name === "thread_links"
              ? "enforce_thread_link_integrity"
              : name === "thread_object_versions"
                ? "enforce_thread_version_integrity"
                : "enforce_thread_receipt_integrity";
      const fn = body(file, fnName);
      expect(fn, `${name} DELETE`).toContain("tg_op = 'DELETE'");
      expect(fn, `${name} DELETE refusal`).toContain("insufficient_privilege");
    }
  });

  it("revokes TRUNCATE and guards it with a statement trigger on every table", () => {
    for (const { file, name } of NEW_TABLES) {
      expect(file, `${name} revoke`).toContain(
        `revoke truncate on table public.${name} from anon, authenticated, service_role;`,
      );
      expect(file, `${name} statement guard`).toMatch(
        new RegExp(
          `before truncate on public\\.${name}\\s*\\n\\s*for each statement`,
        ),
      );
    }
  });

  it("every enforcement trigger covers INSERT and UPDATE, and DELETE where it can be dodged", () => {
    for (const t of [
      "trg_thread_object_integrity",
      "trg_thread_link_integrity",
      "trg_thread_version_integrity",
      "trg_thread_receipt_integrity",
    ]) {
      expect(joined).toMatch(
        new RegExp(
          `create trigger ${t}\\s*\\n\\s*before insert or update or delete`,
        ),
      );
    }
    // The ledger's own trigger covers INSERT as well: without an INSERT branch
    // a direct `insert into thread_severances` forges a row that the
    // append-only guard then makes permanently uncorrectable.
    expect(joined).toMatch(
      /create trigger trg_thread_severance_append_only\s*\n\s*before insert or update or delete/,
    );
  });

  it("refuses an anchor that moves outside the recorded act", () => {
    const fn = body(objects, "enforce_thread_object_integrity");
    expect(fn).toContain("app.thread_reanchor_write");
    expect(fn).toContain("anchor is not moved by an UPDATE");
    // ...and refuses one that moves with nobody named, so the §70 wall on
    // anchor_moved_by cannot be walked past with a NULL actor.
    expect(fn).toContain("new.anchor_moved_by is null");
  });

  it("refuses a retirement or a severance done by flipping a column", () => {
    expect(body(objects, "enforce_thread_object_integrity")).toContain(
      "app.thread_retire_write",
    );
    expect(body(objects, "enforce_thread_link_integrity")).toContain(
      "app.thread_sever_write",
    );
  });

  it("requires an actor alongside every terminal status, so §70 has a target", () => {
    expect(table(objects, "thread_objects")).toContain(
      "(status = 'retired') = (retired_by is not null)",
    );
    expect(table(objects, "thread_links")).toContain(
      "(status = 'severed') = (severed_by is not null)",
    );
    // Two equalities, one per column. The single-conjunction form this used to
    // pin ACCEPTS `status='acknowledged', acknowledged_by=null`, which is
    // exactly the row §70's early-return-on-a-null-actor lets through.
    expect(table(impact, "thread_change_receipts")).toContain(
      "(status = 'unacknowledged') = (acknowledged_by is null)",
    );
    expect(table(impact, "thread_change_receipts")).toContain(
      "(status = 'unacknowledged') = (acknowledged_at is null)",
    );
  });

  it("records the cascades it permits and never the tenant one it cannot", () => {
    expect(body(objects, "enforce_thread_object_integrity")).toContain(
      "'case_cascade'",
    );
    expect(body(objects, "enforce_asset_thread_anchor")).toContain(
      "'asset_cascade'",
    );
    const rec = body(objects, "record_thread_severance");
    expect(rec).toContain("not exists (select 1 from organizations");
    expect(rec).toContain("return null");
  });

  it("the ledger carries snapshots, not foreign keys to the vanished row", () => {
    const t = table(objects, "thread_severances");
    expect(t).toContain("subject_snapshot jsonb not null");
    // development_case_id is deliberately NOT a foreign key.
    expect(t).toMatch(/development_case_id uuid,/);
    expect(t).not.toMatch(
      /development_case_id uuid[^\n]*references development_cases/,
    );
  });

  it("a severance always states why", () => {
    expect(table(objects, "thread_severances")).toMatch(
      /reason text not null check \(length\(btrim\(reason\)\) >= 20\)/,
    );
    for (const fn of [
      body(continuity, "sever_thread_link"),
      body(continuity, "retire_thread_object"),
      body(continuity, "reanchor_thread_object"),
    ]) {
      expect(fn).toContain("20 characters minimum");
      expect(fn).toContain("record_thread_severance");
    }
  });

  it("retiring severs every live hop in the SAME transaction", () => {
    const fn = body(continuity, "retire_thread_object");
    const cut = fn.indexOf("update thread_links");
    const retire = fn.indexOf("update thread_objects");
    expect(cut).toBeGreaterThan(-1);
    expect(retire).toBeGreaterThan(-1);
    // Hops first: otherwise the object is retired while live links still touch
    // it, which is the dangling-endpoint break.
    expect(cut).toBeLessThan(retire);
  });

  it("the continuity report separates BREAKS from GAPS and refuses an empty CDE", () => {
    const fn = body(continuity, "check_thread_continuity");
    expect(fn).toContain("'breaks', v_breaks");
    expect(fn).toContain("'gaps', v_gaps");
    expect(fn).toContain("'intact', jsonb_array_length(v_breaks) = 0");
    expect(fn).toContain("'refused', true");
    expect(fn).toContain("'intact', null");
    expect(fn).toContain(
      "is indistinguishable from a perfectly maintained thread",
    );
  });

  it("the report looks for all four break routes", () => {
    const fn = body(continuity, "check_thread_continuity");
    for (const kind of [
      "'anchor_loss'",
      "'dangling_link'",
      "'backward_link'",
      "'multiple_authoritative_versions'",
      "'version_chain_hole'",
    ]) {
      expect(fn, kind).toContain(kind);
    }
  });

  it("names the requirements that never entered the CDE rather than hiding the cost", () => {
    expect(body(continuity, "check_thread_continuity")).toContain(
      "'requirements_outside_cde'",
    );
  });
});

/* ──────────── D11.07 — receipts produced by the change itself ───────────── */

describe("D11.07 — a change produces a receipt somebody must answer", () => {
  it("the producer is a trigger on the version, not a report", () => {
    expect(impact).toMatch(
      /create trigger trg_thread_change_receipts\s*\n\s*after insert or update on public\.thread_object_versions/,
    );
  });

  it("a FIRST issue produces no receipts", () => {
    expect(body(impact, "raise_thread_change_receipts")).toContain(
      "new.supersedes_version_id is null",
    );
  });

  it("never reads OLD on an INSERT — tg_op is checked in its own statement", () => {
    const fn = body(impact, "raise_thread_change_receipts");
    const tgop = fn.indexOf(
      "if tg_op = 'UPDATE' and old.status = 'authoritative' then",
    );
    expect(tgop).toBeGreaterThan(-1);
    // No `old.` reference outside that guarded branch.
    const after = fn.slice(fn.indexOf("end if;", tgop));
    expect(after).not.toContain("old.");
  });

  it("a receipt is BORN unacknowledged, and that is an explicit state", () => {
    const t = table(impact, "thread_change_receipts");
    expect(t).toContain("status text not null default 'unacknowledged'");
    const fn = body(impact, "sync_thread_receipt_statuses");
    for (const s of THREAD_RECEIPT_STATUSES) expect(fn).toContain(`'${s}'`);
  });

  it("snapshots what changed, so the receipt survives its source moving on", () => {
    const t = table(impact, "thread_change_receipts");
    expect(t).toContain("source_object_ref text not null");
    expect(t).toContain("source_version_label text not null");
    expect(t).toContain("change_summary text not null");
  });

  it("one receipt per downstream object per change", () => {
    expect(table(impact, "thread_change_receipts")).toContain(
      "unique (source_version_id, thread_object_id)",
    );
    expect(body(impact, "raise_thread_change_receipts")).toContain(
      "on conflict (source_version_id, thread_object_id) do nothing",
    );
  });

  it("answering demands a note on BOTH terminal readings", () => {
    expect(table(impact, "thread_change_receipts")).toMatch(
      /status = 'unacknowledged'\s*\n\s*or \(acknowledgement_note is not null/,
    );
    expect(body(impact, "acknowledge_thread_receipt")).toContain(
      "20 characters minimum",
    );
  });

  it("keeps not_applicable distinct from acknowledged", () => {
    const fn = body(impact, "acknowledge_thread_receipt");
    expect(fn).toContain("'acknowledged'");
    expect(fn).toContain("'not_applicable'");
    expect(fn).toContain("we looked and it does not reach us");
  });

  it("a receipt is answered once, for every caller", () => {
    expect(body(impact, "enforce_thread_receipt_integrity")).toContain(
      "A receipt is answered once",
    );
  });

  it("§42 — the declarer cannot acknowledge, at the door AND at the wall", () => {
    expect(body(impact, "acknowledge_thread_receipt")).toContain(
      "you declared this revision authoritative",
    );
    const wall = body(impact, "enforce_thread_receipt_integrity");
    expect(wall).toContain(
      "select declared_by, thread_object_id into v_declarer",
    );
    expect(wall).toContain("a delivery confirmation the sender wrote");
    // ...and on INSERT, because a receipt can be born answered.
    expect(wall).toContain(
      "tg_op = 'INSERT' or new.acknowledged_by is distinct from old.acknowledged_by",
    );
  });
});

describe("D11.07 — the traversal refuses rather than under-reporting", () => {
  it("REFUSES an empty result and says which empty it is", () => {
    const fn = body(impact, "get_case_thread_impact");
    expect(fn).toContain("'refused', true");
    expect(fn).toContain("nothing is downstream of it BY DESIGN");
    expect(fn).toContain("it is unassessed");
    expect(fn).toContain("'downstreamCount', null");
  });

  it("REFUSES on a gap and nulls the count rather than reporting a floor", () => {
    const fn = body(impact, "get_case_thread_impact");
    expect(fn).toContain("jsonb_array_length(v_gaps) > 0");
    expect(fn).toContain("a floor and not the affected set");
  });

  it("counts a chain skip, a missing release and the depth limit as gaps", () => {
    const fn = body(impact, "get_case_thread_impact");
    expect(fn).toContain("'chain_skip'");
    expect(fn).toContain("'no_authoritative_version'");
    expect(fn).toContain("'source_has_no_authoritative_version'");
    expect(fn).toContain("'depth_limit'");
  });

  it("does not use a temporary table in a STABLE read path", () => {
    expect(body(impact, "get_case_thread_impact")).not.toMatch(
      /create temporary table/i,
    );
  });

  it("bounds the recursion", () => {
    expect(body(impact, "get_case_thread_impact")).toContain("d.hops < 32");
    expect(body(impact, "raise_thread_change_receipts")).toContain(
      "d.hops < 32",
    );
  });

  it("the receipts read REFUSES over a case with no registered CDE", () => {
    const fn = body(impact, "get_case_thread_receipts");
    expect(fn).toContain("'refused', v_objects = 0");
    expect(fn).toContain("it is a project with no thread to change");
    expect(fn).toContain(
      "case when v_objects = 0 then null else v_outstanding end",
    );
  });
});

/* ─────────────────── D11.21 — ONE graph, honest ledger ─────────────────── */

describe("D11.21 — §34's nineteen edges", () => {
  const spec34 = body(impact, "sync_spec34_edges");

  it("names all nineteen", () => {
    const count = [...spec34.matchAll(/'edge'\s*,\s*'/g)].length;
    expect(count).toBe(19);
  });

  it("names each one's canonical home and an honest status", () => {
    for (const s of ["'live_on_thread'", "'live_elsewhere'", "'absent'"]) {
      expect(spec34).toContain(s);
    }
    const absent = [...spec34.matchAll(/'absent'/g)].length;
    // FIVE edges have an endpoint object that does not exist yet. If a later
    // slice builds one (§24 Contract, §27 WorkPackage, §28 Constraint, §32
    // Benefit, §33 Lesson), this number goes DOWN and this assertion is the
    // reminder to move that row out of `absent` rather than leave the ledger
    // claiming a hole that has been filled.
    expect(absent).toBe(5);
  });

  it("closes Slice 5A's named DesignObject hole on the thread, not elsewhere", () => {
    expect(spec34).toContain("Requirement IMPLEMENTED_BY DesignObject");
    expect(spec34).toContain("DesignObject BECOMES Asset");
    expect(spec34).toContain(
      "thread_links: requirement → equipment_specification",
    );
  });

  it("does not widen asset_dependencies to hold them", () => {
    expect(executable).not.toContain("alter table public.asset_dependencies");
    expect(executable).not.toContain("alter table asset_dependencies");
    expect(rawJoined).toContain(
      "NOT ONE of §34's nineteen edges is asset → asset",
    );
  });

  it("emits ONE graph payload in the shape the shared traversal reads", () => {
    const fn = body(impact, "get_case_thread_graph");
    expect(fn).toContain("'nodes', v_nodes");
    expect(fn).toContain("'edges', coalesce(v_thread_edges");
    expect(fn).toContain("v_anchor_edges");
    expect(fn).toContain("v_asset_edges");
    expect(fn).toContain("asset_dependencies");
    expect(fn).toContain("'commonCauseGroups', '[]'::jsonb");
  });

  it("REFUSES an empty register rather than drawing a clean picture", () => {
    const fn = body(impact, "get_case_thread_graph");
    expect(fn).toContain("'refused', v_total = 0");
    expect(fn).toContain("an unmapped plant has none");
  });

  it("counts only what it computed, and says so for the rest", () => {
    const fn = body(impact, "get_case_thread_graph");
    expect(fn).toContain("'caseCount', null");
    expect(fn).toContain("Not counted here");
  });
});

/* ───────────────────────── §70 and the walls ────────────────────────────── */

describe("§70 — no machine declares, acknowledges or severs", () => {
  const BOUND = [
    ["trg_thread_object_retirer_is_human", "'retired_by'"],
    ["trg_thread_object_registrar_is_human", "'registered_by'"],
    ["trg_thread_object_anchor_mover_is_human", "'anchor_moved_by'"],
    ["trg_thread_link_severer_is_human", "'severed_by'"],
    ["trg_thread_link_linker_is_human", "'linked_by'"],
    ["trg_thread_version_declarer_is_human", "'declared_by'"],
    ["trg_thread_receipt_acknowledger_is_human", "'acknowledged_by'"],
  ] as const;

  it("binds a §70 trigger to every actor column, on INSERT and UPDATE", () => {
    for (const [trigger, column] of BOUND) {
      const at = joined.indexOf(`create trigger ${trigger}`);
      expect(at, trigger).toBeGreaterThan(-1);
      const decl = joined.slice(at, at + 400);
      expect(decl, trigger).toContain("before insert or update");
      expect(decl, trigger).toContain("enforce_frontline_judgement_is_human");
      expect(decl, trigger).toContain(column);
    }
  });

  it("refuses the AI-operator identity at the door of every §70 act", () => {
    for (const fn of [
      body(versions, "declare_thread_version_authoritative"),
      body(continuity, "sever_thread_link"),
      body(continuity, "retire_thread_object"),
      body(continuity, "reanchor_thread_object"),
      body(impact, "acknowledge_thread_receipt"),
    ]) {
      expect(fn).toContain("'ai_admin'");
      expect(fn).toContain("§70");
    }
  });

  it("puts the §70 check BEFORE the role list, so it is not dead code", () => {
    // A role list that already excludes ai_admin would shadow the specific
    // refusal and it would never be reachable — the exact class of dead code
    // inside a definer this repository refuses.
    for (const fn of [
      body(versions, "declare_thread_version_authoritative"),
      body(continuity, "sever_thread_link"),
      body(continuity, "retire_thread_object"),
      body(continuity, "reanchor_thread_object"),
      body(impact, "acknowledge_thread_receipt"),
    ]) {
      const ai = fn.indexOf("= 'ai_admin' then");
      const list = fn.indexOf("not in\n     ('admin'");
      expect(ai).toBeGreaterThan(-1);
      expect(list).toBeGreaterThan(-1);
      expect(ai).toBeLessThan(list);
    }
  });
});

describe("tenancy, provenance and the house rules", () => {
  it("every new table is org-scoped with RLS in its own migration", () => {
    for (const { file, name } of NEW_TABLES) {
      expect(file, `${name} rls`).toContain(
        `alter table public.${name} enable row level security;`,
      );
      expect(file, `${name} policy`).toMatch(
        new RegExp(
          `create policy ${name}_read on public\\.${name}\\s*\\n\\s*for select to authenticated using \\(organization_id = app_current_org\\(\\)\\)`,
        ),
      );
      expect(file, `${name} drop guard`).toContain(
        `drop policy if exists ${name}_read on public.${name};`,
      );
    }
  });

  it("grants no client write policy on any of them", () => {
    for (const { file, name } of NEW_TABLES) {
      const policies = [
        ...file.matchAll(
          new RegExp(
            `create policy [a-z_]+ on public\\.${name}[\\s\\S]*?;`,
            "g",
          ),
        ),
      ].map((m) => m[0]);
      for (const p of policies) {
        expect(p, `${name}: ${p.slice(0, 80)}`).toContain("for select");
      }
    }
  });

  it("uses auth.uid() for the dual-caller gate, never current_user in (...)", () => {
    expect(executable).not.toMatch(/current_user\s+in\s*\(\s*'authenticated'/);
    expect(joined).toContain("if auth.uid() is null then");
  });

  it("records the service-path writes the walls ADMIT, never on a refusing path", () => {
    for (const fn of [
      body(objects, "enforce_thread_object_integrity"),
      body(objects, "enforce_thread_link_integrity"),
      body(versions, "enforce_thread_version_integrity"),
      body(impact, "enforce_thread_receipt_integrity"),
    ]) {
      const backstop = fn.indexOf("record_frontline_service_write");
      expect(backstop).toBeGreaterThan(-1);
      // The backstop is the last thing before `return new` — never before a
      // raise, where the insert would be lost with the aborted statement.
      expect(fn.slice(backstop)).not.toContain("raise exception");
    }
  });

  it("every mutation RPC writes audit_events with previous and new state", () => {
    for (const fn of [
      body(objects, "set_asset_enterprise_identity"),
      body(objects, "register_thread_object"),
      body(objects, "link_thread_objects"),
      body(versions, "record_thread_version"),
      body(versions, "declare_thread_version_authoritative"),
      body(continuity, "sever_thread_link"),
      body(continuity, "retire_thread_object"),
      body(continuity, "reanchor_thread_object"),
      body(impact, "acknowledge_thread_receipt"),
    ]) {
      expect(fn).toContain("insert into audit_events");
      expect(fn).toContain("previous_state");
      expect(fn).toContain("new_state");
    }
  });

  it("revokes anon from every function it grants and reloads the schema", () => {
    const granted = [
      ...joined.matchAll(/grant execute on function public\.([a-z_0-9]+)\(/g),
    ].map((m) => m[1]);
    expect(granted.length).toBeGreaterThan(10);
    for (const fn of new Set(granted)) {
      expect(joined, `${fn} revoke`).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\(`),
      );
    }
    for (const f of SLICE_FILES) {
      expect(raw(f)).toContain("notify pgrst, 'reload schema';");
    }
  });

  it("marks every transaction marker as LOCAL so it cannot outlive the write", () => {
    // `app\.[a-z_]+`, not `app\.thread_[a-z_]+`: the asset-identity marker this
    // slice added is not thread-prefixed, and a regex that cannot see a marker
    // cannot police it.
    const sets = [
      ...joined.matchAll(
        /set_config\('app\.[a-z_]+',\s*'[a-z]*',\s*([a-z]+)\)/g,
      ),
    ];
    expect(sets.length).toBeGreaterThan(3);
    for (const m of sets) expect(m[1]).toBe("true");
  });

  it("clears every marker it grants", () => {
    for (const marker of [
      "app.thread_version_write",
      "app.thread_sever_write",
      "app.thread_retire_write",
      "app.thread_reanchor_write",
      "app.thread_severance_write",
      "app.asset_identity_write",
    ]) {
      const grants = [
        ...joined.matchAll(
          new RegExp(
            `set_config\\('${marker.replace(".", "\\.")}', 'granted', true\\)`,
            "g",
          ),
        ),
      ].length;
      const clears = [
        ...joined.matchAll(
          new RegExp(
            `set_config\\('${marker.replace(".", "\\.")}', '', true\\)`,
            "g",
          ),
        ),
      ].length;
      expect(grants, marker).toBeGreaterThan(0);
      expect(clears, marker).toBe(grants);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * REPAIR PASS — one clause per defect found in adversarial review.
 *
 * Each of these pins a hole that existed in the first cut of this slice and
 * that nothing else would have caught, because Docker was unavailable and no
 * statement in these four files has ever been executed locally.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("REPAIR — the receipt answer constraint cannot be satisfied by a half-answer", () => {
  const receipts = table(impact, "thread_change_receipts");

  // The single-conjunction form
  //   (status = 'unacknowledged') = (acknowledged_at is null and acknowledged_by is null)
  // ACCEPTS status='acknowledged', acknowledged_at=now(), acknowledged_by=null:
  // the right-hand side is false, the left is false, so it passes. That row
  // then walks past the §70 wall (which returns early on a NULL actor) and past
  // the §42 check (gated on acknowledged_by is not null) — a receipt answered
  // by nobody.
  it("writes TWO equalities, one per column, like its three sibling tables", () => {
    expect(receipts).toMatch(
      /\(status = 'unacknowledged'\) = \(acknowledged_at is null\)/,
    );
    expect(receipts).toMatch(
      /\(status = 'unacknowledged'\) = \(acknowledged_by is null\)/,
    );
  });

  it("never folds the two columns into one conjunction", () => {
    expect(receipts).not.toMatch(
      /acknowledged_at is null and acknowledged_by is null/,
    );
  });

  it("keeps the paired form on the three siblings that already had it", () => {
    const obj = table(objects, "thread_objects");
    const link = table(objects, "thread_links");
    expect(obj).toMatch(/\(status = 'retired'\) = \(retired_at is not null\)/);
    expect(obj).toMatch(/\(status = 'retired'\) = \(retired_by is not null\)/);
    expect(link).toMatch(/\(status = 'severed'\) = \(severed_at is not null\)/);
    expect(link).toMatch(/\(status = 'severed'\) = \(severed_by is not null\)/);
  });
});

describe("REPAIR — §42 covers INSERT, not only UPDATE", () => {
  const wall = body(impact, "enforce_thread_receipt_integrity");

  // A receipt can be BORN answered. Gating the declarer-cannot-acknowledge
  // check on TG_OP='UPDATE' leaves a single INSERT that signs its own delivery.
  it("runs the declarer check outside the UPDATE branch", () => {
    const at = wall.indexOf(
      "cannot also record that the downstream object received it",
    );
    expect(at).toBeGreaterThan(-1);
    const guard = wall.lastIndexOf("if tg_op = 'UPDATE' then", at);
    const closed = wall.lastIndexOf("if auth.uid() is null then", at);
    // The §42 refusal must not sit inside the UPDATE block: the tenancy block
    // that follows it opens after the UPDATE block closes.
    expect(wall).toMatch(
      /tg_op = 'INSERT' or new\.acknowledged_by is distinct from old\.acknowledged_by/,
    );
    expect(guard).toBeLessThan(at);
    expect(closed).toBeLessThan(0);
  });

  it("resolves both endpoints and the source revision on INSERT as well as UPDATE", () => {
    expect(wall).toMatch(/o\.organization_id <> new\.organization_id/);
    expect(wall).toMatch(/src\.organization_id <> new\.organization_id/);
    expect(wall).toMatch(/v_source_version_object <> new\.source_object_id/);
  });

  it("scopes the receipts read's own join to the caller's organization", () => {
    expect(body(impact, "get_case_thread_receipts")).toMatch(
      /join thread_objects t on t\.id = r\.thread_object_id and t\.organization_id = v_org/,
    );
  });
});

describe("REPAIR — the §26 identity columns are walled for every caller", () => {
  // `assets` carries the baseline `for all to authenticated` policy, so an
  // RPC-only guard on these two columns is not a guard at all.
  it("installs a BEFORE UPDATE trigger on assets", () => {
    expect(objects).toMatch(/before update on public\.assets/);
    expect(objects).toContain("enforce_asset_thread_identity");
  });

  it("refuses an identity change without the marker the RPC sets", () => {
    const wall = body(objects, "enforce_asset_thread_identity");
    expect(wall).toMatch(
      /new\.enterprise_asset_id is distinct from old\.enterprise_asset_id/,
    );
    expect(wall).toMatch(
      /new\.functional_location is distinct from old\.functional_location/,
    );
    expect(wall).toMatch(
      /current_setting\('app\.asset_identity_write', true\)/,
    );
  });

  it("sets and clears that marker inside set_asset_enterprise_identity", () => {
    const rpc = body(objects, "set_asset_enterprise_identity");
    expect(rpc).toContain(
      "set_config('app.asset_identity_write', 'granted', true)",
    );
    expect(rpc).toContain("set_config('app.asset_identity_write', '', true)");
  });

  // Break definition (1) says "an anchor in another tenant". That was checked
  // only on writes to thread_objects, so it could be produced from the asset.
  it("refuses moving an anchoring asset to another organization", () => {
    const wall = body(objects, "enforce_asset_thread_identity");
    expect(wall).toMatch(
      /new\.organization_id is distinct from old\.organization_id/,
    );
    expect(wall).toMatch(/from thread_objects where anchor_asset_id = old\.id/);
  });
});

describe("REPAIR — the severance ledger has a door", () => {
  it("revokes record_thread_severance from service_role as well", () => {
    expect(objects).toMatch(
      /revoke all on function public\.record_thread_severance\([^)]*\)\s*\n?\s*from public, anon, authenticated, service_role;/,
    );
  });

  it("refuses a direct INSERT into thread_severances", () => {
    const wall = body(objects, "enforce_thread_severance_append_only");
    expect(wall).toMatch(/tg_op = 'INSERT'/);
    expect(wall).toMatch(
      /current_setting\('app\.thread_severance_write', true\)/,
    );
  });

  it("covers INSERT on the append-only trigger", () => {
    expect(objects).toMatch(
      /create trigger trg_thread_severance_append_only\s*\n\s*before insert or update or delete on public\.thread_severances/,
    );
  });

  it("refuses naming a person from another tenant, and backstops a service write", () => {
    const wall = body(objects, "enforce_thread_severance_append_only");
    expect(wall).toMatch(/p\.organization_id = new\.organization_id/);
    expect(wall).toContain("record_frontline_service_write");
  });
});

describe("REPAIR — every recorded severance is readable afterwards", () => {
  // A row written with development_case_id = null matches no case filter, so
  // the only read that existed could never return it: recorded-but-unreadable,
  // which for the person looking afterwards is the same as silent.
  it("stamps the asset cascade with the real development case, one row per case", () => {
    const wall = body(objects, "enforce_asset_thread_anchor");
    expect(wall).toMatch(/group by t\.development_case_id/);
    expect(wall).toMatch(
      /record_thread_severance\(old\.organization_id, v_row\.case_id,/,
    );
    expect(wall).not.toMatch(
      /record_thread_severance\(old\.organization_id, null,/,
    );
  });

  it("counts the versions and UNANSWERED receipts a cascade destroys", () => {
    expect(body(objects, "enforce_thread_object_integrity")).toContain(
      "sync_thread_object_cascade_losses",
    );
    const real = body(impact, "sync_thread_object_cascade_losses");
    expect(real).toContain("unacknowledged_receipts_lost");
    expect(real).toMatch(/status = 'unacknowledged'/);
  });

  it("ships a tenant-scoped read for the rows whose case is gone", () => {
    expect(continuity).toContain(
      "create or replace function public.get_org_thread_severances",
    );
    const fn = body(continuity, "get_org_thread_severances");
    expect(fn).toMatch(/caseDeleted/);
    expect(fn).toMatch(/'orphaned', v_orphaned/);
    expect(continuity).toMatch(
      /grant execute on function public\.get_org_thread_severances\(int\)\s*to authenticated, service_role;/,
    );
  });

  it("REFUSES the case ledger over an empty CDE instead of saying nothing was cut", () => {
    const fn = body(continuity, "get_case_thread_severances");
    expect(fn).toMatch(/'refused', v_objects = 0/);
  });

  // Both cascades pass auth.uid(), so `severed_by is not null` reports a case
  // deletion as a decision somebody took.
  it("derives byAPerson from the ROUTE, never from the actor column", () => {
    for (const fn of [
      "get_case_thread_severances",
      "get_org_thread_severances",
    ]) {
      const f = body(continuity, fn);
      expect(f).toMatch(
        /'byAPerson', s\.route in \('object_retired', 'link_severed', 'object_reanchored'\)/,
      );
      expect(f).not.toMatch(/'byAPerson', s\.severed_by is not null/);
    }
  });
});

describe("REPAIR — the canonical-row cascade is permitted and recorded, not refused", () => {
  // design_requirements and acceptance_tests both cascade from capital_projects,
  // and thread_objects cascades from them. Without this route the refusal fires
  // mid-cascade with the case, org and anchor all present — making a capital
  // project undeletable, with an error about an object the operator never named.
  it("carries the route in the ledger's own CHECK", () => {
    expect(table(objects, "thread_severances")).toContain("canonical_cascade");
  });

  it("escapes and records when the canonical row is the thing going", () => {
    const wall = body(objects, "enforce_thread_object_integrity");
    expect(wall).toMatch(
      /not exists \(select 1 from design_requirements where id = old\.requirement_id\)/,
    );
    expect(wall).toMatch(
      /not exists \(select 1 from acceptance_tests where id = old\.commissioning_test_id\)/,
    );
    expect(wall).toMatch(/'canonical_cascade', 'thread_object'/);
  });
});

describe("REPAIR — a released revision is immutable in what it says", () => {
  const wall = body(versions, "enforce_thread_version_integrity");

  // Freezing the LABEL while leaving content_ref writable is the same defect
  // wearing a different column: "Rev C is authoritative" pointing at a document
  // nobody released, with no supersession and no receipt.
  it("freezes content, issue date, summary and basis once it is not a draft", () => {
    expect(wall).toMatch(/old\.status <> 'draft'/);
    expect(wall).toMatch(/new\.content_ref is distinct from old\.content_ref/);
    expect(wall).toMatch(/new\.issued_on is distinct from old\.issued_on/);
    expect(wall).toMatch(
      /new\.change_summary is distinct from old\.change_summary/,
    );
    expect(wall).toMatch(
      /new\.declaration_basis is distinct from old\.declaration_basis/,
    );
  });

  it("refuses a draft that claims to supersede something", () => {
    expect(wall).toMatch(
      /new\.status = 'draft' and new\.supersedes_version_id is not null/,
    );
  });
});

describe("REPAIR — a retired object has no current revision", () => {
  // retire_thread_object never touches the version rows, so the incumbent stays
  // `authoritative` for ever. Reporting it as current sends somebody to build
  // to a sheet whose object is on the record as out of the thread.
  it("refuses to resolve one, and still names the label for the history", () => {
    const fn = body(versions, "resolve_thread_authoritative_version");
    expect(fn).toMatch(/if o\.status = 'retired' then/);
    expect(fn).toMatch(/'resolved', false/);
    expect(fn).toMatch(/'lastAuthoritativeLabel', v\.version_label/);
  });

  it("reports the same state at case scale as a GAP, never as a break", () => {
    const fn = body(continuity, "check_thread_continuity");
    expect(fn).toContain("retired_object_holds_released_version");
    const at = fn.indexOf("retired_object_holds_released_version");
    // It is appended to v_gaps, not v_breaks.
    expect(fn.lastIndexOf("v_gaps := v_gaps ||", at)).toBeGreaterThan(
      fn.lastIndexOf("v_breaks := v_breaks ||", at),
    );
  });

  it("hands out the DRAFT IDS the release act needs", () => {
    expect(body(versions, "resolve_thread_authoritative_version")).toMatch(
      /'drafts', v_draft_rows/,
    );
    expect(body(impact, "get_case_thread_graph")).toMatch(/'drafts',/);
    expect(body(impact, "get_case_thread_graph")).toMatch(/'versionId', v\.id/);
  });
});

describe("REPAIR — the impact traversal refuses on what it cannot see", () => {
  const fn = body(impact, "get_case_thread_impact");

  // The walk sees only live links and live objects, so a severance is invisible
  // to it — and a severance is precisely what removes something from the
  // affected set while leaving it physically downstream.
  it("names a severed hop out of the region as a gap", () => {
    expect(fn).toContain("severed_hop_out_of_region");
    expect(fn).toMatch(/l\.status = 'severed'/);
  });

  it("names a live hop into a retired object as a gap", () => {
    expect(fn).toContain("retired_object_in_path");
    expect(fn).toMatch(/dn\.status = 'retired'/);
  });

  it("names a backward hop as itself rather than reporting a depth limit", () => {
    expect(fn).toContain("backward_link");
    expect(fn).toMatch(
      /sync_thread_chain_position\(dn\.object_kind\), -1\)\s*\n?\s*<= coalesce\(sync_thread_chain_position\(up\.object_kind\), 999\)/,
    );
  });
});

describe("REPAIR — a receipt says whether its region was a floor", () => {
  it("stamps the gapped-region verdict on the row that is raised", () => {
    const t = table(impact, "thread_change_receipts");
    expect(t).toContain("source_region_gapped");
    // NULLABLE: "nobody assessed it" is a third state, not `false`.
    expect(t).toMatch(/source_region_gapped boolean,/);
    const trg = body(impact, "raise_thread_change_receipts");
    expect(trg).toMatch(/v_gapped := v_gap_note is not null/);
    expect(trg).toMatch(/source_region_gapped, source_region_gap_note/);
  });

  it("reports the count and the case's supersessions in the read", () => {
    const fn = body(impact, "get_case_thread_receipts");
    expect(fn).toMatch(/'raisedOverAGappedRegion'/);
    expect(fn).toMatch(/'supersessions'/);
    expect(fn).toMatch(/v\.supersedes_version_id is not null/);
  });
});

describe("REPAIR — the continuity read is closed and complete", () => {
  it("uses the closed org gate, like every other read in the slice", () => {
    const fn = body(continuity, "check_thread_continuity");
    expect(fn).toMatch(
      /if v_caller_org is null then\s*\n\s*return jsonb_build_object\('error', 'forbidden'\)/,
    );
    expect(fn).not.toMatch(
      /v_caller_org is null or organization_id = v_caller_org/,
    );
  });

  it("reports a supersession pointer that is not answered from the other end", () => {
    expect(body(continuity, "check_thread_continuity")).toContain(
      "one_way_supersession",
    );
  });
});

describe("REPAIR — no shipped string states a count the data does not hold", () => {
  it("never claims six absent §34 edges", () => {
    expect(rawJoined.toLowerCase()).not.toMatch(/six are absent/);
    expect(rawJoined.toLowerCase()).not.toMatch(/six are ABSENT/i);
  });

  it("derives the absent count in the payload rather than writing it in prose", () => {
    const fn = body(impact, "get_case_thread_graph");
    expect(fn).toMatch(/e->>'status' = 'absent'/);
    expect(fn).toMatch(/jsonb_array_length\(coalesce\(v_spec34/);
  });

  it("still carries exactly five absent edges, and the prose does not fix a number", () => {
    const absent = [...impact.matchAll(/'status','absent'/g)].length;
    expect(absent).toBe(5);
  });

  it("cites a function that exists", () => {
    expect(rawJoined).not.toContain("get_case_thread_map");
  });
});

describe("REPAIR — the third §70 severance act is watched like the other two", () => {
  it("writes a security event when an anchor moves", () => {
    const fn = body(continuity, "reanchor_thread_object");
    expect(fn).toContain("insert into security_events");
    expect(fn).toContain("insert into audit_events");
  });
});

describe("REPAIR — a refusal never promises a route the schema forbids", () => {
  // The reference stays unique across retired rows on purpose. Three messages
  // told the operator to re-register instead of saying so.
  it("does not tell the reader to register a retired object again", () => {
    expect(rawJoined).not.toContain(
      "Register the object again and re-make the links",
    );
    expect(rawJoined).not.toContain(
      "register the object against the other asset instead",
    );
  });

  it("distinguishes an already-registered reference from a spent one", () => {
    const rpc = body(objects, "register_thread_object");
    expect(rpc).toMatch(
      /select status into v_existing_status from thread_objects/,
    );
    expect(rpc).toMatch(/v_existing_status = 'live'/);
    expect(rpc).toMatch(/RETIRED/);
  });
});
