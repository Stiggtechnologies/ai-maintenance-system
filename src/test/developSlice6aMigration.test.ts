/**
 * Sync Develop Slice 6A — migration contract (static, no database).
 *
 * Every sibling slice ships one of these, and 5D shipped without one: six
 * defects in its migration text got past a live transcript as a direct result.
 *
 * An award is money and it is adversarial, so the clauses below are the ones
 * whose absence would not show up as a failing transcript step — a door that
 * quietly reappears, a wall that loses its UPDATE branch, a seal that only the
 * row-level policy holds while the definer read hands the price out anyway, a
 * separation of duties enforced in one direction only, a `contract_award`
 * authority store forked instead of extended.
 *
 * A later edit that re-opens one of those fails HERE, before it reaches a
 * database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  BID_EVALUATION_KINDS,
  BID_EVALUATION_OUTCOMES,
  CONTRACT_TYPES,
  PROCUREMENT_KERNEL_VERSION,
  PROCUREMENT_STATUS_DIMENSIONS,
  PROCUREMENT_STATUS_VALUES,
} from "../lib/develop/procurement";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const PKG_FILE = "20261208090000_develop_procurement_package.sql";
const TENDER_FILE = "20261208090100_develop_tender_sealed_bid.sql";
const AWARD_FILE = "20261208090200_develop_contract_award.sql";
const SLICE_FILES = [PKG_FILE, TENDER_FILE, AWARD_FILE];

const pkg = read(PKG_FILE);
const tender = read(TENDER_FILE);
const award = read(AWARD_FILE);
const joined = [pkg, tender, award].join("\n");
const rawJoined = SLICE_FILES.map(raw).join("\n");

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

/** The `create trigger` statement bound to a named trigger. */
function trigger(source: string, name: string): string {
  const at = source.indexOf(`create trigger ${name}`);
  expect(at, `trigger ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", at);
  return source.slice(at, end === -1 ? undefined : end);
}

describe("Slice 6A — the migrations land after Slice 5D and nowhere else", () => {
  it("is numbered strictly after 20261207090300", () => {
    for (const f of SLICE_FILES) {
      expect(f.slice(0, 14) > "20261207090300").toBe(true);
    }
  });

  it("creates no second procurement, contract or authority store", () => {
    // The overlap map's ruling 13: contract_packages IS the ProcurementPackage
    // and the Contract. A `contracts` or `procurement_packages` table here
    // would be the parallel track AGENTS.md invariant 1 forbids.
    expect(joined).not.toMatch(/create table[^;]*\bprocurement_packages\b/);
    expect(joined).not.toMatch(/create table[^;]*\bcontracts\b/);
    expect(joined).not.toMatch(/create table[^;]*\bcontract_awards\b/);
    expect(joined).not.toMatch(/create table[^;]*\bauthority_/);
    // The package and the contract grow the EXISTING table.
    expect(pkg).toContain("alter table public.contract_packages");
    expect(tender).toContain("alter table public.contract_bids");
  });

  it("extends the ONE authority store rather than forking it", () => {
    expect(award).toContain("alter table public.authority_limits");
    expect(award).toContain("'contract_award'");
    // Every earlier action type survives the CHECK re-declaration. Dropping
    // one would silently invalidate every adopted delegation of that kind.
    for (const t of [
      "general",
      "sanction",
      "regulatory_variance",
      "gate_requirement_waiver",
      "contingency_drawdown",
      "change_approval",
    ]) {
      expect(award).toContain(`'${t}'`);
    }
  });
});

describe("Slice 6A — the §25 vocabulary is one definition, not two", () => {
  const values = body(pkg, "sync_procurement_status_values");

  it("names the same four dimensions as the TypeScript mirror", () => {
    const dims = body(pkg, "sync_procurement_status_dimensions");
    for (const d of PROCUREMENT_STATUS_DIMENSIONS) {
      expect(dims).toContain(`'${d}'`);
    }
    expect(PROCUREMENT_STATUS_DIMENSIONS).toHaveLength(4);
  });

  it("carries every TypeScript status value, dimension by dimension", () => {
    // PINNED BOTH WAYS in spirit: a value added to one side only makes the
    // CHECK and the selector disagree, and a package then cannot be moved to a
    // status the screen offers.
    for (const d of PROCUREMENT_STATUS_DIMENSIONS) {
      for (const v of PROCUREMENT_STATUS_VALUES[d]) {
        expect(values, `${d}.${v} missing from SQL`).toContain(`'${v}'`);
      }
    }
  });

  it("makes the CHECK read the function rather than repeat the list", () => {
    expect(pkg).toContain("contract_package_status_vocabulary");
    for (const d of PROCUREMENT_STATUS_DIMENSIONS) {
      expect(pkg).toContain(`sync_procurement_status_values('${d}')`);
    }
  });

  it("pins the two evaluation kinds and the contract strategies to TypeScript", () => {
    const kinds = body(tender, "sync_bid_evaluation_kinds");
    for (const k of BID_EVALUATION_KINDS) expect(kinds).toContain(`'${k}'`);
    const outcomes = body(tender, "sync_bid_evaluation_outcomes");
    for (const o of BID_EVALUATION_OUTCOMES)
      expect(outcomes).toContain(`'${o}'`);
    const types = body(award, "sync_contract_types");
    for (const t of CONTRACT_TYPES) expect(types).toContain(`'${t}'`);
    expect(CONTRACT_TYPES).toHaveLength(7);
  });

  it("pins the calculation code version to the TypeScript constant", () => {
    expect(award).toContain(
      `('case_procurement_position',      '${PROCUREMENT_KERNEL_VERSION}')`,
    );
  });

  it("re-declares the code-version registry with every prior key intact", () => {
    // Dropping a key here would make an earlier compute_* function unable to
    // record a run at all — record_calculation_run raises on an unpinned key.
    const reg = body(award, "sync_calculation_code_version");
    for (const k of [
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
    ]) {
      expect(reg, `${k} dropped from the registry`).toContain(`'${k}'`);
    }
  });
});

describe("Slice 6A — the gate blocking rides the ONE predicate", () => {
  it("appends into case_gate_outstanding_obligations rather than evaluating a second time", () => {
    expect(pkg).toContain("pg_get_functiondef");
    expect(pkg).toContain("case_gate_outstanding_obligations");
    expect(pkg).toContain(
      "v_out := v_out || case_procurement_gate_obligations(c.id, g.id);",
    );
    // And it RAISES rather than proceeding if the anchor has moved — a blind
    // append is how a slice silently reverts a fix made since.
    expect(pkg).toContain(
      "building a second gate evaluator instead is forbidden",
    );
    expect(pkg).toContain("do not append blind");
  });

  it("extends the persistence wall's refused-type list AND its message", () => {
    expect(pkg).toContain("enforce_gate_review_outstanding_obligations");
    expect(pkg).toContain("'procurement_package_unawarded'");
    expect(pkg).toContain("'procurement_package_late'");
    // A wall whose message no longer describes what it checks is worse than no
    // message, so the transformation fails rather than widening the list alone.
    expect(pkg).toContain("III.§25");
    expect(pkg).toContain("do not widen a wall blind");
  });

  it("gates the predicate on auth.uid(), never on current_user", () => {
    const obligations = body(pkg, "case_procurement_gate_obligations");
    expect(obligations).toContain("app_current_org()");
    expect(obligations).toContain("auth.uid() is not null");
    // `current_user in ('authenticated','anon')` is DEAD CODE inside a definer
    // owned by the migration role — 20261130090700 repaired thirteen of them.
    expect(obligations).not.toMatch(/current_user\s+in\s*\(/);
  });

  it("resolves the case and compares it to the caller's organization", () => {
    const obligations = body(pkg, "case_procurement_gate_obligations");
    expect(obligations).toMatch(/from development_cases where id = p_case_id/);
    expect(obligations).toContain("c.organization_id <> v_caller_org");
  });

  it("blocks ONLY over declared-mandatory packages with the dates to assess", () => {
    const obligations = body(pkg, "case_procurement_gate_obligations");
    // Both legs require the mandatory flag AND the dates. A package missing
    // either date must be absent from the list entirely — an alarm wired to a
    // date nobody recorded is worse than no alarm.
    expect(obligations).toContain("p.is_mandatory");
    expect(obligations).toContain("p.required_date is not null");
    expect(obligations).toContain("p.lead_time_days is not null");
    expect(obligations).toContain("p.forecast_delivery_date is not null");
  });

  it("reads lateness off the DATES, and DISCHARGES off a dated receipt", () => {
    const obligations = body(pkg, "case_procurement_gate_obligations");
    expect(obligations).toContain("p.forecast_delivery_date > p.required_date");
    // THE DEFECT THIS CLAUSE EXISTS FOR. The discharge term used to be
    // `delivery_status <> 'received_and_inspected'`, and one planner could
    // type that value through set_procurement_package_status with a
    // ten-character basis: the blocker went from firing to silent while the
    // recorded dates still said the equipment was 45 days late, and the gate
    // review the wall had just refused was then accepted with nothing arrived.
    // The column's own comment forbids exactly that. The discharge is now a
    // DATE, written by its own act.
    expect(obligations).toContain("p.actual_delivery_date is null");
    expect(obligations).not.toContain("delivery_status <>");
    expect(obligations).not.toContain("delivery_status =");
    // …and the status value that used to do it is refused BY NAME at the door.
    const setStatus = body(pkg, "set_procurement_package_status");
    expect(setStatus).toContain("record_package_delivery_receipt");
    expect(setStatus).toContain("not evidence that anything arrived");
    // The receipt and the status are ONE fact, for every writer.
    expect(pkg).toContain("contract_package_receipt_pair");
    expect(pkg).toContain(
      "(actual_delivery_date is not null)\n    = (delivery_status = 'received_and_inspected')",
    );
  });

  it("blocks a mandatory contract that cannot deliver on time BY ITS OWN TERMS", () => {
    // The leg that closes "mandatory, awarded LATE, no forecast recorded",
    // which legs 1 and 2 between them left silent: leg 1 stops the moment
    // anything is awarded and never asks whether the award happened before the
    // award-by date, and leg 2 needs a forecast_delivery_date that nothing
    // requires anybody to record. §24 makes contract_completion_date mandatory
    // on every awarded package, so this evidence is always present.
    const obligations = body(pkg, "case_procurement_gate_obligations");
    expect(obligations).toContain("procurement_package_contract_late");
    expect(obligations).toContain(
      "p.contract_completion_date > p.required_date",
    );
    expect(obligations).toContain("cannot deliver on time by its own terms");
    // …and it rides the SAME wall as the other two.
    expect(pkg).toContain(
      "'procurement_package_unawarded', 'procurement_package_late', 'procurement_package_contract_late'",
    );
  });

  it("names the mandatory awarded package nothing is measuring", () => {
    // Recording a forecast is voluntary, so a mandatory awarded package with
    // no forecast and no contract completion date was measured by nothing and
    // reported clean by every counter on the screen. NOT ASSESSABLE is an
    // answer; silence is not.
    const readFn = body(award, "get_case_procurement");
    expect(readFn).toContain("deliveryAssessable");
    expect(readFn).toContain("deliveryNotAssessableReason");
    expect(readFn).toContain("mandatoryDeliveryNotAssessable");
    expect(readFn).toContain("NOT ASSESSABLE");
    // …and it travels into the lineage row as a refusal, not as a clean run.
    const compute = body(award, "compute_case_procurement_position");
    expect(compute).toContain("mandatoryDeliveryNotAssessable");
  });

  it("refuses to move the §25 commercial dimension off a live award", () => {
    // The guard was one-directional: it blocked TYPING `awarded` and said
    // nothing about moving OFF it, so a planner set the commercial dimension
    // of a package holding a live award to `cancelled` — leaving awarded_at,
    // the supplier, the value and the whole §24 set standing while every
    // screen rendered the contract as cancelled — and it could not be undone.
    const setStatus = body(pkg, "set_procurement_package_status");
    expect(setStatus).toContain(
      "v_dim = 'commercial' and p.awarded_at is not null",
    );
    expect(setStatus).toContain("not a status edit");
    // …and a MANDATORY package is not cancelled into a permanent blocker
    // either: releasing the flag is the act, and it costs a stated reason.
    expect(setStatus).toContain(
      "v_dim = 'commercial' and v_status = 'cancelled' and p.is_mandatory",
    );
    expect(setStatus).toContain("Release the mandatory flag first");
  });

  it("leaves the mandatory flag alone when the payload omits it", () => {
    // `?? false` on the ONE flag that blocks a gate: a cosmetic retitle
    // through the documented write path cleared the flag, cleared its basis
    // and dropped a live gate blocker, with the audit row recording
    // `is_mandatory: false` as though the author had asked for it.
    const record = body(pkg, "record_procurement_package");
    expect(record).toContain("v_mandatory_stated");
    expect(record).toContain("else v_existing.is_mandatory end");
    expect(record).toContain("mandatory_release_basis");
    expect(record).not.toContain(
      "coalesce((p_package->>'is_mandatory')::boolean, false)",
    );
  });

  it("does not infer a critical path of its own", () => {
    // Sync imports P6's own float (20261202090000) and does not recompute a
    // network. A second critical path derived here would be the two-answers
    // failure AGENTS.md forbids; the read REPORTS the imported float instead.
    const obligations = body(pkg, "case_procurement_gate_obligations");
    expect(obligations).not.toContain("total_float_hours");
    const readFn = body(award, "get_case_procurement");
    expect(readFn).toContain("total_float_hours");
    expect(readFn).toContain("NOT ASSESSABLE");
  });
});

describe("Slice 6A — the seal is enforced on BOTH layers", () => {
  it("hides a sealed bid at the row level until the package records an open act", () => {
    expect(tender).toContain("create policy cb_read on public.contract_bids");
    // THE POLICY ASKS THE QUESTION THE DEFINER READ ASKS. It used to ask "does
    // THIS ROW carry a seal?" (`sealed_at is null or …`) while
    // get_package_tender asked "is this PACKAGE's envelope open?" — the same
    // answer only for rows submit_sealed_bid created. Any bid that reached the
    // table unsealed (the admitted service path, an import, a future
    // migration) was fully readable by every client on a LIVE tender, which is
    // the one leak this file exists to close, and it was two implementations
    // of one question disagreeing.
    const policyAt = tender.indexOf(
      "create policy cb_read on public.contract_bids",
    );
    const policy = tender.slice(policyAt, tender.indexOf(";", policyAt));
    expect(policy).toContain("p.bids_close_at is not null");
    expect(policy).toContain("p.bids_opened_at is null");
    expect(policy).not.toContain("sealed_at");
  });

  it("also withholds every content field from the DEFINER read", () => {
    // THE DEFECT THIS CLAUSE EXISTS FOR: get_package_tender is SECURITY
    // DEFINER, so the row-level policy above does not constrain it at all. A
    // seal that lives only in the policy hands the price straight out through
    // the read the product actually uses.
    const t = body(award, "get_package_tender");
    expect(t).toContain("v_sealed := p.bids_opened_at is null;");
    for (const f of [
      "b.price",
      "b.currency",
      "b.labour_hours",
      "b.assumed_productivity_factor",
      "b.duration_days",
      "b.qualifications",
      "b.price_basis",
    ]) {
      expect(t, `${f} is not gated on the seal`).toContain(
        `case when v_sealed then null else ${f} end`,
      );
    }
    // The evaluations are withheld too: an evaluation quotes the offer.
    expect(t).toContain("'evaluations', case when v_sealed then '[]'::jsonb");
  });

  it("keeps the price out of the audit ledger while the tender is open", () => {
    // audit_events is readable by the tenant, so a price legible there while
    // the tender is open is not sealed.
    const submit = body(tender, "submit_sealed_bid");
    const auditAt = submit.indexOf("insert into audit_events");
    expect(auditAt).toBeGreaterThan(-1);
    const auditRow = submit.slice(auditAt);
    expect(auditRow).not.toContain("v_price");
    expect(auditRow).toContain("'sealed', true");
  });

  it("refuses opening before the close, and a second opening", () => {
    const open = body(tender, "open_package_bids");
    expect(open).toContain("p.bids_close_at > now()");
    expect(open).toContain("An envelope is opened once");
    // REFUSAL-FIRST: an opened-and-empty tender is not an evaluated one.
    expect(open).toContain("There is nothing to open");
  });
});

describe("Slice 6A — a submitted bid is frozen and an evaluation is immutable", () => {
  const bidWall = body(tender, "enforce_sealed_bid_integrity");

  it("freezes every substantive column of a sealed bid", () => {
    for (const c of [
      "price",
      "labour_hours",
      "assumed_productivity_factor",
      "duration_days",
      "inclusions",
      "qualifications",
      "price_basis",
      "currency",
      "submitted_on",
      "supplier_id",
      "package_id",
      "sealed_at",
      "submitted_by",
    ]) {
      expect(bidWall, `${c} is editable after submission`).toContain(
        `new.${c} is distinct from old.${c}`,
      );
    }
  });

  it("covers INSERT, UPDATE and DELETE, and revokes TRUNCATE", () => {
    expect(trigger(tender, "trg_sealed_bid_integrity")).toContain(
      "before insert or update or delete",
    );
    expect(trigger(tender, "trg_sealed_bid_no_truncate")).toContain(
      "before truncate",
    );
    expect(tender).toContain(
      "revoke truncate on table public.contract_bids from anon, authenticated, service_role;",
    );
    expect(bidWall).toContain("withdrawn, never deleted");
  });

  it("makes an evaluation immutable — no update, no delete", () => {
    const evalWall = body(tender, "enforce_bid_evaluation_integrity");
    expect(evalWall).toContain("A recorded evaluation is FROZEN");
    expect(evalWall).toContain("A recorded evaluation is not deleted");
    expect(trigger(tender, "trg_bid_evaluation_integrity")).toContain(
      "before insert or update or delete",
    );
    // One technical and one commercial per bid is a SCHEMA fact, so a re-score
    // cannot be inserted even by a caller that reaches the table.
    expect(table(tender, "bid_evaluations")).toContain(
      "unique (bid_id, evaluation_kind)",
    );
  });

  it("refuses an evaluation before the envelope is open, at the table", () => {
    const evalWall = body(tender, "enforce_bid_evaluation_integrity");
    expect(evalWall).toContain("p.bids_opened_at is null");
    expect(evalWall).toContain("have not been opened");
  });
});

describe("Slice 6A — separation of duties is enforced in BOTH directions", () => {
  it("refuses an evaluation written by the package's awarder", () => {
    const evalWall = body(tender, "enforce_bid_evaluation_integrity");
    expect(evalWall).toContain("p.awarded_by = new.evaluator_id");
    // …and the bidder's own submitter cannot score their own offer.
    expect(evalWall).toContain("b.submitted_by = new.evaluator_id");
  });

  it("refuses an award by somebody who evaluated any bid on the package", () => {
    const sod = body(tender, "enforce_award_separation_of_duties");
    expect(sod).toContain("from bid_evaluations e");
    expect(sod).toContain("e.evaluator_id = new.awarded_by");
    // BOTH OPERATIONS. A check on INSERT alone is dodged by inserting the
    // package unawarded and updating it; on UPDATE alone, by inserting it
    // already awarded.
    expect(trigger(tender, "trg_award_separation_of_duties")).toContain(
      "before insert or update",
    );
  });

  it("names the separation at the award door as well as at the table", () => {
    const fn = body(award, "award_contract");
    expect(fn).toContain("from bid_evaluations e");
    expect(fn).toContain("e.evaluator_id = auth.uid()");
  });
});

describe("Slice 6A — §70: four acts, four walls, every writer", () => {
  const wall = body(pkg, "enforce_procurement_act_is_human");

  it("names all four forbidden acts in the refusal", () => {
    expect(wall).toContain("opens a sealed bid");
    expect(wall).toContain("scores a bid");
    expect(wall).toContain("awards a contract");
    expect(wall).toContain("approves a commitment");
  });

  it("raises when bound to a column the table does not have", () => {
    // `to_jsonb(new)->>'<missing column>'` is NULL rather than an error, so a
    // rename would switch §70 off while the trigger stayed present.
    expect(wall).toContain("if not (to_jsonb(new) ? v_col) then");
  });

  it("binds every actor column in the slice, on INSERT and UPDATE", () => {
    const bindings: [string, string, string][] = [
      [pkg, "trg_procurement_opener_is_human", "bids_opened_by"],
      [pkg, "trg_procurement_awarder_is_human", "awarded_by"],
      [tender, "trg_bid_evaluator_is_human", "evaluator_id"],
      [award, "trg_commitment_approver_is_human", "approved_by"],
    ];
    for (const [src, name, column] of bindings) {
      const t = trigger(src, name);
      expect(t, `${name} must cover INSERT and UPDATE`).toContain(
        "before insert or update",
      );
      expect(t).toContain("enforce_procurement_act_is_human");
      expect(t).toContain(`'${column}'`);
    }
  });

  it("refuses the AI-operator identity at every door by name", () => {
    for (const fn of [
      "open_package_bids",
      "record_bid_evaluation",
      "award_contract",
      "approve_contract_commitments",
    ]) {
      const src =
        fn.startsWith("open_") || fn.startsWith("record_bid") ? tender : award;
      expect(body(src, fn), `${fn} does not refuse ai_admin`).toContain(
        "= 'ai_admin'",
      );
    }
  });
});

describe("Slice 6A — the award is authority-bearing", () => {
  const authority = body(award, "sync_contract_award_authority");

  it("reads the ONE store with the org-node scope rule", () => {
    expect(authority).toContain("from authority_limits al");
    expect(authority).toContain("al.action_type = 'contract_award'");
    expect(authority).toContain("al.status = 'adopted'");
    expect(authority).toContain("org_ancestry(p_org)");
  });

  it("refuses absence and refuses a null ceiling", () => {
    expect(authority).toContain("no adopted contract-award delegation exists");
    expect(authority).toContain("l.max_commitment_usd is null");
    expect(authority).toContain("not an unlimited one");
  });

  it("refuses a cross-currency comparison rather than converting", () => {
    expect(authority).toContain("l.max_commitment_currency");
    expect(authority).toContain("Sync holds no exchange rate");
  });

  it("is not callable by ANY client role", () => {
    // It takes an organization as an argument, so a direct client call would
    // read another tenant's adopted delegation (the sync_change_authority
    // posture, stated on day one).
    expect(award).toContain(
      "revoke all on function public.sync_contract_award_authority(uuid, text, numeric, text, uuid, uuid)\n  from public, anon, authenticated, service_role;",
    );
    expect(award).not.toMatch(
      /grant execute on function public\.sync_contract_award_authority/,
    );
  });

  it("extends the 4D money rules by transformation, never by re-typing", () => {
    expect(award).toContain("pg_get_functiondef");
    expect(award).toContain(
      "'adopt_authority_limit', 'state_authority_ceiling'",
    );
    expect(award).toContain(
      "$new$('contingency_drawdown','change_approval','contract_award')$new$",
    );
    expect(award).toContain("do not extend an authority rule blind");
    // The delegation SCREEN reads the same rule, or the screen and the door
    // disagree about whether a self-adoption is permitted.
    expect(award).toContain("get_authority_delegations");
  });

  it("records a security event when an award is refused for want of authority", () => {
    const fn = body(award, "award_contract");
    expect(fn).toContain("insert into security_events");
    expect(fn).toContain("Contract award on package");
  });
});

describe("Slice 6A — the award's own refusals", () => {
  const fn = body(award, "award_contract");

  it("REFUSES over zero bids rather than reporting an evaluation of none", () => {
    expect(fn).toContain("There is nothing to award");
    expect(fn).toContain("not a package whose bids were evaluated");
    expect(fn).not.toContain("0 bids evaluated");
  });

  it("names the missing evaluation kind rather than awarding on one", () => {
    expect(fn).toContain("unnest(sync_bid_evaluation_kinds()) k");
    expect(fn).toContain("has no %s evaluation");
  });

  it("refuses a bid an evaluation called non-compliant", () => {
    expect(fn).toContain("e.outcome = 'non_compliant'");
  });

  it("refuses before the envelope is opened and refuses a second award", () => {
    expect(fn).toContain("p.bids_opened_at is null");
    expect(fn).toContain("An award is made once");
  });
});

describe("Slice 6A — §24 is all-or-none, at the schema", () => {
  it("holds every §24 field on an awarded package for every writer", () => {
    expect(award).toContain("contract_package_section24_complete");
    for (const f of [
      "contract_type is not null",
      "contract_currency is not null",
      "awarded_value is not null",
      "contract_start_date is not null",
      "contract_completion_date is not null",
    ]) {
      expect(award, `${f} missing from the §24 constraint`).toContain(f);
    }
    expect(award).toContain("performance_requirements, ''");
  });

  it("keeps the warranty leg as a REFERENCE to warranty_terms", () => {
    // Overlap-map ruling 13: warranty_terms stays the vendor-warranty leg.
    // Copying the terms onto contract_packages would be the second warranty
    // model.
    expect(pkg).toContain("warranty_term_id bigint");
    expect(pkg).toContain("references warranty_terms(id)");
    expect(joined).not.toMatch(/add column if not exists warranty_period/);
  });

  it("refuses non-finite and negative money at the column", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so `>= 0` alone
    // does not keep NaN out — and NaN turns every downstream sum into NaN.
    expect(pkg).toContain("awarded_value <> 'NaN'::numeric");
    expect(pkg).toContain("awarded_value >= 0");
    expect(tender).toContain("price <> 'NaN'::numeric");
    expect(award).toContain("amount <> 'NaN'::numeric");
  });
});

describe("Slice 6A — the commitment feeds Slice 4's ONE cost model", () => {
  const approve = body(award, "approve_contract_commitments");

  it("makes project_cost_items.commitment SINGLE-WRITER, not just single-total", () => {
    // THE ASSERTION THAT USED TO STAND HERE — `not.toMatch(/create
    // table[^;]*commitment_totals/)` under the comment "no second commitment
    // total is kept anywhere in this slice" — could only reject a table
    // literally NAMED `commitment_totals`, and was structurally incapable of
    // catching the defect that was actually shipped: a second WRITER of the
    // same column. approve_contract_commitments set it from the approved
    // contract lines while record_cost_item (20261130090200) set it
    // unconditionally on every revise, with an omitted key parsing to NULL —
    // so a cosmetic description edit through the Controls surface wiped a
    // posted 640,000 while the contract still reported it as posted, and there
    // was no repair path through the product. Register row D6.05's claim was
    // true of TOTALS and false of WRITERS, which is the property that matters.
    expect(award).toContain(
      "create or replace function public.enforce_cost_item_contract_commitment()",
    );
    const wall = body(award, "enforce_cost_item_contract_commitment");
    // An omitted value is not a clearance…
    expect(wall).toContain("new.commitment := v_committed");
    // …and a STATED disagreement is refused by name rather than silently
    // losing to whichever writer ran last.
    expect(wall).toContain("of APPROVED contract commitment from contract");
    expect(wall).toContain("approved_at is not null");
    // A cost line no contract commits against is left entirely to Slice 4A.
    expect(wall).toContain("if v_committed is null then");
    const trg = trigger(award, "trg_cost_item_contract_commitment");
    expect(trg).toContain("before update on public.project_cost_items");
    expect(trg).toContain("for each row");
  });

  it("writes onto project_cost_items.commitment through record_cost_item's own door", () => {
    expect(approve).toContain("update project_cost_items set commitment");
    expect(approve).toContain(
      "set_config('app.cost_item_write', 'granted', true)",
    );
    // No second commitment total is kept anywhere in this slice.
    expect(joined).not.toMatch(/create table[^;]*commitment_totals/);
  });

  it("refuses through the ONE total predicate, not a second one", () => {
    expect(approve).toContain("contract_commitment_position(p.id)");
    const position = body(award, "contract_commitment_position");
    expect(position).toContain("not a commitment of zero");
    expect(position).toContain("carry no agreed amount");
    expect(position).toContain("different currencies");
  });

  it("names the unpriced lines rather than summing the priced ones", () => {
    const position = body(award, "contract_commitment_position");
    expect(position).toContain("string_agg(line_ref");
    expect(position).toContain("understates it by exactly the amount");
    // The refusing branches return a NULL total, never a partial sum.
    expect(position).toContain("'total', null");
  });

  it("keeps an unagreed price NULL rather than zero", () => {
    const line = body(award, "record_contract_commitment_line");
    expect(line).toContain("omitted entirely if the price is not yet agreed");
    expect(table(award, "contract_commitment_lines")).toContain(
      "amount numeric,",
    );
  });

  it("refuses self-approval and a commitment above the contract value", () => {
    expect(approve).toContain("recorded_by = auth.uid()");
    expect(approve).toContain("Approving your own commitment lines");
    expect(approve).toContain("overCommitted");
  });

  it("binds the commitment to the contract's OWN case and currency", () => {
    const wall = body(award, "enforce_commitment_line_integrity");
    expect(wall).toContain("ci.development_case_id <> p.development_case_id");
    expect(wall).toContain("new.currency is distinct from ci.currency");
  });

  it("lets a case be torn down without leaving the commitment undeletable", () => {
    // THE DEFECT THIS CLAUSE EXISTS FOR: with `on delete restrict` on
    // cost_item_id, deleting a development case cascaded to
    // project_cost_items and to contract_packages at once and the RESTRICT
    // reached first aborted the whole delete — making any case with a contract
    // permanently undeletable. The constraint cascades and the WALL refuses,
    // with a mid-cascade escape that includes the case itself being gone.
    expect(award).toContain(
      "cost_item_id uuid not null references project_cost_items(id) on delete cascade",
    );
    const wall = body(award, "enforce_commitment_line_integrity");
    expect(wall).toContain(
      "join development_cases dc on dc.id = p2.development_case_id",
    );
    expect(wall).toContain("committed money that no contract explains");
  });
});

