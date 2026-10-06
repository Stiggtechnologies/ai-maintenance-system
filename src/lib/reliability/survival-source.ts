import type { CoxInterval } from "./cox.ts";

export interface SurvivalMeasurement {
  name: string;
  unit: string;
  value: number;
  evidenceItemId: string;
  observedAtHours: number;
  availableAtHours: number;
  /** Explicit evidence-backed validity, never a platform default. */
  validThroughHours: number;
  observedAt: string;
  availableAt: string;
}
export interface SurvivalOverlay {
  mode: "include" | "exclude";
  basis: string;
  evidenceItemId?: string;
  lifeRef?: string;
  serviceStartedAt?: string;
  terminalObservedAt?: string;
  entryHours?: number;
  stratum?: string;
  intervals?: Array<{
    startHours: number;
    stopHours: number;
    /** Actual wall-clock boundaries; operating hours are not calendar hours. */
    startedAt: string;
    endedAt: string;
    values: SurvivalMeasurement[];
  }>;
}
/** Source supplied by the governed DB, NEVER from browser request JSON. */
export interface SurvivalSourceEvent {
  id: number;
  assetId: string | null;
  component: string;
  hoursAtChangeOut: number;
  eventKind: "failure" | "scheduled" | "other";
  eventDate: string | null;
  overlayVersion: number;
  overlayStatus: string;
  overlayAuthor: string | null;
  overlayReviewer: string | null;
  overlay: SurvivalOverlay | null;
  sourceCurrent: boolean;
  approvalCurrent: boolean;
  sourceEvidence?: unknown;
  approvalId?: string | null;
}

