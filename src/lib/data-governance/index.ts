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

// ---------------------------------------------------------------------------
// COMPONENT-SIGNATURE ARCHITECTURE INFERENCE
//
// Added after a real investigation where every free-text field on a 144-asset
// fleet was empty and the ONLY evidence of what each machine was came from the
// component vocabulary its work orders used. Thirteen assets turned out to be
// mislabelled, and the labels had been wrong since import.
//
// The insight is simple and worth stating: a machine's work history names its
// parts, and its parts reveal its architecture. A record showing heavy
// UNDERCARRIAGE activity and no TIRES is tracked. One showing TRANSMISSION,
// DIFFERENTIAL and STEERING with no undercarriage is wheeled. Nothing about
// the asset record itself has to be trusted for that to work.
//
// The marker vocabulary is a PARAMETER, not a constant, because the component
// taxonomy differs at every operator — the same reason the unit-numbering
// rules are per-organization.
// ---------------------------------------------------------------------------

export type Architecture = "tracked" | "wheeled" | "mixed" | "indeterminate";

export interface ComponentCount {
  systemGroup: string;
  count: number;
}

export interface ArchitectureMarkers {
  /** System groups that only a tracked machine has. */
  tracked: string[];
  /** System groups that only a wheeled machine has. */
  wheeled: string[];
  /** System groups indicating a boom/stick/bucket front end. */
  boom?: string[];
}

export interface ArchitectureVerdict {
  architecture: Architecture;
  trackedEvents: number;
  wheeledEvents: number;
  boomEvents: number;
  totalEvents: number;
  /** True when the evidence is thin enough that the verdict is a hint. */
  provisional: boolean;
  reason: string;
}

/**
 * What kind of machine does this work history describe?
 *
 * `minimumEvents` guards the honest limit: an architecture called from a
 * handful of work orders is a hint, and it is returned flagged provisional
 * rather than withheld, because a hint about a mislabelled asset is still
 * worth having.
 */
export function inferArchitecture(
  components: ComponentCount[],
  markers: ArchitectureMarkers,
  minimumEvents = 30,
): ArchitectureVerdict {
  const sum = (names: string[]) =>
    components
      .filter((c) =>
        names.some((n) => c.systemGroup?.toUpperCase() === n.toUpperCase()),
      )
      .reduce((s, c) => s + c.count, 0);

  const tracked = sum(markers.tracked);
  const wheeled = sum(markers.wheeled);
  const boom = markers.boom ? sum(markers.boom) : 0;
  const total = components.reduce((s, c) => s + c.count, 0);

  if (total === 0) {
    return {
      architecture: "indeterminate",
      trackedEvents: 0,
      wheeledEvents: 0,
      boomEvents: 0,
      totalEvents: 0,
      provisional: true,
      reason:
        "No component-level work history, so nothing can be inferred. This is the common case for an asset nobody has coded work against, and it is not evidence that the recorded class is right.",
    };
  }

  const provisional = total < minimumEvents;
  let architecture: Architecture;
  if (tracked > 0 && wheeled === 0) architecture = "tracked";
  else if (wheeled > 0 && tracked === 0) architecture = "wheeled";
  else if (tracked > 0 && wheeled > 0) architecture = "mixed";
  else architecture = "indeterminate";

  const detail =
    architecture === "tracked"
      ? `${tracked} tracked-only component event(s) and NO wheeled ones.`
      : architecture === "wheeled"
        ? `${wheeled} wheeled-only component event(s) and NO tracked ones.`
        : architecture === "mixed"
          ? `${tracked} tracked and ${wheeled} wheeled component event(s) — either the history covers more than one machine, or the marker vocabulary needs refining for this operator.`
          : `Neither tracked nor wheeled markers appear in ${total} event(s), so the vocabulary does not distinguish this machine.`;

  return {
    architecture,
    trackedEvents: tracked,
    wheeledEvents: wheeled,
    boomEvents: boom,
    totalEvents: total,
    provisional,
    reason:
      detail +
      (boom > 0
        ? ` ${boom} boom/stick/bucket event(s) indicate a front-end attachment.`
        : "") +
      (provisional
        ? ` Based on only ${total} event(s), below the ${minimumEvents} this treats as sufficient — a hint, not a finding.`
        : ""),
  };
}

export interface ClassExpectation {
  assetClass: string;
  expected: Architecture;
}

export interface ClassCheck {
  agrees: boolean | null;
  reason: string;
}

/**
 * Does the inferred architecture agree with the recorded class?
 *
 * Returns null for agreement when either side is indeterminate, rather than
 * defaulting to "agrees" — an unknown is not a pass.
 */
