/**
 * Contractor and supplier analysis (capability register E7.01–E7.14).
 *
 * Three functions, each built around a thing the platform would otherwise get
 * confidently wrong.
 *
 * `compareBids` REFUSES TO RANK ON PRICE ALONE. Two bids are not comparable
 * until you know what each assumed about how much work gets done per hour. A
 * contractor who assumed 0.5 productivity has priced the same job at twice the
 * hours of one who assumed 1.0, and the cheaper bid is frequently the one that
 * understood the site least. Where the assumption is not stated, the
 * comparison is returned as UNSAFE rather than as a ranking with a caveat
 * nobody reads.
 *
 * `assessObsolescence` COMPARES AGAINST THE ASSET, NOT THE CALENDAR. A part
 * going end-of-life in 2030 is irrelevant for a machine being replaced in 2028
 * and urgent for one expected to run to 2045. An obsolescence list sorted by
 * date alone gets acted on in the wrong order.
 *
 * `soleSourceRisk` SEPARATES ONE APPROVED SUPPLIER FROM ONE RECORDED SUPPLIER.
 * The first is a genuine single point of failure. The second is usually
 * unfinished sourcing, and treating it as the first wastes the qualification
 * effort the first actually needs.
 *
 * Pure: no database, no network.
 */

const DAY = 86_400_000;

export interface Bid {
  supplier: string;
  price: number;
  labourHours?: number | null;
  assumedProductivityFactor?: number | null;
  durationDays?: number | null;
  qualifications?: string | null;
}

export interface PackageClarity {
  scopeStated: boolean;
  exclusionsStated: boolean;
  acceptanceStated: boolean;
  siteConditionsStated: boolean;
}

export interface NormalisedBid extends Bid {
  /** Hours re-expressed at a common productivity assumption. */
  normalisedHours: number | null;
  /** Price per normalised hour, where both are known. */
  pricePerNormalisedHour: number | null;
}

export interface BidComparison {
  comparable: boolean;
  bids: NormalisedBid[];
  cheapest: string | null;
  bestValue: string | null;
  clarityGaps: string[];
  reason: string;
}

/**
 * Compare bids, or refuse to.
 *
 * `referenceProductivity` is the assumption the comparison is normalised to.
 * A bid stating 1000 hours at a 0.5 factor is doing 500 reference-hours of
 * work; one stating 600 hours at 1.0 is doing 600. Those are different jobs
 * and the prices are not comparable until they are on the same footing.
 */