export function prepareSurvivalSource(
  events: SurvivalSourceEvent[],
  covariates: Array<{ name: string; unit: string }>,
): { rows: CoxInterval[]; gaps: string[]; excludedEventIds: number[] } {
  const gaps: string[] = [];
  const rows: CoxInterval[] = [];
  const excludedEventIds: number[] = [];
  if (
    !Array.isArray(events) ||
    !Array.isArray(covariates) ||
    !covariates.length ||
    covariates.length > 8 ||
    covariates.some(
      (c) =>
        !c ||
        typeof c.name !== "string" ||
        !c.name.trim() ||
        typeof c.unit !== "string" ||
        !c.unit.trim(),
    ) ||
    new Set(covariates.map((c) => c.name)).size !== covariates.length
  ) {
    return {
      rows: [],
      gaps: [
        "Select 1–8 unique named covariates with explicit matching units.",
      ],
      excludedEventIds: [],
    };
  }
  if (!events.length || events.length > 2000)
    return {
      rows: [],
      gaps: ["A bounded complete canonical source population is required."],
      excludedEventIds: [],
    };
  const seenEvents = new Set<number>();
  const seenLives = new Set<string>();
  for (const event of events) {
    const label = `Life event ${event?.id ?? "unknown"}`;
    const overlay = event?.overlay;
    if (
      !event ||
      !Number.isSafeInteger(event.id) ||
      event.id <= 0 ||
      seenEvents.has(event.id)
    ) {
      gaps.push(`${label}: missing or duplicate canonical event identity.`);
      continue;
    }
    seenEvents.add(event.id);
    if (
      !overlay ||
      !Number.isInteger(event.overlayVersion) ||
      event.overlayVersion <= 0 ||
      event.overlayStatus !== "validated" ||
      !event.overlayAuthor ||
      !event.overlayReviewer ||
      event.overlayAuthor === event.overlayReviewer ||
      event.sourceCurrent !== true ||
      event.approvalCurrent !== true ||
      typeof overlay.basis !== "string" ||
      overlay.basis.trim().length < 20
    ) {
      gaps.push(
        `${label}: exact overlay and current source evidence require independent approval.`,
      );
      continue;
    }
    if (overlay.mode === "exclude") {
      if (!overlay.evidenceItemId)
        gaps.push(`${label}: an exclusion needs retained supporting evidence.`);
      else excludedEventIds.push(event.id);
      continue;
    }
    const startTime = Date.parse(overlay.serviceStartedAt ?? "");
    const terminalTime = Date.parse(overlay.terminalObservedAt ?? "");
    if (
      overlay.mode !== "include" ||
      !event.assetId ||
      !event.component?.trim() ||
      typeof overlay.lifeRef !== "string" ||
      !overlay.lifeRef.trim() ||
      typeof overlay.stratum !== "string" ||
      !overlay.stratum.trim() ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(terminalTime) ||
      startTime >= terminalTime ||
      !event.eventDate ||
      overlay.terminalObservedAt?.slice(0, 10) !== event.eventDate ||
      !Number.isFinite(event.hoursAtChangeOut) ||
      event.hoursAtChangeOut <= 0 ||
      !Number.isFinite(overlay.entryHours) ||
      overlay.entryHours! < 0 ||
      overlay.entryHours! >= event.hoursAtChangeOut ||
      !["failure", "scheduled"].includes(event.eventKind) ||
      !Array.isArray(overlay.intervals) ||
      !overlay.intervals.length ||
      overlay.intervals.length > 50
    ) {
      gaps.push(
        `${label}: installation identity, actual service boundary, exposure or censoring classification is incomplete.`,
      );
      continue;
    }
    const subjectId = `${event.assetId}:${event.component.toLowerCase()}:${overlay.lifeRef.trim()}`;
    if (seenLives.has(subjectId)) {
      gaps.push(
        `${label}: the same physical component life appears more than once.`,
      );
      continue;
    }
    seenLives.add(subjectId);
    const local: CoxInterval[] = [];
    let next = overlay.entryHours!;
    let previousEnd: number | null = null;
    let valid = true;
    for (const [index, interval] of overlay.intervals.entries()) {
      const intervalStart = Date.parse(interval?.startedAt ?? "");
      const intervalEnd = Date.parse(interval?.endedAt ?? "");
      if (
        !interval ||
        !Number.isFinite(interval.startHours) ||
        !Number.isFinite(interval.stopHours) ||
        interval.startHours !== next ||
        interval.stopHours <= interval.startHours ||
        interval.stopHours > event.hoursAtChangeOut ||
        !Number.isFinite(intervalStart) ||
        !Number.isFinite(intervalEnd) ||
        intervalStart < startTime ||
        intervalEnd <= intervalStart ||
        intervalEnd > terminalTime ||
        (previousEnd !== null && intervalStart !== previousEnd) ||
        (index === 0 &&
          overlay.entryHours === 0 &&
          intervalStart !== startTime) ||
        (index === overlay.intervals.length - 1 &&
          intervalEnd !== terminalTime) ||
        interval.stopHours - interval.startHours >
          (intervalEnd - intervalStart) / 3_600_000 ||
        !Array.isArray(interval.values) ||
        !interval.values.length ||
        interval.values.length > 8 ||
        interval.values.some(
          (value) => !value || typeof value.name !== "string",
        ) ||
        new Set(interval.values.map((value) => value.name)).size !==
          interval.values.length
      ) {
        valid = false;
        break;
      }
      const selected: SurvivalMeasurement[] = [];
      for (const covariate of covariates) {
        const measurement = interval.values.find(
          (value) => value.name === covariate.name,
        );
        const observed = Date.parse(measurement?.observedAt ?? "");
        const available = Date.parse(measurement?.availableAt ?? "");
        if (
          !measurement ||
          measurement.unit !== covariate.unit ||
          !Number.isFinite(measurement.value) ||
          !measurement.evidenceItemId ||
          !Number.isFinite(measurement.observedAtHours) ||
          !Number.isFinite(measurement.availableAtHours) ||
          measurement.observedAtHours < 0 ||
          measurement.observedAtHours > measurement.availableAtHours ||
          measurement.availableAtHours > interval.startHours ||
          !Number.isFinite(measurement.validThroughHours) ||
          measurement.validThroughHours < interval.stopHours ||
          !Number.isFinite(observed) ||
          !Number.isFinite(available) ||
          observed < startTime ||
          available < observed ||
          available > intervalStart ||
          available >= terminalTime
        ) {
          valid = false;
          break;
        }
        selected.push(measurement);
      }
      if (!valid) break;
      local.push({
        id: `${event.id}:${event.overlayVersion}:${index}`,
        subjectId,
        stratum: overlay.stratum,
        start: interval.startHours,
        stop: interval.stopHours,
        failed:
          event.eventKind === "failure" &&
          index === overlay.intervals.length - 1,
        observedAt: Math.max(
          ...selected.map((measurement) => measurement.observedAtHours),
        ),
        covariates: selected.map((measurement) => measurement.value),
      });
      next = interval.stopHours;
      previousEnd = intervalEnd;
    }
    if (!valid || next !== event.hoursAtChangeOut)
      gaps.push(
        `${label}: missing covariates, mixed units, evidence leakage, expired validity or incomplete exposure coverage.`,
      );
    else rows.push(...local);
  }
  if (rows.length > 2000)
    gaps.push(
      "The full exposure population exceeds the bounded numerical solver; no rows were sampled or dropped.",
    );
  // Refuse the entire population. Passing the valid subset would bias the
  // cohort and convert unresolved evidence gaps into silent exclusions.
  return { rows: gaps.length ? [] : rows, gaps, excludedEventIds };
}
