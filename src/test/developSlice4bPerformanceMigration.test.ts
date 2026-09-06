/**
 * Sync Develop Slice 4B — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice4b-smoke.sh against
 * a real local database (multi-role transcript: a claim with no applicable
 * rule of credit refused, a percent that cannot be typed, every earned-value
 * metric refusing by name on its own missing input, an eight-dimension basis
 * that refuses the seventh, a cross-check that reports UNRATED rather than
 * confirmed, and a P80 that is absent rather than manufactured).
 *
 * This file pins the CONTRACT in the migration text so a later edit that
 * loosens an invariant, forks a canonical store, coalesces a missing input to
 * zero, silently swaps the EAC formula or lets a vocabulary drift from the
 * TypeScript fails CI before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  EAC_FORMULA,
  ESTIMATE_BASIS_DIMENSIONS,
  ESTIMATE_CLASSES,
  PERFORMANCE_CALC_KEYS,
  PERFORMANCE_CALC_VERSION,
  PROGRESS_EVIDENCE_SOURCES,
  QUOTATION_SUPPORT_LEVELS,
  RULE_OF_CREDIT_WORK_TYPES,
  SCOPE_MATURITIES,
} from "../lib/develop/performance";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const CREDIT_FILE = "20261201090000_develop_rules_of_credit.sql";
const ESTIMATE_FILE = "20261201090100_develop_estimate_basis.sql";
const INTEGRITY_FILE = "20261201090200_develop_progress_integrity.sql";
const EV_FILE = "20261201090300_develop_earned_value.sql";
const FORECAST_FILE = "20261201090400_develop_forecast_confidence.sql";

const credit = read(CREDIT_FILE);
const estimate = read(ESTIMATE_FILE);
const integrity = read(INTEGRITY_FILE);
const ev = read(EV_FILE);
const forecast = read(FORECAST_FILE);

const files = [credit, estimate, integrity, ev, forecast];
const joined = files.join("\n");
const rawJoined = [
  CREDIT_FILE,
  ESTIMATE_FILE,
  INTEGRITY_FILE,
  EV_FILE,
  FORECAST_FILE,
]
  .map(raw)
  .join("\n");

/**
 * The executable text with `comment on … is '…'` payloads removed. Those are
 * DOCUMENTATION that happens to live in a string literal, so a check like
 * "does anything here coalesce an actual to zero" reads its own disclaimer as
 * a hit. (The 4A precedent, kept.)
 */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

const NEW_TABLES = [
  ["project_rules_of_credit", credit],
  ["project_progress_periods", credit],
  ["project_progress_claims", credit],
  ["project_estimate_basis", estimate],
  ["project_progress_evidence", integrity],
] as const;

/* ────────────────────── the vocabularies do not drift ─────────────────── */

describe("the vocabularies the spec fixes are pinned to the database", () => {
  it("the six work types a rule of credit can govern", () => {
    for (const t of RULE_OF_CREDIT_WORK_TYPES) {
      expect(credit, `${t.value} is not in the applies_to CHECK`).toContain(
        `'${t.value}'`,
      );
    }
    expect(RULE_OF_CREDIT_WORK_TYPES).toHaveLength(6);
  });

  it("spec II.9's six cross-check sources, in the spec's own order", () => {
    for (const s of PROGRESS_EVIDENCE_SOURCES) {
      expect(
        integrity,
        `${s.value} is not in the evidence_source CHECK`,
      ).toContain(`'${s.value}'`);
    }
  });

  it("the estimate classes, maturities and quotation levels", () => {
    for (const v of [
      ...ESTIMATE_CLASSES,
      ...SCOPE_MATURITIES,
      ...QUOTATION_SUPPORT_LEVELS,
    ]) {
      expect(estimate).toContain(`'${v.value}'`);
    }
  });

  it("all EIGHT estimate-basis dimensions are columns, and each is NOT NULL", () => {
    // The row is "eight dimensions" and the spec paragraph asks seven
    // questions; the eighth exists because escalation and productivity are
    // separate bases. A column that became nullable would let a seven-of-
    // eight basis back a forecast, which the row's own sentence forbids.
    expect(ESTIMATE_BASIS_DIMENSIONS).toHaveLength(8);
    for (const d of ESTIMATE_BASIS_DIMENSIONS) {
      expect(estimate, `${d.field} is not a NOT NULL column`).toMatch(
        new RegExp(`${d.field}\\s+(text|numeric|int)[^,]*not null`, "i"),
      );
    }
  });

  it("record_estimate_basis refuses each missing dimension BY NAME", () => {
    for (let i = 1; i <= 8; i++) {
      expect(estimate, `dimension ${i} has no named refusal`).toContain(
        `dimension ${i} of 8 is missing`,
      );
    }
  });
});

/* ───────────────────────── lineage on every calc ──────────────────────── */

