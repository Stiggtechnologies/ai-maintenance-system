import type { TemplateIndustryCode } from "../industry-catalog.ts";

export type DomainSpecialistModuleKey =
  | "oil-sands-tailings"
  | "oil-gas-well-integrity"
  | "petrochemical-rbi"
  | "utilities-storm-response"
  | "manufacturing-operations"
  | "food-beverage-safety"
  | "pharmaceutical-quality"
  | "transport-logistics"
  | "aviation-airworthiness"
  | "marine-shipping"
  | "data-center-thermal"
  | "defense-readiness"
  | "aerospace-launch"
  | "buildings-infrastructure";

export type DomainMethodKind =
  | "engineering_calculation"
  | "optimization"
  | "traceability"
  | "verification"
  | "readiness";

export type DomainInputKind =
  "number" | "string" | "boolean" | "date" | "records" | "matrix";

export interface DomainInputDefinition {
  key: string;
  label: string;
  kind: DomainInputKind;
  unit?: string;
  description: string;
}

export interface DomainMethodDefinition {
  key: string;
  label: string;
  purpose: string;
  kind: DomainMethodKind;
  algorithm: string;
  requiredInputs: DomainInputDefinition[];
  requiredEvidence: string[];
  authorityReferences: string[];
  requiredApproverRole: string;
  limitations: string[];
  exampleInputs: Record<string, unknown>;
}

export interface DomainSpecialistModule {
  key: DomainSpecialistModuleKey;
  industryCode: TemplateIndustryCode;
  label: string;
  version: string;
  reviewerRoleKey: string;
  purpose: string;
  dataClasses: Array<
    | "operational"
    | "safety_critical"
    | "regulatory"
    | "quality"
    | "security_sensitive"
    | "classified"
  >;
  methods: DomainMethodDefinition[];
}

export interface DomainEvidenceReference {
  key: string;
  sourceReference: string;
  evidenceItemId: string;
  observedAt?: string;
}

export interface DomainSpecialistRequest {
  moduleKey: DomainSpecialistModuleKey;
  methodKey: string;
  inputs: Record<string, unknown>;
  evidence: DomainEvidenceReference[];
}

export interface DomainMetric {
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit?: string;
}

export interface DomainSpecialistResult {
  moduleKey: DomainSpecialistModuleKey;
  methodKey: string;
  modelKey: string;
  modelVersion: string;
  status: "blocked" | "draft";
  summary: string;
  metrics: DomainMetric[];
  findings: string[];
  gaps: string[];
  assumptions: string[];
  formulae: string[];
  authorityBoundary: string;
  requiredApproverRole: string;
  requiredApproverRoleKey: string;
  humanApprovalRequired: true;
  authoritative: false;
}
