/**
 * Data governance (capability register E12.03–E12.06, E12.09, E12.11–E12.13).
 *
 * Everything the rest of this platform computes rests on the asset register
 * being able to say what is what. Two failures make that impossible and both
 * are present in real data.
 *
 * IDENTITY. An asset whose only identifier is a free-text name has no stable
 * identity. "Dozer 5390" is a label a person reads, not a key a system can
 * join on: rename it and every downstream reference breaks silently, and two
 * systems that both call it something slightly different can never be
 * reconciled. `assessIdentity` reports what proportion of a register is in
 * that state, because it bounds what every integration can ever achieve.
 *
 * DUPLICATES. The same physical machine entered twice splits its history in
 * half, and half a history fits a Weibull perfectly well while being wrong.
 * `detectDuplicates` returns CANDIDATES with a confidence and a reason, and
 * refuses to merge anything — the same pattern the interdependency slice uses
 * for derived edges, for the same reason: a wrong merge is far more expensive
 * to undo than a missed one.
 *
 * SENSOR VALIDATION. A sensor that has read exactly 47.3 for nine days is not
 * stable, it is stuck, and a health score computed from it is confident
 * nonsense. `validateReading` checks range, rate of change and stuck-at, and
 * distinguishes "outside the expected range" (which may be real) from
 * "physically impossible" (which is the instrument).
 *
 * Pure: no database, no network.
 */

export interface AssetIdentity {
  id: string;
  name: string;
  tag?: string | null;
  serialNumber?: string | null;
  assetClass?: string | null;
  siteId?: string | null;
}

export interface IdentityAssessment {
  total: number;
  withTag: number;
  withSerial: number;
  withStableId: number;
  nameOnly: number;
  reason: string;
}

/** Fold case, collapse whitespace, drop punctuation. */
function norm(v: string | null | undefined): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * How much of this register can actually be joined on?
 *
 * A tag or a serial number is a key. A name is a label, and the difference
 * decides whether an integration is possible at all.
 */
export function assessIdentity(assets: AssetIdentity[]): IdentityAssessment {
  const withTag = assets.filter((a) => norm(a.tag) !== "").length;
  const withSerial = assets.filter((a) => norm(a.serialNumber) !== "").length;
  const withStable = assets.filter(
    (a) => norm(a.tag) !== "" || norm(a.serialNumber) !== "",
  ).length;
  const nameOnly = assets.length - withStable;

  return {
    total: assets.length,
    withTag,
    withSerial,
    withStableId: withStable,
    nameOnly,
    reason:
      assets.length === 0
        ? "No assets to assess."
        : nameOnly === 0
          ? `All ${assets.length} assets carry a tag or a serial number, so every one can be joined on a stable key.`
          : nameOnly === assets.length
            ? `NONE of the ${assets.length} assets carries a tag or a serial number. Their identity is a free-text name, which is a label a person reads and not a key a system can join on — rename one and every downstream reference breaks silently. This bounds what any integration with this register can ever achieve, and no amount of analysis downstream can recover it.`
            : `${nameOnly} of ${assets.length} assets have no tag and no serial number, so they can only be matched on a free-text name. That is a label, not a key.`,
  };
}

export type DuplicateConfidence = "certain" | "probable" | "possible";

export interface DuplicateCandidate {
  aId: string;
  bId: string;
  aLabel: string;
  bLabel: string;
  confidence: DuplicateConfidence;
  basis: string;
}

export interface DuplicateResult {
  candidates: DuplicateCandidate[];
  comparableOn: string[];
  reason: string;
}

/** Token-overlap similarity, 0–1. Order-insensitive, which suits asset names. */
function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / new Set([...ta, ...tb]).size;
}

/**
 * Find assets that may be the same physical thing entered twice.
 *
 * Returns candidates only. Nothing is merged, because a wrong merge destroys
 * two histories and is far more expensive to undo than a missed one.
 */
