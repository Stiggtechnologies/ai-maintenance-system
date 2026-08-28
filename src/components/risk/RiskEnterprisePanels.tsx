import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenCheck,
  BrainCircuit,
  Check,
  ClipboardCheck,
  GitBranch,
  Network,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import { useAsyncData } from "../../hooks/useAsyncData";
import {
  adoptRiskObjective,
  adoptRiskObligation,
  configureRiskAgentBinding,
  configureRiskAuthorityScope,
  configureRiskControlLifecycle,
  configureRiskIntegrationBinding,
  createRiskObjectiveVersion,
  createRiskObligationVersion,
  decideRiskDecision,
  decideRiskLearningTransfer,
  getObjectiveTree,
  getRiskDecisionOperations,
  getRiskEnterpriseArchitecture,
  invalidateRiskAssumption,
  linkRiskObjective,
  linkRiskObligation,
  linkRiskTreatmentDependency,
  provisionRiskAdvisoryAgents,
  recordRiskAnalysisElement,
  recordRiskAssumption,
  recordRiskAssuranceReview,
  recordRiskChallenge,
  recordRiskCommunication,
  recordRiskEventScenario,
  recordRiskLearningTransfer,
  recordRiskLikelihoodEstimate,
  recordRiskObligation,
  recordRiskOutcomeAttribution,
  recordRiskStressTest,
  resolveRiskChallenge,
  transitionRiskLifecycle,
  upsertRiskObjective,
  upsertRiskStakeholder,
} from "../../services/riskOperatingService";
import type { ObjectiveTreeNode } from "../../services/riskOperatingService";
import type {
  EnterpriseRiskArchitecture,
  RiskAuthorityProfile,
  RiskContextNode,
  RiskDecisionOperations,
  RiskParticipant,
  RiskRecord,
} from "../../types/risk";
import { ErrorState, LoadingState } from "../ui/AsyncStates";

interface PanelProps {
  risks: RiskRecord[];
  participants: RiskParticipant[];
  contexts: RiskContextNode[];
  authorityProfiles: RiskAuthorityProfile[];
  onChanged: () => void;
}

type AdvancedAction =
  | "objective"
  | "objective_version"
  | "objective_link"
  | "stakeholder"
  | "obligation"
  | "obligation_version"
  | "obligation_link"
  | "assumption"
  | "source"
  | "consequence"
  | "likelihood"
  | "scenario"
  | "stress"
  | "treatment_dependency"
  | "control_lifecycle"
  | "challenge"
  | "assurance"
  | "communication"
  | "learning_transfer"
  | "outcome_attribution"
  | "lifecycle"
  | "authority_scope"
  | "integration"
  | "agent";

