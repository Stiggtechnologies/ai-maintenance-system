/**
 * Sync Develop Slice 4D — migration contract (static, no database).
 *
 * The live behaviour is proven by scripts/ci-develop-slice4d-smoke.sh against
 * a real local database (a fund refused before it exists, a NaN drawdown
 * refused before any balance arithmetic sees it, an undelegated approver
 * refused rather than waved through, a change refused for a missing competence
 * sign-off at the door AND beneath it, a decision latency refused on an empty
 * register, and two screens that read the lineage ledger without writing to
 * it).
 *
 * This file pins the CONTRACT in the migration text so a later edit that
 * widens a ceiling, lets a null delegation read as unlimited, admits a service
 * caller to a money field, invents a probability, drops a §70 wall or lets a
 * screen recompute a figure fails before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  CHANGE_CALC_KEYS,
  CHANGE_CALC_VERSION,
  CONTINGENCY_CAUSE_CLASSES,
  CONTROL_DIMENSIONS,
  DECISION_LATENCY_POLICY,
} from "../lib/develop/change";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const LEDGER_FILE = "20261203090000_develop_contingency_ledger.sql";
const AUTHORITY_FILE = "20261203090400_develop_authority_ceiling.sql";
const CHANGE_FILE = "20261203090100_develop_change_control.sql";
const DECISION_FILE = "20261203090200_develop_decision_latency.sql";
const SCREEN_FILE = "20261203090300_develop_assurance_and_screens.sql";
const SLICE_FILES = [
  LEDGER_FILE,
  CHANGE_FILE,
  DECISION_FILE,
  SCREEN_FILE,
  AUTHORITY_FILE,
];

const ledger = read(LEDGER_FILE);
const change = read(CHANGE_FILE);
const decision = read(DECISION_FILE);
const screens = read(SCREEN_FILE);
const authority = read(AUTHORITY_FILE);
const joined = [ledger, change, decision, screens, authority].join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");

/**
 * The executable text with `comment on … is '…'` payloads removed — those are
 * DOCUMENTATION that happens to live in a string literal, so a check like
 * "does anything here recompute a balance" reads its own disclaimer as a hit.
 * (The 4A/4B/4C precedent, kept.)
 */
const executable = joined.replace(/comment on [\s\S]*?';/g, " ").toLowerCase();

function body(source: string, fn: string): string {
  // The LAST definition, never the first: draw_down_contingency is re-issued
  // by the change migration to add its second linked cause, and pinning the
  // earlier body would assert a contract nothing enforces any more.
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("\n$$;", at));
}

/* ────────────────── the migrations land after 4C, in order ────────────── */

describe("the slice lands strictly after Slice 4C", () => {
  it("every 4D filename sorts after 20261202090300", () => {
    for (const f of SLICE_FILES) {
      expect(f > "20261202090300_develop_slice4c_repair.sql").toBe(true);
    }
    // ...and among themselves, in the order they depend on each other: the
    // ledger exists before the change store that cites it, and both exist
    // before the screens that compose them.
    expect(LEDGER_FILE < CHANGE_FILE).toBe(true);
    expect(CHANGE_FILE < DECISION_FILE).toBe(true);
    expect(DECISION_FILE < SCREEN_FILE).toBe(true);
  });
});

/* ───────────────── D5.18 — the ledger, and what it refuses ────────────── */

