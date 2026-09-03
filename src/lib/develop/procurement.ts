/**
 * Procurement and the commercial engine (D6.03, D6.04, D6.05, D6.08, D6.09 —
 * spec I.16, III.§24, III.§25).
 *
 * PURE: no database, no network. Every function here either states a fact the
 * server also states, or REFUSES.
 *
 * The three vocabularies below MIRROR immutable SQL functions, and
 * `src/test/developSlice6aMigration.test.ts` pins each pair together — so a
 * value added to one side only fails before it reaches a database:
 *
 *   PROCUREMENT_STATUS_VALUES  ↔ sync_procurement_status_values(dimension)
 *   BID_EVALUATION_KINDS       ↔ sync_bid_evaluation_kinds()
 *   CONTRACT_TYPES             ↔ sync_contract_types()
 *
 * WHY THE REFUSALS IN THIS FILE MATTER MORE THAN THE FORMATTING. An award is
 * money and it is adversarial. Three of the numbers a procurement screen wants
 * to show are numbers that must not be invented:
 *
 *   * "0 bids evaluated" over a package that received no bids reads as an
 *     evaluation that ran. `awardReadiness` returns a refusal naming the
 *     absence instead.
 *   * a commitment total summed over the priced lines, with the unpriced ones
 *     silently skipped, understates the contract by exactly the amount nobody
 *     has agreed yet. `commitmentTotal` refuses and NAMES the lines.
 *   * a package with no required date is not an on-time package. The SERVER
 *     answers that one — `get_case_procurement` returns `assessable: false`
 *     with the missing field named — and this file deliberately holds no
 *     second copy of the rule.
 *
 * Non-finite and negative money is refused at every door here as it is at
 * every door in the migrations: `Number.isFinite` rejects NaN and both
 * infinities, which the SQL side matches with explicit NaN/Infinity checks
 * because `'NaN'::numeric = 'NaN'::numeric` is TRUE in Postgres and `>= 0`
 * alone does not keep it out.
 */

/** Mirrors `sync_calculation_code_version('case_procurement_position')`. */
export const PROCUREMENT_KERNEL_VERSION = "develop-procurement/6A/2026-12-08";

/** Mirrors `sync_procurement_status_dimensions()` — spec §25 names four. */
export const PROCUREMENT_STATUS_DIMENSIONS = [
  "technical",
  "commercial",
  "manufacturing",
  "delivery",
] as const;

export type ProcurementStatusDimension =
  (typeof PROCUREMENT_STATUS_DIMENSIONS)[number];

/** Mirrors `sync_procurement_status_values(dimension)`. */
export const PROCUREMENT_STATUS_VALUES: Record<
  ProcurementStatusDimension,
  readonly string[]
> = {
  technical: [
    "not_started",
    "specification_issued",
    "technically_evaluated",
    "technically_approved",
    "technically_rejected",
  ],
  commercial: [
    "not_started",
    "tendered",
    "bids_received",
    "commercially_evaluated",
    "awarded",
    "cancelled",
  ],
  manufacturing: [
    "not_applicable",
    "not_started",
    "released_for_manufacture",
    "in_manufacture",
    "manufacturing_complete",
    "factory_accepted",
    "on_hold",
  ],
  delivery: [
    "not_started",
    "in_transit",
    "delivered_to_site",
    "received_and_inspected",
    "rejected_on_receipt",
  ],
};

/** Mirrors `sync_bid_evaluation_kinds()` — spec I.16's two evaluation objects. */
export const BID_EVALUATION_KINDS = ["technical", "commercial"] as const;
export type BidEvaluationKind = (typeof BID_EVALUATION_KINDS)[number];

/** Mirrors `sync_bid_evaluation_outcomes()`. */
export const BID_EVALUATION_OUTCOMES = [
  "compliant",
  "compliant_with_qualifications",
  "non_compliant",
] as const;

