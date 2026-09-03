/**
 * Advanced Work Packaging — the §27 WorkPackage, the §28 Constraint and the
 * I.28 burn-down (D7.17, D7.10, D7.18, D7.07).
 *
 * PURE: no database, no network. Every function here either states a
 * VOCABULARY the server also states, or REFUSES.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT HOLD. It does not compute a burn-down.
 * `get_package_constraint_burndown` is the ONE forward projection and
 * `compute_package_constraint_burndown` records it; a client copy of that
 * arithmetic would be a second answer to "what will block this package", and
 * the two would disagree inside one rendered payload the day either is
 * repaired. That is the `packageLateness` defect the reachability gate caught
 * in Slice 6A and the `warrantyCover` copy Slice 6B deleted. Every figure the
 * work-packaging panel renders comes from the server.
 *
 * It does not re-derive a readiness verdict either. `release_work_package`
 * decides READY / NOT READY at the database and `get_case_work_packages`
 * returns the sentence; the panel shows what the server said.
 *
 * WHAT IT DOES HOLD:
 *
 *   * the AWP ORDERING — a domain fact (spec II.4: EWP → PWP → CWP → IWP,
 *     with §27's fifth type, commissioning, below installation). Mirrored
 *     from `sync_awp_level` / `sync_awp_parent_type`, with
 *     `src/test/developSlice7aMigration.test.ts` pinning the two together, so
 *     a sixth type or a reordering cannot land on one side only.
 *
 *   * the §28 TYPE MAP — the spec's ten names against the canonical
 *     `restoration_constraints.constraint_kind` vocabulary. RULING 20:
 *     restoration_constraints IS the Constraint object; SEVEN of the spec's
 *     ten already existed among its seventeen domain kinds and THREE
 *     (drawing, access, scaffold) were added, so the store's vocabulary is a
 *     strict SUPERSET of §28's ten at twenty domain kinds — not, as the
 *     ruling's first draft said in the same sentence that admitted the three
 *     additions, a set the ten were already a subset of. Mirrored from
 *     `sync_spec28_constraint_kind` and pinned the same way.
 *
 *   * DOOR-SIDE PARSERS that refuse the shapes the server refuses, so a form
 *     can disable a control rather than post a number the server will reject.
 *     They do not answer the server's question; they refuse before asking it.
 *     `Number.isFinite` rejects NaN and both infinities, which the SQL side
 *     matches with explicit NaN/Infinity checks because
 *     `'NaN'::numeric = 'NaN'::numeric` is TRUE in Postgres and a range check
 *     alone does not keep it out.
 */

/* ─────────────────────────── the AWP vocabulary ─────────────────────────── */

/** Mirrors the `work_packages.package_type` CHECK and `sync_awp_level`. */
export const AWP_PACKAGE_TYPES = [
  "engineering",
  "procurement",
  "construction",
  "installation",
  "commissioning",
] as const;
export type AwpPackageType = (typeof AWP_PACKAGE_TYPES)[number];

/**
 * Mirrors the `work_packages.status` CHECK — THREE values, because three is
 * what the product can reach: `release_work_package` writes `released`,
 * `cancel_work_package` writes `cancelled`, and every other door leaves the
 * row in `draft`. An earlier draft of the CHECK also listed `planned`,
 * `executing` and `complete`; nothing set them, so a reader filtering on one
 * got an always-empty answer and the next author would have assumed the
 * EXECUTION lifecycle lived here. It does not — that is `work_orders.status`
 * (RULING 19), which `get_case_work_packages` reads rather than copying.
 */
export const WORK_PACKAGE_STATUSES = [
  "draft",
  "released",
  "cancelled",
] as const;
export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];

/**
 * The chain, in order. Spec II.4 names four levels and ends at FIELD
 * EXECUTION; spec §27 names five types. Commissioning takes level 5, below
 * installation, where the §29 commissioning state machine already puts it —
 * rather than being left outside the ordering as the one package kind with no
 * rule about what it may hang from.
 */
export const AWP_CHAIN: readonly AwpPackageType[] = AWP_PACKAGE_TYPES;

/** The short names the industry uses, for labels only. */
export const AWP_ACRONYMS: Record<AwpPackageType, string> = {
  engineering: "EWP",
  procurement: "PWP",
  construction: "CWP",
  installation: "IWP",
  commissioning: "COM",
};

/** Mirrors `sync_awp_level`. 1-based; null for an unknown type. */
export function awpLevel(type: string): number | null {
  const at = AWP_CHAIN.indexOf(type as AwpPackageType);
  return at === -1 ? null : at + 1;
}

/**
 * Mirrors `sync_awp_parent_type`. Null for `engineering` (the head of the
 * chain) AND null for an unknown type — the two are different facts and
 * `isAwpPackageType` is how a caller tells them apart, exactly as the trigger
 * distinguishes them rather than treating both as "no parent required".
 */
export function awpParentType(type: string): AwpPackageType | null {
  const level = awpLevel(type);
  if (level === null || level === 1) return null;
  return AWP_CHAIN[level - 2];
}

export function isAwpPackageType(type: string): type is AwpPackageType {
  return awpLevel(type) !== null;
}

/**
 * The packages a package of this type may hang from — a SELECTOR helper over
 * the vocabulary, not a second verdict. The database refuses a skipped level
 * and a wrong-typed parent for every writer (`enforce_work_package_chain`);
 * this only decides which options to offer.
 */