describe("Slice 6A — every new table is org-scoped, walled and untruncatable", () => {
  const tables: [string, string][] = [
    [tender, "package_bidders"],
    [tender, "bid_evaluations"],
    [award, "contract_commitment_lines"],
  ];

  it("stamps the organization and enables RLS in the SAME migration", () => {
    for (const [src, name] of tables) {
      const t = table(src, name);
      expect(t, `${name} is not org-stamped`).toContain(
        "organization_id uuid not null references organizations(id) on delete cascade",
      );
      expect(src).toContain(
        `alter table public.${name} enable row level security`,
      );
      expect(src).toContain(
        `for select to authenticated using (organization_id = app_current_org())`,
      );
    }
  });

  it("gives no client a write policy — mutation is definer-RPC only", () => {
    for (const [src, name] of tables) {
      expect(src).not.toMatch(
        new RegExp(
          `create policy [\\w_]+ on public\\.${name}\\s+for (insert|update|delete|all)`,
        ),
      );
    }
  });

  it("revokes TRUNCATE and installs a statement guard on every ledger", () => {
    for (const name of [
      "contract_packages",
      "contract_bids",
      "package_bidders",
      "bid_evaluations",
      "contract_commitment_lines",
    ]) {
      expect(joined, `${name} keeps TRUNCATE`).toContain(
        `revoke truncate on table public.${name}`,
      );
    }
    for (const [src, name] of [
      [pkg, "trg_procurement_package_no_truncate"],
      [tender, "trg_sealed_bid_no_truncate"],
      [tender, "trg_bid_evaluation_no_truncate"],
      [award, "trg_commitment_line_no_truncate"],
    ] as [string, string][]) {
      expect(trigger(src, name)).toContain("before truncate");
      expect(trigger(src, name)).toContain("for each statement");
    }
  });

  it("carries a provenance backstop for the writes it ADMITS", () => {
    // The other half of the convention: the writes that reach a table WITHOUT
    // going through a definer RPC must leave something to find.
    expect(pkg).toContain("record_procurement_service_write");
    for (const src of [pkg, tender, award]) {
      expect(src).toContain("record_procurement_service_write(");
    }
    // …and never on a refusing path (4D-R33).
    expect(pkg).toContain("Never called on a refusing path");
  });

  it("refuses a client-shaped write outright, not merely a status change", () => {
    // A signed-in caller reaching one of these tables at all has bypassed RLS
    // (there is no client write policy on any of them), so it is REFUSED
    // rather than recorded — the enforce_cost_item_coding posture. The first
    // draft only refused a §25 status change and recorded everything else,
    // which left a package that could be born mandatory, opened or awarded by
    // any RLS-bypassing writer holding a session.
    expect(body(pkg, "enforce_procurement_package_integrity")).toContain(
      "bypassing row-level security",
    );
    expect(body(tender, "enforce_sealed_bid_integrity")).toContain(
      "bypassing row-level security",
    );
  });

  it("uses auth.uid() for the dual-caller gate, never current_user", () => {
    for (const fn of [
      "enforce_procurement_package_integrity",
      "enforce_sealed_bid_integrity",
      "enforce_bid_evaluation_integrity",
    ]) {
      const src = fn.includes("package") ? pkg : tender;
      expect(body(src, fn)).toContain("auth.uid() is not null");
    }
    expect(body(award, "enforce_commitment_line_integrity")).toContain(
      "auth.uid() is not null",
    );
  });
});

