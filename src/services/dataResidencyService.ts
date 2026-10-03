import { supabase } from "../lib/supabase";

export const REQUIRED_RESIDENCY_PLANES = [
  "application",
  "database",
  "object_storage",
  "backup",
  "logging",
  "ai_inference",
] as const;

export interface DataLocationEvidence {
  id: string;
  location_key: string;
  data_plane: string;
  provider: string;
  service: string;
  region_code: string;
  country_code: string;
  processing_activities: string[];
  data_classes: string[];
  evidence_reference: string;
  evidence_basis: string;
  status: "declared" | "verified" | "rejected" | "superseded";
  declared_by: string;
  verified_by: string | null;
  verification_basis: string | null;
}

export interface ResidencyDeployment {
  id: string;
  name: string;
  operating_region: string | null;
  deployment_environment: "evaluation" | "pilot" | "production";
  residency_status: "unconfigured" | "draft" | "verified" | "blocked";
  policy_revision: number;
  jurisdictions: string[];
  permitted_countries: string[];
  permitted_regions: string[];
  data_classes: string[];
  authority_reference: string | null;
  evidence_basis: string | null;
  verification_basis: string | null;
  locations: DataLocationEvidence[];
}

export interface DataResidencyWorkspace {
  actor_role: string;
  can_manage: boolean;
  governance: { claim: string; promotion: string; retention: string };
  deployments: ResidencyDeployment[];
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const value = data as ({ error?: unknown } & T) | null;
  if (!value) throw new Error("Data residency workspace returned no data.");
  if (value.error) throw new Error(String(value.error));
  return value;
}

export async function getDataResidencyWorkspace() {
  const { data, error } = await supabase.rpc("get_data_residency_workspace");
  return unwrap<DataResidencyWorkspace>(data, error);
}

export async function configureDeploymentResidency(
  deploymentId: string,
  policy: {
    jurisdictions: string[];
    permitted_countries: string[];
    permitted_regions: string[];
    data_classes: string[];
    cross_border_basis?: string;
    authority_reference: string;
    evidence_basis: string;
  },
) {
  const { data, error } = await supabase.rpc("configure_deployment_residency", {
    p_deployment_id: deploymentId,
    p_policy: policy,
  });
  return unwrap<Record<string, unknown>>(data, error);
}

export async function recordDeploymentDataLocation(
  deploymentId: string,
  location: {
    location_key: string;
    data_plane: string;
    provider: string;
    service: string;
    region_code: string;
    country_code: string;
    processing_activities: string[];
    data_classes: string[];
    evidence_reference: string;
    evidence_basis: string;
  },
) {
  const { data, error } = await supabase.rpc(
    "record_deployment_data_location",
    {
      p_deployment_id: deploymentId,
      p_location: location,
    },
  );
  return unwrap<Record<string, unknown>>(data, error);
}

export async function verifyDeploymentDataLocation(
  locationId: string,
  decision: "verified" | "rejected",
  basis: string,
) {
  const { data, error } = await supabase.rpc(
    "verify_deployment_data_location",
    {
      p_location_id: locationId,
      p_decision: decision,
      p_basis: basis,
    },
  );
  return unwrap<Record<string, unknown>>(data, error);
}

export async function verifyDeploymentResidency(
  deploymentId: string,
  basis: string,
) {
  const { data, error } = await supabase.rpc("verify_deployment_residency", {
    p_deployment_id: deploymentId,
    p_basis: basis,
  });
  return unwrap<Record<string, unknown>>(data, error);
}

export async function setDeploymentEnvironment(
  deploymentId: string,
  environment: "evaluation" | "pilot" | "production",
  basis: string,
) {
  const { data, error } = await supabase.rpc("set_deployment_environment", {
    p_deployment_id: deploymentId,
    p_environment: environment,
    p_basis: basis,
  });
  return unwrap<Record<string, unknown>>(data, error);
}
