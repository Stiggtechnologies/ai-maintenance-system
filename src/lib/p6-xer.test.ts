import { describe, expect, it } from "vitest";
import { INGEST_ENTITIES, preflight, toPayload } from "./ingest-entities";
import { parseP6Xer } from "./p6-xer";

const xer = [
  "ERMHDR\t21.12\t2026-10-01",
  "%T\tPROJECT",
  "%F\tproj_id\tproj_short_name",
  "%R\t10\tTurnaround 2027",
  "%T\tPROJWBS",
  "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name",
  "%R\t100\t\tTA\tTurnaround",
  "%R\t110\t100\tMECH\tMechanical",
  "%T\tCALENDAR",
  "%F\tclndr_id\tclndr_name",
  "%R\t7\t7d-24h",
  "%T\tRSRC",
  "%F\trsrc_id\trsrc_short_name\trsrc_type\tunit_name",
  "%R\tR1\tMillwrights\tRT_Labor\th",
  "%T\tTASK",
  "%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\ttarget_start_date\ttarget_end_date\ttotal_float_hr_cnt\tcstr_type\tcstr_date",
  "%R\t1\t10\t110\t7\tA1000\tMobilise crew\t24\t2027-03-01 06:00\t2027-03-02 06:00\t0\tCS_MSO\t2027-03-01 06:00",
  "%R\t2\t10\t110\t7\tA1010\tRemove liners\t36\t2027-03-02 06:00\t2027-03-03 18:00\t-4\t\t",
  "%T\tTASKPRED",
  "%F\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
  "%R\t2\t1\tPR_FS\t2",
  "%T\tTASKRSRC",
  "%F\ttask_id\trsrc_id\ttarget_qty\tremain_qty",
  "%R\t2\tR1\t72\t36",
].join("\n");

describe("parseP6Xer", () => {
  it("maps native P6 tables into the governed schedule ingest shape", () => {
    const result = parseP6Xer(xer, {
      caseTitle: "Crusher relining programme",
      utcOffset: "-07:00",
    });

    expect(result.projectNames).toEqual(["Turnaround 2027"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      case_title: "Crusher relining programme",
      activity_id: "A1000",
      wbs_path: "TA.MECH",
      calendar: "7d-24h",
      schedule_name: "Turnaround 2027",
      original_duration_hours: "24",
      planned_start: "2027-03-01T13:00:00.000Z",
      constraint_type: "mandatory_start",
      total_float_hours: "0",
    });
    expect(result.rows[1]).toMatchObject({
      activity_id: "A1010",
      predecessors: "A1000",
      total_float_hours: "-4",
    });
    expect(JSON.parse(result.rows[1].relationships)).toEqual([
      { predecessor: "A1000", link_type: "FS", lag_hours: 2 },
    ]);
    expect(
      preflight(INGEST_ENTITIES.schedule_activity, result.headers, result.rows),
    ).toEqual([]);
    expect(
      toPayload(INGEST_ENTITIES.schedule_activity, result.rows[1], 1)
        .relationships,
    ).toEqual([{ predecessor: "A1000", link_type: "FS", lag_hours: 2 }]);
  });

  it("reports resource assignments without turning them into approved demand", () => {
    const result = parseP6Xer(xer, {
      developmentCaseId: "11111111-1111-1111-1111-111111111111",
      utcOffset: "Z",
    });
    expect(result.resourceAssignments).toEqual([
      {
        activityId: "A1010",
        resourceId: "R1",
        resourceName: "Millwrights",
        resourceType: "RT_Labor",
        sourceUnit: "h",
        plannedUnits: 72,
        remainingUnits: 36,
        plannedStart: "2027-03-02T06:00:00.000Z",
        plannedFinish: "2027-03-03T18:00:00.000Z",
      },
    ]);
    expect(result.warnings.join(" ")).toMatch(
      /not imported as approved resource demand/,
    );
  });

  it("fails closed when the destination case or timezone is unstated", () => {
    expect(() => parseP6Xer(xer, { utcOffset: "-07:00" })).toThrow(
      /destination Development Case/,
    );
    expect(() => parseP6Xer(xer, { caseTitle: "Case", utcOffset: "" })).toThrow(
      /UTC offset/,
    );
  });

  it("refuses an XER with no schedule tasks", () => {
    expect(() =>
      parseP6Xer("%T\tPROJECT\n%F\tproj_id\n%R\t1", {
        caseTitle: "Case",
        utcOffset: "Z",
      }),
    ).toThrow(/no TASK rows/);
  });
});
