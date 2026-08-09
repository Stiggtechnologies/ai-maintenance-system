/**
 * Validation for fleet-history import profiling and classification.
 *
 * The fixtures are drawn from the real auxiliary-fleet export — repeated
 * "Date"/"Time" headers, reused unit numbers, a 79-code vocabulary mixing
 * equipment, activity and delay. If this module cannot reproduce the calls I
 * made by hand on that sheet, it is not ready to make them for a customer.
 */
import { describe, expect, it } from "vitest";
import {
  profileColumns,
  suggestMapping,
  validateMapping,
  suggestVocabulary,
  previewImport,
  parseCSV,
  type ColumnRole,
} from "./index";

// The auxiliary-fleet header row, verbatim — note Date and Time appear twice.
const HEADERS = [
  "Equipment",
  "Equip #",
  "Date",
  "Time",
  "Date",
  "Time",
  "Duration",
  "Reason/Complaint",
  "Comment",
  "Month",
  "Year",
];
const ROWS = [
  [
    "Grader",
    "7203",
    "2010-01-01",
    "12:37:02",
    "2010-01-02",
    "13:50:28",
    "25.22",
    "BRAKE SYSTEM",
    "BRAKES STUCK ON",
    "1",
    "2010",
  ],
  [
    "Grader",
    "7203",
    "2010-01-03",
    "14:44:31",
    "2010-01-05",
    "06:35:28",
    "39.85",
    "TIRES/RIMS",
    "TIRES",
    "1",
    "2010",
  ],
  [
    "Dozer",
    "5301",
    "2010-01-06",
    "13:46:33",
    "2010-01-06",
    "18:14:36",
    "4.47",
    "GROUND ENGAGING TOOL",
    "EDGES",
    "1",
    "2010",
  ],
  [
    "Dozer",
    "5301",
    "2010-01-11",
    "18:20:29",
    "2010-01-11",
    "22:29:28",
    "4.15",
    "WAIT PARTS",
    "FINNING",
    "1",
    "2010",
  ],
  [
    "Shovel",
    "6301",
    "2010-01-13",
    "16:27:13",
    "2010-01-17",
    "22:17:25",
    "101.84",
    "PLANNED MAINTENANCE",
    "PM",
    "1",
    "2010",
  ],
];

function roles(): { role: ColumnRole; index: number }[] {
  return suggestMapping(profileColumns(HEADERS, ROWS)).map((s) => ({
    role: s.role,
    index: s.index,
  }));
}

describe("column profiling and mapping", () => {
  it("disambiguates the repeated Date/Time pair by order", () => {
    const s = suggestMapping(profileColumns(HEADERS, ROWS));
    const byIdx = Object.fromEntries(s.map((x) => [x.index, x.role]));
    expect(byIdx[2]).toBe("start_date");
    expect(byIdx[3]).toBe("start_time");
    expect(byIdx[4]).toBe("end_date");
    expect(byIdx[5]).toBe("end_time");
  });

  it("identifies the substantive columns", () => {
    const s = suggestMapping(profileColumns(HEADERS, ROWS));
    const byIdx = Object.fromEntries(s.map((x) => [x.index, x.role]));
    expect(byIdx[0]).toBe("asset_type");
    expect(byIdx[1]).toBe("unit_number");
    expect(byIdx[6]).toBe("duration_hours");
    expect(byIdx[7]).toBe("reason_code");
    expect(byIdx[8]).toBe("comment");
  });

  it("ignores an entirely empty column rather than guessing at it", () => {
    const h = [...HEADERS, "Spare"];
    const r = ROWS.map((x) => [...x, ""]);
    const s = suggestMapping(profileColumns(h, r));
    const last = s[s.length - 1];
    expect(last.role).toBe("ignore");
    expect(last.confidence).toBe("high");
  });

  it("warns that unit numbers without a type will merge assets", () => {
    const v = validateMapping([
      { role: "unit_number" },
      { role: "start_date" },
      { role: "end_date" },
      { role: "reason_code" },
    ]);
    expect(v.usable).toBe(true);
    expect(v.notes.join(" ")).toMatch(/merge/i);
  });

  it("refuses a mapping that cannot locate an event in time", () => {
    const v = validateMapping([
      { role: "unit_number" },
      { role: "reason_code" },
    ]);
    expect(v.usable).toBe(false);
    expect(v.missing).toContain("a start date");
    expect(v.missing).toContain("an end date or a duration");
  });

  it("says timestamps win when both an end date and a duration are present", () => {
    const v = validateMapping([
      { role: "unit_number" },
      { role: "asset_type" },
      { role: "start_date" },
      { role: "end_date" },
      { role: "duration_hours" },
      { role: "reason_code" },
    ]);
    expect(v.notes.join(" ")).toMatch(/authoritative/i);
  });
});