/** Mirrors `sync_contract_types()` — spec I.17's seven strategies. */
export const CONTRACT_TYPES = [
  "lump_sum",
  "unit_rate",
  "epc",
  "epcm",
  "alliance",
  "owner_executed",
  "performance_contract",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

const TITLE_CASE = (value: string) =>
  value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Human wording for a §25 status value. Never invents an unknown value. */
export function statusLabel(value: string | null | undefined): string {
  if (!value || !value.trim()) return "not recorded";
  return TITLE_CASE(value.trim()).toLowerCase();
}

/** Human wording for an I.17 contract strategy. */
export function contractTypeLabel(value: string | null | undefined): string {
  if (!value) return "no contract type recorded";
  switch (value) {
    case "epc":
      return "EPC";
    case "epcm":
      return "EPCM";
    case "lump_sum":
      return "Lump sum";
    case "unit_rate":
      return "Unit rate";
    case "owner_executed":
      return "Owner-executed";
    case "performance_contract":
      return "Performance contract";
    case "alliance":
      return "Alliance";
    default:
      return value;
  }
}

export interface PackageStatuses {
  technical: string;
  commercial: string;
  manufacturing: string;
  delivery: string;
}

/**
 * The four §25 dimensions in one sentence, ALL FOUR always named.
 *
 * A summary that reported only the dimensions that had moved would let a
 * package look complete on a dimension nobody has ever touched, which is the
 * exact failure §25's four-way split exists to prevent.
 */
export function statusHeadline(statuses: PackageStatuses): string {
  return PROCUREMENT_STATUS_DIMENSIONS.map(
    (d) => `${d} ${statusLabel(statuses[d])}`,
  ).join(" · ");
}

/** A dimension whose value the server does not recognise, named not hidden. */
export function unknownStatusValues(statuses: PackageStatuses): string[] {
  return PROCUREMENT_STATUS_DIMENSIONS.filter(
    (d) => !PROCUREMENT_STATUS_VALUES[d].includes(statuses[d]),
  ).map((d) => `${d}: ${statuses[d]}`);
}

/**
 * THE LATENESS ARITHMETIC LIVES ON THE SERVER, AND ONLY THERE.
 *
 * This file used to export `packageLateness`, described as "mirroring
 * `case_procurement_gate_obligations`". It did not mirror it: it omitted the
 * discharge term and did not require the mandatory flag, and on the live
 * fixture it disagreed with the server inside one rendered payload — the
 * package headline read "delivery is forecast 45 day(s) after the date the
 * project needs it" directly above an empty blocker list and a passable gate.
 * Two answers to one question on one screen is the defect this programme
 * exists to remove, so the client copy is gone and the panel renders the
 * server's own `awardRequiredBy`, `slippageDays`, `assessable`,
 * `notAssessableReason` and `blockers`.
 *
 * The rule now has exactly one implementation:
 * `case_procurement_gate_obligations` (20261208090000), which the readiness
 * screen, the gate-review RPC, `enforce_gate_review_outstanding_obligations`
 * and `get_case_procurement` all read.
 */

export interface CommitmentLine {
  lineRef: string;
  description: string;
  amount: number | null;
  currency: string;
}

export type CommitmentTotal =
  | {
      answered: true;
      total: number;
      currency: string;
      lines: number;
    }
  | {
      answered: false;
      total: null;
      lines: number;
      unpricedLines: string[];
      refusal: string;
    };

/**
 * The commitment total, or its refusal — mirroring
 * `contract_commitment_position`.
 *
 * REFUSES over an empty line set (that is not a commitment of zero), refuses
 * while ANY line carries no agreed amount and NAMES those lines, refuses a
 * mixed-currency sum, and refuses a non-finite or negative amount by line. A
 * partial sum presented as the contract's commitment understates it by exactly
 * the amount nobody has agreed yet, and that is the figure a cost
 * reconciliation would then report as complete.
 */
export function commitmentTotal(
  lines: CommitmentLine[],
  contractCode = "this contract",
): CommitmentTotal {
  if (lines.length === 0) {
    return {
      answered: false,
      total: null,
      lines: 0,
      unpricedLines: [],
      refusal: `No commitment line has been recorded against ${contractCode}. That is not a commitment of zero: nothing has been coded to a cost line, so every controls figure on this case is short by the whole contract value.`,
    };
  }

  const bad = lines.filter(
    (l) =>
      l.amount !== null &&
      (!Number.isFinite(l.amount) || (l.amount as number) < 0),
  );
  if (bad.length > 0) {
    return {
      answered: false,
      total: null,
      lines: lines.length,
      unpricedLines: bad.map((l) => `${l.lineRef} (${l.amount})`),
      refusal: `${bad.length} commitment line(s) on ${contractCode} carry an amount that is not a finite number of at least zero: ${bad
        .map((l) => `${l.lineRef} (${l.amount})`)
        .join(
          "; ",
        )}. NaN and infinity pass every comparison test vacuously and turn each downstream total into NaN, so the total is refused rather than computed.`,
    };
  }

  const unpriced = lines.filter((l) => l.amount === null);
  if (unpriced.length > 0) {
    return {
      answered: false,
      total: null,
      lines: lines.length,
      unpricedLines: unpriced.map((l) => `${l.lineRef} (${l.description})`),
      refusal: `${unpriced.length} of ${lines.length} commitment lines on ${contractCode} carry no agreed amount: ${unpriced
        .map((l) => `${l.lineRef} (${l.description})`)
        .join(
          "; ",
        )}. The total is REFUSED rather than summed over the priced lines — a partial sum presented as the contract's commitment understates it by exactly the amount nobody has agreed yet.`,
    };
  }

  const currencies = [...new Set(lines.map((l) => l.currency))];
  if (currencies.length > 1) {
    return {
      answered: false,
      total: null,
      lines: lines.length,
      unpricedLines: [],
      refusal: `The commitment lines on ${contractCode} are stated in ${currencies.length} different currencies (${currencies.join(", ")}). Sync holds no exchange rate, so they are not summed.`,
    };
  }

  return {
    answered: true,
    total: lines.reduce((sum, l) => sum + (l.amount as number), 0),
    currency: currencies[0],
    lines: lines.length,
  };
}

export interface AwardReadinessInput {
  packageCode: string;
  bidsOpened: boolean;
  /** Live bids only — a withdrawn bid is not an offer on the table. */
  liveBidCount: number;
  withdrawnBidCount: number;
  /** Evaluation kinds recorded against the nominated winning bid. */
  evaluationsOnWinner: readonly string[];
  /** Outcomes recorded against the nominated winning bid. */
  outcomesOnWinner: readonly string[];
  /** true when the person about to award has evaluated a bid on this package. */
  awarderEvaluated: boolean;
}

export interface AwardReadiness {
  ready: boolean;
  /** Every reason the award is not ready, in the order a person hits them. */
  blockers: string[];
  headline: string;
}

/**
 * What still stands between this package and an award — the same refusals
 * `award_contract` makes, so the screen does not offer a button the server
 * will refuse.
 *
 * A PACKAGE WITH NO BIDS REFUSES. It does not report "0 bids evaluated": that
 * sentence reads as an evaluation that ran and found nothing better, which is
 * the opposite of what happened.
 */
export function awardReadiness(input: AwardReadinessInput): AwardReadiness {
  const blockers: string[] = [];

  if (!input.bidsOpened) {
    blockers.push(
      `Bids on ${input.packageCode} have not been opened. A contract awarded before the envelope is opened is awarded on prices nobody has seen.`,
    );
  }

  if (input.liveBidCount <= 0) {
    blockers.push(
      `No live bid exists on ${input.packageCode} (${input.liveBidCount + input.withdrawnBidCount} received, ${input.withdrawnBidCount} withdrawn). There is nothing to award — this is not a tender whose bids were evaluated and found wanting.`,
    );
  }

  // Sorted, matching `string_agg(k, ' and ' order by k)` in award_contract, so
  // the sentence the screen shows and the sentence the server refuses with are
  // word-for-word the same.
  const missing = BID_EVALUATION_KINDS.filter(
    (k) => !input.evaluationsOnWinner.includes(k),
  ).sort();
  if (input.liveBidCount > 0 && missing.length > 0) {
    blockers.push(
      `The nominated bid has no ${missing.join(" and ")} evaluation. Spec I.16 makes the technical and the commercial evaluation separate objects because they are separate judgements: awarding without one is awarding on the other alone.`,
    );
  }

  if (input.outcomesOnWinner.includes("non_compliant")) {
    blockers.push(
      `The nominated bid was evaluated NON-COMPLIANT. Awarding it overrules the evaluation recorded to prevent exactly this.`,
    );
  }

  if (input.awarderEvaluated) {
    blockers.push(
      `You evaluated a bid on ${input.packageCode}. An award is a decision taken on somebody else's assessment — one person doing both is what makes a competitive tender ceremonial.`,
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    headline:
      blockers.length === 0
        ? `${input.packageCode} is ready to award: the envelope is open, ${input.liveBidCount} live bid(s) are on the table and the nominated bid carries both evaluations.`
        : `${input.packageCode} cannot be awarded yet — ${blockers.length} thing(s) stand in the way.`,
  };
}

export interface SealedBidView {
  bidRef: string | null;
  supplier: string;
  sealed: boolean;
  price: number | null;
  currency: string | null;
  withdrawn: boolean;
}

/**
 * What a screen may say about a bid before the envelope is opened.
 *
 * The server already returns every content field as NULL while the package is
 * sealed (`get_package_tender`). This states the same rule client-side so a
 * component cannot render `price ?? 0` and turn an absent sealed price into a
 * zero-dollar bid on screen — which is how "sealed" quietly becomes "free".
 */
export function sealedBidDisclosure(bid: SealedBidView): string {
  if (bid.withdrawn) {
    return `${bid.supplier} — withdrawn`;
  }
  if (bid.sealed) {
    return `${bid.supplier} — bid lodged, SEALED until the envelopes are opened`;
  }
  if (bid.price === null || !Number.isFinite(bid.price)) {
    return `${bid.supplier} — no readable price on this bid`;
  }
  return `${bid.supplier} — ${bid.currency ?? ""} ${bid.price.toLocaleString()}`.trim();
}