export function compareBids(
  bids: Bid[],
  clarity: PackageClarity,
  referenceProductivity = 1.0,
): BidComparison {
  const clarityGaps: string[] = [];
  if (!clarity.scopeStated) clarityGaps.push("no scope of work recorded");
  if (!clarity.exclusionsStated) clarityGaps.push("no exclusions recorded");
  if (!clarity.acceptanceStated)
    clarityGaps.push("no acceptance criteria recorded");
  if (!clarity.siteConditionsStated)
    clarityGaps.push("site conditions not stated");

  if (bids.length < 2) {
    return {
      comparable: false,
      bids: bids.map((b) => ({
        ...b,
        normalisedHours: null,
        pricePerNormalisedHour: null,
      })),
      cheapest: bids[0]?.supplier ?? null,
      bestValue: null,
      clarityGaps,
      reason:
        bids.length === 0
          ? "No bids are recorded for this package."
          : `Only one bid is recorded, so there is nothing to compare it against. A single bid is a price, not a market test.`,
    };
  }

  const missingProductivity = bids.filter(
    (b) => !(b.assumedProductivityFactor && b.assumedProductivityFactor > 0),
  );

  const normalised: NormalisedBid[] = bids.map((b) => {
    const factor = b.assumedProductivityFactor;
    const hours =
      b.labourHours && factor && factor > 0
        ? (b.labourHours * factor) / referenceProductivity
        : null;
    return {
      ...b,
      normalisedHours: hours,
      pricePerNormalisedHour: hours && hours > 0 ? b.price / hours : null,
    };
  });

  const sortedByPrice = [...bids].sort((a, b) => a.price - b.price);
  const cheapest = sortedByPrice[0].supplier;

  if (missingProductivity.length > 0) {
    return {
      comparable: false,
      bids: normalised,
      cheapest,
      bestValue: null,
      clarityGaps,
      reason:
        `Not comparable on price. ${missingProductivity.length} of ${bids.length} bid(s) state no productivity assumption ` +
        `(${missingProductivity.map((b) => b.supplier).join(", ")}), so there is no way to tell whether a lower price ` +
        `reflects efficiency or a smaller understanding of the job. The cheapest bid is ${cheapest} — that is a fact about ` +
        `the prices, not a recommendation.` +
        (clarityGaps.length > 0
          ? ` The package also has ${clarityGaps.length} clarity gap(s): ${clarityGaps.join(", ")}. Bids against an unclear scope get settled later as claims.`
          : ""),
    };
  }

  const withRate = normalised.filter((b) => b.pricePerNormalisedHour !== null);
  const bestValue =
    withRate.length > 0
      ? withRate.reduce((best, b) =>
          (b.pricePerNormalisedHour as number) <
          (best.pricePerNormalisedHour as number)
            ? b
            : best,
        ).supplier
      : null;

  return {
    comparable: true,
    bids: normalised,
    cheapest,
    bestValue,
    clarityGaps,
    reason:
      `All ${bids.length} bids state a productivity assumption and are normalised to ${referenceProductivity}. ` +
      (bestValue && bestValue !== cheapest
        ? `${cheapest} is cheapest on price; ${bestValue} is cheapest per hour of work actually assumed. The gap between those two is the productivity assumption doing its job.`
        : `${cheapest} is cheapest on both price and normalised hours.`) +
      (clarityGaps.length > 0
        ? ` ${clarityGaps.length} clarity gap(s) remain: ${clarityGaps.join(", ")}.`
        : ""),
  };
}

export type LifecycleStatus =
  | "unknown"
  | "active"
  | "mature"
  | "last_time_buy"
  | "end_of_life"
  | "obsolete";

export interface ObsolescenceInput {
  materialCode: string;
  description: string;
  lifecycleStatus: LifecycleStatus;
  lastTimeBuyDate?: string | null;
  /** Years the assets consuming this part are still expected to run. */
  assetRemainingLifeYears?: number | null;
  assetsUsing: number;
  criticality?: string | null;
}

export interface ObsolescenceVerdict {
  materialCode: string;
  urgency: "none" | "watch" | "act" | "urgent";
  yearsUncovered: number | null;
  reason: string;
}

/**
 * Rank obsolescence by the gap it leaves, not by its date.
 *
 * `yearsUncovered` is the part of the asset's remaining life that has no
 * supply behind it. That number, not the end-of-life date, is what decides
 * whether this needs a last-time buy, a redesign, or nothing at all.
 */
