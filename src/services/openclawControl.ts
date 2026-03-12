export async function openclawRequest(action: string, data: Record<string, any>) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration missing');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/openclaw-orchestrator`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, data }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenClaw request failed: ${response.status} ${text}`);
  }

  return response.json();
}

export const OpenClaw = {
  createAgent: (data: any) => openclawRequest('create_agent', data),
  createSession: (data: any) => openclawRequest('create_session', data),
  addMessage: (data: any) => openclawRequest('add_message', data),
  spawnAgent: (data: any) => openclawRequest('spawn_agent', data),
  completeRun: (data: any) => openclawRequest('complete_run', data),
  registerTool: (data: any) => openclawRequest('register_tool', data),
  logToolCall: (data: any) => openclawRequest('log_tool_call', data),
  addMemory: (data: any) => openclawRequest('add_memory', data),
  searchMemory: (data: any) => openclawRequest('search_memory', data),
  scheduleEvent: (data: any) => openclawRequest('schedule_event', data),
  recordEventRun: (data: any) => openclawRequest('record_event_run', data),
  notify: (data: any) => openclawRequest('notify', data),
  registerSkill: (data: any) => openclawRequest('register_skill', data),
  runSkill: (data: any) => openclawRequest('run_skill', data),
  enqueue: (data: any) => openclawRequest('enqueue', data),
  dequeue: (data: any) => openclawRequest('dequeue', data),
  logError: (data: any) => openclawRequest('log_error', data),
  logCost: (data: any) => openclawRequest('log_cost', data),
};
