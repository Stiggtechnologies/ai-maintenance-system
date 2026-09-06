/**
 * Sync Develop — Realize / Learn contracts (D9.02 / D9.03 / D9.04 / D9.11 / D9.13).
 *
 * PURE: no database, no network. Vocabularies MIRROR the SQL helpers
 * `sync_warranty_metric_keys()`, `sync_checkpoint_horizons()` and
 * `sync_delivery_failure_types()` (20261217091000). The slice test pins each
 * pair so a value added on one side only fails before it reaches a database.
 *
 * Canonical homes (overlap-map rulings 11–13, 9):
 *   * OperationalPerformanceWarranty IS `ram_targets` grown by seven
 *     spec-I.36 metric columns — never `warranty_terms` (vendor cover).
 *   * Checkpoints ARE `value_metrics` rows at 30/90/180/365. Verification
 *     stays `verify_value_metric`. A new checkpoint table is forbidden.
 *   * Lessons ARE `learning_events`. The eight delivery failure types are a
 *     `taxonomy_definitions` branch, not a second failure-mode identity.
 *
 * recommend ≠ authorize: recording a design target, opening the post-startup
 * window, and capturing an observation are preparation. They do not verify a
 * metric and they do not adopt a standard. Verification is the one existing
 * loop; methodology revision is D9.09 and is not this module.
 */

/** Spec I.36 — design vs actual at the seven warranted metrics, verbatim. */
export const WARRANTY_METRICS = [
  "throughput",
  "availability",
  "reliability",
  "maintenance_cost",
  "energy",
  "quality",
  "operating_cost",
] as const;

export type WarrantyMetric = (typeof WARRANTY_METRICS)[number];

/** Spec I.36 / §40 — post-startup horizons. No invented 60-day RIA leftover. */
export const CHECKPOINT_HORIZONS = [30, 90, 180, 365] as const;

export type CheckpointHorizon = (typeof CHECKPOINT_HORIZONS)[number];

/**
 * Spec I.37 — the eight project-delivery failure types, as taxonomy keys.
 * `taxonomy_definitions` stays the ONE failure-mode identity (ruling 9).
 */
export const DELIVERY_FAILURE_TYPES = [
  "project_delivery.bad_estimate",
  "project_delivery.late_design",
  "project_delivery.poor_vendor_data",
  "project_delivery.construction_rework",
  "project_delivery.interface_failure",
  "project_delivery.commissioning_defect",
  "project_delivery.startup_failure",
  "project_delivery.benefit_shortfall",
] as const;

export type DeliveryFailureType = (typeof DELIVERY_FAILURE_TYPES)[number];

export const WARRANTY_METRIC_LABELS: Record<WarrantyMetric, string> = {
  throughput: "Throughput",
  availability: "Availability",
  reliability: "Reliability",
  maintenance_cost: "Maintenance cost",
  energy: "Energy",
  quality: "Quality",
  operating_cost: "Operating cost",
};

export const DELIVERY_FAILURE_LABELS: Record<DeliveryFailureType, string> = {
  "project_delivery.bad_estimate": "Bad estimate",
  "project_delivery.late_design": "Late design",
  "project_delivery.poor_vendor_data": "Poor vendor data",
  "project_delivery.construction_rework": "Construction rework",
  "project_delivery.interface_failure": "Interface failure",
  "project_delivery.commissioning_defect": "Commissioning defect",
  "project_delivery.startup_failure": "Startup failure",
  "project_delivery.benefit_shortfall": "Benefit shortfall",
};

export interface StatedWarrantyMetric {
  key: WarrantyMetric;
  target: number;
  unit: string;
}

export interface WarrantyCompleteness {
  stated: StatedWarrantyMetric[];
  notWarranted: WarrantyMetric[];
}

/**
 * A metric without a target is NOT WARRANTED, never zero. Inventing 0%
 * availability or $0 maintenance cost so a radar chart looks complete is
 * the fabrication this family exists to refuse.
 */
export function warrantyCompleteness(
  stated: Iterable<{ key: string; target: number | null; unit: string | null }>,
): WarrantyCompleteness {
  const byKey = new Map<WarrantyMetric, StatedWarrantyMetric>();
  for (const row of stated) {
    if (!isWarrantyMetric(row.key)) continue;
    if (row.target == null || !Number.isFinite(row.target)) continue;
    if (row.unit == null || row.unit.trim() === "") continue;
    byKey.set(row.key, {
      key: row.key,
      target: row.target,
      unit: row.unit.trim(),
    });
  }
  return {
    stated: WARRANTY_METRICS.filter((k) => byKey.has(k)).map(
      (k) => byKey.get(k)!,
    ),
    notWarranted: WARRANTY_METRICS.filter((k) => !byKey.has(k)),
  };
}

export function isWarrantyMetric(value: string): value is WarrantyMetric {
  return (WARRANTY_METRICS as readonly string[]).includes(value);
}

export function isCheckpointHorizon(value: number): value is CheckpointHorizon {
  return (CHECKPOINT_HORIZONS as readonly number[]).includes(value);
}

export function isDeliveryFailureType(
  value: string,
): value is DeliveryFailureType {
  return (DELIVERY_FAILURE_TYPES as readonly string[]).includes(value);
}

/** Same arithmetic as `startup_at + horizon days` in 20261217091000. */
export function checkpointDueOn(
  startupOn: string,
  horizonDays: number,
): string | null {
  if (!isCheckpointHorizon(horizonDays)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(startupOn);
  if (!match) return null;
  const due = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(due.getTime())) return null;
  due.setUTCDate(due.getUTCDate() + horizonDays);
  return due.toISOString().slice(0, 10);
}

export type CheckpointLifecycle =
  | "clock_not_started"
  | "awaiting_observation"
  | "observed_unverified"
  | "verified"
  | "rejected";

/**
 * Observation is not verification. A recorded actual without `verify_value_metric`
 * stays `observed_unverified` — recommend ≠ authorize.
 */
export function checkpointLifecycle(row: {
  startupAt: string | null;
  observedAt: string | null;
  status: string;
}): CheckpointLifecycle {
  if (row.status === "verified") return "verified";
  if (row.status === "rejected") return "rejected";
  if (row.observedAt) return "observed_unverified";
  if (!row.startupAt) return "clock_not_started";
  return "awaiting_observation";
}

export function checkpointLifecycleLabel(state: CheckpointLifecycle): string {
  switch (state) {
    case "clock_not_started":
      return "Clock not started — no startup date, so no 30/90/180/365 due date exists";
    case "awaiting_observation":
      return "Awaiting observed actual — design target is not the actual";
    case "observed_unverified":
      return "Observed, not verified — verification is a separate human act";
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected";
  }
}

/** A lesson that does not name how it applies cannot screen a future case. */
export function lessonRecordRefusal(input: {
  failureModeKey: string;
  cause: string;
  correctiveAction: string;
  applicability: string;
}): string | null {
  if (!isDeliveryFailureType(input.failureModeKey)) {
    return "A project lesson names one of the eight delivery failure types (spec I.37) — this is not a new failure-mode identity";
  }
  if (input.cause.trim().length < 10) {
    return "A lesson without a cause is a complaint — state the cause (10 characters minimum)";
  }
  if (input.correctiveAction.trim().length < 10) {
    return "A lesson without a corrective action cannot close — state the action (10 characters minimum)";
  }
  if (input.applicability.trim().length < 10) {
    return "A lesson without applicability cannot screen a future case — state where it applies (10 characters minimum)";
  }
  return null;
}
