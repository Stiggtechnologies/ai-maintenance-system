import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Verify authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Service role bypasses RLS. Condition, material, and evidence reads below
  // are scoped to the caller's organization from user_profiles. The body is
  // not a tenant.
  const callerOrg = await callerOrganizationId(supabase, authHeader);
  if (!callerOrg) {
    return new Response(
      JSON.stringify({ error: 'authentication required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

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
      const result = await executeNextStep(supabase, execution_id, callerOrg);
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

async function callerOrganizationId(supabase: any, authHeader: string): Promise<string | null> {
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  const { data: userResult, error } = await supabase.auth.getUser(token);
  if (error || !userResult?.user) return null;
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) return null;
  return String(profile.organization_id);
}

async function enqueueExecution(supabase: any, executionId: string) {
  await supabase.rpc('enqueue_job', {
    p_job_type: 'runbook_execution',
    p_job_data: { execution_id: executionId },
    p_priority: 8
  });
}

async function executeNextStep(supabase: any, executionId: string, callerOrg: string) {
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
    result = await executeStep(supabase, step, execution.trigger_data, callerOrg);
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

async function executeStep(supabase: any, step: any, triggerData: any, callerOrg: string) {
  const config = step.step_config;

  switch (step.step_type) {
    case 'query':
      return await executeQuery(supabase, config, triggerData, callerOrg);
    case 'action':
      return await executeAction(supabase, config, triggerData, callerOrg);
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

async function executeQuery(supabase: any, config: any, triggerData: any, callerOrg: string) {
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
    const asset = await requireAssetOrg(supabase, assetId, callerOrg);

    // Live historian series. asset_health_monitoring.recorded_at is not a
    // column on the current table and is not the condition store.
    const { data, error } = await supabase
      .from('condition_readings')
      .select('id, asset_id, sensor_id, value, quality, taken_at, source_system, sensors(name, signal_type, unit)')
      .eq('organization_id', asset.organization_id)
      .eq('asset_id', assetId)
      .gte('taken_at', startTime)
      .order('taken_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return { sensor_data: data || [], source: 'condition_readings' };
  }

  if (queryType === 'alert_history') {
    const lookbackDays = Number(config.lookback_days) > 0 ? Number(config.lookback_days) : 7;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    let assetId = triggerData.asset_id;
    if (!assetId && triggerData.alert_id) {
      const { data: alert, error } = await supabase
        .from('condition_alerts')
        .select('asset_id, organization_id')
        .eq('id', triggerData.alert_id)
        .eq('organization_id', callerOrg)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!alert?.asset_id) throw new Error('alert not found');
      assetId = alert.asset_id;
    }
    if (!assetId) throw new Error('asset_id or alert_id required for alert_history');
    await requireAssetOrg(supabase, assetId, callerOrg);
    const { data, error } = await supabase
      .from('condition_alerts')
      .select('id, asset_id, sensor_id, severity, triggered_value, limit_value, triggered_at, cleared_at, work_order_id')
      .eq('organization_id', callerOrg)
      .eq('asset_id', assetId)
      .gte('triggered_at', since)
      .order('triggered_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { alerts: data || [], source: 'condition_alerts', lookback_days: lookbackDays };
  }

  if (queryType === 'material_demand') {
    const workOrderId = triggerData.work_order_id;
    if (!workOrderId) throw new Error('work_order_id required for material_demand');
    const { data: order, error: orderError } = await supabase
      .from('work_orders')
      .select('id, organization_id, asset_id')
      .eq('id', workOrderId)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order || order.organization_id !== callerOrg) throw new Error('work order not found');
    const { data: lines, error } = await supabase
      .from('work_order_materials')
      .select('id, material_id, qty_required, qty_reserved, qty_issued, status, materials(material_code, description)')
      .eq('organization_id', order.organization_id)
      .eq('work_order_id', workOrderId);
    if (error) throw new Error(error.message);
    const materialIds = (lines || []).map((line: { material_id: string }) => line.material_id);
    let stock: unknown[] = [];
    if (materialIds.length > 0) {
      const { data: stockRows, error: stockError } = await supabase
        .from('material_stock')
        .select('material_id, site_id, qty_on_hand, qty_reserved, qty_on_order')
        .eq('organization_id', order.organization_id)
        .in('material_id', materialIds);
      if (stockError) throw new Error(stockError.message);
      stock = stockRows || [];
    }
    let lots: unknown[] = [];
    if (materialIds.length > 0) {
      const { data: lotRows, error: lotError } = await supabase
        .from('material_stock_lots')
        .select('material_id, lot_ref, qty, condition, certification_status')
        .eq('organization_id', order.organization_id)
        .in('material_id', materialIds);
      if (lotError) throw new Error(lotError.message);
      lots = lotRows || [];
    }
    return {
      demand: lines || [],
      stock,
      lots,
      source: 'work_order_materials',
    };
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

  // Previously this returned message "Query executed" for every unknown
  // type, including ones that read nothing. That claim is retired.
  return {
    query_type: queryType,
    executed: false,
    reason: 'not_implemented',
    message: 'This runbook query is not implemented. Nothing was read.',
  };
}

async function requireAssetOrg(supabase: any, assetId: string, callerOrg: string) {
  const { data, error } = await supabase
    .from('assets')
    .select('id, organization_id')
    .eq('id', assetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.organization_id || data.organization_id !== callerOrg) throw new Error('asset not found');
  return data as { id: string; organization_id: string };
}

async function executeAction(supabase: any, config: any, triggerData: any, callerOrg: string) {
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
    // This step is NOT implemented. It used to return the placeholder prose
    // 'Root cause analysis would be performed here' together with
    // `confidence: 0.85` — a hardcoded confidence for an analysis that was
    // never performed, returned server-side so the number entered persisted
    // runbook results and could be read back as though something had assessed
    // it. An unimplemented step reports that it is unimplemented; it does not
    // report a number.
    return {
      action: 'ai_analysis',
      model_tier: config.model_tier,
      executed: false,
      reason: 'not_implemented',
      detail: 'Runbook AI analysis is not implemented. No root-cause analysis '
        + 'was performed and no confidence is available for this step.'
    };
  }

  if (actionType === 'store_evidence') {
    return await storeRunbookEvidence(supabase, config, triggerData, callerOrg);
  }

  return {
    action: actionType,
    executed: false,
    reason: 'not_implemented',
    detail: 'This runbook action is not implemented. Nothing was changed.',
  };
}

async function storeRunbookEvidence(supabase: any, config: any, triggerData: any, callerOrg: string) {
  const assetId = triggerData?.asset_id;
  if (!assetId) {
    throw new Error('asset_id required to store evidence. Nothing was stored.');
  }
  const asset = await requireAssetOrg(supabase, assetId, callerOrg);
  const include = Array.isArray(config?.include) ? config.include.map(String) : [];
  const wantsSensors = include.length === 0 || include.includes('sensor_data');
  let readings: Array<Record<string, unknown>> = [];
  if (wantsSensors) {
    const { data, error } = await supabase
      .from('condition_readings')
      .select('id, value, quality, taken_at, source_system, sensors(name, unit)')
      .eq('organization_id', asset.organization_id)
      .eq('asset_id', assetId)
      .order('taken_at', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    readings = data || [];
  }

  const lines = [
    'Runbook evidence capture. Unverified. This row cites records already stored; it does not add a measurement.',
  ];
  if (wantsSensors) {
    lines.push(
      readings.length === 0
        ? 'Condition readings: none on file for this asset.'
        : `Condition readings cited: ${readings.length}. Newest taken_at ${String(readings[0].taken_at)}.`,
    );
    for (const reading of readings.slice(0, 10)) {
      const sensor = Array.isArray(reading.sensors) ? reading.sensors[0] : reading.sensors;
      const name = sensor && typeof sensor === 'object' ? String((sensor as { name?: string }).name ?? 'sensor') : 'sensor';
      const unit = sensor && typeof sensor === 'object' ? String((sensor as { unit?: string }).unit ?? '') : '';
      lines.push(
        `${name}: ${reading.value}${unit ? ' ' + unit : ''} quality ${reading.quality} at ${reading.taken_at}` +
          (reading.source_system ? ` source ${reading.source_system}` : ''),
      );
    }
  }
  if (include.includes('ai_analysis')) {
    lines.push('AI analysis was not performed. No root cause and no confidence are recorded.');
  }
  if (include.includes('timeline')) {
    lines.push('No separate timeline was reconstructed. The cited reading timestamps are the history.');
  }

  const { data, error } = await supabase
    .from('evidence_items')
    .insert({
      organization_id: asset.organization_id,
      asset_id: assetId,
      source_system: 'runbook-executor',
      evidence_type: 'condition_history',
      evidence_class: readings.length > 0 ? 'MEASURED' : 'HISTORICAL',
      description: lines.join('\n').slice(0, 4000),
      data_quality: 'unknown',
      confidence_contribution: 0,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return {
    action: 'store_evidence',
    executed: true,
    evidence_item_id: data?.id ?? null,
    readings_cited: readings.length,
    verification_status: 'unverified',
  };
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
