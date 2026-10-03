export type JsonRecord = Record<string, unknown>;

export interface P6ScheduleMappingConfig {
  projectObjectId: number;
  developmentCaseId: string;
  scheduleName: string;
  durationToHours: number;
  maxActivities: number;
  maxRelationships: number;
}

const CONSTRAINT_TYPES: Record<string, string> = {
  "mandatory start": "mandatory_start",
  "mandatory finish": "mandatory_finish",
  "start on": "start_on",
  "finish on": "finish_on",
  "start on or after": "start_on_or_after",
  "start on or before": "start_on_or_before",
  "finish on or after": "finish_on_or_after",
  "finish on or before": "finish_on_or_before",
  "as late as possible": "as_late_as_possible",
};

const RELATIONSHIP_TYPES: Record<string, "FS" | "FF" | "SS" | "SF"> = {
  "finish to start": "FS",
  "finish to finish": "FF",
  "start to start": "SS",
  "start to finish": "SF",
};

export const P6_ACTIVITY_FIELDS = [
  "ObjectId",
  "Id",
  "Name",
  "ProjectObjectId",
  "ProjectName",
  "WBSPath",
  "PlannedDuration",
  "PlannedStartDate",
  "PlannedFinishDate",
  "CalendarName",
  "TotalFloat",
  "PrimaryConstraintType",
  "PrimaryConstraintDate",
] as const;

export const P6_RELATIONSHIP_FIELDS = [
  "ObjectId",
  "PredecessorActivityObjectId",
  "PredecessorActivityId",
  "PredecessorProjectObjectId",
  "SuccessorActivityObjectId",
  "SuccessorActivityId",
  "SuccessorProjectObjectId",
  "Type",
  "Lag",
] as const;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return parsed;
}

function finite(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return parsed;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestamp(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ||
    !Number.isFinite(Date.parse(text))
  ) {
    throw new Error(
      `${label} must be an ISO date-time with an explicit offset.`,
    );
  }
  return text;
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function hours(value: number, multiplier: number, label: string): number {
  const converted = value * multiplier;
  if (!Number.isFinite(converted)) {
    throw new Error(`${label} does not convert to a finite number of hours.`);
  }
  return converted;
}

export function mapP6Constraint(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text || normalized(text) === "none") return undefined;
  const mapped = CONSTRAINT_TYPES[normalized(text)];
  if (!mapped) {
    throw new Error(`Unsupported P6 primary constraint type: ${text}.`);
  }
  return mapped;
}

export function mapP6RelationshipType(
  value: unknown,
): "FS" | "FF" | "SS" | "SF" {
  const text = requiredText(value, "P6 relationship Type");
  const mapped = RELATIONSHIP_TYPES[normalized(text)];
  if (!mapped) throw new Error(`Unsupported P6 relationship type: ${text}.`);
  return mapped;
}

