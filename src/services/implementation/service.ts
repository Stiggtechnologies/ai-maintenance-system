import { supabase } from "../../lib/supabase";
import type { ImplementationCommand } from "./journey";

export interface ImplementationScope {
  assets: Array<{
    assetId: string;
    templateId: string;
    mappingEvidenceId: string;
  }>;
  runIds: string[];
}
export interface ImplementationJourney {
  id: string;
  billingId: string;
  outcome: string;
  revision: number;
  phase: string;
  current: boolean;
  scope: ImplementationScope | null;
  failure: { code: string; step: string; message: string } | null;
}
export interface ImplementationWorkspace {
  organizationId: string;
  journeys: ImplementationJourney[];
  subscriptions: Array<{
    id: string;
    plan: string;
    status: string;
    source: string;
    marketplaceStatus: string | null;
    periodEnd: string | null;
  }>;
  receipts: Array<{ commandId: string; instanceId: string; revision: number }>;
}
export interface ImplementationResources {
  assets: Array<{ id: string; tag: string; name: string; asset_class: string }>;
  templates: Array<{ id: string; title: string; asset_class: string }>;
  evidence: Array<{
    id: string;
    asset_id: string | null;
    description: string;
    evidence_type: string;
  }>;
  runs: Array<{
    id: string;
    entity_type: string;
    records_accepted: number;
    finished_at: string;
  }>;
}
export class ImplementationCommandError extends Error {
  constructor(
    message: string,
    readonly outcome: "refused" | "unknown",
  ) {
    super(message);
  }
}
export async function loadImplementationWorkspace(): Promise<ImplementationWorkspace> {
  const { data, error } = await supabase.rpc("get_implementation_workspace");
  if (error) throw new Error(error.message);
  if (
    !data ||
    !Array.isArray(data.journeys) ||
    !Array.isArray(data.subscriptions) ||
    !Array.isArray(data.receipts)
  )
    throw new Error(
      "Implementation service returned an invalid workspace. Contact support.",
    );
  return data as ImplementationWorkspace;
}
export async function loadImplementationResources(
  org: string,
): Promise<ImplementationResources> {
  // Caller RLS (including risk visibility) is preserved on every resource read.
  const results = await Promise.all([
    supabase
      .from("assets")
      .select("id,tag,name,asset_class")
      .eq("organization_id", org)
      .or("area.is.null,area.neq.Starter Pack")
      .order("tag")
      .limit(1000),
    supabase
      .from("asset_twin_templates")
      .select("id,title,asset_class")
      .eq("maturity", "approved")
      .order("title")
      .limit(1000),
    supabase
      .from("evidence_items")
      .select("id,asset_id,description,evidence_type")
      .eq("organization_id", org)
      .eq("verification_status", "verified")
      .neq("evidence_class", "AI_INFERENCE")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("connector_runs")
      .select("id,entity_type,records_accepted,finished_at")
      .eq("organization_id", org)
      .eq("status", "success")
      .eq("records_rejected", 0)
      .gt("records_accepted", 0)
      .order("finished_at", { ascending: false })
      .limit(1000),
  ]);
  for (const result of results)
    if (result.error) throw new Error(result.error.message);
  return {
    assets: results[0].data ?? [],
    templates: results[1].data ?? [],
    evidence: results[2].data ?? [],
    runs: results[3].data ?? [],
  } as ImplementationResources;
}
export async function sendImplementationCommand(
  command: ImplementationCommand,
  dryRun = false,
) {
  const { data, error } = await supabase.rpc("command_implementation", {
    p_command_id: command.commandId,
    p_billing_id: command.billingId,
    p_instance_id: command.instanceId,
    p_revision: command.revision,
    p_action: command.action,
    p_payload: command.payload,
    p_dry_run: dryRun,
  });
  if (error) {
    // SQL refusals roll back. Network/timeouts and unclassified errors require read-only recovery.
    const refused = /^(P0001|22\w{3}|23\w{3}|42501)$/.test(error.code ?? "");
    throw new ImplementationCommandError(
      refused
        ? error.message
        : "The result is unknown. Reload retained status before retrying the same command.",
      refused ? "refused" : "unknown",
    );
  }
  if (
    !data ||
    (dryRun
      ? data.dryRun !== true || data.writesPerformed !== false
      : data.commandId !== command.commandId ||
        typeof data.instanceId !== "string" ||
        (command.instanceId !== null &&
          data.instanceId !== command.instanceId) ||
        data.revision < command.revision ||
        !Number.isInteger(data.revision))
  )
    throw new ImplementationCommandError(
      "The result could not be verified. Reload retained status before retrying.",
      "unknown",
    );
  return data as {
    commandId: string;
    instanceId: string;
    revision: number;
    phase: string;
    dryRun?: boolean;
    writesPerformed?: boolean;
  };
}
