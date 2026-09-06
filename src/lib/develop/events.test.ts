import { describe, expect, it } from "vitest";
import {
  DEVELOP_EVENT_NAMES,
  answerBlockedReason,
  developEventLabel,
  readDevelopEvents,
  type DevelopEventRow,
  type DevelopEventsPayload,
} from "./events";

const row = (over: Partial<DevelopEventRow> = {}): DevelopEventRow => ({
  eventId: 1,
  eventName: "CommissioningTestFailed",
  sourceTable: "acceptance_tests",
  sourceRef: "7",
  subject: "S5D-T1 (commissioning) FAILED",
  payload: {},
  emittedAt: "2026-12-07T09:00:00Z",
  emittedBy: null,
  deliveryId: 11,
  ruleKey: "commissioning_test_failed_disposition",
  consequence: "blocking",
  obligation: "A commissioning test failed and nobody has spoken to it yet.",
  answeredAt: null,
  answeredBy: null,
  answerNote: null,
  answeredByName: null,
  ...over,
});

const payload = (
  events: DevelopEventRow[],
  over: Partial<DevelopEventsPayload> = {},
): DevelopEventsPayload => ({
  caseId: "c1",
  busInstalledAt: "2026-12-07T09:00:00Z",
  eventNames: [...DEVELOP_EVENT_NAMES],
  events,
  eventCount: events.length,
  openCount: events.filter((e) => !e.answeredAt).length,
  blockingOpenCount: events.filter(
    (e) => !e.answeredAt && e.consequence === "blocking",
  ).length,
  headline: "headline from the server",
  ...over,
});

describe("the five named events (D11.26, spec III.§71-78)", () => {
  it("names exactly the five the spec names, verbatim", () => {
    expect([...DEVELOP_EVENT_NAMES]).toEqual([
      "GateRequirementChanged",
      "RiskThresholdExceeded",
      "ScheduleUpdated",
      "WorkPackageBlocked",
      "CommissioningTestFailed",
    ]);
  });

  it("labels every one of them", () => {
    for (const name of DEVELOP_EVENT_NAMES) {
      expect(developEventLabel(name)).not.toBe(name);
    }
    // An unknown name is passed through rather than rendered blank.
    expect(developEventLabel("SomethingElse")).toBe("SomethingElse");
  });
});

describe("an empty event list is a sentence, not a zero (ruling 5D-R7)", () => {
  it("carries the server's sentence through and flags the emptiness", () => {
    const reading = readDevelopEvents(
      payload([], {
        headline:
          "No event has been emitted on this case since the bus started listening on 2026-12-07.",
      }),
    );
    expect(reading.empty).toBe(true);
    expect(reading.headline).toContain("since the bus started listening");
    expect(reading.headline).not.toContain("0 events");
  });

  it("refuses rather than inventing a headline when the read itself failed", () => {
    const reading = readDevelopEvents(null);
    expect(reading.headline).toContain("not the same as no event");
    expect(reading.eventCount).toBe(0);
  });

  it("still says WHICH five acts are watched, so the empty is bounded", () => {
    expect(readDevelopEvents(payload([])).watched).toHaveLength(5);
  });
});

describe("open / answered / blocking split", () => {
  it("separates the blocking open ones — they are the gate blockers", () => {
    const reading = readDevelopEvents(
      payload([
        row({ eventId: 1, consequence: "blocking" }),
        row({ eventId: 2, consequence: "attention", deliveryId: 12 }),
        row({
          eventId: 3,
          consequence: "blocking",
          deliveryId: 13,
          answeredAt: "2026-12-08T09:00:00Z",
          answeredBy: "u1",
          answerNote: "Re-tested and passed on the second attempt.",
        }),
      ]),
    );
    expect(reading.open.map((e) => e.eventId)).toEqual([1, 2]);
    expect(reading.blockingOpen.map((e) => e.eventId)).toEqual([1]);
    expect(reading.answered.map((e) => e.eventId)).toEqual([3]);
  });

  it("surfaces an event with NO delivery — an emitter that lost its subscriber", () => {
    const reading = readDevelopEvents(
      payload([row({ deliveryId: null, consequence: null })]),
    );
    expect(reading.undelivered).toHaveLength(1);
  });
});

describe("answering refusals mirror the server's, before the click", () => {
  const viewer = { id: "u1", role: "planner" };
  const note =
    "Re-tested on the second attempt and it passed; punch list closed.";

  it("permits an answer when nothing is in the way", () => {
    expect(answerBlockedReason(row(), viewer, note)).toBeNull();
  });

  it("refuses a second answer", () => {
    expect(
      answerBlockedReason(
        row({ answeredAt: "2026-12-08T09:00:00Z" }),
        viewer,
        note,
      ),
    ).toContain("already been answered");
  });

  it("refuses the AI-operator identity by name (§70)", () => {
    expect(
      answerBlockedReason(row(), { id: "ai", role: "ai_admin" }, note),
    ).toContain("§70");
  });

  it("refuses the person whose act emitted a BLOCKING event (§42)", () => {
    expect(
      answerBlockedReason(
        row({ emittedBy: "u1", consequence: "blocking" }),
        viewer,
        note,
      ),
    ).toContain("§42");
  });

  it("does NOT apply §42 to an attention consequence, nor where there was no actor", () => {
    expect(
      answerBlockedReason(
        row({ emittedBy: "u1", consequence: "attention" }),
        viewer,
        note,
      ),
    ).toBeNull();
    expect(
      answerBlockedReason(
        row({ emittedBy: null, consequence: "blocking" }),
        viewer,
        note,
      ),
    ).toBeNull();
  });

  it("refuses a note nobody could act on", () => {
    expect(answerBlockedReason(row(), viewer, "done")).toContain(
      "20 characters minimum",
    );
  });
});
