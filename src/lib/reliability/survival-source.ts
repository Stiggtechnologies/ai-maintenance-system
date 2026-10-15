import type { CoxInterval } from "./cox.ts";
import type { CoxScenarioRequest } from "./cox-prediction.ts";

export const SURVIVAL_CENSUS_VERSION = "survival-census/2/draft";

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
  /** Explicit reviewed reconciliation, never a guessed serial/date match. */
  componentInstanceId?: string;
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

/** An actual still-installed canonical component, not a fabricated removal. */
export interface SurvivalActiveInstance {
  id: string;
  assetId: string | null;
  component: string;
  position: string;
  state: string;
  installedAt: string;
  installedMeterHours: number | null;
  removedAt?: string | null;
  removedMeterHours?: number | null;
  currentMeter: {
    id: string;
    assetId: string;
    kind: string;
    value: number;
    recordedAt: string;
  } | null;
  overlayVersion: number;
  overlayStatus: string;
  overlayAuthor: string | null;
  overlayReviewer: string | null;
  overlay: SurvivalActiveOverlay | null;
  sourceCurrent: boolean;
  approvalCurrent: boolean;
  sourceEvidence?: unknown;
  approvalId?: string | null;
}

export interface SurvivalActiveOverlay extends Omit<
  SurvivalOverlay,
  "lifeRef" | "serviceStartedAt" | "terminalObservedAt"
> {
  meterReadingId?: string;
  installationEvidenceItemId?: string;
  meterEvidenceItemId?: string;
  /** Explicit reviewed wall-clock freshness, never a platform timeout. */
  validUntil?: string;
}

/** Complete server-derived physical population; missing arrays are not empty
 * populations. Removed installations need an approved historical link or an
 * independently reviewed evidence-backed exclusion.
 */
export interface SurvivalCensus {
  sourceVersion: typeof SURVIVAL_CENSUS_VERSION;
  component: string;
  events: SurvivalSourceEvent[];
  activeInstances: SurvivalActiveInstance[];
  removedInstances: Array<SurvivalActiveInstance & { reconciled: boolean }>;
  populationGaps: string[];
}