interface FieldDefinition {
  key: string;
  label: string;
  kind?: "text" | "textarea" | "number" | "date" | "select" | "multi";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

const ACTIONS: Array<{
  id: AdvancedAction;
  label: string;
  category: string;
}> = [
  { id: "objective", label: "Objective", category: "Context & governance" },
  {
    id: "objective_version",
    label: "Objective successor version",
    category: "Context & governance",
  },
  {
    id: "objective_link",
    label: "Link objective to risk",
    category: "Context & governance",
  },
  { id: "stakeholder", label: "Stakeholder", category: "Context & governance" },
  { id: "obligation", label: "Obligation", category: "Context & governance" },
  {
    id: "obligation_version",
    label: "Obligation successor version",
    category: "Context & governance",
  },
  {
    id: "obligation_link",
    label: "Link obligation to risk",
    category: "Context & governance",
  },
  {
    id: "assumption",
    label: "Assumption",
    category: "Identification & analysis",
  },
  { id: "source", label: "Risk source", category: "Identification & analysis" },
  {
    id: "consequence",
    label: "Consequence",
    category: "Identification & analysis",
  },
  {
    id: "likelihood",
    label: "Likelihood estimate",
    category: "Identification & analysis",
  },
  { id: "scenario", label: "Event scenario", category: "Scenario & stress" },
  {
    id: "stress",
    label: "Stress / reverse stress test",
    category: "Scenario & stress",
  },
  {
    id: "treatment_dependency",
    label: "Treatment dependency",
    category: "Execution & control",
  },
  {
    id: "control_lifecycle",
    label: "Control lifecycle",
    category: "Execution & control",
  },
  {
    id: "challenge",
    label: "Formal challenge",
    category: "Assurance & communication",
  },
  {
    id: "assurance",
    label: "Assurance review",
    category: "Assurance & communication",
  },
  {
    id: "communication",
    label: "Risk communication",
    category: "Assurance & communication",
  },
  {
    id: "learning_transfer",
    label: "Learning transfer",
    category: "Outcome & learning",
  },
  {
    id: "outcome_attribution",
    label: "Outcome attribution",
    category: "Outcome & learning",
  },
  {
    id: "lifecycle",
    label: "Lifecycle transition",
    category: "Outcome & learning",
  },
  {
    id: "authority_scope",
    label: "Authority scope",
    category: "Platform bindings",
  },
  {
    id: "integration",
    label: "Integration binding",
    category: "Platform bindings",
  },
  {
    id: "agent",
    label: "Advisory agent binding",
    category: "Platform bindings",
  },
];

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-[#080D14] px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500/50";

function list(value = ""): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(value: unknown, fallback = "—"): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function number(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function Field({
  definition,
  value,
  onChange,
}: {
  definition: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `advanced-${definition.key}`;
  return (
    <label className="block text-xs font-medium text-slate-400" htmlFor={id}>
      {definition.label}
      {definition.required ? (
        <span className="ml-1 text-amber-300">*</span>
      ) : null}
      {definition.kind === "textarea" ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={definition.placeholder}
          className={`${inputClass} min-h-24 resize-y`}
          required={definition.required}
        />
      ) : definition.kind === "select" || definition.kind === "multi" ? (
        <select
          id={id}
          value={definition.kind === "multi" ? list(value) : value}
          multiple={definition.kind === "multi"}
          onChange={(event) =>
            onChange(
              definition.kind === "multi"
                ? [...event.target.selectedOptions]
                    .map((option) => option.value)
                    .join(",")
                : event.target.value,
            )
          }
          className={`${inputClass} ${definition.kind === "multi" ? "min-h-28" : ""}`}
          required={definition.required}
        >
          {definition.kind !== "multi" ? (
            <option value="">Select…</option>
          ) : null}
          {definition.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={
            definition.kind === "number"
              ? "number"
              : definition.kind === "date"
                ? "date"
                : "text"
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={definition.placeholder}
          className={inputClass}
          required={definition.required}
        />
      )}
    </label>
  );
}

function fieldsFor(
  action: AdvancedAction,
  props: PanelProps,
  data: EnterpriseRiskArchitecture,
): FieldDefinition[] {
  const riskOptions = props.risks.map((risk) => ({
    value: risk.id,
    label: risk.title,
  }));
  const contextOptions = props.contexts.map((context) => ({
    value: context.id,
    label: context.name,
  }));
  const participantOptions = props.participants.map((participant) => ({
    value: participant.id,
    label: participant.full_name ?? participant.role ?? participant.id,
  }));
  const objectiveOptions = data.objectives.map((objective) => ({
    value: objective.id,
    label: objective.description,
  }));
  const obligationOptions = data.obligations.map((obligation) => ({
    value: obligation.id,
    label: `${obligation.source_reference} · ${obligation.status}`,
  }));
  const controls = props.risks.flatMap((risk) =>
    risk.controls.map((control) => ({
      value: control.id,
      label: `${risk.title} · ${control.name}`,
    })),
  );
  const treatments = props.risks.flatMap((risk) =>
    risk.treatments.map((treatment) => ({
      value: treatment.id,
      label: `${risk.title} · ${treatment.label}`,
    })),
  );
  const baseRisk: FieldDefinition = {
    key: "risk_id",
    label: "Risk",
    kind: "select",
    required: true,
    options: riskOptions,
  };
  switch (action) {
    case "objective":
      return [
        {
          key: "objective_level",
          label: "Level",
          kind: "select",
          required: true,
          options: [
            "enterprise",
            "business_unit",
            "site",
            "system",
            "asset",
            "project",
            "task",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "context_id",
          label: "Context",
          kind: "select",
          options: contextOptions,
        },
        {
          key: "owner_id",
          label: "Accountable owner",
          kind: "select",
          required: true,
          options: participantOptions,
        },
        {
          key: "parent_id",
          label: "Parent objective (spec §2 nesting)",
          kind: "select",
          options: objectiveOptions,
        },
        { key: "description", label: "Objective", required: true },
        { key: "target", label: "Target", required: true },
        {
          key: "target_value",
          label: "Target value (typed — optional)",
          kind: "number",
        },
        { key: "unit", label: "Unit (required with a target value)" },
        { key: "target_date", label: "Target date", kind: "date" },
        { key: "measurement", label: "Measurement", required: true },
        { key: "timeframe", label: "Timeframe", required: true },
        {
          key: "tolerance",
          label: "Tolerance",
          kind: "textarea",
          required: true,
        },
        { key: "review_date", label: "Review date", kind: "date" },
      ];
    case "objective_version":
      return [
        {
          key: "objective_id",
          label: "Adopted objective",
          kind: "select",
          required: true,
          options: data.objectives
            .filter((item) => item.status === "adopted")
            .map((item) => ({
              value: item.id,
              label: `${item.description} · v${item.version}`,
            })),
        },
        {
          key: "reason",
          label: "Why a successor version is required",
          kind: "textarea",
          required: true,
        },
        {
          key: "objective_level",
          label: "New level (optional)",
          kind: "select",
          options: [
            "enterprise",
            "business_unit",
            "site",
            "system",
            "asset",
            "project",
            "task",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "owner_id",
          label: "New owner (optional)",
          kind: "select",
          options: participantOptions,
        },
        {
          key: "parent_id",
          label: "New parent (optional)",
          kind: "select",
          options: objectiveOptions,
        },
        {
          key: "context_id",
          label: "New context (optional)",
          kind: "select",
          options: contextOptions,
        },
        { key: "description", label: "New description", kind: "textarea" },
        { key: "target", label: "New target" },
        { key: "measurement", label: "New measure" },
        { key: "timeframe", label: "New timeframe" },
        { key: "tolerance", label: "New tolerance", kind: "textarea" },
        { key: "review_date", label: "New review date", kind: "date" },
      ];
    case "objective_link":
      return [
        baseRisk,
        {
          key: "objective_id",
          label: "Adopted objective",
          kind: "select",
          required: true,
          options: objectiveOptions,
        },
      ];
    case "stakeholder":
      return [
        {
          key: "stakeholder_type",
          label: "Type",
          kind: "select",
          required: true,
          options: ["internal", "external"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: "context_id",
          label: "Context",
          kind: "select",
          options: contextOptions,
        },
        {
          key: "user_id",
          label: "Internal user",
          kind: "select",
          options: participantOptions,
        },
        { key: "name", label: "Name", required: true },
        { key: "external_organization", label: "External organization" },
        {
          key: "role_or_relationship",
          label: "Role / relationship",
          required: true,
        },
        {
          key: "interests",
          label: "Interests (comma separated)",
          kind: "textarea",
        },
        {
          key: "expectations",
          label: "Expectations (comma separated)",
          kind: "textarea",
        },
        {
          key: "maximum_information_sensitivity",
          label: "Maximum sensitivity",
          kind: "select",
          required: true,
          options: ["public", "internal", "confidential", "restricted"].map(
            (value) => ({ value, label: value }),
          ),
        },
      ];
    case "obligation":
      return [
        {
          key: "source_type",
          label: "Source type",
          kind: "select",
          required: true,
          options: [
            "law",
            "regulation",
            "company_standard",
            "engineering_standard",
            "contract",
            "oem_requirement",
            "policy",
            "voluntary_commitment",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "context_id",
          label: "Context",
          kind: "select",
          options: contextOptions,
        },
        { key: "source_reference", label: "Source reference", required: true },
        { key: "jurisdiction", label: "Jurisdiction" },
        { key: "applicable_scope", label: "Applicable scope", required: true },
        { key: "responsible_role", label: "Responsible role", required: true },
        {
          key: "requirement",
          label: "Requirement",
          kind: "textarea",
          required: true,
        },
        { key: "effective_date", label: "Effective date", kind: "date" },
        { key: "expiry_date", label: "Expiry date", kind: "date" },
      ];
    case "obligation_version":
      return [
        {
          key: "obligation_id",
          label: "Adopted obligation",
          kind: "select",
          required: true,
          options: data.obligations
            .filter((item) => item.status === "adopted")
            .map((item) => ({
              value: item.id,
              label: `${item.source_reference} · v${item.version}`,
            })),
        },
        {
          key: "reason",
          label: "Why a successor version is required",
          kind: "textarea",
          required: true,
        },
        {
          key: "source_type",
          label: "New source type (optional)",
          kind: "select",
          options: [
            "law",
            "regulation",
            "company_standard",
            "engineering_standard",
            "contract",
            "oem_requirement",
            "policy",
            "voluntary_commitment",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "context_id",
          label: "New context (optional)",
          kind: "select",
          options: contextOptions,
        },
        { key: "source_reference", label: "New source reference" },
        { key: "jurisdiction", label: "New jurisdiction" },
        { key: "applicable_scope", label: "New applicable scope" },
        { key: "responsible_role", label: "New responsible role" },
        { key: "requirement", label: "New requirement", kind: "textarea" },
        { key: "effective_date", label: "New effective date", kind: "date" },
        { key: "expiry_date", label: "New expiry date", kind: "date" },
      ];
    case "obligation_link":
      return [
        baseRisk,
        {
          key: "obligation_id",
          label: "Adopted obligation",
          kind: "select",
          required: true,
          options: obligationOptions,
        },
        {
          key: "applicability",
          label: "Why it applies",
          kind: "textarea",
          required: true,
        },
      ];
    case "assumption":
      return [
        baseRisk,
        {
          key: "owner_id",
          label: "Owner",
          kind: "select",
          required: true,
          options: participantOptions,
        },
        {
          key: "statement",
          label: "Assumption",
          kind: "textarea",
          required: true,
        },
        {
          key: "confidence",
          label: "Confidence %",
          kind: "number",
          required: true,
        },
        { key: "valid_until", label: "Valid until", kind: "date" },
        {
          key: "trigger_for_review",
          label: "Measurable review trigger",
          kind: "textarea",
          required: true,
        },
        {
          key: "dependency_type",
          label: "Dependent record type (optional)",
          kind: "select",
          options: [
            "decision",
            "scenario",
            "control",
            "objective",
            "work_order",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "dependency_id",
          label: "Dependent record UUID",
          placeholder: "Optional governed record identifier",
        },
      ];
    case "source":
      return [
        baseRisk,
        {
          key: "description",
          label: "Source description",
          kind: "textarea",
          required: true,
        },
        { key: "source_type", label: "Source type", required: true },
        {
          key: "controllability",
          label: "Controllability",
          kind: "select",
          required: true,
          options: ["controllable", "influenceable", "external", "unknown"].map(
            (value) => ({ value, label: value }),
          ),
        },
        { key: "related_processes", label: "Related processes" },
      ];
    case "consequence":
      return [
        baseRisk,
        {
          key: "dimension",
          label: "Dimension",
          kind: "select",
          required: true,
          options: [
            "safety",
            "environment",
            "production",
            "financial",
            "regulatory",
            "asset_integrity",
            "reputation",
            "customer",
            "cybersecurity",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "description",
          label: "Consequence",
          kind: "textarea",
          required: true,
        },
        { key: "magnitude", label: "Magnitude", kind: "number" },
        { key: "time_horizon", label: "Time horizon" },
        {
          key: "effect_type",
          label: "Effect type",
          kind: "select",
          required: true,
          options: ["direct", "indirect", "cascading"].map((value) => ({
            value,
            label: value,
          })),
        },
      ];
    case "likelihood":
      return [
        baseRisk,
        {
          key: "method",
          label: "Method",
          kind: "select",
          required: true,
          options: [
            "expert_judgement",
            "frequency",
            "probability",
            "weibull",
            "monte_carlo",
            "bayesian",
            "historical_analogue",
            "condition_model",
            "event_tree",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        { key: "estimate", label: "Estimate", kind: "number", required: true },
        { key: "interval_lower", label: "Interval lower", kind: "number" },
        { key: "interval_upper", label: "Interval upper", kind: "number" },
        { key: "data_source", label: "Data source", required: true },
        { key: "sample_size", label: "Sample size", kind: "number" },
        { key: "model_reference", label: "Model reference" },
        {
          key: "confidence",
          label: "Confidence %",
          kind: "number",
          required: true,
        },
        { key: "assumptions", label: "Method assumptions", kind: "textarea" },
      ];
    case "scenario":
      return [
        { ...baseRisk, required: false, label: "Risk (optional for template)" },
        {
          key: "context_id",
          label: "Context",
          kind: "select",
          options: contextOptions,
        },
        { key: "name", label: "Scenario name", required: true },
        {
          key: "is_template",
          label: "Reusable scenario template",
          kind: "select",
          required: true,
          options: [
            { value: "false", label: "No — risk-specific" },
            { value: "true", label: "Yes — reusable in this context" },
          ],
        },
        {
          key: "initiating_event",
          label: "Initiating event",
          kind: "textarea",
          required: true,
        },
        { key: "causes", label: "Causes" },
        { key: "conditions", label: "Conditions" },
        { key: "dependencies", label: "Dependencies" },
        { key: "escalation_paths", label: "Escalation paths" },
        { key: "possible_consequences", label: "Possible consequences" },
        {
          key: "evidence_basis",
          label: "Evidence basis",
          kind: "textarea",
          required: true,
        },
        {
          key: "status",
          label: "Status",
          kind: "select",
          required: true,
          options: ["draft", "validated"].map((value) => ({
            value,
            label: value,
          })),
        },
      ];
    case "stress":
      return [
        {
          key: "mode",
          label: "Mode",
          kind: "select",
          required: true,
          options: ["stress", "reverse_stress"].map((value) => ({
            value,
            label: value.replaceAll("_", " "),
          })),
        },
        { key: "name", label: "Test name", required: true },
        {
          key: "risk_ids",
          label: "Risks",
          kind: "multi",
          required: true,
          options: riskOptions,
        },
        {
          key: "context_id",
          label: "Context",
          kind: "select",
          options: contextOptions,
        },
        {
          key: "objective_id",
          label: "Objective",
          kind: "select",
          options: objectiveOptions,
        },
        {
          key: "capacity_limit",
          label: "Capacity limit %",
          kind: "number",
          required: true,
        },
        {
          key: "reverse_stress_threshold",
          label: "Reverse-stress threshold %",
          kind: "number",
        },
        { key: "assumptions", label: "Stress assumptions", kind: "textarea" },
        {
          key: "status",
          label: "Review state",
          kind: "select",
          required: true,
          options: ["diagnostic", "reviewed", "adopted"].map((value) => ({
            value,
            label: value,
          })),
        },
      ];
    case "treatment_dependency":
      return [
        {
          key: "scenario_id",
          label: "Dependent treatment",
          kind: "select",
          required: true,
          options: treatments,
        },
        {
          key: "depends_on_scenario_id",
          label: "Depends on",
          kind: "select",
          required: true,
          options: treatments,
        },
        {
          key: "dependency_type",
          label: "Dependency type",
          kind: "select",
          required: true,
          options: [
            "finish_to_start",
            "start_to_start",
            "finish_to_finish",
            "resource",
            "approval",
            "evidence",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        { key: "lag_days", label: "Lag days", kind: "number" },
        {
          key: "rationale",
          label: "Rationale",
          kind: "textarea",
          required: true,
        },
      ];
    case "control_lifecycle":
      return [
        {
          key: "control_id",
          label: "Control",
          kind: "select",
          required: true,
          options: controls,
        },
        {
          key: "lifecycle_kind",
          label: "Lifecycle",
          kind: "select",
          required: true,
          options: ["temporary", "permanent", "compensating"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: "criticality",
          label: "Criticality",
          kind: "select",
          required: true,
          options: ["noncritical", "important", "critical"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: "failure_modes",
          label: "Known failure modes",
          kind: "textarea",
        },
        { key: "effective_from", label: "Effective from", kind: "date" },
        { key: "expires_on", label: "Expires on", kind: "date" },
        { key: "sunset_action", label: "Sunset action", kind: "textarea" },
      ];
    case "challenge":
      return [
        baseRisk,
        {
          key: "subject_type",
          label: "Challenge subject",
          kind: "select",
          required: true,
          options: [
            "risk_rating",
            "assumption",
            "control",
            "treatment",
            "decision",
            "acceptance",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        { key: "challenged_field", label: "Challenged field", required: true },
        {
          key: "rationale",
          label: "Evidence-based challenge",
          kind: "textarea",
          required: true,
        },
        {
          key: "requested_information",
          label: "Information needed to resolve",
          kind: "textarea",
        },
      ];
    case "assurance":
      return [
        baseRisk,
        {
          key: "assurance_level",
          label: "Assurance level",
          kind: "select",
          required: true,
          options: ["line_1", "line_2", "independent"].map((value) => ({
            value,
            label: value.replaceAll("_", " "),
          })),
        },
        {
          key: "subject_owner_id",
          label: "Subject owner",
          kind: "select",
          options: participantOptions,
        },
        {
          key: "scope",
          label: "Assurance scope",
          kind: "textarea",
          required: true,
        },
        { key: "due_date", label: "Due date", kind: "date" },
      ];
    case "communication":
      return [
        baseRisk,
        {
          key: "audience",
          label: "Audience",
          kind: "select",
          required: true,
          options: [
            "technician",
            "supervisor",
            "manager",
            "executive",
            "board",
            "oversight",
            "external",
          ].map((value) => ({ value, label: value })),
        },
        {
          key: "stakeholder_id",
          label: "Governed stakeholder",
          kind: "select",
          options: data.stakeholders.map((stakeholder) => ({
            value: stakeholder.id,
            label: stakeholder.name,
          })),
        },
        { key: "channel", label: "Channel", required: true },
        {
          key: "message",
          label: "Understandable risk message",
          kind: "textarea",
          required: true,
        },
        {
          key: "decision_or_action",
          label: "Decision / action",
          required: true,
        },
        {
          key: "accountable_owner",
          label: "Accountable owner",
          required: true,
        },
        {
          key: "sensitivity",
          label: "Sensitivity",
          kind: "select",
          required: true,
          options: ["public", "internal", "confidential", "restricted"].map(
            (value) => ({ value, label: value }),
          ),
        },
        {
          key: "comprehension_status",
          label: "Comprehension",
          kind: "select",
          required: true,
          options: ["not_checked", "confirmed", "clarification_required"].map(
            (value) => ({ value, label: value.replaceAll("_", " ") }),
          ),
        },
        { key: "feedback", label: "Feedback", kind: "textarea" },
      ];
    case "learning_transfer":
      return [
        {
          key: "learning_event_id",
          label: "Learning event",
          kind: "select",
          required: true,
          options: (data.learning_events ?? []).map((event) => ({
            value: event.id,
            label: event.title ?? event.id,
          })),
        },
        {
          key: "target_context_id",
          label: "Target context",
          kind: "select",
          options: contextOptions,
        },
        { key: "target_asset_class", label: "Target asset class" },
        {
          key: "applicability",
          label: "Applicability",
          kind: "select",
          required: true,
          options: [
            "candidate",
            "applicable",
            "not_applicable",
            "adaptation_required",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "rationale",
          label: "Applicability rationale",
          kind: "textarea",
          required: true,
        },
        {
          key: "adaptation_required",
          label: "Required adaptation",
          kind: "textarea",
        },
      ];
    case "outcome_attribution":
      return [
        {
          key: "learning_event_id",
          label: "Learning event",
          kind: "select",
          required: true,
          options: (data.learning_events ?? []).map((event) => ({
            value: event.id,
            label: event.title ?? event.id,
          })),
        },
        {
          key: "outcome_attribution",
          label: "Treatment vs context attribution",
          kind: "textarea",
          required: true,
        },
        {
          key: "attribution_confidence",
          label: "Attribution confidence %",
          kind: "number",
          required: true,
        },
        { key: "context_effects", label: "Context effects", kind: "textarea" },
        {
          key: "transfer_candidate",
          label: "Cross-site transfer candidate (true/false)",
        },
      ];
    case "lifecycle":
      return [
        baseRisk,
        {
          key: "next_status",
          label: "Next state",
          kind: "select",
          required: true,
          options: [
            "discovered",
            "validating",
            "identified",
            "analyzing",
            "analyzed",
            "evaluated",
            "decision_required",
            "treatment_planned",
            "treatment_active",
            "monitoring",
            "accepted",
            "context_changed",
            "reassessment",
            "closed",
            "archived",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "reason",
          label: "Transition basis",
          kind: "textarea",
          required: true,
        },
      ];
    case "authority_scope":
      return [
        {
          key: "authority_limit_id",
          label: "Draft authority profile",
          kind: "select",
          required: true,
          options: props.authorityProfiles
            .filter((profile) => profile.status === "draft")
            .map((profile) => ({
              value: profile.id,
              label: `${profile.role} · ${profile.tier}`,
            })),
        },
        { key: "jurisdictions", label: "Authorized jurisdictions" },
        { key: "asset_criticality_levels", label: "Asset criticalities" },
        {
          key: "max_decision_value",
          label: "Maximum decision value",
          kind: "number",
        },
        {
          key: "independent_assurance_above_level",
          label: "Independent assurance from",
          kind: "select",
          options: ["Low", "Medium", "High", "Critical"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          key: "org_node_id",
          label:
            "Org node scope (site/BU node id — blank = whole organization)",
        },
      ];
    case "integration":
      return [
        {
          key: "integration_id",
          label: "Integration",
          kind: "select",
          required: true,
          options: (data.integrations ?? []).map((integration) => ({
            value: integration.id,
            label: `${integration.name} · ${integration.status}`,
          })),
        },
        {
          key: "connector_kind",
          label: "Connector",
          kind: "select",
          required: true,
          options: [
            "sap_eam",
            "maximo",
            "oracle_eam",
            "historian",
            "scada",
            "mes",
            "dispatch",
            "condition_monitoring",
            "engineering_documents",
            "inspection",
            "financial_erp",
            "workforce",
            "inventory",
            "supplier",
          ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
        },
        {
          key: "direction",
          label: "Direction",
          kind: "select",
          required: true,
          options: ["inbound", "outbound", "bidirectional"].map((value) => ({
            value,
            label: value,
          })),
        },
        { key: "signal_mapping", label: "Signal mapping keys" },
        { key: "evidence_mapping", label: "Evidence mapping keys" },
        { key: "work_mapping", label: "Work mapping keys" },
        { key: "approve", label: "Approve binding (true/false)" },
        { key: "approval_basis", label: "Approval basis", kind: "textarea" },
      ];
    case "agent":
      return [
        {
          key: "agent_id",
          label: "Agent",
          kind: "select",
          required: true,
          options: (data.agents ?? []).map((agent) => ({
            value: agent.id,
            label: agent.name,
          })),
        },
        {
          key: "engine_key",
          label: "Risk engine",
          kind: "select",
          required: true,
          options: [
            "context",
            "criteria",
            "identification",
            "analysis",
            "evaluation",
            "treatment",
            "execution",
            "assurance",
            "monitoring",
            "learning",
            "governance",
            "evidence",
          ].map((value) => ({ value, label: value })),
        },
        {
          key: "basis",
          label: "Binding and human-boundary basis",
          kind: "textarea",
          required: true,
        },
      ];
  }
}

async function executeAdvancedAction(
  action: AdvancedAction,
  values: Record<string, string>,
): Promise<unknown> {
  switch (action) {
    case "objective":
      return upsertRiskObjective(values);
    case "objective_version": {
      const { objective_id, reason, ...changes } = values;
      return createRiskObjectiveVersion(objective_id, changes, reason);
    }
    case "objective_link":
      return linkRiskObjective(values.risk_id, values.objective_id);
    case "stakeholder":
      return upsertRiskStakeholder({
        ...values,
        interests: list(values.interests),
        expectations: list(values.expectations),
      });
    case "obligation":
      return recordRiskObligation(values);
    case "obligation_version": {
      const { obligation_id, reason, ...changes } = values;
      return createRiskObligationVersion(obligation_id, changes, reason);
    }
    case "obligation_link":
      return linkRiskObligation(
        values.risk_id,
        values.obligation_id,
        values.applicability,
      );
    case "assumption":
      return recordRiskAssumption(values.risk_id, {
        ...values,
        confidence: number(values.confidence),
        dependencies:
          values.dependency_type && values.dependency_id
            ? [
                {
                  subject_type: values.dependency_type,
                  subject_id: values.dependency_id,
                },
              ]
            : [],
      });
    case "source":
      return recordRiskAnalysisElement(values.risk_id, "source", {
        ...values,
        related_processes: list(values.related_processes),
      });
    case "consequence":
      return recordRiskAnalysisElement(values.risk_id, "consequence", {
        ...values,
        magnitude: number(values.magnitude),
      });
    case "likelihood":
      return recordRiskLikelihoodEstimate(values.risk_id, {
        ...values,
        estimate: number(values.estimate),
        interval_lower: number(values.interval_lower),
        interval_upper: number(values.interval_upper),
        sample_size: number(values.sample_size),
        confidence: number(values.confidence),
        assumptions: list(values.assumptions),
      });
    case "scenario":
      return recordRiskEventScenario({
        ...values,
        is_template: values.is_template === "true",
        causes: list(values.causes),
        conditions: list(values.conditions),
        dependencies: list(values.dependencies),
        escalation_paths: list(values.escalation_paths),
        possible_consequences: list(values.possible_consequences),
      });
    case "stress":
      return recordRiskStressTest({
        ...values,
        risk_ids: list(values.risk_ids),
        capacity_limit: number(values.capacity_limit),
        reverse_stress_threshold: number(values.reverse_stress_threshold),
        assumptions: list(values.assumptions),
      });
    case "treatment_dependency":
      return linkRiskTreatmentDependency({
        ...values,
        lag_days: number(values.lag_days),
      });
    case "control_lifecycle":
      return configureRiskControlLifecycle(values.control_id, {
        ...values,
        failure_modes: list(values.failure_modes),
      });
    case "challenge":
      return recordRiskChallenge(values);
    case "assurance":
      return recordRiskAssuranceReview({
        ...values,
        subject_type: "risk",
        subject_id: values.risk_id,
        status: "planned",
      });
    case "communication":
      return recordRiskCommunication(values);
    case "learning_transfer":
      return recordRiskLearningTransfer(values);
    case "outcome_attribution":
      return recordRiskOutcomeAttribution(values.learning_event_id, {
        ...values,
        attribution_confidence: number(values.attribution_confidence),
        context_effects: list(values.context_effects),
        transfer_candidate: values.transfer_candidate === "true",
      });
    case "lifecycle":
      return transitionRiskLifecycle(
        values.risk_id,
        values.next_status,
        values.reason,
      );
    case "authority_scope":
      return configureRiskAuthorityScope(values.authority_limit_id, {
        jurisdictions: list(values.jurisdictions),
        asset_criticality_levels: list(values.asset_criticality_levels),
        max_decision_value: number(values.max_decision_value),
        independent_assurance_above_level:
          values.independent_assurance_above_level || undefined,
        org_node_id: values.org_node_id || undefined,
      });
    case "integration": {
      const mapping = (value: string) =>
        Object.fromEntries(list(value).map((key) => [key, key]));
      return configureRiskIntegrationBinding(values.integration_id, {
        connector_kind: values.connector_kind,
        direction: values.direction,
        signal_mapping: mapping(values.signal_mapping),
        evidence_mapping: mapping(values.evidence_mapping),
        work_mapping: mapping(values.work_mapping),
        approve: values.approve === "true",
        approval_basis: values.approval_basis,
      });
    }
    case "agent":
      return configureRiskAgentBinding(
        values.agent_id,
        values.engine_key,
        values.basis,
      );
  }
}

function AdvancedActionModal({
  action,
  props,
  data,
  onClose,
  onDone,
}: {
  action: AdvancedAction;
  props: PanelProps;
  data: EnterpriseRiskArchitecture;
  onClose: () => void;
  onDone: () => void;
}) {
  const definitions = fieldsFor(action, props, data);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = ACTIONS.find((item) => item.id === action)?.label ?? action;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0D1520] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/7 bg-[#0D1520]/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="font-bold text-white">
              Record {label.toLowerCase()}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Governed write with tenant, authority and audit validation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close advanced action"
            className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <form
          className="space-y-4 p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await executeAdvancedAction(action, values);
              onDone();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Action failed",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {definitions.map((definition) => (
              <Field
                key={definition.key}
                definition={definition}
                value={values[definition.key] ?? ""}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    [definition.key]: value,
                  }))
                }
              />
            ))}
          </div>
          {error ? (
            <p className="rounded-lg border border-red-500/20 bg-red-500/8 p-3 text-xs text-red-300">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-white/7 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-[#04100f] disabled:opacity-50"
            >
              {busy ? "Validating…" : "Record governed action"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/7 bg-[#0D1520] p-4">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EnterpriseRiskArchitecturePanel(props: PanelProps) {
  const [action, setAction] = useState<AdvancedAction | null>(null);
  const [tree, setTree] = useState<ObjectiveTreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeBusy, setTreeBusy] = useState(false);
  const loadTree = async () => {
    setTreeBusy(true);
    setTreeError(null);
    try {
      setTree(await getObjectiveTree());
    } catch (e) {
      setTreeError(
        e instanceof Error
          ? e.message
          : "Could not load the objective hierarchy",
      );
    } finally {
      setTreeBusy(false);
    }
  };
  const { data, loading, error, refetch } =
    useAsyncData<EnterpriseRiskArchitecture>(getRiskEnterpriseArchitecture, []);
  const totals = useMemo(
    () =>
      data
        ? {
            governance:
              data.objectives.length +
              data.obligations.length +
              data.stakeholders.length,
            analysis:
              data.assumptions.length +
              data.sources.length +
              data.consequences.length +
              data.likelihood_estimates.length,
            assurance:
              data.challenges.length +
              data.assurance_reviews.length +
              data.communications.length,
            learning: data.learning_transfers.length + data.stress_tests.length,
          }
        : null,
    [data],
  );
  if (loading)
    return <LoadingState label="Loading enterprise risk architecture…" />;
  if (error || !data)
    return (
      <ErrorState
        message={error ?? "Enterprise risk architecture unavailable"}
        onRetry={refetch}
      />
    );
  const refresh = () => {
    refetch();
    props.onChanged();
    setAction(null);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-white">
            <Network className="h-4 w-4 text-teal-300" />
            Enterprise risk architecture
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            First-class objective and obligation traceability, assumption
            invalidation, stress scenarios, independent assurance, controlled
            communications, learning transfer, integrations and advisory agents.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await provisionRiskAdvisoryAgents();
              refresh();
            }}
            className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200"
          >
            Provision advisory agents
          </button>
          <select
            aria-label="Add enterprise risk record"
            value=""
            onChange={(event) =>
              setAction(event.target.value as AdvancedAction)
            }
            className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200"
          >
            <option value="">+ Add governed record</option>
            {ACTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.category} · {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Context records", totals?.governance ?? 0, Target],
          ["Analysis lineage", totals?.analysis ?? 0, GitBranch],
          ["Assurance records", totals?.assurance ?? 0, ShieldCheck],
          ["Stress & transfer", totals?.learning ?? 0, BrainCircuit],
        ].map(([label, value, Icon]) => {
          const I = Icon as typeof Target;
          return (
            <div
              key={String(label)}
              className="rounded-xl border border-white/7 bg-[#0D1520] p-4"
            >
              <I className="h-4 w-4 text-teal-300" />
              <div className="mt-3 text-2xl font-black text-white">
                {String(value)}
              </div>
              <div className="text-xs text-slate-500">{String(label)}</div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Objective hierarchy"
          detail="Enterprise through task objectives, with measurable target, owner, tolerance and adoption."
        >
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => (tree != null ? setTree(null) : void loadTree())}
              disabled={treeBusy}
              className="rounded-md border border-teal-500/25 px-2 py-1 text-[10px] font-bold text-teal-300 disabled:opacity-50"
            >
              {treeBusy
                ? "Loading hierarchy…"
                : tree != null
                  ? "Hide nested hierarchy"
                  : "Show nested hierarchy"}
            </button>
            {treeError && <p className="text-xs text-red-300">{treeError}</p>}
            {tree != null &&
              (tree.length ? (
                <div className="space-y-1 rounded-lg bg-white/3 p-3">
                  {tree.map((node) => (
                    <div
                      key={node.id}
                      style={{ paddingLeft: `${node.depth * 14}px` }}
                      className="text-[11px] text-slate-300"
                    >
                      <span className="font-semibold text-slate-200">
                        {node.depth > 0 ? "└ " : ""}
                        {node.description}
                      </span>{" "}
                      <span className="text-slate-500">
                        {node.level.replaceAll("_", " ")} · v{node.version} ·{" "}
                        {node.status}
                        {node.targetValue != null
                          ? ` · ${node.targetValue} ${node.unit ?? ""}`
                          : ""}{" "}
                        · {node.linkedRisks} linked risk
                        {node.linkedRisks === 1 ? "" : "s"} · {node.linkedCases}{" "}
                        linked case{node.linkedCases === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-600">
                  No draft or adopted objectives recorded — the hierarchy is
                  empty, not hidden.
                </p>
              ))}
            {data.objectives.length ? (
              data.objectives.slice(0, 6).map((objective) => (
                <div
                  key={objective.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-white/3 p-3"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-200">
                      {objective.description}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {objective.objective_level.replaceAll("_", " ")} ·{" "}
                      {objective.target} · v{objective.version}
                      {objective.parent_id
                        ? ` · nested under: ${
                            data.objectives.find(
                              (o) => o.id === objective.parent_id,
                            )?.description ?? "parent objective"
                          }`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Typed target:{" "}
                      {objective.target_value != null
                        ? `${objective.target_value} ${objective.unit ?? ""}${
                            objective.target_date
                              ? ` by ${objective.target_date}`
                              : ""
                          }`
                        : "not stated"}
                    </p>
                  </div>
                  {objective.status === "draft" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const note = window.prompt(
                          "Record the objective adoption basis",
                        );
                        if (note) {
                          await adoptRiskObjective(objective.id, note);
                          refresh();
                        }
                      }}
                      className="rounded-md border border-teal-500/25 px-2 py-1 text-[10px] font-bold text-teal-300"
                    >
                      Adopt
                    </button>
                  ) : objective.status === "adopted" ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const description = window.prompt(
                            "Updated objective description (leave unchanged by cancelling)",
                            objective.description,
                          );
                          if (!description) return;
                          const reason = window.prompt(
                            "Record why a new objective version is required",
                          );
                          if (reason) {
                            await createRiskObjectiveVersion(
                              objective.id,
                              { description },
                              reason,
                            );
                            refresh();
                          }
                        }}
                        className="rounded-md border border-amber-500/25 px-2 py-1 text-[10px] font-bold text-amber-300"
                      >
                        New version
                      </button>
                      <span className="text-[10px] text-emerald-300">
                        adopted
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      {objective.status}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-600">
                No first-class objectives yet.
              </p>
            )}
          </div>
        </SectionCard>
        <SectionCard
          title="Obligations"
          detail="Legal, regulatory, contractual, engineering, OEM and policy constraints remain distinct from risk."
        >
          <div className="space-y-2">
            {data.obligations.length ? (
              data.obligations.slice(0, 6).map((obligation) => (
                <div
                  key={obligation.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-white/3 p-3"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-200">
                      {obligation.source_reference}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {obligation.source_type.replaceAll("_", " ")} ·{" "}
                      {obligation.responsible_role}
                    </p>
                  </div>
                  {obligation.status === "draft" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const note = window.prompt(
                          "Record the obligation adoption basis",
                        );
                        if (note) {
                          await adoptRiskObligation(obligation.id, note);
                          refresh();
                        }
                      }}
                      className="rounded-md border border-teal-500/25 px-2 py-1 text-[10px] font-bold text-teal-300"
                    >
                      Adopt
                    </button>
                  ) : obligation.status === "adopted" ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const requirement = window.prompt(
                            "Updated obligation requirement",
                            obligation.requirement,
                          );
                          if (!requirement) return;
                          const reason = window.prompt(
                            "Record why a new obligation version is required",
                          );
                          if (reason) {
                            await createRiskObligationVersion(
                              obligation.id,
                              { requirement },
                              reason,
                            );
                            refresh();
                          }
                        }}
                        className="rounded-md border border-amber-500/25 px-2 py-1 text-[10px] font-bold text-amber-300"
                      >
                        New version
                      </button>
                      <span className="text-[10px] text-emerald-300">
                        adopted
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      {obligation.status}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-600">
                No governed obligations yet.
              </p>
            )}
          </div>
        </SectionCard>
        <SectionCard
          title="Assumption lifecycle"
          detail="Invalidation or expiry reopens every dependent risk and decision."
        >
          <div className="space-y-2">
            {data.assumptions.length ? (
              data.assumptions.slice(0, 6).map((assumption) => (
                <div
                  key={assumption.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-white/3 p-3"
                >
                  <div>
                    <p className="text-xs text-slate-200">
                      {assumption.statement}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Confidence {assumption.confidence}% ·{" "}
                      {assumption.valid_until ?? "no expiry"}
                    </p>
                  </div>
                  {assumption.status === "active" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const reason = window.prompt(
                          "Why is this assumption no longer valid?",
                        );
                        if (reason) {
                          await invalidateRiskAssumption(assumption.id, reason);
                          refresh();
                        }
                      }}
                      className="rounded-md border border-amber-500/25 px-2 py-1 text-[10px] font-bold text-amber-300"
                    >
                      Invalidate
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      {assumption.status}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-600">
                No first-class assumptions yet.
              </p>
            )}
          </div>
        </SectionCard>
        <SectionCard
          title="Stress and reverse stress"
          detail="Deduplicated exposure, recorded dependency uplift, capacity and minimum breach set."
        >
          <div className="space-y-2">
            {data.stress_tests.length ? (
              data.stress_tests.slice(0, 6).map((test) => (
                <div key={test.id} className="rounded-lg bg-white/3 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-200">
                      {test.name}
                    </p>
                    <span
                      className={`text-[10px] font-bold ${test.threshold_breached ? "text-red-300" : "text-emerald-300"}`}
                    >
                      {test.threshold_breached
                        ? "capacity breached"
                        : "within capacity"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {test.mode.replaceAll("_", " ")} · combined exposure{" "}
                    {test.combined_exposure.toFixed(1)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-600">
                No stress tests recorded.
              </p>
            )}
          </div>
        </SectionCard>
        <SectionCard
          title="Challenge and assurance"
          detail="Dissent is immutable; high-consequence decisions can require independent evidence."
        >
          <div className="space-y-2">
            {data.challenges
              .filter((item) => item.status === "open")
              .slice(0, 4)
              .map((challenge) => (
                <div
                  key={challenge.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white/3 p-3"
                >
                  <div>
                    <p className="text-xs text-slate-200">
                      Challenge: {challenge.challenged_field}
                    </p>
                    <p className="text-[11px] text-amber-300">open</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const resolution = window.prompt(
                        "Record the independent resolution basis",
                      );
                      if (resolution) {
                        await resolveRiskChallenge(challenge.id, "upheld", {
                          resolution,
                        });
                        refresh();
                      }
                    }}
                    className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            <p className="text-[11px] text-slate-500">
              {data.assurance_reviews.length} assurance reviews ·{" "}
              {data.communications.length} governed communications
            </p>
          </div>
        </SectionCard>
        <SectionCard
          title="Reassessment and sunset queue"
          detail="Context, objective, obligation, assumption and temporary-control changes propagate automatically."
        >
          <div className="space-y-2">
            {data.reassessment_queue.slice(0, 4).map((item) => (
              <div
                key={item.risk_id}
                className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3"
              >
                <p className="text-xs font-semibold text-slate-200">
                  {item.title}
                </p>
                <p className="mt-1 text-[11px] text-amber-200/70">
                  {item.reason}
                </p>
              </div>
            ))}
            {data.expiring_controls.slice(0, 4).map((control) => (
              <div
                key={control.control_id}
                className="rounded-lg bg-white/3 p-3"
              >
                <p className="text-xs text-slate-200">{control.name}</p>
                <p className="text-[11px] text-slate-500">
                  {control.lifecycle_kind} · expires {control.expires_on}
                </p>
              </div>
            ))}
            {!data.reassessment_queue.length &&
            !data.expiring_controls.length ? (
              <p className="text-xs text-slate-600">
                No propagated reassessments or expiring controls.
              </p>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard
          title="Learning transfer"
          detail="Lessons are reviewed for target applicability and adaptation before adoption."
        >
          <div className="space-y-2">
            {data.learning_transfers.slice(0, 5).map((transfer) => (
              <div
                key={transfer.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/3 p-3"
              >
                <div>
                  <p className="text-xs text-slate-200">
                    {text(transfer.applicability, "learning candidate")}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {transfer.status}
                  </p>
                </div>
                {transfer.status === "proposed" ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const note = window.prompt(
                        "Record the independent applicability review basis",
                      );
                      if (note) {
                        await decideRiskLearningTransfer(
                          transfer.id,
                          true,
                          note,
                        );
                        refresh();
                      }
                    }}
                    className="rounded-md border border-teal-500/25 px-2 py-1 text-[10px] font-bold text-teal-300"
                  >
                    Adopt
                  </button>
                ) : null}
              </div>
            ))}
            {!data.learning_transfers.length ? (
              <p className="text-xs text-slate-600">
                No cross-context learning candidates.
              </p>
            ) : null}
          </div>
        </SectionCard>
      </div>
      {action ? (
        <AdvancedActionModal
          action={action}
          props={props}
          data={data}
          onClose={() => setAction(null)}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}

export function RiskDecisionOperationsPanel(props: PanelProps) {
  const { data, loading, error, refetch } =
    useAsyncData<RiskDecisionOperations>(getRiskDecisionOperations, []);
  if (loading) return <LoadingState label="Loading decision operations…" />;
  if (error || !data)
    return (
      <ErrorState
        message={error ?? "Decision operations unavailable"}
        onRetry={refetch}
      />
    );
  const changed = () => {
    refetch();
    props.onChanged();
  };
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <h2 className="flex items-center gap-2 font-bold text-white">
          <ClipboardCheck className="h-4 w-4 text-cyan-300" />
          My Decisions
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          The decision queue leaders asked for: objective, exposure, value,
          deadline, recommendation, confidence and required authority.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Object.entries(data.board_evidence_pack).map(([key, value]) => (
          <div
            key={key}
            className="rounded-xl border border-white/7 bg-[#0D1520] p-4"
          >
            <div className="text-xl font-black text-white">{value}</div>
            <div className="mt-1 text-[11px] text-slate-500">
              {key.replaceAll("_", " ")}
            </div>
          </div>
        ))}
      </div>
      <SectionCard
        title="Accountable decision queue"
        detail="AI prepares evidence; qualified humans approve or reject."
      >
        <div className="space-y-2">
          {data.my_decisions.length ? (
            data.my_decisions.map((decision) => (
              <div
                key={decision.decision_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/7 bg-white/3 p-3"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    {decision.risk_title}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {text(decision.action)} · exposure {text(decision.exposure)}{" "}
                    · confidence {text(decision.confidence)}%
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const note = window.prompt(
                        "Record the accountable approval basis",
                      );
                      if (note) {
                        await decideRiskDecision(
                          decision.decision_id,
                          true,
                          note,
                        );
                        changed();
                      }
                    }}
                    className="rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-[10px] font-bold text-emerald-300"
                  >
                    <Check className="mr-1 inline h-3 w-3" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const note = window.prompt("Record the rejection basis");
                      if (note) {
                        await decideRiskDecision(
                          decision.decision_id,
                          false,
                          note,
                        );
                        changed();
                      }
                    }}
                    className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold text-red-300"
                  >
                    <X className="mr-1 inline h-3 w-3" />
                    Reject
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-600">
              No decisions currently require your authority.
            </p>
          )}
        </div>
      </SectionCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Treatment portfolio"
          detail="Capital, readiness and expected net risk change across selected treatments."
        >
          <div className="space-y-2">
            {data.treatment_portfolio.slice(0, 8).map((item) => (
              <div
                key={item.recommendation_id}
                className="rounded-lg bg-white/3 p-3"
              >
                <div className="flex justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-200">
                    {item.risk_title}
                  </p>
                  <span className="text-[10px] text-teal-300">
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{item.action}</p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Cost {text(item.cost)} · net change{" "}
                  {text(item.net_risk_change)}
                </p>
              </div>
            ))}
            {!data.treatment_portfolio.length ? (
              <p className="text-xs text-slate-600">No selected treatments.</p>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard
          title="Emerging Risk feed"
          detail="Weak signals, acceleration, critical indicators and context-driven reassessment."
        >
          <div className="space-y-2">
            {data.emerging_risks.slice(0, 8).map((risk) => (
              <div
                key={risk.risk_id}
                className="flex items-center gap-3 rounded-lg bg-white/3 p-3"
              >
                <ArrowUpRight className="h-4 w-4 text-amber-300" />
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    {risk.title}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Score {text(risk.score)} · velocity {text(risk.velocity)} ·{" "}
                    {text(risk.status)}
                  </p>
                </div>
              </div>
            ))}
            {!data.emerging_risks.length ? (
              <p className="text-xs text-slate-600">
                No emerging-risk signals.
              </p>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard
          title="Decision history"
          detail="Searchable decision memory: evidence, actor, rationale, approval and outcome."
        >
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {data.decision_history.slice(0, 15).map((decision) => (
              <div
                key={decision.decision_id}
                className="rounded-lg bg-white/3 p-3"
              >
                <div className="flex justify-between">
                  <p className="text-xs font-semibold text-slate-200">
                    {decision.risk_title}
                  </p>
                  <span className="text-[10px] text-slate-500">
                    {decision.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                  {text(decision.rationale)}
                </p>
              </div>
            ))}
            {!data.decision_history.length ? (
              <p className="text-xs text-slate-600">
                No risk decisions recorded.
              </p>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard
          title="Risk culture signals"
          detail="Evidence-led behavior signals—not employee scoring or inferred intent."
        >
          <div className="space-y-2">
            {data.culture_signals.map((signal) => (
              <div
                key={signal.key}
                className="flex items-center justify-between rounded-lg bg-white/3 p-3"
              >
                <div className="flex items-center gap-2">
                  {signal.count > 0 ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                  )}
                  <span className="text-xs text-slate-300">
                    {signal.key.replaceAll("_", " ")}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">
                  {signal.rate == null
                    ? "insufficient evidence"
                    : `${Math.round(signal.rate * 100)}%`}{" "}
                  · {signal.count}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="rounded-xl border border-white/7 bg-[#0D1520] p-4">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-purple-300" />
          <h3 className="text-sm font-bold text-white">
            Board / oversight evidence pack
          </h3>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Read-only assurance evidence is separated from management execution.
          Oversight can inspect challenges, assurance, reassessment, temporary
          controls and learning without approving operational work.
        </p>
      </div>
    </div>
  );
}
