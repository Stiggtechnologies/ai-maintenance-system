import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface AssetHealthData {
  asset_id: string;
  health_score: number;
  anomaly_detected: boolean;
  sensor_data?: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, data } = await req.json();

    switch (action) {
      case 'monitor_assets':
        return await monitorAssets(supabase);

      case 'process_decision':
        return await processDecision(supabase, data);

      case 'execute_autonomous_action':
        return await executeAutonomousAction(supabase, data);

      case 'generate_health_report':
        return await generateHealthReport(supabase);

      // Approve→Execute: closes the governance loop for a decision.
      // Creates the canonical action record and executes the side-effect.
      case 'approve_and_execute_decision':
        return await approveAndExecuteDecision(supabase, data);

      // PR 3: Cross-plane handoff — Intelligence Plane result → Autonomous decision.
      // This is the Control/Governance Plane entry point for intelligence-driven
      // decisions. Called by the frontend AFTER ai-agent-processor returns.
      // Creates the canonical decision record + the approval workflow is auto-
      // created by the DB trigger (create_approval_workflow).
      case 'create_intelligence_decision':
        return await createIntelligenceDecision(supabase, data);

      // PR 3: Record a failed intelligence invocation as a failed decision.
      case 'create_failed_decision':
        return await createFailedDecision(supabase, data);

      default:
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function monitorAssets(supabase: any) {
  // Get all operational assets
  const { data: assets, error } = await supabase
    .from('assets')
    .select('*')
    .in('status', ['operational', 'maintenance']);

  if (error) throw error;

  const healthUpdates = [];
  const decisions = [];

  for (const asset of assets) {
    // Read latest sensor data if available, otherwise derive from recent health records
    const { data: latestHealth } = await supabase
      .from('asset_health_monitoring')
      .select('health_score, sensor_data')
      .eq('asset_id', asset.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Read from normalized signals if available
    const { data: signals } = await supabase
      .from('normalized_signals')
      .select('signal_type, numeric_value')
      .eq('asset_id', asset.id)
      .gte('signal_time', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('signal_time', { ascending: false })
      .limit(10);

    // Calculate health score from real data when available
    let healthScore: number;
    let sensorData: Record<string, number>;

    if (signals && signals.length > 0) {
      // Derive health from actual sensor signals
      const tempSignal = signals.find(s => s.signal_type === 'temperature');
      const vibSignal = signals.find(s => s.signal_type === 'vibration');
      const pressSignal = signals.find(s => s.signal_type === 'pressure');
      sensorData = {
        temperature: tempSignal?.numeric_value ?? 85,
        vibration: vibSignal?.numeric_value ?? 3,
        pressure: pressSignal?.numeric_value ?? 120,
      };
      // Score: penalize high temp (>100), high vibration (>8), abnormal pressure
      const tempPenalty = Math.max(0, (sensorData.temperature - 90) * 2);
      const vibPenalty = Math.max(0, (sensorData.vibration - 5) * 10);
      const pressPenalty = sensorData.pressure > 150 || sensorData.pressure < 80 ? 15 : 0;
      healthScore = Math.max(0, Math.min(100, 100 - tempPenalty - vibPenalty - pressPenalty));
    } else if (latestHealth?.health_score != null) {
      // Use previous health with slight degradation model
      healthScore = Math.max(0, latestHealth.health_score - (Math.random() * 2 - 0.5));
      sensorData = latestHealth.sensor_data || { temperature: 85, vibration: 3, pressure: 120 };
    } else {
      // No data available — default to healthy with a note
      healthScore = 85;
      sensorData = { temperature: 85, vibration: 3, pressure: 120 };
    }

    const anomalyDetected = healthScore < 60;
    
    // Create health record
    const { data: healthData } = await supabase
      .from('asset_health_monitoring')
      .insert({
        asset_id: asset.id,
        health_score: healthScore,
        anomaly_detected: anomalyDetected,
        sensor_data: sensorData,
        ai_analysis: anomalyDetected 
          ? `Anomaly detected on ${asset.name}. Health score: ${healthScore.toFixed(2)}%` 
          : `${asset.name} operating normally`,
        recommendations: anomalyDetected ? [
          'Schedule preventive maintenance',
          'Inspect for wear and tear',
          'Monitor closely for next 24 hours'
        ] : ['Continue normal operations']
      })
      .select()
      .single();

    healthUpdates.push(healthData);

    // Create autonomous decision if anomaly detected
    if (anomalyDetected && healthScore < 50) {
      const confidence = 100 - healthScore;
      const requiresApproval = asset.criticality === 'critical' || confidence < 80;

      const { data: decision } = await supabase
        .from('autonomous_decisions')
        .insert({
          decision_type: 'work_order_creation',
          decision_data: {
            asset_id: asset.id,
            asset_name: asset.name,
            reason: 'Low health score detected',
            health_score: healthScore,
            recommended_action: 'Create preventive maintenance work order'
          },
          confidence_score: confidence,
          requires_approval: requiresApproval,
          approval_deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
        })
        .select()
        .single();

      decisions.push(decision);

      // If high confidence and not critical, auto-execute
      if (!requiresApproval) {
        await executeWorkOrderCreation(supabase, decision);
      } else {
        // Create alert for managers
        await supabase
          .from('system_alerts')
          .insert({
            severity: asset.criticality === 'critical' ? 'critical' : 'high',
            title: `Approval Required: ${asset.name}`,
            description: `Health score dropped to ${healthScore.toFixed(2)}%. Work order creation pending approval.`,
            alert_type: 'approval_required',
            target_users: [] // Will be populated by RLS
          });
      }
    }
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      monitored_assets: assets.length,
      health_updates: healthUpdates.length,
      decisions_created: decisions.length
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function executeWorkOrderCreation(supabase: any, decision: any) {
  const { asset_id, asset_name, health_score } = decision.decision_data;

  // Create work order
  const { data: workOrder, error } = await supabase
    .from('work_orders')
    .insert({
      asset_id,
      title: `Preventive Maintenance - ${asset_name}`,
      description: `Autonomous system detected health score of ${health_score.toFixed(2)}%. Immediate inspection required.`,
      priority: health_score < 30 ? 'critical' : 'high',
      status: 'pending',
      assigned_to: 'Auto-assigned'
    })
    .select()
    .single();

  if (!error) {
    // Log the action
    await supabase
      .from('autonomous_actions')
      .insert({
        action_type: 'create_work_order',
        target_id: workOrder.id,
        action_data: { decision_id: decision.id, work_order_id: workOrder.id },
        triggered_by: 'AutonomousOrchestrator',
        success: true
      });

    // Update decision
    await supabase
      .from('autonomous_decisions')
      .update({ status: 'auto_executed', executed_at: new Date().toISOString() })
      .eq('id', decision.id);
  }

  return workOrder;
}

async function processDecision(supabase: any, data: any) {
  const { decision_id, approved, approver_id } = data;

  // Update decision
  const { data: decision } = await supabase
    .from('autonomous_decisions')
    .update({
      status: approved ? 'approved' : 'rejected',
      approved_by: approver_id,
      executed_at: approved ? new Date().toISOString() : null
    })
    .eq('id', decision_id)
    .select()
    .single();

  if (approved && decision) {
    // Execute the decision
    if (decision.decision_type === 'work_order_creation') {
      await executeWorkOrderCreation(supabase, decision);
    }
  }

  return new Response(
    JSON.stringify({ success: true, decision }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function executeAutonomousAction(supabase: any, data: any) {
  const { action_type, target_id, action_data } = data;

  // Log the action
  await supabase
    .from('autonomous_actions')
    .insert({
      action_type,
      target_id,
      action_data,
      triggered_by: 'ManualTrigger',
      success: true
    });

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function generateHealthReport(supabase: any) {
  // Get latest health data for all assets
  const { data: healthData } = await supabase
    .from('asset_health_monitoring')
    .select('*, assets(name, type, criticality)')
    .order('recorded_at', { ascending: false });

  // Group by asset and get latest
  const latestHealth = healthData?.reduce((acc: any, curr: any) => {
    if (!acc[curr.asset_id] || curr.recorded_at > acc[curr.asset_id].recorded_at) {
      acc[curr.asset_id] = curr;
    }
    return acc;
  }, {});

  const report = {
    total_assets: Object.keys(latestHealth || {}).length,
    critical_assets: Object.values(latestHealth || {}).filter((h: any) => h.health_score < 50).length,
    anomalies_detected: Object.values(latestHealth || {}).filter((h: any) => h.anomaly_detected).length,
    average_health: Object.values(latestHealth || {}).reduce((sum: number, h: any) => sum + h.health_score, 0) / Object.keys(latestHealth || {}).length,
    assets: Object.values(latestHealth || {})
  };

  return new Response(
    JSON.stringify(report),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ---------------------------------------------------------------------------
// PR 3: create_intelligence_decision
//
// Cross-plane handoff: takes the structured result from the Intelligence
// Plane (ai-agent-processor) and creates the canonical Autonomous decision
// record. The DB trigger (create_approval_workflow) auto-creates the
// approval_workflows row routed to the correct manager via RBAC.
//
// Plane ownership: this function is CONTROL/GOVERNANCE PLANE.
//   - Writes to Autonomous tables ONLY (autonomous_decisions).
//   - Never writes to OpenClaw or SIR tables.
//   - Autonomous is the single source of audit truth for this decision.
// ---------------------------------------------------------------------------

interface IntelligenceDecisionInput {
  tenant_id: string;
  correlation_id: string;
  asset_id: string;
  work_order_id: string;
  autonomy_level: string;
  agent_run_id: string;
  task_code: string;
  confidence: number;
  requires_human_review: boolean;
  raw_summary: string;
  structured_output: any;
}

async function createIntelligenceDecision(supabase: any, input: IntelligenceDecisionInput) {
  const {
    tenant_id, correlation_id, asset_id, work_order_id,
    autonomy_level, agent_run_id, task_code, confidence,
    requires_human_review, raw_summary, structured_output,
  } = input;

  if (!tenant_id || !correlation_id || !task_code) {
    return new Response(
      JSON.stringify({ error: 'tenant_id, correlation_id, and task_code are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Map confidence from [0,1] to [0,100] for autonomous_decisions.confidence_score
  const confidenceScore = Math.round(confidence * 100);

  // Insert the canonical Autonomous decision.
  // The trigger create_approval_workflow() will auto-create the
  // approval_workflows row if requires_approval = true.
  const { data: decision, error } = await supabase
    .from('autonomous_decisions')
    .insert({
      tenant_id,
      correlation_id,
      asset_id,
      work_order_id,
      autonomy_level,
      decision_type: 'reliability_recommendation',
      decision_data: {
        task_code,
        agent_run_id,
        raw_summary,
        ...structured_output,
      },
      confidence_score: confidenceScore,
      requires_approval: requires_human_review,
      approval_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error(`event=decision_create_failed correlation_id=${correlation_id} error=${error.message}`);
    return new Response(
      JSON.stringify({ error: `Failed to create decision: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Fetch the auto-created approval workflow (created by DB trigger)
  const { data: workflow } = await supabase
    .from('approval_workflows')
    .select('id, approver_id, status')
    .eq('decision_id', decision.id)
    .maybeSingle();

  console.log(`event=intelligence_decision_created correlation_id=${correlation_id} decision_id=${decision.id} approval_workflow_id=${workflow?.id || 'none'} autonomy_level=${autonomy_level} confidence=${confidenceScore}`);

  return new Response(
    JSON.stringify({
      success: true,
      decision_id: decision.id,
      correlation_id,
      approval_workflow_id: workflow?.id || null,
      approval_status: workflow?.status || 'no_approval_required',
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// PR 3: create_failed_decision
//
// Records a failed intelligence invocation as an Autonomous decision
// with status='rejected' so the audit chain is complete even on failure.
// ---------------------------------------------------------------------------

async function createFailedDecision(supabase: any, input: any) {
  const { tenant_id, correlation_id, asset_id, work_order_id, task_code, error_message } = input;

  const { data: decision, error } = await supabase
    .from('autonomous_decisions')
    .insert({
      tenant_id,
      correlation_id,
      asset_id,
      work_order_id,
      decision_type: 'reliability_recommendation',
      decision_data: {
        task_code,
        error: error_message,
        failed: true,
      },
      confidence_score: 0,
      status: 'failed',
      requires_approval: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`event=failed_decision_create_failed correlation_id=${correlation_id} error=${error.message}`);
  } else {
    console.log(`event=failed_decision_created correlation_id=${correlation_id} decision_id=${decision.id}`);
  }

  return new Response(
    JSON.stringify({ success: !error, decision_id: decision?.id, correlation_id }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// approve_and_execute_decision
//
// Closes the governance loop: approved decision → governed action →
// canonical execution record → intact audit chain.
//
// State transitions (all separate — never collapsed):
//   1. autonomous_decisions.status: pending → approved
//   2. approval_workflows.status: pending → approved
//   3. autonomous_actions: new row with action_type + success
//   4. work_order_status_history: the actual side-effect
//
// Governed action types (from sir-contracts.ts GovernedActionType):
//   - append_work_order_note
//   - create_follow_up_task
//   - flag_for_engineering_review
// ---------------------------------------------------------------------------

interface ApproveAndExecuteInput {
  decision_id: string;
  approver_id: string;
  action_type: string;
  action_note?: string;
}

async function approveAndExecuteDecision(supabase: any, input: ApproveAndExecuteInput) {
  const { decision_id, approver_id, action_type, action_note } = input;

  if (!decision_id || !approver_id) {
    return new Response(
      JSON.stringify({ error: 'decision_id and approver_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // 1. Fetch and validate the decision
  const { data: decision, error: fetchError } = await supabase
    .from('autonomous_decisions')
    .select('*')
    .eq('id', decision_id)
    .eq('status', 'pending')
    .single();

  if (fetchError || !decision) {
    return new Response(
      JSON.stringify({ error: 'Decision not found or not in pending state' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const correlation_id = decision.correlation_id;
  const tenant_id = decision.tenant_id;

  try {
    // 2. Update decision status → approved
    await supabase
      .from('autonomous_decisions')
      .update({
        status: 'approved',
        approved_by: approver_id,
        executed_at: new Date().toISOString(),
      })
      .eq('id', decision_id);

    // 3. Update approval workflow → approved
    await supabase
      .from('approval_workflows')
      .update({
        status: 'approved',
        responded_at: new Date().toISOString(),
      })
      .eq('decision_id', decision_id)
      .eq('status', 'pending');

    // 4. Create the canonical action record
    const resolvedActionType = action_type || 'append_work_order_note';
    const recommendation = decision.decision_data?.raw_summary
      || decision.decision_data?.summary
      || 'AI reliability recommendation approved.';

    const noteText = action_note || recommendation;

    const { data: actionRecord, error: actionError } = await supabase
      .from('autonomous_actions')
      .insert({
        tenant_id,
        correlation_id,
        decision_id,
        action_type: resolvedActionType,
        target_id: decision.work_order_id,
        action_data: {
          decision_id,
          work_order_id: decision.work_order_id,
          action_type: resolvedActionType,
          note: noteText,
          approved_by: approver_id,
        },
        triggered_by: 'ApprovalExecution',
        success: true,
      })
      .select('id')
      .single();

    if (actionError) {
      throw new Error(`Failed to create action: ${actionError.message}`);
    }

    // 5. Execute the side-effect based on action_type
    if (resolvedActionType === 'append_work_order_note' && decision.work_order_id) {
      // Insert a status history entry with the recommendation as a comment.
      // This appears on the WorkOrderDetailPage "Status History" tab.
      await supabase
        .from('work_order_status_history')
        .insert({
          work_order_id: decision.work_order_id,
          status_from: 'in_progress',
          status_to: 'in_progress',
          changed_by: approver_id,
          changed_at: new Date().toISOString(),
          comments: `[AI Recommendation — Approved]\n${noteText}`,
        });
    }

    console.log(`event=decision_approved_and_executed correlation_id=${correlation_id} decision_id=${decision_id} action_id=${actionRecord.id} action_type=${resolvedActionType}`);

    return new Response(
      JSON.stringify({
        success: true,
        decision_id,
        action_id: actionRecord.id,
        correlation_id,
        action_type: resolvedActionType,
        executed: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    // Mark action as failed if we got that far
    console.error(`event=execution_failed correlation_id=${correlation_id} decision_id=${decision_id} error=${error.message}`);

    await supabase
      .from('autonomous_actions')
      .insert({
        tenant_id,
        correlation_id,
        decision_id,
        action_type: action_type || 'append_work_order_note',
        target_id: decision.work_order_id,
        action_data: { error: error.message },
        triggered_by: 'ApprovalExecution',
        success: false,
        error_message: error.message,
      })
      .catch(() => {});

    return new Response(
      JSON.stringify({ success: false, error: error.message, correlation_id }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}