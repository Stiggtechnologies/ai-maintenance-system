import { supabase } from "../lib/supabase";

export type RecoveryEventStatus =
  | "open"
  | "planning"
  | "approval"
  | "released"
  | "executing"
  | "return_pending"
  | "closed"
  | "cancelled";

export interface RecoveryBoardEvent {
  id: string;
  event_code: string;
  status: RecoveryEventStatus;
  event_type: string;
  reason: string;
  opened_at: string;
  asset_id: string;
  asset: string;
  tag: string | null;
  criticality: string | null;
  forecast_return_at: string | null;
  forecast_p80_return_at: string | null;
  baseline_return_at: string | null;
  scope_total: number;
  scope_complete: number;
  open_blockers: number;
}

export interface UnmanagedDownAsset {
  asset_id: string;
  asset: string;
  tag: string | null;
  state: string;
  down_since: string;
}

export interface RecoveryBoard {
  events: RecoveryBoardEvent[];
  unmanaged_down_assets: UnmanagedDownAsset[];
}

export interface RecoveryScopeItem {
  event_work_id: string;
  work_order_id: string;
  wo_number: string | null;
  title: string;
  priority: string;
  disposition: "mandatory" | "opportunity" | "defer";
  plan_state: "candidate" | "included" | "excluded";
  sequence_no: number;
  concurrency_rule: "unknown" | "sequential_only" | "verified_parallel";
  parallel_group: string | null;
  concurrency_basis: string | null;
  execution_status: "not_started" | "in_progress" | "blocked" | "complete";
  planned_hours: number | null;
  estimated_hours: number | null;
  job_plan_id: string | null;
  materials_ready: boolean;
  quality_checks: number;
}

export interface RecoveryCandidateWork {
  work_order_id: string;
  wo_number: string | null;
  title: string;
  priority: string;
  planned_hours: number | null;
  estimated_hours: number | null;
}

