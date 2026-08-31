/**
 * Sync Develop Slice 4C — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice4c-smoke.sh against
 * a real local database (a schedule diagnosed one defect at a time, a §50
 * score refused on an empty set rather than returned as 100, a Monte Carlo
 * REFUSED by name on a failing schedule, a simulation recorded with its seed
 * and reproduced from it, and a P80 that finally exists because a
 * distribution does).
 *
 * This file pins the CONTRACT in the migration text so a later edit that
 * widens a threshold, manufactures a percentile, puts a sampler in SQL, drops
 * the server-side gate or lets a published weight drift from the TypeScript
 * fails before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  DEFAULT_SIMULATION_ITERATIONS,
  SCHEDULE_CALC_KEYS,
  SCHEDULE_CALC_VERSION,
  SCHEDULE_CONFIDENCE_COMPONENTS,
  SCHEDULE_DEFECT_CLASSES,
  SCHEDULE_QUALITY_POLICY,
  SCHEDULE_SCORE_COMPONENTS,
  SCHEDULE_SIMULATION_POLICY,
} from "../lib/develop/schedule";
import { INTEGRATED_RISK_KERNEL_VERSION } from "../lib/modelling/integrated-risk";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const QUALITY_FILE = "20261202090000_develop_schedule_quality.sql";
const CHAIN_FILE = "20261202090100_develop_risk_schedule_economics.sql";
const SIM_FILE = "20261202090200_develop_schedule_simulation.sql";
/**
 * The repair migration. Adversarial review of the first three files found one
 * defect in eleven places — the door validated the SHAPE of what a client sent
 * and trusted its CONTENT, and the read then vouched for the result in words
 * the server had never checked — so this file re-issues the affected
 * functions. Every assertion below that concerns a function it re-issues now
 * reads the EFFECTIVE definition (the last `create or replace`), which is what
 * the database ends up with. A test that pinned a superseded body would be a
 * test of history.
 */
const REPAIR_FILE = "20261202090300_develop_slice4c_repair.sql";
const SLICE_FILES = [QUALITY_FILE, CHAIN_FILE, SIM_FILE, REPAIR_FILE];

const quality = read(QUALITY_FILE);
const chain = read(CHAIN_FILE);
const sim = read(SIM_FILE);
const repair = read(REPAIR_FILE);
const joined = [quality, chain, sim, repair].join("\n");
const all = joined;
const rawJoined = SLICE_FILES.map(raw).join("\n");

/**
 * The executable text with `comment on … is '…'` payloads removed — those are
 * DOCUMENTATION that happens to live in a string literal, so a check like
 * "does anything here sample a random number" reads its own disclaimer as a
 * hit. (The 4A/4B precedent, kept.)
 */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

function body(source: string, fn: string): string {
  // The LAST definition, never the first: a function re-issued by the repair
  // migration is the one the database runs, and pinning the earlier body would
  // assert a contract nothing enforces any more.
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("\n$$;", at));
}

/* ────────────────── the migrations land after 4B, in order ────────────── */

describe("the slice lands strictly after Slice 4B", () => {
  it("every 4C filename sorts after 20261201090400", () => {
    for (const f of SLICE_FILES) {
      expect(f > "20261201090400_develop_forecast_confidence.sql").toBe(true);
    }
    // ...and among themselves, in the order they depend on each other: the
    // quality diagnosis exists before the door that re-runs it.
    expect(QUALITY_FILE < CHAIN_FILE).toBe(true);
    expect(CHAIN_FILE < SIM_FILE).toBe(true);
    expect(SIM_FILE < REPAIR_FILE).toBe(true);
  });
});

/* ───────────────────── D5.13 — the nine defect classes ────────────────── */

describe("all nine II.6 defect classes are diagnosed", () => {
  it("every class key exists in the diagnosis", () => {
    expect(SCHEDULE_DEFECT_CLASSES).toHaveLength(9);
    for (const c of SCHEDULE_DEFECT_CLASSES) {
      expect(quality, `${c.key} is never diagnosed`).toContain(`'${c.key}'`);
    }
  });

  it("every class has a threshold published in sync_schedule_quality_policy", () => {
    const policy = body(quality, "sync_schedule_quality_policy");
    for (const c of SCHEDULE_DEFECT_CLASSES) {
      expect(policy, `${c.key} has no published threshold`).toContain(c.key);
    }
  });

  it("a class that cannot be diagnosed reports NOT DIAGNOSABLE, never 'pass'", () => {
    const cls = body(quality, "sync_schedule_defect_class");
    expect(cls).toContain("'not_diagnosable'");
    // The severity ladder is evaluated with the diagnosable test FIRST, so an
    // undiagnosable class can never fall through to 'pass'.
    const notDiag = cls.indexOf("'not_diagnosable'");
    const pass = cls.indexOf("else 'pass' end");
    expect(notDiag).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(notDiag);
    // ...and it contributes NO weight: a null never averages in.
    expect(cls).toMatch(/componentScore[\s\S]{0,200}then null/);
  });

  it("each blind class carries a NAMED reason, not a shrug", () => {
    for (const needle of [
      "Re-export with total_float_hours",
      "the export did not include the constraint column",
      "the export did not include the lag column",
      "The calendar NAME is recorded and is not evidence",
    ]) {
      expect(quality, `missing blind reason: ${needle}`).toContain(needle);
    }
  });
});

/* ────────────────────── D5.31 — the §50 score itself ──────────────────── */

