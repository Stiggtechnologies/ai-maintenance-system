/**
 * Sync Develop Slice 4A — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice4a-smoke.sh against
 * a real local database (multi-role transcript: the scope chain end to end,
 * the traceability detector in both directions, P6's fields refused to every
 * writer, the cost line that refuses an unresolvable code, growth that
 * refuses without a baseline, the eleven structures with two that refuse by
 * name, and lineage on every number).
 *
 * This file pins the CONTRACT in the migration text so a later edit that
 * loosens an invariant, forks a canonical store, drops a refusal or lets a
 * vocabulary drift from the TypeScript fails CI before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  CBS_COST_TYPES,
  CONTROLS_CALC_VERSION,
  CONTROLS_STRUCTURES,
  NEED_SOURCE_AUTHORITIES,
  SCOPE_CHAIN_LINKS,
  SCOPE_CHANGE_ORIGINS,
} from "../lib/develop/controls";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const scope = read("20261130090000_develop_scope_architecture.sql");
const schedule = read("20261130090100_develop_schedule_activity_object.sql");
const cost = read("20261130090200_develop_cost_item_object.sql");
const trace = read("20261130090300_develop_scope_traceability.sql");
const growth = read("20261130090400_develop_post_baseline_scope.sql");
const baseline = read("20261130090500_develop_controls_baseline_model.sql");
const lineage = read("20261130090600_develop_calculation_lineage.sql");
const guardRepair = read("20261130090700_dual_caller_guard_repair.sql");

const all = [
  scope,
  schedule,
  cost,
  trace,
  growth,
  baseline,
  lineage,
  guardRepair,
];
const joined = all.join("\n");
/**
 * The executable text, with `comment on … is '…'` payloads removed.
 *
 * Those payloads are DOCUMENTATION that happens to live in a string literal,
 * so a check for "does any SQL here compute an NPV" reads its own
 * disclaimer ("no kernel computes NPV/IRR/payback from it") as a hit. Column
 * and table comments are pinned elsewhere in this file on their own terms.
 */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

/** Every table this slice creates, with the file that must carry its RLS. */
const NEW_TABLES = [
  ["project_scope_needs", scope],
  ["project_cbs_codes", scope],
  ["project_wbs_elements", scope],
  ["project_requirement_wbs", scope],
  ["project_control_accounts", scope],
  ["project_cost_items", cost],
  ["project_scope_changes", growth],
  ["controls_baseline_structures", baseline],
  ["calculation_runs", lineage],
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
    const defined = all.flatMap((source) =>
      [
        ...source.matchAll(/create or replace function public\.([a-z_]+)\(/g),
      ].map((m) => m[1]),
    );
    expect(new Set(defined).size).toBeGreaterThan(15);
    for (const name of new Set(defined)) {
      expect(
        new RegExp(`revoke (all|execute) on function public\\.${name}\\(`).test(
          joined,
        ),
        `${name} is never revoked from public/anon`,
      ).toBe(true);
    }
  });

  it("every write RPC records an audit event carrying previous and new state", () => {
    // The D11.31 contract. A governed act whose audit row has no snapshots
    // records that something happened and not what changed.
    const writers = [
      "record_scope_need",
      "record_cbs_code",
      "record_wbs_element",
      "link_requirement_to_need",
      "link_requirement_to_wbs",
      "designate_control_account",
      "record_local_schedule_activity",
      "set_schedule_activity_wbs",
      "record_cost_item",
      "attribute_post_baseline_scope",
      "capture_controls_baseline_structure",
      "record_calculation_run",
    ];
    for (const fn of writers) {
      const body = joined.slice(
        joined.indexOf(`create or replace function public.${fn}(`),
      );
      const end = body.indexOf("\n$$;");
      const scoped = body.slice(0, end === -1 ? body.length : end);
      expect(scoped, `${fn} writes no audit row`).toContain(
        "insert into audit_events",
      );
      expect(scoped, `${fn} audits without previous_state/new_state`).toContain(
        "previous_state, new_state",
      );
    }
  });
});

