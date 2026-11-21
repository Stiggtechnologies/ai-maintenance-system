/**
 * Ranking rules for a production-constraint study.
 *
 * The database function `record_production_constraint_study` is the authority
 * at runtime. This module is the same rule, locked by unit tests: the lowest
 * declared limit in the study unit is the bottleneck, tied limits are all
 * named, and a missing limit is not spare capacity. Limits are alternative
 * ceilings. They are never added together, and a demonstrated production
 * record is never an input.
 */

export const CONSTRAINT_KINDS = [
  ["equipment", "Equipment"],
  ["upstream", "Upstream"],
  ["downstream", "Downstream"],
  ["utility", "Utility"],
  ["material", "Material"],
  ["workforce", "Workforce"],
  ["quality", "Quality"],
  ["changeover", "Changeover"],
  ["isolation", "Isolation or permit window"],
  ["other", "Other"],
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number][0];

export const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/;

const SCALE = 1_000_000n;
const KIND_SET = new Set<string>(CONSTRAINT_KINDS.map(([kind]) => kind));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeclaredLimit {
  key: string;
  kind: string;
  availableQuantity: string | null;
  unitOfMeasure: string;
}

export type BottleneckReason =
  "no_limits_declared" | "mixed_units" | "unquantified_limit";

export interface RankedConstraints {
  assessable: boolean;
  reasons: BottleneckReason[];
  bottleneckKeys: string[];
  primaryKey: string | null;
  availableQuantity: string | null;
  headroom: string | null;
  binding: boolean | null;
}

export function parseQuantity(raw: string): bigint | null {
  const text = raw.trim();
  if (!QUANTITY_PATTERN.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole) * SCALE + BigInt(padded);
}

export function formatQuantity(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/**
 * Rank limits that have already passed the input gate.
 * An empty list, a unit conflict, or a blank quantity refuses the ranking.
 */
export function rankProductionConstraints(
  requiredQuantity: string,
  unitOfMeasure: string,
  limits: readonly DeclaredLimit[],
): RankedConstraints {
  const required = parseQuantity(requiredQuantity);
  if (required === null || required <= 0n) {
    throw new Error(
      "required quantity must be a positive decimal before ranking",
    );
  }
  const unit = unitOfMeasure.trim();
  if (unit.length === 0) {
    throw new Error("study unit is required before ranking");
  }

  if (limits.length === 0) {
    return unranked(["no_limits_declared"]);
  }

  const reasons: BottleneckReason[] = [];
  if (limits.some((limit) => limit.unitOfMeasure.trim() !== unit)) {
    reasons.push("mixed_units");
  }
  if (
    limits.some(
      (limit) =>
        limit.availableQuantity === null ||
        limit.availableQuantity.trim() === "",
    )
  ) {
    reasons.push("unquantified_limit");
  }
  if (reasons.length > 0) return unranked(reasons);

  const parsed = limits.map((limit) => {
    const available = parseQuantity(limit.availableQuantity ?? "");
    if (available === null) {
      throw new Error("a ranked limit must carry a non-negative quantity");
    }
    return {
      key: limit.key.trim(),
      kind: limit.kind,
      available,
    };
  });
  const minimum = parsed.reduce(
    (lowest, limit) => (limit.available < lowest ? limit.available : lowest),
    parsed[0].available,
  );
  const tied = parsed
    .filter((limit) => limit.available === minimum)
    .sort((left, right) => {
      const byKind = left.kind.localeCompare(right.kind);
      return byKind !== 0 ? byKind : left.key.localeCompare(right.key);
    });
  return {
    assessable: true,
    reasons: [],
    bottleneckKeys: tied.map((limit) => limit.key),
    primaryKey: tied[0]?.key ?? null,
    availableQuantity: formatQuantity(minimum),
    headroom: formatQuantity(minimum - required),
    binding: minimum < required,
  };
}

function unranked(reasons: BottleneckReason[]): RankedConstraints {
  return {
    assessable: false,
    reasons,
    bottleneckKeys: [],
    primaryKey: null,
    availableQuantity: null,
    headroom: null,
    binding: null,
  };
}

export interface StudyDraft {
  title: string;
  siteId: string;
  horizonStart: string;
  horizonEnd: string;
  requiredQuantity: string;
  unitOfMeasure: string;
  basis: string;
  limits: Array<{
    key: string;
    kind: string;
    availableQuantity: string | null;
    unitOfMeasure: string;
    basis: string;
    assetId: string | null;
    constraintSignalId: string | null;
  }>;
}

/** Hard refusals. A missing or conflicting limit is not one of them. */
export function studyInputError(draft: StudyDraft): string | null {
  const title = draft.title.trim();
  const basis = draft.basis.trim();
  const unit = draft.unitOfMeasure.trim();
  const required = parseQuantity(draft.requiredQuantity);
  if (title.length < 3 || title.length > 160) {
    return "Title must be between 3 and 160 characters.";
  }
  if (!draft.siteId.trim()) return "Choose the site this study applies to.";
  if (!draft.horizonStart || !draft.horizonEnd) {
    return "The horizon needs a start and an end.";
  }
  const start = Date.parse(draft.horizonStart);
  const end = Date.parse(draft.horizonEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "The horizon end must be after the horizon start.";
  }
  if (required === null || required <= 0n) {
    return "Required quantity must be a positive number with at most 6 decimal places.";
  }
  if (unit.length < 1 || unit.length > 32) {
    return "The study unit is required and must be 32 characters or fewer.";
  }
  if (basis.length < 20 || basis.length > 2000) {
    return "Record an evidence basis of at least 20 characters.";
  }
  if (draft.limits.length > 40) return "A study can record at most 40 limits.";

  const seen = new Set<string>();
  for (const limit of draft.limits) {
    const key = limit.key.trim();
    const limitBasis = limit.basis.trim();
    const limitUnit = limit.unitOfMeasure.trim();
    if (key.length < 1 || key.length > 80) {
      return "Each limit needs a key of 1 to 80 characters.";
    }
    if (seen.has(key))
      return "Constraint keys must be unique within the study.";
    seen.add(key);
    if (!KIND_SET.has(limit.kind)) return "Unsupported constraint kind.";
    if (limitBasis.length < 20 || limitBasis.length > 2000) {
      return "Each limit needs an evidence basis of at least 20 characters.";
    }
    if (limitUnit.length < 1 || limitUnit.length > 32) {
      return "Each limit needs its own unit of measure.";
    }
    const quantity = limit.availableQuantity?.trim() ?? "";
    if (quantity.length > 0 && parseQuantity(quantity) === null) {
      return "A stated quantity must be zero or positive, with at most 6 decimal places.";
    }
    if (limit.assetId && !UUID_PATTERN.test(limit.assetId)) {
      return "Asset id is not a uuid.";
    }
    if (
      limit.constraintSignalId &&
      !UUID_PATTERN.test(limit.constraintSignalId)
    ) {
      return "Constraint signal id is not a uuid.";
    }
  }
  return null;
}