describe("the §50 Schedule Quality Score (D5.31)", () => {
  const policy = body(quality, "sync_schedule_quality_policy");

  it("the six §50 components and their weights are pinned on both sides", () => {
    let total = 0;
    for (const c of SCHEDULE_SCORE_COMPONENTS) {
      expect(policy, `${c.key} is not a published weight`).toMatch(
        new RegExp(`'${c.key}',\\s*${c.weight}`),
      );
      total += c.weight;
    }
    // A weight vector that does not sum to its own total makes every score it
    // produces mean something different.
    expect(total).toBe(100);
  });

  it("D5.14's four confidence components are pinned and also sum to 100", () => {
    let total = 0;
    for (const c of SCHEDULE_CONFIDENCE_COMPONENTS) {
      total += c.weight;
    }
    expect(total).toBe(100);
    for (const key of [
      "structure",
      "uncertainty_expressed",
      "import_history",
      "scope_anchoring",
    ]) {
      expect(policy, `${key} is not a published confidence weight`).toContain(
        key,
      );
    }
  });

  it("every published threshold matches the TypeScript mirror exactly", () => {
    for (const [key, value] of Object.entries(SCHEDULE_QUALITY_POLICY)) {
      expect(policy, `${key} drifted from the migration`).toMatch(
        new RegExp(`'${key}',\\s*${value}\\b`),
      );
    }
  });

  it("AN EMPTY SCHEDULE IS REFUSED, never scored 100", () => {
    const g = body(all, "get_case_schedule_quality");
    expect(g).toContain("if v_n = 0 then");
    expect(g).toContain("no schedule activities at all");
    expect(g).toContain("An empty schedule passes every defect test");
    // The score variable is only ever assigned when the refusal is null.
    expect(g).toMatch(
      /if v_refusal is null and v_weight_used > 0 then\s+v_score/,
    );
  });

  it("a schedule too sparse to carry a network is refused BY THE NUMBERS", () => {
    const g = body(all, "get_case_schedule_quality");
    expect(g).toContain("minimumActivities");
    expect(g).toContain("minimumRelationships");
    expect(g).toContain("it is not configurable");
  });

  it("a score over too few diagnosable components is refused outright", () => {
    const g = body(all, "get_case_schedule_quality");
    expect(g).toContain("minimumDiagnosableComponents");
    expect(g).toContain("overstates itself by four");
  });

  it("confidence is refused whenever the score is", () => {
    const g = body(all, "get_case_schedule_quality");
    expect(g).toContain("confidenceRefusal");
    expect(g).toContain("a second number carrying the first number''s problem");
  });
});

/* ──────────────── D5.15 — the gate, and it is SERVER-SIDE ─────────────── */