export interface RecoveryConstraint {
  id: string;
  event_id: string;
  event_work_id: string | null;
  predecessor_work_id: string | null;
  constraint_kind: string;
  phase: "planning" | "execution" | "return_to_service";
  is_hard: boolean;
  state: "unknown" | "satisfied" | "blocked" | "not_applicable";
  description: string;
  basis: string;
  source_kind: string;
  source_ref: string | null;
  owner_role: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface RecoveryBlocker {
  id: string;
  event_id: string;
  event_work_id: string | null;
  category: string;
  description: string;
  owner_role: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  started_at: string;
  escalation_due_at: string | null;
  forecast_rts_impact_hours: number | null;
  impact_basis: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface RecoveryPlanTask {
  event_work_id: string;
  work_order_id: string;
  wo_number: string | null;
  title: string;
  priority: string;
  hours: number | null;
  duration_basis: string;
  historical_sample: number;
  p50_hours: number | null;
  p80_hours: number | null;
  concurrency_rule: string;
  parallel_group: string | null;
}

export interface RecoveryPlanStage {
  sequence: number;
  mode: "parallel" | "sequential";
  duration_hours: number | null;
  p50_hours: number | null;
  p80_hours: number | null;
  tasks: RecoveryPlanTask[];
}

export interface RecoveryPlan {
  id: string;
  event_id: string;
  version: number;
  status: "draft" | "approval" | "released" | "rejected" | "superseded";
  engine_version: string;
  schedule: RecoveryPlanStage[];
  serial_hours: number | null;
  critical_path_hours: number | null;
  p50_critical_path_hours: number | null;
  p80_critical_path_hours: number | null;
  forecast_return_at: string | null;
  forecast_p80_return_at: string | null;
  historical_min_sample: number;
  planned_concurrent_work_ratio: number | null;
  missing_inputs: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  unresolved_planning_hard_constraints: number;
  baseline_snapshot: Record<string, unknown>;
  projected_hours_recovered: number | null;
  projected_downtime_value_usd: number | null;
  economics_basis: string | null;
  release_decision_id: string | null;
  generated_by: string;
  generated_at: string;
  released_by: string | null;
  released_at: string | null;
  approval_status?: string | null;
  approved_by?: string | null;
}

export interface RecoveryEventDetail {
  event: {
    id: string;
    event_code: string;
    asset_id: string;
    site_id: string | null;
    event_type: string;
    reason: string;
    status: RecoveryEventStatus;
    opened_at: string;
    baseline_return_at: string | null;
    baseline_method: string | null;
    baseline_basis: string | null;
    baseline_frozen_at: string | null;
    forecast_return_at: string | null;
    forecast_p80_return_at: string | null;
    actual_return_at: string | null;
  };
  scope: RecoveryScopeItem[];
  candidate_work: RecoveryCandidateWork[];
  constraints: RecoveryConstraint[];
  blockers: RecoveryBlocker[];
  latest_plan: RecoveryPlan | null;
  kpis: {
    planned_concurrent_work_ratio_pct: number | null;
    downtime_conversion_efficiency: number | null;
    revenue_hours_recovered: number | null;
    elapsed_hours: number;
    note: string;
  };
  controls: {
    unresolved_planning_hard: number;
    unresolved_execution_hard: number;
    unresolved_rts_hard: number;
    unknown_concurrency_items: number;
  };
}

export interface RecoveryQualityCheck {
  id: string;
  check_description: string;
  acceptance_criterion: string;
  is_hold_point: boolean;
}

export interface RecoveryOpportunity {
  work_order_id: string;
  wo_number: string | null;
  title: string;
  priority: string;
  work_type: string;
  planned_hours: number | null;
  fit: boolean | null;
  reason: string;
}

export interface RecoveryOpportunities {
  asset_id: string;
  window_hours: number;
  fits: RecoveryOpportunity[];
  does_not_fit: RecoveryOpportunity[];
  unsized: RecoveryOpportunity[];
  note: string;
}

export interface RpcResult {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export type RecoveryCapabilityPayload = Record<string, unknown>;

export interface RecoveryControlSnapshot {
  handoff: RecoveryCapabilityPayload;
  decisionQueue: RecoveryCapabilityPayload;
  componentLife: RecoveryCapabilityPayload;
  partsRisk: RecoveryCapabilityPayload;
  cannibalization: RecoveryCapabilityPayload;
  economics: RecoveryCapabilityPayload;
  delayAttribution: RecoveryCapabilityPayload;
  firstTimeRight: RecoveryCapabilityPayload;
  sequencePatterns: RecoveryCapabilityPayload;
  productivityNorms: RecoveryCapabilityPayload;
}

function rpcPayload<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as RpcResult | null;
  if (payload && typeof payload === "object" && payload.error) {
    throw new Error(String(payload.error));
  }
  return data as T;
}

async function call<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  return rpcPayload<T>(data, error);
}

export const recoveryCache = {
  boardKey: "sync-recovery:last-board:v1",
  eventKey: (eventId: string) => `sync-recovery:last-event:v1:${eventId}`,
  read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  write<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Cache is an optional degraded-mode read aid, never a source of truth.
    }
  },
};

export async function getRecoveryBoard(): Promise<RecoveryBoard> {
  const data = await call<RecoveryBoard>("get_recovery_board");
  recoveryCache.write(recoveryCache.boardKey, data);
  return data;
}

export async function getRecoveryEvent(
  eventId: string,
): Promise<RecoveryEventDetail> {
  const data = await call<RecoveryEventDetail>("get_recovery_event", {
    p_event_id: eventId,
  });
  recoveryCache.write(recoveryCache.eventKey(eventId), data);
  return data;
}

export async function getRecoveryQualityChecks(eventWorkId: string): Promise<{
  job_plan_id: string | null;
  checks: RecoveryQualityCheck[];
  note: string;
}> {
  return call("get_recovery_quality_checks", { p_event_work_id: eventWorkId });
}

export async function getRecoveryOpportunities(
  eventId: string,
  windowHours: number,
): Promise<RecoveryOpportunities> {
  return call("get_recovery_opportunities", {
    p_event_id: eventId,
    p_window_hours: windowHours,
  });
}

