import { supabase } from '../lib/supabase';

export async function startAutonomousMonitoring() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase configuration missing');
    return;
  }

  const runMonitoring = async () => {
    try {
      await startHealthMonitoring();
      console.log('[Autonomous System] Health monitoring triggered');
    } catch (error) {
      console.error('[Autonomous System] Error:', error);
    }
  };

  runMonitoring();

  const interval = setInterval(runMonitoring, 5 * 60 * 1000);

  return () => clearInterval(interval);
}

export async function startHealthMonitoring() {
  const gatewayUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway`;
  const headers = {
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  const { data: assets } = await supabase
    .from('assets')
    .select('id')
    .eq('status', 'operational');

  if (!assets || assets.length === 0) return;

  await fetch(`${gatewayUrl}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job_type: 'health_monitoring',
      job_data: {
        asset_ids: assets.map(a => a.id)
      },
      priority: 7
    })
  });
}

export async function processHealthAlert(assetId: string, healthScore: number, sensorData: any) {
  if (healthScore >= 60) return;

  const severity = healthScore < 40 ? 'critical' : 'high';
  const confidenceScore = 100 - healthScore;

  const { data: alert } = await supabase
    .from('system_alerts')
    .insert({
      severity,
      title: `Asset Health Degradation Detected`,
      description: `Asset health score dropped to ${healthScore}%. Immediate attention may be required.`,
      alert_type: 'asset_health',
      target_users: [],
      acknowledged: false,
      resolved: false
    })
    .select()
    .single();

  if (!alert) return;

  const requiresApproval = healthScore < 30;

  const { data: decision } = await supabase
    .from('autonomous_decisions')
    .insert({
      decision_type: 'create_work_order',
      decision_data: {
        asset_id: assetId,
        title: `Emergency Maintenance - Health Score ${healthScore}%`,
        description: `Automated detection: Asset health has degraded to ${healthScore}%. Sensor readings: ${JSON.stringify(sensorData)}`,
        priority: severity,
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      },
      confidence_score: confidenceScore,
      status: 'pending',
      requires_approval: requiresApproval,
      approval_deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    })
    .select()
    .single();

  if (!decision) return;

  if (!requiresApproval && confidenceScore >= 85) {
    await executeDecisionAutomatically(decision.id);
  } else {
    await supabase.rpc('broadcast_to_channel', {
      p_channel_name: 'approvals.pending',
      p_message_type: 'approval_required',
      p_payload: {
        decision_id: decision.id,
        asset_id: assetId,
        health_score: healthScore,
        severity
      },
      p_priority: 'high'
    });
  }

  return decision;
}

async function executeDecisionAutomatically(decisionId: string) {
  const { data: decision } = await supabase
    .from('autonomous_decisions')
    .select('*')
    .eq('id', decisionId)
    .single();

  if (!decision || decision.decision_type !== 'create_work_order') return;

  const { data: workOrder } = await supabase
    .from('work_orders')
    .insert({
      asset_id: decision.decision_data.asset_id,
      title: decision.decision_data.title,
      description: decision.decision_data.description,
      priority: decision.decision_data.priority,
      status: 'pending'
    })
    .select()
    .single();

  if (workOrder) {
    await supabase
      .from('autonomous_decisions')
      .update({
        status: 'auto_executed',
        executed_at: new Date().toISOString()
      })
      .eq('id', decisionId);

    await supabase
      .from('autonomous_actions')
      .insert({
        action_type: 'work_order_created',
        target_id: workOrder.id,
        action_data: decision.decision_data,
        triggered_by: 'autonomous_health_monitoring',
        success: true
      });

    await supabase.rpc('broadcast_to_channel', {
      p_channel_name: 'workorders.updates',
      p_message_type: 'autonomous_work_order_created',
      p_payload: {
        work_order_id: workOrder.id,
        decision_id: decisionId,
        confidence_score: decision.confidence_score
      },
      p_priority: 'high'
    });
  }
}

export async function scheduleKPICalculation() {
  const gatewayUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway`;
  const headers = {
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  const { data: kpis } = await supabase
    .from('kpis_kois')
    .select('id')
    .eq('active', true);

  if (!kpis || kpis.length === 0) return;

  await fetch(`${gatewayUrl}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job_type: 'calculate_kpis',
      job_data: {
        kpi_ids: kpis.map(k => k.id)
      },
      priority: 5
    })
  });
}

export async function processDocumentUpload(documentId: string) {
  const gatewayUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway`;
  const headers = {
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  await fetch(`${gatewayUrl}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job_type: 'process_document',
      job_data: {
        document_id: documentId
      },
      priority: 6
    })
  });
}

export function initializeMonitoringSchedule() {
  const healthInterval = setInterval(() => {
    startHealthMonitoring();
  }, 5 * 60 * 1000);

  const kpiInterval = setInterval(() => {
    scheduleKPICalculation();
  }, 15 * 60 * 1000);

  startHealthMonitoring();
  scheduleKPICalculation();

  return () => {
    clearInterval(healthInterval);
    clearInterval(kpiInterval);
  };
}