describe("every calculation this slice adds records a lineage run (D11.29)", () => {
  it("the code version is pinned on both sides and cannot drift", () => {
    expect(credit).toContain(`'${PERFORMANCE_CALC_VERSION}'`);
    // The 4A keys keep the 4A version — bumping a version on unchanged code
    // makes the version stop meaning anything.
    expect(credit).toContain("'develop-controls/4A/2026-11-24'");
  });

  it("every key pinned in sync_calculation_code_version is one a compute function records", () => {
    const pinned = [
      ...credit.matchAll(/\('(case_[a-z_]+)',\s*'develop-[^']+'\)/g),
    ].map((m) => m[1]);
    expect(pinned.length).toBeGreaterThanOrEqual(7);
    for (const key of pinned) {
      expect(
        // Recorded in this slice, or in Slice 4A's own migration.
        joined.includes(`'${key}',`) ||
          read("20261130090600_develop_calculation_lineage.sql").includes(
            `'${key}',`,
          ),
        `${key} is pinned but no compute function records it`,
      ).toBe(true);
    }
  });

  it("the five 4B keys are each recorded by a record_calculation_run call", () => {
    for (const key of PERFORMANCE_CALC_KEYS) {
      const at = joined.indexOf(`record_calculation_run(`);
      expect(at).toBeGreaterThan(-1);
      expect(joined, `${key} is never recorded`).toMatch(
        new RegExp(`record_calculation_run\\([\\s\\S]{0,200}'${key}'`),
      );
    }
  });

  it("each compute function records its REFUSALS, not only its successes", () => {
    for (const [fn, source] of [
      ["compute_case_earned_value", ev],
      ["compute_case_progress_integrity", integrity],
      ["compute_case_estimate_confidence", estimate],
      ["compute_case_forecast_confidence", forecast],
      ["compute_case_performance_trend", ev],
    ] as const) {
      const at = source.indexOf(`create or replace function public.${fn}(`);
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf("\n$$;", at));
      expect(body, `${fn} records no refusals`).toContain("v_refusals");
      // A run with no output is a REFUSED run, not a computed one with blanks.
      expect(body, `${fn} never refuses outright`).toContain(
        "v_outputs := null",
      );
    }
  });

  it("the READ and the ACT are split — a stable read never writes", () => {
    for (const [fn, source] of [
      ["get_case_earned_value", ev],
      ["get_case_progress_integrity", integrity],
      ["get_case_forecast_confidence", forecast],
      ["get_case_performance_trend", ev],
      ["get_case_progress", credit],
      ["get_case_estimate_basis", estimate],
      ["get_case_performance", forecast],
    ] as const) {
      const at = source.indexOf(`create or replace function public.${fn}(`);
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf("\n$$;", at));
      expect(body, `${fn} is not declared stable`).toMatch(/\bstable\b/);
      expect(body, `${fn} writes a lineage row from a read`).not.toContain(
        "record_calculation_run(",
      );
    }
  });

  it("the trend cites the runs it read — a run whose lineage is other runs", () => {
    expect(ev).toContain("'table', 'calculation_runs'");
  });
});

/* ───────────────── the forbidden defaults, one assertion each ─────────── */

describe("an earned-value number with no basis is worse than no number", () => {
  const evBody = (() => {
    const at = ev.indexOf(
      "create or replace function public.get_case_earned_value(",
    );
    return ev.slice(at, ev.indexOf("\n$$;", at));
  })();

  it("a missing actual cost REFUSES; it is never coalesced to zero", () => {
    expect(evBody).not.toMatch(
      /coalesce\s*\(\s*(v_ac|sum\(ci\.actual\))\s*,\s*0\s*\)/i,
    );
    expect(evBody).toContain(
      "No cost line on this case carries an actual cost",
    );
    expect(evBody).toContain("infinite cost efficiency");
  });

  it("an empty claim set refuses rather than reporting nothing earned", () => {
    expect(evBody).toContain("empty claim set");
    expect(evBody).toContain(
      "indistinguishable from a project that genuinely earned nothing",
    );
  });

  it("a zero or absent planned value refuses instead of dividing", () => {
    expect(evBody).toContain("elsif v_pv = 0 then");
    expect(evBody).toContain("carries no planned percent complete");
  });

  it("a zero actual cost refuses instead of producing an infinite CPI", () => {
    expect(evBody).toContain("elsif v_ac = 0 then");
  });

  it("a zero or absent BAC refuses every ratio derived from it", () => {
    expect(evBody).toContain("elsif v_bac <= 0 then");
    expect(evBody).toContain("No cost line is recorded on this case");
  });

  it("every metric is checked for non-finiteness by explicit literal comparison", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres and every ordinary
    // comparison against NaN is false, so `x > 0` does not exclude it.
    for (const v of [
      "v_ev",
      "v_ac",
      "v_cpi",
      "v_spi",
      "v_es",
      "v_eac",
      "v_vac",
    ]) {
      expect(evBody, `${v} is not tested for NaN`).toContain(
        `${v} = 'NaN'::numeric`,
      );
      expect(evBody, `${v} is not tested for Infinity`).toContain(
        `${v} = 'Infinity'::numeric`,
      );
    }
  });

  it("earned value cannot double count an element and its own subtree", () => {
    expect(evBody).toContain("counts the same money twice");
    expect(evBody).toMatch(/with recursive subtree/);
  });

  it("a case whose cost lines are in two currencies has no total, and the refusal names them", () => {
    expect(evBody).toContain("array_length(v_currencies, 1) > 1");
    expect(evBody).toContain("array_to_string(v_currencies, ' and ')");
  });
});

describe("the EAC formula is named, and never silently swapped", () => {
  it("the formula is stated on the payload and matches the TypeScript constant", () => {
    expect(ev).toContain(`'${EAC_FORMULA}'`);
  });

  it("a missing CPI refuses rather than falling back to AC + (BAC - EV)", () => {
    const at = ev.indexOf(
      "create or replace function public.get_case_earned_value(",
    );
    const body = ev.slice(at, ev.indexOf("\n$$;", at));
    expect(body).toContain("It does not fall back to AC + (BAC - EV)");
    // The fallback must not exist as code either.
    expect(body).not.toMatch(/v_eac\s*:=\s*v_ac\s*\+/);
  });

  it("VAC refuses whenever EAC did", () => {
    const at = ev.indexOf(
      "create or replace function public.get_case_earned_value(",
    );
    const body = ev.slice(at, ev.indexOf("\n$$;", at));
    expect(body).toMatch(/if v_eac is null then\s+v_vac_refusal/);
  });
});