describe("Slice 6A — the mutations are audited with both states", () => {
  it("writes an audit_events row carrying previous_state and new_state", () => {
    for (const [src, fn] of [
      [pkg, "record_procurement_package"],
      [pkg, "set_procurement_package_status"],
      [pkg, "record_package_delivery_forecast"],
      [tender, "invite_package_bidder"],
      [tender, "open_package_bidding"],
      [tender, "submit_sealed_bid"],
      [tender, "withdraw_sealed_bid"],
      [tender, "open_package_bids"],
      [tender, "record_bid_evaluation"],
      [award, "award_contract"],
      [award, "record_contract_commitment_line"],
      [award, "approve_contract_commitments"],
    ] as [string, string][]) {
      const b = body(src, fn);
      expect(b, `${fn} writes no audit row`).toContain(
        "insert into audit_events",
      );
      expect(b, `${fn} omits previous_state/new_state`).toContain(
        "previous_state, new_state",
      );
    }
  });

  it("keeps every mutation behind a role check", () => {
    for (const [src, fn] of [
      [pkg, "record_procurement_package"],
      [pkg, "set_procurement_package_status"],
      [pkg, "record_package_delivery_forecast"],
      [tender, "invite_package_bidder"],
      [tender, "open_package_bidding"],
      [tender, "submit_sealed_bid"],
      [tender, "withdraw_sealed_bid"],
      [tender, "open_package_bids"],
      [tender, "record_bid_evaluation"],
      [award, "award_contract"],
      [award, "record_contract_commitment_line"],
      [award, "approve_contract_commitments"],
      [award, "compute_case_procurement_position"],
    ] as [string, string][]) {
      const b = body(src, fn);
      expect(b, `${fn} has no role check`).toMatch(
        /select role into v_role from user_profiles where id = auth\.uid\(\)/,
      );
      expect(b, `${fn} has no org gate`).toContain(
        "v_org uuid := app_current_org()",
      );
    }
  });

  it("narrows the two money acts to management and executive roles", () => {
    // A planner or an engineer holds no contract-award delegation, so offering
    // them the act would put the refusal after the intent.
    for (const fn of ["award_contract", "approve_contract_commitments"]) {
      expect(body(award, fn)).toContain(
        "not in ('admin','executive','maintenance_manager')",
      );
    }
  });
});

