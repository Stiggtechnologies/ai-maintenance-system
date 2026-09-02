/**
 * The Sync Develop event bus, read side (D11.26, spec III.§71–78).
 *
 * The five names are §71–78's, verbatim, and this module mirrors the SQL
 * vocabulary rather than inventing a second one — `sync_develop_event_names()`
 * is the source of truth and the slice test pins the two arrays together.
 *
 * THE ONE RULE THIS FILE ENFORCES ON THE SCREEN: an empty event list is never
 * rendered as a zero. The server states which empty it is (nothing was
 * listening before the bus was installed, or none of the five acts has
 * happened) and this module carries that sentence through instead of
 * substituting "0 events", which reads as a clean bill of health.
 */

export const DEVELOP_EVENT_NAMES = [
  "GateRequirementChanged",
  "RiskThresholdExceeded",
  "ScheduleUpdated",
  "WorkPackageBlocked",
  "CommissioningTestFailed",
] as const;

export type DevelopEventName = (typeof DEVELOP_EVENT_NAMES)[number];

export const EVENT_CONSEQUENCE_CLASSES = ["blocking", "attention"] as const;
export type EventConsequence = (typeof EVENT_CONSEQUENCE_CLASSES)[number];

const EVENT_LABEL: Record<string, string> = {
  GateRequirementChanged: "Gate requirement changed",
  RiskThresholdExceeded: "Risk threshold exceeded",
  ScheduleUpdated: "Schedule updated",
  WorkPackageBlocked: "Work package blocked",
  CommissioningTestFailed: "Commissioning test failed",
};

export function developEventLabel(name: string): string {
  return EVENT_LABEL[name] ?? name;
}

export interface DevelopEventRow {
  eventId: number;
  eventName: string;
  sourceTable: string;
  sourceRef: string;
  subject: string;
  payload: Record<string, unknown>;
  emittedAt: string;
  emittedBy: string | null;
  deliveryId: number | null;
  ruleKey: string | null;
  consequence: string | null;
  obligation: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  answerNote: string | null;
  answeredByName: string | null;
}

export interface DevelopEventsPayload {
  caseId: string;
  busInstalledAt: string;
  eventNames: string[];
  events: DevelopEventRow[];
  eventCount: number;
  openCount: number;
  blockingOpenCount: number;
  headline: string;
}

export interface DevelopEventsReading {
  headline: string;
  /** Never a count when the list is empty — the sentence carries instead. */
  eventCount: number;
  open: DevelopEventRow[];
  answered: DevelopEventRow[];
  blockingOpen: DevelopEventRow[];
  /** True when nothing has arrived: the caller must render the sentence. */
  empty: boolean;
  /** The five names, so a surface can state what IS watched. */
  watched: string[];
  /**
   * An event with no delivery row. Structurally impossible — the emitter
   * dispatches inside its own transaction — so if one ever appears it is an
   * emitter that lost its subscriber, and it is surfaced rather than hidden.
   */
  undelivered: DevelopEventRow[];
}

export function readDevelopEvents(
  payload: DevelopEventsPayload | null | undefined,
): DevelopEventsReading {
  const events = payload?.events ?? [];
  const open = events.filter((e) => e.deliveryId !== null && !e.answeredAt);
  return {
    headline:
      payload?.headline ??
      "The event bus could not be read for this case, which is not the same as no event having been emitted.",
    eventCount: events.length,
    open,
    answered: events.filter((e) => Boolean(e.answeredAt)),
    blockingOpen: open.filter((e) => e.consequence === "blocking"),
    empty: events.length === 0,
    watched:
      payload?.eventNames && payload.eventNames.length > 0
        ? payload.eventNames
        : [...DEVELOP_EVENT_NAMES],
    undelivered: events.filter((e) => e.deliveryId === null),
  };
}

/**
 * Why a consequence cannot be answered yet, or null when it can.
 *
 * The server is the authority on all three of these and refuses each by name;
 * this is the screen saying so BEFORE the click, never instead of the server.
 */
export function answerBlockedReason(
  event: DevelopEventRow,
  viewer: { id: string | null; role: string | null },
  note: string,
): string | null {
  if (event.answeredAt) {
    return "This consequence has already been answered. A new act on the same subject emits a new event.";
  }
  if ((viewer.role ?? "") === "ai_admin") {
    return "The AI-operator identity cannot answer an event consequence (spec §70).";
  }
  if (
    event.consequence === "blocking" &&
    event.emittedBy &&
    viewer.id &&
    event.emittedBy === viewer.id
  ) {
    return "Your act emitted this event, so you do not also record that its consequence has been dealt with (spec §42).";
  }
  if (note.trim().length < 20) {
    return "Say what you did about it — 20 characters minimum. A consequence cleared with no note records that somebody clicked.";
  }
  return null;
}