export function prepareSurvivalCensus(
  source: SurvivalCensus | null | undefined,
  covariates: Array<{ name: string; unit: string }>,
  now = Date.now(),
) {
  if (
    !source ||
    source.sourceVersion !== SURVIVAL_CENSUS_VERSION ||
    !Array.isArray(source.events) ||
    !Array.isArray(source.activeInstances) ||
    !Array.isArray(source.removedInstances) ||
    !Array.isArray(source.populationGaps) ||
    source.populationGaps.some((gap) => typeof gap !== "string")
  ) {
    return {
      rows: [] as CoxInterval[],
      gaps: [
        "The pinned complete physical-life census is unavailable; no completed-only population is fitted.",
      ],
      excludedEventIds: [] as number[],
      excludedInstanceIds: [] as string[],
      clusterBySubject: new Map<string, string>(),
    };
  }
  const prepared = prepareSurvivalSource(
    source.events,
    covariates,
    source.activeInstances,
    now,
  );
  const gaps = [
    ...prepared.gaps,
    ...source.populationGaps,
    ...[...source.events, ...source.activeInstances, ...source.removedInstances]
      .filter(
        (row) =>
          typeof row?.component !== "string" ||
          row.component.trim().toLowerCase() !==
            source.component?.trim().toLowerCase(),
      )
      .map(
        (row) =>
          `Canonical source ${row?.id ?? "unknown"}: physical population does not match the requested component scope.`,
      ),
    ...source.removedInstances
      .filter((instance) => instance?.reconciled !== true)
      .map(
        (instance) =>
          `Removed installation ${instance?.id ?? "unknown"}: an exact approved historical link or evidenced exclusion is required.`,
      ),
  ];
  return {
    ...prepared,
    gaps,
    rows: gaps.length ? [] : prepared.rows,
    clusterBySubject: gaps.length
      ? new Map<string, string>()
      : prepared.clusterBySubject,
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Subtract the supplied decimal meter readings before converting exposure to
 * the numerical solver's number type. Binary cancellation must not turn a
 * measured 0.3-hour life into an apparent coverage gap. No tolerance or clamp.
 */
function meterDifference(current: number, installation: number): number {
  const decimal = (value: number) => {
    const [mantissa, exponent = "0"] = String(value).split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    return {
      digits: BigInt(whole + fraction),
      scale: fraction.length - Number(exponent),
    };
  };
  const a = decimal(current);
  const b = decimal(installation);
  const scale = Math.max(a.scale, b.scale, 0);
  const digits =
    a.digits * 10n ** BigInt(scale - a.scale) -
    b.digits * 10n ** BigInt(scale - b.scale);
  const sign = digits < 0n ? "-" : "";
  const text = (digits < 0n ? -digits : digits)
    .toString()
    .padStart(scale + 1, "0");
  return Number(
    scale
      ? `${sign}${text.slice(0, -scale)}.${text.slice(-scale)}`
      : `${sign}${text}`,
  );
}

/** Pure exposure adapter. Source identities remain canonical table + key;
 * no component_life_event is created for a currently operating installation.
 */
interface ExposureRecord extends Omit<
  SurvivalSourceEvent,
  "id" | "eventKind" | "hoursAtChangeOut"
> {
  id: number | string;
  kind: "completed" | "installed";
  exposureStopHours: number;
  eventKind: SurvivalSourceEvent["eventKind"] | "active";
}

function activeExposure(
  instance: SurvivalActiveInstance,
  now: number,
): ExposureRecord | string {
  const label = `Installed component ${instance?.id ?? "unknown"}`;
  const meter = instance?.currentMeter;
  const installed = Date.parse(instance?.installedAt ?? "");
  const measured = Date.parse(meter?.recordedAt ?? "");
  if (
    instance &&
    typeof instance.id === "string" &&
    uuid.test(instance.id) &&
    ["installed", "quarantined"].includes(instance.state) &&
    instance.assetId &&
    typeof instance.position === "string" &&
    instance.position.trim() &&
    typeof instance.component === "string" &&
    instance.component.trim() &&
    instance.overlay?.mode === "exclude"
  ) {
    // An exact reviewed exclusion may explain unknown meter/installation data;
    // it never imputes exposure or contributes a numerical row.
    return {
      ...instance,
      kind: "installed",
      eventKind: "active",
      exposureStopHours: 0,
      eventDate: null,
    };
  }
  if (
    !instance ||
    typeof instance.id !== "string" ||
    !uuid.test(instance.id) ||
    instance.state !== "installed" ||
    typeof instance.position !== "string" ||
    !instance.position.trim() ||
    !instance.assetId ||
    typeof instance.component !== "string" ||
    !instance.component.trim() ||
    !Number.isFinite(installed) ||
    installed > now ||
    !meter ||
    !uuid.test(meter.id) ||
    meter.assetId !== instance.assetId ||
    meter.kind !== "operating_hours" ||
    !Number.isFinite(measured) ||
    measured <= installed ||
    measured > now ||
    !Number.isFinite(meter.value) ||
    meter.value < 0 ||
    meter.value > Number.MAX_SAFE_INTEGER ||
    instance.installedMeterHours === null ||
    !Number.isFinite(instance.installedMeterHours) ||
    instance.installedMeterHours < 0 ||
    instance.installedMeterHours > Number.MAX_SAFE_INTEGER ||
    meter.value <= instance.installedMeterHours ||
    meterDifference(meter.value, instance.installedMeterHours) >
      (measured - installed) / 3_600_000
  )
    return `${label}: exact installation and same-asset operating meter with positive physically possible exposure are required; no age is inferred or clamped.`;
  const overlay = instance.overlay;
  if (
    overlay?.mode === "include" &&
    (overlay.meterReadingId !== meter.id ||
      !overlay.installationEvidenceItemId ||
      !overlay.meterEvidenceItemId)
  )
    return `${label}: exact installation/meter evidence and selected canonical meter identity are required.`;
  return {
    ...instance,
    kind: "installed",
    // This internal exposure field is not a removal fact or persisted event.
    exposureStopHours: meterDifference(
      meter.value,
      instance.installedMeterHours,
    ),
    eventKind: "active",
    eventDate: meter.recordedAt.slice(0, 10),
    overlay: overlay
      ? {
          ...overlay,
          lifeRef: `component_instances:${instance.id}`,
          serviceStartedAt: instance.installedAt,
          terminalObservedAt: meter.recordedAt,
        }
      : null,
  };
}

export interface SurvivalScenarioSelection {
  eventId: number;
  intervalIndex: number;
  originHours: number;
  horizonHours: number;
}

export interface SurvivalActiveScenarioSelection {
  componentInstanceId: string;
  horizonHours: number;
}

/** Actual age comes from canonical meter minus installation meter. The caller
 * may request a horizon, never supply trusted age, condition or freshness.
 * This input connection still does NOT qualify prediction or calibration.
 */
export function prepareActiveSurvivalScenario(
  events: SurvivalSourceEvent[],
  covariates: Array<{ name: string; unit: string }>,
  activeInstances: SurvivalActiveInstance[],
  selection: unknown,
  now = Date.now(),
): CoxScenarioRequest {
  const refused = (refusal: string): CoxScenarioRequest => ({ refusal });
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    return refused(
      "Select an exact canonical installed component and an explicit horizon.",
    );
  const request = selection as SurvivalActiveScenarioSelection;
  if (
    typeof request.componentInstanceId !== "string" ||
    !uuid.test(request.componentInstanceId) ||
    !Number.isFinite(request.horizonHours)
  )
    return refused(
      "The installed-component scenario requires a canonical UUID and finite user-stated horizon.",
    );
  const prepared = prepareSurvivalSource(
    events,
    covariates,
    activeInstances,
    now,
  );
  if (prepared.gaps.length)
    return refused(
      "The complete completed-and-installed population is not source-ready; no valid subset is fitted.",
    );
  const instance = activeInstances.find(
    (row) => row.id === request.componentInstanceId,
  );
  const overlay = instance?.overlay;
  const meter = instance?.currentMeter;
  if (
    !instance ||
    !meter ||
    overlay?.mode !== "include" ||
    !overlay.intervals?.length
  )
    return refused(
      "The selected installed component has no current independently reviewed exposure profile.",
    );
  const originHours = meterDifference(
    meter.value,
    instance.installedMeterHours!,
  );
  const index = overlay.intervals.length - 1;
  const interval = overlay.intervals[index];
  const validUntil = Date.parse(overlay.validUntil ?? "");
  const values = covariates.map((c) =>
    interval.values.find((value) => value.name === c.name)!,
  );
  if (
    request.horizonHours <= originHours ||
    !Number.isFinite(validUntil) ||
    validUntil <= now ||
    values.some(
      (value) =>
        value.availableAtHours > originHours ||
        value.validThroughHours < request.horizonHours,
    )
  )
    return refused(
      "The installed-component window needs a horizon beyond measured age, unexpired explicit wall-clock freshness and evidence-backed condition validity through the horizon.",
    );
  return {
    stratum: overlay.stratum!,
    originHours,
    horizonHours: request.horizonHours,
    path: [
      {
        startHours: originHours,
        stopHours: request.horizonHours,
        covariates: values.map((value) => value.value),
        observedAtHours: Math.max(
          ...values.map((value) => value.observedAtHours),
        ),
        availableAtHours: Math.max(
          ...values.map((value) => value.availableAtHours),
        ),
        validThroughHours: Math.min(
          ...values.map((value) => value.validThroughHours),
        ),
      },
    ],
    source: {
      kind: "active_component",
      componentInstanceId: instance.id,
      meterReadingId: meter.id,
      asOf: meter.recordedAt,
      overlayVersion: instance.overlayVersion,
      intervalIndex: index,
      evidenceItemIds: [
        ...new Set([
          overlay.installationEvidenceItemId!,
          overlay.meterEvidenceItemId!,
          ...values.map((value) => value.evidenceItemId),
        ]),
      ],
    },
  };
}

/** The browser selects a historical measured profile and a numerical window,
 * never supplies trusted covariates, freshness, approvals or model outputs.
 * This is intentionally NOT a currently installed component forecast.
 */
export function prepareSurvivalScenario(
  events: SurvivalSourceEvent[],
  covariates: Array<{ name: string; unit: string }>,
  selection: unknown,
  activeInstances: SurvivalActiveInstance[] = [],
  now = Date.now(),
): CoxScenarioRequest {
  const refused = (refusal: string): CoxScenarioRequest => ({ refusal });
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    return refused(
      "Select an exact reviewed life interval and state the conditional scenario window.",
    );
  const request = selection as SurvivalScenarioSelection;
  if (
    !Number.isSafeInteger(request.eventId) ||
    request.eventId <= 0 ||
    !Number.isSafeInteger(request.intervalIndex) ||
    request.intervalIndex < 0 ||
    !Number.isFinite(request.originHours) ||
    request.originHours < 0 ||
    !Number.isFinite(request.horizonHours) ||
    request.horizonHours <= request.originHours
  )
    return refused(
      "The scenario needs an exact life/interval identity and explicit finite ordered operating hours.",
    );
  const prepared = prepareSurvivalSource(
    events,
    covariates,
    activeInstances,
    now,
  );
  if (prepared.gaps.length)
    return refused(
      "The complete canonical population is not source-ready; no selected-profile subset is used.",
    );
  const event = events.find((row) => row.id === request.eventId);
  const overlay = event?.overlay;
  const interval = overlay?.intervals?.[request.intervalIndex];
  if (!event || overlay?.mode !== "include" || !interval)
    return refused(
      "The selected reviewed measured interval does not exist in this complete component population.",
    );
  if (
    request.originHours < interval.startHours ||
    request.horizonHours > interval.stopHours
  )
    return refused(
      "The scenario exceeds the selected measured interval; no assumed condition persistence or carry-forward is provided.",
    );
  const values = covariates.map((c) =>
    interval.values.find((value) => value.name === c.name)!,
  );
  if (
    values.some(
      (value) =>
        value.availableAtHours > request.originHours ||
        value.validThroughHours < request.horizonHours,
    )
  )
    return refused(
      "Measurements must already be available at origin and explicitly valid through the requested horizon.",
    );
  return {
    stratum: overlay.stratum!,
    originHours: request.originHours,
    horizonHours: request.horizonHours,
    path: [
      {
        startHours: request.originHours,
        stopHours: request.horizonHours,
        covariates: values.map((value) => value.value),
        observedAtHours: Math.max(
          ...values.map((value) => value.observedAtHours),
        ),
        availableAtHours: Math.max(
          ...values.map((value) => value.availableAtHours),
        ),
        validThroughHours: Math.min(
          ...values.map((value) => value.validThroughHours),
        ),
      },
    ],
    source: {
      eventId: event.id,
      overlayVersion: event.overlayVersion,
      intervalIndex: request.intervalIndex,
      evidenceItemIds: [
        ...new Set(values.map((value) => value.evidenceItemId)),
      ],
    },
  };
}

export function prepareSurvivalSource(
  events: SurvivalSourceEvent[],
  covariates: Array<{ name: string; unit: string }>,
  activeInstances: SurvivalActiveInstance[] = [],
  now = Date.now(),
): {
  rows: CoxInterval[];
  gaps: string[];
  excludedEventIds: number[];
  excludedInstanceIds: string[];
  clusterBySubject: Map<string, string>;
} {
  const gaps: string[] = [];
  const rows: CoxInterval[] = [];
  const excludedEventIds: number[] = [];
  const excludedInstanceIds: string[] = [];
  const clusterBySubject = new Map<string, string>();
  if (
    !Array.isArray(events) ||
    !Array.isArray(activeInstances) ||
    !Number.isFinite(now) ||
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
      excludedInstanceIds: [],
      clusterBySubject,
    };
  }
  if (
    (!events.length && !activeInstances.length) ||
    events.length + activeInstances.length > 2000
  )
    return {
      rows: [],
      gaps: ["A bounded complete canonical source population is required."],
      excludedEventIds: [],
      excludedInstanceIds: [],
      clusterBySubject,
    };
  const seenEvents = new Set<string>();
  const seenLives = new Set<string>();
  const components = new Set(
    [...events, ...activeInstances].map((row) =>
      typeof row?.component === "string"
        ? row.component.trim().toLowerCase()
        : "",
    ),
  );
  if (components.size !== 1 || components.has(""))
    gaps.push(
      "The complete exposure population must belong to one explicit normalized canonical component scope.",
    );
  const population: ExposureRecord[] = events.map((event) => ({
    ...event,
    kind: "completed",
    exposureStopHours: event?.hoursAtChangeOut,
  }));
  const seenPositions = new Set<string>();
  for (const instance of activeInstances) {
    const exposure = activeExposure(instance, now);
    if (typeof exposure === "string") gaps.push(exposure);
    else {
      const position = `${instance.assetId}:${instance.component.trim().toLowerCase()}:${instance.position.trim().toLowerCase()}`;
      if (seenPositions.has(position))
        gaps.push(
          `Installed component ${instance.id}: duplicate active asset/component position; reconcile canonical identities.`,
        );
      seenPositions.add(position);
      population.push(exposure);
    }
  }
  for (const event of population) {
    const label =
      event.kind === "installed"
        ? `Installed component ${event.id}`
        : `Life event ${event?.id ?? "unknown"}`;
    const sourceKey = `${event.kind}:${event.id}`;
    const overlay = event?.overlay;
    if (
      !event ||
      (event.kind === "completed" &&
        (!Number.isSafeInteger(event.id) || (event.id as number) <= 0)) ||
      seenEvents.has(sourceKey)
    ) {
      gaps.push(`${label}: missing or duplicate canonical event identity.`);
      continue;
    }
    seenEvents.add(sourceKey);
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
      else if (event.kind === "installed")
        excludedInstanceIds.push(event.id as string);
      else excludedEventIds.push(event.id as number);
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
      !Number.isFinite(event.exposureStopHours) ||
      event.exposureStopHours <= 0 ||
      !Number.isFinite(overlay.entryHours) ||
      overlay.entryHours! < 0 ||
      overlay.entryHours! >= event.exposureStopHours ||
      (event.kind === "installed"
        ? event.eventKind !== "active"
        : !["failure", "scheduled"].includes(event.eventKind)) ||
      !Array.isArray(overlay.intervals) ||
      !overlay.intervals.length ||
      overlay.intervals.length > 50
    ) {
      gaps.push(
        `${label}: installation identity, actual service boundary, exposure or censoring classification is incomplete.`,
      );
      continue;
    }
    const subjectId = `${event.assetId}:${event.component.trim().toLowerCase()}:${overlay.lifeRef.trim()}`;
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
        interval.stopHours > event.exposureStopHours ||
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
        id: `${event.kind === "installed" ? "component_instances:" : ""}${event.id}:${event.overlayVersion}:${index}`,
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
    if (!valid || next !== event.exposureStopHours)
      gaps.push(
        `${label}: missing covariates, mixed units, evidence leakage, expired validity or incomplete exposure coverage.`,
      );
    else {
      rows.push(...local);
      clusterBySubject.set(subjectId, event.assetId!);
    }
  }
  if (rows.length > 2000)
    gaps.push(
      "The full exposure population exceeds the bounded numerical solver; no rows were sampled or dropped.",
    );
  // Refuse the entire population. Passing the valid subset would bias the
  // cohort and convert unresolved evidence gaps into silent exclusions.
  return {
    rows: gaps.length ? [] : rows,
    gaps,
    excludedEventIds,
    excludedInstanceIds,
    clusterBySubject: gaps.length ? new Map() : clusterBySubject,
  };
}
