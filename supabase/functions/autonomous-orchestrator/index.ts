import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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
    // Simulate health monitoring (in real system, would read from IoT sensors)
    const healthScore = Math.random() * 100;
    const anomalyDetected = healthScore < 60;
    
    // Create health record
    const { data: healthData } = await supabase
      .from('asset_health_monitoring')
      .insert({
        asset_id: asset.id,
        health_score: healthScore,
        anomaly_detected: anomalyDetected,
        sensor_data: {
          temperature: 70 + Math.random() * 30,
          vibration: Math.random() * 10,
          pressure: 100 + Math.random() * 50
        },
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