describe("earned schedule refuses a curve it cannot read", () => {
  const body = (() => {
    const at = ev.indexOf(
      "create or replace function public.get_case_earned_value(",
    );
    return ev.slice(at, ev.indexOf("\n$$;", at));
  })();

  it("a planned curve with holes refuses rather than interpolating across them", () => {
    expect(body).toContain("The planned curve has no value at period(s)");
    expect(body).toContain(
      "would invent the plan the project is being measured against",
    );
  });

  it("earned value beyond the end of the curve refuses rather than extrapolating", () => {
    expect(body).toContain("cannot be read beyond the end of the curve");
  });

  it("one planned point is a point, not a curve", () => {
    expect(body).toContain("elsif v_plan_count < 2 then");
  });
});

describe("a percent complete cannot be typed", () => {
  it("record_progress_claim takes a STEP, never a percent", () => {
    const at = credit.indexOf(
      "create or replace function public.record_progress_claim(",
    );
    const body = credit.slice(at, credit.indexOf("\n$$;", at));
    expect(body).toContain("step_index");
    expect(body).not.toMatch(/p_claim->>'claimed_percent'/);
    expect(body).not.toMatch(/p_claim->>'percent'/);
  });

  it("the trigger re-derives claimed_percent for EVERY writer, including service", () => {
    const at = credit.indexOf(
      "create or replace function public.enforce_progress_claim(",
    );
    const body = credit.slice(at, credit.indexOf("\n$$;", at));
    expect(body).toContain("new.claimed_percent := v_cumulative;");
    expect(body).toContain("new.step_label := v_label;");
  });

  it("a claim with no applicable rule of credit is refused, not credited", () => {
    expect(credit).toContain("no rule of credit is recorded for");
    expect(credit).toContain(
      "a percent complete claimed without an applicable rule of credit is a number chosen, not a number earned",
    );
  });

  it("a rule whose weights do not sum to 100 is refused for every writer", () => {
    const at = credit.indexOf(
      "create or replace function public.enforce_rule_of_credit(",
    );
    const body = credit.slice(at, credit.indexOf("\n$$;", at));
    expect(body).toContain("if v_sum <> 100 then");
    expect(body).toContain("v_weight = 'NaN'::numeric");
  });
});

/* ─────────────── progress integrity: absence is not confirmation ──────── */

describe("the progress integrity cross-check", () => {
  const body = (() => {
    const at = integrity.indexOf(
      "create or replace function public.get_case_progress_integrity(",
    );
    return integrity.slice(at, integrity.indexOf("\n$$;", at));
  })();

  it("an element with no observation is UNRATED, never confirmed", () => {
    expect(body).toContain("is UNRATED");
    expect(body).toContain("nothing contradicts it and nothing confirms it");
  });

  it("a case with no evidence at all has NO rating, and says why", () => {
    expect(body).toContain("absence of evidence is not confirmation");
    expect(body).toContain("rating this HIGH because nothing contradicts it");
  });

  it("the binding measure is the LOWEST source, named", () => {
    expect(body).toContain("order by o.wbs_element_id, o.observed_percent asc");
    expect(body).toContain("'bindingSource', b.evidence_source");
  });

  it("coverage travels with the rating", () => {
    expect(body).toContain("'coverage'");
    expect(body).toContain("This rating covers %s of %s claimed element(s)");
  });

  it("the divergence is absolute, so under-claiming cannot pass as conservatism", () => {
    expect(body).toContain("abs(cl.claimed_percent - b.observed_percent)");
    expect(body).toContain("as much a break between the two systems");
  });

  it("evidence is a counted pair with a positive denominator", () => {
    expect(integrity).toContain(
      "constraint evidence_total_positive check (observed_total > 0)",
    );
    expect(integrity).toContain("a division by zero wearing a percentage sign");
  });

  it("the earned-value run carries the progress confidence it rests on", () => {
    expect(ev).toContain("get_case_progress_integrity(c.id)");
    expect(ev).toContain(
      "has not been cross-checked against independent evidence",
    );
  });
});

/* ───────────────── P50/P80: nothing is manufactured ───────────────────── */

describe("a percentile with no distribution behind it is absent, not invented", () => {
  it("both p50 and p80 are hard nulls on both sides of the forecast", () => {
    expect(forecast).toContain("'p50', null");
    expect(forecast).toContain("'p80', null");
    expect(forecast).toContain("'p50Finish', null");
    expect(forecast).toContain("'p80Finish', null");
  });

  it("no arithmetic anywhere in this slice produces a percentile from a deterministic figure", () => {
    // The specific failure: `p80 := deterministic * 1.15`. Any multiplication
    // or addition assigned into a percentile variable would be it.
    expect(executable).not.toMatch(/p80[^;]*[*+][^;]*deterministic/);
    expect(executable).not.toMatch(/v_p(50|80)\s*:=/);
  });

  it("the refusal names what is missing and what would supply it", () => {
    expect(forecast).toContain("A P80 is a statement about a distribution");
    expect(forecast).toContain("Slice 4C");
    expect(forecast).toContain("activitiesWithDurationRange");
  });

  it("critical drivers are refused with the simulation, not replaced by the deterministic path", () => {
    expect(forecast).toContain("criticalDriversRefusal");
    expect(forecast).toContain(
      "float computed from single-point durations is not protection",
    );
  });

  it("the sanction comparison is refused rather than computed against an approval timestamp", () => {
    expect(forecast).toContain("againstSanctionRefusal");
    expect(forecast).toContain(
      "the day somebody signed and not the day the work was meant to end",
    );
  });

  it("the recorded bottom-up forecast is shown BESIDE the derived one, never instead", () => {
    expect(forecast).toContain("recordedForecastTotal");
    expect(forecast).toContain("would have silently chosen between them");
  });

  it("the confidence travels with the forecast, including when unrated", () => {
    expect(forecast).toContain("'estimateConfidence', v_confidence");
    expect(forecast).toContain("'progressConfidence'");
  });
});