export function eligibleParents<T extends { packageType: string }>(
  type: string,
  packages: readonly T[],
): T[] {
  const parent = awpParentType(type);
  if (parent === null) return [];
  return packages.filter((p) => p.packageType === parent);
}

/* ────────────────────────── the §28 vocabulary ─────────────────────────── */

/** Spec III.§28's ten Constraint types, in the spec's own order. */
export const SPEC28_CONSTRAINT_TYPES = [
  "drawing",
  "material",
  "access",
  "labour",
  "crane",
  "permit",
  "isolation",
  "scaffold",
  "predecessor",
  "inspection",
] as const;
export type Spec28ConstraintType = (typeof SPEC28_CONSTRAINT_TYPES)[number];

/**
 * Mirrors `sync_spec28_constraint_kind`. RULING 20: the spec's ten map onto
 * the canonical `restoration_constraints.constraint_kind` vocabulary — seven
 * already existed under this repository's own names, and drawing / access /
 * scaffold were added to it. PREDECESSOR is `precedence`; INSPECTION is
 * `quality_hold`, which is what job_plans already calls a hold point.
 */
export const SPEC28_TO_CANONICAL_KIND: Record<Spec28ConstraintType, string> = {
  drawing: "drawing",
  material: "material",
  access: "access",
  labour: "labour",
  crane: "crane",
  permit: "permit",
  isolation: "isolation",
  scaffold: "scaffold",
  predecessor: "precedence",
  inspection: "quality_hold",
};

export function canonicalConstraintKind(specType: string): string | null {
  const key = specType.trim().toLowerCase() as Spec28ConstraintType;
  return SPEC28_TO_CANONICAL_KIND[key] ?? null;
}

/** Mirrors the `restoration_constraints.state` CHECK (unchanged since 2026-09-21). */
export const CONSTRAINT_STATES = [
  "unknown",
  "satisfied",
  "blocked",
  "not_applicable",
] as const;
export type ConstraintState = (typeof CONSTRAINT_STATES)[number];

/**
 * The three kinds whose truth may NOT be toggled by hand — Recovery's rule
 * (20260921090000), preserved by `clear_package_constraint` rather than
 * exempted for the project path. Offering the control and letting the server
 * refuse would teach the user that the refusal is arbitrary.
 */
export const CONSTRAINT_KINDS_NOT_HAND_CLEARABLE = [
  "permit",
  "isolation",
  "asset_state",
] as const;

export function canClearByHand(canonicalKind: string): boolean {
  return !(CONSTRAINT_KINDS_NOT_HAND_CLEARABLE as readonly string[]).includes(
    canonicalKind,
  );
}

/**
 * The FIVE forecast buckets `get_package_constraint_burndown` classifies into,
 * in the order the classifier asks them.
 *
 * `lapsed` is asked FIRST and is not decoration: a constraint that is STILL
 * OPEN whose stated clear date has already passed is not "expected clear". A
 * classifier that never compares a forecast to today put it in
 * `expected_clear` and then named a projected constraint-free date IN THE
 * PAST — and time alone produces that state, with no bad write, on the day
 * after any forecast expires.
 */
export const BURNDOWN_FORECASTS = [
  "lapsed",
  "will_block",
  "expected_clear",
  "unforecast",
  "not_assessable",
] as const;
export type BurndownForecast = (typeof BURNDOWN_FORECASTS)[number];

/* ────────────────────────────── door-side refusals ─────────────────────── */

export type Parsed<T> = { ok: true; value: T } | { ok: false; refusal: string };

/**
 * A probability of clearance. `forecast_package_constraint` refuses the same
 * shapes with the same reasons; this refuses before the round trip.
 */
export function parseClearanceProbability(
  raw: string,
  basis: string,
): Parsed<{ probability: number; basis: string }> {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      ok: false,
      refusal: "State a probability of clearance, or leave it unstated.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      refusal:
        "The probability of clearance must be a finite number between 0 and 1.",
    };
  }
  if (value < 0 || value > 1) {
    return {
      ok: false,
      refusal: `${trimmed} is not a probability — it is a number between 0 and 1 or it is nothing.`,
    };
  }
  const stated = basis.trim();
  if (stated.length < 20) {
    return {
      ok: false,
      refusal:
        "A probability of clearance needs its basis (20 characters minimum): somebody will schedule against this number.",
    };
  }
  return { ok: true, value: { probability: value, basis: stated } };
}

/** Days of schedule impact, with the basis the server also requires. */
export function parseScheduleImpactDays(
  raw: string,
  basis: string,
): Parsed<{ days: number; basis: string }> {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      ok: false,
      refusal: "State the schedule impact in days, or leave it unstated.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return {
      ok: false,
      refusal:
        "The schedule impact must be a finite number of days, zero or more.",
    };
  }
  const stated = basis.trim();
  if (stated.length < 10) {
    return {
      ok: false,
      refusal:
        "A schedule impact needs its basis (10 characters minimum) — a delay nobody can source is one nobody should schedule against.",
    };
  }
  return { ok: true, value: { days: value, basis: stated } };
}

/** The burn-down horizon. Mirrors the 1..1825 door in the SQL predicate. */
export function parseBurndownHorizon(raw: string): Parsed<number> {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, refusal: "State a horizon in days." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return {
      ok: false,
      refusal: "The horizon must be a whole number of days.",
    };
  }
  if (value <= 0 || value > 1825) {
    return {
      ok: false,
      refusal:
        "The horizon must be from 1 to 1825 days — a burn-down over zero days, a negative window or a five-year-plus window projects nothing.",
    };
  }
  return { ok: true, value };
}
