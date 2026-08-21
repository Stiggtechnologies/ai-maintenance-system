/**
 * Every producer must fill the contract its own release gate checks.
 *
 * WHY THIS EXISTS. 20260829090000 added a BEFORE UPDATE OF status trigger that
 * refuses `approved` unless ten fields are non-blank. It shipped without
 * anyone checking whether the platform's own producers write those fields.
 * They wrote none of the five that gate turns on, so every recommendation the
 * loop raised from 2026-08-29 onward was permanently un-approvable — and the
 * failure appeared only at the moment a human clicked approve, as a raise from
 * a trigger, during a live demo.
 *
 * A gate and its producers are one mechanism. Nothing was testing them
 * together, so this does: it resolves the FINAL definition of every function
 * in the migration chain that inserts a recommendation, and requires each
 * insert to name all five contract columns.
 *
 * Resolving the final definition matters. `run_agent_loop` is defined in
 * migration 7 and replaced in 20260921000000; asserting against the first hit
 * would test a definition the database does not have. This replays the chain
 * in filename order and keeps the last writer, which is what Postgres does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  migrationFiles,
  stripComments,
} from "./support/migrationPolicies";

/** The five fields the release gate turns on, and nothing else does. */
const CONTRACT_COLUMNS = [
  "consequence_summary",
  "alternatives_considered",
  "required_completion_date",
  "required_approver_role",
  "verification_method",
] as const;

interface ProducerInsert {
  fn: string;
  source: string;
  columns: string[];
}

