/**
 * What the ingest contract carries, per entity type, in the words the person
 * uploading needs BEFORE they upload (capability register C2.04, C8.03, C2.12).
 *
 * WHY THIS TABLE EXISTS RATHER THAN SEVEN COMPONENTS. The seven entity types
 * differ in ways nobody can guess from an error message and which a single
 * shared sentence gets WRONG:
 *
 *   - required columns differ;
 *   - the dedupe key differs — three different keys across the seven;
 *   - re-upload behaviour differs, and this is the dangerous one. The shipped
 *     importer told every user "a re-upload updates rather than duplicates".
 *     That is true of maintenance_plan and material_stock and FALSE of the
 *     other five, which count a re-upload as `duplicate` and skip it. A single
 *     copy string was a false statement on five of seven types.
 *   - two of them cannot be loaded at all until something else is loaded
 *     first, and nothing in the product creates that something.
 *
 * `handler` is not used to make the call — the surface always calls
 * `ingest_rows`, and the RUN decides which validator sees the rows
 * (20261004090000). It is recorded here because it is the fact the migration's
 * route table also records, and `ingestImportDoor.test.ts` asserts the two
 * agree. If a future entity type is added to one and not the other, that test
 * fails rather than a customer discovering it.
 *
 * THE CLIENT-SIDE CELL CHECKS ARE NOT DECORATION. Neither ingest_batch nor
 * ingest_context_batch has an exception block, so `(row->>'taken_at')::timestamptz`
 * on the text "yesterday" RAISES and aborts the whole batch — rolling back the
 * accepted rows AND the retained rejects with it. The same is true of a numeric
 * cast and of a value that violates a table CHECK (`quality`, `load_pct`). For
 * the single most common spreadsheet defect the contract's first promise —
 * "refused rows are kept with their reason" — therefore does not hold. Until
 * that is fixed in SQL, the surface refuses to send a file containing such a
 * cell and names the cell, which is a worse guarantee honestly stated rather
 * than a better one falsely implied.
 */

export type IngestEntityKey =
  | "maintenance_plan"
  | "maintenance_notification"
  | "work_order"
  | "condition_reading"
  | "material_stock"
  | "operating_state"
  | "production_record";

export type IngestHandler = "ingest_batch" | "ingest_context_batch";

export interface ColumnSpec {
  name: string;
  /** Every row must carry a non-blank value. */
  required?: boolean;
  kind: "text" | "number" | "timestamp";
  /** Allowed values, checked before upload because the column has a CHECK. */
  oneOf?: readonly string[];
  min?: number;
  max?: number;
  /** Shown next to the column name in the pre-upload column list. */
  note: string;
}

export interface IngestEntity {
  key: IngestEntityKey;
  label: string;
  /** The validator that owns this type. Mirrors ingest_entity_routes(). */
  handler: IngestHandler;
  purpose: string;
  columns: readonly ColumnSpec[];
  /**
   * Groups where at least one column must resolve. `[["asset_name","asset_id"]]`
   * means a row needs one of the two.
   */
  requiredOneOf?: readonly (readonly string[])[];
  /** Column whose value becomes external_id. */
  externalIdFrom: string;
  /**
   * True only where the shipped importer already synthesised a positional id
   * for blank values. Preserved rather than changed, and stated in the UI,
   * because a synthesised id makes a re-ordered re-upload look like new data.
   */
  synthesiseExternalId?: boolean;
  dedupe: string;
  reupload: "updates" | "skips";
  reuploadSentence: string;
  /** Something a customer cannot create in this product yet. */
  prerequisite?: string;
  caution?: string;
  /** What changes for the customer once rows land. */
  outcome: string;
  templateRows: readonly (readonly string[])[];
}

const ASSET_REF: readonly ColumnSpec[] = [
  {
    name: "asset_name",
    kind: "text",
    note: "the asset's name, exactly as it appears in Assets",
  },
  {
    name: "asset_id",
    kind: "text",
    note: "the asset's id, if you have it — either column will do",
  },
];