/* ─────────────────────── estimate confidence (D5.17) ──────────────────── */

describe("the estimate confidence is derived, never declared", () => {
  it("there is no confidence column and no parameter that sets one", () => {
    const tableAt = estimate.indexOf(
      "create table if not exists public.project_estimate_basis",
    );
    const table = estimate.slice(tableAt, estimate.indexOf(");", tableAt));
    expect(table).not.toMatch(/confidence/i);
    const rpcAt = estimate.indexOf(
      "create or replace function public.record_estimate_basis(",
    );
    const rpc = estimate.slice(rpcAt, estimate.indexOf("\n$$;", rpcAt));
    expect(rpc).not.toMatch(/p_basis->>'confidence'/);
  });

  it("no basis means UNRATED, and unrated is not LOW", () => {
    expect(estimate).toContain("'band', 'unrated'");
    expect(estimate).toContain("this forecast is UNRATED — not LOW");
  });

  it("the band never rises above its class", () => {
    expect(estimate).toContain("The band never rises above its class");
    const at = estimate.indexOf(
      "create or replace function public.estimate_confidence_rating(",
    );
    const body = estimate.slice(at, estimate.indexOf("\n$$;", at));
    expect(body).not.toMatch(/v_score\s*:=\s*v_score\s*\+\s*1/);
  });

  it("the mapping is returned with the rating so a reader can disagree with it", () => {
    expect(estimate).toContain("'mapping',");
  });
});

/* ─────────────────────────── §70 walls ────────────────────────────────── */

describe("§70 — no AI or system identity sets a baseline or records a progress judgement", () => {
  it.each([
    ["record_progress_claim", credit, "cannot record a progress judgement"],
    ["record_rule_of_credit", credit, "is a progress judgement"],
    ["set_period_planned_progress", credit, "SETTING A BASELINE"],
    ["close_progress_period", credit, "progress judgement"],
    ["record_progress_evidence", integrity, "progress judgement"],
    ["record_estimate_basis", estimate, "approving a forecast''s confidence"],
  ])("%s refuses ai_admin BY NAME", (fn, source, needle) => {
    const at = (source as string).indexOf(
      `create or replace function public.${fn}(`,
    );
    expect(at, `${fn} not found`).toBeGreaterThan(-1);
    const body = (source as string).slice(
      at,
      (source as string).indexOf("\n$$;", at),
    );
    expect(body, `${fn} has no ai_admin arm`).toMatch(
      /v_role, ''\) = 'ai_admin'/,
    );
    expect(body, `${fn}'s refusal does not name why`).toContain(
      needle as string,
    );
    expect(body).toContain("§70");
  });

  it("nothing in this slice approves a forecast — there is no approve act at all", () => {
    expect(executable).not.toMatch(
      /create or replace function public\.approve_case_forecast/,
    );
    expect(executable).not.toMatch(
      /create or replace function public\.accept_case_forecast/,
    );
  });
});

/* ─────────────────── the house rules on every new table ───────────────── */

describe("every new table carries the house walls", () => {
  it.each(NEW_TABLES.map(([t]) => t))(
    "%s is org-scoped with RLS in its own migration",
    (table) => {
      const source = NEW_TABLES.find(([t]) => t === table)![1];
      expect(source).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(source).toMatch(
        new RegExp(
          `create policy ${table}_read on public\\.${table}\\s+for select to authenticated using \\(organization_id = app_current_org\\(\\)\\)`,
        ),
      );
      // No client write policy: every mutation is a definer RPC.
      expect(source).not.toMatch(
        new RegExp(
          `create policy [\\w_]+ on public\\.${table}\\s+for (all|insert|update|delete)`,
        ),
      );
    },
  );

  it.each(NEW_TABLES.map(([t]) => t))(
    "%s revokes TRUNCATE and guards it at statement level",
    (table) => {
      const source = NEW_TABLES.find(([t]) => t === table)![1];
      expect(source).toContain(
        `revoke truncate on table public.${table} from anon, authenticated, service_role;`,
      );
      expect(source).toMatch(
        new RegExp(
          `before truncate on public\\.${table}\\s+for each statement`,
        ),
      );
    },
  );

  it.each(NEW_TABLES.map(([t]) => t))(
    "%s enforces on INSERT and UPDATE, not just INSERT",
    (table) => {
      const source = NEW_TABLES.find(([t]) => t === table)![1];
      expect(source, `${table} has no insert-or-update trigger`).toMatch(
        new RegExp(`before insert or update[\\s\\S]{0,40}on public\\.${table}`),
      );
    },
  );

  it("the ledgers whose rows can be dodged by deletion cover DELETE too", () => {
    // A claim, an observation, a basis and a period each stop being awkward
    // the moment they can be removed.
    for (const [table, source] of [
      ["project_progress_claims", credit],
      ["project_progress_periods", credit],
      ["project_progress_evidence", integrity],
      ["project_estimate_basis", estimate],
    ] as const) {
      expect(source, `${table} does not guard DELETE`).toMatch(
        new RegExp(`before insert or update or delete on public\\.${table}`),
      );
    }
  });

  it("every table carries the provenance backstop — a service write is admitted AND audited", () => {
    for (const [table, source] of NEW_TABLES) {
      expect(source, `${table} has no service_role audit arm`).toContain(
        "'service (' || current_user || ')'",
      );
      expect(source, `${table} does not insert into security_events`).toContain(
        "insert into security_events",
      );
    }
  });

  it("every table stamps the organization from its case, for every writer", () => {
    for (const [table, source] of NEW_TABLES) {
      expect(
        source,
        `${table} does not bind its organization to its case`,
      ).toContain(
        "is stamped with an organization that does not own its development case",
      );
    }
  });
});

