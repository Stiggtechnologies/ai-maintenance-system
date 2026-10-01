/**
 * Primavera P6 XER -> SyncAI schedule-ingest rows.
 *
 * XER is a tab-delimited table exchange, not CSV. This parser only reads the
 * schedule facts the canonical `ingest_schedule_batch` door already accepts;
 * it never writes to P6 and never invents a project timezone. P6 timestamps
 * without an offset require the user to state the schedule's UTC offset.
 */

export interface P6XerOptions {
  developmentCaseId?: string;
  caseTitle?: string;
  utcOffset: string;
  scheduleName?: string;
}

export interface P6XerResourceAssignment {
  activityId: string;
  resourceId: string;
  resourceName: string | null;
  plannedUnits: number | null;
  remainingUnits: number | null;
}

export interface P6XerResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
  resourceAssignments: P6XerResourceAssignment[];
  projectNames: string[];
}

interface XerTable {
  fields: string[];
  rows: Array<Record<string, string>>;
}

const SCHEDULE_HEADERS = [
  "case_title",
  "development_case_id",
  "activity_id",
  "wbs_path",
  "description",
  "original_duration_hours",
  "planned_start",
  "planned_finish",
  "predecessors",
  "calendar",
  "schedule_name",
  "total_float_hours",
  "constraint_type",
  "constraint_date",
  "relationships",
] as const;

const CONSTRAINT_TYPES: Record<string, string> = {
  CS_MSO: "mandatory_start",
  CS_MEO: "mandatory_finish",
  CS_SO: "start_on",
  CS_FO: "finish_on",
  CS_SNET: "start_on_or_after",
  CS_SNLT: "start_on_or_before",
  CS_FNET: "finish_on_or_after",
  CS_FNLT: "finish_on_or_before",
  CS_ALAP: "as_late_as_possible",
  MANDATORY_START: "mandatory_start",
  MANDATORY_FINISH: "mandatory_finish",
  START_ON: "start_on",
  FINISH_ON: "finish_on",
  START_ON_OR_AFTER: "start_on_or_after",
  START_ON_OR_BEFORE: "start_on_or_before",
  FINISH_ON_OR_AFTER: "finish_on_or_after",
  FINISH_ON_OR_BEFORE: "finish_on_or_before",
  AS_LATE_AS_POSSIBLE: "as_late_as_possible",
};

const RELATIONSHIP_TYPES: Record<string, string> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
  FS: "FS",
  SS: "SS",
  FF: "FF",
  SF: "SF",
};

function parseTables(source: string): Map<string, XerTable> {
  const tables = new Map<string, XerTable>();
  let current: XerTable | null = null;

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!rawLine) continue;
    const cells = rawLine.split("\t");
    const marker = cells[0];
    if (marker === "%T") {
      const name = (cells[1] ?? "").trim().toUpperCase();
      if (!name)
        throw new Error("P6 XER contains a table marker with no table name");
      current = { fields: [], rows: [] };
      tables.set(name, current);
    } else if (marker === "%F" && current) {
      current.fields = cells.slice(1).map((cell) => cell.trim());
    } else if (marker === "%R" && current) {
      if (current.fields.length === 0) {
        throw new Error(
          "P6 XER contains a data row before its field definition",
        );
      }
      current.rows.push(
        Object.fromEntries(
          current.fields.map((field, index) => [field, cells[index + 1] ?? ""]),
        ),
      );
    }
  }
  return tables;
}

function finite(value: string | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const number = Number(trimmed);
  return Number.isFinite(number) ? String(number) : trimmed;
}

function validOffset(value: string): boolean {
  if (value === "Z") return true;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours <= 14 && minutes <= 59 && !(hours === 14 && minutes !== 0);
}

function timestamp(value: string | undefined, utcOffset: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const candidate = hasZone ? normalized : `${normalized}${utcOffset}`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString();
}