export const INGEST_ENTITIES: Readonly<Record<IngestEntityKey, IngestEntity>> =
  {
    maintenance_plan: {
      key: "maintenance_plan",
      label: "Maintenance plans (PM programme)",
      handler: "ingest_batch",
      purpose:
        "Your PM programme. Until plans are loaded, PM compliance is computed against work raised rather than work due, and says so on its face.",
      columns: [
        ...ASSET_REF,
        {
          name: "task_label",
          required: true,
          kind: "text",
          note: "what the task is",
        },
        {
          name: "task_code",
          kind: "text",
          note: "your code for the task — also the row's identity",
        },
        {
          name: "interval_value",
          required: true,
          kind: "number",
          min: 0.000001,
          note: "how often, as a positive number",
        },
        {
          name: "interval_basis",
          kind: "text",
          oneOf: ["calendar_days", "run_hours"],
          note: "calendar_days or run_hours; blank means calendar_days",
        },
        {
          name: "last_performed_at",
          kind: "timestamp",
          note: "when it was last done",
        },
        {
          name: "source",
          kind: "text",
          note: "where the interval came from — recorded, never invented",
        },
      ],
      requiredOneOf: [["asset_name", "asset_id"]],
      externalIdFrom: "task_code",
      synthesiseExternalId: true,
      dedupe: "one plan per asset per task_code",
      reupload: "updates",
      reuploadSentence:
        "A re-upload UPDATES the matching plan — label, basis, interval, last-performed and source are all overwritten.",
      caution:
        "A row with no task_code is given a positional id (upload-row-3). Re-uploading the same file with the rows in a different order will then create plans instead of updating them. Give every row a task_code.",
      outcome:
        "PM compliance measures against occurrences falling due from these plans. A PM never raised counts as missed.",
      templateRows: [
        [
          "Conveyor C-22",
          "",
          "Belt condition inspection",
          "PM-BELT-INSP",
          "30",
          "calendar_days",
          "2026-07-01",
          "OEM manual s4.2",
        ],
        [
          "Compressor K-05",
          "",
          "Compressor oil change",
          "PM-OIL-CHG",
          "4000",
          "run_hours",
          "",
          "Site standard PM-114",
        ],
      ],
    },

    maintenance_notification: {
      key: "maintenance_notification",
      label: "Maintenance notifications",
      handler: "ingest_batch",
      purpose:
        "Fault reports and observations raised against equipment, from your CMMS or a spreadsheet.",
      columns: [
        ...ASSET_REF,
        {
          name: "notification_no",
          kind: "text",
          note: "your notification number — also the row's identity",
        },
        {
          name: "description",
          required: true,
          kind: "text",
          note: "what was observed",
        },
        { name: "notification_type", kind: "text", note: "blank means fault" },
        { name: "reported_by", kind: "text", note: "who raised it" },
        {
          name: "reported_at",
          kind: "timestamp",
          note: "when it was raised; blank means now",
        },
        { name: "status", kind: "text", note: "blank means open" },
      ],
      externalIdFrom: "notification_no",
      dedupe: "one notification per notification_no",
      reupload: "updates",
      reuploadSentence:
        "A re-upload UPDATES the matching notification's description and status.",
      caution:
        "The asset may be left blank. But if you name one and it does not match, the row is REFUSED rather than accepted without an asset — a notification whose asset cannot be resolved is invisible to duplicate detection and to every per-asset reliability figure.",
      outcome:
        "Notifications feed duplicate detection and the per-asset fault history.",
      templateRows: [
        [
          "Conveyor C-22",
          "",
          "N-100234",
          "Belt tracking to the drive side, rubbing the frame",
          "fault",
          "A. Operator",
          "2026-08-01T07:15:00Z",
          "open",
        ],
        [
          "Compressor K-05",
          "",
          "N-100235",
          "Unusual discharge noise at load",
          "fault",
          "A. Operator",
          "2026-08-02T09:40:00Z",
          "open",
        ],
      ],
    },

    work_order: {
      key: "work_order",
      label: "Work orders",
      handler: "ingest_batch",
      purpose:
        "Work-order history. Completed orders with a failure mode and downtime are what every reliability figure is computed from.",
      columns: [
        ...ASSET_REF,
        {
          name: "wo_number",
          required: true,
          kind: "text",
          note: "your work-order number — this row's identity",
        },
        {
          name: "title",
          required: true,
          kind: "text",
          note: "what the work was",
        },
        { name: "status", kind: "text", note: "blank means open" },
        { name: "priority", kind: "text", note: "blank means medium" },
        { name: "work_type", kind: "text", note: "blank means corrective" },
        {
          name: "created_at",
          kind: "timestamp",
          note: "when it was raised; blank means now",
        },
        {
          name: "completed_at",
          kind: "timestamp",
          note: "when it was finished",
        },
        {
          name: "failure_mode",
          kind: "text",
          note: "what actually failed, in your words",
        },
        {
          name: "downtime_hours",
          kind: "number",
          min: 0,
          note: "hours the asset was down",
        },
      ],
      externalIdFrom: "wo_number",
      dedupe: "one work order per wo_number, per upload connector",
      reupload: "skips",
      reuploadSentence:
        "A re-upload is counted as DUPLICATE and skipped. A work order is an event; correcting one means loading it under a new number.",
      caution:
        "Unlike plans and notifications, a work order whose asset cannot be matched is ACCEPTED with no asset attached. It will not appear in any per-asset figure. Check the asset names first.",
      outcome:
        "Work-order history drives failure-rate, MTBF and downtime analysis.",
      templateRows: [
        [
          "Conveyor C-22",
          "",
          "WO-88120",
          "Replace drive-end bearing",
          "completed",
          "high",
          "corrective",
          "2026-05-02T06:00:00Z",
          "2026-05-02T14:30:00Z",
          "Bearing seizure",
          "8.5",
        ],
        [
          "Compressor K-05",
          "",
          "WO-88121",
          "Quarterly service",
          "completed",
          "medium",
          "preventive",
          "2026-06-01T06:00:00Z",
          "2026-06-01T10:00:00Z",
          "",
          "0",
        ],
      ],
    },

    condition_reading: {
      key: "condition_reading",
      label: "Condition readings",
      handler: "ingest_batch",
      purpose:
        "Measured readings against a sensor — vibration, temperature, pressure. Loaded readings are evaluated against the sensor's limits exactly as a keyed-in reading is.",
      columns: [
        {
          name: "external_id",
          required: true,
          kind: "text",
          note: "your identifier for this reading",
        },
        {
          name: "sensor_name",
          kind: "text",
          note: "the sensor's name, exactly as it appears in the product",
        },
        {
          name: "sensor_id",
          kind: "text",
          note: "the sensor's id — either column will do",
        },
        {
          name: "value",
          required: true,
          kind: "number",
          note: "the measured value",
        },
        {
          name: "taken_at",
          required: true,
          kind: "timestamp",
          note: "when it was measured",
        },
        {
          name: "quality",
          kind: "text",
          oneOf: ["good", "suspect", "bad", "substituted"],
          note: "blank means good; suspect and bad are stored but never raise an alert",
        },
      ],
      requiredOneOf: [["sensor_name", "sensor_id"]],
      externalIdFrom: "external_id",
      dedupe: "one reading per external_id, per upload connector",
      reupload: "skips",
      reuploadSentence: "A re-upload is counted as DUPLICATE and skipped.",
      prerequisite:
        "The sensors must already exist. This product has no screen that creates one, so a tenant whose sensors have not been provisioned will see every row refused with “unknown sensor”. Check the sensor list before uploading.",
      caution:
        "A reading dated more than an hour in the future is refused as a clock or timezone fault at the source. A loaded reading that breaches a limit raises an alert, exactly as a keyed-in one would.",
      outcome:
        "Readings build the condition history and raise alerts on a limit crossing.",
      templateRows: [
        [
          "CR-000001",
          "Vibration — Drive End",
          "",
          "2.4",
          "2026-08-01T06:00:00Z",
          "good",
        ],
        [
          "CR-000002",
          "Vibration — Drive End",
          "",
          "2.9",
          "2026-08-01T07:00:00Z",
          "good",
        ],
      ],
    },

    material_stock: {
      key: "material_stock",
      label: "Spares on hand",
      handler: "ingest_batch",
      purpose:
        "On-hand and on-order quantities for catalogue materials, so spares availability stops being a template figure.",
      columns: [
        {
          name: "external_id",
          required: true,
          kind: "text",
          note: "your identifier for this stock line",
        },
        {
          name: "material_code",
          required: true,
          kind: "text",
          note: "the catalogue code, exactly as it appears",
        },
        {
          name: "qty_on_hand",
          required: true,
          kind: "number",
          min: 0,
          note: "how many you hold",
        },
        {
          name: "qty_on_order",
          kind: "number",
          min: 0,
          note: "how many are on order; blank means none",
        },
        { name: "site_name", kind: "text", note: "which site holds them" },
      ],
      externalIdFrom: "external_id",
      dedupe: "one stock line per material per site",
      reupload: "updates",
      reuploadSentence:
        "A re-upload UPDATES the quantity in place and is counted as ACCEPTED, not duplicate — a stock level is a snapshot, not an event.",
      prerequisite:
        "The material catalogue must be loaded first. This product has no screen that creates a material, so a tenant without a provisioned catalogue will see every row refused with “the catalogue must be loaded before stock”.",
      caution:
        "A site_name that does not match any site is NOT refused — the row is stored with no site. Check your site names, or the whole file lands as one site-less pile.",
      outcome:
        "On-hand quantities feed spares optimisation and work-order material readiness.",
      templateRows: [
        ["ST-0001", "IMP-230", "12", "4", "Fort McMurray Site A"],
        ["ST-0002", "IMP-250", "3", "0", "Fort McMurray Site A"],
      ],
    },

    operating_state: {
      key: "operating_state",
      label: "Operating states (duty history)",
      handler: "ingest_context_batch",
      purpose:
        "What each asset was doing, and when — running, idle, standby, down. This is the input most other capabilities name as their blocker: without it the platform knows THAT an asset failed and never what it was doing when it failed.",
      columns: [
        ...ASSET_REF,
        {
          name: "external_id",
          required: true,
          kind: "text",
          note: "your identifier for this state period",
        },
        {
          name: "state",
          required: true,
          kind: "text",
          oneOf: [
            "running",
            "idle",
            "standby",
            "down_planned",
            "down_unplanned",
            "offline",
          ],
          note: "one of running, idle, standby, down_planned, down_unplanned, offline",
        },
        {
          name: "started_at",
          required: true,
          kind: "timestamp",
          note: "when the state began",
        },
        {
          name: "ended_at",
          kind: "timestamp",
          note: "when it ended; blank means still in this state",
        },
        {
          name: "load_pct",
          kind: "number",
          min: 0,
          max: 200,
          note: "duty as a percentage, 0–200",
        },
        {
          name: "reason_code",
          kind: "text",
          note: "your reason code, for down states",
        },
      ],
      requiredOneOf: [["asset_name", "asset_id"]],
      externalIdFrom: "external_id",
      dedupe: "one state per external_id, per upload connector",
      reupload: "skips",
      reuploadSentence:
        "A re-upload of this file is counted as DUPLICATE and skipped. A state period is immutable — correcting one means loading it under a new external_id.",
      caution:
        "That de-duplication only compares this upload against PREVIOUS UPLOADS. States already loaded by a fleet-history import carry that import's own source name and will NOT be matched, so re-loading a period you have already imported creates a second, overlapping copy — and every downtime, availability and utilisation figure computed from it doubles. Nothing in the database prevents two simultaneous states on one machine. Load periods you have not already loaded.",
      outcome:
        "State coverage, downtime and availability stop being computed from work orders alone. This is also the only path in the product that writes a running, idle or standby state — until one exists, utilisation and production-loss figures have no denominator.",
      templateRows: [
        [
          "Conveyor C-22",
          "",
          "OS-000001",
          "running",
          "2026-08-01T06:00:00Z",
          "2026-08-01T14:00:00Z",
          "72",
          "",
        ],
        [
          "Conveyor C-22",
          "",
          "OS-000002",
          "down_unplanned",
          "2026-08-01T14:00:00Z",
          "2026-08-01T17:30:00Z",
          "",
          "BELT-TRACKING",
        ],
      ],
    },

    production_record: {
      key: "production_record",
      label: "Production records",
      handler: "ingest_context_batch",
      purpose:
        "What was actually produced, over what period, in what unit — the denominator for cost and loss per unit.",
      columns: [
        ...ASSET_REF,
        {
          name: "external_id",
          required: true,
          kind: "text",
          note: "your identifier for this period",
        },
        {
          name: "site_name",
          kind: "text",
          note: "the site, if the figure is not per-asset",
        },
        {
          name: "period_start",
          required: true,
          kind: "timestamp",
          note: "start of the production period",
        },
        {
          name: "period_end",
          required: true,
          kind: "timestamp",
          note: "end of the period; must be after the start",
        },
        {
          name: "units_produced",
          required: true,
          kind: "number",
          min: 0,
          note: "how much was produced",
        },
        {
          name: "unit_of_measure",
          required: true,
          kind: "text",
          note: "tonne, barrel, hour — a quantity without a unit cannot be aggregated",
        },
      ],
      requiredOneOf: [["asset_name", "asset_id", "site_name"]],
      externalIdFrom: "external_id",
      dedupe: "one record per external_id, per upload connector",
      reupload: "skips",
      reuploadSentence: "A re-upload is counted as DUPLICATE and skipped.",
      caution:
        "Use ONE unit of measure for the whole organisation. Cost per production unit refuses to compute at all across mixed units — a single figure over tonnes and hours would be meaningless — so a file mixing them silently disables that measure for everyone.",
      outcome:
        "Production totals feed cost per production unit and production loss attributable to equipment.",
      templateRows: [
        [
          "Conveyor C-22",
          "",
          "PR-000001",
          "",
          "2026-08-01T00:00:00Z",
          "2026-08-02T00:00:00Z",
          "4200",
          "tonne",
        ],
        [
          "Conveyor C-22",
          "",
          "PR-000002",
          "",
          "2026-08-02T00:00:00Z",
          "2026-08-03T00:00:00Z",
          "3980",
          "tonne",
        ],
      ],
    },
  };

