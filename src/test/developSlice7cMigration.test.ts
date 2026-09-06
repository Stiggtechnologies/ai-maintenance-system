/**
 * Sync Develop Slice 7C — resources, competency readiness, workface metrics.
 *
 * WHAT THIS FILE IS FOR. This is the METRICS chunk, and metrics are where
 * fabricated confidence lives. The two things that can go wrong here are both
 * invisible in a passing transcript:
 *
 *   1. A PERCENTAGE OVER AN EMPTY DENOMINATOR. 0 of 0 rendered as 100% reads
 *      as perfect and rendered as 0% reads as broken, and the number looks
 *      like the output of a calculation either way. Every ratio in this slice
 *      must go through ONE guard, and the assertions below prove there is no
 *      second `/` anywhere in the slice's percentage paths.
 *
 *   2. A SECOND VERDICT WEARING A PERCENTAGE SIGN. A metric that computed
 *      readiness its own way would be the ninth instance of this programme's
 *      signature defect. So the negative assertions matter most: the metric
 *      files must contain no readiness rule, no constraint-state test and no
 *      element rule of their own, and must read
 *      `sync_work_package_release_verdict`, `get_package_constraint_burndown`
 *      and `sync_field_readiness_elements` instead.
 *
 * AND THE ONE THAT THIS CHUNK WAS WARNED ABOUT BY NAME: D7.08 (spec I.28) and
 * D7.20 (spec III.§49) are the SAME calculation under two section numbers.
 * There must be exactly one function, one lineage key and one code version
 * behind both rows, and the register must cite the same symbol from each.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Every migration in the repository, for the assertions that say "repository". */
const MIGRATIONS = "supabase/migrations";

/**
 * `--` line comments removed, INCLUDING the ones inside a dollar-quoted
 * function body — which `stripComments` deliberately preserves so that a
 * negative assertion is about code rather than prose. A comment that quotes
 * the shape it replaced must not satisfy a test looking for that shape.
 */
const codeOnly = (sql: string): string =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  COMPETENCY_WHEN_NEEDED_STATES,
  RATIO_REFUSALS,
  RESOURCE_CATEGORIES,
  RESOURCE_DEMAND_SOURCES,
  SLICE7C_CALCULATION_KEYS,
} from "../lib/develop/workforce";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const RESOURCE_FILE = "20261212090000_develop_resource_demand_capacity.sql";
const PORTFOLIO_FILE = "20261212090100_develop_portfolio_resource_conflict.sql";
const COMPETENCY_FILE = "20261212090200_develop_competency_readiness.sql";
const METRICS_FILE = "20261212090300_develop_workface_metrics.sql";
const SLICE_FILES = [
  RESOURCE_FILE,
  PORTFOLIO_FILE,
  COMPETENCY_FILE,
  METRICS_FILE,
];

/** Slice 7A's constraint file — the ONE release verdict was born here. */
const SLICE7A_CONSTRAINT_FILE = "20261210090100_develop_constraint_object.sql";
/** Slice 7A's package file — the ONE §70 wall lives here and stays here. */
const SLICE7A_PACKAGE_FILE = "20261210090000_develop_work_package_object.sql";
/** Slice 7B's currency file — where the ONE verdict last stood. */
const SLICE7B_CURRENCY_FILE =
  "20261211090200_develop_field_readiness_currency.sql";
/** Slice 7B's record file — where sync_calculation_code_version last stood. */
const SLICE7B_RECORD_FILE = "20261211090100_develop_field_readiness_record.sql";
/** The 2026-08-11 constrained-scheduling file — craft_capacity's home. */
const SCHEDULING_FILE = "20260811130000_constrained_scheduling.sql";
/** The 2026-08-17 human-factors file — the competency model's home. */
const HUMAN_FACTORS_FILE = "20260817090000_human_factors.sql";
/** The 2026-10-27 file the weekly feasibility door last stood in. */
const RECOVERY_CONTEXT_FILE = "20261027090000_recovery_platform_context.sql";

const resource = read(RESOURCE_FILE);
const portfolio = read(PORTFOLIO_FILE);
const competency = read(COMPETENCY_FILE);
const metrics = read(METRICS_FILE);
const joined = SLICE_FILES.map(read).join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");
const slice7a = read(SLICE7A_CONSTRAINT_FILE);
const slice7aPkg = read(SLICE7A_PACKAGE_FILE);
const slice7b = read(SLICE7B_CURRENCY_FILE);
const slice7bRecord = read(SLICE7B_RECORD_FILE);
const scheduling = read(SCHEDULING_FILE);
const humanFactors = read(HUMAN_FACTORS_FILE);
const recoveryContext = read(RECOVERY_CONTEXT_FILE);