export async function getRecoveryControlSnapshot(
  eventId: string,
  siteId?: string | null,
): Promise<RecoveryControlSnapshot> {
  const [
    handoff,
    decisionQueue,
    componentLife,
    partsRisk,
    cannibalization,
    economics,
    delayAttribution,
    firstTimeRight,
    sequencePatterns,
    productivityNorms,
  ] = await Promise.all([
    call<RecoveryCapabilityPayload>("get_recovery_handoff", {
      p_event_id: eventId,
    }),
    call<RecoveryCapabilityPayload>("get_recovery_decision_queue"),
    call<RecoveryCapabilityPayload>("get_recovery_component_life_context", {
      p_event_id: eventId,
    }),
    call<RecoveryCapabilityPayload>("get_recovery_parts_risk", {
      p_event_id: eventId,
    }),
    call<RecoveryCapabilityPayload>("get_recovery_cannibalization_options", {
      p_event_id: eventId,
    }),
    call<RecoveryCapabilityPayload>("get_recovery_economics", {
      p_event_id: eventId,
    }),
    call<RecoveryCapabilityPayload>("get_recovery_counterfactual_attribution", {
      p_event_id: eventId,
    }),
    call<RecoveryCapabilityPayload>("get_recovery_ftr_metrics"),
    call<RecoveryCapabilityPayload>("get_recovery_sequence_patterns"),
    call<RecoveryCapabilityPayload>("get_recovery_productivity_norms", {
      p_site_id: siteId ?? null,
    }),
  ]);

  return {
    handoff,
    decisionQueue,
    componentLife,
    partsRisk,
    cannibalization,
    economics,
    delayAttribution,
    firstTimeRight,
    sequencePatterns,
    productivityNorms,
  };
}

