import { describe, expect, it } from "vitest";
import {
  mapP6Constraint,
  mapP6RelationshipType,
  mapP6ScheduleSnapshot,
  normalizeP6PullRequest,
  P6_ACTIVITY_FIELDS,
  p6ResourceUrl,
} from "../../supabase/functions/_shared/p6-schedule-read";

const config = {
  projectObjectId: 4101,
  developmentCaseId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  scheduleName: "Turnaround 2027",
  durationToHours: 8,
  maxActivities: 50,
  maxRelationships: 100,
};

const activities = [
  {
    ObjectId: 101,
    Id: "A-100",
    Name: "Isolate train",
    ProjectObjectId: 4101,
    ProjectName: "Turnaround 2027",
    WBSPath: "TA.01.Isolation",
    PlannedDuration: 1.5,
    PlannedStartDate: "2027-05-01T08:00:00Z",
    PlannedFinishDate: "2027-05-01T20:00:00Z",
    CalendarName: "12-hour turnaround",
    TotalFloat: 0.5,
    PrimaryConstraintType: "Start On Or After",
    PrimaryConstraintDate: "2027-05-01T08:00:00Z",
  },
  {
    ObjectId: 102,
    Id: "A-200",
    Name: "Open exchanger",
    ProjectObjectId: 4101,
    ProjectName: "Turnaround 2027",
    WBSPath: "TA.02.Execution",
    PlannedDuration: 2,
    PlannedStartDate: "2027-05-02T08:00:00Z",
    PlannedFinishDate: "2027-05-03T00:00:00Z",
    CalendarName: "12-hour turnaround",
    TotalFloat: 0,
    PrimaryConstraintType: "None",
    PrimaryConstraintDate: null,
  },
];

const relationships = [
  {
    ObjectId: 9001,
    PredecessorActivityObjectId: 101,
    PredecessorActivityId: "A-100",
    PredecessorProjectObjectId: 4101,
    SuccessorActivityObjectId: 102,
    SuccessorActivityId: "A-200",
    SuccessorProjectObjectId: 4101,
    Type: "Finish to Start",
    Lag: 0.25,
  },
];

describe("Primavera P6 schedule read mapping", () => {
  it("normalizes only a bounded object request with an explicit boolean mode", () => {
    expect(
      normalizeP6PullRequest({ connector_key: " site-a-p6 ", dry_run: false }),
    ).toEqual({ connectorKey: "site-a-p6", dryRun: false });
    expect(normalizeP6PullRequest({ connector_key: "site-a-p6" })).toEqual({
      connectorKey: "site-a-p6",
      dryRun: true,
    });
    expect(() => normalizeP6PullRequest(null)).toThrow(/JSON object/);
    expect(() =>
      normalizeP6PullRequest({ connector_key: "site-a-p6", dry_run: "false" }),
    ).toThrow(/true or false/);
    expect(() =>
      normalizeP6PullRequest({ connector_key: "x".repeat(161) }),
    ).toThrow(/160-character/);
  });

  it("builds an explicit bounded Oracle resource URL", () => {
    const url = p6ResourceUrl(
      new URL("https://p6.example.com/p6ws/restapi/"),
      "activity",
      P6_ACTIVITY_FIELDS,
      "ProjectObjectId:eq:4101",
    );

    expect(url.origin + url.pathname).toBe(
      "https://p6.example.com/p6ws/restapi/activity",
    );
    expect(url.searchParams.get("Fields")).toBe(P6_ACTIVITY_FIELDS.join(","));
    expect(url.searchParams.get("Filter")).toBe("ProjectObjectId:eq:4101");
    expect(url.searchParams.get("OrderBy")).toBe("ObjectId");
  });

  it("maps activities and predecessor logic into canonical schedule rows", () => {
    const rows = mapP6ScheduleSnapshot(activities, relationships, config);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      external_id: "A-100",
      development_case_id: config.developmentCaseId,
      schedule_name: "Turnaround 2027",
      original_duration_hours: 12,
      total_float_hours: 4,
      constraint_type: "start_on_or_after",
      relationships: [],
    });
    expect(rows[1]).toMatchObject({
      external_id: "A-200",
      original_duration_hours: 16,
      predecessors: "A-100",
      relationships: [{ predecessor: "A-100", link_type: "FS", lag_hours: 2 }],
    });
  });

  it("recognizes only the supported Oracle constraint and relationship vocabulary", () => {
    expect(mapP6Constraint("Mandatory Finish")).toBe("mandatory_finish");
    expect(mapP6Constraint("None")).toBeUndefined();
    expect(mapP6RelationshipType("Start to Finish")).toBe("SF");
    expect(() => mapP6Constraint("Undocumented constraint")).toThrow(
      /Unsupported P6 primary constraint type/,
    );
    expect(() => mapP6RelationshipType("Finish somehow")).toThrow(
      /Unsupported P6 relationship type/,
    );
  });

  it("allows the undated as-late-as-possible scheduling instruction", () => {
    const rows = mapP6ScheduleSnapshot(
      [
        {
          ...activities[0],
          PrimaryConstraintType: "As Late As Possible",
          PrimaryConstraintDate: null,
        },
      ],
      [],
      config,
    );
    expect(rows[0]).toMatchObject({
      constraint_type: "as_late_as_possible",
    });
    expect(rows[0]).not.toHaveProperty("constraint_date");
  });

  it("fails closed when Oracle returns activities outside the approved project", () => {
    expect(() =>
      mapP6ScheduleSnapshot(
        [{ ...activities[0], ProjectObjectId: 9999 }],
        [],
        config,
      ),
    ).toThrow(/escaped the approved project filter/);
  });

  it("refuses schedule dates whose timezone would otherwise be guessed", () => {
    expect(() =>
      mapP6ScheduleSnapshot(
        [{ ...activities[0], PlannedStartDate: "2027-05-01T08:00:00" }],
        [],
        config,
      ),
    ).toThrow(/explicit offset/);
  });

  it("refuses cross-project logic instead of silently dropping it", () => {
    expect(() =>
      mapP6ScheduleSnapshot(
        activities,
        [
          {
            ...relationships[0],
            PredecessorProjectObjectId: 9999,
          },
        ],
        config,
      ),
    ).toThrow(/cross-project predecessor/);
  });

  it("reconciles Oracle relationship identities to the transported activities", () => {
    expect(() =>
      mapP6ScheduleSnapshot(
        activities,
        [{ ...relationships[0], PredecessorActivityId: "WRONG" }],
        config,
      ),
    ).toThrow(/do not reconcile/);
    expect(() =>
      mapP6ScheduleSnapshot(
        activities,
        [relationships[0], { ...relationships[0] }],
        config,
      ),
    ).toThrow(/duplicate identity/);
  });

  it("bounds text before it can enter staging or an error receipt", () => {
    expect(() =>
      mapP6ScheduleSnapshot(
        [{ ...activities[0], Id: "A".repeat(256) }],
        [],
        config,
      ),
    ).toThrow(/255-character/);
    expect(() =>
      mapP6ScheduleSnapshot(
        [{ ...activities[0], Name: "A".repeat(1001) }],
        [],
        config,
      ),
    ).toThrow(/1000-character/);
  });

  it("requires a complete non-empty bounded snapshot", () => {
    expect(() => mapP6ScheduleSnapshot([], [], config)).toThrow(
      /returned no activities/,
    );
    expect(() =>
      mapP6ScheduleSnapshot(activities, relationships, {
        ...config,
        maxActivities: 1,
      }),
    ).toThrow(/exceeds the approved row limit/);
  });
});
