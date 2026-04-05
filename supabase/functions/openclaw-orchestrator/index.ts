import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

async function generateEmbedding(text: string, openaiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, data } = await req.json();

    switch (action) {
      case 'create_agent':
        return await createAgent(supabase, data);
      case 'create_session':
        return await createSession(supabase, data);
      case 'add_message':
        return await addMessage(supabase, data);
      case 'spawn_agent':
        return await spawnAgent(supabase, data);
      case 'complete_run':
        return await completeRun(supabase, data);
      case 'register_tool':
        return await registerTool(supabase, data);
      case 'log_tool_call':
        return await logToolCall(supabase, data);
      case 'add_memory':
        return await addMemory(supabase, data, openaiKey);
      case 'search_memory':
        return await searchMemory(supabase, data, openaiKey);
      case 'schedule_event':
        return await scheduleEvent(supabase, data);
      case 'record_event_run':
        return await recordEventRun(supabase, data);
      case 'notify':
        return await queueNotification(supabase, data);
      case 'register_skill':
        return await registerSkill(supabase, data);
      case 'run_skill':
        return await runSkill(supabase, data);
      case 'enqueue':
        return await enqueueTask(supabase, data);
      case 'dequeue':
        return await dequeueTask(supabase, data);
      case 'log_error':
        return await logError(supabase, data);
      case 'log_cost':
        return await logCost(supabase, data);
      default:
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('OpenClaw orchestrator error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function createAgent(supabase: any, data: any) {
  const { tenant_id, name, agent_type, persona = {}, config = {} } = data;
  const { data: agent, error } = await supabase
    .from('openclaw_agents')
    .insert({ tenant_id, name, agent_type, persona, config })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, agent });
}

async function createSession(supabase: any, data: any) {
  const { tenant_id, agent_id, user_id, context = {} } = data;
  const { data: session, error } = await supabase
    .from('openclaw_sessions')
    .insert({ tenant_id, agent_id, user_id, context })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, session });
}

async function addMessage(supabase: any, data: any) {
  const { session_id, role, content, metadata = {}, prompt_tokens = 0, completion_tokens = 0 } = data;
  const { data: message, error } = await supabase
    .from('openclaw_messages')
    .insert({ session_id, role, content, metadata, prompt_tokens, completion_tokens })
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from('openclaw_sessions')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', session_id);

  return jsonResponse({ success: true, message });
}

async function spawnAgent(supabase: any, data: any) {
  const { tenant_id, session_id, agent_id, input = {}, parent_run_id = null } = data;
  const { data: run, error } = await supabase
    .from('openclaw_orchestration_runs')
    .insert({
      tenant_id,
      session_id,
      agent_id,
      parent_run_id,
      status: 'running',
      input,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, run });
}

async function completeRun(supabase: any, data: any) {
  const { run_id, output = {}, status = 'completed' } = data;
  const { data: run, error } = await supabase
    .from('openclaw_orchestration_runs')
    .update({ status, output, finished_at: new Date().toISOString() })
    .eq('id', run_id)
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, run });
}

async function registerTool(supabase: any, data: any) {
  const { name, description = '', schema = {}, handler = '' } = data;
  const { data: tool, error } = await supabase
    .from('openclaw_tools')
    .insert({ name, description, schema, handler })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, tool });
}

async function logToolCall(supabase: any, data: any) {
  const { session_id, tool_id, input = {}, output = {}, status = 'success', duration_ms = null, error_message = null } = data;
  const { data: call, error } = await supabase
    .from('openclaw_tool_calls')
    .insert({ session_id, tool_id, input, output, status, duration_ms, error_message })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, call });
}

async function addMemory(supabase: any, data: any, openaiKey: string) {
  const { tenant_id, agent_id = null, memory_type = 'semantic', content, metadata = {} } = data;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const embedding = await generateEmbedding(content, openaiKey);
  const { data: memory, error } = await supabase
    .from('openclaw_memory')
    .insert({ tenant_id, agent_id, memory_type, content, embedding, metadata })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, memory });
}

async function searchMemory(supabase: any, data: any, openaiKey: string) {
  const { tenant_id, query, match_threshold = 0.7, match_count = 5, agent_id = null } = data;
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

  const embedding = await generateEmbedding(query, openaiKey);
  const { data: results, error } = await supabase.rpc('search_openclaw_memory', {
    query_embedding: JSON.stringify(embedding),
    target_tenant_id: tenant_id,
    match_threshold,
    match_count,
    target_agent_id: agent_id,
  });

  if (error) throw error;
  return jsonResponse({ success: true, results });
}

async function scheduleEvent(supabase: any, data: any) {
  const { tenant_id, event_type, schedule = null, payload = {} } = data;
  const { data: event, error } = await supabase
    .from('openclaw_events')
    .insert({ tenant_id, event_type, schedule, payload })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, event });
}

async function recordEventRun(supabase: any, data: any) {
  const { event_id, status = 'success', output = {}, duration_ms = null } = data;
  const { data: run, error } = await supabase
    .from('openclaw_event_runs')
    .insert({ event_id, status, output, duration_ms, finished_at: new Date().toISOString() })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, run });
}

async function queueNotification(supabase: any, data: any) {
  const { tenant_id, channel, target, message } = data;
  const { data: notification, error } = await supabase
    .from('openclaw_notifications')
    .insert({ tenant_id, channel, target, message })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, notification });
}

async function registerSkill(supabase: any, data: any) {
  const { name, description = '', version = '1.0.0', config = {} } = data;
  const { data: skill, error } = await supabase
    .from('openclaw_skills')
    .insert({ name, description, version, config })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, skill });
}

async function runSkill(supabase: any, data: any) {
  const { skill_id, session_id = null, input = {} } = data;
  const { data: run, error } = await supabase
    .from('openclaw_skill_runs')
    .insert({ skill_id, session_id, input, status: 'running' })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, run });
}

async function enqueueTask(supabase: any, data: any) {
  const { tenant_id, queue_name, payload = {}, next_run_at = null } = data;
  const { data: task, error } = await supabase
    .from('openclaw_queue')
    .insert({ tenant_id, queue_name, payload, next_run_at: next_run_at || new Date().toISOString() })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, task });
}

async function dequeueTask(supabase: any, data: any) {
  const { queue_name, limit = 1 } = data;
  const { data: tasks, error } = await supabase
    .from('openclaw_queue')
    .select('*')
    .eq('queue_name', queue_name)
    .eq('status', 'queued')
    .lte('next_run_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;

  const ids = (tasks || []).map((t: any) => t.id);
  if (ids.length > 0) {
    await supabase
      .from('openclaw_queue')
      .update({ status: 'processing' })
      .in('id', ids);
  }

  return jsonResponse({ success: true, tasks });
}

async function logError(supabase: any, data: any) {
  const { tenant_id, session_id = null, source = 'unknown', message, stack = null } = data;
  const { data: errorRow, error } = await supabase
    .from('openclaw_errors')
    .insert({ tenant_id, session_id, source, message, stack })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, error: errorRow });
}

async function logCost(supabase: any, data: any) {
  const { tenant_id, session_id = null, model = null, prompt_tokens = 0, completion_tokens = 0, cost_usd = 0 } = data;
  const { data: cost, error } = await supabase
    .from('openclaw_costs')
    .insert({ tenant_id, session_id, model, prompt_tokens, completion_tokens, cost_usd })
    .select()
    .single();

  if (error) throw error;
  return jsonResponse({ success: true, cost });
}

function jsonResponse(payload: any) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
