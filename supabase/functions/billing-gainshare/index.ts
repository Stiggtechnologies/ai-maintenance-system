import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { tenant_id, period_start, period_end, share_pct } = body;

    if (!tenant_id || !period_start || !period_end || !share_pct) {
      throw new Error('Missing required fields: tenant_id, period_start, period_end, share_pct');
    }

    // Get KPI baselines
    const { data: baselines, error: baselineError } = await supabase
      .from('kpi_baselines')
      .select('*')
      .eq('tenant_id', tenant_id)
      .lte('effective_from', period_end)
      .or(`effective_to.is.null,effective_to.gte.${period_start}`);

    if (baselineError) throw baselineError;

    // Get actual KPI values for the period
    const { data: actualKPIs, error: kpiError } = await supabase
      .from('kpi_measurements')
      .select(`
        kpis_kois (kpi_code, kpi_name),
        measured_value,
        created_at
      `)
      .gte('created_at', period_start)
      .lte('created_at', period_end);

    if (kpiError) throw kpiError;

    // Calculate savings
    const savingsBreakdown: Record<string, any> = {};
    let totalSavings = 0;

    // Example calculations - customize based on your KPIs
    const baselineMap = new Map();
    baselines?.forEach((b: any) => {
      baselineMap.set(b.metric, b);
    });

    // Availability savings
    const availabilityBaseline = baselineMap.get('availability');
    if (availabilityBaseline) {
      const actualAvailability = actualKPIs
        ?.filter((k: any) => k.kpis_kois?.kpi_code === 'KPI-003')
        .reduce((sum: number, k: any) => sum + k.measured_value, 0) / 
        (actualKPIs?.filter((k: any) => k.kpis_kois?.kpi_code === 'KPI-003').length || 1);

      if (actualAvailability && actualAvailability > availabilityBaseline.baseline_value) {
        const improvement = actualAvailability - availabilityBaseline.baseline_value;
        const costPerDowntimeHour = availabilityBaseline.cost_per_unit || 25000;
        const hoursInPeriod = (new Date(period_end).getTime() - new Date(period_start).getTime()) / (1000 * 60 * 60);
        const hoursAvoided = (improvement / 100) * hoursInPeriod;
        const savings = hoursAvoided * costPerDowntimeHour;

        savingsBreakdown.availability = {
          baseline: availabilityBaseline.baseline_value,
          actual: actualAvailability,
          improvement,
          hours_avoided: hoursAvoided,
          cost_per_hour: costPerDowntimeHour,
          savings,
        };
        totalSavings += savings;
      }
    }

    // MTBF improvement
    const mtbfBaseline = baselineMap.get('mtbf');
    if (mtbfBaseline) {
      const actualMTBF = actualKPIs
        ?.filter((k: any) => k.kpis_kois?.kpi_code === 'KPI-001')
        .reduce((sum: number, k: any) => sum + k.measured_value, 0) / 
        (actualKPIs?.filter((k: any) => k.kpis_kois?.kpi_code === 'KPI-001').length || 1);

      if (actualMTBF && actualMTBF > mtbfBaseline.baseline_value) {
        const improvement = actualMTBF - mtbfBaseline.baseline_value;
        const failureReductionPct = (improvement / mtbfBaseline.baseline_value) * 100;
        const avgFailureCost = mtbfBaseline.cost_per_unit || 50000;
        const estimatedFailuresAvoided = failureReductionPct / 10; // Simplified
        const savings = estimatedFailuresAvoided * avgFailureCost;

        savingsBreakdown.mtbf = {
          baseline: mtbfBaseline.baseline_value,
          actual: actualMTBF,
          improvement,
          failures_avoided: estimatedFailuresAvoided,
          cost_per_failure: avgFailureCost,
          savings,
        };
        totalSavings += savings;
      }
    }

    // MTTR reduction
    const mttrBaseline = baselineMap.get('mttr');
    if (mttrBaseline) {
      const actualMTTR = actualKPIs
        ?.filter((k: any) => k.kpis_kois?.kpi_code === 'KPI-002')
        .reduce((sum: number, k: any) => sum + k.measured_value, 0) / 
        (actualKPIs?.filter((k: any) => k.kpis_kois?.kpi_code === 'KPI-002').length || 1);

      if (actualMTTR && actualMTTR < mttrBaseline.baseline_value) {
        const improvement = mttrBaseline.baseline_value - actualMTTR;
        const laborCostPerHour = mttrBaseline.cost_per_unit || 150;
        const estimatedRepairs = 100; // Simplified - pull from actual work orders
        const hoursSaved = improvement * estimatedRepairs;
        const savings = hoursSaved * laborCostPerHour;

        savingsBreakdown.mttr = {
          baseline: mttrBaseline.baseline_value,
          actual: actualMTTR,
          improvement,
          hours_saved: hoursSaved,
          cost_per_hour: laborCostPerHour,
          savings,
        };
        totalSavings += savings;
      }
    }

    // Calculate fee
    const fee = totalSavings * (share_pct / 100);

    // Create gain-share run
    const { data: gainshareRun, error: gsError } = await supabase
      .from('gainshare_runs')
      .insert({
        tenant_id,
        period_start,
        period_end,
        method: 'delta_savings',
        calculated_savings_cad: totalSavings,
        share_pct,
        fee_cad: fee,
        status: 'pending_approval',
        report: {
          baselines: baselines?.reduce((acc: any, b: any) => {
            acc[b.metric] = b;
            return acc;
          }, {}),
          savings_breakdown: savingsBreakdown,
          kpi_count: actualKPIs?.length || 0,
          calculation_date: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (gsError) throw gsError;

    return new Response(
      JSON.stringify({
        gainshare_run_id: gainshareRun.id,
        calculated_savings_cad: totalSavings,
        share_pct,
        fee_cad: fee,
        status: 'pending_approval',
        savings_breakdown: savingsBreakdown,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Gain-share calculation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});