import { supabase } from "../lib/supabase";

export type DataQualityMetric =
  "completeness" | "timeliness" | "validity" | "uniqueness" | "consistency";

export interface DataDomain {
  id: number;
  key: string;
  label: string;
  description: string | null;
  ownerRole: string;
  ownerUserId: string | null;
  ownerName: string | null;
  stewardRole: string | null;
  basis: string | null;
  version: number;
  updatedAt: string;
}

export interface DataQualitySla {
  id: number;
  domainId: number;
  metric: DataQualityMetric;
  targetPct: number | null;
  targetLagHours: number | null;
  measuredPct: number | null;
  measuredLagHours: number | null;
  measuredOn: string | null;
  basis: string | null;
  sourceReference: string | null;
  createdAt: string;
}

export interface StewardAsset {
  id: string;
  name: string;
  tag: string | null;
  functionalLocation: string | null;
  siteId: string | null;
}

export interface StewardSensor {
  id: string;
  name: string;
  assetId: string;
  assetName: string;
  signalType: string | null;
  unit: string | null;
}

export interface InstrumentCalibration {
  id: number;
  sensorId: string | null;
  assetId: string | null;
  instrumentRef: string;
  calibratedOn: string | null;
  intervalMonths: number | null;
  asFoundWithinTolerance: boolean | null;
  asLeftWithinTolerance: boolean | null;
  certificateReference: string | null;
  basis: string | null;
  createdAt: string;
}

export interface HistorianMapping {
  id: number;
  historianTag: string;
  assetId: string | null;
  sensorId: string | null;
  measurement: string | null;
  unit: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  sourceSystem: string | null;
  basis: string | null;
  version: number;
  updatedAt: string;
}

export interface ArchiveRecord {
  id: number;
  recordClass: string;
  reference: string;
  archivedOn: string;
  disposition: "archived" | "superseded" | "obsolete" | "destroyed";
  supersededBy: string | null;
  retentionUntil: string | null;
  reason: string | null;
  evidenceReference: string | null;
  createdAt: string;
}

export interface DataStewardFinding {
  findingKey: string;
  category:
    | "asset_hierarchy"
    | "failure_codes"
    | "master_data"
    | "data_quality"
    | "calibration";
  severity: "critical" | "high" | "medium" | "information";
  observed: string;
  expected: string;
  route: string;
  humanActionRequired: true;
}

export interface DataStewardReviewAssignment {
  id: string;
  assignedTo: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  dueDate: string;
  note: string;
  assignedAt: string;
}

export interface DataStewardDisposition {
  id: string;
  findingKey: string;
  disposition: "accepted" | "remediated" | "deferred" | "rejected";
  note: string;
  evidenceReference: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface DataStewardAssessment {
  id: string;
  dataDomainId: number;
  domainLabel: string;
  agentRunId: string;
  sourceSnapshot: Record<string, unknown>;
  facts: Record<string, unknown>;
  findings: DataStewardFinding[];
  limitations: string[];
  createdBy: string;
  createdAt: string;
  assignments: DataStewardReviewAssignment[];
  dispositions: DataStewardDisposition[];
}

export interface DataStewardReviewer {
  id: string;
  name: string | null;
  email: string | null;
  role: "reliability_engineer" | "maintenance_manager" | "admin";
}

export interface IdentityPosture {
  assets_total?: number;
  name_only?: number;
  domains_defined?: number;
  slas_defined?: number;
  slas_breaching?: number;
  sensors_total?: number;
  sensors_with_rules?: number;
  calibrations_overdue?: number;
  historian_tags_mapped?: number;
  historian_tags_unconfirmed?: number;
  open_duplicate_candidates?: number;
  basis?: string;
}

export interface DataStewardWorkspace {
  domains: DataDomain[];
  slas: DataQualitySla[];
  assets: StewardAsset[];
  sensors: StewardSensor[];
  calibrations: InstrumentCalibration[];
  historianMappings: HistorianMapping[];
  archiveRecords: ArchiveRecord[];
  assessments: DataStewardAssessment[];
  reviewers: DataStewardReviewer[];
  identityPosture: IdentityPosture;
  basis: string;
}

function rpcError(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    return typeof value === "string"
      ? value
      : "Data-governance request failed.";
  }
  return null;
}

async function governedRpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as T;
}

export function loadDataStewardWorkspace(): Promise<DataStewardWorkspace> {
  return governedRpc<DataStewardWorkspace>("get_data_steward_workspace");
}

export function upsertDataDomain(input: {
  domainId?: number | null;
  domainKey: string;
  label: string;
  description: string;
  ownerRole: string;
  ownerUserId?: string | null;
  stewardRole: string;
  basis: string;
  expectedVersion?: number | null;
}) {
  return governedRpc<{ domainId: number; version: number; status: string }>(
    "upsert_data_domain",
    {
      p_domain_id: input.domainId ?? null,
      p_domain_key: input.domainKey,
      p_label: input.label,
      p_description: input.description,
      p_owner_role: input.ownerRole,
      p_owner_user_id: input.ownerUserId ?? null,
      p_steward_role: input.stewardRole,
      p_basis: input.basis,
      p_expected_version: input.expectedVersion ?? null,
    },
  );
}

