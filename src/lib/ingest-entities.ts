/**
 * What the ingest contract carries, per entity type, in the words the person
 * uploading needs BEFORE they upload (capability register C2.04, C8.03, C2.12).
 *
 * WHY THIS TABLE EXISTS RATHER THAN PER-ENTITY COMPONENTS. The entity types
 * (seven when this table was written; schedule_activity joined in
 * 20261112090000) differ in ways nobody can guess from an error message and
 * which a single shared sentence gets WRONG:
 *
 *   - required columns differ;
 *   - the dedupe key differs — including in SCOPE: a work order is unique per
 *     organization, a schedule activity only per schedule;
 *   - re-upload behaviour differs, and this is the dangerous one. The shipped
 *     importer told every user "a re-upload updates rather than duplicates".
 *     That is true of maintenance_plan, maintenance_notification and
 *     material_stock — the three whose SQL branch ends in `on conflict ... do
 *     update` — and FALSE of the other four, which count a re-upload as
 *     `duplicate` and skip it. A single copy string was a false statement on
 *     four of seven types. Which is which is derived from the SQL branch by a
 *     test rather than restated here, because restating it is how it drifted.
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
 * THE CLIENT-SIDE CELL CHECKS ARE A COURTESY, NOT THE GUARANTEE. Until
 * 20261004090100 / 20261004090200 neither validator had an exception block, so
 * `(row->>'taken_at')::timestamptz` on the text "yesterday" RAISED and aborted
 * the whole batch — rolling back the accepted rows AND the retained rejects
 * with them. The same was true of a numeric cast and of any value violating a
 * table CHECK (`quality`, `load_pct`, `notification_type`). Both validators now
 * wrap every per-row write in a subtransaction, so such a row comes back as a
 * retained reject carrying the database's own words and the rest of the file
 * lands. The checks below stay because a message naming the cell and the row is
 * better than one naming a constraint, and because a round trip avoided is a
 * round trip avoided — but the contract's promise no longer depends on them.
 *
 * The `oneOf` lists are the exception to that: each one mirrors a CHECK
 * constraint, and a column with a CHECK and no `oneOf` here is a bug, not a
 * choice. `src/test/ingestImportDoor.test.ts` reads the CHECK lists out of the
 * CREATE TABLE statements and asserts the pairing, per entity.
 */

export type IngestEntityKey =
  | "maintenance_plan"
  | "maintenance_notification"
  | "work_order"
  | "condition_reading"
  | "material_stock"
  | "operating_state"
  | "production_record"
  | "schedule_activity"
  | "procurement_status";

