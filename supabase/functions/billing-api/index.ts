import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface Rule {
  event: string;
  perUnit: number;
  unitCalc: (meta: any) => number;
}

const CREDIT_RULES: Rule[] = [
  { event: 'LLM_token_usage', perUnit: 1, unitCalc: (m) => Math.ceil((m?.total_tokens || m?.units || 0) / 1000) },
  { event: 'vision_frame_batch', perUnit: 5, unitCalc: (m) => Math.ceil((m?.frames || m?.units || 0) / 100) },
  { event: 'optimizer_job', perUnit: 500, unitCalc: () => 1 },
  { event: 'simulator_run', perUnit: 1000, unitCalc: () => 1 },
];

function computeCredits(event_type: string, meta: any): number {
  const rule = CREDIT_RULES.find(r => r.event === event_type);
  if (!rule) throw new Error(`Unknown event type: ${event_type}`);
  return rule.perUnit * rule.unitCalc(meta || {});
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/billing-api', '');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // GET /plans - List available plans
    if (req.method === 'GET' && path === '/plans') {
      const { data: plans, error } = await supabase
        .from('billing_plans')
        .select('*')
        .eq('is_active', true)
        .order('base_price_cad');

      if (error) throw error;

      return new Response(JSON.stringify({ plans }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /subscriptions - Create new subscription
    if (req.method === 'POST' && path === '/subscriptions') {
      const body = await req.json();
      const { tenant_id, plan_code, start_date } = body;

      if (!tenant_id || !plan_code) {
        throw new Error('Missing required fields: tenant_id, plan_code');
      }

      // Get plan
      const { data: plan, error: planError } = await supabase
        .from('billing_plans')
        .select('*')
        .eq('code', plan_code)
        .single();

      if (planError || !plan) throw new Error('Plan not found');

      const periodStart = start_date ? new Date(start_date) : new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // Create subscription
      const { data: subscription, error: subError } = await supabase
        .from('billing_subscriptions')
        .insert({
          tenant_id,
          plan_id: plan.id,
          status: 'active',
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          currency: 'CAD',
        })
        .select()
        .single();

      if (subError) throw subError;

      // Create subscription limits
      const { error: limitsError } = await supabase
        .from('subscription_limits')
        .insert({
          subscription_id: subscription.id,
          included_assets: plan.included_assets,
          included_credits: plan.included_credits,
          remaining_credits: plan.included_credits,
          last_reset_at: periodStart.toISOString(),
        });

      if (limitsError) throw limitsError;

      return new Response(
        JSON.stringify({
          subscription_id: subscription.id,
          status: subscription.status,
          plan_code: plan.code,
          current_period_start: subscription.current_period_start,
          current_period_end: subscription.current_period_end,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /subscriptions/:id - Get subscription details
    if (req.method === 'GET' && path.startsWith('/subscriptions/')) {
      const subscriptionId = path.split('/')[2];

      const { data: subscription, error } = await supabase
        .from('billing_subscriptions')
        .select(`
          *,
          plan:billing_plans(*),
          limits:subscription_limits(*)
        `)
        .eq('id', subscriptionId)
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(subscription), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /usage/track - Record usage event with enhanced credit calculation
    if (req.method === 'POST' && path === '/usage/track') {
      const body = await req.json();
      const { tenant_id, subscription_id, site_id, asset_id, event_type, units, meta } = body;

      if (!tenant_id || !subscription_id || !event_type) {
        throw new Error('Missing required fields: tenant_id, subscription_id, event_type');
      }

      // Enhanced credit calculation using meta or units
      const credits = computeCredits(event_type, meta || { units: units || 1 });

      // Insert usage event
      const { error: usageError } = await supabase
        .from('usage_events')
        .insert({
          tenant_id,
          subscription_id,
          site_id,
          asset_id,
          event_type,
          units: units || 1,
          credits_consumed: credits,
          meta: meta || {},
          occurred_at: new Date().toISOString(),
        });

      if (usageError) throw usageError;

      // Update remaining credits atomically
      const { data: limits, error: limitsError } = await supabase
        .from('subscription_limits')
        .select('remaining_credits, included_credits')
        .eq('subscription_id', subscription_id)
        .single();

      if (limitsError) throw limitsError;

      const newRemaining = (limits?.remaining_credits || 0) - credits;
      const usagePercent = ((limits.included_credits - newRemaining) / limits.included_credits) * 100;

      const { error: updateError } = await supabase
        .from('subscription_limits')
        .update({ 
          remaining_credits: newRemaining, 
          updated_at: new Date().toISOString() 
        })
        .eq('subscription_id', subscription_id);

      if (updateError) throw updateError;

      // Determine alert level
      let alert = null;
      if (newRemaining < 0) {
        alert = 'OVERAGE';
      } else if (usagePercent > 90) {
        alert = 'CRITICAL';
      } else if (usagePercent > 75) {
        alert = 'WARNING';
      }

      return new Response(
        JSON.stringify({
          ok: true,
          credits_burned: credits,
          remaining_credits: Math.max(newRemaining, 0),
          overage_credits: newRemaining < 0 ? Math.abs(newRemaining) : 0,
          usage_percent: usagePercent.toFixed(1),
          alert,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /usage/summary - Get usage summary
    if (req.method === 'GET' && path === '/usage/summary') {
      const subscriptionId = url.searchParams.get('subscriptionId');
      const period = url.searchParams.get('period'); // YYYY-MM

      if (!subscriptionId) {
        throw new Error('Missing subscriptionId parameter');
      }

      let query = supabase
        .from('usage_events')
        .select('event_type, units, credits_consumed, occurred_at')
        .eq('subscription_id', subscriptionId);

      if (period) {
        const startDate = new Date(`${period}-01`);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
        query = query.gte('occurred_at', startDate.toISOString()).lt('occurred_at', endDate.toISOString());
      }

      const { data: events, error } = await query;
      if (error) throw error;

      // Aggregate by event type
      const summary: Record<string, { count: number; units: number; credits: number }> = {};
      let totalCredits = 0;

      events?.forEach((event: any) => {
        if (!summary[event.event_type]) {
          summary[event.event_type] = { count: 0, units: 0, credits: 0 };
        }
        summary[event.event_type].count++;
        summary[event.event_type].units += event.units;
        summary[event.event_type].credits += event.credits_consumed;
        totalCredits += event.credits_consumed;
      });

      return new Response(
        JSON.stringify({
          subscription_id: subscriptionId,
          period,
          total_credits: totalCredits,
          by_type: summary,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /overage - Get overage summary using new view
    if (req.method === 'GET' && path === '/overage') {
      const subscriptionId = url.searchParams.get('subscriptionId');
      
      if (!subscriptionId) {
        throw new Error('Missing subscriptionId parameter');
      }

      const { data, error } = await supabase
        .from('v_billable_overage')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('month', { ascending: false })
        .limit(6);

      if (error) throw error;

      return new Response(
        JSON.stringify({ overage_history: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Route not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Billing API error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});