describe("vocabulary classification", () => {
  const counts = new Map<string, number>([
    ["WAIT PARTS", 413],
    ["PLANNED MAINTENANCE", 2416],
    ["ENGINE GROUP", 1077],
    ["INSPECTION/TROUBLESHOOT", 7605],
    ["GROUND ENGAGING TOOL", 2708],
    ["MIDLIFE", 203],
    ["OUT OF FUEL", 6],
    ["ICE LUGS", 21],
  ]);

  it("classifies delay, activity and equipment distinctly", () => {
    const s = suggestVocabulary(counts);
    const kind = Object.fromEntries(s.map((x) => [x.label, x.kind]));
    expect(kind["WAIT PARTS"]).toBe("delay_reason");
    expect(kind["OUT OF FUEL"]).toBe("delay_reason");
    expect(kind["PLANNED MAINTENANCE"]).toBe("activity_type");
    expect(kind["INSPECTION/TROUBLESHOOT"]).toBe("activity_type");
    expect(kind["MIDLIFE"]).toBe("activity_type");
    expect(kind["ENGINE GROUP"]).toBe("system_group");
  });

  it("treats a wait naming a system as a WAIT, not as that system failing", () => {
    // "WAIT PARTS - ENGINE" matches both patterns; delay must win, or a
    // parts delay is counted as an engine failure.
    const s = suggestVocabulary(new Map([["WAIT PARTS - ENGINE GROUP", 28]]));
    expect(s[0].kind).toBe("delay_reason");
  });

  it("leaves an unrecognised code unclassified instead of guessing", () => {
    const s = suggestVocabulary(new Map([["ICE LUGS", 21]]));
    expect(s[0].kind).toBe("unclassified");
    expect(s[0].confidence).toBe("low");
  });

  it("never claims high confidence that a code is a failure mechanism", () => {
    const s = suggestVocabulary(counts);
    for (const x of s.filter((y) => y.kind === "system_group")) {
      expect(x.confidence).not.toBe("high");
      expect(x.why).toMatch(/not a failure mechanism/i);
    }
  });

  it("orders by frequency so the biggest classification decisions come first", () => {
    const s = suggestVocabulary(counts);
    expect(s[0].label).toBe("INSPECTION/TROUBLESHOOT");
    expect(s.map((x) => x.count)).toEqual(
      [...s.map((x) => x.count)].sort((a, b) => b - a),
    );
  });
});

describe("preview before load", () => {
  it("counts what will load and what will not, with reasons", () => {
    const bad = [
      [
        "Grader",
        "",
        "2010-01-01",
        "",
        "2010-01-02",
        "",
        "5",
        "BRAKE SYSTEM",
        "x",
        "1",
        "2010",
      ],
      [
        "Grader",
        "7203",
        "",
        "",
        "2010-01-02",
        "",
        "5",
        "BRAKE SYSTEM",
        "x",
        "1",
        "2010",
      ],
      [
        "Grader",
        "7203",
        "2010-01-01",
        "",
        "",
        "",
        "",
        "BRAKE SYSTEM",
        "x",
        "1",
        "2010",
      ],
      [
        "Grader",
        "7203",
        "2010-01-01",
        "",
        "2010-01-02",
        "",
        "abc",
        "BRAKE SYSTEM",
        "x",
        "1",
        "2010",
      ],
    ];
    const p = previewImport([...ROWS, ...bad], roles());
    expect(p.rows).toBe(9);
    expect(p.willLoad).toBe(5);
    expect(p.willReject).toBe(4);
    const reasons = p.rejectReasons.map((r) => r.reason).join(" | ");
    expect(reasons).toMatch(/no asset name or unit number/);
    expect(reasons).toMatch(/no start date/);
    expect(reasons).toMatch(/neither an end date nor a duration/);
    expect(reasons).toMatch(/not a number/);
  });

  it("accepts every row of the real sample", () => {
    const p = previewImport(ROWS, roles());
    expect(p.willReject).toBe(0);
    expect(p.willLoad).toBe(ROWS.length);
  });
});

describe("CSV parsing", () => {
  it("keeps a quoted comma inside its field instead of splitting the row", () => {
    // The existing wizard's split(",") turns this into 4 fields and shifts
    // every later column — a corruption that looks like data, not an error.
    const r = parseCSV(
      'unit,comment,hours\n7203,"REPLACED SEAL, PRESSURE TESTED",4.5\n',
    );
    expect(r[1]).toEqual(["7203", "REPLACED SEAL, PRESSURE TESTED", "4.5"]);
  });

  it("handles embedded newlines and doubled quotes", () => {
    const r = parseCSV('a,b\n"line one\nline two","he said ""stop"""\n');
    expect(r[1][0]).toBe("line one\nline two");
    expect(r[1][1]).toBe('he said "stop"');
  });

  it("strips the BOM Excel writes, which would otherwise poison the first header", () => {
    const r = parseCSV("﻿Equipment,Unit\nGrader,7203\n");
    expect(r[0][0]).toBe("Equipment");
  });

  it("tolerates CRLF and a missing trailing newline", () => {
    const r = parseCSV("a,b\r\n1,2\r\n3,4");
    expect(r).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("does not emit a phantom row for a trailing newline", () => {
    expect(parseCSV("a,b\n1,2\n").length).toBe(2);
  });
});