describe("Monte Carlo is gated on schedule quality (D5.15)", () => {
  const door = body(all, "record_case_schedule_simulation");

  it("the recording door RE-RUNS the diagnosis rather than trusting the client", () => {
    expect(door).toContain("get_case_schedule_quality(c.id)");
    expect(door).toMatch(/gate'->>'permitted'[\s\S]{0,120}false then/);
  });

  it("a failing gate REFUSES and names the failing classes", () => {
    expect(door).toContain("failingClasses");
    expect(door).toContain("Monte Carlo on poor logic is not useful");
    // The refusal is recorded as a run, so a refused simulation is a fact in
    // the ledger rather than only an error on a screen.
    expect(door).toMatch(
      /v_run := record_calculation_run\([\s\S]{0,200}'case_schedule_simulation'/,
    );
  });

  it("there is NO waiver, override or force path for any identity", () => {
    for (const forbidden of [
      "p_override",
      "p_force",
      "waive_schedule_quality",
      "accept_schedule_defect",
      "ignore_gate",
    ]) {
      expect(executable, `${forbidden} exists`).not.toContain(forbidden);
    }
  });

  it("the gate threshold cannot be supplied by the caller", () => {
    // A minimum score the client passes in is a gate the client sets.
    expect(door).not.toMatch(/p_result->>'minimumScore'/);
    expect(door).not.toMatch(/p_result->>'qualityScore'/);
    expect(door).toContain("v_quality->'score'");
  });
});

/* ─────────── determinism, and the inputs actually being the inputs ─────── */

describe("a result nobody can reproduce is not evidence", () => {
  const door = body(all, "record_case_schedule_simulation");

  it("the seed is mandatory, whole, and inside the kernel's 32-bit range", () => {
    expect(door).toContain("4294967295");
    expect(door).toContain("v_seed <> trunc(v_seed)");
    expect(door).toContain("cannot be reproduced");
  });

  it("the iteration count is mandatory and floored", () => {
    expect(door).toContain("minimumIterations");
    expect(door).toContain("Percentile noise at that sample size");
    expect(SCHEDULE_SIMULATION_POLICY.minimumIterations).toBe(1000);
    expect(DEFAULT_SIMULATION_ITERATIONS).toBeGreaterThanOrEqual(
      SCHEDULE_SIMULATION_POLICY.minimumIterations,
    );
  });

  it("the sample count must equal the declared iterations", () => {
    expect(door).toContain("sampleCount");
    expect(door).toContain("percentiles of something else");
  });

  it("the seed and the iteration count are COLUMNS, not just prose", () => {
    expect(sim).toMatch(/seed\s+bigint\s+not null/);
    expect(sim).toMatch(
      /iterations\s+int\s+not null\s+check \(iterations >= 1000\)/,
    );
    expect(sim).toMatch(/kernel_version\s+text\s+not null/);
  });

  it("the declared input digest is recomputed server-side and must match", () => {
    expect(door).toContain("sync_case_schedule_digest(c.id)");
    expect(door).toContain("activityDigest");
    expect(door).toContain("riskDigest");
    expect(door).toContain("name inputs it never saw");
  });

  it("the digest covers every field that changes an answer", () => {
    const d = body(all, "sync_case_schedule_digest");
    for (const field of [
      "duration_hours",
      "optimistic_hours",
      "pessimistic_hours",
      "predecessor_key",
      "lag_hours",
      "probability",
      "delay_days_optimistic",
      "delay_days_pessimistic",
    ]) {
      expect(d, `${field} is outside the digest`).toContain(field);
    }
  });

  it("the recorded run names the kernel that produced it", () => {
    expect(door).toContain("kernelVersion");
    expect(INTEGRATED_RISK_KERNEL_VERSION).toMatch(/^integrated-risk\/4C\//);
  });
});

/* ─────────────── THE CENTRAL RULE: never manufacture a spread ─────────── */

describe("no distribution is ever manufactured", () => {
  it("there is NO SAMPLER IN SQL — one simulator, and it is the kernel", () => {
    for (const forbidden of [
      "random()",
      "setseed",
      "normal_rand",
      "gen_random_uuid()::text::numeric",
      "tablesample",
    ]) {
      expect(executable, `${forbidden} appears in SQL`).not.toContain(
        forbidden,
      );
    }
    expect(
      body(all, "sync_schedule_simulation_policy"),
      "the kernel module is not named",
    ).toContain(SCHEDULE_SIMULATION_POLICY.kernelModule);
  });

  it("no percentile is derived from a deterministic figure anywhere in the SQL", () => {
    // The literal shapes a fabricated spread takes: a multiplier on the
    // deterministic figure, a fixed percentage margin, a default sigma.
    for (const pattern of [
      /deterministic[a-z_]*\s*\*\s*[0-9.]/i,
      /v_eac\s*\*\s*[0-9.]/i,
      /v_det\s*\*\s*[0-9.]/i,
      /p80\s*:?=\s*[a-z_]*deterministic/i,
      /default[_ ]?(variance|sigma|spread)/i,
    ]) {
      expect(
        joined,
        `a percentile is derived from a deterministic figure: ${pattern}`,
      ).not.toMatch(pattern);
    }
  });

  it("the P50/P80 the forecast shows come from a RECORDED simulation or from nothing", () => {
    const f = body(all, "get_case_forecast_confidence");
    expect(f).toContain("get_case_schedule_simulation(c.id)");
    // The percentile variables are only ever assigned inside the "we have a
    // current recorded distribution AND the gate still permits it" branch.
    // Asserted by POSITION rather than by proximity: a distance window is a
    // guard that a few more lines of correct code silently widens.
    const haveAt = f.indexOf("if v_have then");
    const absenceAt = f.indexOf("THE ABSENCE, WHEN THERE IS ONE");
    expect(haveAt).toBeGreaterThan(-1);
    expect(absenceAt).toBeGreaterThan(haveAt);
    for (const assign of [
      "v_cost_p50 := (v_sim->>'costP50')",
      "v_cost_p80 := (v_sim->>'costP80')",
      "v_p50_finish := (v_sim->>'p50Finish')",
      "v_p80_finish := (v_sim->>'p80Finish')",
    ]) {
      const first = f.indexOf(assign);
      expect(first, `${assign} is not assigned`).toBeGreaterThan(haveAt);
      expect(
        first,
        `${assign} is assigned outside the have-a-distribution branch`,
      ).toBeLessThan(absenceAt);
      expect(
        f.indexOf(assign, first + 1),
        `${assign} is assigned more than once`,
      ).toBe(-1);
    }
    expect(f).toContain(
      "there is no arithmetic that converts one into the other",
    );
  });

  it("a stale simulation's percentiles are NOT offered as the current forecast", () => {
    const g = body(all, "get_case_schedule_simulation");
    expect(g).toContain("staleReason");
    expect(g).toContain("more dangerous than no P80, because it is specific");
    const f = body(all, "get_case_forecast_confidence");
    expect(f).toMatch(/v_have\s*:=[\s\S]{0,120}'current'\)::boolean, false\)/);
  });

  it("a zero-width sample is refused rather than labelled", () => {
    const door = body(all, "record_case_schedule_simulation");
    expect(door).toContain("zero width");
    expect(door).toContain("deterministic answer with percentile labels");
  });

  it("a run with nothing to sample is refused", () => {
    const door = body(all, "record_case_schedule_simulation");
    expect(door).toContain("minimumSampledRanges");
    expect(door).toContain("Nothing on this case varies");
  });

  it("percentiles must be finite and non-decreasing, at the door AND the column", () => {
    const door = body(all, "record_case_schedule_simulation");
    expect(door).toContain("did not come off a sample");
    expect(sim).toContain("constraint ssr_percentiles_ordered");
    expect(sim).toMatch(
      /p10_hours <= p50_hours and p50_hours <= p80_hours and p80_hours <= p90_hours/,
    );
  });

  it("a THREE-POINT impact is required at the schema, not only in the act", () => {
    expect(chain).toContain("constraint rsi_delay_is_a_range");
    expect(chain).toMatch(/delay_days_pessimistic > delay_days_optimistic/);
    // ...and the ACT says the same thing in words the user sees.
    expect(body(all, "record_risk_schedule_impact")).toContain(
      "single-point estimate wearing three columns",
    );
  });

  it("the risk register's unbounded likelihood is NOT read as a probability", () => {
    expect(chain).toContain("is an unbounded score, not a probability");
    // No arm anywhere converts risks.likelihood into a probability.
    expect(executable).not.toMatch(/r\.likelihood\s*\/\s*[0-9]/);
    expect(executable).not.toMatch(/likelihood\s*\/\s*100/);
  });
});

/* ─────────────────── D5.09 — attribution comes OUT of it ──────────────── */

describe("per-risk attribution is measured, not assumed (D5.09)", () => {
  const door = body(all, "record_case_schedule_simulation");

  it("every attributed risk must be an edge that actually exists", () => {
    expect(door).toContain("risk_schedule_impacts i");
    expect(door).toContain("an assumed ordering wearing a computed one");
  });

  it("the attribution is stored with the run it came out of", () => {
    expect(sim).toMatch(/attribution jsonb not null default '\[\]'::jsonb/);
    expect(sim).toMatch(/criticality jsonb not null default '\[\]'::jsonb/);
  });

  it("risks outside the chain are recorded as a refusal BY NAME", () => {
    expect(door).toContain("understates exposure by exactly them");
    expect(chain).toContain("unlinkedRisks");
  });
});

/* ───────────────────────── D5.08 — the chain in data ──────────────────── */

describe("risk → schedule → economics is walkable in data (D5.08)", () => {
  it("the edge references the CANONICAL risk and schedule stores", () => {
    expect(chain).toMatch(/risk_id uuid not null references risks\(id\)/);
    expect(chain).toMatch(
      /schedule_task_id bigint not null references shutdown_tasks\(id\)/,
    );
    // No parallel risk store and no parallel schedule store.
    expect(chain).not.toMatch(/create table[^;]*project_risks/i);
    expect(chain).not.toMatch(/create table[^;]*schedule_activities/i);
  });

  it("the days→money hop uses the canonical numeric-assumption store", () => {
    expect(chain).toContain("financial_assumptions");
    expect(chain).toContain("sync_case_delay_cost_key");
    // A NEW table for a rate would be a fork of the assumption family.
    expect(chain).not.toMatch(/create table[^;]*delay_cost/i);
  });

  it("no cost of delay means the money hop is REFUSED, never defaulted", () => {
    const g = body(chain, "get_case_delay_cost_rate");
    expect(g).toContain("No cost of delay is recorded for this case");
    expect(g).toContain("honestly truncated rather than silently completed");
    expect(g).not.toMatch(/coalesce\s*\(\s*fa\.value\s*,\s*[0-9]/);
  });

  it("a risk must be bound to the case before it can drive its forecast", () => {
    const act = body(all, "record_risk_schedule_impact");
    expect(act).toContain("r.development_case_id is distinct from c.id");
    expect(act).toContain("a driver nobody reviews");
  });

  it("the basis is mandatory at the schema and re-stated in the act", () => {
    expect(chain).toMatch(
      /basis text not null check \(length\(btrim\(basis\)\) >= 20\)/,
    );
    expect(body(all, "record_risk_schedule_impact")).toContain(
      "three numbers somebody liked",
    );
  });
});

/* ────────────────────────────── §70 walls ─────────────────────────────── */

describe("§70 — no AI identity determines a forecast or a risk exposure", () => {
  it("recording a risk-to-schedule impact refuses ai_admin BY NAME", () => {
    const act = body(all, "record_risk_schedule_impact");
    expect(act).toContain("= 'ai_admin' then");
    expect(act).toContain("spec §70");
    expect(act).toContain("forbidden to determine");
    // ai_admin is not in the allowed-role list either, so the wall cannot be
    // walked around by deleting the named refusal.
    expect(act).toMatch(
      /not in\s*\n?\s*\('admin','executive','maintenance_manager','reliability_engineer','planner'\)/,
    );
  });

  it("recording a simulation refuses ai_admin BY NAME", () => {
    const door = body(all, "record_case_schedule_simulation");
    expect(door).toContain("= 'ai_admin' then");
    expect(door).toContain("a human records it");
    expect(door).toMatch(
      /not in\s*\n?\s*\('admin','executive','maintenance_manager','reliability_engineer','planner'\)/,
    );
  });

  it("nothing in the slice approves, accepts or sanctions anything", () => {
    for (const forbidden of [
      "approve_forecast",
      "accept_schedule",
      "sanction_forecast",
    ]) {
      expect(executable, `${forbidden} exists`).not.toContain(forbidden);
    }
  });
});

/* ─────────────────── tenancy, immutability, provenance ────────────────── */

const NEW_TABLES = [
  ["risk_schedule_impacts", chain],
  ["schedule_simulation_runs", sim],
] as const;

describe("every new ledger is org-scoped, guarded and untruncatable", () => {
  for (const [table, source] of NEW_TABLES) {
    it(`${table}: RLS is enabled and org-scoped in the SAME migration`, () => {
      expect(source).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(source).toMatch(
        new RegExp(
          `create policy [a-z_]+ on public\\.${table}[\\s\\S]{0,200}organization_id = app_current_org\\(\\)`,
        ),
      );
    });

    it(`${table}: no client write policy — the act is the only door`, () => {
      expect(source).not.toMatch(
        new RegExp(
          `create policy [a-z_]+ on public\\.${table}\\s+for (insert|update|delete|all)`,
        ),
      );
    });

    it(`${table}: TRUNCATE is refused at statement level AND revoked`, () => {
      expect(source).toMatch(
        new RegExp(
          `create trigger [a-z_]+\\s+before truncate on public\\.${table}\\s+for each statement`,
        ),
      );
      expect(source).toContain(
        `revoke truncate on table public.${table} from anon, authenticated, service_role`,
      );
    });

    it(`${table}: the row trigger covers INSERT, UPDATE and DELETE`, () => {
      expect(source).toMatch(
        new RegExp(
          `create trigger [a-z_]+\\s+before insert or update or delete on public\\.${table}`,
        ),
      );
    });
  }

  it("the dual-caller gate is auth.uid(), never a bare current_user test", () => {
    // 20261130090700 repaired thirteen guards that read
    // `current_user in ('authenticated','anon')` ALONE — dead code inside a
    // SECURITY DEFINER, which runs as the owner. Every guard here pairs it
    // with auth.uid().
    for (const fn of [
      "enforce_risk_schedule_impact",
      "enforce_schedule_simulation_run",
    ]) {
      const g = body(all, fn);
      expect(g, `${fn} has no auth.uid() arm`).toContain(
        "auth.uid() is not null",
      );
    }
  });

  it("a recorded simulation is immutable to clients", () => {
    const g = body(all, "enforce_schedule_simulation_run");
    expect(g).toContain("a recorded simulation is immutable");
    expect(g).toContain("Simulate again and a new run is recorded beside it");
  });

  it("the provenance backstop checks the case actually owns the row", () => {
    for (const [fn, source] of [
      ["enforce_risk_schedule_impact", chain],
      ["enforce_schedule_simulation_run", sim],
    ] as const) {
      expect(body(source, fn)).toContain(
        "organization that does not own its development case",
      );
    }
    // ...and an impact cannot point at another case's activity.
    expect(body(chain, "enforce_risk_schedule_impact")).toContain(
      "does not jump between cases",
    );
  });

  it("every client-callable read and act is revoked from anon", () => {
    const fns = [
      ...joined.matchAll(
        /revoke all on function public\.([a-z_]+)\([^)]*\) from ([^;]+);/g,
      ),
    ];
    expect(fns.length).toBeGreaterThan(8);
    for (const m of fns) {
      expect(m[2], `${m[1]} is not revoked from anon`).toContain("anon");
    }
  });
});

/* ─────────────── the P6 wall grows rather than being widened ──────────── */

describe("the new P6-owned fields join the field wall (D5.28)", () => {
  const guard = body(quality, "enforce_schedule_activity_provenance");

  it("float and constraint columns are guarded on an imported row", () => {
    for (const col of [
      "total_float_hours",
      "constraint_type",
      "constraint_date",
    ]) {
      expect(guard, `${col} is not walled`).toContain(
        `new.${col} is distinct from old.${col}`,
      );
    }
  });

  it("the wall still covers INSERT, UPDATE, DELETE and TRUNCATE", () => {
    expect(guard).toContain("if tg_op = 'TRUNCATE' then");
    expect(guard).toContain("if tg_op = 'INSERT' then");
    expect(guard).toContain("if tg_op = 'DELETE' then");
    // The DELETE arm is load-bearing: dropping an activity is how a schedule
    // is shortened without changing a single number.
    expect(guard).toContain("v_changed := array['row deleted']::text[]");
  });

  it("origin still never flips", () => {
    expect(guard).toContain("new.origin is distinct from old.origin");
    expect(guard).toContain("fixed at creation");
  });

  it("the import refuses a non-finite float and a dateless date constraint", () => {
    const ingest = body(quality, "ingest_schedule_batch");
    expect(ingest).toContain("a float must be a finite number of hours");
    expect(ingest).toContain("a constraint with no date constrains nothing");
    expect(ingest).toContain("a lag must be a finite number of hours");
  });

  it("a relationship annotation must name a predecessor the row declares", () => {
    const ingest = body(quality, "ingest_schedule_batch");
    expect(ingest).toContain("a lag nobody applied");
  });

  it("Sync-authored logic cannot touch an imported activity's relationships", () => {
    const act = body(all, "record_local_schedule_relationship");
    expect(act).toContain("belongs to P6 and is imported with it");
  });
});

/* ─────────────────────── D11.29 — lineage on every calc ───────────────── */

describe("every calculation this slice adds records a lineage run (D11.29)", () => {
  it("the 4C code version is pinned on both sides", () => {
    expect(quality).toContain(`'${SCHEDULE_CALC_VERSION}'`);
    // The 4A and 4B keys KEEP their own versions — bumping a version on
    // unchanged code makes the version stop meaning anything.
    expect(quality).toContain("'develop-controls/4A/2026-11-24'");
    expect(quality).toContain("'develop-performance/4B/2026-12-01'");
  });

  it("every key pinned in sync_calculation_code_version is one a compute function records", () => {
    const pinned = [
      ...quality.matchAll(/\('(case_[a-z_]+)',\s*'develop-[^']+'\)/g),
    ].map((m) => m[1]);
    expect(pinned.length).toBeGreaterThanOrEqual(10);
    const priorSlices = [
      "20261130090600_develop_calculation_lineage.sql",
      "20261201090100_develop_estimate_basis.sql",
      "20261201090200_develop_progress_integrity.sql",
      "20261201090300_develop_earned_value.sql",
      "20261201090400_develop_forecast_confidence.sql",
    ]
      .map(read)
      .join("\n");
    for (const key of pinned) {
      expect(
        joined.includes(`'${key}',`) || priorSlices.includes(`'${key}',`),
        `${key} is pinned but no compute function records it`,
      ).toBe(true);
    }
  });

  it("the three 4C keys are each recorded by a record_calculation_run call", () => {
    for (const key of SCHEDULE_CALC_KEYS) {
      expect(joined, `${key} is never recorded`).toMatch(
        new RegExp(`record_calculation_run\\([\\s\\S]{0,400}'${key}'`),
      );
    }
  });

  it("THE SIMULATION RECORDS ITS SEED AND ITERATION COUNT in the lineage row", () => {
    const door = body(all, "record_case_schedule_simulation");
    // The lineage `inputs` object — not just the dedicated columns — carries
    // them, so a run is replayable from the lineage record alone.
    expect(door).toMatch(
      /record_calculation_run\([\s\S]{0,4000}'seed', v_seed[\s\S]{0,200}'iterations', v_iterations/,
    );
  });

  it("each compute function records its REFUSALS, not only its successes", () => {
    for (const [fn, source] of [
      ["compute_case_schedule_quality", quality],
      ["compute_case_risk_schedule_economics", chain],
      ["compute_case_forecast_confidence", sim],
    ] as const) {
      const b = body(source, fn);
      expect(b, `${fn} records no refusals`).toContain("v_refusals");
      expect(b, `${fn} never refuses outright`).toContain("v_outputs := null");
    }
  });

  it("the READ and the ACT are split — a stable read never writes", () => {
    for (const [fn, source] of [
      ["get_case_schedule_quality", quality],
      ["get_case_risk_schedule_chain", chain],
      ["get_case_delay_cost_rate", chain],
      ["get_case_schedule_simulation", sim],
      ["get_case_simulation_inputs", sim],
      ["get_case_forecast_confidence", sim],
      ["get_case_performance", sim],
      ["sync_case_schedule_digest", sim],
    ] as const) {
      const b = body(source, fn);
      expect(b, `${fn} is not declared stable`).toMatch(/\bstable\b/);
      expect(b, `${fn} writes a lineage row from a read`).not.toContain(
        "record_calculation_run(",
      );
    }
  });

  it("the simulation run is joined to its lineage row, both ways", () => {
    expect(sim).toMatch(
      /calculation_run_id uuid references calculation_runs\(id\)/,
    );
    expect(body(all, "compute_case_forecast_confidence")).toContain(
      "'table', 'schedule_simulation_runs'",
    );
  });

  it("the forecast run no longer hardcodes distributionExists false", () => {
    const c = body(all, "compute_case_forecast_confidence");
    expect(c).toContain("'distributionExists', v_fc->'distribution'->'exists'");
    expect(c).not.toContain("'distributionExists', to_jsonb(false)");
  });

  it("the recorder is still not callable by a client", () => {
    // A lineage row a user could write is a claim that a calculation happened,
    // made by the party the claim is for. Nothing here re-grants it.
    expect(rawJoined).not.toMatch(
      /grant execute on function public\.record_calculation_run[^;]*authenticated/,
    );
  });
});

/* ───────────────── the surface renders the run, not the read ──────────── */

describe("the §51 forecast consumes the distribution rather than restating it", () => {
  it("get_case_performance exposes the three 4C families", () => {
    const g = body(sim, "get_case_performance");
    for (const key of [
      "'scheduleQuality', get_case_schedule_quality",
      "'riskScheduleChain', get_case_risk_schedule_chain",
      "'simulation', get_case_schedule_simulation",
    ]) {
      expect(g, `${key} is not in the one performance read`).toContain(key);
    }
  });

  it("the latest-run loop includes the 4C keys", () => {
    const g = body(sim, "get_case_performance");
    for (const key of SCHEDULE_CALC_KEYS) {
      expect(g, `${key} has no recorded run on the surface`).toContain(key);
    }
  });

  it("what is still not modelled is stated on the surface, not hidden", () => {
    const g = body(sim, "get_case_performance");
    expect(g).toContain("Correlation between risks");
    expect(g).toContain("Resource-constrained simulation");
  });
});

/* ─────────────── the repair: content, not just shape (20261202090300) ──── */

describe("a number the server can derive is never taken from the client", () => {
  const door = body(all, "record_case_schedule_simulation");

  it("the cost base is READ from the earned-value function, not accepted", () => {
    // Proven in review: a planner token POSTed costBase = 999,999,999 on a
    // case whose EAC refuses and §51 printed a $1.000002 B cost P80 beside
    // `deterministic: null`, under an affirmative statement of provenance.
    expect(door).toContain("v_ev := get_case_earned_value(c.id)");
    expect(door).toContain(
      "v_cost_base := nullif(v_ev->'metrics'->'eac'->>'value', '')::numeric",
    );
    expect(door).toContain("v_cost_base_claim");
    expect(door).toContain("The cost base is not a number the client supplies");
    // ...and the client's value is never what is stored.
    expect(door).not.toMatch(
      /v_cost_base\s*:=\s*sync_text_as_numeric\(nullif\(btrim\(coalesce\(p_result->>'costBase'/,
    );
  });

  it("the cost of delay is READ from the assumption that owns it", () => {
    expect(door).toContain("v_rate_read := get_case_delay_cost_rate(c.id)");
    expect(door).toContain(
      "v_rate := nullif(v_rate_read->>'value', '')::numeric",
    );
    expect(door).toContain("v_rate_claim");
    expect(door).not.toMatch(
      /v_rate\s*:=\s*sync_text_as_numeric\(nullif\(btrim\(coalesce\(p_result->>'delayCostPerDay'/,
    );
  });

  it("the currency is the earned-value read's, never the payload's", () => {
    expect(door).toContain(
      "v_currency := nullif(btrim(coalesce(v_ev->>'currency','')), '')",
    );
    expect(door).not.toContain(
      "v_currency := nullif(btrim(coalesce(p_result->>'currency','')), '')",
    );
  });

  it("the declared deterministic duration is bounded by the network itself", () => {
    // No second CPM — a path is at least the longest activity and at most all
    // of them end to end, which is true of every network. Before this, 99999
    // on a 1460-hour network produced a "P80 completion date" in 2016.
    expect(door).toContain("max(t.duration_hours), sum(t.duration_hours)");
    expect(door).toMatch(/v_det\s*<\s*v_dur_max/);
    expect(door).toMatch(/v_det\s*>\s*v_dur_sum/);
    expect(door).toContain("is not a path through this schedule");
  });

  it("the kernel version is pinned server-side and mirrored", () => {
    const policy = body(all, "sync_schedule_simulation_policy");
    expect(policy).toContain("'kernelVersions'");
    expect(policy).toContain(INTEGRATED_RISK_KERNEL_VERSION);
    expect(SCHEDULE_SIMULATION_POLICY.kernelVersions).toContain(
      INTEGRATED_RISK_KERNEL_VERSION,
    );
    expect(door).toContain("v_policy->'kernelVersions' ? v_kernel");
  });

  it("probabilityOnPlan is range-checked at the door AND at the column", () => {
    expect(door).toContain("probabilityOnPlan is");
    expect(door).toMatch(/v_onplan\s*<\s*0\s*or\s*v_onplan\s*>\s*1/);
    expect(repair).toContain("ssr_probability_is_a_probability");
    expect(repair).toMatch(
      /probability_on_plan\s*>=\s*0\s*and\s*probability_on_plan\s*<=\s*1/,
    );
  });

  it("-Infinity is refused everywhere a percentile is checked", () => {
    // It was in the seed check and the cost-base check and absent from the
    // five percentile checks: an omission, not a policy.
    for (const v of [
      "v_det",
      "v_p10",
      "v_p50",
      "v_p80",
      "v_p90",
      "v_exp50",
      "v_exp80",
    ]) {
      expect(door, `${v} accepts -Infinity`).toContain(
        `${v} = '-Infinity'::numeric`,
      );
    }
  });
});

describe("a driver ranking carries numbers the simulation could have produced", () => {
  const door = body(all, "record_case_schedule_simulation");

  it("every attribution row's numbers are bounded by the run they claim to come from", () => {
    expect(door).toContain("occurrenceRate");
    expect(door).toMatch(/v_num\s*<\s*0\s*or\s*v_num\s*>\s*1/);
    expect(door).toContain("abs(v_hours) > v_p90");
    expect(door).toContain("abs(v_days - v_hours / 24) > 1e-6");
    expect(door).toContain("abs(v_num) > v_exp80");
  });

  it("the risk title is taken from the risk, not from the payload", () => {
    expect(door).toContain("jsonb_build_object('riskTitle', v_title)");
    expect(door).toContain("v_attr_clean");
  });

  it("every criticality row names an activity on this case and is a share", () => {
    expect(door).toContain("the criticality ranking names activity");
    expect(door).toContain("criticalityIndex");
    expect(door).toContain("deterministicFloat");
    expect(door).toContain("maximumCriticalityRows");
    expect(SCHEDULE_SIMULATION_POLICY.maximumCriticalityRows).toBeGreaterThan(
      0,
    );
  });
});

describe("the §50 gate is checked where the number is SERVED, not only where it is recorded", () => {
  it("a recorded distribution is not offered once the schedule fails its gate", () => {
    const f = body(all, "get_case_forecast_confidence");
    expect(f).toContain(
      "v_gate_ok := coalesce((v_quality->'gate'->>'permitted')::boolean, false)",
    );
    expect(f).toMatch(/v_have\s*:=[\s\S]{0,200}and v_gate_ok;/);
    expect(f).toContain("NO LONGER passes its §50 quality diagnostics");
  });

  it("a moved cost basis withholds the recorded TOTAL rather than showing it", () => {
    const f = body(all, "get_case_forecast_confidence");
    expect(f).toContain("costCurrent");
    expect(f).toContain("a figure about a superseded base");
  });

  it("the sentence beside a shown cost percentile describes the composition it is", () => {
    // The total IS `deterministic EAC + sampled exposure`; the old sentence
    // said the deterministic figure "was not used to produce them".
    const f = body(all, "get_case_forecast_confidence");
    expect(f).toContain(
      "PLUS the risk exposure the recorded simulation sampled",
    );
    expect(f).toContain("'composition'");
  });
});

describe("the input digest covers every input a recorded figure depends on", () => {
  const d = body(all, "sync_case_schedule_digest");

  it("the planned dates the P50/P80 DATES are anchored to are in it", () => {
    expect(d).toContain("t.planned_start::text");
    expect(d).toContain("t.planned_finish::text");
  });

  it("the cost basis and the delay rate are in it", () => {
    expect(d).toContain("'costDigest'");
    expect(d).toContain("get_case_earned_value(p_case_id)");
    expect(d).toContain("get_case_delay_cost_rate(p_case_id)");
  });

  it("the risk half follows the same OPEN population the chain reports", () => {
    expect(d).toContain("not in ('closed', 'archived')");
    const chainFn = body(all, "get_case_risk_schedule_chain");
    expect(chainFn).toContain("not in ('closed', 'archived')");
    expect(chainFn).toContain("retiredLinkNote");
  });
});

describe("a distribution is never computed over a network the kernel cannot read", () => {
  it("non-FS links and non-zero lags REFUSE the simulation, at the server", () => {
    const support = body(all, "sync_case_schedule_logic_support");
    expect(support).toContain("nonFinishToStartCount");
    expect(support).toContain("laggedCount");
    expect(support).toContain(
      "reads every edge as finish-to-start with zero lag",
    );
    const door = body(all, "record_case_schedule_simulation");
    expect(door).toContain("sync_case_schedule_logic_support(c.id)");
    expect(door).toMatch(/v_logic->>'supported'[\s\S]{0,60}= false then/);
  });

  it("a relationship with NO stated type is disclosed, not passed over", () => {
    const support = body(all, "sync_case_schedule_logic_support");
    expect(support).toContain("assumptionNote");
    expect(support).toContain("it is a reading, not a fact the export stated");
  });
});

describe("the ledger refuses what the door refuses, for callers that skip the door", () => {
  const g = body(all, "enforce_schedule_simulation_run");

  it("§70 is enforced on the ROW, not only in the act", () => {
    expect(g).toContain("new.computed_by");
    expect(g).toContain("'ai_admin'");
    expect(g).toContain("spec §70");
  });

  it("a recorded distribution must carry its lineage run", () => {
    expect(g).toContain("new.calculation_run_id is null");
    expect(g).toContain("D11.29");
  });

  it("a spread over a schedule where nothing varies is refused at the row", () => {
    expect(g).toMatch(
      /sampled_range_count[\s\S]{0,80}risk_link_count[\s\S]{0,40}= 0/,
    );
    expect(g).toContain("p90_hours > new.p10_hours");
  });
});

describe("the logic ledger gets the wall the activity ledger has (R8)", () => {
  it("shutdown_task_dependencies has a provenance trigger on INSERT/UPDATE/DELETE", () => {
    expect(repair).toContain("enforce_schedule_task_dependency");
    expect(repair).toMatch(
      /create trigger trg_schedule_task_dependency\s+before insert or update or delete on public\.shutdown_task_dependencies/,
    );
  });

  it("TRUNCATE is refused at statement level AND revoked", () => {
    expect(repair).toMatch(
      /create trigger trg_schedule_task_dependency_no_truncate\s+before truncate on public\.shutdown_task_dependencies/,
    );
    expect(repair).toContain(
      "revoke truncate on table public.shutdown_task_dependencies from anon, authenticated, service_role",
    );
  });

  it("logic on an IMPORTED activity stays P6's", () => {
    const g = body(all, "enforce_schedule_task_dependency");
    expect(g).toContain("Correct the logic in P6 and re-import");
  });
});

describe("the range that IS the distribution has a governed door (R9)", () => {
  const act = body(all, "set_schedule_activity_duration_range");

  it("§70 refuses the AI identity by name", () => {
    expect(act).toContain("'ai_admin'");
    expect(act).toContain("spec §70");
  });

  it("a basis is mandatory at the schema and re-stated in the act", () => {
    expect(repair).toContain(
      "basis text not null check (length(btrim(basis)) >= 12)",
    );
    expect(act).toContain("state the basis for this range");
  });

  it("the range must bracket the stated duration and its ends must differ", () => {
    expect(act).toContain("does not bracket the activity''s stated duration");
    expect(act).toContain("a point estimate with three columns");
    expect(repair).toContain("sdrb_range_is_a_range");
  });

  it("an ambiguous activity key is REFUSED, never resolved with limit 1", () => {
    expect(act).toContain("v_matches > 1");
    expect(act).not.toMatch(/order by[\s\S]{0,40}limit 1/);
  });
});

describe("§70 reaches every act that determines the forecast (R6)", () => {
  for (const fn of [
    "record_local_schedule_activity",
    "record_local_schedule_relationship",
    "compute_case_schedule_quality",
    "compute_case_risk_schedule_economics",
    "compute_case_forecast_confidence",
  ]) {
    it(`${fn} refuses the AI-operator identity`, () => {
      const b = body(all, fn);
      expect(b).toMatch(/v_role, ''\)\s*=\s*'ai_admin'/);
      expect(b).toContain("§70");
      // ...and ai_admin is gone from the allowed-role list, not merely
      // shadowed by a check somewhere above it.
      expect(b).not.toContain("'admin','ai_admin','executive'");
    });
  }
});

describe("a recorded sentence states what the server checked (R10)", () => {
  const door = body(all, "record_case_schedule_simulation");

  it("the no-cost-exposure refusal reads the real data state", () => {
    expect(door).toContain("Checked here rather than assumed");
    expect(door).toContain("v_costed_edges");
    expect(door).toContain("The submitted result carried no cost exposure");
  });

  it("the stale reason no longer asserts a history the row cannot know", () => {
    const g = body(all, "get_case_schedule_simulation");
    expect(g).toContain("does not match the digest this simulation recorded");
    expect(g).not.toContain(
      "The schedule or its risk edges have changed since this simulation was recorded",
    );
  });

  it("the latest run is picked deterministically", () => {
    const g = body(all, "get_case_schedule_simulation");
    expect(g).toContain("order by computed_at desc, id desc limit 1");
  });
});

describe("the quality read's staleness can see a defect change", () => {
  it("get_case_schedule_quality publishes a content signature of the nine classes", () => {
    const g = body(all, "get_case_schedule_quality");
    expect(g).toContain("'classSignature'");
    const c = body(all, "compute_case_schedule_quality");
    expect(c).toContain("'classSignature', v_q->'classSignature'");
  });

  it("the unrealistic-lag class counts over the same population as its denominator", () => {
    const g = body(all, "get_case_schedule_quality");
    const at = g.indexOf("into v_neglag, v_biglag");
    expect(at).toBeGreaterThan(-1);
    const block = g.slice(at, at + 600);
    expect(block).toContain("t.task_key = d.task_key");
    expect(block).toContain("t.task_key = d.predecessor_key");
  });
});

describe("the repair's own guards are guards, not near-misses", () => {
  it("a distribution narrower than the reporting precision is refused too", () => {
    // Exact equality was the whole test, so p10=p50=p80=1460 with
    // p90=1460.0000001 was accepted: a spread 3.6 milliseconds wide, recorded
    // as the one result this door exists to refuse.
    const door = body(all, "record_case_schedule_simulation");
    expect(door).toMatch(/v_p90 - v_p10\) \* 1000000 < v_det/);
    expect(door).toContain("rounding error");
  });

  it("the logic-support read carries its own tenant gate", () => {
    // Granted to `authenticated` directly. Whether another tenant's schedule
    // uses lags is a fact about that tenant's schedule.
    const g = body(all, "sync_case_schedule_logic_support");
    expect(g).toContain("dc.organization_id = app_current_org()");
    expect(repair).toContain(
      "revoke all on function public.sync_case_schedule_logic_support(uuid) from public, anon, service_role",
    );
  });

  it("the new range ledger is org-scoped, immutable and untruncatable", () => {
    expect(repair).toContain(
      "alter table public.schedule_duration_range_basis enable row level security",
    );
    expect(repair).toContain("organization_id = app_current_org()");
    expect(repair).toContain("enforce_duration_range_basis");
    expect(repair).toContain(
      "revoke truncate on table public.schedule_duration_range_basis from anon, authenticated, service_role",
    );
  });
});