export function p6ResourceUrl(
  base: URL,
  resource: "activity" | "relationship",
  fields: readonly string[],
  filter: string,
): URL {
  const url = new URL(base.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${resource}`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("Fields", fields.join(","));
  url.searchParams.set("Filter", filter);
  url.searchParams.set("OrderBy", "ObjectId");
  return url;
}

export function mapP6ScheduleSnapshot(
  activityValues: unknown[],
  relationshipValues: unknown[],
  config: P6ScheduleMappingConfig,
): JsonRecord[] {
  if (
    !Number.isSafeInteger(config.projectObjectId) ||
    config.projectObjectId <= 0 ||
    !config.developmentCaseId ||
    !config.scheduleName.trim() ||
    !Number.isFinite(config.durationToHours) ||
    config.durationToHours <= 0 ||
    !Number.isSafeInteger(config.maxActivities) ||
    config.maxActivities < 1 ||
    config.maxActivities > 5000 ||
    !Number.isSafeInteger(config.maxRelationships) ||
    config.maxRelationships < 1 ||
    config.maxRelationships > 20000
  ) {
    throw new Error("P6 schedule mapping configuration is invalid.");
  }
  if (activityValues.length === 0) {
    throw new Error("P6 returned no activities for the approved project.");
  }
  if (activityValues.length > config.maxActivities) {
    throw new Error("P6 activity response exceeds the approved row limit.");
  }
  if (relationshipValues.length > config.maxRelationships) {
    throw new Error("P6 relationship response exceeds the approved row limit.");
  }

  const activities = activityValues.map((value, index) =>
    record(value, `P6 activity row ${index + 1}`),
  );
  const objectIdToActivityId = new Map<number, string>();
  const activityIds = new Set<string>();
  for (const [index, activity] of activities.entries()) {
    const objectId = integer(
      activity.ObjectId,
      `P6 activity row ${index + 1} ObjectId`,
    );
    const projectId = integer(
      activity.ProjectObjectId,
      `P6 activity ${objectId} ProjectObjectId`,
    );
    if (projectId !== config.projectObjectId) {
      throw new Error("P6 activity escaped the approved project filter.");
    }
    const activityId = requiredText(activity.Id, `P6 activity ${objectId} Id`);
    if (objectIdToActivityId.has(objectId) || activityIds.has(activityId)) {
      throw new Error("P6 activity response contains duplicate identities.");
    }
    objectIdToActivityId.set(objectId, activityId);
    activityIds.add(activityId);
  }

  const relationshipsBySuccessor = new Map<
    number,
    Array<{ predecessor: string; link_type: string; lag_hours: number }>
  >();
  const relationshipPairs = new Set<string>();
  for (const [index, value] of relationshipValues.entries()) {
    const relationship = record(value, `P6 relationship row ${index + 1}`);
    const predecessorProject = integer(
      relationship.PredecessorProjectObjectId,
      `P6 relationship row ${index + 1} PredecessorProjectObjectId`,
    );
    const successorProject = integer(
      relationship.SuccessorProjectObjectId,
      `P6 relationship row ${index + 1} SuccessorProjectObjectId`,
    );
    if (
      predecessorProject !== config.projectObjectId ||
      successorProject !== config.projectObjectId
    ) {
      throw new Error(
        "P6 project has a cross-project predecessor. Import the connected project scope explicitly; SyncAI will not silently drop external schedule logic.",
      );
    }
    const predecessorObjectId = integer(
      relationship.PredecessorActivityObjectId,
      `P6 relationship row ${index + 1} PredecessorActivityObjectId`,
    );
    const successorObjectId = integer(
      relationship.SuccessorActivityObjectId,
      `P6 relationship row ${index + 1} SuccessorActivityObjectId`,
    );
    const predecessor = objectIdToActivityId.get(predecessorObjectId);
    const successor = objectIdToActivityId.get(successorObjectId);
    if (!predecessor || !successor) {
      throw new Error(
        "P6 relationship references an activity missing from the complete approved project response.",
      );
    }
    if (predecessor === successor) {
      throw new Error("P6 relationship contains a self predecessor.");
    }
    const pair = `${successorObjectId}:${predecessorObjectId}`;
    if (relationshipPairs.has(pair)) {
      throw new Error("P6 relationship response contains a duplicate edge.");
    }
    relationshipPairs.add(pair);
    const lag = finite(
      relationship.Lag ?? 0,
      `P6 relationship ${predecessor}→${successor} Lag`,
    );
    const values = relationshipsBySuccessor.get(successorObjectId) ?? [];
    values.push({
      predecessor,
      link_type: mapP6RelationshipType(relationship.Type),
      lag_hours: hours(
        lag,
        config.durationToHours,
        `P6 relationship ${predecessor}→${successor} Lag`,
      ),
    });
    relationshipsBySuccessor.set(successorObjectId, values);
  }

  return activities
    .map((activity, index) => {
      const objectId = integer(
        activity.ObjectId,
        `P6 activity row ${index + 1} ObjectId`,
      );
      const activityId = objectIdToActivityId.get(objectId)!;
      const duration = finite(
        activity.PlannedDuration,
        `P6 activity ${activityId} PlannedDuration`,
      );
      if (duration < 0) {
        throw new Error(`P6 activity ${activityId} has a negative duration.`);
      }
      const start = timestamp(
        activity.PlannedStartDate,
        `P6 activity ${activityId} PlannedStartDate`,
      );
      const finish = timestamp(
        activity.PlannedFinishDate,
        `P6 activity ${activityId} PlannedFinishDate`,
      );
      if (Date.parse(finish) < Date.parse(start)) {
        throw new Error(`P6 activity ${activityId} finishes before it starts.`);
      }
      const constraintType = mapP6Constraint(activity.PrimaryConstraintType);
      const constraintDate = optionalText(activity.PrimaryConstraintDate);
      if (
        constraintType &&
        constraintType !== "as_late_as_possible" &&
        !constraintDate
      ) {
        throw new Error(
          `P6 activity ${activityId} has a primary constraint without its date.`,
        );
      }
      if (
        constraintDate &&
        (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(constraintDate) ||
          !Number.isFinite(Date.parse(constraintDate)))
      ) {
        throw new Error(
          `P6 activity ${activityId} has a primary constraint date without a valid explicit offset.`,
        );
      }
      const totalFloat =
        activity.TotalFloat === undefined || activity.TotalFloat === null
          ? undefined
          : hours(
              finite(
                activity.TotalFloat,
                `P6 activity ${activityId} TotalFloat`,
              ),
              config.durationToHours,
              `P6 activity ${activityId} TotalFloat`,
            );
      const relationships = (relationshipsBySuccessor.get(objectId) ?? []).sort(
        (a, b) => a.predecessor.localeCompare(b.predecessor),
      );
      return {
        external_id: activityId,
        activity_id: activityId,
        p6_object_id: objectId,
        development_case_id: config.developmentCaseId,
        schedule_name: config.scheduleName.trim(),
        description: requiredText(
          activity.Name,
          `P6 activity ${activityId} Name`,
        ),
        original_duration_hours: hours(
          duration,
          config.durationToHours,
          `P6 activity ${activityId} PlannedDuration`,
        ),
        planned_start: start,
        planned_finish: finish,
        ...(optionalText(activity.WBSPath)
          ? { wbs_path: optionalText(activity.WBSPath) }
          : {}),
        ...(optionalText(activity.CalendarName)
          ? { calendar: optionalText(activity.CalendarName) }
          : {}),
        ...(totalFloat === undefined ? {} : { total_float_hours: totalFloat }),
        ...(constraintType ? { constraint_type: constraintType } : {}),
        ...(constraintDate ? { constraint_date: constraintDate } : {}),
        predecessors: relationships
          .map((relationship) => relationship.predecessor)
          .join(","),
        relationships,
      };
    })
    .sort(
      (a, b) =>
        Number(a.p6_object_id as number) - Number(b.p6_object_id as number),
    );
}