export function detectDuplicates(
  assets: AssetIdentity[],
  nameThreshold = 0.8,
): DuplicateResult {
  const candidates: DuplicateCandidate[] = [];
  const comparable: string[] = [];
  if (assets.some((a) => norm(a.tag) !== "")) comparable.push("tag");
  if (assets.some((a) => norm(a.serialNumber) !== ""))
    comparable.push("serial number");
  comparable.push("name similarity");

  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i];
      const b = assets[j];

      const at = norm(a.tag);
      const bt = norm(b.tag);
      if (at !== "" && at === bt) {
        candidates.push({
          aId: a.id,
          bId: b.id,
          aLabel: a.name,
          bLabel: b.name,
          confidence: "certain",
          basis: `Identical tag "${a.tag}". A tag is meant to be unique, so this is a duplicate or a tagging error, and either way it is wrong.`,
        });
        continue;
      }

      const as = norm(a.serialNumber);
      const bs = norm(b.serialNumber);
      if (as !== "" && as === bs) {
        candidates.push({
          aId: a.id,
          bId: b.id,
          aLabel: a.name,
          bLabel: b.name,
          confidence: "certain",
          basis: `Identical serial number "${a.serialNumber}". One physical machine cannot be two assets.`,
        });
        continue;
      }

      // Name similarity only counts within the same class and site — a
      // "Pump 1" in two different plants is two pumps.
      const sameClass =
        norm(a.assetClass) !== "" && norm(a.assetClass) === norm(b.assetClass);
      const sameSite = (a.siteId ?? null) === (b.siteId ?? null);
      const sim = tokenSimilarity(a.name, b.name);

      if (sim >= nameThreshold && sameClass && sameSite) {
        candidates.push({
          aId: a.id,
          bId: b.id,
          aLabel: a.name,
          bLabel: b.name,
          confidence: sim >= 0.95 ? "probable" : "possible",
          basis: `Names are ${(sim * 100).toFixed(0)}% similar within the same class and site. Name similarity is evidence, not proof — two machines are often deliberately named alike.`,
        });
      }
    }
  }

  const certain = candidates.filter((c) => c.confidence === "certain").length;

  return {
    candidates,
    comparableOn: comparable,
    reason:
      assets.length === 0
        ? "No assets to compare."
        : candidates.length === 0
          ? `No duplicate candidates found across ${assets.length} assets, comparing on ${comparable.join(", ")}.` +
            (comparable.length === 1
              ? ` Only name similarity was available, so a duplicate entered under two different names would not have been found.`
              : "")
          : `${candidates.length} duplicate candidate(s) across ${assets.length} assets` +
            (certain > 0
              ? `, ${certain} of them certain on an identical tag or serial number`
              : ", none certain — all rest on name similarity, which is evidence and not proof") +
            `. Nothing is merged: a wrong merge destroys two histories and is far more expensive to undo than a missed one.`,
  };
}

export interface SensorRule {
  minValue?: number | null;
  maxValue?: number | null;
  /** Beyond this the reading is not merely unusual, it is impossible. */
  physicalMin?: number | null;
  physicalMax?: number | null;
  /** Largest credible change per hour. */
  maxRatePerHour?: number | null;
  /** Identical consecutive readings before the sensor is called stuck. */
  stuckAfterReadings?: number | null;
}

export interface Reading {
  at: string;
  value: number;
}

export type SensorVerdict =
  | "valid"
  | "no_data"
  | "out_of_range"
  | "physically_impossible"
  | "rate_implausible"
  | "stuck";

export interface ValidationResult {
  verdict: SensorVerdict;
  usable: boolean;
  reason: string;
}

/**
 * Is this reading usable?
 *
 * The distinction that matters: "outside the expected range" may be a real
 * excursion worth acting on, while "physically impossible" is the instrument
 * and acting on it is acting on nothing. A stuck sensor is the dangerous case,
 * because it looks like stability.
 */
export function validateReading(
  history: Reading[],
  rule: SensorRule,
): ValidationResult {
  if (history.length === 0) {
    // Deliberately NOT "valid": a sensor with no readings has not passed
    // validation, it has skipped it, and reporting those as valid is how an
    // unusable count and a green verdict end up in the same panel.
    return {
      verdict: "no_data",
      usable: false,
      reason:
        "No readings recorded, so there is nothing to validate. This is not a pass — an unread sensor and a healthy one look identical from here.",
    };
  }
  const sorted = [...history].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  const latest = sorted[sorted.length - 1];

  if (
    (rule.physicalMin != null && latest.value < rule.physicalMin) ||
    (rule.physicalMax != null && latest.value > rule.physicalMax)
  ) {
    return {
      verdict: "physically_impossible",
      usable: false,
      reason: `${latest.value} is outside the physically possible range (${rule.physicalMin ?? "−∞"} to ${rule.physicalMax ?? "∞"}). This is the instrument, not the process, and acting on it would be acting on nothing.`,
    };
  }

  const stuckAfter = rule.stuckAfterReadings ?? 0;
  if (stuckAfter > 1 && sorted.length >= stuckAfter) {
    const tail = sorted.slice(-stuckAfter);
    if (tail.every((r) => r.value === tail[0].value)) {
      return {
        verdict: "stuck",
        usable: false,
        reason: `The last ${stuckAfter} readings are all exactly ${tail[0].value}. A sensor reading precisely the same value repeatedly is not stable, it is stuck — and it is the dangerous case, because a flat line looks like health.`,
      };
    }
  }

  if (rule.maxRatePerHour != null && sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    const hours =
      (new Date(latest.at).getTime() - new Date(prev.at).getTime()) / 3_600_000;
    if (hours > 0) {
      const rate = Math.abs(latest.value - prev.value) / hours;
      if (rate > rule.maxRatePerHour) {
        return {
          verdict: "rate_implausible",
          usable: false,
          reason: `Changed by ${Math.abs(latest.value - prev.value).toFixed(2)} in ${hours.toFixed(1)} h, a rate of ${rate.toFixed(2)}/h against a credible maximum of ${rule.maxRatePerHour}/h. Either the reading is wrong or the timestamps are.`,
        };
      }
    }
  }

  if (
    (rule.minValue != null && latest.value < rule.minValue) ||
    (rule.maxValue != null && latest.value > rule.maxValue)
  ) {
    return {
      verdict: "out_of_range",
      usable: true,
      reason: `${latest.value} is outside the expected range (${rule.minValue ?? "−∞"} to ${rule.maxValue ?? "∞"}) but is physically possible. This may be a real excursion and is kept, flagged rather than discarded.`,
    };
  }

  return {
    verdict: "valid",
    usable: true,
    reason: `${latest.value} is within range, changed plausibly, and is not stuck.`,
  };
}