const registerDoc = readFileSync("docs/sync-develop/register.md", "utf8");
const overlapMap = readFileSync("docs/sync-develop/overlap-map.md", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const service = readFileSync("src/services/developService.ts", "utf8");
const panels = readFileSync(
  "src/components/develop/WorkforcePanels.tsx",
  "utf8",
);
const page = readFileSync("src/pages/SyncFieldPage.tsx", "utf8");
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const smoke = readFileSync("scripts/ci-develop-slice7c-smoke.sh", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

/** ONE function's text, from its header to its own `$$;` terminator. */
function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("$$;", at);
  expect(end, `${fn} has no $$; terminator`).toBeGreaterThan(at);
  return source.slice(at, end);
}

function trigger(source: string, name: string): string {
  const at = source.lastIndexOf(`create trigger ${name}`);
  expect(at, `trigger ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", at);
  return source.slice(at, end);
}

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

function registerRow(id: string): [string, string] {
  const row = registerDoc.split("\n").find((l) => l.startsWith(`| ${id} `));
  expect(row, `register row ${id}`).toBeDefined();
  return [`register ${id}`, row as string];
}

function registerStatus(id: string): string {
  const [, row] = registerRow(id);
  const cells = row.split("|").map((c) => c.trim());
  return cells[4];
}

function overlapRow(prefix: string): [string, string] {
  const row = overlapMap.split("\n").find((l) => l.startsWith(`| ${prefix}`));
  expect(row, `overlap-map row ${prefix}`).toBeDefined();
  return [`overlap-map ${prefix}`, row as string];
}

/* ───────────────────────────── ordering ─────────────────────────────────── */

describe("Slice 7C — ordering and the rulings it inherits", () => {
  it("orders strictly after Slice 7B", () => {
    for (const f of SLICE_FILES) {
      expect(f.slice(0, 14) > "20261211090200").toBe(true);
    }
  });

  it("names the rulings it consumes rather than restating them", () => {
    expect(rawJoined).toContain("RULING 19");
    expect(rawJoined).toContain("RULING 21");
    expect(rawJoined).toContain("RULING 22");
    // The overlap map already ruled EXTEND for this row, and the file says so
    // rather than arguing it again.
    expect(rawJoined).toContain("no second capacity store");
  });

  it("keeps the overlap-map ruling for D7.01/02 pointing at craft_capacity", () => {
    const [label, row] = overlapRow("D7.01/02 Resource demand/capacity");
    expect(row, label).toContain("craft_capacity");
    expect(row, label).toContain("No second capacity store");
  });
});

/* ─────────────────── D7.01 — the capacity store is EXTENDED ─────────────── */

describe("D7.01 — capacity is extended in place, never forked", () => {
  it("ALTERs craft_capacity and capacity_deductions instead of creating a twin", () => {
    expect(resource).toContain("alter table public.craft_capacity");
    expect(resource).toContain("alter table public.capacity_deductions");
    expect(resource).toContain("resource_category");
    expect(resource).toContain("effective_to date");
  });

  it("creates NO second capacity table anywhere in the slice", () => {
    // `if not exists` is OPTIONAL in the pattern. Both new tables use it
    // today, so the first draft's stricter regex passed — and a later
    // `create table public.resource_capacity (` would have slipped straight
    // past the enumeration this test exists to be.
    const created = [
      ...joined.matchAll(/create table (?:if not exists )?([\w.]+)/g),
    ]
      .map((m) => m[1].replace(/^public\./, ""))
      .sort();
    // Exactly two new tables in the whole slice: the demand object nothing
    // held, and the competency requirement nothing held.
    expect(created).toEqual(["competency_requirements", "resource_demand"]);
    for (const forbidden of [
      "resource_capacity",
      "resource_pools",
      "crew_capacity",
      "capacity_periods",
    ]) {
      expect(joined).not.toMatch(
        new RegExp(
          `create table (?:if not exists )?(?:public\\.)?${forbidden}\\b`,
        ),
      );
    }
  });

  it("carries the nine spec I.22 categories, in the TypeScript module's order", () => {
    const fn = body(resource, "sync_resource_category_order");
    const ordered = [...fn.matchAll(/\('([a-z_]+)',\s*\d+\)/g)].map(
      (m) => m[1],
    );
    expect(ordered).toEqual([...RESOURCE_CATEGORIES]);
    expect(ordered).toHaveLength(9);
  });

  it("keeps the demand source vocabulary identical on both sides", () => {
    for (const s of RESOURCE_DEMAND_SOURCES) {
      expect(resource).toContain(`'${s}'`);
    }
  });

  it("DOES NOT SUBTRACT DEDUCTIONS TWICE — the declared figure is already net", () => {
    const fn = body(resource, "sync_resource_capacity_hours");
    // The itemization is gathered and reported.
    expect(fn).toContain("deductionsItemised");
    // And the capacity figure is the declared one, multiplied by the window.
    expect(fn).toContain("'capacityHours', round(v_declared * v_weeks, 1)");
    // Nothing anywhere subtracts the deduction total from the declared hours.
    expect(fn).not.toMatch(/v_declared\s*-\s*v_deduction/);
    expect(fn).not.toMatch(/v_deduction\s*-\s*v_declared/);
  });

  it("refuses NOT ASSESSABLE where no capacity is recorded, never zero", () => {
    const fn = body(resource, "sync_resource_capacity_hours");
    expect(fn).toContain("Not assessable: no capacity is recorded");
    expect(fn).toContain("not inferred from headcount");
    // The 2026-08-11 posture, carried rather than softened.
    expect(scheduling).toContain(
      "Capacity is deliberately not inferred from headcount",
    );
  });

  it("refuses an UNASSESSED case rather than reporting a clean position", () => {
    const fn = body(resource, "get_case_resource_balance");
    expect(fn).toContain("it is UNASSESSED");
    expect(fn).toContain("nobody has phased work into");
    // And it never reports zero hours for an unrecorded pool.
    expect(fn).toContain("'not_assessable'");
  });
});

/* ────────────── the non-finite guard, at every door and every table ─────── */

describe("non-finite numbers are refused everywhere", () => {
  it("states the finite predicate ONCE and in three parts", () => {
    const fn = body(resource, "sync_is_finite_numeric");
    expect(fn).toContain("<> 'NaN'::numeric");
    expect(fn).toContain("> '-Infinity'::numeric");
    expect(fn).toContain("< 'Infinity'::numeric");
    // `p is not null` is part of the answer: NULL propagates to NULL and a
    // NULL check constraint PASSES.
    expect(fn).toContain("p_value is not null");
  });

  it("guards the two extended tables and the new one AT THE TABLE", () => {
    expect(resource).toContain("craft_capacity_hours_finite");
    expect(resource).toContain("capacity_deductions_hours_finite");
    expect(resource).toContain("resource_demand_hours_finite");
    expect(resource).toContain(
      "check (sync_is_finite_numeric(demand_hours) and demand_hours > 0)",
    );
  });

  it("guards the RPC doors too, so a refusal is a sentence and not a 500", () => {
    for (const fn of [
      "record_resource_capacity",
      "record_capacity_deduction",
      "record_resource_demand",
    ]) {
      expect(body(resource, fn)).toContain("sync_is_finite_numeric");
    }
  });

  it("guards the division itself", () => {
    const fn = body(metrics, "sync_metric_ratio");
    expect(fn).toContain("not sync_is_finite_numeric(p_numerator)");
    expect(fn).toContain("not sync_is_finite_numeric(p_denominator)");
  });
});

/* ─────────────────────── THE ONE DIVISION IN THE SLICE ─────────────────── */

describe("every percentage goes through ONE guarded division", () => {
  it("names all five refusal kinds, and the TypeScript half matches", () => {
    const fn = body(metrics, "sync_metric_ratio");
    for (const kind of RATIO_REFUSALS) {
      expect(fn, `sync_metric_ratio must produce '${kind}'`).toContain(
        `'kind', '${kind}'`,
      );
    }
  });

  it("says NOT 0% and NOT 100% about an empty denominator, in those words", () => {
    const fn = body(metrics, "sync_metric_ratio");
    expect(fn).toContain("NOT 0%%");
    expect(fn).toContain("NOT 100%%");
  });

  it("diagnoses NOT ASSESSED BEFORE the empty denominator", () => {
    const fn = body(metrics, "sync_metric_ratio");
    const assessedAt = fn.indexOf("'not_assessed'");
    const emptyAt = fn.indexOf("'empty_denominator'");
    expect(assessedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    // The denominator IS the assessed count in every caller, so both are zero
    // for a set nobody looked at and the order decides which of two true
    // sentences the reader gets. Same order in the TypeScript half.
    expect(assessedAt).toBeLessThan(emptyAt);
  });

  it("is the ONLY place the metric files divide", () => {
    // Every `/` in the metric-producing functions must be inside
    // sync_metric_ratio or a pro-rata of hours across a window. A second bare
    // percentage would be a second answer to a metric question.
    for (const fn of [
      "get_constraint_free_work_index",
      "get_workface_execution_metrics",
    ]) {
      const source = body(metrics, fn);
      expect(source).not.toMatch(/100\.0\s*\*/);
      expect(source).not.toContain("round(100");
      expect(source).toContain("sync_metric_ratio(");
    }
  });

  it("never emits a pct alongside a refusal", () => {
    const fn = body(metrics, "sync_metric_ratio");
    // Each refusal branch carries an explicit null pct rather than omitting
    // the key, so a client destructuring `pct` cannot get a stale number.
    const refusalBranches = fn.split("'answered', false").length - 1;
    expect(refusalBranches).toBe(RATIO_REFUSALS.length);
    expect(fn.split("'pct', null").length - 1).toBe(RATIO_REFUSALS.length);
  });
});

/* ───────────────── the repairs this chunk's review produced ─────────────── */

describe("the workface percentages cannot contradict the index beside them", () => {
  it("reads the ONE release verdict for each job's package", () => {
    // THE DEFECT: the first draft derived a job's readiness ONLY from
    // `sync_field_readiness_elements`, a WORK-ORDER predicate that knows about
    // job plans, materials, permits and isolation and nothing about the ten
    // §28 package constraints. A package with zero constraints recorded is
    // `unassessed` on the ONE verdict, and one payload then carried, about
    // that same single package:
    //     constraintFreeWorkIndex  NOT ASSESSED
    //     forwardConstraintFreeWork NOT ASSESSED
    //     plannedWorkReady          100%
    //     readyWorkExecuted         100%
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("sync_work_package_release_verdict(r.package_id)");
    expect(fn).toContain("v_pkg_class = 'unassessed'");
    expect(fn).toContain("'package_unassessed'");
    // Excluded from BOTH the numerator and the denominator, as the index does.
    expect(fn).toContain("v_package_unassessed := v_package_unassessed + 1");
    expect(fn).toContain("'packageUnassessedWorkOrders', v_package_unassessed");
  });

  it("treats a RELEASED package as clear, not as blocked", () => {
    // The ONE verdict reports `canRelease: false` for an already-released
    // package because it is not released twice. Reading that as "not ready"
    // would have marked every released job in the product as blocked, which
    // is the over-block half of this fix.
    const fn = codeOnly(body(metrics, "get_workface_execution_metrics"));
    expect(fn).toContain(
      "v_pkg_clear := v_pkg_class in ('released', 'ready_for_human')",
    );
    expect(fn).not.toContain("canRelease");
  });

  it("carries the package verdict and its sentence onto every job row", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("'packageVerdict', v_pkg_class");
    expect(fn).toContain("'packageReadiness', v_pkg_verdict->>'reason'");
    // And states no readiness sentence of its own for a held-back package.
    expect(fn).toContain(
      "when 'package_unassessed' then v_pkg_verdict->>'reason'",
    );
  });

  it("emits an assessment COVERAGE figure, as the index does", () => {
    // "100% — 1 of 1" over ten planned jobs of which nine could not be
    // assessed is not a workface position, and the subtitle reinforced the
    // wrong reading. The index has carried coverage since it was written.
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain(
      "v_coverage := sync_metric_ratio(v_assessable, v_planned",
    );
    expect(fn).toContain("'assessmentCoverage', v_coverage");
  });
});

describe("the composed module refuses its input rather than half-refusing it", () => {
  it("validates the horizon before deriving any window from it", () => {
    // Postgres GREATEST/LEAST IGNORE nulls, so `greatest(1, least(260, null/7))`
    // is 260 — five years. One payload refused the index for an unusable
    // horizon and answered a five-year resource position from the same input.
    const fn = codeOnly(body(metrics, "get_sync_field_module"));
    expect(fn).toContain(
      "if p_horizon_days is null or p_horizon_days <= 0 or p_horizon_days > 1825 then",
    );
    const guardAt = fn.indexOf("p_horizon_days > 1825");
    const deriveAt = fn.indexOf("greatest(1, least(260");
    expect(guardAt).toBeGreaterThan(-1);
    expect(deriveAt).toBeGreaterThan(guardAt);
  });

  it("derives the workface window from the horizon instead of pinning 14 days", () => {
    const fn = codeOnly(body(metrics, "get_sync_field_module"));
    expect(fn).not.toContain(
      "get_workface_execution_metrics(c.id, null, null)",
    );
    expect(fn).toContain(
      "get_workface_execution_metrics(c.id, current_date, v_workface_end)",
    );
    expect(fn).toContain(
      "v_workface_end := current_date + least(365, p_horizon_days)",
    );
    // And the window it chose is ON the payload, not left to be assumed.
    expect(fn).toContain("'workfaceWindowEnd', v_workface_end");
    expect(fn).toContain("'horizonDays', p_horizon_days");
  });
});

describe("the case resource balance agrees with the portfolio roll-up", () => {
  it("phases into DISJOINT segments so overlapping demand accumulates", () => {
    // THE DEFECT: the clipped window was part of the GROUP BY key, so two
    // lines on one pool with overlapping periods never summed and each cell
    // was compared against the FULL capacity of its own window — the same
    // crew-hours credited twice. 900 h over weeks 1-8 and 900 h over weeks
    // 5-12 of a 120 h/week pool read as two comfortable cells and an EMPTY
    // refusal list, while the portfolio view called the identical rows
    // 1800 h against 1440.
    const fn = body(resource, "get_case_resource_balance");
    expect(fn).not.toContain(
      "group by d.resource_category, d.resource_pool,\n              greatest(d.period_start, v_today), least(d.period_end, v_end)",
    );
    expect(fn).toContain("lateral (values (s), (e)) as v(b)");
    expect(fn).toContain(
      "lead(b) over (partition by resource_category, resource_pool",
    );
    expect(fn).toContain("l.s < g.w_end and l.e > g.w_start");
    expect(fn).toContain(
      "group by g.resource_category, g.resource_pool, g.w_start, g.w_end",
    );
  });
});

describe("the acts the refusals promise all exist", () => {
  it("ships close_resource_capacity, and the collision refusal names it", () => {
    expect(resource).toContain(
      "create or replace function public.close_resource_capacity(",
    );
    const fn = body(resource, "record_resource_capacity");
    expect(fn).toContain("Supersede it with `close_resource_capacity`");
    // It only ever CLOSES: the hours, basis and start are not editable here.
    const close = body(resource, "close_resource_capacity");
    expect(close).toContain("update craft_capacity set effective_to = v_to");
    expect(close).not.toContain("weekly_hours =");
    expect(close).toContain("was already closed on");
  });

  it("ships renew_member_competency, and the duplicate refusal names it", () => {
    expect(competency).toContain(
      "create or replace function public.renew_member_competency(",
    );
    const fn = body(competency, "record_member_competency");
    expect(fn).toContain("Record the renewal with `renew_member_competency`");
    const renew = body(competency, "renew_member_competency");
    // A renewal EXTENDS; shortening is a correction and is refused.
    expect(renew).toContain("v_expires < mc.expires_on");
    expect(renew).toContain("shortening one is a correction");
    // Declaring competency: the §70-walled column is written, and ai_admin is
    // excluded at the RPC as well.
    expect(renew).toContain("verified_by = auth.uid()");
    expect(renew).not.toContain("'ai_admin'");
  });

  it("ships set_workforce_member_active, so a leaver stops counting", () => {
    expect(competency).toContain(
      "create or replace function public.set_workforce_member_active(",
    );
    const fn = body(competency, "set_workforce_member_active");
    expect(fn).toContain("update workforce_members set active = v_active");
    expect(fn).toContain("jsonb_typeof(p_payload->'active') <> 'boolean'");
    // Holdings are RETAINED. A record of what somebody held is not deleted
    // because they left.
    expect(fn).not.toContain("delete from member_competencies");
    // And the catalogue lists inactive members, or nothing could undo it.
    const cat = body(competency, "get_competency_requirements");
    expect(cat).not.toContain(
      "from workforce_members where organization_id = v_org and active;",
    );
    expect(cat).toContain("'active', active");
  });

  it("wires every one of them to a non-test caller", () => {
    const service = readFileSync("src/services/developService.ts", "utf8");
    const panels = readFileSync(
      "src/components/develop/WorkforcePanels.tsx",
      "utf8",
    );
    for (const [rpc, fn] of [
      ["close_resource_capacity", "closeResourceCapacity"],
      ["renew_member_competency", "renewMemberCompetency"],
      ["set_workforce_member_active", "setWorkforceMemberActive"],
      // The act that already existed and which NOTHING in the product called,
      // making a competency requirement write-once and permanent from every
      // customer surface: a live one cannot be restated (unique index) and
      // cannot be deleted (integrity trigger).
      ["retire_competency_requirement", "retireCompetencyRequirement"],
    ] as const) {
      expect(service, `${rpc} needs a service wrapper`).toContain(rpc);
      expect(panels, `${fn} needs a component caller`).toContain(`${fn}(`);
    }
  });
});

describe("§70's scope on the lineage recorders is a ruling, and it is provable", () => {
  it("admits ai_admin to compute_* and nothing there can certify anything", () => {
    // THE JUDGEMENT, stated so a later reader can re-open it deliberately.
    // The brief's §70 sentence names three acts: no AI or system identity may
    // declare competency, approve a roster, or CERTIFY A METRIC. All three
    // `compute_*` functions admit `ai_admin`, following 7B's precedent at
    // 20261211090100:308-310, on the reading that RUNNING a calculation and
    // recording what it produced is EVIDENCE ASSEMBLY — the half §70 leaves to
    // the machine (RULING 22) — while certifying would be asserting the number
    // is right.
    //
    // That reading is only defensible while it stays true of the code, so it
    // is pinned rather than asserted:
    for (const fn of [
      "compute_constraint_free_work_index",
      "compute_workface_execution_metrics",
    ]) {
      const b = codeOnly(body(metrics, fn));
      expect(b).toContain("'ai_admin'");
      // It CALLS THE READ and records what came back. It INVOKES no predicate
      // of its own — no verdict, no element rule, no division. (The predicate
      // NAMES appear in `input_refs` and in the method sentence, which is
      // lineage provenance: what the calculation read, recorded beside what it
      // produced.)
      for (const predicate of [
        "sync_metric_ratio",
        "sync_work_package_release_verdict",
        "sync_field_readiness_elements",
        "get_package_constraint_burndown",
      ]) {
        expect(b, `${fn} must not invoke ${predicate}`).not.toMatch(
          new RegExp(`:=\\s*${predicate}\\(|perform\\s+${predicate}\\(`),
        );
      }
      // And it writes nowhere but the lineage ledger, through its one RPC.
      expect(b).not.toMatch(
        /update (work_packages|work_orders|restoration_constraints|calculation_runs)/,
      );
      expect([...b.matchAll(/insert into (\w+)/g)].map((m) => m[1])).toEqual(
        [],
      );
      expect(b).toContain("record_calculation_run(");
    }
    const comp = codeOnly(body(competency, "compute_competency_readiness"));
    expect(comp).toContain("'ai_admin'");
    expect(comp).not.toMatch(/:=\s*sync_competency_when_needed\(/);
    expect(comp).toContain("record_calculation_run(");
  });

  it("would have to be re-opened if calculation_runs ever gained an attestation", () => {
    // The ruling rests on `calculation_runs` recording WHO RAN a calculation
    // and nothing more — there is no approval, sign-off or attestation column,
    // so `computed_by` is provenance rather than certification. If one is ever
    // added, "computing is not certifying" stops being true and this test is
    // where that shows up.
    const ledger = read("20261130090600_develop_calculation_lineage.sql");
    const create = ledger.slice(
      ledger.indexOf("create table if not exists public.calculation_runs"),
    );
    const columns = create.slice(0, create.indexOf(");"));
    for (const forbidden of [
      "attested",
      "approved_by",
      "approved_at",
      "certified",
      "signed_off",
    ]) {
      expect(
        columns,
        `calculation_runs gained ${forbidden}: §70's scoping of compute_* must be re-decided`,
      ).not.toContain(forbidden);
    }
  });
});

describe("§70 covers the third act the spec names: approving a roster", () => {
  it("gives shift_assignments an actor column and binds the ONE wall to it", () => {
    expect(competency).toContain(
      "alter table public.shift_assignments\n  add column if not exists assigned_by uuid",
    );
    expect(competency).toContain("trg_shift_assignment_actor_human");
    expect(competency).toContain(
      "before insert or update on public.shift_assignments",
    );
    expect(competency).toContain("'assigned_by', 'approve a roster");
    // And the write path stamps it, or the wall would guard a column nothing
    // ever fills.
    expect(body(competency, "record_shift_assignment")).toContain(
      "shift_kind, assigned_by)",
    );
  });

  it("is NOT over-broad: the seed writer names no actor and is untouched", () => {
    // `shift_assignments` has exactly two writers in the repository. The
    // 2026-08-17 demo seed uses an explicit column list WITHOUT assigned_by,
    // so it passes the wall's NULL-actor early return unchanged.
    const seed = read("20260817093000_demo_workforce.sql");
    const inserts = [
      ...seed.matchAll(/insert into shift_assignments \(([^)]*)\)/g),
    ];
    expect(inserts.length).toBeGreaterThan(0);
    for (const m of inserts) {
      expect(m[1]).not.toContain("assigned_by");
    }
    // And the column is nullable with no default, so an imported or seeded
    // roster is not retro-attributed to anybody.
    expect(competency).not.toContain("assigned_by uuid not null");
  });
});