export function checkClassAgainstArchitecture(
  recordedClass: string,
  verdict: ArchitectureVerdict,
  expectations: ClassExpectation[],
): ClassCheck {
  const exp = expectations.find(
    (e) => e.assetClass.toLowerCase() === recordedClass.toLowerCase(),
  );
  if (!exp) {
    return {
      agrees: null,
      reason: `No architecture is recorded for the class "${recordedClass}", so the class cannot be checked against the work history.`,
    };
  }
  if (
    verdict.architecture === "indeterminate" ||
    verdict.architecture === "mixed"
  ) {
    return {
      agrees: null,
      reason: `The work history does not resolve to a single architecture, so it neither confirms nor contradicts "${recordedClass}".`,
    };
  }
  const agrees = verdict.architecture === exp.expected;
  return {
    agrees,
    reason: agrees
      ? `Recorded as "${recordedClass}" and the work history agrees: ${verdict.architecture}.`
      : `Recorded as "${recordedClass}", which should be ${exp.expected}, but the work history says ${verdict.architecture}. ${verdict.reason} Either the class is wrong or this machine is not what its class says it is.` +
        (verdict.provisional
          ? " Treat as a question rather than a conclusion."
          : ""),
  };
}

// ---------------------------------------------------------------------------
// RECLASSIFICATION DETECTION
//
// The duplicate detector above excludes pairs whose asset_class differs, to
// stop "Pump 1" matching "Compressor 1". That exclusion is right in general and
// it suppresses the single most common real duplicate: the same machine
// recorded twice because somebody changed its class, splitting its history.
//
// The signal that catches it is not similarity at all. It is TIME: two records
// sharing an identifier whose activity windows do not overlap by a single day
// are one machine handed over, not two machines running.
// ---------------------------------------------------------------------------

export interface ActivityWindow {
  assetId: string;
  label: string;
  identifier: string;
  assetClass?: string | null;
  firstActivity: string;
  lastActivity: string;
  eventCount: number;
}

export interface ReclassificationPair {
  earlier: ActivityWindow;
  later: ActivityWindow;
  gapDays: number;
  reason: string;
}

export interface ReclassificationResult {
  reclassifications: ReclassificationPair[];
  concurrent: { a: ActivityWindow; b: ActivityWindow; reason: string }[];
  reason: string;
}

/**
 * Same identifier, different records: reclassified, or genuinely two machines?
 *
 * Non-overlapping windows mean one machine handed over between two records.
 * Overlapping windows mean two records were live at once, which is a different
 * and worse problem — a shared identifier on concurrent machines.
 */
export function detectReclassifications(
  windows: ActivityWindow[],
  maxGapDays = 90,
): ReclassificationResult {
  const byId = new Map<string, ActivityWindow[]>();
  for (const w of windows) {
    if (!w.identifier) continue;
    byId.set(w.identifier, [...(byId.get(w.identifier) ?? []), w]);
  }

  const reclass: ReclassificationPair[] = [];
  const concurrent: { a: ActivityWindow; b: ActivityWindow; reason: string }[] =
    [];

  for (const [identifier, group] of byId) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const aEnd = new Date(a.lastActivity).getTime();
        const bStart = new Date(b.firstActivity).getTime();
        const bEnd = new Date(b.lastActivity).getTime();
        const aStart = new Date(a.firstActivity).getTime();

        const aFirst = aEnd < bStart;
        const bFirst = bEnd < aStart;

        if (!aFirst && !bFirst) {
          concurrent.push({
            a,
            b,
            reason: `"${a.label}" and "${b.label}" share identifier ${identifier} and were BOTH active at the same time. That is not a reclassification — it is one identifier on two concurrent records, and every figure keyed on that identifier is ambiguous.`,
          });
          continue;
        }

        const earlier = aFirst ? a : b;
        const later = aFirst ? b : a;
        const gap = Math.round(
          (new Date(later.firstActivity).getTime() -
            new Date(earlier.lastActivity).getTime()) /
            86_400_000,
        );
        if (gap > maxGapDays) continue;

        reclass.push({
          earlier,
          later,
          gapDays: gap,
          reason:
            `"${earlier.label}" ran to ${earlier.lastActivity.slice(0, 10)} and "${later.label}" began ${later.firstActivity.slice(0, 10)} — a ${gap}-day handover on identifier ${identifier}, with no overlap. ` +
            (earlier.assetClass !== later.assetClass
              ? `The class changed from "${earlier.assetClass}" to "${later.assetClass}", which is why a similarity-based duplicate check would not find this. `
              : "") +
            `One machine reclassified splits its history: ${earlier.eventCount} events on one record and ${later.eventCount} on the other, and half a history fits a distribution perfectly well while being wrong.`,
        });
      }
    }
  }

  reclass.sort((x, y) => x.gapDays - y.gapDays);

  return {
    reclassifications: reclass,
    concurrent,
    reason:
      windows.length === 0
        ? "No activity windows supplied."
        : reclass.length === 0 && concurrent.length === 0
          ? `No shared identifier shows either a handover or a concurrent overlap across ${windows.length} record(s).`
          : `${reclass.length} probable reclassification(s) — one machine recorded twice with its history split.` +
            (concurrent.length > 0
              ? ` ${concurrent.length} shared identifier(s) were active CONCURRENTLY, which is a worse problem: every figure keyed on those is ambiguous.`
              : ""),
  };
}

