import { supabase } from "../lib/supabase";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as Record<string, unknown>;
}

export const p6ScheduleReadActions = {
  configure: (args: {
    key: string;
    name: string;
    baseUrl: string;
    projectObjectId: number;
    developmentCaseId: string;
    scheduleName: string;
    durationToHours: number;
    maxActivities: number;
    maxRelationships: number;
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_p6_schedule_read_source", {
      p_key: args.key,
      p_name: args.name,
      p_base_url: args.baseUrl,
      p_project_object_id: args.projectObjectId,
      p_development_case_id: args.developmentCaseId,
      p_schedule_name: args.scheduleName,
      p_duration_to_hours: args.durationToHours,
      p_max_activities: args.maxActivities,
      p_max_relationships: args.maxRelationships,
      p_expected_interval_minutes: args.interval,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke(
      "p6-schedule-read-pull",
      { body: { connector_key: key, dry_run: dryRun } },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