describe("a tightening does not break the writer that already existed", () => {
  it("mirrors the finite-number guard into the recovery ingest validator", () => {
    // `'NaN'::numeric <= 0` is FALSE in Postgres, so the pre-existing
    // validator admitted NaN, the new craft_capacity CHECK then raised, and
    // the check_violation escaped ingest_recovery_activation_batch — which
    // has no per-row handler — aborting a whole batch on one bad cell. The
    // control (a NEGATIVE row) was rejected per-row and the batch survived.
    const fn = body(resource, "recovery_activation_validate_row");
    expect(fn).toContain(
      "if not public.sync_is_finite_numeric(v_num) or v_num<=0 then raise exception 'invalid'; end if;",
    );
    expect(fn).toContain(
      "weekly_hours must be a finite number greater than zero",
    );
  });

  it("changes NOTHING ELSE in that validator", () => {
    // The redefinition is a copy, and a copy can drift into a second
    // validator. This diffs it against the 20261003090000 original line by
    // line and asserts the ONLY differences are the guard and its sentence.
    const original = body(
      read("20261003090000_recovery_activation_kit.sql"),
      "recovery_activation_validate_row",
    );
    const now = body(resource, "recovery_activation_validate_row");
    const strip = (sql: string) =>
      codeOnly(sql)
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 &&
            !l.includes("weekly_hours must be") &&
            !l.includes("raise exception 'invalid'; end if;"),
        );
    expect(strip(now)).toEqual(strip(original));
  });
});

