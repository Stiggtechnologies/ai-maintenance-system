/**
 * Sync Develop Slice 6B — migration contract (static, no database).
 *
 * Every sibling slice ships one of these, and 5D shipped without one: six
 * defects in its migration text got past a live transcript as a direct result.
 *
 * THIS CHUNK MOVES MONEY AND MAKES CLAIMS AGAINST SUPPLIERS, so the clauses
 * below are the ones whose absence would not show up as a failing transcript
 * step:
 *
 *   * a SECOND source of committed cost — the defect Slice 6A had to fix, and
 *     the one most likely to come back;
 *   * a change order that moves contract value WITHOUT the authority family
 *     the award used;
 *   * an invoice payable twice — through a duplicate row, a second payment, an
 *     un-payment, or a reused bank reference;
 *   * a claim editable after it is answered;
 *   * a warranty that never expires, or an expired one that keeps covering;
 *   * a vendor record averaged over nothing;
 *   * a §70 wall that loses its UPDATE branch.
 *
 * A later edit that re-opens one of those fails HERE, before it reaches a
 * database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  CHANGE_ORDER_STATUSES,
  CLAIM_DIRECTIONS,
  CLAIM_STATUSES,
  INVOICE_STATUSES,
  WARRANTY_CLAIM_STATUSES,
} from "../lib/develop/commercial";
import { INGEST_ENTITIES } from "../lib/ingest-entities";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const CHANGE_FILE = "20261209090000_develop_contract_change_order.sql";
const CLAIM_FILE = "20261209090100_develop_contract_claim_invoice.sql";
const WARRANTY_FILE = "20261209090200_develop_warranty_lifecycle.sql";
const VENDOR_FILE = "20261209090300_develop_vendor_quality_thread.sql";
const READ_FILE = "20261209090400_develop_commercial_read.sql";
const CONNECTOR_FILE =
  "20261209090500_develop_procurement_status_connector.sql";
const SLICE_FILES = [
  CHANGE_FILE,
  CLAIM_FILE,
  WARRANTY_FILE,
  VENDOR_FILE,
  READ_FILE,
  CONNECTOR_FILE,
];

const change = read(CHANGE_FILE);
const claim = read(CLAIM_FILE);
const warranty = read(WARRANTY_FILE);
const vendor = read(VENDOR_FILE);
const commercialRead = read(READ_FILE);
const connector = read(CONNECTOR_FILE);
const joined = SLICE_FILES.map(read).join("\n");
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

describe("Slice 6B — the migrations land after Slice 6A and nowhere else", () => {
  it("is numbered strictly after 20261208090200", () => {
    for (const f of SLICE_FILES) {
      expect(f.slice(0, 14) > "20261208090200").toBe(true);
    }
  });

  it("creates no second contract, cost, authority or requirement store", () => {
    // Overlap ruling 13: contract_packages IS the Contract, warranty_terms is
    // the warranty leg. Ruling D4.16: design_requirements is the ONE
    // requirement table. A parallel store here is what AGENTS invariant 1
    // forbids.
    expect(joined).not.toMatch(/create table[^;]*\bcontracts\b/);
    expect(joined).not.toMatch(/create table[^(]*\bauthority_\w*\s*\(/);
    expect(joined).not.toMatch(/create table[^;]*\bwarranties\b/);
    expect(joined).not.toMatch(/create table[^;]*\bvendor_quality/);
    expect(joined).not.toMatch(/create table[^;]*\bspecifications\b/);
    expect(joined).not.toMatch(/create table[^;]*\bcost_items\b/);
    // The warranty family GROWS the existing pair.
    expect(warranty).toContain("alter table public.warranty_terms");
    expect(warranty).toContain("alter table public.warranty_claims");
    // The vendor record grows the existing performance table.
    expect(vendor).toContain("alter table public.contract_performance");
  });
});

describe("committed cost keeps its single writer (Slice 6A's rule)", () => {
  it("nothing in this slice writes project_cost_items at all", () => {
    // 6A's enforce_cost_item_contract_commitment makes `commitment` derived
    // from the approved commitment lines. A second writer here — even a
    // well-meaning one posting a change order's value — is the defect that has
    // appeared in five consecutive chunks.
    expect(joined).not.toMatch(/update\s+project_cost_items/);
    expect(joined).not.toMatch(/insert\s+into\s+project_cost_items/);
    expect(joined).not.toMatch(/app\.cost_item_write/);
  });

  it("nothing re-implements the commitment total", () => {
    // contract_commitment_position is the ONE predicate, and the reads CALL
    // it. The one place this slice touches contract_commitment_lines directly
    // is decide_contract_change_order's refusal — it needs the APPROVED total
    // to say a reduction would go below it — and that is a read of a
    // different question, on a path that publishes no total.
    expect(commercialRead).toContain("contract_commitment_position(p.id)");
    expect(commercialRead).not.toMatch(/contract_commitment_lines/);
    expect(body(commercialRead, "contract_commercial_summary")).not.toMatch(
      /commitment/i,
    );
  });

  it("the commitment APPROVAL is serialized against the value it now reads", () => {
    // approve_contract_commitments compares the commitment total to
    // contract_current_value(), which a change order can MOVE. Unserialized, a
    // reduction reading zero approved commitment and an approval reading the
    // pre-reduction value both pass, leaving project_cost_items.commitment
    // above what the contract obliges — with the single-writer rule holding it
    // there and un-committing not being that door's act either.
    expect(change).toContain("proname = 'approve_contract_commitments'");
    expect(change).toContain("for update;  -- SLICE 6B");
    expect(change).toContain(
      "the package resolution of approve_contract_commitments was not found",
    );
  });

  it("the commitment position is TRANSFORMED, not retyped, and it raises when its anchor moved", () => {
    expect(change).toContain("pg_get_functiondef");
    expect(change).toContain("contract_commitment_position");
    expect(change).toContain("was not found in the shape Slice 6A left it");
    // A blind extension is refused rather than applied.
    expect(change).toMatch(
      /raise exception[\s\S]{0,400}re-derive this transformation/,
    );
  });

  it("the change order raises the CEILING and commits nothing itself", () => {
    const decide = body(change, "decide_contract_change_order");
    expect(decide).not.toMatch(/update\s+project_cost_items/);
    expect(decide).not.toMatch(/insert\s+into\s+project_cost_items/);
    expect(decide).toContain("commitmentNote");
    // ...and the note follows the SIGN: unconditional, it told the approver of
    // a de-scope that "the contract is now worth more".
    expect(decide).toContain("'commitmentNote', case when co.value_delta > 0");
    expect(decide).toContain("The contract is now worth less");
    // ...and it refuses a reduction below what is already committed, rather
    // than leaving the cost model explaining money no contract obliges.
    expect(decide).toContain("contract_commitment_lines");
    expect(decide).toContain("below what is already committed");
  });
});

describe("a change order routes through the SAME authority family the award used", () => {
  it("calls the ONE evaluator with the case and the actor", () => {
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain("sync_contract_award_authority(");
    expect(decide).toContain("p.development_case_id");
    expect(decide).toContain("auth.uid()");
    // No second evaluator anywhere in the slice.
    expect(joined).not.toMatch(
      /create or replace function public\.sync_\w*authority/,
    );
  });

  it("the cumulative ceiling learns about change orders by TRANSFORMATION", () => {
    // 4D-R8: a ceiling defeated by pressing the button twice is not a ceiling.
    // Splitting one growth across five change orders is the same hole through
    // a different door.
    expect(change).toContain("sync_contract_award_authority");
    expect(change).toContain("contract_change_orders co");
    expect(change).toContain("co.decided_by = p_awarder");
    expect(change).toContain("co.status = 'approved'");
    expect(change).toContain(
      "the cumulative-award subquery of sync_contract_award_authority was not found",
    );
  });

  it("refuses above the ceiling BY NAME and records a security event", () => {
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain("insert into security_events");
    expect(decide).toContain("v_auth->>'refusal'");
    expect(decide).toContain("'escalatesTo', v_auth->'escalatesTo'");
  });

  it("refuses a change order on a package outside every development case", () => {
    // The ceiling is measured per case; a change order on no case would be
    // checked against the per-change amount alone.
    expect(body(change, "record_contract_change_order")).toContain(
      "belongs to no development case",
    );
  });
});

describe("the money gates cannot be defeated by arithmetic or by racing", () => {
  it("the CUMULATIVE arm counts commitment MAGNITUDE, never a net that can go down", () => {
    // PROVEN LIVE before this was written. `sum(co.value_delta)` is signed, and
    // the award side attributes on cp.awarded_by while the change-order side
    // attributes on co.decided_by — different sets — so a de-scope approved on
    // a contract somebody ELSE awarded subtracted from a total it had never
    // been added to. With the running total at zero or below, 6A's
    // `v_committed > 0` short-circuit skipped the whole cumulative arm with
    // real history behind it. A manager holding a CAD 700,000 ceiling awarded
    // CAD 1,300,000 on one case by signing one -600,000 change order in
    // between; the response printed the tell itself,
    // "alreadyAwardedOnCase": -600000.
    expect(change).toContain("sum(greatest(co.value_delta, 0))");
    expect(change).not.toMatch(/sum\(co\.value_delta\)[^)]*into v_committed/);
  });

  it("a REDUCTION consumes no ceiling, and is not measured as if it committed", () => {
    // sync_contract_award_authority's first line is abs(p_value), which was
    // harmless while awarded_value >= 0 was the only input. Handed a signed
    // delta it measured a CAD 650,000 de-scope as a CAD 650,000 commitment and
    // refused it with a sentence stating the opposite of its own arithmetic:
    // "a further 650000 would take your total to 1300000", for an act that
    // took it to nothing. The gate and the accumulator now measure the same
    // thing.
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain(
      "sync_contract_award_authority(v_org, v_role, greatest(co.value_delta, 0),",
    );
  });

  it("the cumulative measure is SERIALIZED at both of its doors", () => {
    // PROVEN LIVE: two +40,000 change orders approved concurrently each read
    // alreadyCommittedOnCase = 650,000, each passed a CAD 700,000 ceiling, and
    // the contract stood at 730,000 — with BOTH rows recording
    // contract_value_before = 650,000, so the audit record the register cites
    // was falsified by the same race. The FOR UPDATE on the change-order row
    // only ever stopped one change order being decided twice.
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain(
      "select * into p from contract_packages where id = co.package_id for update",
    );
    expect(decide).toContain(
      "perform 1 from development_cases where id = p.development_case_id for update",
    );
    // The lock the CASE needs is spliced into award_contract too, by
    // transformation with its anchor asserted — two awards on two packages of
    // one case raced the identical measure.
    expect(change).toContain("proname = 'award_contract'");
    expect(change).toContain(
      "the authority read of award_contract was not found in the shape Slice 6A left it",
    );
    expect(change).toContain("for update;  -- the case, after the package");
  });

  it("a certification is serialized against its SIBLING invoices", () => {
    // PROVEN LIVE: two 400,000 invoices on a CAD 650,000 contract, certified
    // concurrently, each read certifiedTotal = 0 and each passed; both were
    // then payable through their own once-only walls, and CAD 800,000 left the
    // bank with un-paying refused for every caller so it could not be reversed.
    const certify = body(claim, "certify_contract_invoice");
    expect(certify).toContain(
      "select * into p from contract_packages where id = i.package_id for update",
    );
    // ...and the position is read AFTER that lock is held.
    expect(certify.indexOf("for update")).toBeLessThan(
      certify.indexOf("contract_invoice_position(p.id)"),
    );
  });

  it("a REDUCTION may not go below money already CERTIFIED, not only committed", () => {
    // PROVEN LIVE: a CAD 1,800,000 contract with no approved commitment lines,
    // 1,000,000 certified and PAID, reduced to 100,000 — leaving the ledger
    // explaining a payment no contract obliges. certify_contract_invoice
    // refuses to take the certified total ABOVE the contract value; nothing
    // stopped the value being moved DOWN underneath it.
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain(
      "from contract_invoices i where i.package_id = p.id",
    );
    expect(decide).toContain("v_floor := greatest(");
    expect(decide).toContain("v_floor > 0 and v_after < v_floor");
    expect(decide).toContain("CERTIFIED");
  });

  it("the approver may not be the person who SET the number", () => {
    // Keyed on recorded_by alone this was walked around in one step: the revise
    // branch rewrites value_delta and leaves recorded_by where it was, so a
    // second person raised somebody else's 1,000 draft to 400,000 and approved
    // it. PROVEN LIVE on the change order; the invoice carried the identical
    // shape.
    expect(table(change, "contract_change_orders")).toContain("last_priced_by");
    expect(table(claim, "contract_invoices")).toContain("last_priced_by");
    expect(table(claim, "contract_claims")).toContain("last_priced_by");
    const rec = body(change, "record_contract_change_order");
    expect(rec).toContain("last_priced_by = auth.uid()");
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain("co.last_priced_by = auth.uid()");
    expect(decide).toContain("neither recorded nor priced it");
    const certify = body(claim, "certify_contract_invoice");
    expect(certify).toContain("i.last_priced_by = auth.uid()");
    const answer = body(claim, "answer_contract_claim");
    expect(answer).toContain("c.last_priced_by = auth.uid()");
    // record_contract_invoice / record_contract_claim move it on a revise.
    expect(body(claim, "record_contract_invoice")).toContain(
      "last_priced_by = auth.uid()",
    );
    expect(body(claim, "record_contract_claim")).toContain(
      "last_priced_by = auth.uid()",
    );
  });

  it("the actor columns are FROZEN with the rest of the record", () => {
    // A frozen row whose recorded_by or last_priced_by can still move is a row
    // whose separation-of-duties evidence can be rewritten after the fact.
    for (const src of [change, claim]) {
      expect(src).toContain(
        "new.last_priced_by is distinct from old.last_priced_by",
      );
    }
    expect(change).toContain(
      "new.recorded_by is distinct from old.recorded_by",
    );
    expect(claim).toContain("new.raised_by is distinct from old.raised_by");
  });

  it("an approval may only cite an ADOPTED contract-award delegation of its own tenant", () => {
    // change_order_approval_record forces an approval to cite SOME
    // authority_limits row and the foreign key accepts any row in the table —
    // so a write reaching this table outside the door could cite another
    // tenant's delegation, a draft one, or a contingency ceiling, and the
    // approval would render as quoting an authority it never passed.
    const wall = body(change, "enforce_change_order_integrity");
    expect(wall).toContain("al.action_type = 'contract_award'");
    expect(wall).toContain("al.status = 'adopted'");
    expect(wall).toContain("al.organization_id = new.organization_id");
  });
});

describe("the change order itself", () => {
  const t = table(change, "contract_change_orders");

  it("refuses NaN and infinity at the constraint, not just at the door", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres and NaN <> 0 is
    // TRUE, so the `moves something` check alone does not keep it out.
    expect(t).toContain("value_delta <> 'NaN'::numeric");
    expect(t).toContain("value_delta > '-Infinity'::numeric");
    expect(t).toContain("value_delta < 'Infinity'::numeric");
  });

  it("refuses a change order that moves neither money nor time", () => {
    expect(t).toContain("value_delta <> 0 or time_delta_days <> 0");
  });

  it("keeps the decision actor and its note as TWO equalities, not a conjunction", () => {
    // Folded into one, `decided_at = now(), decided_by = null` passes — and
    // the actor column is exactly what the §70 wall reads, where a NULL actor
    // is an early return.
    expect(t).toContain("(decided_at is null) = (decided_by is null)");
    expect(t).toContain("(decided_at is null) = (decision_note is null)");
  });

  it("an approved change order quotes the ceiling it passed", () => {
    expect(t).toContain(
      "(status = 'approved') = (authority_limit_id is not null)",
    );
  });

  it("is FROZEN once decided, for every writer, on UPDATE", () => {
    const wall = body(change, "enforce_change_order_integrity");
    expect(wall).toContain("tg_op = 'UPDATE' and old.decided_at is not null");
    for (const col of [
      "value_delta",
      "currency",
      "time_delta_days",
      "status",
      "decided_by",
      "authority_limit_id",
      "contract_value_after",
    ]) {
      expect(wall, `frozen list is missing ${col}`).toContain(
        `new.${col} is distinct from old.${col}`,
      );
    }
  });

  it("covers INSERT, UPDATE, DELETE and TRUNCATE", () => {
    expect(trigger(change, "trg_change_order_integrity")).toContain(
      "before insert or update or delete",
    );
    expect(trigger(change, "trg_change_order_no_truncate")).toContain(
      "before truncate",
    );
    expect(change).toContain(
      "revoke truncate on table public.contract_change_orders",
    );
    const wall = body(change, "enforce_change_order_integrity");
    expect(wall).toContain("tg_op = 'TRUNCATE'");
    expect(wall).toContain("tg_op = 'DELETE'");
  });

  it("admits a mid-cascade delete so a development case stays deletable", () => {
    const wall = body(change, "enforce_change_order_integrity");
    expect(wall).toContain("from organizations where id = old.organization_id");
    expect(wall).toContain("join development_cases dc");
  });

  it("§70: the decision actor is human, on INSERT and UPDATE", () => {
    const trg = trigger(change, "trg_change_order_decider_is_human");
    expect(trg).toContain("before insert or update");
    expect(trg).toContain("enforce_procurement_act_is_human");
    expect(trg).toContain("'decided_by'");
    expect(body(change, "decide_contract_change_order")).toContain(
      "§70 human act",
    );
  });

  it("refuses self-approval, and a second decision", () => {
    const decide = body(change, "decide_contract_change_order");
    expect(decide).toContain("co.recorded_by = auth.uid()");
    expect(decide).toContain("A change order is decided once");
    expect(decide).toContain("for update");
  });

  it("its status vocabulary matches the TypeScript mirror exactly", () => {
    expect(checkList(change, "status").sort()).toEqual(
      [...CHANGE_ORDER_STATUSES].sort(),
    );
  });
});

describe("an invoice is not payable twice — four walls, not one", () => {
  const t = table(claim, "contract_invoices");

  it("1. the same supplier's invoice number exists once in the organization", () => {
    expect(claim).toContain(
      "create unique index if not exists idx_contract_invoice_ref",
    );
    expect(claim).toContain(
      "on contract_invoices(organization_id, supplier_id, lower(btrim(invoice_ref)))",
    );
    // ...and the door names the package the first one is on, because the
    // duplicate is usually lodged against a different one.
    expect(body(claim, "record_contract_invoice")).toContain(
      "is how the same invoice gets paid twice",
    );
  });

  it("2. a paid invoice is refused a second payment BY NAME", () => {
    const pay = body(claim, "record_invoice_payment");
    expect(pay).toContain("i.paid_at is not null");
    expect(pay).toContain("not payable a second time");
    expect(pay).toContain("i.payment_reference");
    expect(pay).toContain("for update");
  });

  it("3. un-paying is refused at the TABLE, for every caller", () => {
    const wall = body(claim, "enforce_contract_invoice_integrity");
    expect(wall).toContain("old.paid_at is not null");
    expect(wall).toContain("new.paid_at is distinct from old.paid_at");
    expect(wall).toContain(
      "new.payment_reference is distinct from old.payment_reference",
    );
    expect(wall).toContain("immutable for every caller");
  });

  it("4. one bank payment settles one invoice", () => {
    expect(claim).toContain(
      "create unique index if not exists idx_contract_invoice_payment_ref",
    );
    expect(claim).toContain("where paid_at is not null");
    expect(body(claim, "record_invoice_payment")).toContain(
      "One payment settles one invoice",
    );
  });

  it("the payment record is all-or-none, so a payment always names somebody", () => {
    expect(t).toContain("(paid_at is null) = (paid_by is null)");
    expect(t).toContain("(paid_at is null) = (payment_reference is null)");
  });

  it("only a CERTIFIED invoice is payable", () => {
    expect(body(claim, "record_invoice_payment")).toContain(
      "i.status <> 'certified'",
    );
  });

  it("an invoice is frozen once certified, and born neither certified nor paid", () => {
    const wall = body(claim, "enforce_contract_invoice_integrity");
    expect(wall).toContain("old.certified_at is not null");
    expect(wall).toContain(
      "new.gross_amount is distinct from old.gross_amount",
    );
    expect(wall).toContain(
      "new.certified_amount is distinct from old.certified_amount",
    );
    expect(wall).toContain("tg_op = 'INSERT'");
    expect(wall).toContain("received UNCERTIFIED and UNPAID");
  });

  it("certification cannot exceed the contract's CURRENT value", () => {
    const certify = body(claim, "certify_contract_invoice");
    expect(certify).toContain("contract_invoice_position(p.id)");
    expect(certify).toContain("v_certified + v_amount > v_value");
    expect(certify).toContain(
      "beyond what the contract obliges the owner to pay",
    );
    // ...read from the ONE position, so the ceiling and the screen agree.
    expect(body(claim, "contract_invoice_position")).toContain(
      "contract_current_value(p.id)",
    );
  });

  it("§70: certifying and paying are human acts at the table", () => {
    for (const [name, col] of [
      ["trg_contract_invoice_certifier_is_human", "'certified_by'"],
      ["trg_contract_invoice_payer_is_human", "'paid_by'"],
    ] as const) {
      const trg = trigger(claim, name);
      expect(trg).toContain("before insert or update");
      expect(trg).toContain(col);
    }
    expect(body(claim, "certify_contract_invoice")).toContain("§70 human act");
  });

  it("refuses self-certification by the person who entered the invoice", () => {
    expect(body(claim, "certify_contract_invoice")).toContain(
      "i.recorded_by is not null and i.recorded_by = auth.uid()",
    );
  });

  it("an empty invoice set REFUSES rather than reporting a confident zero", () => {
    const pos = body(claim, "contract_invoice_position");
    expect(pos).toContain("coalesce(v_count, 0) = 0");
    expect(pos).toContain('not "nothing outstanding"');
    expect(pos).toContain("v_currencies > 1");
  });

  it("its status vocabulary matches the TypeScript mirror exactly", () => {
    expect(checkList(t, "status").sort()).toEqual([...INVOICE_STATUSES].sort());
  });
});

describe("a claim is frozen once it is answered", () => {
  const t = table(claim, "contract_claims");

  it("the freeze covers every field the answer was given about", () => {
    const wall = body(claim, "enforce_contract_claim_integrity");
    expect(wall).toContain("tg_op = 'UPDATE' and old.answered_at is not null");
    for (const col of [
      "grounds",
      "claimed_value",
      "currency",
      "direction",
      "time_claimed_days",
      "status",
      "answered_by",
      "answer_note",
      "settled_value",
    ]) {
      expect(wall, `frozen list is missing ${col}`).toContain(
        `new.${col} is distinct from old.${col}`,
      );
    }
    expect(wall).toContain("FROZEN for every caller");
  });

  it("is never deleted, and is not truncatable", () => {
    const wall = body(claim, "enforce_contract_claim_integrity");
    expect(wall).toContain("tg_op = 'DELETE'");
    expect(wall).toContain("WITHDRAWN with a stated reason, never deleted");
    expect(claim).toContain("revoke truncate on table public.contract_claims");
    expect(trigger(claim, "trg_contract_claim_no_truncate")).toContain(
      "before truncate",
    );
  });

  it("§70: answering a claim is a human act at the door AND at the table", () => {
    expect(body(claim, "answer_contract_claim")).toContain("§70 human act");
    const trg = trigger(claim, "trg_contract_claim_answerer_is_human");
    expect(trg).toContain("before insert or update");
    expect(trg).toContain("'answered_by'");
  });

  it("refuses a second answer, and an answer by the person who raised it", () => {
    const answer = body(claim, "answer_contract_claim");
    expect(answer).toContain("A claim is answered once");
    expect(answer).toContain("c.raised_by = auth.uid()");
    expect(answer).toContain("for update");
  });

  it("keeps 'accepted' and 'partially accepted' distinguishable", () => {
    // A settlement below the claim recorded as "accepted" makes a negotiated
    // reduction indistinguishable from a claim paid in full, in every total.
    const answer = body(claim, "answer_contract_claim");
    expect(answer).toContain(
      "Accepting in full means settling at the amount claimed",
    );
    expect(answer).toContain("a partial acceptance settles it BELOW that");
    expect(t).toContain(
      "settled_value is null or settled_value <= claimed_value",
    );
  });

  it("does NOT move the contract's value by itself", () => {
    const answer = body(claim, "answer_contract_claim");
    expect(answer).not.toMatch(/update\s+contract_packages/);
    expect(answer).not.toMatch(/insert into contract_change_orders/);
    expect(answer).toContain("The contract is NOT changed by it");
  });

  it("its vocabularies match the TypeScript mirrors exactly", () => {
    expect(checkList(t, "status").sort()).toEqual([...CLAIM_STATUSES].sort());
    expect(checkList(t, "direction").sort()).toEqual(
      [...CLAIM_DIRECTIONS].sort(),
    );
  });
});

describe("a warranty must expire, and an expired one stops covering", () => {
  it("the write path REFUSES a term with no stated expiry", () => {
    const rec = body(warranty, "record_warranty_term");
    expect(rec).toContain("v_ends is null and v_limit is null");
    expect(rec).toContain("A warranty term with no stated expiry is refused");
  });

  it("the ONE cover predicate refuses such a term rather than answering covered", () => {
    const cover = body(warranty, "warranty_cover_position");
    expect(cover).toContain("w.ends_on is null and w.usage_limit is null");
    expect(cover).toContain("silently permanent cover");
    expect(cover).toContain("'answered', false");
  });

  it("an expired term answers covered=false and names the days missed", () => {
    const cover = body(warranty, "warranty_cover_position");
    expect(cover).toContain("p_on > w.ends_on");
    expect(cover).toContain("'expiredByDays', p_on - w.ends_on");
    expect(cover).toContain("does not keep covering quietly");
  });

  it("a usage-limited term with no reading refuses that leg", () => {
    const cover = body(warranty, "warranty_cover_position");
    expect(cover).toContain("w.usage_limit is not null");
    expect(cover).toContain("p_usage is null");
    expect(cover).toContain("'usageAssessed', false");
  });

  it("every door and every read uses that ONE predicate", () => {
    expect(body(warranty, "raise_warranty_claim")).toContain(
      "warranty_cover_position(w.id, v_failure, v_usage)",
    );
    expect(commercialRead).toContain(
      "warranty_cover_position(w.id, current_date, null)",
    );
    // The case-screen summary asks the PREDICATE per term rather than
    // comparing dates itself. Written as `ends_on < current_date` the counts
    // were a second expiry arithmetic AND wrong in the way a second one always
    // is: a usage-limited term past its limit fell into neither bucket, so an
    // exhausted warranty rendered as a live one.
    const summary = body(commercialRead, "contract_commercial_summary");
    expect(summary).toContain(
      "warranty_cover_position(w.id, current_date, null)",
    );
    expect(summary).toContain("'warrantyNotAssessable'");
    expect(summary).not.toContain("ends_on < current_date");
    expect(summary).not.toContain("ends_on is null and usage_limit is null");
  });

  it("NO file in the slice compares an expiry date itself — the READ included", () => {
    // The earlier form of this assertion excluded the commercial read, which is
    // exactly where the second arithmetic was living.
    const every = [change, claim, vendor, commercialRead, connector].join("\n");
    expect(every).not.toMatch(/ends_on\s*[<>]\s*current_date/);
    expect(every).not.toMatch(/ends_on\s*[<>]\s*p_on/);
    // warranty_cover_position is the only place either comparison may appear.
    const coverOnly = body(warranty, "warranty_cover_position");
    expect(coverOnly).toContain("p_on > w.ends_on");
  });

  it("the CLIENT holds no expiry arithmetic either", () => {
    // `warrantyCover` in src/lib/develop/commercial.ts was a full second copy
    // of this predicate and it GATED the raise-claim button, so it decided
    // rather than described — and it had already diverged from the server on a
    // non-finite usage reading (NaN refused in TypeScript; NULL, i.e. "no
    // reading supplied", at the door). The migration comment claims there is
    // no second expiry arithmetic anywhere; this is the half of that claim no
    // SQL assertion can reach.
    const lib = readFileSync("src/lib/develop/commercial.ts", "utf8");
    expect(lib).not.toContain("export function warrantyCover");
    expect(lib).not.toMatch(/Date\.UTC/);
    expect(lib).not.toMatch(/new Date\(/);
    const panel = readFileSync(
      "src/components/develop/CommercialPanels.tsx",
      "utf8",
    );
    expect(panel).not.toContain("warrantyCover(");
    // What the screen may still do is close the control over the ONE branch
    // the server refuses for every date — two null checks, no arithmetic.
    expect(panel).toContain("warrantyTermStatesNoExpiry");
  });

  it("a claim raised outside cover is refused in the predicate's own words", () => {
    const rz = body(warranty, "raise_warranty_claim");
    expect(rz).toContain("(v_cover->>'covered')::boolean is not true");
    expect(rz).toContain("v_cover->>'reason'");
  });

  it("the claim window is a SECOND fact, and time_barred has a writer", () => {
    expect(body(warranty, "raise_warranty_claim")).toContain(
      "w.claim_window_days",
    );
    const submit = body(warranty, "submit_warranty_claim");
    expect(submit).toContain("'time_barred'");
    expect(submit).toContain("The cover was real");
  });

  it("a term is frozen once claims are admitted under it", () => {
    const wall = body(warranty, "enforce_warranty_term_integrity");
    expect(wall).toContain("new.ends_on is distinct from old.ends_on");
    expect(wall).toContain(
      "new.claim_window_days is distinct from old.claim_window_days",
    );
    expect(wall).toContain("what those claims were admitted on");
  });

  it("a claim is frozen once answered, and never deleted", () => {
    const wall = body(warranty, "enforce_warranty_claim_integrity");
    expect(wall).toContain("tg_op = 'UPDATE' and old.answered_at is not null");
    expect(wall).toContain(
      "new.recovered_value is distinct from old.recovered_value",
    );
    expect(wall).toContain("WITHDRAWN with a stated reason, never deleted");
  });

  it("§70: accepting a warranty settlement is a human act", () => {
    const trg = trigger(warranty, "trg_warranty_claim_answerer_is_human");
    expect(trg).toContain("before insert or update");
    expect(trg).toContain("'answered_by'");
    expect(body(warranty, "answer_warranty_claim")).toContain("§70 human act");
  });

  it("both tables become untruncatable and keep a provenance backstop", () => {
    for (const t of ["warranty_terms", "warranty_claims"]) {
      expect(warranty).toContain(`revoke truncate on table public.${t}`);
    }
    expect(warranty).toContain("record_procurement_service_write");
    expect(body(warranty, "enforce_warranty_term_integrity")).toContain(
      "tg_op = 'TRUNCATE'",
    );
  });

  it("NaN on a usage limit is caught with the numeric idiom, not the float one", () => {
    // `x <> x` is FALSE for numeric NaN in Postgres — it compares equal to
    // itself — and NaN <= 0 is false too, so the naive guard admits it.
    const wall = body(warranty, "enforce_warranty_term_integrity");
    expect(wall).toContain("new.usage_limit = 'NaN'::numeric");
    expect(wall).not.toContain("new.usage_limit <> new.usage_limit");
  });

  it("its claim status vocabulary matches the TypeScript mirror", () => {
    // The CHECK lives on the ORIGINAL table (20260817140000); the mirror is
    // pinned against that file, so a value added there without the mirror
    // fails here.
    const original = read("20260817140000_supplier_management.sql");
    for (const s of WARRANTY_CLAIM_STATUSES) {
      expect(original, `warranty_claims is missing ${s}`).toContain(`'${s}'`);
    }
  });
});

describe("the vendor quality record accrues, and refuses over nothing", () => {
  it("REFUSES entirely when no period has been measured", () => {
    const rec = body(vendor, "get_vendor_quality_record");
    expect(rec).toContain("coalesce(v_periods, 0) = 0");
    expect(rec).toContain("'answered', false");
    expect(rec).toContain("rather than averaging nothing");
  });

  it("refuses each derived ratio separately rather than dividing by zero", () => {
    const rec = body(vendor, "get_vendor_quality_record");
    expect(rec).toContain("coalesce(v_ah, 0) > 0");
    expect(rec).toContain("NOT ASSESSABLE");
    expect(rec).toContain("It is not 1.00");
    expect(rec).toContain("'onTimeRate'");
    expect(rec).toContain("coalesce(v_del_dated, 0) = 0");
  });

  it("refuses a cost total across currencies, and one with no currency at all", () => {
    const rec = body(vendor, "get_vendor_quality_record");
    expect(rec).toContain("coalesce(v_currencies, 0) > 1");
    expect(rec).toContain("coalesce(v_uncosted, 0) > 0");
    expect(rec).toContain("no exchange rate");
  });

  it("stores no score — the record is a read over the acts", () => {
    expect(vendor).not.toMatch(/add column[^;]*quality_score/);
    expect(body(vendor, "get_vendor_quality_record")).toContain(
      "Nothing here is a stored score",
    );
  });

  it("the performance period refuses an overlap, for every writer", () => {
    const wall = body(vendor, "enforce_contract_performance_integrity");
    expect(wall).toContain("daterange(");
    expect(wall).toContain("double every hour");
    expect(vendor).toContain(
      "create unique index if not exists idx_cperf_period",
    );
  });

  it("the performance period refuses a window that has not finished", () => {
    expect(body(vendor, "record_contract_performance_period")).toContain(
      "v_to > current_date",
    );
  });

  it("refuses non-finite and negative quantities at the door", () => {
    const rec = body(vendor, "record_contract_performance_period");
    expect(rec).toContain("sync_finite_money");
    expect(rec).toContain("NaN and infinity are legal numeric values");
    expect(rec).toContain("cannot be negative");
  });

  it("a period is not deleted, and the ledger is not truncatable", () => {
    const wall = body(vendor, "enforce_contract_performance_integrity");
    expect(wall).toContain("tg_op = 'DELETE'");
    expect(wall).toContain("silently IMPROVES the record");
    expect(vendor).toContain(
      "revoke truncate on table public.contract_performance",
    );
  });

  it("its RAISE statements use % and supply every argument", () => {
    // `%s` in a RAISE is a placeholder followed by a literal 's', and a RAISE
    // with fewer arguments than placeholders raises at runtime — inside a
    // DELETE wall, that is a wall that fails open-looking and closed-in-fact
    // with an internal error where a sentence should be.
    const wall = body(vendor, "enforce_contract_performance_integrity");
    expect(wall).not.toMatch(/raise exception\s*\n?\s*'[^']*%s/);
  });
});

describe("the vendor record has ONE predicate per quantity, and no bare sums", () => {
  it("contract-claim settlements are SIGNED by direction, never added together", () => {
    // PROVEN LIVE: one from_supplier claim accepted at 200,000 CAD and one
    // against_supplier claim accepted at 200,000 CAD on the same contract read
    // as {"raised": 2, "settledValue": 400000}. contract_claims.direction
    // exists precisely to stop that — the table's own comment says an unsigned
    // claim value "would put the two on the same side of the contract" — and
    // contract_commercial_summary in this same slice already netted it
    // correctly, so the slice shipped two predicates for one quantity that
    // disagreed. A supplier who claimed 200k off the owner and had 200k of
    // liquidated damages recovered from them read identically to one who
    // simply won 400k, in the record spec I.15 says decides the next award.
    const g = body(vendor, "get_vendor_quality_record");
    expect(g).not.toMatch(/sum\(cc\.settled_value\)\s*$/m);
    expect(g).toContain("cc.direction = 'from_supplier'");
    expect(g).toContain("cc.direction = 'against_supplier'");
    expect(g).toContain("'settledFromSupplier'");
    expect(g).toContain("'settledAgainstSupplier'");
    expect(g).toContain("v_cc_from - v_cc_against");
    expect(g).not.toContain("'settledValue'");
  });

  it("contract-claim settlements REFUSE across currencies, like every other total here", () => {
    // This was the ONE money figure in the function with no currency predicate
    // at all: the cost half refuses, the warranty half refuses, this one summed
    // raw across a supplier's contracts in any number of units and did not even
    // carry a currency field.
    const g = body(vendor, "get_vendor_quality_record");
    expect(g).toContain("count(distinct p.contract_currency)");
    expect(g).toMatch(/v_cc_currencies, 0\) > 1/);
    expect(g).toContain("Sync holds no exchange rate");
  });

  it("REFUSES over an empty claim set rather than reporting a settled zero", () => {
    const g = body(vendor, "get_vendor_quality_record");
    expect(g).toContain("No claim has been made under any of");
    expect(g).toContain("not a settled position of zero");
  });

  it("a warranty claim with NO stated currency refuses the total rather than joining it", () => {
    // count(distinct currency) IGNORES NULLs, so a NULL-currency claim of 900
    // was added to a CAD claim of 100 and the total was labelled CAD — money
    // with no unit, in the record that decides the next award. Confirmed live:
    //   select count(distinct c), sum(v) from (values ('CAD',100),(null,900)) → 1 | 1000
    const g = body(vendor, "get_vendor_quality_record");
    expect(g).toContain(
      "count(distinct coalesce(wc.currency, '(none stated)'))",
    );
    expect(g).toContain("v_wc_uncurrenced");
    expect(g).toContain("NO stated currency");
    // ...and the door requires one, so new claims cannot create the state.
    const rz = body(warranty, "raise_warranty_claim");
    expect(rz).toContain("state the currency of the claim");
    expect(rz).not.toMatch(/if v_currency is not null and v_currency !~/);
  });

  it("the performance quantities are finite AT THE TABLE, not only at the door", () => {
    // The wall ADMITS-AND-RECORDS a service path, and one row of NaN/Infinity
    // through it poisoned every derived figure — get_vendor_quality_record then
    // answered `answered: true` with productivityFactor NaN and plannedCost
    // Infinity, the refusal-first rule inverted. 'NaN'::numeric = 'NaN' is TRUE
    // in Postgres, so `>= 0` alone does not keep it out. 6A set this precedent
    // on awarded_value; the same treatment was owed here.
    expect(vendor).toContain("contract_performance_quantities_finite");
    for (const col of [
      "planned_hours",
      "actual_hours",
      "planned_cost",
      "actual_cost",
    ]) {
      expect(vendor).toContain(`${col} <> 'NaN'::numeric`);
      expect(vendor).toContain(`${col} < 'Infinity'::numeric`);
    }
  });
});

describe("the §70 walls name the act they are actually refusing", () => {
  it("a WITHDRAWAL is not refused with a message about a decision", () => {
    // withdraw_contract_change_order writes decided_by and
    // withdraw_contract_claim writes answered_by, and both columns carry the
    // §70 trigger — so an AI-identity withdrawal was refused by the table with
    // "cannot decide a contract change order". Both are correctly refused;
    // only the sentence was wrong, and a refusal that names the wrong act sends
    // the reader looking for a decision nobody made.
    expect(trigger(change, "trg_change_order_decider_is_human")).toContain(
      "decide or withdraw a contract change order",
    );
    expect(trigger(claim, "trg_contract_claim_answerer_is_human")).toContain(
      "answer or withdraw a claim under a contract",
    );
    expect(body(change, "withdraw_contract_change_order")).toContain(
      "decided_by = auth.uid()",
    );
    expect(body(claim, "withdraw_contract_claim")).toContain(
      "answered_by = auth.uid()",
    );
  });
});

describe("who may call the money acts is pinned, not inferred", () => {
  const MONEY_ACTS: [string, string][] = [
    ["decide_contract_change_order(bigint, text, text)", CHANGE_FILE],
    ["certify_contract_invoice(bigint, text, text, text)", CLAIM_FILE],
    ["record_invoice_payment(bigint, text, text)", CLAIM_FILE],
    ["answer_contract_claim(bigint, text, text, text, text)", CLAIM_FILE],
    ["answer_warranty_claim(bigint, text, text, text)", WARRANTY_FILE],
  ];

  for (const [sig, file] of MONEY_ACTS) {
    const name = sig.slice(0, sig.indexOf("("));
    it(`${name} is granted to authenticated ONLY`, () => {
      // The grant is the FIRST wall: a service key that could execute these
      // would reach the certification and the payment with auth.uid() NULL. The
      // org gate would still refuse it, but nothing pinned the grant itself, so
      // a later `to authenticated, service_role` would pass every test.
      const src = read(file);
      expect(src).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*from public, anon, service_role;`,
        ),
      );
      expect(src).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*to authenticated;`,
        ),
      );
      expect(src).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^)]*\\)[^;]*service_role`,
        ),
      );
    });
  }

  it("every function this slice defines sets search_path", () => {
    // A definer without `set search_path = public` resolves its own table
    // names through the caller's search_path.
    for (const file of SLICE_FILES) {
      const src = read(file);
      const defs = [
        ...src.matchAll(/create or replace function public\.(\w+)\(/g),
      ];
      for (const m of defs) {
        const seg = src.slice(m.index ?? 0, (m.index ?? 0) + 900);
        expect(seg, `${m[1]} in ${file} has no search_path`).toContain(
          "set search_path = public",
        );
      }
    }
  });
});

describe("the specification-to-failure thread joins; it does not fork", () => {
  it("links the ONE requirement table rather than copying a specification", () => {
    const t = table(vendor, "contract_package_specifications");
    expect(t).toContain("references design_requirements(id)");
    expect(t).toContain("references contract_packages(id)");
    expect(t).not.toMatch(/requirement\s+text/);
  });

  it("reuses the live failure→requirement traversal for the reverse direction", () => {
    const th = body(vendor, "get_specification_failure_thread");
    expect(th).toContain("from get_design_feedback_loop() f");
    // ...and does not re-derive it.
    expect(th).not.toMatch(
      /design_requirements d2[\s\S]*derived_from_failure_mode/,
    );
  });

  it("REFUSES at whichever hop the chain breaks, naming the hop", () => {
    const th = body(vendor, "get_specification_failure_thread");
    for (const marker of [
      "not linked to any procurement package",
      "NONE of them is awarded",
      "supplies no material recorded",
      "none of them appears on any asset",
    ]) {
      expect(th, `missing refusal: ${marker}`).toContain(marker);
    }
    expect(th).toContain('That is not "this specification caused no failures"');
  });

  it("orders the failure list on the COUNT, not on its rendered text", () => {
    const th = body(vendor, "get_specification_failure_thread");
    expect(th).toContain("order by g.n desc");
    expect(th).not.toMatch(/order by\s+\w+->>'occurrences'/);
  });

  it("follows BOTH shapes of BOM line, so a class-catalogued part is not lost", () => {
    // bom_lines hangs off an asset OR an asset class. Following only asset_id
    // would report "this part is on no bill of materials" about a part that is
    // on every one of them, which is a wrong REFUSAL rather than a wrong
    // number — the harder kind to notice.
    const th = body(vendor, "get_specification_failure_thread");
    expect(th).toContain("b.asset_class = a.asset_class");
    expect(th).toContain("b.asset_id = a.id");
  });

  it("a full traversal with no failures says what that does and does not mean", () => {
    expect(body(vendor, "get_specification_failure_thread")).toContain(
      "That is a fact about the maintenance history, not a warranty",
    );
  });
});

describe("the commercial read computes nothing of its own", () => {
  it("reads every figure from the predicate that owns it", () => {
    const g = body(commercialRead, "get_contract_commercial");
    expect(g).toContain("contract_current_value(p.id)");
    expect(g).toContain("contract_commitment_position(p.id)");
    expect(g).toContain("contract_invoice_position(p.id)");
    expect(g).toContain("warranty_cover_position(w.id, current_date, null)");
  });

  it("states that a settlement is not carried, and computes NO figure for it", () => {
    const s = body(commercialRead, "contract_commercial_summary");
    // The SENTENCE stays. The arithmetic does not: `settled - every approved
    // change order` compared two unrelated totals, because nothing links a
    // claim to the change order that carries it. It was wrong in BOTH
    // directions — an unrelated change order of the same size reported a false
    // all-clear on agreed money, and a scope change alongside a settlement
    // invented a shortfall the screen rendered as fact.
    expect(s).toContain("'settlementNote'");
    expect(s).not.toContain("settlementNotCarried");
    expect(s).not.toMatch(/v_claims_settled\s*-\s*v_co_delta/);
    expect(s).toContain("nothing here links a settlement to the change order");
    expect(body(commercialRead, "get_contract_commercial")).toContain(
      "An accepted claim does not move a contract",
    );
    // It must NOT be folded into the contract's value.
    expect(commercialRead).not.toMatch(/currentValue[^,]*settled/);
  });

  it("carries the ONE invoice position's REFUSAL instead of a confident zero", () => {
    const s = body(commercialRead, "contract_commercial_summary");
    // Counting the rows here reported `invoices: 0, invoicesAwaitingPayment: 0`
    // on a contract nobody has billed against, while contract_invoice_position
    // REFUSES over exactly that set — two surfaces of one slice giving opposite
    // answers, with the refusal-first one the planner did not see.
    expect(s).toContain("v_invoices := contract_invoice_position(p.id)");
    expect(s).toContain("'invoiceRefusal'");
    expect(s).not.toMatch(/select count\(\*\)[^;]*into v_inv\b/);
    // Null, not zero, when the position refuses.
    expect(s).toMatch(/'invoices',\s*case when \(v_invoices->>'answered'\)/);
  });

  it("distinguishes 'nobody claimed' from 'every claim answered'", () => {
    // claimsOpen alone rendered both as "0 open claim(s)" — opposite facts.
    const s = body(commercialRead, "contract_commercial_summary");
    expect(s).toContain("'claimsRaised'");
    expect(s).toContain("'claimsOpen'");
  });

  it("refuses on an unawarded package rather than reporting empty lists", () => {
    expect(body(commercialRead, "contract_commercial_summary")).toContain(
      "There is no contract to have a commercial life yet",
    );
  });

  it("splices into get_case_procurement by TRANSFORMATION, and raises if the anchor moved", () => {
    expect(commercialRead).toContain("pg_get_functiondef");
    expect(commercialRead).toContain(
      "the per-package commitment key of get_case_procurement was not found",
    );
  });
});

describe("the §78 procurement-status connector is a thin caller, not a new door", () => {
  it("routes through the ONE ingest contract", () => {
    expect(connector).toContain(
      "create or replace function public.ingest_entity_routes()",
    );
    expect(connector).toContain(
      "('procurement_status',       'ingest_procurement_status_batch')",
    );
    expect(connector).toContain(
      "public.ingest_procurement_status_batch(p_run_id, p_rows)",
    );
    // ...and does not build a second door.
    expect(connector).not.toMatch(/create or replace function public\.begin_/);
  });

  it("keeps every route the door already carried", () => {
    for (const key of Object.keys(INGEST_ENTITIES)) {
      expect(connector, `route ${key} was dropped`).toContain(`('${key}',`);
    }
  });

  it("writes nothing itself — it calls the ONE §25 status writer", () => {
    const v = body(connector, "ingest_procurement_status_batch");
    expect(v).not.toMatch(/update\s+contract_packages/);
    expect(v).not.toMatch(/insert\s+into\s+contract_packages/);
    expect(v).toContain(
      "set_procurement_package_status(v_package, v_dim, v_status, v_basis)",
    );
    expect(v).toContain(
      "record_package_delivery_forecast(v_package, v_forecast, v_basis)",
    );
  });

  it("keeps every per-row write in a subtransaction and retains every reject", () => {
    const v = body(connector, "ingest_procurement_status_batch");
    expect(v).toContain("exception");
    expect(v).toContain(
      "already loaded — another run wrote this external_id while this one was in flight",
    );
    expect(v).toContain("'rejected', v_reason");
    expect(v).toContain("'accepted'");
  });

  it("is one fact per row, so a refusal cannot leave half a row applied", () => {
    expect(body(connector, "ingest_procurement_status_batch")).toContain(
      "BOTH a status move and a delivery forecast",
    );
  });

  it("is not callable by authenticated — only the router reaches it", () => {
    expect(connector).toMatch(
      /revoke all on function public\.ingest_procurement_status_batch\(uuid, jsonb\)\s*\n?\s*from public, anon, authenticated;/,
    );
  });

  it("the router is EXTENDED BY TRANSFORMATION, so nothing else in it can move", () => {
    // The first draft re-issued ingest_rows in full. Nothing was reverted by
    // it as it happened — but a full re-type silently reverts whatever has
    // been fixed in the router since 20261112090000, with a green suite, and
    // this one dropped the reasoning behind two live guards on the way. Every
    // other extension in this slice transforms the live body and raises if the
    // anchor moved; this one now does too.
    expect(connector).not.toMatch(
      /create or replace function public\.ingest_rows\(/,
    );
    expect(connector).toContain("proname = 'ingest_rows'");
    expect(connector).toContain(
      "the handler dispatch of ingest_rows was not found in the shape 20261112090000 left it",
    );
  });

  it("the transformation adds ONE branch and touches no gate", () => {
    // The replacement text is readable for exactly the property the re-type
    // was justified by: the dispatch stays an explicit branch, not dynamic SQL.
    const at = connector.indexOf("do $router$");
    const router = connector.slice(at, connector.indexOf("$router$;", at));
    expect(router).toContain(
      "elsif v_handler = 'ingest_procurement_status_batch' then",
    );
    expect(router).toContain(
      "return public.ingest_procurement_status_batch(p_run_id, p_rows);",
    );
    expect(router).not.toMatch(/execute format/i);
    // No role list, no tenant filter and no run resolution appear in the
    // replacement at all — they are the live body's, untouched.
    expect(router).not.toMatch(/coalesce\(v_role, ''\) not in/);
    expect(router).not.toContain("connector_type = 'manual_upload'");
    expect(router).not.toContain("app_current_org()");
  });

  it("a re-upload of the FORECAST half is skipped, not re-applied", () => {
    // src/lib/ingest-entities.ts declares `reupload: "skips"` for this entity
    // and its own template rows include a forecast row. The status half
    // deduplicates through the ONE writer answering "already at that value";
    // record_package_delivery_forecast has no such answer — it accepts an
    // identical date, writes it, and files an audit row whose previous_state
    // and new_state are the same day. PROVEN LIVE: the same row uploaded twice
    // reported accepted:1 both times on a connector whose whole promise is
    // that it skips.
    const v = body(connector, "ingest_procurement_status_batch");
    expect(v).toContain("v_pkg_forecast = v_forecast");
    // The dedupe must come BEFORE the writer is called.
    expect(v.indexOf("v_pkg_forecast = v_forecast")).toBeLessThan(
      v.indexOf("record_package_delivery_forecast("),
    );
    expect(v).toContain("'duplicate'");
  });
});

describe("the helper predicates are unreachable, and their callers scope first", () => {
  // These four take a bare id and have no tenant gate of their own —
  // deliberately, exactly as contract_commitment_position does. That is safe
  // for two reasons and BOTH are asserted here, because "safe because every
  // caller happens to scope first" is a property nothing was pinning: adding
  // an org filter inside them instead would change what they answer on the
  // trigger and service paths, where app_current_org() is NULL.
  const HELPERS: [string, string, string][] = [
    ["contract_current_value", "bigint", CHANGE_FILE],
    ["contract_invoice_position", "bigint", CLAIM_FILE],
    ["warranty_cover_position", "bigint, date, numeric", WARRANTY_FILE],
    ["contract_commercial_summary", "bigint", READ_FILE],
  ];

  for (const [fn, args, file] of HELPERS) {
    it(`${fn} is executable by NO client role`, () => {
      expect(read(file)).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\(${args.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\s*\\n?\\s*from public, anon, authenticated, service_role;`,
        ),
      );
      expect(joined).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\(`),
      );
    });
  }

  it("every RPC that reaches one resolves the tenant BEFORE it", () => {
    // The mutating doors and the reads all derive v_org from app_current_org()
    // and filter the package/warranty on it before passing an id down.
    let checked = 0;
    for (const file of SLICE_FILES) {
      const src = read(file);
      const defs = [
        ...src.matchAll(/create or replace function public\.(\w+)\(/g),
      ];
      for (const m of defs) {
        const at = m.index ?? 0;
        const endAt = src.indexOf("\n$$;", at);
        const fnBody = src.slice(at, endAt === -1 ? undefined : endAt);
        const usesHelper = HELPERS.some(([h]) =>
          new RegExp(`${h}\\(`).test(fnBody.slice(fnBody.indexOf("begin"))),
        );
        if (!usesHelper) continue;
        if (HELPERS.some(([h]) => m[1] === h)) continue;
        expect(fnBody, `${m[1]} in ${file}`).toContain("app_current_org()");
        expect(fnBody, `${m[1]} in ${file}`).toMatch(
          /organization_id = v_org|organization_id = app_current_org\(\)/,
        );
        checked += 1;
      }
    }
    // Non-vacuous by construction: a refactor that renamed the helpers would
    // otherwise turn this into a loop over nothing that still passes.
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});

describe("every new table is org-scoped, guarded and provenance-backed", () => {
  const NEW_TABLES = [
    ["contract_change_orders", change],
    ["contract_claims", claim],
    ["contract_invoices", claim],
    ["contract_package_specifications", vendor],
  ] as const;

  for (const [name, source] of NEW_TABLES) {
    it(`${name} carries RLS, an org-scoped read policy and no client write policy`, () => {
      expect(source).toContain(
        `alter table public.${name} enable row level security`,
      );
      expect(source).toMatch(
        new RegExp(
          `create policy \\w+ on public\\.${name}\\s*\\n\\s*for select to authenticated using \\(organization_id = app_current_org\\(\\)\\)`,
        ),
      );
      expect(source).not.toMatch(
        new RegExp(
          `create policy[^;]*on public\\.${name}[^;]*for (insert|update|delete)`,
        ),
      );
    });

    it(`${name} is untruncatable and has a statement-level guard`, () => {
      expect(source).toContain(`revoke truncate on table public.${name}`);
      expect(source).toMatch(
        new RegExp(
          `before truncate on public\\.${name}[\\s\\S]{0,120}for each statement`,
        ),
      );
    });
  }

  it("every mutation is a SECURITY DEFINER RPC with a role check and an audit row", () => {
    for (const [fn, source] of [
      ["record_contract_change_order", change],
      ["decide_contract_change_order", change],
      ["withdraw_contract_change_order", change],
      ["record_contract_claim", claim],
      ["answer_contract_claim", claim],
      ["withdraw_contract_claim", claim],
      ["record_contract_invoice", claim],
      ["certify_contract_invoice", claim],
      ["record_invoice_payment", claim],
      ["record_warranty_term", warranty],
      ["raise_warranty_claim", warranty],
      ["submit_warranty_claim", warranty],
      ["answer_warranty_claim", warranty],
      ["withdraw_warranty_claim", warranty],
      ["record_contract_performance_period", vendor],
      ["link_package_specification", vendor],
    ] as const) {
      const b = body(source, fn);
      expect(b, `${fn} is not a definer`).toContain("security definer");
      expect(b, `${fn} has no role check`).toContain(
        "select role into v_role from user_profiles",
      );
      expect(b, `${fn} writes no audit row`).toContain(
        "insert into audit_events",
      );
      expect(b, `${fn} carries no previous/new state`).toContain(
        "previous_state, new_state",
      );
    }
  });

  it("uses auth.uid() for the dual-caller gate, never current_user in a definer", () => {
    // `current_user in ('authenticated','anon')` is DEAD CODE inside a
    // SECURITY DEFINER function — it is always the owner.
    expect(joined).not.toMatch(/current_user\s+in\s*\(\s*'authenticated'/);
    for (const source of [change, claim, warranty, vendor]) {
      expect(source).toContain("auth.uid() is not null");
    }
  });

  it("keeps the fixture-secret scanner quiet — no long literal keys", () => {
    expect(rawJoined).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });
});