export type IngestHandler =
  | "ingest_batch"
  | "ingest_context_batch"
  | "ingest_schedule_batch"
  | "ingest_procurement_status_batch";

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
        {
          name: "notification_type",
          kind: "text",
          oneOf: ["fault", "observation", "request", "safety"],
          note: "fault, observation, request or safety; blank means fault",
        },
        { name: "reported_by", kind: "text", note: "who raised it" },
        {
          name: "reported_at",
          kind: "timestamp",
          note: "when it was raised; blank means now",
        },
        {
          name: "status",
          kind: "text",
          oneOf: ["open", "in_planning", "converted", "rejected", "merged"],
          note: "open, in_planning, converted, rejected or merged; blank means open",
        },
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
        "Name an asset only if you can match it: a work order naming an asset this product cannot resolve is REFUSED, because every per-asset reliability figure is computed from work orders and one with no asset is a downtime hour nobody can attribute. Leaving both asset columns blank is allowed.",
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
        "A reading dated more than an hour in the future is refused as a clock or timezone fault at the source. ONLY THE NEWEST READING A SENSOR HAS SPEAKS FOR THE PRESENT: loading history moves that sensor's current value, status and trend to the newest reading in your file, and a breach there raises an alert dated to that reading. Readings older than one the sensor already holds are stored as history and change neither.",
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
        "A site_name that matches no site is REFUSED, so a mistyped site cannot land the whole file as one site-less pile. Stock is ONE quantity per material per site: two lines in the same file for the same pair are not both kept — the second is refused rather than silently overwriting the first, because this table has no external_id column to tell them apart.",
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
          required: true,
          kind: "timestamp",
          note: "when it ended — required on an upload, because a file cannot assert that a machine is still in this state now",
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
        "An asset is in ONE state at a time, and a period overlapping one already recorded for that asset is REFUSED — including a period loaded by an earlier fleet-history import under a different source name, which the external_id de-duplication cannot see. A period ending exactly when the next begins is contiguous, not overlapping. Periods in the future are refused as a clock fault at the source.",
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

    schedule_activity: {
      key: "schedule_activity",
      label: "Schedule activities (P6)",
      handler: "ingest_schedule_batch",
      purpose:
        "A project schedule exported from Primavera P6 (CSV layout), imported against a development case. P6 remains the system of record — Sync analyzes the schedule and never writes back. This slice LISTS what was imported on the case workspace; critical-path and schedule-confidence analysis are later work and are not claimed.",
      columns: [
        {
          name: "case_title",
          kind: "text",
          note: "the development case's title, exactly as it appears in Develop",
        },
        {
          name: "development_case_id",
          kind: "text",
          note: "the case's id, if you have it — either column will do",
        },
        {
          name: "activity_id",
          required: true,
          kind: "text",
          note: "the P6 Activity ID — this row's identity within its schedule",
        },
        {
          name: "wbs_path",
          kind: "text",
          note: "the WBS path, recorded verbatim",
        },
        {
          name: "description",
          required: true,
          kind: "text",
          note: "the activity name",
        },
        {
          name: "original_duration_hours",
          required: true,
          kind: "number",
          min: 0,
          note: "original duration IN HOURS, a finite non-negative number — P6 duration units are calendar-dependent, and this import records rather than guesses the calendar",
        },
        {
          name: "planned_start",
          required: true,
          kind: "timestamp",
          note: "planned start",
        },
        {
          name: "planned_finish",
          required: true,
          kind: "timestamp",
          note: "planned finish; a milestone may equal its start",
        },
        {
          name: "predecessors",
          kind: "text",
          note: "predecessor activity ids, separated by commas or semicolons — plain ids only, no relationship type or lag",
        },
        {
          name: "calendar",
          kind: "text",
          note: "the P6 calendar name, recorded and never interpreted",
        },
        {
          name: "schedule_name",
          kind: "text",
          note: "groups activities into one named schedule per case; blank means “P6 import”",
        },
      ],
      requiredOneOf: [["case_title", "development_case_id"]],
      externalIdFrom: "activity_id",
      dedupe: "one activity per activity_id, per schedule",
      reupload: "skips",
      reuploadSentence:
        "A re-upload is counted as DUPLICATE and skipped — a changed P6 export does not update activities in place. Schedule revisions against a baseline are change-control territory, not an import overwrite.",
      caution:
        "Every predecessor must resolve WITHIN THIS SCHEDULE — an activity already imported, or a valid row of the same upload. A row naming a predecessor that is missing, or that was itself refused, is REFUSED with the predecessor named, so the stored dependency set can never point at an activity that is not there. Files are sent in batches of 500 rows: if an export lists a successor more than 500 rows before its predecessor, upload the file again — the rows already loaded deduplicate and the remainder land against them.",
      outcome:
        "Activities appear in the case workspace's Schedule section, listed with their dependencies. Analysis — critical path, schedule confidence, simulation over imported activities — is later work and does not exist yet.",
      templateRows: [
        [
          "Crusher relining programme",
          "",
          "A1000",
          "MINE.CRUSH.RELINE",
          "Mobilise reline crew",
          "24",
          "2027-03-01T06:00:00Z",
          "2027-03-02T06:00:00Z",
          "",
          "7d-24h",
          "Reline 2027",
        ],
        [
          "Crusher relining programme",
          "",
          "A1010",
          "MINE.CRUSH.RELINE",
          "Remove worn liners",
          "36",
          "2027-03-02T06:00:00Z",
          "2027-03-03T18:00:00Z",
          "A1000",
          "7d-24h",
          "Reline 2027",
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
        "Use ONE unit of measure for the whole organisation. Cost per production unit refuses to compute at all across mixed units — a single figure over tonnes and hours would be meaningless — so a file mixing them silently disables that measure for everyone. A blank-looking unit is one of those units: a cell holding only spaces is refused rather than stored. A site_name or asset that matches nothing is refused too, so a mistyped name cannot land unattributed.",
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

    /**
     * §78's procurement-status connector (D11.33, Slice 6B).
     *
     * The one entity type here that writes NOTHING of its own. Its validator
     * resolves the package and calls the ONE §25 status writer
     * (set_procurement_package_status) or the ONE forecast writer
     * (record_package_delivery_forecast), so an imported status meets every
     * refusal a typed one meets — including the two an ERP feed would
     * otherwise walk straight through: it cannot type `commercial = awarded`
     * (an award is an authority-bearing §70 act) and it cannot type
     * `delivery = received_and_inspected` (the arrival DATE, not a status,
     * discharges the mandatory long-lead gate blocker).
     *
     * `status` deliberately carries NO `oneOf`: the vocabulary depends on
     * which dimension the row names, and a single flat list would be wrong on
     * three of the four. The door answers with the right list for the
     * dimension it was given.
     */
    procurement_status: {
      key: "procurement_status",
      label: "Procurement status (ERP / SAP MM)",
      handler: "ingest_procurement_status_batch",
      purpose:
        "Purchase-order status and promised delivery dates from the system that holds them, mapped onto the four spec §25 status dimensions of procurement packages already recorded in Sync. SAP or the ERP stays the system of record for the purchase order; Sync records what that status means for the gate.",
      columns: [
        {
          name: "external_id",
          required: true,
          kind: "text",
          note: "your identifier for this row — the PO line, or the export row id",
        },
        {
          name: "package_code",
          required: true,
          kind: "text",
          note: "the Sync procurement package this row is about, exactly as it appears in the case workspace",
        },
        {
          name: "dimension",
          kind: "text",
          oneOf: [
            "technical",
            "commercial",
            "manufacturing",
            "delivery",
          ] as const,
          note: "which of the four §25 status dimensions this row moves — leave blank on a forecast row",
        },
        {
          name: "status",
          kind: "text",
          note: "the new value for that dimension. Each dimension has its own vocabulary and the door answers with the right one if this is wrong — `commercial = awarded` and `delivery = received_and_inspected` are refused by name, because both are acts and not statuses",
        },
        {
          name: "forecast_delivery_date",
          kind: "text",
          note: "the promised delivery date, on a row that carries no dimension/status. One fact per row",
        },
        {
          name: "basis",
          kind: "text",
          note: "why the status moved. Left blank, the import derives one naming this file and this row — the status writer requires a stated reason and will not accept a blank",
        },
      ],
      externalIdFrom: "external_id",
      dedupe:
        "there is nothing to deduplicate against — contract_packages carries no external id — so a row is counted duplicate when the fact it states is the one already recorded: a dimension ALREADY at the stated value (the status writer's own refusal), or a forecast ALREADY at the stated date",
      reupload: "skips",
      reuploadSentence:
        "A re-upload of the same file is counted as DUPLICATE and skipped, fact by fact: the status writer refuses a move to the value a dimension already holds, and a forecast row restating the date the package already carries is skipped before the forecast writer is reached — it would otherwise be re-applied and audited as a change, because re-stating today's forecast is a no-op to an import and a deliberate re-affirmation to a planner. Rows whose status or date HAS changed since the last upload land.",
      caution:
        "The package must already exist in Sync. A procurement package carries the scope, the mandatory long-lead judgement and the dates a gate blocker reads — none of which an ERP export knows — so an unknown package_code is REFUSED rather than created. One fact per row: a row carrying both a status move and a forecast date is refused, because two writes in one row leave the first applied when the second is refused.",
      outcome:
        "The four §25 dimensions and the forecast delivery date move on the case's procurement screen, with the import named as the basis on each — and the mandatory long-lead gate blockers re-evaluate against the new dates.",
      templateRows: [
        [
          "PO-4501-10",
          "PKG-MILL-MOTOR",
          "manufacturing",
          "in_manufacture",
          "",
          "SAP PO 4501 line 10, status MANF",
        ],
        [
          "PO-4501-10-ETA",
          "PKG-MILL-MOTOR",
          "",
          "",
          "2027-04-18",
          "SAP confirmed delivery date on PO 4501 line 10",
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
  "schedule_activity",
  "procurement_status",
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
 * All of it would come back as retained rejects now that both validators wrap
 * each row in a subtransaction, so none of this is load-bearing for the
 * contract's guarantee. It is reported here because a message naming the row
 * and the column beats one naming a constraint, and because it saves a round
 * trip on the most common spreadsheet defects.
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
            message: `${col.name} is "${raw}", which is not a number.`,
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
            message: `${col.name} is "${raw}", which is not a date the database can read. Use 2026-08-01 or 2026-08-01T06:00:00Z.`,
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
