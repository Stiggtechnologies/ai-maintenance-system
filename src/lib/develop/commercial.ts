/**
 * The commercial lifecycle after signature (D6.06 — spec I.16).
 *
 * PURE: no database, no network. Every function here either states a fact the
 * server also states, or REFUSES.
 *
 * WHY EACH REFUSAL IS HERE. This file moves money and makes claims against
 * suppliers, and every number it could invent is one somebody would act on:
 *
 *   * a CONTRACT VALUE summed across currencies is an exchange rate reported
 *     as money. `contractValuePosition` refuses and names the units.
 *   * an INVOICE that looks payable twice is a duplicate payment.
 *     `invoicePayability` answers "no, and here is the payment reference it
 *     already carries" rather than leaving a button enabled.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT HOLD — and what was DELETED from it.
 * Three functions here answered questions the SERVER already answers and
 * already returns a sentence for: the vendor productivity ratio
 * (`get_vendor_quality_record` refuses it by name over a zero denominator), the
 * settled-but-not-carried claim gap (`get_contract_commercial` names it), and
 * WARRANTY COVER — `warrantyCover`, a full second copy of
 * `warranty_cover_position` complete with its own date arithmetic, which gated
 * the raise-claim button and had already diverged from the server on a
 * non-finite usage reading. A client copy of any of them is a second answer
 * that disagrees with the first the day one of them is repaired, inside one
 * rendered payload — the shape of the `packageLateness` defect the reachability
 * gate caught in Slice 6A. Every figure this module's callers RENDER comes from
 * the server; what stays here either decides whether to offer a control the
 * server would refuse WITHOUT re-deriving the server's answer, or states a
 * refusal of its own over data the client can see is unsummable.
 *
 * It also has no second source of committed cost. `project_cost_items.commitment` has exactly ONE writer
 * (enforce_cost_item_contract_commitment, 20261208090200) and the commitment
 * total has exactly one predicate (contract_commitment_position, mirrored by
 * `commitmentTotal` in ./procurement). Nothing here re-derives either, and a
 * change order raises the CEILING a commitment is checked against rather than
 * committing anything itself.
 *
 * The vocabularies below MIRROR SQL CHECK constraints, and
 * `src/test/developSlice6bMigration.test.ts` pins each pair together — so a
 * value added to one side only fails before it reaches a database.
 *
 * Non-finite and negative money is refused at every door here as it is at
 * every door in the migrations: `Number.isFinite` rejects NaN and both
 * infinities, which the SQL side matches with explicit NaN/Infinity checks
 * because `'NaN'::numeric = 'NaN'::numeric` is TRUE in Postgres and `>= 0`
 * alone does not keep it out.
 */

/** Mirrors the `contract_change_orders.status` CHECK. */
export const CHANGE_ORDER_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

/** Mirrors the `contract_claims.direction` CHECK. */
export const CLAIM_DIRECTIONS = ["from_supplier", "against_supplier"] as const;
export type ClaimDirection = (typeof CLAIM_DIRECTIONS)[number];

