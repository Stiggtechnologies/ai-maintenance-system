/**
 * The commercial lifecycle kernel — every refusal, exercised.
 *
 * A refusal nobody tests is a sentence in a file. Each case below is one of
 * the specific wrong answers this module exists to avoid: a contract value
 * summed across currencies, an invoice that looks payable twice, and a control
 * offered over a warranty term nobody finished recording.
 *
 * It also pins what this module must NOT hold. `warrantyCover` — a full second
 * copy of warranty_cover_position, complete with its own date arithmetic, that
 * GATED the raise-claim button and had already diverged from the server on a
 * non-finite usage reading — was deleted, and the assertions below fail if any
 * expiry arithmetic returns to this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as commercial from "./commercial";
import {
  CHANGE_ORDER_STATUSES,
  CLAIM_DIRECTIONS,
  CLAIM_STATUSES,
  INVOICE_STATUSES,
  WARRANTY_CLAIM_STATUSES,
  claimDirectionLabel,
  contractValuePosition,
  invoicePayability,
  warrantyTermStatesNoExpiry,
  type ChangeOrderLine,
} from "./commercial";

const co = (
  ref: string,
  delta: number,
  status = "approved",
  currency = "CAD",
): ChangeOrderLine => ({
  changeOrderRef: ref,
  valueDelta: delta,
  currency,
  status,
});

describe("the vocabularies", () => {
  it("carry exactly the values the SQL CHECKs carry", () => {
    // The pairing with SQL is asserted in developSlice6bMigration.test.ts; this
    // is the shape assertion, so a value deleted here fails twice.
    expect([...CHANGE_ORDER_STATUSES]).toEqual([
      "draft",
      "approved",
      "rejected",
      "withdrawn",
    ]);
    expect([...CLAIM_DIRECTIONS]).toEqual([
      "from_supplier",
      "against_supplier",
    ]);
    expect(CLAIM_STATUSES).toContain("partially_accepted");
    expect(INVOICE_STATUSES).toEqual([
      "received",
      "certified",
      "rejected",
      "paid",
    ]);
    expect(WARRANTY_CLAIM_STATUSES).toContain("time_barred");
  });

  it("labels a claim direction as a side of the contract, not as a code", () => {
    expect(claimDirectionLabel("from_supplier")).toBe("From the supplier");
    expect(claimDirectionLabel("against_supplier")).toBe(
      "Against the supplier",
    );
    expect(claimDirectionLabel(null)).toBe("unknown");
  });
});

describe("contractValuePosition", () => {
  it("adds approved change orders to the frozen award", () => {
    const r = contractValuePosition(640000, "CAD", [
      co("CO-1", 40000),
      co("CO-2", -10000),
      co("CO-3", 999999, "draft"),
      co("CO-4", 500000, "rejected"),
    ]);
    expect(r.answered).toBe(true);
    if (!r.answered) return;
    expect(r.approvedDelta).toBe(30000);
    expect(r.currentValue).toBe(670000);
    expect(r.approvedCount).toBe(2);
  });

  it("refuses on an unawarded package rather than reporting zero", () => {
    const r = contractValuePosition(null, null, [], "S6B-C1");
    expect(r.answered).toBe(false);
    if (r.answered) return;
    expect(r.refusal).toContain("not awarded");
    expect(r.refusal).toContain("not a contract worth nothing");
  });

  it("refuses to add a change order in another currency and names it", () => {
    const r = contractValuePosition(
      640000,
      "CAD",
      [co("CO-1", 40000, "approved", "USD")],
      "S6B-C1",
    );
    expect(r.answered).toBe(false);
    if (r.answered) return;
    expect(r.refusal).toContain("USD");
    expect(r.refusal).toContain("CO-1");
    expect(r.refusal).toContain("no exchange rate");
  });

  it("refuses a non-finite delta — NaN survives every comparison", () => {
    const r = contractValuePosition(640000, "CAD", [co("CO-1", Number.NaN)]);
    expect(r.answered).toBe(false);
    if (r.answered) return;
    expect(r.refusal).toContain("CO-1");
    expect(r.refusal).toContain("NaN");
  });

  it("refuses a non-finite award value", () => {
    const r = contractValuePosition(Number.POSITIVE_INFINITY, "CAD", []);
    expect(r.answered).toBe(false);
  });

  it("refuses a set of change orders that takes the contract negative", () => {
    const r = contractValuePosition(100, "CAD", [co("CO-1", -500)]);
    expect(r.answered).toBe(false);
    if (r.answered) return;
    expect(r.refusal).toContain("negative value is not a contract");
  });
});

describe("invoicePayability", () => {
  const base = {
    invoiceRef: "INV-1",
    grossAmount: 1000,
    certifiedAmount: 1000,
    currency: "CAD",
    paidAt: null as string | null,
    paymentReference: null as string | null,
  };

  it("says a certified invoice is payable once", () => {
    const r = invoicePayability({ ...base, status: "certified" });
    expect(r.payable).toBe(true);
    expect(r.reason).toContain("payable once");
  });

  it("refuses a second payment and quotes the reference already on it", () => {
    const r = invoicePayability({
      ...base,
      status: "paid",
      paidAt: "2026-09-01",
      paymentReference: "BANK-77",
    });
    expect(r.payable).toBe(false);
    expect(r.reason).toContain("BANK-77");
    expect(r.reason).toContain("2026-09-01");
    expect(r.reason).toContain("not payable a second time");
  });

  it("refuses a paid invoice even when its status was not updated", () => {
    // The status column and the payment record are two facts, and a row where
    // they disagree must not be treated as unpaid.
    const r = invoicePayability({
      ...base,
      status: "certified",
      paidAt: "2026-09-01",
      paymentReference: "BANK-77",
    });
    expect(r.payable).toBe(false);
  });

  it("refuses an uncertified invoice, naming what certification is", () => {
    const r = invoicePayability({
      ...base,
      status: "received",
      certifiedAmount: null,
    });
    expect(r.payable).toBe(false);
    expect(r.reason).toContain("CERTIFIED");
    expect(r.reason).toContain("supplier's word alone");
  });

  it("refuses a rejected invoice", () => {
    const r = invoicePayability({
      ...base,
      status: "rejected",
      certifiedAmount: null,
    });
    expect(r.payable).toBe(false);
    expect(r.reason).toContain("rejected");
  });

  it("refuses a 'certified' invoice carrying no certified amount", () => {
    const r = invoicePayability({
      ...base,
      status: "certified",
      certifiedAmount: null,
    });
    expect(r.payable).toBe(false);
  });
});

describe("no second expiry arithmetic in the client", () => {
  it("does NOT export a warranty-cover predicate", () => {
    // `warrantyCover` lived here and was a ~90-line copy of
    // warranty_cover_position — every leg of it, plus its own ISO date
    // arithmetic and both of the server's day-count fields — and
    // CommercialPanels used it to GATE the raise-claim button. It had already
    // diverged: an unparseable usage reading is NaN in TypeScript and was
    // refused, while sync_finite_money returns NULL for 'NaN' so the server
    // treated it as "no reading supplied" and admitted the claim on the date
    // leg. Same input, opposite answers. This assertion is what stops it
    // coming back.
    const mod = commercial as Record<string, unknown>;
    for (const name of Object.keys(mod)) {
      expect(name).not.toMatch(/^warrantyCover$/);
    }
    expect(mod.warrantyCover).toBeUndefined();
  });

  it("holds no date arithmetic at all", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/develop/commercial.ts"),
      "utf8",
    );
    // No day maths, no Date construction, no expiry comparison. The one cover
    // question this file answers is two null checks.
    expect(src).not.toMatch(/Date\.UTC/);
    expect(src).not.toMatch(/new Date\(/);
    expect(src).not.toMatch(/86400000/);
    expect(src).not.toMatch(/expiredByDays/);
    expect(src).not.toMatch(/daysRemaining/);
  });
});

describe("warrantyTermStatesNoExpiry", () => {
  it("is TRUE for a term with neither an end date nor a usage limit", () => {
    // The one branch warranty_cover_position refuses over for EVERY date, so
    // the screen may close the control on it without asking a second question.
    expect(warrantyTermStatesNoExpiry({ endsOn: null, usageLimit: null })).toBe(
      true,
    );
  });

  it("is FALSE for a dated term, and for a usage-only term", () => {
    // A usage-only term is NOT blocked here: the server admits a claim on it
    // once a reading is supplied, and blocking would close a control the
    // product would accept — which is the divergence this replaced.
    expect(
      warrantyTermStatesNoExpiry({ endsOn: "2026-12-31", usageLimit: null }),
    ).toBe(false);
    expect(
      warrantyTermStatesNoExpiry({ endsOn: null, usageLimit: 12000 }),
    ).toBe(false);
  });

  it("does not look at any date, so it cannot disagree with the server", () => {
    // Whatever the dates say, the answer turns only on presence.
    expect(
      warrantyTermStatesNoExpiry({ endsOn: "1900-01-01", usageLimit: null }),
    ).toBe(false);
  });
});
