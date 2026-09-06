/**
 * Field readiness — the ten §27 elements, one vocabulary (D7.12, D7.11).
 *
 * PURE: no database, no network. Every function here either states a
 * VOCABULARY the server also states, or REFUSES.
 *
 * ── WHY THIS IS A MODULE OF ITS OWN, beside `workPackaging.ts` ─────────────
 *
 * Because field readiness is not an AWP concept. RULING 22 (Slice 7B) put the
 * predicate on the WORK IDENTITY rather than on either grouping context, so
 * the same ten elements are read by Sync Recovery's `start_restoration_work`
 * for one job and by the AWP path's `assess_package_field_readiness` for
 * every job in a package. A vocabulary that named itself after one of the two
 * consumers would invite the other to grow a copy.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT HOLD ─────────────────────────────
 *
 * It does not decide whether an element is ready, and it does not decide
 * whether a package is. Both answers come from the server:
 * `sync_field_readiness_elements` states the element positions and
 * `sync_work_package_release_verdict` states the ONE release verdict. A client
 * copy of either would be the eighth instance of this programme's signature
 * defect — duplicate edge counts, an inline JSX predicate, a second lateness
 * calculation, a second writer of committed cost, a second warranty-expiry
 * rule, and the second readiness verdict Slice 7A had to delete from its own
 * read path — and this one would sit on the surface a supervisor acts on.
 *
 * What it holds is the VOCABULARY the server also states, pinned to the SQL by
 * `src/test/developSlice7bMigration.test.ts` so a renamed, reordered or
 * re-mapped element cannot land on one side only; PRESENTATION, which is a
 * statement about pixels rather than about readiness; and one READ of the
 * server's own provenance so a surface does not offer a control the door
 * refuses.
 *
 * IT HOLDS NO DOOR-SIDE GATE VALIDATION, and that is a correction rather than
 * an omission. The first draft carried `parseGateKeys`, whose docstring said
 * it stopped "a door whose policy names a typo [gating] on NOTHING and
 * [looking] armed" — and nothing called it, while the database performed no
 * such check either. That guard now lives where the doors are:
 * `sync_field_readiness_blockers` RAISES on an empty gate, an unrecognised
 * key or an unanswered payload (20261211090000). A guard duplicated on the
 * client and absent at the database is the wrong copy of the wrong thing.
 */

/**
 * The ten §27 field-ready elements, in the order the predicate reports them.
 *
 * SEVEN are DERIVED — a canonical store answers the question. THREE are
 * DECLARED — nothing in this repository answers them, so the predicate
 * reports `unverifiable` and a named person discharges each as a §28
 * constraint. The register row D7.12 says "7 of 10 have canonical objects";
 * this list is that claim, in a form the migration test checks against the
 * database rather than a sentence nobody can verify.
 */
export const FIELD_READY_ELEMENTS = [
  {
    key: "scope",
    label: "Approved scope",
    basisKind: "derived",
    source: "job_plans",
  },
  {
    key: "procedure",
    label: "Procedure steps",
    basisKind: "derived",
    source: "job_plan_steps",
  },
  {
    key: "materials",
    label: "Materials staged",
    basisKind: "derived",
    source: "work_order_materials",
  },
  {
    key: "tools",
    label: "Tools and equipment",
    basisKind: "derived",
    source: "job_plan_tools",
  },
  {
    key: "permits",
    label: "Permits identified",
    basisKind: "derived",
    source: "job_plan_permits",
  },
  {
    key: "isolation",
    label: "Isolation confirmed",
    basisKind: "derived",
    source: "equipment_releases",
  },
  {
    key: "quality",
    label: "Acceptance checks",
    basisKind: "derived",
    source: "job_plan_checks",
  },
  // THE THREE WITH NO CANONICAL OBJECT — named, not invented. `source: "none"`
  // is the entire point: crew assignment, access to a work face and
  // work-order-level predecessors have no store in this repository, so the
  // predicate says so instead of defaulting them to ready.
  {
    key: "crew",
    label: "Crew assigned and competent",
    basisKind: "declared",
    source: "none",
  },
  {
    key: "access",
    label: "Access to the work face",
    basisKind: "declared",
    source: "none",
  },
  {
    key: "predecessor",
    label: "Predecessors complete",
    basisKind: "declared",
    source: "none",
  },
] as const;

