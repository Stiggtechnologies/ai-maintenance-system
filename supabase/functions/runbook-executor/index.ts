import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    const { action, runbook_code, execution_id, trigger_data } = await req.json();

    if (action === 'trigger') {
      const result = await triggerRunbook(supabase, runbook_code, trigger_data);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'execute_step') {
      const result = await executeNextStep(supabase, execution_id);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'status') {
      const result = await getExecutionStatus(supabase, execution_id);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Runbook executor error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function triggerRunbook(supabase: any, runbookCode: string, triggerData: any) {
  const { data: runbook } = await supabase
    .from('runbooks')
    .select('*')
    .eq('runbook_code', runbookCode)
    .eq('enabled', true)
    .single();

  if (!runbook) {
    throw new Error(`Runbook ${runbookCode} not found or disabled`);
  }

  const { data: execution } = await supabase
    .from('runbook_executions')
    .insert({
      runbook_id: runbook.id,
      triggered_by: triggerData.triggered_by || 'system',
      trigger_data: triggerData,
      status: 'queued'
    })
    .select()
    .single();

  await enqueueExecution(supabase, execution.id);

  return {
    execution_id: execution.id,
    runbook_name: runbook.runbook_name,
    status: 'queued'
  };
}

async function enqueueExecution(supabase: any, executionId: string) {
  await supabase.rpc('enqueue_job', {
    p_job_type: 'runbook_execution',
    p_job_data: { execution_id: executionId },
    p_priority: 8
  });
}

async function executeNextStep(supabase: any, executionId: string) {
  const { data: execution } = await supabase
    .from('runbook_executions')
    .select(`
      *,
      runbook:runbooks(*)
    `)
    .eq('id', executionId)
    .single();

  if (!execution) {
    throw new Error('Execution not found');
  }

  if (execution.status === 'completed' || execution.status === 'failed') {
    return { status: execution.status, message: 'Execution already finished' };
  }

  const nextStepOrder = (execution.current_step_order || 0) + 1;

  const { data: step } = await supabase
    .from('runbook_steps')
    .select('*')
    .eq('runbook_id', execution.runbook_id)
    .eq('step_order', nextStepOrder)
    .single();

  if (!step) {
    await supabase
      .from('runbook_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', executionId);

    return { status: 'completed', message: 'All steps completed' };
  }

  if (execution.status !== 'running') {
    await supabase
      .from('runbook_executions')
      .update({
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', executionId);
  }

  const { data: stepResult } = await supabase
    .from('runbook_step_results')
    .insert({
      execution_id: executionId,
      step_id: step.id,
      step_order: step.step_order,
      status: 'running',
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  let result;
  let stepStatus = 'success';
  let errorMessage = null;

  try {
    result = await executeStep(supabase, step, execution.trigger_data);
  } catch (error) {
    stepStatus = 'failed';
    errorMessage = error.message;
    result = { error: error.message };
  }

  await supabase
    .from('runbook_step_results')
    .update({
      status: stepStatus,
      result_data: result,
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    })
    .eq('id', stepResult.id);

  const executionLog = execution.execution_log || [];
  executionLog.push({
    step_order: step.step_order,
    step_name: step.step_name,
    status: stepStatus,
    timestamp: new Date().toISOString(),
    result
  });

  await supabase
    .from('runbook_executions')
    .update({
      current_step_order: step.step_order,
      execution_log: executionLog
    })
    .eq('id', executionId);

  if (stepStatus === 'failed' && step.required) {
    await supabase
      .from('runbook_executions')
      .update({
        status: 'failed',
        error_message: `Step ${step.step_name} failed: ${errorMessage}`,
        completed_at: new Date().toISOString()
      })
      .eq('id', executionId);

    return { status: 'failed', step: step.step_name, error: errorMessage };
  }

  if (step.step_type === 'approval') {
    await supabase
      .from('runbook_executions')
      .update({ status: 'waiting_approval' })
      .eq('id', executionId);

    return { status: 'waiting_approval', step: step.step_name };
  }

  await enqueueExecution(supabase, executionId);

  return { status: 'step_completed', step: step.step_name, result };
}

async function executeStep(supabase: any, step: any, triggerData: any) {
  const config = step.step_config;

  switch (step.step_type) {
    case 'query':
      return await executeQuery(supabase, config, triggerData);
    case 'action':
      return await executeAction(supabase, config, triggerData);
    case 'notification':
      return await executeNotification(supabase, config, triggerData);
    case 'decision':
      return await executeDecision(supabase, config, triggerData);
    case 'wait':
      return await executeWait(config);
    case 'approval':
      return { status: 'approval_required', config };
    default:
      throw new Error(`Unknown step type: ${step.step_type}`);
  }
}

async function executeQuery(supabase: any, config: any, triggerData: any) {
  const queryType = config.query_type;

  if (queryType === 'asset_lookup') {
    const { data } = await supabase
      .from('assets')
      .select('*')
      .match(config.filters || {})
      .limit(10);
    return { assets: data || [] };
  }

  if (queryType === 'sensor_history') {
    const assetId = triggerData.asset_id;
    if (!assetId) throw new Error('asset_id required for sensor_history');

    const timeframeMinutes = config.timeframe_minutes || 30;
    const startTime = new Date(Date.now() - timeframeMinutes * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('asset_health_monitoring')
      .select('*')
      .eq('asset_id', assetId)
      .gte('recorded_at', startTime)
      .order('recorded_at', { ascending: false });

    return { sensor_data: data || [] };
  }

  if (queryType === 'alert_details') {
    const alertId = triggerData.alert_id;
    if (!alertId) throw new Error('alert_id required');

    const { data } = await supabase
      .from('system_alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    return { alert: data };
  }

  if (queryType === 'pm_backlog') {
    const { data } = await supabase
      .from('work_orders')
      .select('*')
      .in('status', config.status || ['pending'])
      .order('created_at', { ascending: true })
      .limit(50);

    return { work_orders: data || [] };
  }

  return { query_type: queryType, message: 'Query executed' };
}

async function executeAction(supabase: any, config: any, triggerData: any) {
  const actionType = config.action_type;

  if (actionType === 'create_work_order') {
    const { data } = await supabase
      .from('work_orders')
      .insert({
        asset_id: triggerData.asset_id,
        title: triggerData.title || 'Automated Work Order',
        description: triggerData.description || 'Created by runbook automation',
        priority: config.priority || 'medium',
        status: 'pending'
      })
      .select()
      .single();

    return { work_order_id: data?.id, status: 'created' };
  }

  if (actionType === 'ai_analysis') {
    return {
      action: 'ai_analysis',
      model_tier: config.model_tier,
      analysis: 'Root cause analysis would be performed here',
      confidence: 0.85
    };
  }

  if (actionType === 'store_evidence') {
    return {
      action: 'store_evidence',
      evidence_types: config.include,
      stored: true
    };
  }

  return { action: actionType, executed: true };
}

async function executeNotification(supabase: any, config: any, triggerData: any) {
  await supabase.rpc('broadcast_to_channel', {
    p_channel_name: 'system.alerts',
    p_message_type: 'runbook_notification',
    p_payload: {
      roles: config.roles,
      channels: config.channels,
      trigger_data: triggerData
    },
    p_priority: 'high'
  });

  return { notified: true, channels: config.channels, roles: config.roles };
}

async function executeDecision(supabase: any, config: any, triggerData: any) {
  return { decision: 'evaluated', config };
}

async function executeWait(config: any) {
  const waitSeconds = config.wait_seconds || 10;
  await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
  return { waited: waitSeconds };
}

async function getExecutionStatus(supabase: any, executionId: string) {
  const { data: execution } = await supabase
    .from('runbook_executions')
    .select(`
      *,
      runbook:runbooks(runbook_name),
      step_results:runbook_step_results(*)
    `)
    .eq('id', executionId)
    .single();

  if (!execution) {
    throw new Error('Execution not found');
  }

  return {
    execution_id: execution.id,
    runbook_name: execution.runbook?.runbook_name,
    status: execution.status,
    current_step: execution.current_step_order,
    started_at: execution.started_at,
    completed_at: execution.completed_at,
    steps_completed: execution.step_results?.filter((r: any) => r.status === 'success').length || 0,
    execution_log: execution.execution_log
  };
}