/** Mirrors the `contract_claims.status` CHECK. */
export const CLAIM_STATUSES = [
  "open",
  "accepted",
  "partially_accepted",
  "rejected",
  "withdrawn",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Mirrors the `contract_invoices.status` CHECK. */
export const INVOICE_STATUSES = [
  "received",
  "certified",
  "rejected",
  "paid",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Mirrors the `warranty_claims.status` CHECK (20260817140000:227). */
export const WARRANTY_CLAIM_STATUSES = [
  "raised",
  "submitted",
  "accepted",
  "rejected",
  "withdrawn",
  "time_barred",
] as const;
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

export function claimDirectionLabel(value: string | null | undefined): string {
  if (value === "from_supplier") return "From the supplier";
  if (value === "against_supplier") return "Against the supplier";
  return value ?? "unknown";
}

/* ───────────────────────── contract value ──────────────────────────────── */

export interface ChangeOrderLine {
  changeOrderRef: string;
  valueDelta: number;
  currency: string;
  status: string;
}

export type ContractValuePosition =
  | {
      answered: true;
      awardedValue: number;
      approvedDelta: number;
      currentValue: number;
      currency: string;
      approvedCount: number;
    }
  | { answered: false; refusal: string };

/**
 * What a contract is worth today — mirroring `contract_current_value`.
 *
 * The award is FROZEN for every caller once decided (20261208090000), so a
 * contract that moved after signature moved through change orders and nowhere
 * else. This adds the two, and refuses rather than adding across units.
 */
export function contractValuePosition(
  awardedValue: number | null,
  currency: string | null,
  changeOrders: ChangeOrderLine[],
  contractCode = "this contract",
): ContractValuePosition {
  if (awardedValue === null || currency === null) {
    return {
      answered: false,
      refusal: `${contractCode} is not awarded. It has no value to change and no commercial life yet — that is not a contract worth nothing.`,
    };
  }
  if (!Number.isFinite(awardedValue)) {
    return {
      answered: false,
      refusal: `${contractCode} carries an award value that is not a finite number (${awardedValue}). Every total computed from it would be NaN.`,
    };
  }
  const approved = changeOrders.filter((c) => c.status === "approved");
  const foreign = approved.filter((c) => c.currency !== currency);
  if (foreign.length > 0) {
    return {
      answered: false,
      refusal: `${contractCode} is denominated in ${currency} and ${foreign.length} approved change order(s) are stated in ${[
        ...new Set(foreign.map((c) => c.currency)),
      ].join(
        ", ",
      )}: ${foreign.map((c) => c.changeOrderRef).join(", ")}. Sync holds no exchange rate, so they are not added — the contract's value would otherwise be a sum of two units presented as money.`,
    };
  }
  const bad = approved.filter((c) => !Number.isFinite(c.valueDelta));
  if (bad.length > 0) {
    return {
      answered: false,
      refusal: `${bad.length} approved change order(s) on ${contractCode} carry a value that is not a finite number: ${bad
        .map((c) => `${c.changeOrderRef} (${c.valueDelta})`)
        .join(
          "; ",
        )}. NaN and infinity pass every comparison vacuously and turn the contract's value into NaN.`,
    };
  }
  const delta = approved.reduce((sum, c) => sum + c.valueDelta, 0);
  const current = awardedValue + delta;
  if (current < 0) {
    return {
      answered: false,
      refusal: `The approved change orders on ${contractCode} take it to ${current} ${currency}. A contract with a negative value is not a contract.`,
    };
  }
  return {
    answered: true,
    awardedValue,
    approvedDelta: delta,
    currentValue: current,
    currency,
    approvedCount: approved.length,
  };
}

/* ───────────────────────── invoices ────────────────────────────────────── */

export interface InvoiceView {
  invoiceRef: string;
  status: string;
  grossAmount: number;
  certifiedAmount: number | null;
  currency: string;
  paidAt: string | null;
  paymentReference: string | null;
}

export interface Payability {
  payable: boolean;
  reason: string;
}

/**
 * Whether an invoice may be paid, and why not when it may not — mirroring the
 * refusals in `record_invoice_payment`.
 *
 * A PAID invoice answers with the date and the payment reference it already
 * carries. An invoice that merely looks unpayable ("the button is greyed out")
 * teaches nobody why, and the second payment is then made through the ledger
 * by hand.
 */
export function invoicePayability(invoice: InvoiceView): Payability {
  if (invoice.status === "paid" || invoice.paidAt !== null) {
    return {
      payable: false,
      reason: `Invoice ${invoice.invoiceRef} was PAID on ${invoice.paidAt ?? "an unrecorded date"} under payment reference ${invoice.paymentReference ?? "(none recorded)"}. It is not payable a second time, and the payment record cannot be cleared to make it so — a payment made in error is corrected by a credit recorded as its own invoice.`,
    };
  }
  if (invoice.status === "rejected") {
    return {
      payable: false,
      reason: `Invoice ${invoice.invoiceRef} was rejected. Nothing is payable against a rejected invoice.`,
    };
  }
  if (invoice.status !== "certified" || invoice.certifiedAmount === null) {
    return {
      payable: false,
      reason: `Invoice ${invoice.invoiceRef} is ${invoice.status}. Only a CERTIFIED invoice is payable: certification is the statement that the work was done and the money is due, and paying without it pays on the supplier's word alone.`,
    };
  }
  return {
    payable: true,
    reason: `Invoice ${invoice.invoiceRef} is certified at ${invoice.certifiedAmount} ${invoice.currency} and is payable once.`,
  };
}

/* ───────────────────────── warranty cover ──────────────────────────────── */

/**
 * THERE IS NO WARRANTY-COVER FUNCTION IN THIS FILE, AND THAT IS THE POINT.
 *
 * `warrantyCover` used to live here: a ~90-line reimplementation of
 * `warranty_cover_position` — the both-null refusal, the before-start leg, the
 * expiry leg, the usage leg and both of its day-count fields — with its own
 * date arithmetic. `CommercialPanels.tsx` used it to gate the raise-claim
 * button, so it DECIDED rather than merely described, and it had already
 * diverged: an unparseable usage reading became `NaN` in TypeScript and was
 * refused outright, while the server ran the same input through
 * `sync_finite_money`, got NULL, treated it as "no reading supplied" and
 * admitted the claim on the date leg. Same input, opposite answers, and the
 * screen closed a control the product would have accepted.
 *
 * That is the `packageLateness` shape the reachability gate caught in Slice 6A,
 * and the migration comment on `warranty_cover_position` states in terms that
 * "every door and every screen reads this one function — there is no second
 * expiry arithmetic". It is deleted, not moved.
 *
 * What the screen gates on instead is not arithmetic at all: a term stating
 * NEITHER an end date NOR a usage limit is the one branch the server refuses
 * over for EVERY date, so `endsOn === null && usageLimit === null` — two null
 * checks on fields the payload already carries — closes the control without
 * computing anything, and the sentence rendered beside it is the server's own
 * `coverToday` refusal from `get_contract_commercial`. Every other question
 * about cover goes to the door and comes back in the predicate's words.
 */
export function warrantyTermStatesNoExpiry(term: {
  endsOn: string | null;
  usageLimit: number | null;
}): boolean {
  return term.endsOn === null && term.usageLimit === null;
}