export type FieldReadyElement = (typeof FIELD_READY_ELEMENTS)[number];
export type FieldReadyElementKey = FieldReadyElement["key"];

/**
 * Mirrors `sync_field_readiness_constraint_kind` — each element onto the
 * canonical constraint vocabulary RULING 20 settled. No kind is added here:
 * the twenty `restoration_constraints.constraint_kind` values already name all
 * ten of these, and adding an eleventh to "make it fit" would be the parallel
 * vocabulary that ruling exists to refuse.
 */
export const FIELD_READY_ELEMENT_TO_KIND: Record<FieldReadyElementKey, string> =
  {
    scope: "drawing",
    procedure: "drawing",
    materials: "material",
    tools: "tooling",
    permits: "permit",
    isolation: "isolation",
    quality: "quality_hold",
    crew: "labour",
    access: "access",
    predecessor: "precedence",
  };

/**
 * Mirrors the four states an element can carry.
 *
 * `unverifiable` is a THIRD answer beside ready and blocked, and it is the one
 * that keeps this capability honest: "nobody has checked" and "checked and
 * clear" are different facts, and reporting the first as the second is exactly
 * what spec §27 exists to prevent.
 */
export const FIELD_READY_STATES = [
  "ready",
  "blocked",
  "not_applicable",
  "unverifiable",
] as const;
export type FieldReadyState = (typeof FIELD_READY_STATES)[number];

/**
 * Recovery's blocking policy at `start_restoration_work`, mirrored so a
 * surface can say WHICH elements stop a start rather than implying all ten do.
 *
 * It is the historical set — materials and isolation, and nothing else. Slice
 * 7B moved where that rule LIVES; it did not widen what the door refuses, and
 * a generalization that quietly took a live gate with it would be a different
 * product decision wearing one's clothes.
 */
export const RECOVERY_START_GATE_ELEMENTS: readonly FieldReadyElementKey[] = [
  "materials",
  "isolation",
];

export function isFieldReadyElementKey(
  key: string,
): key is FieldReadyElementKey {
  return FIELD_READY_ELEMENTS.some((e) => e.key === key);
}

export function fieldReadyElement(key: string): FieldReadyElement | null {
  return FIELD_READY_ELEMENTS.find((e) => e.key === key) ?? null;
}

/**
 * How many of the ten a canonical store can answer, DERIVED FROM the
 * vocabulary rather than typed as a number beside it. D7.12's row claims
 * "7 of 10"; if an eleventh element or a new store ever lands, this moves with
 * it instead of leaving a stale number in a comment.
 */
export function fieldReadyCoverage(): {
  total: number;
  derived: number;
  declared: number;
} {
  const derived = FIELD_READY_ELEMENTS.filter(
    (e) => e.basisKind === "derived",
  ).length;
  return {
    total: FIELD_READY_ELEMENTS.length,
    derived,
    declared: FIELD_READY_ELEMENTS.length - derived,
  };
}

/**
 * PRESENTATION ONLY — which visual register a state belongs in. It says
 * nothing about whether anything may start; the server said that, and this
 * only decides a colour.
 */
export function fieldReadyTone(
  state: string,
): "positive" | "negative" | "neutral" | "caution" | "unknown" {
  switch (state) {
    case "ready":
      return "positive";
    case "blocked":
      return "negative";
    case "not_applicable":
      return "neutral";
    case "unverifiable":
      return "caution";
    default:
      return "unknown";
  }
}

/**
 * The prefix `assess_package_field_readiness` writes on a constraint whose
 * answer came from a CANONICAL STORE rather than from a person's judgement.
 *
 * It is a client-side READ of the server's own provenance, not a second rule:
 * `clear_package_constraint` refuses a hand clearance on exactly these rows
 * (20261211090200), and a screen that offered the control anyway would teach
 * the reader that the refusal is arbitrary — the standard `canClearByHand`
 * already sets for the three kinds Recovery reserves.
 */
export const FIELD_READY_DERIVED_SOURCE_PREFIX = "awp-field-ready:derived:";

/**
 * Whether a §28 constraint row carries a store's answer rather than a
 * person's. A derived row is discharged by changing what the store says and
 * re-assessing; there is no toggle for it, and this is how a surface knows not
 * to offer one.
 */
export function isStoreDerivedFieldReadyRow(
  sourceRef: string | null | undefined,
): boolean {
  return (sourceRef ?? "").startsWith(FIELD_READY_DERIVED_SOURCE_PREFIX);
}
