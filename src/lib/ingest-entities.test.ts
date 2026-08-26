/**
 * The pre-upload checks, and the CHECK constraints they must not fall behind.
 *
 * These used to be load-bearing. Neither validator had an exception block, so a
 * cell the database cannot cast — "yesterday" in a timestamp column, "n/a" in a
 * numeric one — RAISED inside the loop and aborted the whole batch, rolling
 * back the accepted rows AND the retained rejects with them. 20261004090100 and
 * 20261004090200 wrap every per-row write in a subtransaction, so that row now
 * comes back as a retained reject carrying the database's own message. These
 * checks stay because naming the row and the column beats naming a constraint,
 * and because a round trip avoided is a round trip avoided.
 *
 * ONE OF THEM IS STILL LOAD-BEARING, and it is the reason this file has a
 * rediscovering test at the bottom. A column with a CHECK ... in (...) and no
 * `oneOf` in the descriptor is a value the operator can only find out about
 * from a database error. That is exactly what shipped for
 * maintenance_notification's `notification_type` and `status`: the word
 * "malfunction", or a capitalised "Fault" from a CMMS export, reached the
 * insert and raised. The last test here reads the CHECK lists out of the
 * migrations and fails if any exposed column has drifted from them.
 */
import { describe, expect, it } from "vitest";
import {
  INGEST_ENTITIES,
  preflight,
  templateCsv,
  templateHeader,
  toPayload,
  unrecognisedColumns,
} from "./ingest-entities";
import { parseCSV } from "./fleet-import";

function rowsFrom(headers: string[], body: string[][]) {
  return body.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])),
  );
}

describe("a missing column is caught before anything is sent", () => {
  it("names the required column the file does not have", () => {
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      ["asset_name", "state"],
      [{ asset_name: "Conveyor C-22", state: "running" }],
    );
    expect(b.map((x) => x.column)).toContain("external_id");
    expect(b.map((x) => x.column)).toContain("started_at");
  });

  it("accepts either column of a one-of group", () => {
    const headers = [
      "asset_id",
      "external_id",
      "state",
      "started_at",
      "ended_at",
    ];
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        [
          "a-1",
          "OS-1",
          "running",
          "2026-08-01T06:00:00Z",
          "2026-08-01T14:00:00Z",
        ],
      ]),
    );
    expect(b).toEqual([]);
  });

  it("but refuses a file that has neither", () => {
    const headers = ["external_id", "state", "started_at", "ended_at"];
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        ["OS-1", "running", "2026-08-01T06:00:00Z", "2026-08-01T14:00:00Z"],
      ]),
    );
    expect(b.map((x) => x.message).join(" ")).toContain("asset_name, asset_id");
  });

  it("an uploaded state with no ended_at is refused before it is sent", () => {
    // A blank ended_at means "still in this state now", which a file cannot
    // assert. One such row made get_operating_context report 100% coverage of a
    // 90-day window whose data ended in 2010 — so the manual door requires it,
    // and the descriptor says so before the upload rather than after.
    const headers = ["asset_name", "external_id", "state", "started_at"];
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        ["Conveyor C-22", "OS-1", "running", "2026-08-01T06:00:00Z"],
      ]),
    );
    expect(b.map((x) => x.column)).toContain("ended_at");
  });
});

