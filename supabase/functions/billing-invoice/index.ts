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
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { subscription_id } = body;

    if (!subscription_id) {
      throw new Error('Missing subscription_id');
    }

    // Get subscription with plan and limits
    const { data: subscription, error: subError } = await supabase
      .from('billing_subscriptions')
      .select(`
        *,
        plan:billing_plans(*),
        limits:subscription_limits(*)
      `)
      .eq('id', subscription_id)
      .single();

    if (subError || !subscription) throw new Error('Subscription not found');

    const plan = (subscription as any).plan;
    const limits = (subscription as any).limits[0];

    // Get current asset count
    const { data: assetSnapshot } = await supabase
      .from('asset_snapshots')
      .select('asset_count')
      .eq('tenant_id', subscription.tenant_id)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentAssetCount = assetSnapshot?.asset_count || 0;

    // Get usage for current period
    const { data: usageEvents, error: usageError } = await supabase
      .from('usage_events')
      .select('credits_consumed')
      .eq('subscription_id', subscription_id)
      .gte('occurred_at', subscription.current_period_start)
      .lt('occurred_at', subscription.current_period_end);

    if (usageError) throw usageError;

    const totalCreditsUsed = usageEvents?.reduce((sum: number, e: any) => sum + e.credits_consumed, 0) || 0;

    // Calculate charges
    const baseAmount = plan.base_price_cad;

    // Asset uplift
    const assetOverage = Math.max(0, currentAssetCount - plan.included_assets);
    const assetUpliftAmount = assetOverage * plan.asset_uplift_cad;

    // Credit overage
    const creditOverage = Math.max(0, totalCreditsUsed - plan.included_credits);
    const usageOverageAmount = creditOverage * plan.overage_per_credit_cad;

    const subtotal = baseAmount + assetUpliftAmount + usageOverageAmount;
    const tax = 0; // Tax calculation can be added based on jurisdiction
    const total = subtotal + tax;

    // Create invoice record
    const { data: invoice, error: invoiceError } = await supabase
      .from('billing_invoices')
      .insert({
        subscription_id,
        period_start: subscription.current_period_start,
        period_end: subscription.current_period_end,
        base_amount_cad: baseAmount,
        asset_uplift_cad: assetUpliftAmount,
        usage_overage_cad: usageOverageAmount,
        subtotal_cad: subtotal,
        tax_cad: tax,
        total_cad: total,
        status: 'open',
        asset_count: currentAssetCount,
        credits_consumed: totalCreditsUsed,
        meta: {
          plan_code: plan.code,
          included_assets: plan.included_assets,
          asset_overage,
          included_credits: plan.included_credits,
          credit_overage: creditOverage,
        },
      })
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    // Create Stripe invoice if Stripe is configured
    let stripeInvoiceId = null;
    let stripeHostedUrl = null;

    if (stripeKey && subscription.stripe_customer_id) {
      try {
        const stripeResponse = await fetch('https://api.stripe.com/v1/invoices', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            customer: subscription.stripe_customer_id,
            currency: 'cad',
            description: `${plan.name} - ${new Date(subscription.current_period_start).toLocaleDateString()} to ${new Date(subscription.current_period_end).toLocaleDateString()}`,
            metadata: JSON.stringify({
              subscription_id,
              invoice_id: invoice.id,
            }),
          }),
        });

        if (stripeResponse.ok) {
          const stripeInvoice = await stripeResponse.json();
          stripeInvoiceId = stripeInvoice.id;
          stripeHostedUrl = stripeInvoice.hosted_invoice_url;

          // Add line items
          await fetch(`https://api.stripe.com/v1/invoiceitems`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              customer: subscription.stripe_customer_id,
              invoice: stripeInvoiceId,
              amount: Math.round(baseAmount * 100).toString(),
              currency: 'cad',
              description: `${plan.name} - Base subscription`,
            }),
          });

          if (assetUpliftAmount > 0) {
            await fetch(`https://api.stripe.com/v1/invoiceitems`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${stripeKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                customer: subscription.stripe_customer_id,
                invoice: stripeInvoiceId,
                amount: Math.round(assetUpliftAmount * 100).toString(),
                currency: 'cad',
                description: `Asset uplift - ${assetOverage} assets`,
              }),
            });
          }

          if (usageOverageAmount > 0) {
            await fetch(`https://api.stripe.com/v1/invoiceitems`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${stripeKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                customer: subscription.stripe_customer_id,
                invoice: stripeInvoiceId,
                amount: Math.round(usageOverageAmount * 100).toString(),
                currency: 'cad',
                description: `Usage overage - ${creditOverage.toLocaleString()} credits`,
              }),
            });
          }

          // Finalize invoice
          await fetch(`https://api.stripe.com/v1/invoices/${stripeInvoiceId}/finalize`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
            },
          });
        }
      } catch (stripeError) {
        console.error('Stripe error:', stripeError);
      }
    }

    // Update invoice with Stripe details
    if (stripeInvoiceId) {
      await supabase
        .from('billing_invoices')
        .update({
          stripe_invoice_id: stripeInvoiceId,
          stripe_hosted_url: stripeHostedUrl,
        })
        .eq('id', invoice.id);
    }

    // Reset credits for next period
    await supabase
      .from('subscription_limits')
      .update({
        remaining_credits: plan.included_credits,
        last_reset_at: new Date().toISOString(),
      })
      .eq('subscription_id', subscription_id);

    // Advance subscription period
    const newPeriodEnd = new Date(subscription.current_period_end);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    await supabase
      .from('billing_subscriptions')
      .update({
        current_period_start: subscription.current_period_end,
        current_period_end: newPeriodEnd.toISOString(),
      })
      .eq('id', subscription_id);

    return new Response(
      JSON.stringify({
        invoice_id: invoice.id,
        total_cad: total,
        stripe_invoice_id: stripeInvoiceId,
        stripe_hosted_url: stripeHostedUrl,
        breakdown: {
          base: baseAmount,
          asset_uplift: assetUpliftAmount,
          usage_overage: usageOverageAmount,
          tax,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Invoice generation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});