describe("Slice 6A — the read refuses before it reports", () => {
  const readFn = body(award, "get_case_procurement");

  it("REFUSES over an empty package set rather than reporting zero late", () => {
    expect(readFn).toContain("coalesce(v_total, 0) = 0");
    expect(readFn).toContain("nothing is late");
    expect(readFn).toContain("'answered', false");
  });

  it("names every mandatory package it cannot assess", () => {
    expect(readFn).toContain("mandatoryNotAssessable");
    expect(readFn).toContain("cannot be assessed for lateness");
    expect(readFn).toContain("notAssessableReason");
  });

  it("returns ALL FOUR §25 dimensions on every package", () => {
    for (const d of PROCUREMENT_STATUS_DIMENSIONS) {
      expect(readFn).toContain(`'${d}', p.${d}_status`);
    }
  });

  it("reads its blockers from the ONE predicate, not from the package list", () => {
    expect(readFn).toContain("case_procurement_gate_obligations(c.id, null)");
  });

  it("records a lineage run INCLUDING on the refusing path", () => {
    const compute = body(award, "compute_case_procurement_position");
    expect(compute).toContain("record_calculation_run(");
    // Two call sites: one for the refusal, one for the answer.
    expect(compute.split("record_calculation_run(").length - 1).toBe(2);
    expect(compute).toContain("v_refusals");
    // A contract whose commitment total refused is carried as a refusal rather
    // than counted as zero.
    expect(compute).toContain("v_pkg->'commitment'->>'refusal'");
  });

  it("passes input_refs as an ARRAY, which the ledger's CHECK demands", () => {
    const compute = body(award, "compute_case_procurement_position");
    expect(compute).toContain(
      "jsonb_build_array(\n        jsonb_build_object('table', 'contract_packages'",
    );
    expect(compute).toContain(
      "jsonb_build_object('table', 'project_cost_items'",
    );
  });
});

