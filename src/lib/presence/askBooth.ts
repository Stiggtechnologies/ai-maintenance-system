/**
 * Booth ask — existing ReliabilityAgent runtime only.
 *
 * Canonical path: supabase.functions.invoke("ai-agent-processor") with the
 * signed-in session (not the anon key). requiresApproval stays true.
 * No parallel orchestrator, no plant execute.
 */
import { supabase } from "../supabase";
import { describeQuotaRefusal } from "../../services/agentQuota";
import { BOOTH_UNAVAILABLE_REPLY } from "./booth";

export type BoothAskStatus = "ok" | "quota" | "unavailable";

export interface BoothAskResult {
  status: BoothAskStatus;
  response: string;
}

export async function askBoothConversation(
  query: string,
): Promise<BoothAskResult> {
  const { data, error } = await supabase.functions.invoke(
    "ai-agent-processor",
    {
      body: {
        agentType: "ReliabilityAgent",
        query,
        requiresApproval: true,
      },
    },
  );
  if (error) {
    const quota = await describeQuotaRefusal(error);
    if (quota) return { status: "quota", response: quota.message };
    return { status: "unavailable", response: BOOTH_UNAVAILABLE_REPLY };
  }
  const response =
    typeof (data as { response?: unknown } | null)?.response === "string"
      ? (data as { response: string }).response.trim()
      : "";
  if (!response) {
    return { status: "unavailable", response: BOOTH_UNAVAILABLE_REPLY };
  }
  return { status: "ok", response };
}
