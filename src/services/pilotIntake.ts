import { supabase } from "../lib/supabase";

export type PilotIntakeSubmission = {
  name: string;
  email: string;
  company: string;
  role: string;
  industry: string;
  assetScope: string;
  systemOfRecord: string;
  historyAvailable: string;
  primaryPain: string;
  dataReadiness: string;
  securityNeed: string;
  commercialModel: string;
  notes: string;
};

export async function submitPilotIntake(input: PilotIntakeSubmission) {
  const { data, error } = await supabase.rpc("submit_pilot_intake_request", {
    request: {
      name: input.name,
      email: input.email,
      company: input.company,
      role: input.role,
      industry: input.industry,
      asset_scope: input.assetScope,
      system_of_record: input.systemOfRecord,
      history_available: input.historyAvailable,
      primary_pain: input.primaryPain,
      data_readiness: input.dataReadiness,
      security_need: input.securityNeed,
      commercial_model: input.commercialModel,
      notes: input.notes,
      notification_status: "queued",
      source_path:
        typeof window === "undefined"
          ? "/pilot/reliability"
          : window.location.pathname,
    },
  });

  if (error) {
    throw error;
  }

  return { id: String(data) };
}

export async function createPilotOnboardingPackage(
  intakeRequestId: string | null,
  input: PilotIntakeSubmission,
) {
  const packageItems = [
    "workspace_shell",
    "data_request_checklist",
    "role_invites",
    "governance_gates",
    "first_analysis_queue",
    "commercial_path",
  ];

  const { data, error } = await supabase.rpc(
    "create_pilot_onboarding_package",
    {
      request: {
        intake_request_id: intakeRequestId,
        company: input.company,
        asset_scope: input.assetScope,
        system_of_record: input.systemOfRecord,
        primary_pain: input.primaryPain,
        data_readiness: input.dataReadiness,
        security_need: input.securityNeed,
        commercial_model: input.commercialModel,
        package_items: packageItems,
        status: "generated",
        source_path:
          typeof window === "undefined"
            ? "/pilot/reliability"
            : window.location.pathname,
      },
    },
  );

  if (error) {
    throw error;
  }

  return { id: String(data) };
}