/** Reads the parenthesised column list of an `insert into recommendations`. */
function columnListAt(text: string, from: number): string[] | null {
  const open = text.indexOf("(", from);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  for (; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return text
    .slice(open + 1, i)
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The function definitions the database ends up with: filename order, last
 * definition of each name wins.
 */
function resolveFinalFunctions(): Map<
  string,
  { body: string; source: string }
> {
  const final = new Map<string, { body: string; source: string }>();
  for (const file of migrationFiles()) {
    const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    const re =
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
    for (const m of sql.matchAll(re)) {
      const start = m.index as number;
      const end = sql.indexOf("\n$$;", start);
      if (end === -1) continue;
      final.set(m[1].toLowerCase(), {
        body: sql.slice(start, end + 4),
        source: file,
      });
    }
  }
  return final;
}

const finalFunctions = resolveFinalFunctions();

const producers: ProducerInsert[] = [];
for (const [fn, { body, source }] of finalFunctions) {
  for (const m of body.matchAll(
    /insert\s+into\s+(?:public\.)?recommendations\b/gi,
  )) {
    const columns = columnListAt(body, (m.index as number) + m[0].length);
    if (columns) producers.push({ fn, source, columns });
  }
}

/**
 * Producers that still do not fill the contract, each with the reason it was
 * not fixed here and the date the exemption was taken. The list may shrink and
 * may never grow: a NEW producer that skips the contract fails the test below,
 * which is the whole point — the 2026-08-29 gate shipped precisely because
 * nobody checked the producers when it landed.
 */
const KNOWN_INCOMPLETE: { fn: string; reason: string; since: string }[] = [
  {
    fn: "persist_inspection_recommendation_package",
    reason:
      "Caller-supplied: it inserts a JSON payload handed to it by the inspection pipeline, so the " +
      "contract fields have to come from that caller rather than be derived here. Deriving them " +
      "inside the function would invent content on behalf of an inspector who did record findings " +
      "and simply was not asked for these fields. Fixing it means changing the payload contract and " +
      "its caller, which is a feature-lane change.",
    since: "2026-08-20",
  },
];

const exempt = new Set(KNOWN_INCOMPLETE.map((k) => k.fn));

/**
 * Producers that raise a recommendation with NO asset, and are therefore
 * permanently un-approvable on C8.11.
 *
 * This was the undisclosed half of C5.24. Fixing the five narrative fields
 * moved the posture on a fresh chain to 7 approvable / 10 blocked — and 7 of
 * those 10 are blocked on `asset_id`, a field that is not one of the five and
 * was not mentioned anywhere in the fix. Every one of them is a "KPI breach:"
 * row from `compute_kpi_snapshot`.
 *
 * It is NOT fixed here, and the reason is the same reason C8.18 is left blank:
 * there is no defensible value. "Schedule Compliance" and "Data Completeness"
 * are organisation-level measures; naming an asset for them would invent a
 * scope the measurement does not have, which is the exact fabrication this
 * workstream exists to delete. Loosening C8.11 so an org-level recommendation
 * can satisfy it is a change to what the C8 contract MEANS — a governance
 * decision, not a repair.
 *
 * So it is recorded, counted and pinned instead of being quietly carried. The
 * list may shrink and may never grow.
 */
const KNOWN_UNASSETED: { fn: string; reason: string; since: string }[] = [
  {
    fn: "compute_kpi_snapshot",
    reason:
      "Raises 'KPI breach:' recommendations for organisation-level measures — schedule compliance, " +
      "data completeness, emergency maintenance percentage. These have no asset and no functional " +
      "location, so C8.11 cannot be satisfied without inventing one. The recommendations are real " +
      "and are raised; they cannot be approved until either the C8 contract admits an org-level " +
      "scope or the KPI service resolves a responsible asset. Both are governance decisions.",
    since: "2026-08-20",
  },
  {
    fn: "run_proactive_agent_passes",
    reason:
      "One of its three inserts is a crew-capacity rebalance ('Capacity: rebalance workload from X'), " +
      "which is about a craft's workload rather than a machine. Same shape as the KPI rows: the " +
      "recommendation is about the organisation, and C8.11 asks about an asset.",
    since: "2026-08-20",
  },
];

describe("recommendation producers fill the contract they are gated on", () => {
  it("finds the producers at all", () => {
    // If the parser stops finding inserts, every assertion below passes
    // vacuously — the exact failure this file exists to prevent.
    expect(producers.length).toBeGreaterThanOrEqual(7);
    expect(finalFunctions.has("run_agent_loop")).toBe(true);
    expect(finalFunctions.get("run_agent_loop")?.source).toBe(
      "20260921000000_recommendation_contract_producers.sql",
    );
  });

  it("every producer insert names all five contract columns", () => {
    const gaps = producers
      .filter((p) => !exempt.has(p.fn))
      .flatMap((p) => {
        const missing = CONTRACT_COLUMNS.filter((c) => !p.columns.includes(c));
        return missing.length === 0
          ? []
          : [`${p.fn} (${p.source}) omits: ${missing.join(", ")}`];
      });
    expect(gaps).toEqual([]);
  });

  it("keeps the known-incomplete list shrinking, with a reason and a date", () => {
    for (const k of KNOWN_INCOMPLETE) {
      expect(finalFunctions.has(k.fn), `${k.fn} no longer exists`).toBe(true);
      expect(k.reason.length, `${k.fn} needs a real reason`).toBeGreaterThan(
        60,
      );
      expect(k.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // A ratchet: the list may only get shorter.
    expect(KNOWN_INCOMPLETE.length).toBeLessThanOrEqual(1);
  });

  /**
   * C8.11 is a blocking field too, and leaving it out blocks approval just as
   * hard as leaving out a narrative. Every producer that omits `asset_id` must
   * appear on KNOWN_UNASSETED with an argued reason — so the residual is a
   * disclosed, counted decision rather than something a reader discovers by
   * running the posture query.
   */
  it("discloses every producer that raises a recommendation with no asset", () => {
    const unasseted = [
      ...new Set(
        producers.filter((p) => !p.columns.includes("asset_id")).map((p) => p.fn),
      ),
    ].sort();
    expect(unasseted).toEqual(KNOWN_UNASSETED.map((k) => k.fn).sort());
    for (const k of KNOWN_UNASSETED) {
      expect(finalFunctions.has(k.fn), `${k.fn} no longer exists`).toBe(true);
      expect(k.reason.length, `${k.fn} needs a real reason`).toBeGreaterThan(120);
      expect(k.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(KNOWN_UNASSETED.length).toBeLessThanOrEqual(2);
  });
});

describe("the release gate is stronger than the producers, not weaker", () => {
  const gate = finalFunctions.get("check_recommendation_contract");
  const blank = finalFunctions.get("contract_field_blank");
  const narrative = finalFunctions.get("contract_narrative_blank");

  it("treats a non-answer as blank", () => {
    // Producers now write these fields automatically, which creates a way to
    // satisfy the gate without answering it. Before this, 'TBD' passed.
    expect(blank, "contract_field_blank must exist").toBeDefined();
    for (const sentinel of [
      "tbd",
      "n/a",
      "none",
      "unknown",
      "not determined",
    ]) {
      expect(blank?.body).toContain(`'${sentinel}'`);
    }
  });

  it("holds narrative fields to a length a sentence needs", () => {
    expect(narrative?.body).toMatch(
      /length\s*\(\s*btrim\s*\(\s*p_value\s*\)\s*\)\s*<\s*24/,
    );
  });

  it("checks every contract field through the blank helpers, not btrim", () => {
    expect(gate?.source).toBe(
      "20260921000000_recommendation_contract_producers.sql",
    );
    for (const column of [
      "consequence_summary",
      "alternatives_considered",
      "verification_method",
    ]) {
      expect(gate?.body).toContain(`contract_narrative_blank(r.${column})`);
    }
    expect(gate?.body).toContain(
      "contract_field_blank(r.required_approver_role)",
    );
    expect(gate?.body).toContain("r.required_completion_date is not null");
  });

  it("still refuses approval from a trigger, not from application code", () => {
    // The gate has to hold whatever writes the table. If this ever becomes a
    // check in the UI, a direct PostgREST update walks straight past it.
    const enforce = finalFunctions.get("enforce_recommendation_contract");
    expect(enforce?.body).toMatch(/raise\s+exception/i);
    const chain = migrationFiles()
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    expect(chain).toMatch(
      /create\s+trigger\s+trg_recommendation_contract[\s\S]{0,200}before\s+update\s+of\s+status\s+on\s+recommendations/i,
    );
  });

  /**
   * THE FUNCTION THE TRIGGER ACTUALLY CALLS.
   *
   * 20260921000000 strengthened `check_recommendation_contract` and left the
   * live chain alone. That chain is
   *   trg_recommendation_contract → enforce_recommendation_contract()
   *                               → recommendation_contract_gaps(NEW)
   * and `recommendation_contract_gaps` still used plain `btrim(x) = ''`. On a
   * real Postgres 16 the preflight reported 7 missing fields for a row reading
   * issue='TBD', rationale='n/a', consequence='none' — and the trigger
   * approved it.
   *
   * The comment on `contract_field_blank` says it exists "so the release gate
   * and the posture report cannot drift apart". They drifted in the same
   * migration that said so, in the fail-open direction, and this file did not
   * notice because it only ever asked about the preflight.
   */
  it("puts the blank helpers in the path that ENFORCES, not only the preflight", () => {
    const gaps = finalFunctions.get("recommendation_contract_gaps");
    expect(gaps?.source).toBe(
      "20260921003000_signature_and_contract_gate_repair.sql",
    );
    for (const column of [
      "consequence_summary",
      "alternatives_considered",
      "verification_method",
    ]) {
      expect(gaps?.body).toContain(`contract_narrative_blank(r.${column})`);
    }
    for (const column of ["issue", "rationale", "action", "required_approver_role"]) {
      expect(gaps?.body).toContain(`contract_field_blank(r.${column})`);
    }
    // And no survivor of the old predicate, which is what let 'TBD' through.
    expect(gaps?.body).not.toMatch(/coalesce\s*\(\s*btrim/i);

    // The trigger must still route through it, or the assertions above are
    // about a function nothing calls.
    const enforce = finalFunctions.get("enforce_recommendation_contract");
    expect(enforce?.body).toContain("recommendation_contract_gaps(new)");
  });

  it("reports approvable vs blocked, from the same predicate the gate uses", () => {
    const posture = finalFunctions.get("get_recommendation_contract_posture");
    expect(posture?.body).toContain("releasable_rows");
    expect(posture?.body).toContain("blocked_rows");
    // Not a second copy of the predicate — a call into the gate itself, so the
    // report cannot tell an approver a row is ready and then refuse it.
    expect(posture?.body).toContain(
      "lateral check_recommendation_contract(r.id)",
    );
  });
});