describe("enforcement triggers cover the operations an act could be dodged by", () => {
  const TRIGGERS: [string, string, RegExp][] = [
    ["trg_wbs_tree_integrity", scope, /before insert or update on/],
    ["trg_control_account_no_nesting", scope, /before insert or update on/],
    [
      "trg_schedule_activity_provenance",
      schedule,
      /before insert or update or delete on/,
    ],
    ["trg_cost_item_coding", cost, /before insert or update on/],
    ["trg_post_baseline_scope", growth, /before insert or update or delete on/],
    [
      "trg_controls_baseline_capture_immutable",
      baseline,
      /before update or delete on/,
    ],
    ["trg_calculation_run_immutable", lineage, /before update or delete on/],
  ];

  it.each(TRIGGERS)("%s covers the right operations", (name, source, shape) => {
    const at = source.indexOf(`create trigger ${name}`);
    expect(at, `${name} is not created`).toBeGreaterThan(-1);
    expect(source.slice(at, at + 220)).toMatch(shape);
  });

  it("every enforcement trigger with an UPDATE arm carries an is-distinct guard", () => {
    for (const fn of [
      "enforce_wbs_tree_integrity",
      "enforce_control_account_no_nesting",
      "enforce_schedule_activity_provenance",
      "enforce_cost_item_coding",
      "enforce_post_baseline_scope",
    ]) {
      const at = joined.indexOf(`create or replace function public.${fn}(`);
      const body = joined.slice(at, joined.indexOf("\n$$;", at));
      expect(body, `${fn} has no is-distinct guard`).toMatch(
        /is (not )?distinct from/,
      );
    }
  });

  it("EVERY table this slice writes refuses TRUNCATE and revokes the verb", () => {
    // A row-level trigger never fires for TRUNCATE and RLS does not gate it
    // (the audit_events lesson, 20261121090000), so every row-level wall in
    // this slice was one statement away from irrelevant — for every tenant at
    // once. Supabase's defaults grant the verb to anon, authenticated AND
    // service_role, so revoking from public/anon is not enough.
    for (const [table, source] of [
      ["project_scope_needs", scope],
      ["project_cbs_codes", scope],
      ["project_wbs_elements", scope],
      ["project_requirement_wbs", scope],
      ["project_control_accounts", scope],
      ["project_cost_items", cost],
      ["project_scope_changes", growth],
      ["shutdown_tasks", schedule],
      ["controls_baseline_structures", baseline],
      ["calculation_runs", lineage],
    ] as const) {
      expect(source).toMatch(
        new RegExp(
          `create trigger trg_[a-z_]+_no_truncate\\s+on public\\.${table}|before truncate on public\\.${table}`,
        ),
      );
      expect(source).toContain(
        `revoke truncate on table public.${table} from anon, authenticated, service_role`,
      );
    }
  });
});