// ---------------------------------------------------------------------------
// DORMANCY: assets that stop existing without anyone saying so
//
// Added after an asset in a real fleet turned out to have 21 work orders packed
// into 93 days at the same intensity as the busiest machine on site — and then
// nothing at all for the remaining 27 months of the dataset.
//
// The owner's reading was that it was "hardly used". The data says the
// opposite: it was worked hard and then STOPPED, which is a different question
// with a different answer. Sold, transferred, renumbered, or simply no longer
// maintained through this system — each has different consequences, and an
// asset register that still carries it as live is wrong in all four cases.
//
// The distinction this makes is between LOW INTENSITY (few events spread over
// the whole period) and TRUNCATION (normal intensity that ends). Averaging
// events per year cannot tell those apart, which is why most registers never
// notice.
// ---------------------------------------------------------------------------

export interface DormancyInput {
  assetId: string;
  label: string;
  firstActivity: string;
  lastActivity: string;
  eventCount: number;
}

export type ActivityPattern =
  "active" | "low_intensity" | "truncated" | "single_event" | "no_activity";

export interface DormancyVerdict {
  assetId: string;
  label: string;
  pattern: ActivityPattern;
  activeDays: number;
  dormantDays: number;
  daysPerEvent: number | null;
  reason: string;
}

/**
 * Did this asset go quiet, and if so was it ever busy?
 *
 * `observationEnd` is the last date the DATASET covers, not today: an asset
 * looks dormant against the present simply because the extract is old, and
 * that is a property of the data rather than the machine.
 */
export function detectDormancy(
  assets: DormancyInput[],
  observationEnd: string,
  dormantAfterDays = 180,
): DormancyVerdict[] {
  const end = new Date(observationEnd).getTime();

  return assets
    .map((a) => {
      const first = new Date(a.firstActivity).getTime();
      const last = new Date(a.lastActivity).getTime();
      const activeDays = Math.max(0, Math.round((last - first) / 86_400_000));
      const dormantDays = Math.max(0, Math.round((end - last) / 86_400_000));
      const daysPerEvent =
        a.eventCount > 0 && activeDays > 0 ? activeDays / a.eventCount : null;

      let pattern: ActivityPattern;
      if (a.eventCount === 0) pattern = "no_activity";
      else if (a.eventCount === 1) pattern = "single_event";
      else if (dormantDays >= dormantAfterDays) pattern = "truncated";
      else if (daysPerEvent !== null && daysPerEvent > 60)
        pattern = "low_intensity";
      else pattern = "active";

      const intensity =
        daysPerEvent !== null
          ? `one event every ${daysPerEvent.toFixed(1)} days while active`
          : "no measurable intensity";

      return {
        assetId: a.assetId,
        label: a.label,
        pattern,
        activeDays,
        dormantDays,
        daysPerEvent,
        reason:
          pattern === "truncated"
            ? `${a.eventCount} event(s) across ${activeDays} days — ${intensity} — then NOTHING for ${dormantDays} days to the end of the record. ` +
              `That is not low usage; it is an asset that stopped. Sold, transferred, renumbered, or no longer maintained through this system — each has different consequences, and a register still carrying it as live is wrong in all four cases.`
            : pattern === "low_intensity"
              ? `${a.eventCount} event(s) spread across ${activeDays} days — ${intensity} — and still active at the end of the record. Genuinely light duty rather than a machine that stopped.`
              : pattern === "single_event"
                ? `A single recorded event. Nothing can be said about intensity or dormancy from one point.`
                : pattern === "no_activity"
                  ? `No recorded activity at all. The asset exists in the register and nowhere else.`
                  : `${a.eventCount} event(s), ${intensity}, active to within ${dormantDays} days of the end of the record.`,
      };
    })
    .sort((a, b) => b.dormantDays - a.dormantDays);
}