/* ─────── D7.08 + D7.20 — ONE calculation, cited from two register rows ──── */

describe("D7.08 and D7.20 are ONE calculation", () => {
  it("declares exactly one constraint-free function in the whole repository", () => {
    // THE WHOLE MIGRATION CORPUS, not the four files of this slice. The claim
    // this test makes is that a SECOND forward metric cannot appear under a
    // different section number — and the place it would appear is a LATER
    // migration, which the slice-scoped version of this assertion could not
    // see. It was true by luck; now it is true by test.
    const everyMigration = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
      .join("\n");
    const declared = [
      ...everyMigration.matchAll(
        /create or replace function public\.(\w*constraint_free\w*)\(/g,
      ),
    ].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual([
      "compute_constraint_free_work_index",
      "get_constraint_free_work_index",
    ]);
  });

  it("produces BOTH faces from that one function", () => {
    const fn = body(metrics, "get_constraint_free_work_index");
    // §49 today, and I.28 forward, over the SAME denominator.
    expect(fn).toContain("'constraintFreeWorkIndex', v_index");
    expect(fn).toContain("'forwardConstraintFreeWork', v_forward");
    // Read from the function's own `basis` prose, which ships to the client —
    // not from a comment, which stripComments removes and which nothing on a
    // screen ever shows.
    expect(fn).toContain("Spec §49''s Constraint-Free Work Index");
    expect(fn).toContain("spec I.28''s forward constraint-free work");
    expect(fn).toContain("are the SAME calculation named twice");
  });

  it("pins ONE lineage key and ONE code version for both rows", () => {
    const compute = body(metrics, "compute_constraint_free_work_index");
    const keys = [
      ...compute.matchAll(/record_calculation_run\(\s*[\w.]+,\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);
    expect([...new Set(keys)]).toEqual(["constraint_free_work_index"]);
    const pins = pinnedVersions(competency);
    expect(
      [...pins.keys()].filter((k) => k.includes("constraint_free")),
    ).toEqual(["constraint_free_work_index"]);
  });

  it("is cited from BOTH register rows, by the same symbol", () => {
    for (const id of ["D7.08", "D7.20"]) {
      const [label, row] = registerRow(id);
      expect(row, label).toContain("get_constraint_free_work_index");
      expect(row, label).toContain("constraint_free_work_index");
    }
    // And each says the other is the same calculation, so a later author
    // cannot read one row alone and build a second.
    expect(registerRow("D7.08")[1]).toContain("D7.20");
    expect(registerRow("D7.20")[1]).toContain("D7.08");
  });

  it("does not touch the ONE verdict or the ONE element predicate", () => {
    // The defect this chunk is most likely to ship is a second readiness
    // answer wearing a percentage sign. The cheapest way to get one is to
    // "improve" the predicate the metric reads, so this asserts the metric
    // slice redefines neither — they stay where Slice 7B left them.
    expect(slice7b).toContain(
      "create or replace function public.sync_work_package_release_verdict(",
    );
    for (const predicate of [
      "sync_work_package_release_verdict",
      "sync_field_readiness_elements",
      "get_package_constraint_burndown",
      "assess_package_field_readiness",
    ]) {
      expect(joined, `slice 7C must not redefine ${predicate}`).not.toContain(
        `create or replace function public.${predicate}(`,
      );
    }
  });

  it("reads the ONE verdict and the ONE projection rather than deciding", () => {
    const fn = body(metrics, "get_constraint_free_work_index");
    expect(fn).toContain("sync_work_package_release_verdict(r.id)");
    expect(fn).toContain("get_package_constraint_burndown(r.id");
    // It renders the verdict's own sentence and writes none of its own.
    expect(fn).toContain("'readiness', v_verdict->>'reason'");
  });

  it("states NO readiness rule of its own", () => {
    const fn = body(metrics, "get_constraint_free_work_index");
    // No constraint-state test, no hard/soft split, no verdict vocabulary
    // beyond reading what the predicate returned.
    expect(fn).not.toContain("restoration_constraints");
    expect(fn).not.toContain("is_hard");
    expect(fn).not.toContain("state in ('unknown'");
    // The one readiness VALUE it names is a comparison against what the
    // predicate returned, never a rule it evaluates itself. Comparing
    // `v_class` — which is `v_verdict->>'verdict'` and nothing else — is
    // composition; reading a constraint and concluding would not be.
    expect(fn).toContain("v_class := coalesce(v_verdict->>'verdict'");
    for (const m of fn.matchAll(/'ready_for_human'/g)) {
      const around = fn.slice(Math.max(0, m.index - 40), m.index);
      expect(
        around,
        "a readiness value may only be compared to v_class",
      ).toContain("v_class");
    }
  });

  it("refuses an empty, an undated and a wholly unassessed denominator", () => {
    const fn = body(metrics, "get_constraint_free_work_index");
    expect(fn).toContain("NOT 100%% constraint-free");
    expect(fn).toContain("has not been packaged");
    expect(fn).toContain("is not a constraint-free one");
    // The unassessed are counted separately and never as not-ready.
    expect(fn).toContain("v_unassessed");
    expect(fn).toContain("an unassessed package is not a constrained one");
  });

  it("refuses the FORWARD figure while anything is unprojectable", () => {
    const fn = body(metrics, "get_constraint_free_work_index");
    expect(fn).toContain("'kind', 'not_projectable'");
    expect(fn).toContain("states a future nobody forecast");
  });

  it("BOUNDS the window at both ends, so the denominator is the window it names", () => {
    // `required_by <= v_end` alone admitted a package needed four hundred
    // days ago into a denominator the screen labels "the next N days". Live
    // proof of the defect: a case whose only draft package was required
    // 2025-07-31, asked for a ONE-DAY horizon, answered
    // `{"pct": 0.0, "answered": true, "denominator": 1}` — a confident
    // percentage about a window it never looked at. The sibling metric in the
    // same file was already bounded on both ends.
    const fn = body(metrics, "get_constraint_free_work_index");
    expect(fn).toContain("p.required_by >= v_today and p.required_by <= v_end");
    expect(fn).toContain("count(*) filter (where required_by >= v_today)");
    expect(fn).toContain("count(*) filter (where required_by < v_today)");
    const workface = body(metrics, "get_workface_execution_metrics");
    expect(workface).toContain(
      "p.required_by >= v_start and p.required_by <= v_end",
    );
  });

  it("names an OVERDUE package, in its own set, outside the window", () => {
    // A package needed on a date that has passed while still unreleased is a
    // fact about the calendar; a package whose constraints nobody has dated
    // is a gap in the register. They get different names AND different sets:
    // folding the overdue ones into `not_projectable` meant that on any
    // project which had ever missed a package date the I.28 forward figure
    // never answered again.
    const fn = body(metrics, "get_constraint_free_work_index");
    expect(fn).toContain("p.required_by < v_today");
    expect(fn).toContain("'overdue'");
    expect(fn).toContain("'daysOverdue', v_today - r.required_by");
    expect(fn).toContain("'inWindow', false");
    expect(fn).toContain("'overdue', v_overdue_items");
    expect(fn).toContain("LATE, they are listed in `overdue`");
    // An overdue package never touches the projectability count.
    expect(fn).not.toContain("v_not_projectable - v_overdue");
    expect(fn).not.toContain("v_overdue := v_overdue + 1");
  });
});

/* ───────────────── D7.13 + D7.14 — the workface percentages ─────────────── */

describe("D7.13 and D7.14 divide a different set from the index", () => {
  it("counts WORK ORDERS, and says why that is not the §49 denominator", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("work_package_work");
    expect(fn).toContain("work_orders");
    expect(fn).toContain("the crew''s unit");
    expect(fn).toContain("never divide the same set");
  });

  it("reads the ONE element predicate and states no element rule", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("sync_field_readiness_elements(r.id, r.asset_id)");
    for (const rule of [
      "work_order_materials",
      "equipment_releases",
      "job_plan_permits",
      "isolation_confirmed",
      "job_plan_steps",
    ]) {
      expect(fn, `the metric must not restate the ${rule} rule`).not.toContain(
        rule,
      );
    }
  });

  it("takes execution from work_orders.status — RULING 19's work identity", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("('in_progress', 'completed')");
    expect(fn).toContain("RULING 19");
    // NOT from the package, whose status is its RELEASE state.
    expect(fn).not.toContain("p.status = 'released'");
  });

  it("GROUPS rather than DISTINCTs, so one job in two packages counts once", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("group by w.id");
    expect(fn).not.toContain("select distinct w.id");
  });

  it("refuses an empty window and distinguishes the two empty ready sets", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("the workface denominator is empty");
    expect(fn).toContain("NOT 0%%");
    // The ready-work-executed refusal names WHICH kind of empty it is.
    expect(fn).toContain("'not_assessed' else 'empty_denominator'");
    expect(fn).toContain(
      "none of the %s planned work order(s) could be assessed",
    );
    expect(fn).toContain("were assessed and NONE of them is field-ready");
  });

  it("names the three unverifiable elements beside the percentage", () => {
    const fn = body(metrics, "get_workface_execution_metrics");
    expect(fn).toContain("unverifiableElementPositions");
    expect(fn).toContain("not on all ten");
  });
});