describe("Slice 6A — the migration text keeps its own house rules", () => {
  it("reloads PostgREST's schema cache in every file", () => {
    for (const f of SLICE_FILES) {
      expect(raw(f)).toContain("notify pgrst, 'reload schema'");
    }
  });

  it("adds every contract_packages column in the file that guards them", () => {
    // A trigger created in 20261208090000 that reads a column added in
    // 20261208090200 raises `record "old" has no field ...` for every delete in
    // between: PL/pgSQL resolves record fields at run time and nothing catches
    // it at creation.
    for (const c of [
      "bids_close_at",
      "bids_opened_at",
      "bids_opened_by",
      "awarded_at",
      "awarded_by",
      "contract_type",
      "warranty_term_id",
    ]) {
      expect(
        pkg,
        `${c} is added outside the file whose guard reads it`,
      ).toContain(`add column if not exists ${c}`);
    }
  });

  it("pairs every actor/timestamp column with TWO equalities, not one", () => {
    // Folded into a single equality against a conjunction,
    // `opened_at = now(), opened_by = null` passes — and the actor column is
    // exactly what the §70 wall reads, where a NULL actor is an early return.
    expect(pkg).toContain(
      "(bids_opened_at is null) = (bids_opened_by is null)",
    );
    expect(pkg).toContain("(awarded_at is null) = (awarded_by is null)");
    expect(award).toContain("(approved_at is null) = (approved_by is null)");
    expect(award).toContain("(approved_at is null) = (approval_note is null)");
  });

  it("states a basis or a rationale on every judgement it records", () => {
    expect(pkg).toContain("mandatory_basis, 20 characters minimum");
    expect(pkg).toContain("basis, 10 characters minimum");
    expect(tender).toContain("rationale, 20 characters minimum");
    expect(award).toContain("award_basis, 20 characters minimum");
  });

  it("never hardcodes an organization or a user id", () => {
    expect(rawJoined).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * THE ADVERSARIAL PASS.
 *
 * Each clause below is a defect that was PROVEN LIVE against this slice's own
 * migrations after they passed a green transcript. They are the ones whose
 * return would not show up as a failing smoke step — a marker left granted, a
 * ceiling that only counts one contract at a time, a wall bound to a table
 * that quietly loses its triggers.
 * ──────────────────────────────────────────────────────────────────────── */
describe("Slice 6A — the award is FROZEN once decided, for every caller", () => {
  const wall = body(pkg, "enforce_procurement_package_integrity");

  it("refuses every change to the award record on an awarded row", () => {
    // ONE GAP, THREE DEFECTS. award_contract read the package without FOR
    // UPDATE and re-checked nothing on the UPDATE, so two overlapping
    // transactions each returned a full success payload and two suppliers were
    // each told they had won at their own price; a service caller rewrote
    // awarded_value 640000 -> 1 with the commitments still posted at 640000;
    // and awarded_at -> NULL re-opened the package for a SECOND award under a
    // possibly lower ceiling. This is the 4D-R17 rule applied to the contract.
    expect(wall).toContain("tg_op = 'UPDATE' and old.awarded_at is not null");
    for (const col of [
      "awarded_at",
      "awarded_by",
      "awarded_bid_id",
      "awarded_supplier_id",
      "awarded_value",
      "contract_currency",
      "contract_type",
      "contract_start_date",
      "contract_completion_date",
      "performance_requirements",
      "award_basis",
      "award_authority_limit_id",
    ]) {
      expect(wall).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(wall).toContain("is FROZEN for every caller");
  });

  it("locks the row in the door so the second caller reads a sentence", () => {
    const door = body(award, "award_contract");
    const at = door.indexOf(
      "select * into p from contract_packages\n   where id = p_package_id and organization_id = v_org\n   for update;",
    );
    expect(at, "award_contract does not lock the package row").toBeGreaterThan(
      -1,
    );
  });

  it("names the supplier delete instead of dumping the contract row", () => {
    // `awarded_supplier_id` carries ON DELETE SET NULL from before this slice,
    // so deleting the winning supplier arrived as an UPDATE and died on a raw
    // CHECK violation whose DETAIL printed scope_of_work, award_basis,
    // performance_requirements and awarded_value into the error text.
    expect(wall).toContain("holds the award on package");
    expect(wall).toContain(
      "not exists (select 1 from suppliers where id = old.awarded_supplier_id)",
    );
  });

  it("holds 'an award names the offer it accepts' at the SCHEMA", () => {
    expect(pkg).toContain("contract_package_award_bid");
    expect(pkg).toContain("awarded_at is null or awarded_bid_id is not null");
  });

  it("records what was actually there before, never a hard-coded null", () => {
    const door = body(award, "award_contract");
    expect(door).toContain("'awarded_at', p.awarded_at");
    expect(door).not.toContain("jsonb_build_object('awarded_at', null");
  });

  it("refuses a winning bid that states no currency", () => {
    // contract_bids.currency is nullable and every pre-6A row carries NULL,
    // and the ceiling's currency gate is `if p_currency is not null and …` —
    // so a NULL-currency bid skipped it and was compared as a bare number.
    const door = body(award, "award_contract");
    expect(door).toContain("b.currency is null or btrim(b.currency) = ''");
    expect(door).toContain("states no currency");
  });
});

describe("Slice 6A — the delegation ceiling is cumulative (4D-R8)", () => {
  const authority = body(award, "sync_contract_award_authority");

  it("aggregates this awarder's prior awards on the same case", () => {
    // One maintenance_manager under a single adopted CAD 750,000 delegation
    // awarded 640,000 + 640,000 + 200,000 on ONE case, every award
    // individually "within authority". sync_contingency_authority already
    // carries the reasoning verbatim: a delegation ceiling that can be
    // defeated by pressing the button twice is not a ceiling.
    expect(authority).toContain("p_case_id");
    expect(authority).toContain("p_awarder");
    expect(authority).toContain("sum(cp.awarded_value)");
    expect(authority).toContain("cp.awarded_by = p_awarder");
    expect(authority).toContain(
      "v_committed + v_magnitude > l.max_commitment_usd",
    );
    expect(authority).toContain("not what you may commit per contract");
    // Awards in another currency are EXCLUDED from the sum, never converted.
    expect(authority).toContain(
      "cp.contract_currency is not distinct from l.max_commitment_currency",
    );
  });

  it("is passed the case and the awarder by the award door", () => {
    const door = body(award, "award_contract");
    expect(door).toContain(
      "sync_contract_award_authority(v_org, v_role, b.price, b.currency,",
    );
    expect(door).toContain("p.development_case_id, auth.uid()");
  });
});

describe("Slice 6A — money is never compared across currencies", () => {
  it("refuses a commitment total stated in a different unit from the contract", () => {
    // v_total is in the LINES' currency (forced to the cost item's) and
    // p.awarded_value is in the WINNING BID's, and nothing required them to be
    // equal: a CAD 640,000 contract carrying one USD 640,000 commitment line
    // reported `variance 0, overCommitted false`, and
    // approve_contract_commitments — which refuses on that same flag —
    // approved and posted it.
    const position = body(award, "contract_commitment_position");
    expect(position).toContain(
      "v_currency is distinct from p.contract_currency",
    );
    expect(position).toContain("Sync holds no exchange rate");
    // The refusal comes BEFORE the variance is computed.
    expect(
      position.indexOf("v_currency is distinct from p.contract_currency"),
    ).toBeLessThan(position.indexOf("'overCommitted'"));
  });

  it("refuses a case-wide committed total summed across currencies", () => {
    const compute = body(award, "compute_case_procurement_position");
    expect(compute).toContain("v_mixed");
    expect(compute).toContain("committedCurrency");
    expect(compute).toContain("more than one currency");
  });
});

describe("Slice 6A — the tender window and the bidder register", () => {
  it("refuses a close brought forward once a bid has arrived", () => {
    // There was no guard against re-issuing an already-issued package and none
    // that the new close was not earlier than the standing one, so a second
    // call collapsed a week-long window to one second: every remaining bidder
    // was refused as late and open_package_bids became available immediately.
    const open = body(tender, "open_package_bidding");
    expect(open).toContain("p_close_at < p.bids_close_at");
    expect(open).toContain("A close is extended, not shortened");
    // …and a re-issue is its OWN act in the ledger, not a second `issued`.
    expect(open).toContain("'reissued'");
  });

  it("refuses a withdrawal after the close", () => {
    // The function contained no reference to bids_close_at at all and refused
    // only after the OPEN act, so a bid could be pulled out of a CLOSED tender
    // in the window before the opening — and because one bidder holds one row
    // per package, that bidder could never re-lodge.
    const withdraw = body(tender, "withdraw_sealed_bid");
    expect(withdraw).toContain("p.bids_close_at <= now()");
    expect(withdraw).toContain("withdrawn before the close, not after it");
  });

  it("gives package_bidders the same wall as its four siblings", () => {
    // It shipped with ZERO triggers while every sibling had two or more: it
    // was truncatable, service-deletable with no security_events row, and a
    // row stamped with one tenant against another's package inserted cleanly
    // and was then READ by the foreign tenant.
    const wall = body(tender, "enforce_package_bidder_integrity");
    expect(wall).toContain("tg_op = 'TRUNCATE'");
    expect(wall).toContain("record_procurement_service_write");
    expect(wall).toContain("does not own its procurement package");
    expect(wall).toContain("names a supplier from another organization");
    expect(wall).toContain(
      "old.status in ('submitted', 'withdrawn', 'disqualified')",
    );
    const t = trigger(tender, "trg_package_bidder_integrity");
    expect(t).toContain(
      "before insert or update or delete on public.package_bidders",
    );
    const tr = trigger(tender, "trg_package_bidder_no_truncate");
    expect(tr).toContain("before truncate on public.package_bidders");
    expect(tr).toContain("for each statement");
  });

  it("refuses one person holding BOTH evaluations of a bid", () => {
    // `unique (bid_id, evaluation_kind)` was the only cross-evaluation rule,
    // so one evaluator recorded both scores and award_contract then treated
    // the bid as fully evaluated — the collapse this file's own header calls
    // "how a technically non-compliant bid wins on price".
    const wall = body(tender, "enforce_bid_evaluation_integrity");
    expect(wall).toContain("e.evaluation_kind <> new.evaluation_kind");
    expect(wall).toContain("e.evaluator_id = new.evaluator_id");
    expect(wall).toContain("separate judgements by separate people");
    // …and at the door, so the person reads a sentence.
    const door = body(tender, "record_bid_evaluation");
    expect(door).toContain("e.evaluation_kind <> v_kind");
    expect(door).toContain("e.evaluator_id = auth.uid()");
  });

  it("says what an empty bid list MEANS, in all three cases", () => {
    // `sealed := bids_opened_at is null` is also true of a package that was
    // never issued, so one that had never been to market came back
    // `sealed: true` under the note "The envelopes are sealed…" and the panel
    // rendered "Bids (SEALED)" over it. An empty array meant three different
    // things and returned the same confident `[]` for all three.
    const read = body(award, "get_package_tender");
    expect(read).toContain("v_tendered := p.bids_close_at is not null");
    expect(read).toContain("'sealed', v_sealed and v_tendered");
    expect(read).toContain("bidsRefusal");
    expect(read).toContain(
      "has not been issued for tender, so there are no envelopes",
    );
    expect(read).toContain("NO bid was ever lodged against it");
    // Content redaction stays on the CONSERVATIVE rule.
    expect(read).toContain("v_sealed := p.bids_opened_at is null");
  });

  it("tells the pre-existing /materials read what the seal withheld", () => {
    // get_package_bids is SECURITY INVOKER, so the narrowed cb_read policy now
    // hides sealed bids from it — and it returned a SHORT list with no
    // indication anything had been withheld, which compareBids then stated as
    // "No bids are recorded for this package".
    expect(tender).toContain("sync_sealed_bid_withheld_count");
    expect(tender).toContain("tenderSealed");
    expect(tender).toContain(
      "an empty one here is not a tender nobody entered",
    );
    // …edited by TRANSFORMATION of the live body, never re-typed.
    expect(tender).toContain("pg_get_functiondef");
    expect(tender).toContain("do not narrow a read blind");
  });
});

describe("Slice 6A — every write marker is cleared where it is used", () => {
  it("clears every marker it grants, in the same function", () => {
    // Granted before the door's own refusals and never cleared, a marker
    // opened the wall for the whole transaction: in one multi-statement
    // session a direct update that had just been REFUSED went through, and
    // record_procurement_service_write — the only thing that makes a
    // service-path write findable afterwards — went silent with it. Twelve
    // earlier migrations clear theirs; this slice now does too. Counted per
    // FUNCTION and per MARKER, because a two-branch write legitimately grants
    // twice and clears once after the branches rejoin.
    for (const [file, name] of [
      [pkg, PKG_FILE],
      [tender, TENDER_FILE],
      [award, AWARD_FILE],
    ] as const) {
      const fns = file.split("create or replace function public.").slice(1);
      for (const fn of fns) {
        const label = fn.slice(0, fn.indexOf("(")) || "?";
        const granted = new Set(
          [
            ...fn.matchAll(
              /set_config\('app\.([a-z_]+_write)', 'granted', true\)/g,
            ),
          ].map((m) => m[1]),
        );
        const cleared = new Set(
          [
            ...fn.matchAll(/set_config\('app\.([a-z_]+_write)', '', true\)/g),
          ].map((m) => m[1]),
        );
        for (const marker of granted) {
          expect(
            cleared.has(marker),
            `${name}: ${label} grants app.${marker} and never clears it`,
          ).toBe(true);
        }
      }
    }
  });

  it("grants the marker only AFTER the door's own refusals", () => {
    // The two that sat above a refusal: record_procurement_package's
    // awarded-package arm, and record_contract_commitment_line's approved-line
    // arm.
    const record = body(pkg, "record_procurement_package");
    expect(record.indexOf("is awarded. Its scope, exclusions")).toBeLessThan(
      record.indexOf("set_config('app.procurement_package_write', 'granted'"),
    );
    const line = body(award, "record_contract_commitment_line");
    expect(line.indexOf("was approved on %s and is frozen")).toBeLessThan(
      line.indexOf("set_config('app.commitment_line_write', 'granted'"),
    );
  });
});