export const INGEST_ENTITY_ORDER: readonly IngestEntityKey[] = [
  "maintenance_plan",
  "work_order",
  "maintenance_notification",
  "operating_state",
  "production_record",
  "condition_reading",
  "material_stock",
];

/** Header row for the downloadable template, in declaration order. */
export function templateHeader(entity: IngestEntity): string[] {
  return entity.columns.map((c) => c.name);
}

export function templateCsv(entity: IngestEntity): string {
  const rows = [
    templateHeader(entity),
    ...entity.templateRows.map((r) => [...r]),
  ];
  return rows
    .map((r) =>
      r
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(","),
    )
    .join("\n");
}

export interface Blocker {
  /** 1-based row number as the operator counts them, header excluded. */
  row: number | null;
  column: string | null;
  message: string;
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function parsesAsTimestamp(value: string): boolean {
  // Date.parse accepts far too much ("1", "Dec"), and Postgres accepts things
  // it rejects. Require an explicit ISO-ish date, which is what a spreadsheet
  // exports and what timestamptz reads unambiguously.
  if (
    !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
      value,
    )
  ) {
    return false;
  }
  return !Number.isNaN(
    Date.parse(
      value.includes("T") || value.includes(" ") ? value : `${value}T00:00:00Z`,
    ),
  );
}

