/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "../lib/supabase";

/**
 * Authenticated client for the SyncAI Intelligence Runtime control surface.
 * The caller's current Supabase session is forwarded automatically so the
 * edge function can derive the authoritative user and organization.
 */
export async function sirRequest(action: string, data: Record<string, any>) {
  const { data: result, error } = await supabase.functions.invoke("sir-orchestrator", {
    body: { action, data },
  });
  if (error) throw new Error(`SIR request failed: ${error.message}`);
  return result;
}

export const SIR = {
  createAgent: (data: any) => sirRequest("create_agent", data),
  createSession: (data: any) => sirRequest("create_session", data),
  addMessage: (data: any) => sirRequest("add_message", data),
  spawnAgent: (data: any) => sirRequest("spawn_agent", data),
  completeRun: (data: any) => sirRequest("complete_run", data),
  registerTool: (data: any) => sirRequest("register_tool", data),
  logToolCall: (data: any) => sirRequest("log_tool_call", data),
  addMemory: (data: any) => sirRequest("add_memory", data),
  searchMemory: (data: any) => sirRequest("search_memory", data),
  scheduleEvent: (data: any) => sirRequest("schedule_event", data),
  recordEventRun: (data: any) => sirRequest("record_event_run", data),
  notify: (data: any) => sirRequest("notify", data),
  registerSkill: (data: any) => sirRequest("register_skill", data),
  runSkill: (data: any) => sirRequest("run_skill", data),
  enqueue: (data: any) => sirRequest("enqueue", data),
  dequeue: (data: any) => sirRequest("dequeue", data),
  logError: (data: any) => sirRequest("log_error", data),
  logCost: (data: any) => sirRequest("log_cost", data),
};