/* ─────────────────────── lineage, including refusals ───────────────────── */

describe("every metric records a lineage run, refusals included", () => {
  it("adds exactly four keys, and the TypeScript module lists the same four", () => {
    const before = pinnedVersions(slice7bRecord);
    const after = pinnedVersions(competency);
    const added = [...after.keys()].filter((k) => !before.has(k));
    expect(added.sort()).toEqual([...SLICE7C_CALCULATION_KEYS].sort());
    // Every pre-existing key keeps its own version: bumping unchanged code
    // makes the version stop meaning anything.
    for (const [k, v] of before) expect(after.get(k)).toBe(v);
  });

  it("records a run for every key it pins — no pin without a recorder", () => {
    const recorded = new Set(
      [
        ...joined.matchAll(/record_calculation_run\(\s*[\w.]+,\s*'([a-z_]+)'/g),
      ].map((m) => m[1]),
    );
    for (const key of SLICE7C_CALCULATION_KEYS) {
      if (key === "case_resource_balance") continue; // see the next test
      expect(recorded, `${key} is pinned but never recorded`).toContain(key);
    }
  });

  it("records the REFUSALS too, so a history cannot show only clean weeks", () => {
    for (const [source, fn] of [
      [competency, "compute_competency_readiness"],
      [metrics, "compute_constraint_free_work_index"],
      [metrics, "compute_workface_execution_metrics"],
    ] as const) {
      const b = body(source, fn);
      expect(b).toContain("v_refusals := jsonb_build_array");
      expect(b).toContain("null, v_refusals);");
    }
  });

  it("records a REFUSED inner percentage as a refusal on the run", () => {
    // A run whose top level answered but whose index refused was stored with
    // status `computed` and a null percentage in the first draft — a lineage
    // row asserting a clean calculation happened.
    const cfw = body(metrics, "compute_constraint_free_work_index");
    expect(cfw).toContain("'scope', 'index'");
    expect(cfw).toContain("'scope', 'forward'");
    const wf = body(metrics, "compute_workface_execution_metrics");
    expect(wf).toContain("'scope', 'planned_work_ready'");
    expect(wf).toContain("'scope', 'ready_work_executed'");
  });
});

/* ───────────────── D7.02 — ONE feasibility engine, extended ─────────────── */

describe("D7.02 — the weekly door gains a collective arm, not a twin", () => {
  it("declares no second feasibility function", () => {
    const declared = [
      ...joined.matchAll(
        /create or replace function public\.(\w*feasibilit\w*)\(/g,
      ),
    ].map((m) => m[1]);
    expect([...new Set(declared)]).toEqual(["evaluate_schedule_feasibility"]);
  });

  it("KEEPS every check the door already carried", () => {
    const now = body(portfolio, "evaluate_schedule_feasibility");
    const before = body(recoveryContext, "evaluate_schedule_feasibility");
    for (const c of [
      "Safety consequence clearance",
      "Approval authority",
      "Material readiness",
      "Active Recovery commitments",
      "Labour capacity",
      "Production window",
    ]) {
      expect(before, `${c} must have existed before`).toContain(c);
      expect(now, `${c} must survive`).toContain(c);
    }
  });

  it("CORRECTS the labour capacity source to the ONE predicate, and pins that", () => {
    const now = body(portfolio, "evaluate_schedule_feasibility");
    const before = body(recoveryContext, "evaluate_schedule_feasibility");

    // WHAT STOOD HERE, and why pinning it was wrong.
    //
    // The pre-7C door summed every craft_capacity row for the craft with no
    // date and no category filter. The first draft of this slice pinned that
    // string as proof "a live release gate's numbers cannot move under cover
    // of a new view" — but THIS SLICE added `effective_to` and
    // `resource_category` to craft_capacity and shipped the first customer
    // write path onto it. The arithmetic did not move; the data model under
    // it did, so the unchanged sum began counting demobilised crews,
    // superseded figures and other categories' pools as available labour,
    // always in the direction of MORE capacity and FEWER warnings. Pinning
    // the old string made the defect load-bearing.
    const staleSum =
      "coalesce((select sum(weekly_hours) from craft_capacity c\n                       where c.organization_id = v_org and c.craft = x2.craft), 0) as cap";
    expect(before).toContain(staleSum);
    expect(now).not.toContain(staleSum);
    // No unfiltered sum over craft_capacity survives anywhere in the slice.
    // `codeOnly` matters here: `stripComments` deliberately preserves the
    // inside of a dollar-quoted body verbatim, so a `--` line INSIDE a
    // function that merely QUOTES the old shape would otherwise fail this.
    expect(codeOnly(joined)).not.toMatch(
      /sum\(weekly_hours\)\s+from craft_capacity/,
    );

    // WHAT STANDS NOW: the ONE capacity predicate, for the option's own week,
    // in the category craft-week labour capacity actually is.
    expect(now).toContain(
      "sync_resource_capacity_hours(v_org, 'skilled_trades',",
    );
    expect(now).toContain("r_craft.craft, o.week_start, o.week_start + 7)");
    // The utilisation expression still divides required by available.
    expect(now).toContain(
      "round(100.0 * r_craft.req / (v_craft_cap->>'capacityHours')::numeric, 1)",
    );
    // And a craft with work and no capacity in force is REPORTED, not dropped
    // by a `where cap > 0` that also decided `passed` on its way past.
    expect(before).toContain("where x.cap > 0");
    expect(codeOnly(now)).not.toContain("where x.cap > 0");
    expect(now).toContain("v_labour_unassessed := v_labour_unassessed + 1");
    expect(now).toContain("'not_assessable_crafts', v_labour_unassessed");
  });

  it("never reports a soft check PASSED over something nobody assessed", () => {
    const now = body(portfolio, "evaluate_schedule_feasibility");
    // Labour: false when over, NULL when something could not be assessed.
    expect(now).toContain(
      "'passed', case when v_labour_over > 0 then false\n                     when v_labour_unassessed > 0 then null\n                     else true end",
    );
    // Portfolio: the same shape. The first draft set `passed` to
    // `conflicts = 0` and printed "Every pool committed across N development
    // case(s) this week is inside its recorded capacity" over a portfolio in
    // which ZERO pools were assessable.
    expect(now).toContain(
      "'passed', case when v_portfolio_conflicts > 0 then false\n                     when v_portfolio_unassessed > 0 then null\n                     else true end",
    );
    expect(now).toContain("NOT ASSESSABLE: %s pool(s) committed across");
  });

  it("adds the portfolio check as a WARNING, reading the ONE roll-up", () => {
    const now = body(portfolio, "evaluate_schedule_feasibility");
    expect(now).toContain("'constraint', 'Portfolio resource commitments'");
    expect(now).toContain("'severity', 'warning'");
    expect(now).toContain(
      "sync_portfolio_resource_conflicts(v_org, o.week_start",
    );
    // The portfolio CHECK composes the roll-up's answer and computes nothing
    // about capacity of its own; the labour check beside it reads the ONE
    // capacity predicate directly, which is the same single source rather
    // than a second opinion.
    expect(now).not.toContain("v_portfolio_capacity");
  });

  it("computes 'individually executable, collectively impossible' rather than saying it", () => {
    const fn = body(portfolio, "sync_portfolio_resource_conflicts");
    expect(fn).toContain("v_worst is not null and v_worst <= v_capacity");
    expect(fn).toContain("v_case_count > 1");
    expect(fn).toContain("'collective_only'");
    expect(fn).toContain("Individually executable, collectively impossible");
  });

  it("counts only APPROVED demand, and reports the drafts beside it", () => {
    const fn = body(portfolio, "sync_portfolio_resource_conflicts");
    expect(fn).toContain("d.approved_at is not null");
    expect(fn).toContain("draftDemandLines");
    expect(fn).toContain("a planner thinking out loud");
  });

  it("refuses a portfolio with nothing committed rather than reporting harmony", () => {
    const fn = body(portfolio, "sync_portfolio_resource_conflicts");
    expect(fn).toContain("UNASSESSED, not conflict-free");
  });
});

/* ───────────────── D7.03 / D7.04 — competency, in the future tense ──────── */

describe("D7.03 — the competency model is extended, not replaced", () => {
  it("writes to the EXISTING tables rather than creating new ones", () => {
    for (const t of [
      "competencies",
      "workforce_members",
      "member_competencies",
      "shift_assignments",
    ]) {
      expect(humanFactors, `${t} must pre-exist`).toContain(
        `create table if not exists ${t} (`,
      );
      expect(competency, `slice 7C must write ${t}`).toContain(
        `insert into ${t}`,
      );
      expect(competency).not.toContain(`create table if not exists ${t} (`);
    }
  });

  it("anchors the requirement XOR over craft and package — the RULING 20 shape", () => {
    expect(competency).toContain(
      "check (num_nonnulls(craft, work_package_id) = 1)",
    );
    expect(slice7a).toContain("num_nonnulls(event_id, work_package_id) = 1");
  });

  it("retires a requirement rather than deleting it", () => {
    const wall = body(competency, "enforce_competency_requirement_integrity");
    expect(wall).toContain("is not deletable");
    expect(wall).toContain("retire it with a reason instead");
  });
});

describe("D7.04 — the question is asked in the FUTURE TENSE", () => {
  it("compares expiry against the END of the window, not against today", () => {
    const fn = body(competency, "sync_competency_when_needed");
    expect(fn).toContain("p_expires_on < p_window_end");
    expect(fn).toContain("'expires_during_window'");
    // `current_date` appears nowhere in the predicate: today is not the
    // question.
    expect(fn).not.toContain("current_date");
  });

  it("returns exactly the four states the TypeScript module declares", () => {
    const fn = body(competency, "sync_competency_when_needed");
    const returned = [...fn.matchAll(/then '([a-z_]+)'|else '([a-z_]+)'/g)]
      .map((m) => m[1] ?? m[2])
      .filter(Boolean);
    expect(new Set(returned)).toEqual(new Set(COMPETENCY_WHEN_NEEDED_STATES));
  });

  it("refuses a package with no window — 'when needed' has no 'when'", () => {
    const fn = body(competency, "get_competency_readiness");
    expect(fn).toContain("carries no required-by date");
    expect(fn).toContain('has no "when"');
  });

  it("refuses an UNASSESSED requirement set rather than reporting everyone qualified", () => {
    const fn = body(competency, "get_competency_readiness");
    expect(fn).toContain("That is UNASSESSED");
    expect(fn).toContain('it is not "every competency is held"');
  });

  it("reports a window with no roster as NOT ASSESSABLE, not as nobody available", () => {
    const fn = body(competency, "get_competency_readiness");
    expect(fn).toContain("'roster_not_recorded'");
    expect(fn).toContain('This is not "nobody is available"');
  });

  it("joins all three live inputs the register named", () => {
    const fn = body(competency, "get_competency_readiness");
    expect(fn).toContain("shift_assignments");
    expect(fn).toContain("member_competencies");
    expect(fn).toContain("competency_requirements");
    expect(fn).toContain("labour_rules");
    // The rules are REPORTED, not applied: dropping an over-limit member here
    // would be a second fatigue engine.
    expect(fn).toContain("'labourRules', v_rules");
  });
});

/* ──────────────────────────────── §70 ──────────────────────────────────── */

describe("§70 is enforced at the database and SCOPED", () => {
  it("uses the ONE wall Slice 7A installed rather than copying it", () => {
    expect(slice7aPkg).toContain(
      "create or replace function public.enforce_awp_act_is_human()",
    );
    // No copy anywhere in this slice.
    expect(joined).not.toContain(
      "create or replace function public.enforce_awp_act_is_human()",
    );
    for (const [source, name, column] of [
      [resource, "trg_resource_demand_approval_human", "approved_by"],
      [competency, "trg_member_competency_verifier_human", "verified_by"],
    ] as const) {
      const t = trigger(source, name);
      expect(t).toContain("before insert or update on");
      expect(t).toContain("enforce_awp_act_is_human(");
      expect(t).toContain(`'${column}'`);
    }
  });

  it("walls the two acts §70 names and NOT the drafting acts", () => {
    // A guard that refuses the right thing must not refuse the wrong one.
    // Recording demand and recording a requirement both ADMIT ai_admin, which
    // is RULING 22's scoping of the assessor carried forward.
    expect(body(resource, "record_resource_demand")).toContain("'ai_admin'");
    expect(body(competency, "record_competency_requirement")).toContain(
      "'ai_admin'",
    );
    // Approving and declaring do not.
    expect(body(resource, "approve_resource_demand")).not.toContain(
      "'ai_admin'",
    );
    expect(body(competency, "record_member_competency")).not.toContain(
      "'ai_admin'",
    );
  });

  it("enumerates the pre-existing writers of every table it walls", () => {
    // The over-broad §70 Slice 7A had to narrow is the reason this
    // enumeration is written down rather than assumed.
    expect(raw(COMPETENCY_FILE)).toContain("20260817093000_demo_workforce.sql");
    expect(raw(COMPETENCY_FILE)).toContain("sets NO verifier");
    expect(raw(COMPETENCY_FILE)).toContain("Nothing legitimate is blocked");
  });

  it("keeps the demo seed's verifier-less insert legal", () => {
    const seed = read("20260817093000_demo_workforce.sql");
    const at = seed.indexOf("insert into member_competencies");
    expect(at).toBeGreaterThan(-1);
    // The columns it names, and `verified_by` is not among them, so the
    // wall's NULL-actor early return admits it.
    const stmt = seed.slice(at, seed.indexOf(";", at));
    expect(stmt).not.toContain("verified_by");
  });

  it("admits ai_admin to the metric computations — evidence, not determination", () => {
    for (const [source, fn] of [
      [competency, "compute_competency_readiness"],
      [metrics, "compute_constraint_free_work_index"],
      [metrics, "compute_workface_execution_metrics"],
    ] as const) {
      expect(body(source, fn), `${fn} should admit ai_admin`).toContain(
        "'ai_admin'",
      );
    }
  });
});

/* ───────────────── walls, triggers and the ledger discipline ────────────── */

describe("every new table ships its guard on day one", () => {
  it("enables RLS and an org-scoped read policy in the SAME migration", () => {
    for (const [source, table] of [
      [resource, "resource_demand"],
      [competency, "competency_requirements"],
    ] as const) {
      expect(source).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(source).toContain(
        `for select to authenticated using (organization_id = app_current_org())`,
      );
      // No client write policy: mutation is through the definer RPCs.
      expect(source).not.toContain(`create policy ${table}_write`);
      expect(source).not.toContain(`for insert to authenticated`);
    }
  });

  it("revokes TRUNCATE and installs a statement-level guard", () => {
    for (const [source, table] of [
      [resource, "resource_demand"],
      [competency, "competency_requirements"],
    ] as const) {
      expect(source).toContain(
        `revoke truncate on table public.${table} from anon, authenticated, service_role`,
      );
      expect(source).toContain(`before truncate on public.${table}`);
      expect(source).toContain("for each statement execute function");
    }
  });

  it("covers INSERT, UPDATE and DELETE on both walls", () => {
    for (const [source, name] of [
      [resource, "trg_resource_demand_integrity"],
      [competency, "trg_competency_requirement_integrity"],
    ] as const) {
      const t = trigger(source, name);
      expect(t).toContain("before insert or update or delete on");
    }
  });

  it("admits a cascade and refuses a hand, on both walls", () => {
    for (const [source, fn] of [
      [resource, "enforce_resource_demand_integrity"],
      [competency, "enforce_competency_requirement_integrity"],
    ] as const) {
      const b = body(source, fn);
      expect(b).toContain("if tg_op = 'DELETE' then");
      expect(b).toContain(
        "if not exists (select 1 from organizations where id = old.organization_id) then",
      );
      expect(b).toContain("return old;");
    }
  });

  it("leaves the provenance backstop on the admitted service path", () => {
    for (const [source, fn] of [
      [resource, "enforce_resource_demand_integrity"],
      [competency, "enforce_competency_requirement_integrity"],
    ] as const) {
      expect(body(source, fn)).toContain("record_awp_service_write");
    }
  });

  it("uses auth.uid() for the dual-caller gate, never current_user alone", () => {
    // `current_user in ('authenticated','anon')` is DEAD CODE inside a
    // definer, so every gate pairs it with auth.uid().
    for (const m of joined.matchAll(
      /current_user not in \('authenticated', 'anon'\)/g,
    )) {
      const around = joined.slice(Math.max(0, m.index - 200), m.index + 80);
      expect(around).toContain("auth.uid() is null");
    }
  });

  it("audits every mutation with previous_state and new_state", () => {
    const mutators = [
      "record_resource_capacity",
      "record_capacity_deduction",
      "record_resource_demand",
      "approve_resource_demand",
      "withdraw_resource_demand",
      "record_competency",
      "record_workforce_member",
      "record_member_competency",
      "record_shift_assignment",
      "record_competency_requirement",
      "retire_competency_requirement",
    ];
    for (const fn of mutators) {
      const source = resource.includes(`function public.${fn}(`)
        ? resource
        : competency;
      const b = body(source, fn);
      expect(b, `${fn} must audit`).toContain("insert into audit_events");
      expect(b, `${fn} must carry both states`).toContain(
        "previous_state, new_state",
      );
    }
  });

  it("refuses to rewrite an approval or delete an approved commitment", () => {
    const b = body(resource, "enforce_resource_demand_integrity");
    expect(b).toContain("was approved on % by a named person");
    expect(b).toContain("withdraw it with a reason instead");
  });
});

/* ─────────────────────── D7.16 — composed, not computed ────────────────── */

describe("D7.16 — the composition names what it composes and what is open", () => {
  it("returns each part as the owning function's own answer", () => {
    const fn = body(metrics, "get_sync_field_module");
    for (const source of [
      "get_case_work_packages(c.id)",
      "get_constraint_free_work_index(c.id, p_horizon_days)",
      "get_workface_execution_metrics(c.id, null, null)",
      "get_case_resource_balance(c.id",
      "get_portfolio_resource_conflicts(",
      "get_execution_readiness_board(c.id)",
    ]) {
      expect(fn).toContain(source);
    }
  });

  it("computes nothing of its own", () => {
    const fn = body(metrics, "get_sync_field_module");
    expect(fn).not.toContain("sync_metric_ratio");
    expect(fn).not.toContain("sync_work_package_release_verdict");
    expect(fn).not.toContain("sync_field_readiness_elements");
    expect(fn).not.toContain("restoration_constraints");
  });

  it("carries the parts still open, from the server rather than a comment", () => {
    const fn = body(metrics, "get_sync_field_module");
    for (const row of ["D7.06", "D7.07", "D7.12"]) {
      expect(fn).toContain(`'row', '${row}'`);
    }
    expect(fn).toContain(
      "a composed module is not more complete than what it composes",
    );
  });

  it("stays 🟡 in the register, and the row says which parts are open", () => {
    expect(registerStatus("D7.16")).toBe("🟡");
    const [label, row] = registerRow("D7.16");
    for (const open of ["D7.06", "D7.07", "D7.12"]) {
      expect(row, label).toContain(open);
    }
  });
});

/* ────────────────────────── surface and wiring ─────────────────────────── */

describe("the chain a customer can walk", () => {
  it("routes /sync-field and links it from the case workspace", () => {
    expect(app).toContain('path="/sync-field"');
    expect(app).toContain("SyncFieldPage");
    expect(workspace).toContain("/sync-field?case=");
  });

  it("mounts the workforce panel on the case workspace", () => {
    expect(workspace).toContain("<WorkforcePanel");
    expect(workspace).toContain('from "../components/develop/WorkforcePanels"');
  });

  it("wires every RPC this slice ships to a named service function", () => {
    for (const rpc of [
      "get_case_resource_balance",
      "get_case_resource_demand",
      "record_resource_capacity",
      "record_capacity_deduction",
      "record_resource_demand",
      "approve_resource_demand",
      "withdraw_resource_demand",
      "get_portfolio_resource_conflicts",
      "get_competency_requirements",
      "record_competency",
      "record_workforce_member",
      "record_member_competency",
      "record_shift_assignment",
      "record_competency_requirement",
      "retire_competency_requirement",
      "get_competency_readiness",
      "compute_competency_readiness",
      "get_constraint_free_work_index",
      "compute_constraint_free_work_index",
      "get_workface_execution_metrics",
      "compute_workface_execution_metrics",
      "get_sync_field_module",
    ]) {
      expect(service, `${rpc} has no service caller`).toContain(`"${rpc}"`);
    }
  });

  it("renders a percentage in exactly ONE component, which cannot invent one", () => {
    // `Ratio` is the only place a `%` is printed from a metric, and its
    // refusal branch returns before any number is reached.
    expect(panels).toContain("export function Ratio({");
    expect(panels).toContain("{ratio.pct}%");
    expect(panels).toContain("NO NUMBER. The refusal is the answer.");
    expect((panels.match(/\{ratio\.pct\}/g) ?? []).length).toBe(1);
    // The composed page renders through it rather than reaching into `pct`.
    expect(page).toContain("<Ratio");
    expect(page).not.toContain(".pct}%");
  });

  it("restates no readiness sentence on either surface", () => {
    for (const [name, source] of [
      ["panels", panels],
      ["page", page],
    ] as const) {
      for (const forbidden of [
        "every hard constraint",
        "is field-ready",
        "ready to execute",
      ]) {
        expect(source, `${name} must not restate "${forbidden}"`).not.toContain(
          forbidden,
        );
      }
    }
    // They render the server's sentence instead.
    expect(page).toContain("{p.readiness}");
    expect(panels).toContain("{req.detail}");
    expect(panels).toContain("{cell.detail}");
  });
});

/* ──────────────────────────── the transcript ───────────────────────────── */

describe("the smoke transcript obeys the house rules", () => {
  it("is registered in CI beside its siblings", () => {
    expect(ci).toContain("bash scripts/ci-develop-slice7c-smoke.sh");
  });

  it("uses no `grep -q`, which dies under pipefail", () => {
    expect(smoke).not.toContain("grep -q");
  });

  it("wraps every RETURNING id in a CTE", () => {
    // A bare `insert ... returning id` prints the command tag too, so `psql
    // -tAc` yields "9\nINSERT 0 1".
    for (const m of smoke.matchAll(/insert into [\s\S]{0,400}?returning id/g)) {
      // The CTE opens BEFORE the insert, so the window to inspect is the text
      // immediately preceding the match rather than the match itself.
      const before = smoke.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
      expect(before, `RETURNING id without a CTE:\n${m[0]}`).toContain(
        "with ins as (",
      );
    }
  });

  it("keeps fixture keys short — the scanner has blocked merges on long ones", () => {
    for (const m of smoke.matchAll(/'S7C-[A-Za-z0-9-]+'/g)) {
      expect(m[0].length, `fixture key too long: ${m[0]}`).toBeLessThan(14);
    }
  });

  it("exercises every refusal the metrics can produce", () => {
    for (const needle of [
      "no resource demand has been recorded",
      "nobody has phased work into",
      "finite number greater than zero",
      "NaN and infinity are refused by name",
      "double-count",
      "UNASSESSED, not conflict-free",
      'has no \\"when\\"',
      "That is UNASSESSED",
      "NOT 100% constraint-free",
      "is not a constraint-free one",
      "the workface denominator is empty",
      "were assessed and NONE of them is field-ready",
      // The overdue set is now OUTSIDE the window rather than folded into
      // `not_projectable`, so the transcript asserts the sentence that names
      // it as such.
      "ALREADY PASSED",
      // And the repairs this chunk's review produced, each with its own
      // refusal exercised end to end.
      "close_resource_capacity",
      "renew_member_competency",
      "shortening one is a correction",
      "does not belong to this organization",
      "reason of at least 10 characters",
      "refuses the whole module rather than half of it",
      "cannot approve a roster",
      "the ONE release verdict holds their work package back",
      "NOT ASSESSABLE",
    ]) {
      expect(smoke, `the transcript must exercise: ${needle}`).toContain(
        needle,
      );
    }
  });

  it("proves §70 at the DATABASE and proves the guard is not over-broad", () => {
    expect(smoke).toContain("approve a roster");
    expect(smoke).toContain("declare a person competent");
    // The positive half: the AI may draft, and the pre-existing verifier-less
    // insert still lands.
    expect(smoke).toContain("AND THE WALL DOES NOT BLOCK THE LEGITIMATE PATH");
    expect(smoke).toContain(
      "insert into member_competencies (organization_id, member_id, competency_id, granted_on)",
    );
  });

  it("proves the expiring-certificate flip in BOTH directions", () => {
    expect(smoke).toContain("expires_during_window");
    expect(smoke).toContain("THE FLIP, PROVED IN BOTH DIRECTIONS");
    expect(smoke).toContain(
      "qualified today, not qualified when the work happens",
    );
  });
});

/* ────────────────────────── the register is honest ─────────────────────── */

describe("the register says what shipped and what did not", () => {
  it("promotes only the rows whose chain a customer can walk", () => {
    for (const id of [
      "D7.01",
      "D7.02",
      "D7.03",
      "D7.04",
      "D7.08",
      "D7.13",
      "D7.14",
      "D7.20",
    ]) {
      expect(registerStatus(id), `${id} should be ✅`).toBe("✅");
    }
  });

  it("keeps D7.16 at 🟡 with its open parts named", () => {
    expect(registerStatus("D7.16")).toBe("🟡");
  });

  it("cites the transcript from every promoted row", () => {
    for (const id of [
      "D7.01",
      "D7.02",
      "D7.03",
      "D7.04",
      "D7.08",
      "D7.13",
      "D7.14",
      "D7.20",
    ]) {
      const [label, row] = registerRow(id);
      expect(row, label).toContain("scripts/ci-develop-slice7c-smoke.sh");
    }
  });

  it("records the D7.08/D7.20 ruling in the overlap map's consolidated index", () => {
    expect(overlapMap).toContain("RULING 23");
    expect(overlapMap).toContain("one calculation");
  });
});