describe("the casts and ranges are caught before the round trip", () => {
  const headers = [
    "asset_name",
    "external_id",
    "state",
    "started_at",
    "ended_at",
    "load_pct",
  ];

  it("an unparseable timestamp is refused, and the cost of not refusing is stated", () => {
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        [
          "Conveyor C-22",
          "OS-1",
          "running",
          "yesterday",
          "2026-08-01T14:00:00Z",
          "",
        ],
      ]),
    );
    expect(b).toHaveLength(1);
    expect(b[0].row).toBe(1);
    expect(b[0].column).toBe("started_at");
    expect(b[0].message).toContain("not a date the database can read");
  });

  it("an unparseable number is refused", () => {
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        [
          "Conveyor C-22",
          "OS-1",
          "running",
          "2026-08-01T06:00:00Z",
          "2026-08-01T14:00:00Z",
          "n/a",
        ],
      ]),
    );
    expect(b[0].column).toBe("load_pct");
    expect(b[0].message).toContain("not a number");
  });

  it("a value outside a table CHECK is refused before the round trip", () => {
    // operating_states carries check (load_pct >= 0 and load_pct <= 200). The
    // validator now checks the range itself and the subtransaction would catch
    // it either way, so this is a better message rather than the only defence.
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        [
          "Conveyor C-22",
          "OS-1",
          "running",
          "2026-08-01T06:00:00Z",
          "2026-08-01T14:00:00Z",
          "500",
        ],
      ]),
    );
    expect(b[0].message).toContain("largest accepted value is 200");
  });

  it("a value outside an enumerated CHECK is refused, listing what is allowed", () => {
    // condition_readings carries check (quality in ('good','suspect','bad','substituted')).
    const h = ["external_id", "sensor_name", "value", "taken_at", "quality"];
    const b = preflight(
      INGEST_ENTITIES.condition_reading,
      h,
      rowsFrom(h, [
        ["CR-1", "Belt Speed", "1.2", "2026-08-01T06:00:00Z", "GOOD"],
      ]),
    );
    expect(b[0].column).toBe("quality");
    expect(b[0].message).toContain("good, suspect, bad, substituted");
  });

  it("a plain date with no time is accepted — that is what a spreadsheet exports", () => {
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        ["Conveyor C-22", "OS-1", "running", "2026-08-01", "2026-08-02", "72"],
      ]),
    );
    expect(b).toEqual([]);
  });

  it("a state the validator does not recognise is caught before the round trip", () => {
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        ["Conveyor C-22", "OS-1", "spinning", "2026-08-01", "2026-08-02", ""],
      ]),
    );
    expect(b[0].message).toContain("running, idle, standby");
  });

  it("mutation-sanity — a clean file produces no blockers at all", () => {
    const b = preflight(
      INGEST_ENTITIES.operating_state,
      headers,
      rowsFrom(headers, [
        [
          "Conveyor C-22",
          "OS-1",
          "running",
          "2026-08-01T06:00:00Z",
          "2026-08-01T14:00:00Z",
          "72",
        ],
        [
          "Conveyor C-22",
          "OS-2",
          "idle",
          "2026-08-01T14:00:00Z",
          "2026-08-01T18:00:00Z",
          "",
        ],
      ]),
    );
    expect(b).toEqual([]);
  });
});

describe("the payload is projected from the descriptor, never hand-listed", () => {
  it("blank cells become null, not empty strings", () => {
    const p = toPayload(
      INGEST_ENTITIES.operating_state,
      {
        asset_name: "Conveyor C-22",
        external_id: "OS-1",
        state: "running",
        started_at: "2026-08-01",
        ended_at: "",
        load_pct: "",
      },
      0,
    );
    expect(p.ended_at).toBeNull();
    expect(p.load_pct).toBeNull();
    expect(p.external_id).toBe("OS-1");
  });

  it("only maintenance_plan invents a positional identity for a blank one", () => {
    expect(
      toPayload(INGEST_ENTITIES.maintenance_plan, { task_label: "x" }, 2)
        .external_id,
    ).toBe("upload-row-3");
    expect(
      toPayload(INGEST_ENTITIES.operating_state, { state: "running" }, 2)
        .external_id,
    ).toBeNull();
  });

  it("a column the entity does not read is left out of the payload entirely", () => {
    const p = toPayload(
      INGEST_ENTITIES.operating_state,
      {
        external_id: "OS-1",
        state: "running",
        started_at: "2026-08-01",
        plant_notes: "ignore me",
      },
      0,
    );
    expect(p).not.toHaveProperty("plant_notes");
  });

  it("and is named to the operator rather than silently dropped", () => {
    expect(
      unrecognisedColumns(INGEST_ENTITIES.operating_state, [
        "external_id",
        "plant_notes",
      ]),
    ).toEqual(["plant_notes"]);
  });
});

describe("every template is a file its own validator would accept", () => {
  // A hand-maintained template drifts from the validator; this one is generated
  // from the same descriptor the checks read, and the test closes the loop by
  // parsing it back through the real CSV parser.
  for (const entity of Object.values(INGEST_ENTITIES)) {
    it(`${entity.key} round-trips through parseCSV with no blockers`, () => {
      const parsed = parseCSV(templateCsv(entity));
      const [hdr, ...body] = parsed;
      expect(hdr).toEqual(templateHeader(entity));
      expect(body.length).toBeGreaterThan(0);
      expect(preflight(entity, hdr, rowsFrom(hdr, body))).toEqual([]);
    });
  }

  it("quotes a cell containing a comma rather than breaking the row", () => {
    const csv = templateCsv(INGEST_ENTITIES.maintenance_notification);
    expect(
      parseCSV(csv).every((r) => r.length === parseCSV(csv)[0].length),
    ).toBe(true);
  });
});