export const recoveryActions = {
  openEvent: (assetId: string, reason: string, eventType: string) =>
    call<RpcResult>("open_restoration_event", {
      p_asset_id: assetId,
      p_reason: reason,
      p_event_type: eventType,
    }),
  setBaseline: (
    eventId: string,
    baselineReturnAt: string,
    method: string,
    basis: string,
  ) =>
    call<RpcResult>("set_restoration_baseline", {
      p_event_id: eventId,
      p_baseline_return_at: baselineReturnAt,
      p_method: method,
      p_basis: basis,
    }),
  addWork: (eventId: string, workOrderId: string, disposition: string) =>
    call<RpcResult>("add_restoration_work", {
      p_event_id: eventId,
      p_work_order_id: workOrderId,
      p_disposition: disposition,
    }),
  includeCandidate: (eventWorkId: string, reason: string) =>
    call<RpcResult>("include_restoration_candidate", {
      p_event_work_id: eventWorkId,
      p_reason: reason,
    }),
  sequenceWork: (eventWorkId: string, sequenceNo: number) =>
    call<RpcResult>("sequence_restoration_work", {
      p_event_work_id: eventWorkId,
      p_sequence_no: sequenceNo,
    }),
  verifyParallel: (
    eventId: string,
    eventWorkIds: string[],
    group: string,
    basis: string,
  ) =>
    call<RpcResult>("verify_restoration_parallel_group", {
      p_event_id: eventId,
      p_event_work_ids: eventWorkIds,
      p_group: group,
      p_basis: basis,
    }),
  addConstraint: (args: {
    eventId: string;
    eventWorkId?: string | null;
    kind: string;
    phase: string;
    isHard: boolean;
    description: string;
    basis: string;
    ownerRole?: string | null;
    predecessorWorkId?: string | null;
  }) =>
    call<RpcResult>("add_restoration_constraint", {
      p_event_id: args.eventId,
      p_event_work_id: args.eventWorkId ?? null,
      p_kind: args.kind,
      p_phase: args.phase,
      p_is_hard: args.isHard,
      p_description: args.description,
      p_basis: args.basis,
      p_owner_role: args.ownerRole ?? null,
      p_predecessor_work_id: args.predecessorWorkId ?? null,
    }),
  setConstraintState: (constraintId: string, state: string, basis: string) =>
    call<RpcResult>("set_restoration_constraint_state", {
      p_constraint_id: constraintId,
      p_state: state,
      p_basis: basis,
    }),
  recordBlocker: (args: {
    eventId: string;
    eventWorkId?: string | null;
    category: string;
    description: string;
    ownerRole: string;
    severity: string;
    escalationDueAt?: string | null;
    forecastRtsImpactHours?: number | null;
    impactBasis?: string | null;
  }) =>
    call<RpcResult>("record_restoration_blocker", {
      p_event_id: args.eventId,
      p_event_work_id: args.eventWorkId ?? null,
      p_category: args.category,
      p_description: args.description,
      p_owner_role: args.ownerRole,
      p_severity: args.severity,
      p_escalation_due_at: args.escalationDueAt ?? null,
      p_forecast_rts_impact_hours: args.forecastRtsImpactHours ?? null,
      p_impact_basis: args.impactBasis ?? null,
    }),
  resolveBlocker: (blockerId: string, note: string) =>
    call<RpcResult>("resolve_restoration_blocker", {
      p_blocker_id: blockerId,
      p_note: note,
    }),
  generatePlan: async (eventId: string) => {
    await call<RpcResult>("refresh_recovery_planning_inputs", {
      p_event_id: eventId,
    });
    return call<RpcResult>("generate_restoration_plan", {
      p_event_id: eventId,
    });
  },
  submitPlan: (planId: string) =>
    call<RpcResult>("submit_restoration_plan_for_approval", {
      p_plan_id: planId,
    }),
  releasePlan: (planId: string) =>
    call<RpcResult>("release_restoration_plan", { p_plan_id: planId }),
  startWork: (eventWorkId: string) =>
    call<RpcResult>("start_restoration_work", {
      p_event_work_id: eventWorkId,
    }),
  completeWork: (
    eventWorkId: string,
    actualHours: number,
    completionNote: string,
    qualityResults: Array<{ check_id: string; result: "pass" }>,
  ) =>
    call<RpcResult>("complete_restoration_work", {
      p_event_work_id: eventWorkId,
      p_actual_hours: actualHours,
      p_completion_note: completionNote,
      p_quality_results: qualityResults,
    }),
  closeEvent: (eventId: string, note: string) =>
    call<RpcResult>("close_restoration_event", {
      p_event_id: eventId,
      p_note: note,
    }),
  refreshPlanningInputs: (eventId: string) =>
    call<RpcResult>("refresh_recovery_planning_inputs", {
      p_event_id: eventId,
    }),
  runRiskSimulation: (planId: string, iterations = 2000) =>
    call<RecoveryCapabilityPayload>("run_restoration_risk_simulation", {
      p_plan_id: planId,
      p_iterations: iterations,
    }),
  simulateWhatIf: (
    planId: string,
    changes: Record<string, unknown>,
    basis: string,
  ) =>
    call<RecoveryCapabilityPayload>("simulate_recovery_what_if", {
      p_plan_id: planId,
      p_changes: changes,
      p_basis: basis,
    }),
  runFleetOptimization: (siteId?: string | null) =>
    call<RecoveryCapabilityPayload>("run_recovery_fleet_optimization", {
      p_site_id: siteId ?? null,
    }),
  publishCadence: (cadence: "shift" | "daily" | "weekly", eventId: string) =>
    call<RpcResult>("publish_recovery_cadence_snapshot", {
      p_cadence: cadence,
      p_event_id: eventId,
    }),
  refreshRecurrenceCandidates: (eventId: string, windowDays = 30) =>
    call<RpcResult>("refresh_recovery_recurrence_candidates", {
      p_event_id: eventId,
      p_window_days: windowDays,
    }),
  recordFeedback: (args: {
    eventId: string;
    kind: string;
    key: string;
    disposition: string;
    reasonCode: string;
    reasonText: string;
  }) =>
    call<RpcResult>("record_recovery_recommendation_feedback", {
      p_event_id: args.eventId,
      p_kind: args.kind,
      p_key: args.key,
      p_disposition: args.disposition,
      p_reason_code: args.reasonCode,
      p_reason_text: args.reasonText,
    }),
  recordDelayAttribution: (args: {
    eventId: string;
    category: string;
    hours: number;
    attribution: string;
    basis: string;
  }) =>
    call<RpcResult>("record_recovery_delay_attribution", {
      p_event_id: args.eventId,
      p_category: args.category,
      p_hours: args.hours,
      p_attribution: args.attribution,
      p_basis: args.basis,
    }),
  setConsequence: (args: {
    eventId: string;
    safety: number;
    environment: number;
    business: number;
    production: number;
    basis: string;
  }) =>
    call<RpcResult>("set_recovery_consequence", {
      p_event_id: args.eventId,
      p_safety: args.safety,
      p_environment: args.environment,
      p_business: args.business,
      p_production: args.production,
      p_basis: args.basis,
    }),
  registerOperationalSignal: (args: {
    kind: string;
    key: string;
    state: "available" | "unavailable" | "unknown";
    observedAt: string;
    validUntil: string;
    sourceSystem: string;
    basis: string;
    siteId?: string | null;
    assetId?: string | null;
    sourceRef?: string | null;
    payload?: Record<string, unknown>;
  }) =>
    call<RpcResult>("register_operational_constraint_signal", {
      p_kind: args.kind,
      p_key: args.key,
      p_state: args.state,
      p_observed_at: args.observedAt,
      p_valid_until: args.validUntil,
      p_source_system: args.sourceSystem,
      p_basis: args.basis,
      p_site_id: args.siteId ?? null,
      p_asset_id: args.assetId ?? null,
      p_source_ref: args.sourceRef ?? null,
      p_payload: args.payload ?? {},
    }),
  setResourceRequirement: (args: {
    eventId: string;
    eventWorkId?: string | null;
    kind: string;
    key: string;
    phase: string;
    isHard: boolean;
    basis: string;
  }) =>
    call<RpcResult>("set_restoration_resource_requirement", {
      p_event_id: args.eventId,
      p_event_work_id: args.eventWorkId ?? null,
      p_kind: args.kind,
      p_key: args.key,
      p_phase: args.phase,
      p_is_hard: args.isHard,
      p_basis: args.basis,
    }),
  setWorkZone: (args: {
    eventWorkId: string;
    zone: string;
    componentScope?: string | null;
    basis: string;
  }) =>
    call<RpcResult>("set_restoration_work_zone", {
      p_event_work_id: args.eventWorkId,
      p_zone: args.zone,
      p_component_scope: args.componentScope ?? null,
      p_basis: args.basis,
    }),
  recordEnergyState: (args: {
    assetId: string;
    energyType: string;
    state: string;
    basis: string;
    isolationRef?: string | null;
    validUntil?: string | null;
  }) =>
    call<RpcResult>("record_asset_energy_state", {
      p_asset_id: args.assetId,
      p_energy_type: args.energyType,
      p_state: args.state,
      p_basis: args.basis,
      p_isolation_ref: args.isolationRef ?? null,
      p_valid_until: args.validUntil ?? null,
      p_source_system: "manual",
    }),
  setEnergyRequirement: (args: {
    jobPlanId: string;
    energyType: string;
    requiredState: string;
    basis: string;
  }) =>
    call<RpcResult>("set_job_plan_energy_requirement", {
      p_job_plan_id: args.jobPlanId,
      p_energy_type: args.energyType,
      p_required_state: args.requiredState,
      p_basis: args.basis,
    }),
  setUncertaintyGroup: (args: {
    eventWorkId: string;
    group: string;
    sharedShockWeight: number;
    basis: string;
  }) =>
    call<RpcResult>("set_recovery_uncertainty_group", {
      p_event_work_id: args.eventWorkId,
      p_group: args.group,
      p_shared_shock_weight: args.sharedShockWeight,
      p_basis: args.basis,
    }),
  addFieldEvidence: (args: {
    eventId: string;
    eventWorkId: string;
    kind: string;
    note: string;
    attachmentId?: string | null;
    metadata?: Record<string, unknown>;
    clientCommandId?: string | null;
  }) =>
    call<RpcResult>("add_recovery_field_evidence", {
      p_event_id: args.eventId,
      p_event_work_id: args.eventWorkId,
      p_kind: args.kind,
      p_note: args.note,
      p_attachment_id: args.attachmentId ?? null,
      p_metadata: args.metadata ?? {},
      p_client_command_id: args.clientCommandId ?? null,
    }),
  configureSignalConnector: (args: {
    key: string;
    name: string;
    systemKind: string;
    endpointHint: string;
    expectedIntervalMinutes: number;
    credentialBindingRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    call<RpcResult>("configure_recovery_signal_connector", {
      p_key: args.key,
      p_name: args.name,
      p_system_kind: args.systemKind,
      p_endpoint_hint: args.endpointHint,
      p_expected_interval_minutes: args.expectedIntervalMinutes,
      p_credential_binding_ref: args.credentialBindingRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),
};