describe("the walls the adversarial review found missing", () => {
  it("controls_structure_state resolves the case inside the caller's tenant", () => {
    const at = baseline.indexOf(
      "create or replace function public.controls_structure_state(",
    );
    const body = baseline.slice(at, baseline.indexOf("\n$$;", at));
    expect(body).toContain("v_caller_org uuid := app_current_org()");
    expect(body).toMatch(
      /v_caller_org is null or organization_id = v_caller_org/,
    );
  });

  it("a cost line is denominated in its business case's currency, at every writer", () => {
    // A CAD default on the line and a USD default on the business case turned
    // an exchange rate into a reported project variance.
    expect(cost).not.toMatch(/currency text not null default 'CAD'/);
    const at = cost.indexOf(
      "create or replace function public.enforce_cost_item_coding(",
    );
    const body = cost.slice(at, cost.indexOf("\n$$;", at));
    expect(body).toContain("new.currency is distinct from v_bc_currency");
    expect(body).toMatch(/reconcile in one currency/);
    // ...and the RPC refuses an explicit disagreement by name rather than
    // silently re-denominating on a revise.
    expect(cost).toMatch(
      /v_currency_raw is not null and v_currency_raw <> bc\.currency/,
    );
    expect(cost).toContain("'currency', existing.currency");
  });

  it("the cost line anchors to the business case the finance family reads", () => {
    // Every pre-existing reader takes `order by created_at desc, id desc`;
    // this took the FIRST row, so a case with two business cases produced a
    // variance that was two functions disagreeing about the anchor.
    expect(cost).not.toMatch(
      /from business_cases[\s\S]{0,120}order by created_at limit 1/,
    );
    expect(
      cost.match(/order by created_at desc, id desc limit 1/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(cost).toMatch(/carries %s business cases/);
  });

  it("the reconciliation refuses a partial baseline instead of pricing the rest at zero", () => {
    expect(cost).toContain("elsif v_baselined < v_lines then");
    expect(cost).toMatch(/cost line\(s\) carry no baseline cost/);
    // reconciles/variance are gated on a single comparability flag, so a
    // partial denominator cannot produce "they agree".
    expect(cost).toMatch(
      /'reconciles', case when v_comparable and v_capital is not null/,
    );
    expect(cost).toMatch(
      /'variance', case when v_comparable and v_capital is not null/,
    );
  });

  it("the reconciliation refuses several spending options instead of taking the oldest", () => {
    expect(cost).toContain("elsif v_real_options > 1 then");
    expect(cost).toMatch(/nothing records which one is the plan of record/);
    // ...and NAMES the option it did use.
    expect(cost).toMatch(/'optionLabel'/);
  });

  it("a currency is never borrowed from whichever row sorted first", () => {
    expect(cost).not.toMatch(
      /'currency', \(select currency from project_cost_items/,
    );
    expect(cost).toMatch(
      /are not addable, so there is no line total to compare/,
    );
  });

  it("control_account_id is inside the is-distinct guard and re-derived", () => {
    const at = cost.indexOf(
      "create or replace function public.enforce_cost_item_coding(",
    );
    const body = cost.slice(at, cost.indexOf("\n$$;", at));
    expect(body).toContain(
      "new.control_account_id is not distinct from old.control_account_id",
    );
    expect(body).toContain(
      "new.control_account_id := resolve_control_account_for_wbs(new.wbs_element_id)",
    );
  });

  it("a cost line's organization and its case's organization must agree", () => {
    const at = cost.indexOf(
      "create or replace function public.enforce_cost_item_coding(",
    );
    const body = cost.slice(at, cost.indexOf("\n$$;", at));
    expect(body).toMatch(/v_case_org <> new\.organization_id/);
  });

  it("re-baselining does not erase recorded scope growth", () => {
    // Approving SCOPE v2 supersedes v1, and every attribution made against v1
    // fell out of the answer entirely — while D5.04's `changes` structure
    // still counted the rows. Two answers to one question.
    expect(growth).toContain("'priorBaselines', jsonb_build_object(");
    expect(growth).toMatch(/superseded SCOPE baseline/);
    expect(growth).toMatch(/order by version desc limit 1/);
  });

  it("scope growth refuses a total across several currencies", () => {
    expect(growth).toMatch(/are not addable/);
    expect(growth).toContain("'costTotalRefusal', v_cost_refusal");
    expect(growth).toContain("'currency', v_currency");
  });

  it("the approved-change columns are §70-reserved at the ROW, not only at the door", () => {
    const at = growth.indexOf(
      "create or replace function public.enforce_post_baseline_scope(",
    );
    const body = growth.slice(at, growth.indexOf("\n$$;", at));
    expect(body).toContain("v_approval_changed");
    expect(body).toContain(
      "new.approved_change_ref is distinct from old.approved_change_ref",
    );
    expect(body).toMatch(/governance determination \(spec §70\)/);
    // client refused, service admitted AND audited
    expect(body).toContain("insert into security_events");
  });

  it("the scope-change write marker is set by the door it guards", () => {
    // The marker branch read a GUC nothing anywhere set — a governed door
    // that did not exist.
    expect(growth).toContain(
      "perform set_config('app.scope_change_write', 'granted', true)",
    );
  });

  it("a capture describes the approval instant, not the moment it was taken", () => {
    const at = baseline.indexOf(
      "create or replace function public.capture_controls_baseline_structure(",
    );
    const body = baseline.slice(at, baseline.indexOf("\n$$;", at));
    expect(body).toContain("v_changed > b.approved_at");
    expect(body).toMatch(/AFTER %s v%s was approved at %s/);
    expect(baseline).toContain("structure_last_changed_at timestamptz");
  });

  it("a schedule activity's origin comes from the row's own evidence", () => {
    // Defaulting to 'imported' branded eight demo rows P6 has never seen as
    // P6 output, permanently — origin never flips.
    expect(schedule).not.toMatch(
      /add column if not exists origin text not null default 'imported'/,
    );
    expect(schedule).toContain("alter column origin set default 'local'");
    expect(schedule).toMatch(
      /set origin = case[\s\S]{0,200}source_system is not null and external_id is not null then 'imported'/,
    );
    // ...and an 'imported' row with no source pair is no longer legal.
    expect(schedule).toContain(
      "(origin = 'imported' and source_system is not null and external_id is not null",
    );
  });

  it("a service INSERT of a schedule activity is audited, not silent", () => {
    const at = schedule.indexOf(
      "create or replace function public.enforce_schedule_activity_provenance(",
    );
    const body = schedule.slice(at, schedule.indexOf("\n$$;", at));
    const insertArm = body.slice(
      body.indexOf("if tg_op = 'INSERT' then"),
      body.indexOf("if tg_op = 'DELETE' then"),
    );
    expect(insertArm).toContain("insert into security_events");
  });

  it("designating a control account serializes the nesting decision", () => {
    // Check-then-insert with no lock: two transactions on a parent and its
    // child both commit, and the roll-up point becomes ambiguous.
    const at = scope.indexOf(
      "create or replace function public.designate_control_account(",
    );
    const body = scope.slice(at, scope.indexOf("\n$$;", at));
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      body.indexOf("control accounts do not nest"),
    );
  });

  it("the five scope tables carry the §70 provenance backstop and an org arm", () => {
    const at = scope.indexOf(
      "create or replace function public.enforce_scope_architecture_provenance(",
    );
    expect(at).toBeGreaterThan(-1);
    const body = scope.slice(at, scope.indexOf("\n$$;", at));
    expect(body).toContain("insert into security_events");
    expect(body).toContain("v_case_org <> v_org");
    for (const table of [
      "project_scope_needs",
      "project_cbs_codes",
      "project_wbs_elements",
      "project_requirement_wbs",
      "project_control_accounts",
    ]) {
      expect(
        new RegExp(
          `before insert or update or delete on public\\.${table}\\s+for each row execute function public\\.enforce_scope_architecture_provenance`,
        ).test(scope),
        `${table} has no provenance trigger`,
      ).toBe(true);
    }
  });

  it("a requirement cannot trace to another case's need, for any writer", () => {
    // Without this a foreign requirement closed the need gap: the report said
    // the case had zero requirements and that this need had one.
    expect(scope).toContain(
      "create or replace function public.enforce_requirement_need_case_agreement(",
    );
    expect(scope).toMatch(
      /before insert or update on public\.design_requirements/,
    );
    expect(scope).toContain(
      "create or replace function public.enforce_requirement_wbs_case_agreement(",
    );
    // ...and the detector filters by case as well, rather than trusting it.
    expect(trace).toMatch(
      /d\.scope_need_id = n\.id\s*\n\s*and d\.development_case_id = c\.id/,
    );
    expect(lineage).toMatch(
      /d\.scope_need_id = n\.id and d\.development_case_id = c\.id/,
    );
  });

  it("a withdrawn need un-traces the requirements that rested on it", () => {
    expect(scope).toContain(
      "create or replace function public.set_scope_need_status(",
    );
    expect(scope).toMatch(/status must be one of: open, met, withdrawn/);
    expect(trace).toMatch(/n\.status <> 'withdrawn'/);
    expect(trace).toContain("'withdrawnNeedRef'");
  });

  it("re-parenting a WBS element refreshes its whole subtree's depth", () => {
    expect(scope).toContain(
      "create or replace function public.refresh_wbs_subtree_depth(",
    );
    expect(scope).toMatch(/after update on public\.project_wbs_elements/);
    // The fast path must DERIVE depth rather than freeze it, or the refresh
    // below is a no-op.
    const at = scope.indexOf(
      "create or replace function public.enforce_wbs_tree_integrity(",
    );
    const body = scope.slice(at, scope.indexOf("\n$$;", at));
    expect(body).not.toContain("new.depth := old.depth;");
    expect(body).toContain(
      "(select p.depth from project_wbs_elements p where p.id = new.parent_id), 0) + 1",
    );
    // ...and the derived ROLL-UP POINT moves with the branch too: a cost line
    // left pointing at an account that is no longer above it counts money
    // against another branch, with nothing reporting it.
    const refresh = scope.slice(
      scope.indexOf(
        "create or replace function public.refresh_wbs_subtree_depth(",
      ),
      scope.indexOf(
        "\n$$;",
        scope.indexOf(
          "create or replace function public.refresh_wbs_subtree_depth(",
        ),
      ),
    );
    expect(refresh).toContain("update project_cost_items ci");
    expect(refresh).toContain(
      "resolve_control_account_for_wbs(ci.wbs_element_id)",
    );
  });

  it("the functions this slice withholds from service are revoked from it", () => {
    // Supabase's default privileges already granted service_role EXECUTE, and
    // revoking from public/anon does not remove an explicit role grant — so
    // the stated ACL and the enforced one differed.
    for (const [fn, sig, source] of [
      ["capture_controls_baseline_structure", "uuid, text", baseline],
      ["compute_case_scope_growth", "uuid", lineage],
      ["compute_case_cost_reconciliation", "uuid", lineage],
      ["get_case_controls", "uuid", lineage],
    ] as const) {
      expect(
        source,
        `${fn} still leaves service_role's default grant in place`,
      ).toContain(
        `revoke all on function public.${fn}(${sig}) from public, anon, service_role;`,
      );
    }
  });

  it("the chain's system link is reachable from the product", () => {
    // record_wbs_element validated a system_node_id nothing could supply: the
    // organizations RLS policy exposes only the caller's own root row, so the
    // link was reported `built` and was structurally dead.
    expect(lineage).toContain("'systemNodes', v_system_nodes");
    expect(lineage).toContain("org_node_in_scope(o.id, v_org)");
    expect(trace).toContain("'optional', true");
  });
});

describe("no canonical store is forked", () => {
  it("the controls baseline hangs off development_baselines — it is not a second Baseline", () => {
    expect(baseline).toContain(
      "baseline_id uuid not null references development_baselines(id)",
    );
    // No second approval act, no second version counter.
    expect(baseline).not.toMatch(/create table[^;]+baseline_versions/);
    expect(baseline).not.toMatch(/approved_by uuid[^;]*not null/);
  });

  it("the requirement leg is a COLUMN on design_requirements, not a new table", () => {
    expect(scope).toContain("alter table public.design_requirements");
    expect(scope).toContain("add column if not exists scope_need_id uuid");
    expect(scope).not.toMatch(/create table[^;]+project_requirements? \(/);
  });

  it("schedule activities stay on the shutdown family — no second schedule store", () => {
    expect(schedule).toContain("alter table public.shutdown_tasks");
    expect(schedule).not.toMatch(/create table[^;]+schedule_activities/);
  });

  it("the OBS is the one organizations tree plus an accountable person", () => {
    expect(scope).toContain(
      "accountable_owner_id uuid not null references auth.users(id)",
    );
    expect(scope).toContain("org_node_id uuid references organizations(id)");
    expect(scope).not.toMatch(/create table[^;]+obs_nodes/);
  });

  it("cost items decompose the Slice 2 business case rather than replacing it", () => {
    expect(cost).toContain(
      "business_case_id bigint not null references business_cases(id)",
    );
  });

  it("no SQL in this slice computes NPV, IRR or payback from a cost line", () => {
    // The value kernel is src/lib/value and stays the only one (D2.04's
    // ruling). A cost line feeding an NPV would be the second cost truth
    // this slice's header forbids.
    expect(executable).not.toMatch(/\bnpv\b/);
    expect(executable).not.toMatch(/\birr\b/);
    expect(executable).not.toMatch(/payback/);
  });
});

describe("refusal-first — nothing defaults", () => {
  it("every money column is finite-or-refused with explicit literal comparison", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres and NaN sorts ABOVE
    // every number, so `>= 0` is vacuously satisfied by NaN and +Infinity.
    expect(cost).toContain("constraint cost_item_amounts_finite check (");
    expect(cost).toContain("< 'Infinity'::numeric");
    expect(cost).toContain("> '-Infinity'::numeric");
    expect(growth).toContain("constraint scope_change_cost_finite check (");
    for (const source of [schedule, cost, growth]) {
      expect(source).toMatch(/= 'NaN'::numeric/);
    }
  });

  it("the roll-up point is the nearest control account AT OR ABOVE the element", () => {
    // Exact-match resolution reported every line below a control account as
    // uncoded, and D5.02 then showed a gap that was not there. Control
    // accounts do not nest, so "nearest at or above" is unambiguous.
    expect(scope).toContain(
      "create or replace function public.resolve_control_account_for_wbs(",
    );
    expect(cost).toContain(
      "new.control_account_id := resolve_control_account_for_wbs(new.wbs_element_id)",
    );
    // …and designating an account backfills the lines already on its branch,
    // so a line recorded first does not stay an orphan until it is re-typed.
    const at = scope.indexOf(
      "create or replace function public.designate_control_account(",
    );
    const body = scope.slice(at, scope.indexOf("\n$$;", at));
    expect(body).toContain("update project_cost_items ci");
    expect(body).toContain(
      "resolve_control_account_for_wbs(ci.wbs_element_id)",
    );
  });

  it("a cost line whose WBS code does not resolve is refused, not parked", () => {
    expect(cost).toContain(
      "wbs_element_id uuid not null references project_wbs_elements(id)",
    );
    expect(cost).toMatch(/does not resolve on this case/);
    expect(cost).toMatch(/rather than parked in an unassigned bucket/);
  });

  it("contingency and cost effects carry a mandatory basis", () => {
    expect(cost).toContain("constraint cost_item_contingency_basis check (");
    expect(growth).toContain("constraint scope_change_cost_basis check (");
  });

  it("scope growth refuses outright when no SCOPE baseline is approved", () => {
    expect(growth).toMatch(/has no approved SCOPE baseline/);
    expect(growth).toMatch(/growth measured against nothing is an inventory/);
  });

  it("percentages over an empty denominator are NULL, never 0 and never 100", () => {
    expect(trace).toMatch(/case when v_req_total = 0 then null/);
    expect(trace).toMatch(/case when v_act_total = 0 then null/);
    expect(baseline).toMatch(/case when v_captured = 0 then null/);
    expect(cost).toMatch(/case when v_baselined = 0 then null/);
  });

  it("a structure with no home refuses by name instead of reporting zero", () => {
    // THIS PINS 20261130090500's OWN TEXT, which is history and must not be
    // rewritten. The LIVE predicate is 20261201090000's replacement: Slice 4B
    // gave progress a home (project_rules_of_credit + the planned curve) and
    // the refusal there is now "nothing has been recorded to look at" rather
    // than "there is nowhere to look" — asserted, including that this
    // sentence is gone from the live body, in
    // developSlice4bPerformanceMigration.test.ts.
    expect(baseline).toMatch(/Progress has no home in this repository yet/);
    expect(baseline).toMatch(/D5\.19\/D5\.20/);
    expect(baseline).toMatch(/Nothing is recorded in %s for this case/);
  });

  it("the deferred chain links are named in the report, not omitted", () => {
    expect(trace).toContain("'work package'");
    expect(trace).toContain("'contract'");
    expect(trace).toMatch(/'deferral'/);
  });
});

describe("§70 — no AI identity sets a baseline or asserts a governance act", () => {
  it("capturing a controls baseline refuses ai_admin BY NAME", () => {
    const at = baseline.indexOf(
      "create or replace function public.capture_controls_baseline_structure(",
    );
    const body = baseline.slice(at, baseline.indexOf("\n$$;", at));
    expect(body).toMatch(/= 'ai_admin'/);
    expect(body).toMatch(/human accountability act/);
    expect(body).toMatch(/§70|spec §70/);
  });

  it("asserting an approved change request is refused to the AI-operator identity", () => {
    const at = growth.indexOf(
      "create or replace function public.attribute_post_baseline_scope(",
    );
    const body = growth.slice(at, growth.indexOf("\n$$;", at));
    expect(body).toMatch(/ai_admin/);
    expect(body).toMatch(/governance determination/);
  });

  it("a business need recorded by the AI identity is capped at AI_SUGGESTION", () => {
    expect(scope).toMatch(/AI_SUGGESTION tier/);
  });
});

describe("P6 stays the system of record (spec §22, §77)", () => {
  const P6_OWNED = [
    "task_key",
    "label",
    "duration_hours",
    "planned_start",
    "planned_finish",
    "calendar_name",
    "wbs_path",
    "source_system",
    "external_id",
  ];

  it("every P6-owned field is guarded on an imported activity", () => {
    const at = schedule.indexOf(
      "create or replace function public.enforce_schedule_activity_provenance(",
    );
    const body = schedule.slice(at, schedule.indexOf("\n$$;", at));
    for (const field of P6_OWNED) {
      expect(body, `${field} is not guarded`).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    }
  });

  it("wbs_element_id is NOT in the guarded set — annotating is the point", () => {
    const at = schedule.indexOf(
      "create or replace function public.enforce_schedule_activity_provenance(",
    );
    const body = schedule.slice(at, schedule.indexOf("\n$$;", at));
    expect(body).not.toContain(
      "new.wbs_element_id is distinct from old.wbs_element_id",
    );
  });

  it("origin never flips, for any writer, with no service branch", () => {
    const at = schedule.indexOf(
      "create or replace function public.enforce_schedule_activity_provenance(",
    );
    const body = schedule.slice(at, schedule.indexOf("\n$$;", at));
    const flip = body.indexOf("new.origin is distinct from old.origin");
    const serviceBranch = body.indexOf("not v_client and current_user");
    expect(flip).toBeGreaterThan(-1);
    // The flip refusal is raised BEFORE any admit-and-audit branch is reached.
    expect(flip).toBeLessThan(serviceBranch);
  });

  it("a local activity is structurally distinguishable from an imported one", () => {
    expect(schedule).toContain("shutdown_tasks_origin_provenance");
    expect(schedule).toContain("source_system is null and external_id is null");
  });

  it("no write-back path to P6 exists anywhere in this slice", () => {
    expect(executable).not.toMatch(/write.?back to p6|push to p6|update p6/);
  });

  it("the re-created import door is the ONE door and stays service-only", () => {
    expect(schedule).toContain(
      "revoke all on function public.ingest_schedule_batch(uuid, jsonb) from public, anon, authenticated",
    );
    expect(schedule).toContain(
      "grant execute on function public.ingest_schedule_batch(uuid, jsonb) to service_role",
    );
    // The splice must keep every refusal the Slice 1 validator shipped.
    for (const refusal of [
      "missing activity_id",
      "appears more than once in this upload",
      "a duration must be a finite number of hours",
      "an activity cannot finish before it begins",
      "unknown predecessor",
      "already loaded — another run wrote this external_id",
    ]) {
      expect(schedule, `the spliced door dropped: ${refusal}`).toContain(
        refusal,
      );
    }
  });
});

describe("one predicate, several sites", () => {
  it("get_case_scope_traceability is defined once and consumed by the read and the calculation", () => {
    const defs = [
      ...joined.matchAll(
        /create or replace function public\.get_case_scope_traceability\(/g,
      ),
    ];
    expect(defs).toHaveLength(1);
    expect(lineage).toContain("get_case_scope_traceability(c.id)");
    // Both the read path and the recorded calculation consume it.
    expect(
      lineage.indexOf("v_trace := get_case_scope_traceability(c.id)"),
    ).toBeGreaterThan(-1);
  });

  it("controls_structure_state is the only implementation of what a structure holds", () => {
    const defs = [
      ...joined.matchAll(
        /create or replace function public\.controls_structure_state\(/g,
      ),
    ];
    expect(defs).toHaveLength(1);
    expect(baseline).toContain("v_state := controls_structure_state(");
    expect(baseline).toContain("controls_structure_state(c.id, v_name)");
  });

  it("the dual-caller gate discriminates on auth.uid(), never on current_user", () => {
    // Inside a SECURITY DEFINER owned by postgres, current_user IS postgres —
    // so `if v_caller_org is null and current_user in ('authenticated','anon')`
    // can NEVER fire, and a JWT holder with no user_profiles row fell straight
    // through to a query whose org filter that same NULL had switched off.
    // Every read in this slice is now gated on auth.uid(), and the dead form
    // may not come back.
    for (const fn of [
      "get_case_scope_traceability",
      "get_case_scope_growth",
      "get_case_cost_reconciliation",
      "get_case_controls_baseline",
      "get_case_calculation_lineage",
      "controls_structure_state",
    ]) {
      const at = joined.indexOf(`create or replace function public.${fn}(`);
      expect(at, `${fn} is not defined`).toBeGreaterThan(-1);
      const body = joined.slice(at, joined.indexOf("\n$$;", at));
      expect(body, `${fn} has no caller gate`).toContain(
        "if auth.uid() is not null and v_caller_org is null then",
      );
      expect(
        body,
        `${fn} still guards on current_user, which is postgres inside a definer`,
      ).not.toContain("v_caller_org is null and current_user in");
      expect(body, `${fn} does not scope the case to the caller's org`).toMatch(
        /v_caller_org is null or organization_id = v_caller_org/,
      );
    }
  });

  it("the three already-merged reads carrying the dead guard are repaired", () => {
    // The dead form is inherited, not invented here: three functions merged in
    // Slice 3C still open with it, and each therefore lets a JWT holder with no
    // user_profiles row read any development case. The repair rewrites ONLY
    // that predicate, from each function's own definition, and RAISES if the
    // predicate is not found — a repair that silently applied nothing would be
    // worse than none.
    const repair = read("20261130090700_dual_caller_guard_repair.sql");
    for (const fn of [
      "get_case_commitment_coverage",
      "get_case_assurance_position",
      "case_gate_outstanding_obligations",
    ]) {
      expect(repair, `${fn} is not repaired`).toContain(`'${fn}'`);
    }
    expect(repair).toContain("pg_get_functiondef(p.oid)");
    expect(repair).toContain("auth.uid() is not null and v_caller_org is null");
    expect(repair).toMatch(/do not apply this repair blind/);
    expect(repair).toMatch(/expected to repair 3 dual-caller guards/);
  });

  it("no migration in this slice reintroduces the dead guard", () => {
    for (const source of all) {
      expect(source).not.toContain(
        "v_caller_org is null and current_user in ('authenticated', 'anon')",
      );
    }
  });

  it("controls_structure_state is granted to nobody — its callers are definers", () => {
    // It used to be `grant execute … to authenticated` with NO organization
    // check of any kind: a signed-in user of any tenant could read another
    // tenant's element counts and a stable md5 over its identifying fields.
    expect(baseline).toContain(
      "revoke all on function public.controls_structure_state(uuid, text)\n  from public, anon, authenticated, service_role;",
    );
    expect(baseline).not.toMatch(
      /grant execute on function public\.controls_structure_state/,
    );
  });
});

describe("calculation lineage (D11.29)", () => {
  it("the code version is server-side and pinned, never caller-supplied", () => {
    expect(lineage).toContain(
      "create or replace function public.sync_calculation_code_version(",
    );
    const at = lineage.indexOf(
      "create or replace function public.record_calculation_run(",
    );
    const body = lineage.slice(at, lineage.indexOf("\n$$;", at));
    expect(body).toContain("v_version text := sync_calculation_code_version(");
    expect(body).not.toMatch(/p_code_version/);
  });

  it("an unknown calculation key refuses rather than recording 'unknown'", () => {
    expect(lineage).toMatch(/no code version is pinned for calculation key/);
  });

  it("the recorder is not callable by a client", () => {
    expect(lineage).toContain(
      "revoke all on function public.record_calculation_run(uuid, text, text, jsonb, jsonb, jsonb, jsonb)\n  from public, anon, authenticated",
    );
  });

  it("a run records refusals as a first-class field, and outcome shape is enforced", () => {
    expect(lineage).toContain("refusals jsonb not null default '[]'::jsonb");
    expect(lineage).toContain("constraint calculation_run_outcome check (");
    expect(lineage).toMatch(/'computed_with_refusals'/);
  });

  it("the pinned version matches the TypeScript constant exactly", () => {
    const versions = [...lineage.matchAll(/'(develop-controls\/[^']+)'/g)].map(
      (m) => m[1],
    );
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(v).toBe(CONTROLS_CALC_VERSION);
    }
  });

  it("every pinned calculation key is one a compute function actually records", () => {
    // A pinned key nothing records reads as coverage that does not exist, and
    // get_case_calculation_lineage can never return it.
    const keys = [
      ...lineage.matchAll(/\('([a-z_]+)',\s+'develop-controls/g),
    ].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        new RegExp(`record_calculation_run\\([\\s\\S]{0,120}'${key}'`).test(
          lineage,
        ),
        `'${key}' is pinned but no compute function records it`,
      ).toBe(true);
    }
  });

  it("a recorded run's input refs are the rows its aggregate summed", () => {
    // The refs listed every scope change on the case while the aggregate sums
    // only those on the CURRENT baseline: replaying the record produced a
    // different number than the record's own output.
    const at = lineage.indexOf(
      "create or replace function public.compute_case_scope_growth(",
    );
    const body = lineage.slice(at, lineage.indexOf("\n$$;", at));
    expect(body).toContain(
      "sc.baseline_id = (v_growth->'baseline'->>'id')::uuid",
    );
  });

  it("a recorded figure carries its own currency", () => {
    // A surface that has to pair a recorded number with a separately-read
    // currency can render it under the wrong symbol.
    for (const fn of [
      "compute_case_scope_growth",
      "compute_case_cost_reconciliation",
    ]) {
      const at = lineage.indexOf(`create or replace function public.${fn}(`);
      const body = lineage.slice(at, lineage.indexOf("\n$$;", at));
      expect(body, `${fn} records a figure with no unit`).toMatch(
        /'currency', v_(growth|recon)->'currency'/,
      );
    }
  });
});

describe("the vocabularies cannot drift from the database", () => {
  it("the eleven controls structures are the spec I.8 eleven, in both places", () => {
    const inSql = /structure text not null check \(structure in\s*\(([^)]+)\)/
      .exec(baseline)?.[1]
      ?.match(/'([a-z_]+)'/g)
      ?.map((s) => s.replaceAll("'", ""));
    expect(inSql).toBeDefined();
    expect(inSql).toHaveLength(11);
    expect(CONTROLS_STRUCTURES.map((s) => s.value)).toEqual(inSql);
  });

  it("the CBS cost types match the CHECK", () => {
    const inSql = /cost_type text not null check \(cost_type in\s*\(([^)]+)\)/
      .exec(scope)?.[1]
      ?.match(/'([a-z_]+)'/g)
      ?.map((s) => s.replaceAll("'", ""));
    expect(CBS_COST_TYPES.map((t) => t.value)).toEqual(inSql);
  });

  it("the scope-change origins match the CHECK", () => {
    const inSql = /origin text not null check \(origin in\s*\(([^)]+)\)/
      .exec(growth)?.[1]
      ?.match(/'([a-z_]+)'/g)
      ?.map((s) => s.replaceAll("'", ""));
    expect(SCOPE_CHANGE_ORIGINS.map((o) => o.value)).toEqual(inSql);
  });

  it("the need source authorities are the eight GateRequirement tiers", () => {
    expect(NEED_SOURCE_AUTHORITIES).toHaveLength(8);
    for (const tier of NEED_SOURCE_AUTHORITIES) {
      expect(scope).toContain(`'${tier}'`);
    }
  });

  it("the chain links the report emits are the spec I.6 chain, in order", () => {
    const emitted = [...trace.matchAll(/'link', '([^']+)'/g)].map((m) => m[1]);
    expect(emitted).toEqual([...SCOPE_CHAIN_LINKS]);
  });
});

describe("the rulings this slice took are written down where they bind", () => {
  it("the WBS-order ruling is stated in the migration that implements it", () => {
    const text = raw("20261130090000_develop_scope_architecture.sql");
    expect(text).toMatch(/RULING 1/);
    expect(text).toMatch(/WBS at last/);
    expect(text).toMatch(/spec's own order/);
  });

  it("the deferred-link ruling names the slice that owns each", () => {
    const text = raw("20261130090000_develop_scope_architecture.sql");
    expect(text).toMatch(/Work package\s+DEFERRED, NAMED/);
    expect(text).toMatch(/Contract\s+DEFERRED, NAMED/);
  });

  it("the OBS ruling is stated where the column lives", () => {
    const text = raw("20261130090000_develop_scope_architecture.sql");
    expect(text).toMatch(/RULING 3 — OBS IS NOT A NEW TABLE/);
  });

  it("the not-a-second-cost-truth ruling is stated on the CostItem migration", () => {
    const text = raw("20261130090200_develop_cost_item_object.sql");
    expect(text).toMatch(/THIS IS NOT A SECOND COST TRUTH/);
  });
});
