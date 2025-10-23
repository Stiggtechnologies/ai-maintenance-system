import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const PLAN_MAP = {
  STARTER: {
    base: Deno.env.get('STRIPE_STARTER_BASE_PRICE')!,
    credits: Deno.env.get('STRIPE_STARTER_CREDITS_PRICE')!,
    includedCredits: 250000,
    includedAssets: 200,
  },
  PRO: {
    base: Deno.env.get('STRIPE_PRO_BASE_PRICE')!,
    credits: Deno.env.get('STRIPE_PRO_CREDITS_PRICE')!,
    includedCredits: 1000000,
    includedAssets: 1000,
  },
  ENTERPRISE: {
    base: Deno.env.get('STRIPE_ENTERPRISE_BASE_PRICE')!,
    credits: Deno.env.get('STRIPE_ENTERPRISE_CREDITS_PRICE')!,
    includedCredits: 5000000,
    includedAssets: 3000,
  },
} as const;

type PlanCode = keyof typeof PLAN_MAP;

async function getOrCreateStripeCustomer(supabase: any, tenantId: string): Promise<string> {
  // Check if customer already exists
  const { data: subscription } = await supabase
    .from('billing_subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .not('stripe_customer_id', 'is', null)
    .maybeSingle();

  if (subscription?.stripe_customer_id) {
    return subscription.stripe_customer_id;
  }

  // Get tenant email for new customer
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, full_name')
    .eq('id', tenantId)
    .maybeSingle();

  // Create new Stripe customer
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!;
  const response = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      email: profile?.email || `tenant-${tenantId}@example.com`,
      name: profile?.full_name || `Tenant ${tenantId}`,
      metadata: JSON.stringify({ tenant_id: tenantId }),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create Stripe customer');
  }

  const customer = await response.json();
  return customer.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const appBaseUrl = Deno.env.get('APP_BASE_URL') || supabaseUrl;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const path = url.pathname.replace('/stripe-checkout', '');

    // POST /checkout - Create Stripe Checkout Session
    if (req.method === 'POST' && path === '/checkout') {
      const body = await req.json();
      const { tenant_id, plan_code } = body as { tenant_id: string; plan_code: PlanCode };

      if (!tenant_id || !plan_code) {
        throw new Error('Missing tenant_id or plan_code');
      }

      const plan = PLAN_MAP[plan_code];
      if (!plan) {
        throw new Error('Invalid plan code');
      }

      // Get or create Stripe customer
      const customerId = await getOrCreateStripeCustomer(supabase, tenant_id);

      // Create checkout session
      const checkoutResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          mode: 'subscription',
          customer: customerId,
          'line_items[0][price]': plan.base,
          'line_items[0][quantity]': '1',
          'line_items[1][price]': plan.credits,
          'line_items[1][quantity]': '1',
          success_url: `${appBaseUrl}/app/billing?success=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appBaseUrl}/app/billing?canceled=1`,
          'subscription_data[metadata][tenant_id]': tenant_id,
          'subscription_data[metadata][plan_code]': plan_code,
          'automatic_tax[enabled]': 'true',
        }),
      });

      if (!checkoutResponse.ok) {
        const error = await checkoutResponse.text();
        throw new Error(`Stripe checkout failed: ${error}`);
      }

      const session = await checkoutResponse.json();

      return new Response(
        JSON.stringify({ url: session.url, session_id: session.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /portal - Create Customer Portal Session
    if (req.method === 'POST' && path === '/portal') {
      const body = await req.json();
      const { tenant_id } = body as { tenant_id: string };

      if (!tenant_id) {
        throw new Error('Missing tenant_id');
      }

      // Get Stripe customer ID
      const customerId = await getOrCreateStripeCustomer(supabase, tenant_id);

      // Create portal session
      const portalResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          customer: customerId,
          return_url: `${appBaseUrl}/app/billing`,
        }),
      });

      if (!portalResponse.ok) {
        const error = await portalResponse.text();
        throw new Error(`Stripe portal failed: ${error}`);
      }

      const portal = await portalResponse.json();

      return new Response(
        JSON.stringify({ url: portal.url }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /usage/report - Report metered usage to Stripe
    if (req.method === 'POST' && path === '/usage/report') {
      const body = await req.json();
      const { subscription_item_id, quantity, timestamp, action } = body as {
        subscription_item_id: string;
        quantity: number;
        timestamp?: number;
        action?: string;
      };

      if (!subscription_item_id || !quantity) {
        throw new Error('Missing subscription_item_id or quantity');
      }

      const usageResponse = await fetch(
        `https://api.stripe.com/v1/subscription_items/${subscription_item_id}/usage_records`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            quantity: String(quantity),
            timestamp: timestamp ? String(timestamp) : String(Math.floor(Date.now() / 1000)),
            action: action || 'increment',
          }),
        }
      );

      if (!usageResponse.ok) {
        const error = await usageResponse.text();
        throw new Error(`Usage reporting failed: ${error}`);
      }

      const usageRecord = await usageResponse.json();

      return new Response(
        JSON.stringify({ ok: true, usage_record: usageRecord }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Route not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});