function first(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = String(row[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function parseP6Xer(source: string, options: P6XerOptions): P6XerResult {
  const caseId = String(options.developmentCaseId ?? "").trim();
  const caseTitle = String(options.caseTitle ?? "").trim();
  if (!caseId && !caseTitle) {
    throw new Error(
      "Choose the destination Development Case by id or exact title before reading a P6 XER file.",
    );
  }
  const utcOffset = options.utcOffset.trim();
  if (!validOffset(utcOffset)) {
    throw new Error(
      "State the P6 project UTC offset as Z or ±HH:MM; XER dates do not carry a trustworthy timezone.",
    );
  }

  const tables = parseTables(source);
  const tasks = tables.get("TASK")?.rows ?? [];
  if (tasks.length === 0) {
    throw new Error(
      "P6 XER contains no TASK rows, so there is no schedule to import.",
    );
  }

  const projects = new Map(
    (tables.get("PROJECT")?.rows ?? []).map((row) => [
      row.proj_id,
      first(row, "proj_short_name", "proj_name", "proj_id"),
    ]),
  );
  const projectNames = [...new Set([...projects.values()].filter(Boolean))];
  const calendars = new Map(
    (tables.get("CALENDAR")?.rows ?? []).map((row) => [
      row.clndr_id,
      first(row, "clndr_name", "clndr_id"),
    ]),
  );
  const resources = new Map(
    (tables.get("RSRC")?.rows ?? []).map((row) => [
      row.rsrc_id,
      first(row, "rsrc_short_name", "rsrc_name", "rsrc_id"),
    ]),
  );
  const wbsRows = tables.get("PROJWBS")?.rows ?? [];
  const wbsById = new Map(wbsRows.map((row) => [row.wbs_id, row]));
  const wbsMemo = new Map<string, string>();

  function wbsPath(id: string, active = new Set<string>()): string {
    if (!id) return "";
    const memo = wbsMemo.get(id);
    if (memo !== undefined) return memo;
    if (active.has(id))
      throw new Error(`P6 XER WBS hierarchy contains a cycle at ${id}`);
    active.add(id);
    const row = wbsById.get(id);
    if (!row) return id;
    const label = first(row, "wbs_short_name", "wbs_name", "wbs_id");
    const parent = String(row.parent_wbs_id ?? "").trim();
    const prefix = parent ? wbsPath(parent, active) : "";
    active.delete(id);
    const path = prefix ? `${prefix}.${label}` : label;
    wbsMemo.set(id, path);
    return path;
  }

  const taskCodeById = new Map(
    tasks.map((row) => [row.task_id, first(row, "task_code", "task_id")]),
  );
  const relationshipsByTask = new Map<
    string,
    Array<{
      predecessor: string;
      link_type: string | null;
      lag_hours: number | null;
    }>
  >();
  const warnings: string[] = [];
  for (const row of tables.get("TASKPRED")?.rows ?? []) {
    const successorId = String(row.task_id ?? "").trim();
    const predecessor = taskCodeById.get(String(row.pred_task_id ?? "").trim());
    if (!successorId || !predecessor) {
      warnings.push(
        `Ignored a TASKPRED row whose successor or predecessor is absent from TASK (${successorId || "unknown"}).`,
      );
      continue;
    }
    const rawType = first(row, "pred_type").toUpperCase();
    const lagText = first(row, "lag_hr_cnt");
    const lagNumber = lagText === "" ? null : Number(lagText);
    const relationship = {
      predecessor,
      link_type: RELATIONSHIP_TYPES[rawType] ?? (rawType || null),
      lag_hours:
        lagNumber !== null && Number.isFinite(lagNumber) ? lagNumber : null,
    };
    const list = relationshipsByTask.get(successorId) ?? [];
    list.push(relationship);
    relationshipsByTask.set(successorId, list);
  }

  const rows = tasks.map((row) => {
    const taskId = String(row.task_id ?? "").trim();
    const activityId = first(row, "task_code", "task_id");
    const relationships = relationshipsByTask.get(taskId) ?? [];
    const rawConstraint = first(row, "cstr_type").toUpperCase();
    const constraintType = rawConstraint
      ? (CONSTRAINT_TYPES[rawConstraint] ?? rawConstraint.toLowerCase())
      : "";
    return {
      case_title: caseTitle,
      development_case_id: caseId,
      activity_id: activityId,
      wbs_path: wbsPath(String(row.wbs_id ?? "").trim()),
      description: first(row, "task_name", "task_code", "task_id"),
      original_duration_hours: finite(
        first(row, "target_drtn_hr_cnt", "remain_drtn_hr_cnt"),
      ),
      planned_start: timestamp(
        first(
          row,
          "target_start_date",
          "early_start_date",
          "restart_date",
          "act_start_date",
        ),
        utcOffset,
      ),
      planned_finish: timestamp(
        first(
          row,
          "target_end_date",
          "early_end_date",
          "reend_date",
          "act_end_date",
        ),
        utcOffset,
      ),
      predecessors: relationships.map((item) => item.predecessor).join(","),
      calendar: calendars.get(String(row.clndr_id ?? "").trim()) ?? "",
      schedule_name:
        String(options.scheduleName ?? "").trim() ||
        projects.get(String(row.proj_id ?? "").trim()) ||
        "P6 XER import",
      total_float_hours: finite(first(row, "total_float_hr_cnt")),
      constraint_type: constraintType,
      constraint_date: timestamp(first(row, "cstr_date"), utcOffset),
      relationships: JSON.stringify(relationships),
    };
  });

  const resourceAssignments: P6XerResourceAssignment[] = [];
  for (const row of tables.get("TASKRSRC")?.rows ?? []) {
    const activityId = taskCodeById.get(String(row.task_id ?? "").trim());
    if (!activityId) continue;
    const resourceId = String(row.rsrc_id ?? "").trim();
    const planned = Number(first(row, "target_qty"));
    const remaining = Number(first(row, "remain_qty"));
    resourceAssignments.push({
      activityId,
      resourceId,
      resourceName: resources.get(resourceId) ?? null,
      plannedUnits: Number.isFinite(planned) ? planned : null,
      remainingUnits: Number.isFinite(remaining) ? remaining : null,
    });
  }
  if (resourceAssignments.length > 0) {
    warnings.push(
      `${resourceAssignments.length} P6 resource assignment(s) were detected. They are reported but not imported as approved resource demand; resource commitment remains a separate human-governed act.`,
    );
  }

  return {
    headers: [...SCHEDULE_HEADERS],
    rows,
    warnings,
    resourceAssignments,
    projectNames,
  };
}