describe("the contingency ledger is a ledger", () => {
  it("is append-only to clients and TRUNCATE-proof at statement level", () => {
    // A row trigger never fires for TRUNCATE (20261121090000's lesson), so the
    // statement trigger and the revoke are both required and both asserted.
    expect(ledger).toMatch(
      /create trigger trg_contingency_entry_immutable\s+before update or delete on public\.contingency_ledger_entries/,
    );
    expect(ledger).toMatch(
      /create trigger trg_contingency_entry_no_truncate\s+before truncate on public\.contingency_ledger_entries\s+for each statement/,
    );
    expect(ledger).toMatch(
      /revoke truncate on table public\.contingency_ledger_entries from anon, authenticated, service_role;/,
    );
    expect(ledger).toMatch(
      /revoke truncate on table public\.project_contingency_pools from anon, authenticated, service_role;/,
    );
  });

  it("has NO client write policy — every mutation is a definer RPC", () => {
    for (const t of [
      "contingency_ledger_entries",
      "project_contingency_pools",
    ]) {
      expect(ledger).toContain(
        `alter table public.${t} enable row level security`,
      );
      const policies = ledger.match(
        new RegExp(`create policy [a-z_]+ on public\\.${t}[\\s\\S]*?;`, "g"),
      );
      expect(policies).not.toBeNull();
      for (const p of policies ?? []) {
        expect(p).toMatch(/for select/);
      }
    }
  });

  it("refuses the MONEY fields to EVERY caller, service paths included", () => {
    // The 4C repair's lesson: admitting-and-auditing a service write is right
    // for a record whose worst case is a wrong label, and wrong for the field
    // the whole feature rests on. An audited theft is still a theft.
    const t = body(ledger, "enforce_contingency_entry_immutable");
    expect(t).toMatch(/new\.amount is distinct from old\.amount/);
    expect(t).toMatch(/new\.balance_after is distinct from old\.balance_after/);
    expect(t).toMatch(/new\.approver_id is distinct from old\.approver_id/);
    expect(t).toMatch(/cannot be rewritten by ANY caller/);
    // ...and the refusal is raised OUTSIDE the `if not v_client` branch, so it
    // is not something a service caller walks past.
    const refusalAt = t.indexOf("cannot be rewritten by ANY caller");
    const serviceBranchAt = t.indexOf("if not v_client then");
    expect(refusalAt).toBeLessThan(serviceBranchAt);

    const p = body(ledger, "enforce_contingency_pool_wall");
    expect(p).toMatch(
      /new\.original_amount is distinct from old\.original_amount/,
    );
    expect(p).toMatch(/cannot be rewritten by ANY caller/);
  });

  it("cannot go negative, at the column as well as in the door", () => {
    expect(ledger).toMatch(
      /constraint contingency_entry_balance_nonnegative check \(\s*balance_after >= 0/,
    );
    const d = body(joined, "draw_down_contingency");
    expect(d).toMatch(/v_amount > v_remaining/);
    expect(d).toMatch(/cannot go negative/);
  });

  it("refuses non-finite and non-positive amounts at every door", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres and NaN passes every
    // inequality vacuously, so `amount > 0` alone does not keep it out.
    expect(ledger).toMatch(/amount <> 'NaN'::numeric/);
    expect(ledger).toMatch(/amount <> 'Infinity'::numeric/);
    expect(ledger).toMatch(/amount <> '-Infinity'::numeric/);
    const parser = body(ledger, "sync_finite_money");
    expect(parser).toMatch(/if v = 'NaN'::numeric then return null/);
    expect(parser).toMatch(/'Infinity'::numeric or v = '-Infinity'::numeric/);
    const d = body(joined, "draw_down_contingency");
    // The finiteness check happens BEFORE the balance comparison, so a NaN
    // never reaches the arithmetic it would poison.
    expect(d.indexOf("must be a finite number")).toBeLessThan(
      d.indexOf("exceeds what remains"),
    );
  });

  it("routes every drawdown through the ONE authority store", () => {
    // No second authority table, and the action_type is added to the existing
    // check rather than twinned (overlap-map ruling 14).
    expect(ledger).toMatch(
      /add constraint authority_limits_action_type_check[\s\S]*?'contingency_drawdown'/,
    );
    expect(executable).not.toMatch(/create table[^;]*contingency_authorit/);
    const a = body(ledger, "sync_contingency_authority");
    expect(a).toMatch(/action_type = 'contingency_drawdown'/);
    expect(a).toMatch(/status = 'adopted'/);
    // The org-node scope rule, repeated verbatim from 20261121090100 §3.
    expect(a).toMatch(/org_ancestry\(p_org\)/);
    expect(a).toMatch(
      /order by \(al\.org_node_id is not null\) desc, anc\.depth asc nulls last, al\.version desc/,
    );
  });

  it("REFUSES when no delegation is adopted — absence is not permission", () => {
    const a = body(ledger, "sync_contingency_authority");
    expect(a).toMatch(/no adopted contingency-drawdown delegation exists/);
    expect(a).toMatch(/is not permission to spend/);
    // The enforce_authority_limit posture ("return new" when nothing is
    // adopted) must NOT appear here.
    expect(a).not.toMatch(/'permitted', true[\s\S]*?not found/);
  });

  it("REFUSES a null ceiling — unstated is not unlimited", () => {
    const a = body(ledger, "sync_contingency_authority");
    expect(a).toMatch(
      /if l\.max_commitment_usd is null then[\s\S]*?'permitted', false/,
    );
    expect(a).toMatch(/states no money ceiling/);
    expect(a).toMatch(/not an unlimited one/);
  });

  it("names the ceiling and the escalation when it refuses above it", () => {
    const a = body(ledger, "sync_contingency_authority");
    expect(a).toMatch(
      /exceeds the %s contingency ceiling of \$%s for %s\. Escalate to %s/,
    );
  });

  it("records the ceiling ON THE ROW, so raising it later rewrites nothing", () => {
    expect(ledger).toMatch(/approver_ceiling_usd numeric,/);
    const d = body(joined, "draw_down_contingency");
    expect(d).toMatch(
      /approver_ceiling_usd[\s\S]*?\(v_auth->>'ceiling'\)::numeric/,
    );
  });

  it("§70: no AI or system identity may draw down contingency", () => {
    // In the door AND on the row (the 4C repair's R7a): a service caller
    // writing the ledger directly cannot mint an AI-approved spend either.
    for (const fn of [
      "draw_down_contingency",
      "release_contingency",
      "establish_contingency_pool",
      "compute_case_contingency_consumption",
    ]) {
      expect(body(joined, fn)).toMatch(/ai_admin/);
    }
    const prov = body(ledger, "enforce_contingency_entry_provenance");
    expect(prov).toMatch(/v_approver_role = 'ai_admin'/);
    expect(prov).toMatch(
      /spec §70 forbids an AI or system identity from doing it/,
    );
    expect(ledger).toMatch(
      /create trigger trg_contingency_entry_provenance\s+before insert or update/,
    );
  });

  it("the money acts are revoked from service_role, not only from anon", () => {
    for (const sig of [
      "establish_contingency_pool(uuid, jsonb)",
      "draw_down_contingency(uuid, jsonb)",
      "release_contingency(uuid, jsonb)",
    ]) {
      expect(joined).toContain(
        `revoke all on function public.${sig} from public, anon, service_role;`,
      );
    }
  });

  it("uses auth.uid() for the dual-caller gate, never a dead current_user test", () => {
    // 20261130090700 repaired thirteen `current_user in ('authenticated','anon')`
    // tests that could never fire inside a definer, where current_user is the
    // function owner.
    expect(joined).not.toMatch(
      /v_client\s+boolean\s*:=[^;]*current_user\s+(not\s+)?in\s*\(\s*'authenticated'/,
    );
    for (const fn of [
      "enforce_contingency_entry_immutable",
      "enforce_contingency_pool_wall",
      "enforce_decision_exposure_immutable",
    ]) {
      expect(body(joined, fn)).toMatch(
        /v_client boolean := auth\.uid\(\) is not null/,
      );
    }
  });
});

/* ──────────── D5.19 — attribution, and the bucket nobody hides ────────── */

describe("consumption is attributed by cause", () => {
  it("uses the spec's OWN taxonomy and no parallel one", () => {
    for (const c of CONTINGENCY_CAUSE_CLASSES) {
      expect(ledger).toContain(`'${c.key}'`);
    }
    expect(CONTINGENCY_CAUSE_CLASSES).toHaveLength(7);
  });

  it("links the two linked classes to the CANONICAL stores", () => {
    // A risk cites `risks`; a change cites `project_changes`. No parallel risk
    // or change store is created by this slice.
    expect(ledger).toMatch(/cause_risk_id uuid references risks\(id\)/);
    expect(change).toMatch(
      /add column if not exists cause_change_id uuid references project_changes\(id\)/,
    );
    expect(ledger).toMatch(
      /constraint contingency_entry_linked_cause check \(\s*cause_class is distinct from 'realized_risk' or cause_risk_id is not null\)/,
    );
    expect(change).toMatch(
      /cause_class is distinct from 'approved_change' or cause_change_id is not null/,
    );
  });

  it("refuses `unattributed` at the door while keeping it in the report", () => {
    const d = body(joined, "draw_down_contingency");
    expect(d).toMatch(/cannot be recorded as unattributed/);
    expect(d).toMatch(/not a class you may choose/);
    // ...and the read emits all seven classes from a VALUES list, so an empty
    // bucket is reported rather than dropped by a GROUP BY.
    const r = body(ledger, "get_case_contingency");
    expect(r).toMatch(/\('unattributed',\s*'Unattributed'/);
    expect(r).toMatch(/left join \(/);
  });

  it("keeps PRIOR pools in the total after a re-baseline", () => {
    const r = body(ledger, "get_case_contingency");
    // No filter on the current baseline: every pool this case has held is
    // summed, and the current one is FLAGGED rather than the others dropped.
    expect(r).toMatch(/is_current/);
    expect(r).toMatch(/where p\.development_case_id = c\.id/);
    const c = body(ledger, "compute_case_contingency_consumption");
    expect(c).toMatch(
      /prior contingency pool\(s\) from superseded cost baselines/,
    );
  });

  it("cross-checks the §23 line contingency instead of picking a side", () => {
    const r = body(ledger, "get_case_contingency");
    expect(r).toMatch(/project_cost_items/);
    expect(r).toMatch(/neither is corrected here/);
  });
});

/* ─────────────── D5.27 / D5.30 — the change object and Workflow 3 ─────── */

describe("change control rides the EXISTING MOC engine", () => {
  it("takes its class vocabulary from engineering_approval_rules", () => {
    expect(change).toMatch(
      /insert into engineering_approval_rules \(organization_id, change_class, title, required_role, basis\)/,
    );
    // No second class table.
    expect(executable).not.toMatch(/create table[^;]*change_class_rules/);
    const t = body(change, "enforce_project_change_governance");
    expect(t).toMatch(/from engineering_approval_rules/);
    expect(t).toMatch(/has no engineering approval rule in this organization/);
  });

  it("cannot be approved without the MOC competence sign-off", () => {
    const t = body(change, "enforce_project_change_governance");
    expect(t).toMatch(
      /if new\.status = 'approved' and new\.competence_signed_at is null then[\s\S]*?raise exception/,
    );
    // ...and the signer must hold the required role.
    expect(t).toMatch(/up\.role = e\.required_role or up\.role = 'admin'/);
    // The trigger covers INSERT and UPDATE and DELETE, so a service write
    // cannot walk past a door-only check.
    expect(change).toMatch(
      /create trigger trg_project_change_governance\s+before insert or update or delete/,
    );
  });

  it("is anchored to a baseline of its own case, and never to a draft", () => {
    const t = body(change, "enforce_project_change_governance");
    expect(t).toMatch(/development_case_id = new\.development_case_id/);
    expect(t).toMatch(/if b\.status = 'draft' then/);
    expect(change).toMatch(
      /baseline_id uuid not null references development_baselines\(id\) on delete restrict/,
    );
  });

  it("enforces §42 requester != approver on the row, not only at the door", () => {
    const t = body(change, "enforce_project_change_governance");
    expect(t).toMatch(/new\.approver_id = new\.requester_id/);
    expect(t).toMatch(/segregation of duties/);
    expect(body(change, "decide_project_change")).toMatch(
      /you raised this change/,
    );
  });

  it("§70: no AI identity may approve a change, or write the vector it routes on", () => {
    const t = body(change, "enforce_project_change_governance");
    expect(t).toMatch(/v_approver_role = 'ai_admin'/);
    for (const fn of [
      "decide_project_change",
      "assess_project_change",
      "propagate_project_change",
      "close_change_propagation",
      "implement_project_change",
      "sign_project_change_engineering",
    ]) {
      expect(body(change, fn)).toMatch(/ai_admin/);
    }
    // ...and raising one is explicitly ALLOWED for the AI: proposing is not
    // deciding (the 20261105090300 discipline).
    expect(body(change, "raise_project_change")).toMatch(
      /'admin','ai_admin','executive'/,
    );
  });

  it("routes approval through the ONE authority store on BOTH dimensions", () => {
    expect(change).toMatch(
      /add constraint authority_limits_action_type_check[\s\S]*?'change_approval'/,
    );
    const a = body(change, "sync_change_authority");
    expect(a).toMatch(/action_type = 'change_approval'/);
    expect(a).toMatch(/max_commitment_usd is null[\s\S]*?'permitted', false/);
    expect(a).toMatch(/no adopted change-approval delegation exists/);
    // §43's AuthorityRule is action_type + maximum_value + maximum_risk, and
    // reading only the money half lets a Critical change through on a small
    // cost effect.
    expect(a).toMatch(
      /risk_rank\(p_risk_effect\) > risk_rank\(l\.max_risk_level\)/,
    );
  });

  it("requires a COMPLETE impact vector before anything can be decided", () => {
    expect(change).toMatch(
      /constraint project_change_assessment_complete check \([\s\S]*?cost_effect is not null[\s\S]*?schedule_effect_days is not null[\s\S]*?risk_effect is not null/,
    );
    const d = body(change, "decide_project_change");
    expect(d).toMatch(/has not been assessed/);
    const a = body(change, "assess_project_change");
    expect(a).toMatch(/an unstated cost routes to nobody/);
  });

  it("never claims to have propagated into a system it does not own", () => {
    const p = body(change, "propagate_project_change");
    // Only sync_owned hops are applied automatically.
    expect(p).toMatch(/status = 'pending' and sync_owned/);
    // The contingency hop closes on the LEDGER ENTRY, not on an assertion.
    expect(p).toMatch(
      /from contingency_ledger_entries e\s+where e\.cause_change_id/,
    );
    expect(p).toMatch(/cannot draw the money/i);
    // The scope hop goes through 20261130090400's own §70 marker, so the
    // approved-change wall sees a governed act rather than a raw update.
    expect(p).toMatch(
      /set_config\('app\.scope_change_write', 'granted', true\)/,
    );
    // ...and a human cannot hand-assert a Sync-owned hop.
    expect(body(change, "close_change_propagation")).toMatch(
      /closed by the record that proves it/,
    );
  });

  it("cannot be implemented while an obligation it created is open", () => {
    const i = body(change, "implement_project_change");
    expect(i).toMatch(/status = 'pending'/);
    expect(i).toMatch(/propagation obligation\(s\) outstanding/);
  });

  it("a change is never deleted, and the table is TRUNCATE-guarded", () => {
    const t = body(change, "enforce_project_change_governance");
    expect(t).toMatch(/a project change is not deleted/);
    expect(change).toMatch(
      /create trigger trg_project_change_no_truncate\s+before truncate on public\.project_changes\s+for each statement/,
    );
    expect(change).toMatch(
      /revoke truncate on table public\.project_changes from anon, authenticated, service_role;/,
    );
    expect(change).toMatch(
      /revoke truncate on table public\.project_change_propagation from anon, authenticated, service_role;/,
    );
  });
});

/* ───────── D3.12 / D3.13 / D3.21 / D3.36 — latency, exposure, debt ────── */

describe("decision latency refuses rather than reporting a comfortable zero", () => {
  it("refuses outright on an empty decision register", () => {
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(/this is a refusal, not a score of zero/i);
    const c = body(decision, "compute_case_decision_latency");
    // No outputs on an empty register: a refused run, not a zero.
    expect(c).toMatch(
      /if \(v_read->>'decisionCount'\)::int = 0 then\s*v_outputs := null;/,
    );
  });

  it("EXCLUDES and NAMES a decision whose closing instant is unknowable", () => {
    // `decisions` carries no timestamp for approval anywhere in the schema, so
    // a decision approved without a selection cannot state when it closed.
    // Dating it today would make every historical latency a measurement of
    // when the migration ran.
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(/closed_without_instant/);
    expect(r).toMatch(
      /the instant it closed is unknown and its latency is unmeasurable/,
    );
    expect(r).toMatch(/rather than dated today or left counting as open/);
  });

  it("EXCLUDES and NAMES a decision with no required date", () => {
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(/nothing to measure latency FROM/);
    expect(r).toMatch(/rather than counted as on time/);
  });

  it("keeps an EARLY decision negative instead of flooring it at zero", () => {
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(
      /NEGATIVE IS EARLY AND IS KEPT AS A NEGATIVE|negative is early/i,
    );
    expect(r).not.toMatch(/greatest\(0,\s*extract/);
  });

  it("withholds the AVERAGE below the published floor of closed decisions", () => {
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(/\(v_policy->>'averageFloor'\)::int/);
    expect(r).toMatch(/a number pretending to be a statistic/);
    expect(decision).toMatch(
      new RegExp(`'averageFloor',\\s*${DECISION_LATENCY_POLICY.averageFloor}`),
    );
  });

  it("reads criticality from P6's imported float and NEVER recomputes a network", () => {
    // Slice 4C settled this: a second critical-path implementation beside the
    // modelling kernel's is two answers to one question.
    expect(decision).toMatch(
      /'criticalFloatHours', \(sync_schedule_quality_policy\(\)->>'criticalFloatHours'\)::numeric/,
    );
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(/t\.total_float_hours <= v_crit/);
    expect(r).toMatch(/does not recompute the network/);
    // No forward/backward pass, no longest-path walk, anywhere in the slice.
    expect(executable).not.toMatch(
      /early_start|late_finish|longest path|recursive .*predecessor/,
    );
  });

  it("refuses critical-path exposure when nothing carries a float", () => {
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(/if v_activities = 0 then/);
    expect(r).toMatch(/elsif v_with_float = 0 then/);
    expect(r).toMatch(
      /'criticalPathExposureDays', case when v_cp_refusal is null then v_cp_days end/,
    );
    // ...and a MEASURED zero is stated as a measurement, which is a different
    // sentence from an absence.
    expect(r).toMatch(/That is a measured zero/);
  });
});

describe("decision debt is stated, never derived", () => {
  it("takes BOTH factors from a stated exposure record with a basis", () => {
    expect(decision).toMatch(/expected_impact numeric not null/);
    expect(decision).toMatch(/probability_of_delay numeric not null/);
    expect(decision).toMatch(
      /basis text not null check \(length\(btrim\(basis\)\) >= 20\)/,
    );
    // Explicitly NOT decisions.decision_value, which is the value at stake IN
    // the decision — a different quantity that would silently double as this
    // one.
    const g = body(decision, "get_case_decision_debt");
    expect(g).toMatch(/l\.expected_impact \* l\.probability_of_delay/);
    expect(g).not.toMatch(/decision_value \* /);
  });

  it("refuses a probability outside [0,1] rather than clamping it", () => {
    expect(decision).toMatch(
      /constraint decision_exposure_probability check \(\s*probability_of_delay >= 0 and probability_of_delay <= 1/,
    );
    const a = body(decision, "record_decision_delay_exposure");
    expect(a).toMatch(/refused rather than clamped/);
    expect(a).not.toMatch(/least\(1[\s\S]*?greatest\(0/);
    expect(decision).toMatch(/probability_of_delay <> 'NaN'::numeric/);
  });

  it("refuses on an empty set, on nothing quantified, and on mixed currencies", () => {
    const g = body(decision, "get_case_decision_debt");
    expect(g).toMatch(/if v_open = 0 then/);
    expect(g).toMatch(/elsif v_quantified = 0 then/);
    expect(g).toMatch(/elsif v_currencies > 1 then/);
    expect(g).toMatch(/They are NOT summed/);
    expect(g).toMatch(/a refusal rather than a figure of zero/);
    const c = body(decision, "compute_case_decision_debt");
    expect(c).toMatch(
      /if v_read->>'totalDebt' is null then[\s\S]*?v_outputs := null;/,
    );
  });

  it("names every unquantified outstanding decision instead of counting it as zero", () => {
    const g = body(decision, "get_case_decision_debt");
    expect(g).toMatch(/UNQUANTIFIED/);
    expect(g).toMatch(/never counted as zero/);
  });

  it("§70: the AI cannot state the two numbers a debt figure IS", () => {
    expect(body(decision, "record_decision_delay_exposure")).toMatch(
      /ai_admin/,
    );
    const t = body(decision, "enforce_decision_exposure_immutable");
    expect(t).toMatch(/v_role = 'ai_admin'/);
    // ...and the two numbers are refused to every caller on UPDATE.
    expect(t).toMatch(
      /new\.expected_impact is distinct from old\.expected_impact/,
    );
    expect(t).toMatch(/cannot be rewritten by ANY caller/);
  });

  it("links decisions to activities through a §70-walled, org-scoped table", () => {
    expect(decision).toMatch(
      /create table if not exists public\.decision_schedule_links/,
    );
    expect(decision).toMatch(
      /create policy decision_schedule_links_read on public\.decision_schedule_links\s+for select to authenticated using \(organization_id = app_current_org\(\)\)/,
    );
    const t = body(decision, "enforce_decision_schedule_link");
    expect(t).toMatch(/v_role = 'ai_admin'/);
    expect(t).toMatch(/e\.development_case_id = new\.development_case_id/);
    expect(decision).toMatch(
      /create trigger trg_decision_schedule_link\s+before insert or update or delete/,
    );
  });
});

/* ─────────────── D5.21 / D13.02 / D13.08 — the compositions ───────────── */

describe("the screens COMPOSE recorded runs and compute nothing", () => {
  it("reads the latest run through ONE helper, so absence has one meaning", () => {
    expect(screens).toMatch(
      /create or replace function public\.sync_latest_calculation_run\(/,
    );
    for (const fn of [
      "get_case_integrated_controls",
      "get_case_assurance_engine",
    ]) {
      expect(body(screens, fn)).toMatch(/sync_latest_calculation_run\(/);
    }
  });

  it("never records a calculation run of its own", () => {
    // A composition performs no calculation, and minting a lineage row would
    // put a method, a version and an input digest behind numbers this file did
    // not produce.
    for (const fn of [
      "get_case_integrated_controls",
      "get_case_assurance_engine",
      "get_my_decisions",
    ]) {
      expect(body(screens, fn)).not.toMatch(/record_calculation_run/);
    }
    expect(screens).not.toContain("record_calculation_run");
  });

  it("says NO RUN RECORDED rather than falling back to a live read", () => {
    const c = body(screens, "get_case_integrated_controls");
    expect(c).toMatch(
      /has been recorded for this case, so there is nothing to show/,
    );
    expect(c).toMatch(/live read is deliberately not used as a fallback/);
    // The composition calls NO get_case_* live read for its figures.
    expect(c).not.toMatch(
      /get_case_earned_value|get_case_scope_growth|get_case_contingency\(/,
    );
  });

  it("shows all six §44 dimensions plus contingency, and names the empty one", () => {
    const c = body(screens, "get_case_integrated_controls");
    for (const d of CONTROL_DIMENSIONS) {
      expect(c).toContain(`'${d.key}'`);
    }
    expect(c).toMatch(/NO procurement calculation exists in Sync Develop yet/);
    expect(c).toMatch(/'dimensionsTotal', 7/);
  });

  it("distinguishes a REFUSED run from a missing one", () => {
    const c = body(screens, "get_case_integrated_controls");
    expect(c).toMatch(/when v_run->>'status' = 'refused' then/);
  });

  it("D5.21 composes only what already exists and refuses a single score", () => {
    const e = body(screens, "get_case_assurance_engine");
    for (const k of [
      "case_estimate_confidence",
      "case_schedule_quality",
      "case_progress_integrity",
    ]) {
      expect(e).toContain(k);
    }
    expect(e).toMatch(/risk_assurance_reviews/);
    expect(e).toMatch(/assurance_case_claims/);
    expect(e).toMatch(/publishes no single assurance score/);
    // A composition row builds NO new primitive: this file creates no table.
    expect(screens).not.toMatch(/create table/i);
  });

  it("D13.02 is per-user, over the ONE canonical decisions table", () => {
    const q = body(screens, "get_my_decisions");
    expect(q).toMatch(/from decisions d/);
    // No fourth decision store anywhere in the slice.
    expect(executable).not.toMatch(
      /create table[^;]*(my_decisions|decision_queue)/,
    );
    // Personal by default, org-wide only for admin/executive, and the payload
    // SAYS which.
    expect(q).toMatch(/v_all := v_role in \('admin','executive'\)/);
    expect(q).toMatch(/d\.owner_id = v_uid/);
    expect(q).toMatch(
      /'scope', case when v_all then 'organization' else 'mine' end/,
    );
    // The dual-caller gate is auth.uid(): a queue is personal.
    expect(q).toMatch(/if v_uid is null then/);
  });

  it("D13.02 carries the three columns the register named as missing", () => {
    const q = body(screens, "get_my_decisions");
    expect(q).toMatch(/'dueDate', m\.decision_required_date/);
    expect(q).toMatch(/'latencyDays'/);
    expect(q).toMatch(/'reassessmentRequired', m\.reassessment_required/);
    // ...and it is CROSS-DOMAIN, not risk-only like the /risk queue it extends.
    expect(q).toMatch(/'domain', case when m\.development_case_id is not null/);
  });

  it("renders no blank where an absence belongs", () => {
    const q = body(screens, "get_my_decisions");
    expect(q).toMatch(/'valueRefusal'/);
    expect(q).toMatch(/'dueRefusal'/);
    expect(q).toMatch(/'recommendationRefusal'/);
  });
});

/* ─────────────────────── D11.29 — lineage, four keys ──────────────────── */

describe("every 4D calculation records a lineage run", () => {
  it("pins exactly the four new keys, and only keys a compute function records", () => {
    for (const k of CHANGE_CALC_KEYS) {
      expect(ledger).toContain(`('${k}',`);
      // Each pinned key must appear in a record_calculation_run call.
      expect(joined).toMatch(
        new RegExp(`record_calculation_run\\([\\s\\S]{0,200}'${k}'`),
      );
    }
    expect(ledger).toMatch(
      new RegExp(`'case_contingency_consumption',\\s*'${CHANGE_CALC_VERSION}'`),
    );
  });

  it("keeps the 4A/4B/4C versions unchanged", () => {
    // Bumping a version on unchanged code makes the version stop meaning
    // anything.
    expect(ledger).toContain("'develop-controls/4A/2026-11-24'");
    expect(ledger).toContain("'develop-performance/4B/2026-12-01'");
    expect(ledger).toContain("'develop-schedule/4C/2026-12-02'");
  });

  it("records refusals as well as figures, in every compute function", () => {
    for (const fn of [
      "compute_case_contingency_consumption",
      "compute_case_change_control",
      "compute_case_decision_latency",
      "compute_case_decision_debt",
    ]) {
      const c = body(joined, fn);
      expect(c).toMatch(/v_refusals/);
      expect(c).toMatch(/v_outputs := null;/);
      expect(c).toMatch(/record_calculation_run\(/);
    }
  });

  /**
   * REPLACES a weaker predecessor, and is strictly stronger on every axis.
   *
   * The old test asserted only that the digest LITERALS appeared somewhere in
   * the compute functions and that the screen read's body contained the
   * strings 'ledgerDigest' and 'changeDigest'. It never checked that the
   * decision digests were RETURNED by the screen read, and it could not see
   * whether anything compared or rendered staleness — which is why a screen
   * with no staleness path at all shipped green. This version asserts (a)
   * every digest is recorded by its compute function, (b) every digest a
   * dimension is marked `stalenessCheckable` for is RETURNED in
   * currentFingerprints, (c) the digest EXPRESSIONS are byte-identical between
   * the two sides, and (d) a dimension the screen cannot fingerprint is
   * marked false and carries a sentence. Every assertion of the old test is
   * implied by (a) and (b).
   */
  it("fingerprints CONTENT, and everything it marks checkable it actually returns", () => {
    const c = body(screens, "get_case_integrated_controls");
    for (const d of [
      "ledgerDigest",
      "changeDigest",
      "propagationDigest",
      "decisionDigest",
      "linkDigest",
      "exposureDigest",
      "openDecisionDigest",
      "policyDigest",
    ]) {
      // recorded by a compute function...
      expect(joined, `${d} is never recorded`).toContain(`'${d}',`);
      // ...and RETURNED by the screen read, so a comparison is possible.
      expect(c, `${d} is not returned by the screen read`).toContain(`'${d}'`);
    }

    // The digest EXPRESSIONS themselves must match, not merely the key names:
    // two different definitions of one fingerprint is a comparison that can
    // never fail.
    const normalise = (t: string) => t.replace(/\s+/g, " ").trim();
    for (const [key, source] of [
      ["ledgerDigest", ledger],
      ["decisionDigest", decision],
      ["exposureDigest", decision],
      ["openDecisionDigest", decision],
    ] as const) {
      const grab = (t: string) => {
        const at = t.indexOf(`'${key}', coalesce((`);
        expect(at, `${key} expression missing`).toBeGreaterThan(-1);
        return normalise(t.slice(at, t.indexOf("), 'empty')", at)));
      };
      expect(grab(c), `${key} drifted between the kernel and the screen`).toBe(
        grab(source),
      );
    }

    // A dimension whose fingerprint the screen CANNOT produce is marked, so a
    // tile never prints a caption that implies a check it did not make.
    expect(c).toMatch(/'stalenessCheckable', rec\.checkable/);
    expect(c).toMatch(/'stalenessNote'/);
    expect(c).toMatch(/\('scope',\s+'Scope',\s+'case_scope_growth', false,/);
    expect(c).toMatch(/\('cost',\s+'Cost',\s+'case_earned_value', false,/);
    expect(c).toMatch(
      /\('contingency',\s+'Contingency',\s+'case_contingency_consumption', true,/,
    );
  });

  it("every compute function is §70-walled and role-checked", () => {
    for (const fn of [
      "compute_case_contingency_consumption",
      "compute_case_change_control",
      "compute_case_decision_latency",
      "compute_case_decision_debt",
    ]) {
      const c = body(joined, fn);
      expect(c).toMatch(/ai_admin/);
      expect(c).toMatch(/not in\s*\n?\s*\('admin','executive'/);
    }
  });
});

/* ───────────────────────── posture, across the slice ──────────────────── */

describe("the slice keeps the platform posture", () => {
  it("every new table is org-scoped with RLS in the SAME migration", () => {
    for (const [file, tables] of [
      [ledger, ["project_contingency_pools", "contingency_ledger_entries"]],
      [change, ["project_changes", "project_change_propagation"]],
      [decision, ["decision_schedule_links", "decision_delay_exposures"]],
    ] as [string, string[]][]) {
      for (const t of tables) {
        expect(file).toContain(`create table if not exists public.${t}`);
        expect(file).toContain(
          `alter table public.${t} enable row level security`,
        );
        expect(file).toMatch(
          new RegExp(
            `create policy [a-z_]+ on public\\.${t}[\\s\\S]{0,200}organization_id = app_current_org\\(\\)`,
          ),
        );
        expect(file).toMatch(
          new RegExp(
            `organization_id uuid not null references organizations\\(id\\)[\\s\\S]{0,4000}${t}|create table if not exists public\\.${t}[\\s\\S]{0,600}organization_id uuid not null references organizations\\(id\\)`,
          ),
        );
      }
    }
  });

  it("every mutation is a SECURITY DEFINER RPC that audits with prev/new state", () => {
    for (const fn of [
      "establish_contingency_pool",
      "draw_down_contingency",
      "release_contingency",
      "raise_project_change",
      "assess_project_change",
      "decide_project_change",
      "close_change_propagation",
      "implement_project_change",
      "link_decision_to_activity",
      "record_decision_delay_exposure",
    ]) {
      const b = body(joined, fn);
      expect(b).toMatch(/security definer/);
      expect(b).toMatch(/set search_path = public/);
      expect(b).toMatch(
        /insert into audit_events \(organization_id, entity_type, actor, event_data, previous_state, new_state\)/,
      );
    }
  });

  it("keeps smoke fixture keys short, because gitleaks reads long ids as secrets", () => {
    // The 4C pattern: 'S4C-P10', not 'SMOKE4C-P1030'. This has blocked two
    // merges already.
    const smoke = readFileSync("scripts/ci-develop-slice4d-smoke.sh", "utf8");
    for (const m of smoke.matchAll(/S4D-[A-Za-z0-9]+/g)) {
      expect(
        m[0].length,
        `${m[0]} is too long for gitleaks`,
      ).toBeLessThanOrEqual(9);
    }
  });

  it("is wired into CI in the existing pattern", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("bash scripts/ci-develop-slice4d-smoke.sh");
    // ...after 4C, because the smokes run in slice order.
    expect(ci.indexOf("slice4d-smoke")).toBeGreaterThan(
      ci.indexOf("slice4c-smoke"),
    );
  });

  it("never widens an existing guard", () => {
    // No 4D file may drop a constraint it did not create, other than the
    // authority action_type check it extends by ADDING values.
    // STRUCTURAL, not a name allowlist: every constraint this slice drops must
    // be RE-ADDED by the same slice. A drop with no matching add is a guard
    // removed, whatever it is called — and a name allowlist would have to grow
    // every time the slice legitimately re-issues one, which is exactly the
    // widening this test exists to prevent.
    const drops = rawJoined.match(/drop constraint if exists [a-z_]+/g) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      const name = d.replace("drop constraint if exists ", "");
      expect(
        rawJoined.includes(`add constraint ${name}`),
        `${name} is dropped and never re-added — that is a guard removed`,
      ).toBe(true);
    }
    // ...and the action_type list only ever grows.
    for (const v of [
      "general",
      "sanction",
      "regulatory_variance",
      "gate_requirement_waiver",
      "contingency_drawdown",
      "change_approval",
    ]) {
      expect(change).toContain(`'${v}'`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE REPAIR SUITE.
 *
 * One test per defect adversarial review found in the first cut of this
 * slice. Each of these would have FAILED against the code as first written,
 * and each names the failure it prevents rather than the line it reads.
 * ═══════════════════════════════════════════════════════════════════════ */
describe("Slice 4D repair — money cannot move outside recorded authority", () => {
  it("a drawdown against an approved change can be RELEASED (the linked-change constraint)", () => {
    // release_contingency was written in 090000, before 090100 added
    // cause_change_id and the constraint requiring it for the approved_change
    // class — so the only reversal path for one of the six causes raised a raw
    // 23514 with the full failing row. It is re-issued beside the drawdown.
    const r = body(change, "release_contingency");
    expect(r).toContain("cause_change_id");
    expect(r).toMatch(/d\.cause_change_id/);
    expect(
      change.lastIndexOf(
        "create or replace function public.release_contingency(",
      ),
    ).toBeGreaterThan(-1);
  });

  it("the pool has an INSERT wall, not only an UPDATE one", () => {
    // The pool carries the original amount every balance is measured from and
    // was the one table in the slice with no INSERT-side trigger: a service
    // caller could mint a fund against another case's superseded baseline,
    // established by the AI identity, unaudited.
    expect(ledger).toMatch(
      /create trigger trg_contingency_pool_wall\s+before insert or update or delete on public\.project_contingency_pools/,
    );
    const w = body(ledger, "enforce_contingency_pool_wall");
    expect(w).toMatch(/if tg_op = 'INSERT' then/);
    expect(w).toMatch(/b\.baseline_type <> 'COST'/);
    expect(w).toMatch(/b\.status <> 'approved'/);
    expect(w).toMatch(/v_role = 'ai_admin'/);
    expect(w).toMatch(
      /b\.development_case_id is distinct from new\.development_case_id/,
    );
  });

  it("the ceiling is CUMULATIVE against one fund, so splitting a spend cannot defeat it", () => {
    const a = body(ledger, "sync_contingency_authority");
    expect(a).toMatch(/v_committed/);
    expect(a).toMatch(/filter \(where e\.entry_type = 'drawdown'\)/);
    expect(a).toMatch(/v_committed \+ p_amount > l\.max_commitment_usd/);
    expect(a).toMatch(/alreadyCommitted/);
    // ...and the drawdown passes the pool and the approver so it can be applied.
    for (const src of [ledger, change]) {
      const d = body(src, "draw_down_contingency");
      expect(d).toMatch(
        /sync_contingency_authority\(v_org, v_role, v_amount, p\.currency, p\.id, auth\.uid\(\)\)/,
      );
    }
  });

  it("a recorded spend cannot be DELETEd while its case exists, by any caller", () => {
    // sync_contingency_remaining derives the balance from the entries, so
    // deleting a $180k drawdown CREATES $180k of spendable authority. The
    // generic service branch used to return OLD with only a note.
    for (const fn of [
      "enforce_contingency_entry_immutable",
      "enforce_contingency_pool_wall",
    ]) {
      const t = body(ledger, fn);
      expect(t).toMatch(/if tg_op = 'DELETE' then/);
      expect(t).toMatch(
        /exists \(select 1 from development_cases where id = old\.development_case_id\)/,
      );
      expect(t).toMatch(/raise exception/);
    }
  });

  it("the cause SUBJECT and the delegation are frozen with the amount", () => {
    const t = body(ledger, "enforce_contingency_entry_immutable");
    for (const f of [
      "cause_risk_id",
      "cause_change_id",
      "authority_limit_id",
      "reverses_entry_id",
      "recorded_by",
      "entry_no",
    ]) {
      expect(t, `${f} is not frozen`).toContain(f);
    }
  });

  it("a ceiling is an amount IN A CURRENCY and a mismatch refuses", () => {
    expect(ledger).toMatch(
      /max_commitment_currency text not null default 'USD'/,
    );
    const a = body(ledger, "sync_contingency_authority");
    expect(a).toMatch(
      /upper\(btrim\(p_currency\)\) is distinct from l\.max_commitment_currency/,
    );
    const ca = body(change, "sync_change_authority");
    expect(ca).toMatch(
      /upper\(btrim\(p_currency\)\) is distinct from l\.max_commitment_currency/,
    );
  });

  it("change approval routes on the contingency effect as well as the cost effect", () => {
    const a = body(change, "sync_change_authority");
    expect(a).toMatch(
      /abs\(coalesce\(p_cost_effect, 0\)\)\s*\n?\s*\+ abs\(coalesce\(p_contingency_effect, 0\)\)/,
    );
    const d = body(change, "decide_project_change");
    expect(d).toMatch(/ch\.contingency_effect, ch\.currency/);
  });

  it("a drawdown cannot exceed the contingency the change was approved to commit", () => {
    const d = body(change, "draw_down_contingency");
    expect(d).toMatch(
      /v_drawn_for_change \+ v_amount > ch\.contingency_effect/,
    );
    expect(d).toMatch(/coalesce\(ch\.contingency_effect, 0\) <= 0/);
  });

  it("the pool row is locked before the balance is read", () => {
    for (const [src, fn] of [
      [ledger, "draw_down_contingency"],
      [ledger, "release_contingency"],
      [change, "draw_down_contingency"],
      [change, "release_contingency"],
    ] as const) {
      expect(body(src, fn), `${fn} reads the balance without a lock`).toMatch(
        /for update/,
      );
    }
  });

  it("money in two currencies is refused, never summed", () => {
    const r = body(ledger, "get_case_contingency");
    expect(r).toMatch(/array_agg\(distinct currency/);
    expect(r).toMatch(/v_mixed/);
    expect(r).toMatch(/'originalTotal', case when v_mixed then null/);
    const cc = body(change, "compute_case_change_control");
    expect(cc).toMatch(/'approvedCostEffect', case when v_mixed then null/);
  });

  it("spending has at least the role floor that REPORTING the spend has", () => {
    for (const [src, fn] of [
      [ledger, "draw_down_contingency"],
      [ledger, "release_contingency"],
      [change, "draw_down_contingency"],
    ] as const) {
      expect(body(src, fn), `${fn} has no role floor`).toMatch(
        /'admin','executive','maintenance_manager','reliability_engineer','planner'/,
      );
    }
  });

  it("malformed uuid text refuses as data rather than raising 22P02", () => {
    expect(ledger).toMatch(/create or replace function public\.sync_safe_uuid/);
    for (const [src, fn] of [
      [ledger, "draw_down_contingency"],
      [change, "draw_down_contingency"],
      [change, "raise_project_change"],
    ] as const) {
      expect(body(src, fn)).toMatch(/sync_safe_uuid\(/);
    }
    // ...and no 4D door parses a caller-supplied uuid with a bare cast.
    expect(joined).not.toMatch(
      /nullif\(btrim\(coalesce\(p_[a-z_]+->>'[a-z_]+', ''\)\), ''\)::uuid/,
    );
  });
});

describe("Slice 4D repair — §70, tenancy and the walls", () => {
  it("the latest-run helper is org-gated AND not client-callable", () => {
    // It was SECURITY DEFINER, granted to `authenticated`, took an arbitrary
    // case uuid and never called app_current_org() — so any signed-in identity
    // could read every recorded calculation in the product for any case.
    const f = screens.slice(
      screens.indexOf(
        "create or replace function public.sync_latest_calculation_run(",
      ),
    );
    const def = f.slice(0, f.indexOf("$$;"));
    expect(def).toMatch(/r\.organization_id = app_current_org\(\)/);
    expect(def).toMatch(/app_current_org\(\) is not null/);
    expect(screens).toMatch(
      /revoke all on function public\.sync_latest_calculation_run\(uuid, text\)\s*\n?\s*from public, anon, authenticated, service_role;/,
    );
    expect(screens).not.toMatch(
      /grant execute on function public\.sync_latest_calculation_run/,
    );
  });

  it("both decision kernels apply the same risk-visibility predicate as the queue", () => {
    for (const fn of ["get_case_decision_latency", "get_case_decision_debt"]) {
      expect(body(decision, fn), `${fn} leaks restricted decisions`).toMatch(
        /dec\.risk_id is null or can_read_risk\(dec\.risk_id\)/,
      );
    }
    expect(body(screens, "get_my_decisions")).toMatch(
      /d\.risk_id is null or can_read_risk\(d\.risk_id\)/,
    );
  });

  it("un-deciding a decided change is refused for every caller and audited", () => {
    const t = body(change, "enforce_project_change_governance");
    const at = t.indexOf("A decided change does not un-decide");
    expect(at).toBeGreaterThan(-1);
    const branch = t.slice(at);
    expect(branch).toMatch(/raise exception/);
    // 4D-R33: a refusing path writes NO security_events row, because a BEFORE
    // trigger that inserts and then raises loses the insert with the statement.
    // A dead audit call would read as a trail that does not exist.
    expect(branch.slice(0, branch.indexOf("raise exception"))).not.toMatch(
      /insert into security_events/,
    );
    // ...and the impact vector it was routed on is frozen with the decision.
    expect(branch).toMatch(
      /new\.cost_effect is distinct from old\.cost_effect/,
    );
    expect(branch).toMatch(
      /new\.contingency_effect is distinct from old\.contingency_effect/,
    );
  });

  it("a closed propagation obligation cannot be reopened or re-owned", () => {
    const t = body(change, "enforce_change_propagation_wall");
    expect(t).toMatch(/if tg_op = 'UPDATE' then/);
    expect(t).toMatch(/new\.sync_owned is distinct from old\.sync_owned/);
    expect(t).toMatch(/old\.closed_at is not null/);
    expect(t).toMatch(/insert into security_events/);
  });

  it("the exposure trigger's §70 and provenance checks cover INSERT and UPDATE", () => {
    const t = body(decision, "enforce_decision_exposure_immutable");
    expect(t).toMatch(/if tg_op in \('INSERT', 'UPDATE'\) then/);
    const covered = t.slice(t.indexOf("if tg_op in ('INSERT', 'UPDATE') then"));
    expect(covered).toMatch(/v_role = 'ai_admin'/);
    expect(covered).toMatch(/new\.recorded_by is distinct from auth\.uid\(\)/);
    expect(covered).toMatch(
      /d\.development_case_id is distinct from new\.development_case_id/,
    );
  });

  it("a change cannot be anchored to a superseded baseline, at raise or at decision", () => {
    expect(body(change, "raise_project_change")).toMatch(
      /b\.status = 'approved'/,
    );
    expect(body(change, "decide_project_change")).toMatch(
      /b\.status = 'superseded'/,
    );
    expect(body(change, "enforce_project_change_governance")).toMatch(
      /tg_op = 'INSERT' and b\.status <> 'approved'/,
    );
  });

  it("the money ceiling itself has a wall, an author and a §70 refusal", () => {
    expect(authority).toMatch(
      /create trigger trg_authority_limit_wall\s+before insert or update or delete on public\.authority_limits/,
    );
    expect(authority).toMatch(
      /create trigger trg_authority_limit_no_truncate\s+before truncate on public\.authority_limits/,
    );
    expect(authority).toMatch(
      /revoke truncate on table public\.authority_limits from anon, authenticated, service_role;/,
    );
    const w = body(authority, "enforce_authority_limit_wall");
    expect(w).toMatch(/old\.status = 'adopted'/);
    expect(w).toMatch(
      /new\.max_commitment_usd is distinct from old\.max_commitment_usd/,
    );
    expect(w).toMatch(/'NaN'::numeric/);
    expect(w).toMatch(/up\.role = 'ai_admin'/);

    const a = body(authority, "adopt_authority_limit");
    expect(a).toMatch(/v_money and v_role = 'ai_admin'/);
    expect(a).toMatch(/l\.role_key = v_role/);
    expect(a).toMatch(/insert into audit_events/);

    const st = body(authority, "state_authority_ceiling");
    expect(st).toMatch(/= 'ai_admin'/);
    expect(st).toMatch(/l\.status <> 'draft'/);
    expect(st).toMatch(/sync_finite_money/);
    expect(st).toMatch(/insert into audit_events/);
  });

  it("every new authority function uses auth.uid() for the dual-caller gate", () => {
    expect(authority).not.toMatch(/current_user in \(/);
    expect(authority).toMatch(/auth\.uid\(\) is not null/);
    for (const fn of [
      "state_authority_ceiling",
      "draft_authority_ceiling",
      "get_authority_delegations",
      "adopt_authority_limit",
    ]) {
      expect(authority).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\([a-z, ]*\\) from public, anon, service_role;`,
        ),
      );
    }
  });
});

describe("Slice 4D repair — a calculation that cannot produce a number refuses", () => {
  it("a decision recorded as decided is not counted as OPEN, nor clocked from now()", () => {
    const r = body(decision, "get_case_decision_latency");
    expect(r).toMatch(
      /\(dec\.selected_at is null and coalesce\(dec\.approval_status, 'pending'\) = 'pending'\)\s*\n?\s*as is_open/,
    );
    // ...its latency is null rather than a running clock...
    expect(r).toMatch(/when d\.closed_without_instant then null/);
    // ...and the §54 exposure sum takes only RUNNING clocks.
    expect(r).toMatch(/\(value->>'latencyKind'\) = 'running'/);
  });

  it("the queue's counts are over the whole queue, not the page", () => {
    const q = body(screens, "get_my_decisions");
    expect(q).toMatch(/into v_all_rows/);
    expect(q).toMatch(/from jsonb_array_elements\(v_all_rows\)/);
    expect(q).toMatch(/'truncated', v_total > jsonb_array_length\(v_rows\)/);
    // The limit is applied AFTER the counts, not inside the row query.
    expect(q.indexOf("into v_all_rows")).toBeLessThan(
      q.indexOf("i <= v_limit"),
    );
  });

  it("the queue does not re-derive II.17's DecisionDebt formula", () => {
    const q = body(screens, "get_my_decisions");
    expect(q).not.toMatch(/expected_impact \* le\.probability_of_delay/);
    expect(q).toMatch(/'expectedImpact', le\.expected_impact/);
  });

  it("a REFUSED constituent is not counted as live on the assurance engine", () => {
    const e = body(screens, "get_case_assurance_engine");
    expect(e).toMatch(/v_estimate->>'status' <> 'refused'/);
    expect(e).toMatch(/v_quality->>'status' <> 'refused'/);
    expect(e).toMatch(/v_integrity->>'status' <> 'refused'/);
  });

  it("the screens still record nothing", () => {
    // The repair must not have smuggled a calculation into a composition.
    expect(screens).not.toMatch(/record_calculation_run\(/);
  });
});

describe("Slice 4D repair — the audit trail says only what survives", () => {
  it("no 4D trigger inserts a security_events row on a path that then RAISES", () => {
    // Proven live: a service UPDATE refused by the change-governance trigger
    // left security_events unchanged. An audit call that cannot survive its own
    // refusal is dead code that reads, in review and in the register, as an
    // audit trail. The refusal is the enforcement; the rows that DO land are
    // the admitted service writes.
    const all = [ledger, change, decision, screens, authority].join("\n");
    let from = 0;
    let checked = 0;
    for (;;) {
      const at = all.indexOf("insert into security_events", from);
      if (at === -1) break;
      const stmtEnd = all.indexOf(");", all.indexOf("values", at));
      const after = all.slice(stmtEnd, stmtEnd + 300);
      expect(
        after.replace(/\s+/g, " ").trim(),
        "a security_events insert is followed by a raise, so it is discarded",
      ).not.toMatch(/^\);\s*(end if;)?\s*raise exception/);
      from = at + 1;
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