export function assessObsolescence(
  items: ObsolescenceInput[],
  asOf: Date = new Date(0),
): ObsolescenceVerdict[] {
  return items
    .map((i) => {
      const atRisk =
        i.lifecycleStatus === "obsolete" ||
        i.lifecycleStatus === "end_of_life" ||
        i.lifecycleStatus === "last_time_buy";

      if (!atRisk) {
        return {
          materialCode: i.materialCode,
          urgency: "none" as const,
          yearsUncovered: null,
          reason:
            i.lifecycleStatus === "unknown"
              ? `Lifecycle status is not recorded. That is not the same as active — nobody has asked the supplier.`
              : `Supplier reports the part as ${i.lifecycleStatus}.`,
        };
      }

      if (i.assetRemainingLifeYears == null) {
        return {
          materialCode: i.materialCode,
          urgency: "watch" as const,
          yearsUncovered: null,
          reason:
            `Part is ${i.lifecycleStatus.replace(/_/g, " ")}, and the remaining life of the ${i.assetsUsing} asset(s) using it ` +
            `is not recorded. Without that, there is no way to say whether this matters — an obsolete part is only a problem ` +
            `for as long as the machine outlives it.`,
        };
      }

      // How long supply is assured. A last-time-buy date bounds it; otherwise
      // obsolete means it is already over.
      const yearsOfSupply = i.lastTimeBuyDate
        ? Math.max(
            0,
            (new Date(i.lastTimeBuyDate).getTime() - asOf.getTime()) /
              (365 * DAY),
          )
        : 0;
      const uncovered = i.assetRemainingLifeYears - yearsOfSupply;

      const urgency =
        uncovered <= 0
          ? ("none" as const)
          : i.criticality === "critical" || uncovered > 10
            ? ("urgent" as const)
            : uncovered > 3
              ? ("act" as const)
              : ("watch" as const);

      return {
        materialCode: i.materialCode,
        urgency,
        yearsUncovered: Number(uncovered.toFixed(1)),
        reason:
          uncovered <= 0
            ? `Part is ${i.lifecycleStatus.replace(/_/g, " ")} but supply is assured past the ${i.assetRemainingLifeYears}-year remaining life of the assets using it. Nothing to do.`
            : `${i.assetsUsing} asset(s) are expected to run ${i.assetRemainingLifeYears} more year(s); supply is assured for ${yearsOfSupply.toFixed(1)}. ` +
              `${uncovered.toFixed(1)} year(s) of that life have no source behind them — a last-time buy, an approved alternative, or a redesign, and the first of those has a deadline.`,
      };
    })
    .sort((a, b) => {
      const rank = { urgent: 0, act: 1, watch: 2, none: 3 };
      return (
        rank[a.urgency] - rank[b.urgency] ||
        (b.yearsUncovered ?? 0) - (a.yearsUncovered ?? 0)
      );
    });
}

export interface SourceCount {
  materialCode: string;
  criticality?: string | null;
  leadTimeDays?: number | null;
  approvedSuppliers: number;
  recordedSuppliers: number;
}

export interface SoleSourceResult {
  soleApproved: SourceCount[];
  unfinishedSourcing: SourceCount[];
  noSource: SourceCount[];
  reason: string;
}

/**
 * The supply-chain form of a single point of failure.
 *
 * Deliberately three buckets rather than one list. "One approved supplier" is
 * a risk to carry or mitigate; "one recorded, none approved" is a job half
 * done; "none at all" is a lead time nobody can hold anyone to. They need
 * different work, and merging them produces a list nobody can action.
 */
export function soleSourceRisk(counts: SourceCount[]): SoleSourceResult {
  const soleApproved = counts
    .filter((c) => c.approvedSuppliers === 1)
    .sort(
      (a, b) =>
        critRank(a.criticality) - critRank(b.criticality) ||
        (b.leadTimeDays ?? 0) - (a.leadTimeDays ?? 0),
    );
  const unfinished = counts.filter(
    (c) => c.approvedSuppliers === 0 && c.recordedSuppliers > 0,
  );
  const none = counts.filter(
    (c) => c.approvedSuppliers === 0 && c.recordedSuppliers === 0,
  );

  const worst = soleApproved[0];
  return {
    soleApproved,
    unfinishedSourcing: unfinished,
    noSource: none,
    reason:
      counts.length === 0
        ? "No materials have supplier records, so sole-source exposure cannot be assessed."
        : [
            soleApproved.length > 0
              ? `${soleApproved.length} material(s) have exactly one approved supplier.` +
                (worst
                  ? ` The most exposed is ${worst.materialCode}${worst.criticality ? ` (${worst.criticality})` : ""}${worst.leadTimeDays ? ` at ${worst.leadTimeDays} days' lead time` : ""} — if that supplier cannot deliver, there is no second call to make.`
                  : "")
              : "No material depends on a single approved supplier.",
            unfinished.length > 0
              ? `${unfinished.length} have a supplier recorded but none approved for the part, which is unfinished sourcing rather than sole source.`
              : null,
            none.length > 0
              ? `${none.length} have no supplier at all — a lead time nobody can be held to.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
  };
}

function critRank(c?: string | null): number {
  return c === "critical" ? 0 : c === "essential" ? 1 : 2;
}