describe("every mutation is a definer RPC with a role check and an audit row", () => {
  const ACTS = [
    ["record_rule_of_credit", credit],
    ["open_progress_period", credit],
    ["set_period_planned_progress", credit],
    ["close_progress_period", credit],
    ["record_progress_claim", credit],
    ["record_estimate_basis", estimate],
    ["record_progress_evidence", integrity],
  ] as const;

  it.each(ACTS.map(([fn]) => fn))(
    "%s checks a role and writes audit_events with both states",
    (fn) => {
      const source = ACTS.find(([f]) => f === fn)![1];
      const at = source.indexOf(`create or replace function public.${fn}(`);
      const body = source.slice(at, source.indexOf("\n$$;", at));
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = public");
      expect(body).toMatch(/select role into v_role from user_profiles/);
      expect(body).toContain("insert into audit_events");
      expect(body).toContain("previous_state, new_state");
    },
  );

  it("every function this slice defines revokes EXECUTE from public and anon", () => {
    const defined = [
      ...joined.matchAll(/create or replace function public\.(\w+)\(/g),
    ].map((m) => m[1]);
    expect(defined.length).toBeGreaterThan(10);
    for (const fn of new Set(defined)) {
      expect(joined, `${fn} is not revoked from public`).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\(`),
      );
    }
  });

  it("the functions this slice withholds from service are revoked from it explicitly", () => {
    // Supabase's default privileges already grant service_role EXECUTE, and
    // revoking from public/anon does not remove an explicit role grant — so
    // the stated ACL and the enforced one would differ (the 4A lesson).
    for (const [fn, sig, source] of [
      ["record_rule_of_credit", "uuid, jsonb", credit],
      ["open_progress_period", "uuid, jsonb", credit],
      ["set_period_planned_progress", "uuid, text, text", credit],
      ["close_progress_period", "uuid, text", credit],
      ["record_progress_claim", "uuid, jsonb", credit],
      ["get_case_progress", "uuid", credit],
      ["record_estimate_basis", "uuid, jsonb", estimate],
      ["set_wbs_element_work_type", "uuid, jsonb", credit],
      ["get_case_estimate_basis", "uuid", estimate],
      ["compute_case_estimate_confidence", "uuid", estimate],
      ["record_progress_evidence", "uuid, jsonb", integrity],
      ["get_case_progress_integrity", "uuid", integrity],
      ["compute_case_progress_integrity", "uuid", integrity],
      ["get_case_earned_value", "uuid", ev],
      ["compute_case_earned_value", "uuid", ev],
      ["get_case_performance_trend", "uuid", ev],
      ["compute_case_performance_trend", "uuid", ev],
      ["get_case_forecast_confidence", "uuid", forecast],
      ["compute_case_forecast_confidence", "uuid", forecast],
      ["get_case_performance", "uuid", forecast],
    ] as const) {
      expect(
        source,
        `${fn} still leaves service_role's default grant in place`,
      ).toContain(
        `revoke all on function public.${fn}(${sig}) from public, anon, service_role;`,
      );
    }
  });

  it("the INTERNAL helpers have no EXECUTE for anyone, including authenticated", () => {
    // estimate_confidence_rating is a SECURITY DEFINER that returns the four
    // PROSE dimensions — a competitor's commercially sensitive estimate
    // defence. Its only callers are the definers in this slice that scope the
    // case to the caller's org first, so a grant to `authenticated` bought
    // nothing and opened a direct PostgREST route to every tenant's basis
    // (the 20261130090500 lesson, verbatim, one slice later).
    expect(estimate).toContain(
      "revoke all on function public.estimate_confidence_rating(uuid)\n  from public, anon, authenticated, service_role;",
    );
    expect(
      estimate,
      "estimate_confidence_rating must not be granted to any client role",
    ).not.toMatch(
      /grant execute on function public\.estimate_confidence_rating/,
    );
    // ...and belt AND braces: the BODY carries the dual-caller gate too, so a
    // future migration that re-grants it cannot re-open the hole.
    expect(estimate).toContain(
      "auth.uid() is not null and v_caller_org is null",
    );
    expect(estimate).toMatch(
      /from development_cases dc[\s\S]{0,200}dc\.organization_id = v_caller_org/,
    );
  });
});

/* ───────────────────────── no canonical store forked ──────────────────── */

describe("no canonical store is forked", () => {
  it("progress hangs off the ONE WBS — there is no second scope tree", () => {
    expect(credit).toContain(
      "wbs_element_id uuid not null references project_wbs_elements(id)",
    );
    expect(executable).not.toMatch(/create table[^;]+progress_wbs/);
  });

  it("there is no second cost store and no second actuals ledger", () => {
    // Actual cost lives on project_cost_items.actual (spec §23, Slice 4A).
    // A time-phased actuals table here would be a second cost truth, which
    // is why the suite computes at the LATEST period only.
    expect(executable).not.toMatch(/create table[^;]+period_actuals/);
    expect(executable).not.toMatch(/create table[^;]+cost_actuals/);
    expect(raw(EV_FILE)).toContain(
      "There is no time-phased actuals ledger and this slice does",
    );
  });

  it("there is no second lineage record — record_calculation_run is reused", () => {
    expect(executable).not.toMatch(/create table[^;]+calculation_runs/);
    expect(joined).toContain("record_calculation_run(");
  });

  it("no SQL in this slice runs a simulation — the modelling kernel stays the only one", () => {
    // The words "Monte Carlo" DO appear here, inside the refusal that says a
    // distribution does not exist yet and where it will come from. What must
    // not appear is sampling machinery: a second simulator in SQL would make
    // the kernel in src/lib/modelling one of two answers to the same question.
    expect(executable).not.toMatch(/\brandom\s*\(\s*\)/);
    expect(executable).not.toMatch(/\bsetseed\s*\(/);
    expect(executable).not.toMatch(/percentile_cont/);
    expect(executable).not.toMatch(/percentile_disc/);
    expect(executable).not.toMatch(/generate_series\s*\(\s*1\s*,/);
    // ...and the only mention of the kernel is the one that defers to it.
    expect(forecast).toContain(
      "the kernel itself already exists and is not duplicated here",
    );
  });

  it("the progress structure fills D5.04's eleventh hole in the ONE predicate", () => {
    // controls_structure_state is replaced, not shadowed by a second
    // predicate — the capture act, the drift report and the read all consume
    // it, and two of them computing state differently is how a baseline
    // silently stops matching what it was taken from.
    expect(credit).toContain(
      "create or replace function public.controls_structure_state(",
    );
    expect(credit).toContain(
      "v_home := 'project_rules_of_credit + project_progress_periods.planned_percent_complete';",
    );
    expect(credit).toContain(
      "revoke all on function public.controls_structure_state(uuid, text)\n  from public, anon, authenticated, service_role;",
    );
    // The 4A refusal is gone from the live predicate: progress has a home.
    const at = credit.indexOf(
      "create or replace function public.controls_structure_state(",
    );
    const body = credit.slice(at, credit.indexOf("\n$$;", at));
    expect(body).not.toContain("Progress has no home in this repository yet");
    // ...and a case with no rule of credit STILL refuses rather than
    // reporting a progress baseline of zero.
    expect(body).toContain("baselined at 0% complete");
  });

  it("the dual-caller guard keeps the auth.uid() discriminator, not current_user", () => {
    // `current_user in ('authenticated','anon')` inside a SECURITY DEFINER is
    // always false — the dead guard 20261130090700 repaired.
    const at = credit.indexOf(
      "create or replace function public.controls_structure_state(",
    );
    const body = credit.slice(at, credit.indexOf("\n$$;", at));
    expect(body).toContain("auth.uid() is not null and v_caller_org is null");
    expect(body).not.toMatch(
      /v_caller_org is null and current_user in \('authenticated', 'anon'\)/,
    );
  });
});

/* ──────────────────────── the rulings are written down ────────────────── */

describe("the spec ambiguities this slice resolved are recorded in the migrations", () => {
  it("names the eighth estimate dimension ruling", () => {
    expect(raw(ESTIMATE_FILE)).toContain(
      "AMBIGUITY RESOLVED: WHERE THE EIGHTH DIMENSION COMES FROM",
    );
  });

  it("names the EAC formula ruling and the two formulas it does not use", () => {
    expect(raw(EV_FILE)).toContain("WHICH EAC FORMULA, AND WHY IT IS NAMED");
    expect(raw(EV_FILE)).toContain("EAC = AC + (BAC - EV)");
  });

  it("names the ruling on what a progress BASELINE fixes", () => {
    expect(raw(CREDIT_FILE)).toContain(
      'RULING 1 — WHAT "PROGRESS" MEANS AS A BASELINED STRUCTURE',
    );
  });

  it("names the one-claim-per-period and credit-may-go-backwards rulings", () => {
    expect(raw(CREDIT_FILE)).toContain(
      "RULING 2 — ONE CLAIM PER ELEMENT PER PERIOD",
    );
    expect(raw(CREDIT_FILE)).toContain("RULING 3 — CREDIT MAY GO BACKWARDS");
  });

  it("names the ruling on what counts as independent evidence", () => {
    expect(raw(INTEGRITY_FILE)).toContain(
      "AMBIGUITY RESOLVED: WHAT COUNTS AS INDEPENDENT",
    );
  });

  it("names the data-date ruling that keeps the suite at the latest period", () => {
    expect(raw(EV_FILE)).toContain(
      "THE DATA DATE: WHY THE SUITE ONLY COMPUTES AT THE LATEST PERIOD",
    );
  });

  it("the header of every file in this slice states its rows", () => {
    expect(rawJoined).toContain("D5.06");
    expect(rawJoined).toContain("D5.05");
    expect(rawJoined).toContain("D5.16");
    expect(rawJoined).toContain("D5.17");
    expect(rawJoined).toContain("D5.20");
    expect(rawJoined).toContain("D5.07");
    expect(rawJoined).toContain("D5.32");
    expect(rawJoined).toContain("D11.29");
  });
});

/* ─────────── the repairs the adversarial pass forced, pinned ──────────── */

describe("earned value is cumulative to the data date, not this period's inbox", () => {
  it("sums the latest position PER ELEMENT at or before the period end", () => {
    // Summing only the latest period's claim rows dropped every element that
    // did not move that period out of the total, manufacturing a five-fold
    // EAC error out of ordinary reporting practice ("claim what moved").
    expect(raw(EV_FILE)).toMatch(
      /select distinct on \(cl\.wbs_element_id\)[\s\S]{0,400}pp\.period_end <= p\.period_end[\s\S]{0,200}order by cl\.wbs_element_id, pp\.period_end desc/,
    );
    expect(raw(EV_FILE)).toContain("EARNED VALUE IS CUMULATIVE TO DATE");
    // ...and the carry-forward is said out loud rather than being invisible.
    expect(raw(EV_FILE)).toContain("carried forward at the percent they were");
    expect(raw(EV_FILE)).toContain("'carriedForwardCount', v_carried_forward");
  });

  it("no aggregate in the read is still keyed on the latest period's rows", () => {
    // The four places that used `cl.period_id = p.id` all resolve through the
    // cumulative position set now; a survivor would silently re-open the bug
    // for one metric while the others were correct.
    expect(raw(EV_FILE)).not.toMatch(
      /from project_progress_claims cl where cl\.period_id = p\.id/,
    );
  });

  it("the cross-check rates the same population the money was computed on", () => {
    expect(raw(INTEGRITY_FILE)).toContain(
      "THE SAME POPULATION EARNED VALUE MEASURED",
    );
    expect(raw(INTEGRITY_FILE)).toMatch(
      /select distinct on \(cl\.wbs_element_id\)[\s\S]{0,500}order by cl\.wbs_element_id, pp\.period_end desc/,
    );
  });
});

describe("a number computed on nothing refuses rather than printing zero", () => {
  it("refuses EV when every claimed element carries no baselined cost", () => {
    // CPI 0.000 is the most alarming statement earned value can make; here it
    // was arithmetic performed on nothing and indistinguishable on screen
    // from a real collapse. The mirror image of "CPI 1.0 over an empty set".
    expect(raw(EV_FILE)).toContain("elsif v_zero_bac_elements = v_claim_count");
    expect(raw(EV_FILE)).toContain(
      "the scope being claimed is not in the budget at completion",
    );
    expect(raw(EV_FILE)).toContain("rather than as a coding gap");
  });

  it("refuses earned schedule BELOW the first planned point, as it does above the last", () => {
    expect(raw(EV_FILE)).toContain(
      "cannot be read below the start of the curve",
    );
    expect(raw(EV_FILE)).toContain("a planned point nobody recorded");
    // The old shape divided by the first planned point, reading the value off
    // an assumed origin at (period 0, 0%).
    expect(raw(EV_FILE)).not.toContain("v_es := v_ev_percent / v_plan_first;");
  });
});

describe("staleness can see a changed amount and a changed definition", () => {
  it("puts a digest over the AMOUNTS into the earned-value fingerprint", () => {
    // baseline_cost and actual are revised IN PLACE and actual is a running
    // total by design, so a fingerprint of counts left a three-times-wrong
    // EAC captioned as freshly computed.
    expect(raw(EV_FILE)).toContain("THE STALENESS DIGEST: AMOUNTS, NOT COUNTS");
    expect(raw(EV_FILE)).toMatch(
      /ci\.cost_item_ref \|\| '~' \|\| coalesce\(ci\.baseline_cost::text/,
    );
    expect(raw(EV_FILE)).toContain("'basisDigest', v_ev->'basisDigest'");
  });

  it("gives progress integrity ONE definition of evidenceCount, from the read", () => {
    expect(raw(INTEGRITY_FILE)).toContain(
      "ONE DEFINITION OF evidenceCount, RETURNED BY THE READ",
    );
    expect(raw(INTEGRITY_FILE)).toContain(
      "'evidenceCount', v_report->'evidenceCount'",
    );
    expect(raw(INTEGRITY_FILE)).not.toMatch(
      /'evidenceCount', \(select count\(\*\) from project_progress_evidence/,
    );
  });
});

describe("a recorded history that can be rewritten is not history", () => {
  it("attributes a run to a period only if it was recorded before the close", () => {
    expect(raw(EV_FILE)).toContain(
      "(pp.closed_at is null or r.computed_at <= pp.closed_at)",
    );
    expect(raw(EV_FILE)).toContain("THE closed_at PREDICATE IS NOT DECORATION");
    // ...and computing at a closed period says what it is.
    expect(raw(EV_FILE)).toContain(
      "so the claimed positions behind this earned value are frozen",
    );
  });

  it("takes the direction from the LAST interval and names the periods it spans", () => {
    expect(raw(EV_FILE)).toContain(
      "A DIRECTION IS THE DIRECTION OF THE LAST INTERVAL, AND IT SAYS SO",
    );
    expect(raw(EV_FILE)).toContain("'costTrendInterval'");
    expect(raw(EV_FILE)).toContain("'costTrendVolatility', v_cpi_volatile");
    // An absent direction is refused by name, not dropped from the sentence.
    expect(raw(EV_FILE)).toContain("No cost performance direction:");
    // And a refused run is not counted as a measured point.
    expect(raw(EV_FILE)).toContain("'refusedPointCount', v_refused_points");
  });

  it("keeps a rule of credit immutable once claims cite it, for every writer", () => {
    expect(raw(CREDIT_FILE)).toContain(
      "IMMUTABLE ONCE CLAIMED, FOR EVERY WRITER",
    );
    expect(raw(CREDIT_FILE)).toContain(
      "impossible to reconstruct from the convention it names",
    );
    expect(raw(CREDIT_FILE)).toContain(
      "before insert or update or delete on public.project_rules_of_credit",
    );
    expect(raw(CREDIT_FILE)).toContain("a rule of credit is not deletable");
  });
});

describe("the claimant cannot pick the convention, and so cannot pick the percent", () => {
  it("records the work type on the ELEMENT and resolves the rule from it", () => {
    expect(raw(CREDIT_FILE)).toContain(
      "THE WORK TYPE LIVES ON THE ELEMENT, NOT IN THE CLAIM",
    );
    expect(raw(CREDIT_FILE)).toContain(
      "alter table public.project_wbs_elements\n  add column if not exists work_type text;",
    );
    // Enforced in the TRIGGER, not only in the RPC — otherwise the derivation
    // is honest and its input is a free parameter.
    expect(raw(CREDIT_FILE)).toContain(
      "THE RULE IS RESOLVED FROM THE ELEMENT, FOR EVERY WRITER",
    );
    expect(raw(CREDIT_FILE)).toContain("if r.applies_to <> w.work_type then");
    expect(raw(CREDIT_FILE)).toContain("carries no recorded work type");
  });

  it("walls the work-type act under §70 and freezes it once claimed", () => {
    expect(raw(CREDIT_FILE)).toContain(
      "create or replace function public.set_wbs_element_work_type(",
    );
    expect(raw(CREDIT_FILE)).toMatch(
      /set_wbs_element_work_type[\s\S]{0,3000}progress judgement one level up[\s\S]{0,200}spec §70/,
    );
    expect(raw(CREDIT_FILE)).toContain(
      "make the percents they hold impossible to reconstruct",
    );
  });
});

describe("§70 covers both ends of the reporting period", () => {
  it("refuses the AI identity the OPEN act as well as the CLOSE act", () => {
    // Closing fixes the position; opening the next period moves the data date
    // every metric is computed at, which un-fixes it. An identity walled out
    // of one and not the other can erase a position a human recorded.
    expect(raw(CREDIT_FILE)).toMatch(
      /create or replace function public\.open_progress_period\([\s\S]{0,2500}moves the data date every earned-value figure[\s\S]{0,300}spec §70/,
    );
    expect(raw(CREDIT_FILE)).toContain(
      "OPENING AND CLOSING A PERIOD ARE THE SAME AUTHORITY",
    );
  });

  it("org-checks the actor columns the RLS-bypassing reads dereference", () => {
    for (const [file, needle] of [
      [CREDIT_FILE, "names an author who does not belong to the organization"],
      [CREDIT_FILE, "names a claimant who does not belong to the organization"],
      [CREDIT_FILE, "names an actor who does not belong to the organization"],
      [
        INTEGRITY_FILE,
        "names an observer who does not belong to the organization",
      ],
      [
        ESTIMATE_FILE,
        "names a preparer who does not belong to the organization",
      ],
    ] as const) {
      expect(raw(file)).toContain(needle);
    }
  });
});

describe("a confidence band never travels without its coverage", () => {
  it("records the coverage on the earned-value run and refuses below full", () => {
    expect(raw(EV_FILE)).toContain(
      "COVERAGE TRAVELS WITH THE BAND, EVERYWHERE",
    );
    expect(raw(EV_FILE)).toContain("'progressConfidenceCoverage'");
    expect(raw(EV_FILE)).toContain(
      "A confidence band quoted without its coverage",
    );
  });

  it("records the estimate-confidence DRIVERS as outputs, not as refusals", () => {
    // Recording them as refusals made status='computed' unreachable, so the
    // run's own refusal signal stopped discriminating a partial answer from a
    // whole one — the mirror image of recording only successes.
    expect(raw(ESTIMATE_FILE)).toContain(
      "THE DRIVERS ARE AN OUTPUT, NOT A REFUSAL",
    );
    expect(raw(ESTIMATE_FILE)).not.toContain(
      "v_refusals := v_refusals || (v_rating->'drivers');",
    );
    expect(raw(ESTIMATE_FILE)).toContain(
      "'drivers', coalesce(v_rating->'drivers', '[]'::jsonb)",
    );
  });
});

describe("the eleventh structure fixes both halves or neither", () => {
  it("refuses a progress baseline with a convention and no planned curve", () => {
    expect(raw(CREDIT_FILE)).toContain("BOTH HALVES, OR NEITHER");
    expect(raw(CREDIT_FILE)).toContain("no planned curve to baseline");
    // ...and the count is one kind of thing, with the breakdown beside it.
    expect(raw(CREDIT_FILE)).toContain("v_count := v_rule_count;");
    expect(raw(CREDIT_FILE)).toContain("'componentCounts'");
  });
});

describe("every metric refusal is recorded under the metric's own name", () => {
  it("labels the recorded refusals so the surface can find them", () => {
    expect(raw(EV_FILE)).toContain(
      "EVERY METRIC REFUSAL IS RECORDED UNDER THE NAME OF THE METRIC",
    );
    expect(raw(EV_FILE)).toMatch(
      /v_refusals \|\| to_jsonb\(format\('%s: %s',\s*\n?\s*v_m->v_key->>'label'/,
    );
  });
});