export function recordDataQualitySla(input: {
  domainId: number;
  metric: DataQualityMetric;
  targetPct?: number | null;
  targetLagHours?: number | null;
  measuredPct?: number | null;
  measuredLagHours?: number | null;
  measuredOn?: string | null;
  basis: string;
  sourceReference: string;
}) {
  return governedRpc<{ slaId: number; status: string }>(
    "record_data_quality_sla",
    {
      p_domain_id: input.domainId,
      p_metric: input.metric,
      p_target_pct: input.targetPct ?? null,
      p_target_lag_hours: input.targetLagHours ?? null,
      p_measured_pct: input.measuredPct ?? null,
      p_measured_lag_hours: input.measuredLagHours ?? null,
      p_measured_on: input.measuredOn ?? null,
      p_basis: input.basis,
      p_source_reference: input.sourceReference,
    },
  );
}

export function recordInstrumentCalibration(input: {
  sensorId?: string | null;
  assetId?: string | null;
  instrumentRef: string;
  calibratedOn: string;
  intervalMonths: number;
  asFoundWithinTolerance: boolean;
  asLeftWithinTolerance: boolean;
  certificateReference: string;
  basis: string;
}) {
  return governedRpc<{ calibrationId: number; status: string }>(
    "record_instrument_calibration",
    {
      p_sensor_id: input.sensorId ?? null,
      p_asset_id: input.assetId ?? null,
      p_instrument_ref: input.instrumentRef,
      p_calibrated_on: input.calibratedOn,
      p_interval_months: input.intervalMonths,
      p_as_found_within_tolerance: input.asFoundWithinTolerance,
      p_as_left_within_tolerance: input.asLeftWithinTolerance,
      p_certificate_reference: input.certificateReference,
      p_basis: input.basis,
    },
  );
}

export function confirmHistorianTagMapping(input: {
  mappingId?: number | null;
  historianTag: string;
  assetId?: string | null;
  sensorId?: string | null;
  measurement: string;
  unit: string;
  sourceSystem: string;
  basis: string;
  expectedVersion?: number | null;
}) {
  return governedRpc<{ mappingId: number; version: number; status: string }>(
    "confirm_historian_tag_mapping",
    {
      p_mapping_id: input.mappingId ?? null,
      p_historian_tag: input.historianTag,
      p_asset_id: input.assetId ?? null,
      p_sensor_id: input.sensorId ?? null,
      p_measurement: input.measurement,
      p_unit: input.unit,
      p_source_system: input.sourceSystem,
      p_basis: input.basis,
      p_expected_version: input.expectedVersion ?? null,
    },
  );
}

export function recordArchiveDisposition(input: {
  recordClass: string;
  reference: string;
  archivedOn: string;
  disposition: "archived" | "superseded" | "obsolete" | "destroyed";
  supersededBy?: string | null;
  retentionUntil?: string | null;
  reason: string;
  evidenceReference: string;
}) {
  return governedRpc<{ archiveId: number; status: string }>(
    "record_archive_disposition",
    {
      p_record_class: input.recordClass,
      p_reference: input.reference,
      p_archived_on: input.archivedOn,
      p_disposition: input.disposition,
      p_superseded_by: input.supersededBy ?? null,
      p_retention_until: input.retentionUntil ?? null,
      p_reason: input.reason,
      p_evidence_reference: input.evidenceReference,
    },
  );
}

export function runDataStewardAgent(dataDomainId: number) {
  return governedRpc<{
    assessmentId: string;
    runId: string;
    facts: Record<string, unknown>;
    findings: DataStewardFinding[];
    advisory: true;
    mayChangeMasterData: false;
    mayMergeAssets: false;
    mayCodeFailure: false;
  }>("run_data_steward_agent", { p_data_domain_id: dataDomainId });
}

export function assignDataStewardReview(input: {
  assessmentId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}) {
  return governedRpc<{ assignmentId: string; status: string }>(
    "assign_data_steward_review",
    {
      p_assessment_id: input.assessmentId,
      p_assigned_to: input.assignedTo,
      p_due_date: input.dueDate,
      p_note: input.note,
    },
  );
}

export function recordDataStewardDisposition(input: {
  assessmentId: string;
  findingKey: string;
  disposition: "accepted" | "remediated" | "deferred" | "rejected";
  note: string;
  evidenceReference?: string | null;
}) {
  return governedRpc<{
    dispositionId: string;
    status: string;
    masterDataChanged: false;
    operationalAuthorization: false;
  }>("record_data_steward_disposition", {
    p_assessment_id: input.assessmentId,
    p_finding_key: input.findingKey,
    p_disposition: input.disposition,
    p_note: input.note,
    p_evidence_reference: input.evidenceReference ?? null,
  });
}
