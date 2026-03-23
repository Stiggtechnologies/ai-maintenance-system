import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === '/health') {
      return handleHealth(supabase);
    }

    if (pathname === '/ready') {
      return handleReady(supabase);
    }

    if (pathname === '/status') {
      return handleStatus(supabase);
    }

    if (pathname === '/doctor') {
      return handleDoctor(supabase);
    }

    if (pathname.startsWith('/sessions')) {
      return handleSessions(req, supabase);
    }

    if (pathname.startsWith('/runs')) {
      return handleRuns(req, supabase);
    }

    if (pathname.startsWith('/jobs')) {
      return handleJobs(req, supabase);
    }

    if (pathname.startsWith('/channels')) {
      return handleChannels(req, supabase);
    }

    return new Response(
      JSON.stringify({ error: 'Not found', path: pathname }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Gateway error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleHealth(supabase: any) {
  try {
    const { data, error } = await supabase.from('user_profiles').select('count').limit(1);

    return new Response(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: error ? 'unhealthy' : 'healthy'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ status: 'unhealthy', error: error.message }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

async function handleReady(supabase: any) {
  const checks = await Promise.all([
    checkDatabase(supabase),
    checkJobQueue(supabase),
    checkRealtimeChannels(supabase),
  ]);

  const allReady = checks.every(check => check.status === 'ok');

  return new Response(
    JSON.stringify({
      ready: allReady,
      checks: {
        database: checks[0],
        job_queue: checks[1],
        realtime: checks[2],
      },
      timestamp: new Date().toISOString()
    }),
    {
      status: allReady ? 200 : 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
}

async function handleStatus(supabase: any) {
  const [workOrderStats, assetStats, alertStats, jobStats] = await Promise.all([
    getWorkOrderStats(supabase),
    getAssetStats(supabase),
    getAlertStats(supabase),
    getJobQueueStats(supabase),
  ]);

  return new Response(
    JSON.stringify({
      status: 'running',
      work_orders: workOrderStats,
      assets: assetStats,
      alerts: alertStats,
      jobs: jobStats,
      timestamp: new Date().toISOString(),
      version: {
        runtime: '1.0.0',
        ui: '1.0.0',
        schema: '20260323'
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleDoctor(supabase: any) {
  const diagnostics = await runDiagnostics(supabase);

  const overallStatus = diagnostics.every(d => d.status === 'green') ? 'green' :
                       diagnostics.some(d => d.status === 'red') ? 'red' : 'yellow';

  return new Response(
    JSON.stringify({
      overall_status: overallStatus,
      diagnostics,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleSessions(req: Request, supabase: any) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/sessions') {
    const body = await req.json();
    const { user_id, agent_id } = body;

    const { data, error } = await supabase
      .from('openclaw_sessions')
      .insert({
        user_id,
        agent_id,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ session: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'POST' && pathname.match(/\/sessions\/(.+)\/messages/)) {
    const sessionId = pathname.split('/')[2];
    const body = await req.json();

    const { data, error } = await supabase
      .from('openclaw_messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content: body.content
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ message: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'GET' && pathname.match(/\/sessions\/(.+)\/history/)) {
    const sessionId = pathname.split('/')[2];
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const { data, error } = await supabase
      .from('openclaw_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return new Response(
      JSON.stringify({ messages: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Invalid session endpoint' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleRuns(req: Request, supabase: any) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/runs') {
    const body = await req.json();

    const { data, error } = await supabase
      .from('openclaw_orchestration_runs')
      .insert({
        agent_id: body.agent_id,
        session_id: body.session_id,
        status: 'queued',
        config: body.config || {}
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ run: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'GET' && pathname.match(/\/runs\/(.+)$/)) {
    const runId = pathname.split('/')[2];

    const { data, error } = await supabase
      .from('openclaw_orchestration_runs')
      .select('*')
      .eq('id', runId)
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ run: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'GET' && pathname.match(/\/runs\/(.+)\/trace/)) {
    const runId = pathname.split('/')[2];

    const { data: toolCalls } = await supabase
      .from('openclaw_tool_calls')
      .select('*')
      .eq('orchestration_run_id', runId)
      .order('created_at', { ascending: true });

    const { data: costs } = await supabase
      .from('openclaw_costs')
      .select('*')
      .eq('orchestration_run_id', runId);

    return new Response(
      JSON.stringify({ run_id: runId, tool_calls: toolCalls || [], costs: costs || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Invalid runs endpoint' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleJobs(req: Request, supabase: any) {
  const url = new URL(req.url);

  if (req.method === 'POST') {
    const body = await req.json();
    const jobId = await supabase.rpc('enqueue_job', {
      p_job_type: body.job_type,
      p_job_data: body.job_data,
      p_priority: body.priority || 5,
      p_scheduled_for: body.scheduled_for || new Date().toISOString()
    });

    return new Response(
      JSON.stringify({ job_id: jobId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'GET') {
    const status = url.searchParams.get('status');
    let query = supabase
      .from('job_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return new Response(
      JSON.stringify({ jobs: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Invalid jobs endpoint' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleChannels(req: Request, supabase: any) {
  if (req.method === 'POST') {
    const body = await req.json();
    const messageId = await supabase.rpc('broadcast_to_channel', {
      p_channel_name: body.channel_name,
      p_message_type: body.message_type,
      p_payload: body.payload,
      p_sender_id: body.sender_id,
      p_priority: body.priority || 'normal'
    });

    return new Response(
      JSON.stringify({ message_id: messageId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('realtime_channels')
      .select('*');

    if (error) throw error;

    return new Response(
      JSON.stringify({ channels: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Invalid channels endpoint' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function checkDatabase(supabase: any) {
  try {
    const { error } = await supabase.from('user_profiles').select('count').limit(1);
    return { status: error ? 'error' : 'ok', message: error ? error.message : 'Connected' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function checkJobQueue(supabase: any) {
  try {
    const { data, error } = await supabase
      .from('job_queue')
      .select('count')
      .eq('status', 'queued');

    return { status: error ? 'error' : 'ok', queued_jobs: data?.[0]?.count || 0 };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function checkRealtimeChannels(supabase: any) {
  try {
    const { data, error } = await supabase
      .from('realtime_channels')
      .select('count');

    return { status: error ? 'error' : 'ok', channels: data?.[0]?.count || 0 };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function getWorkOrderStats(supabase: any) {
  const { data } = await supabase.from('work_orders').select('status');
  if (!data) return null;

  return {
    total: data.length,
    pending: data.filter((wo: any) => wo.status === 'pending').length,
    in_progress: data.filter((wo: any) => wo.status === 'in_progress').length,
    completed: data.filter((wo: any) => wo.status === 'completed').length,
  };
}

async function getAssetStats(supabase: any) {
  const { data } = await supabase.from('assets').select('status');
  if (!data) return null;

  return {
    total: data.length,
    operational: data.filter((a: any) => a.status === 'operational').length,
    degraded: data.filter((a: any) => a.status === 'degraded').length,
  };
}

async function getAlertStats(supabase: any) {
  const { data } = await supabase.from('system_alerts').select('severity, resolved');
  if (!data) return null;

  return {
    total: data.length,
    critical: data.filter((a: any) => a.severity === 'critical' && !a.resolved).length,
    unresolved: data.filter((a: any) => !a.resolved).length,
  };
}

async function getJobQueueStats(supabase: any) {
  const { data } = await supabase.from('job_queue').select('status');
  if (!data) return null;

  return {
    queued: data.filter((j: any) => j.status === 'queued').length,
    processing: data.filter((j: any) => j.status === 'processing').length,
    failed: data.filter((j: any) => j.status === 'failed').length,
  };
}

async function runDiagnostics(supabase: any) {
  const checks = [];

  const dbCheck = await checkDatabase(supabase);
  checks.push({
    name: 'Database Connectivity',
    status: dbCheck.status === 'ok' ? 'green' : 'red',
    message: dbCheck.message || 'Database connected'
  });

  const queueCheck = await checkJobQueue(supabase);
  checks.push({
    name: 'Job Queue',
    status: queueCheck.status === 'ok' ? 'green' : 'red',
    message: `${queueCheck.queued_jobs || 0} jobs queued`
  });

  const channelsCheck = await checkRealtimeChannels(supabase);
  checks.push({
    name: 'Realtime Channels',
    status: channelsCheck.status === 'ok' ? 'green' : 'red',
    message: `${channelsCheck.channels || 0} channels active`
  });

  return checks;
}
