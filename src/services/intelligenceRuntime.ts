/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SyncAI Intelligence Runtime (SIR)
 *
 * Client-side service for communicating with the SIR orchestrator edge function.
 * This module replaces the former OpenClaw control service.
 */
export async function sirRequest(action: string, data: Record<string, any>) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase configuration missing");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/sir-orchestrator`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, data }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SIR request failed: ${response.status} ${text}`);
  }

  return response.json();
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