/**
 * Everything that would make the upload fail, found before it is sent.
 *
 * Missing headers and blank required cells would come back as retained rejects,
 * so they are reported here only to save a round trip. The cast and range
 * checks are different in kind: those would ABORT the batch in the database and
 * take the retained rejects down with them, so refusing to send is the only way
 * the operator sees which cell was wrong.
 */
export function preflight(
  entity: IngestEntity,
  headers: string[],
  rows: Record<string, string>[],
): Blocker[] {
  const blockers: Blocker[] = [];
  const present = new Set(headers);

  for (const col of entity.columns) {
    if (col.required && !present.has(col.name)) {
      blockers.push({
        row: null,
        column: col.name,
        message: `the file has no ${col.name} column, and every row needs one`,
      });
    }
  }
  for (const group of entity.requiredOneOf ?? []) {
    if (!group.some((name) => present.has(name))) {
      blockers.push({
        row: null,
        column: group.join(" or "),
        message: `the file needs one of these columns: ${group.join(", ")}`,
      });
    }
  }
  if (blockers.length > 0) return blockers;

  rows.forEach((row, i) => {
    const n = i + 1;
    for (const col of entity.columns) {
      const raw = (row[col.name] ?? "").trim();
      if (raw === "") {
        if (col.required) {
          blockers.push({
            row: n,
            column: col.name,
            message: `${col.name} is blank`,
          });
        }
        continue;
      }
      if (col.kind === "number") {
        if (!NUMERIC.test(raw)) {
          blockers.push({
            row: n,
            column: col.name,
            message: `${col.name} is "${raw}", which is not a number. The database would stop the whole upload on this cell, losing the record of every other refused row with it.`,
          });
          continue;
        }
        const v = Number(raw);
        if (col.min !== undefined && v < col.min) {
          blockers.push({
            row: n,
            column: col.name,
            message: `${col.name} is ${raw}; the smallest accepted value is ${col.min}`,
          });
        }
        if (col.max !== undefined && v > col.max) {
          blockers.push({
            row: n,
            column: col.name,
            message: `${col.name} is ${raw}; the largest accepted value is ${col.max}`,
          });
        }
      } else if (col.kind === "timestamp") {
        if (!parsesAsTimestamp(raw)) {
          blockers.push({
            row: n,
            column: col.name,
            message: `${col.name} is "${raw}", which is not a date the database can read. Use 2026-08-01 or 2026-08-01T06:00:00Z. The database would stop the whole upload on this cell, losing the record of every other refused row with it.`,
          });
        }
      } else if (col.oneOf && !col.oneOf.includes(raw)) {
        blockers.push({
          row: n,
          column: col.name,
          message: `${col.name} is "${raw}"; it must be one of ${col.oneOf.join(", ")}`,
        });
      }
    }
    for (const group of entity.requiredOneOf ?? []) {
      if (!group.some((name) => (row[name] ?? "").trim() !== "")) {
        blockers.push({
          row: n,
          column: group.join(" or "),
          message: `this row needs one of ${group.join(", ")}`,
        });
      }
    }
  });

  return blockers;
}

/** Columns in the file that this entity does not recognise, so they can be named. */
export function unrecognisedColumns(
  entity: IngestEntity,
  headers: string[],
): string[] {
  const known = new Set(entity.columns.map((c) => c.name));
  return headers.filter((h) => h !== "" && !known.has(h));
}

/** The JSON row the contract reads, built from the descriptor, never by hand. */
export function toPayload(
  entity: IngestEntity,
  row: Record<string, string>,
  index: number,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const col of entity.columns) {
    const raw = (row[col.name] ?? "").trim();
    out[col.name] = raw === "" ? null : raw;
  }
  const id = (row[entity.externalIdFrom] ?? "").trim();
  out.external_id =
    id !== ""
      ? id
      : entity.synthesiseExternalId
        ? `upload-row-${index + 1}`
        : null;
  return out;
}
