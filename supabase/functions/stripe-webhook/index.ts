import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, Stripe-Signature',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const signature = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!signature || !webhookSecret) {
      throw new Error('Missing signature or webhook secret');
    }

    const body = await req.text();
    const event = JSON.parse(body);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Stripe webhook event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata;
        const tenantId = metadata?.tenant_id;
        const planCode = metadata?.plan_code;

        if (!tenantId || !planCode) {
          console.warn('Missing tenant_id or plan_code in checkout metadata');
          break;
        }

        // Get the subscription to find item IDs
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!;
        const subResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
          headers: { 'Authorization': `Bearer ${stripeKey}` },
        });

        if (!subResponse.ok) {
          console.error('Failed to fetch subscription details');
          break;
        }

        const subscription = await subResponse.json();
        const items = subscription.items.data;

        // Find base and credits items
        let baseItemId = null;
        let creditsItemId = null;

        for (const item of items) {
          const priceMetadata = item.price.metadata;
          if (priceMetadata?.component === 'base') {
            baseItemId = item.id;
          } else if (priceMetadata?.component === 'credits') {
            creditsItemId = item.id;
          }
        }

        // Get plan from database
        const { data: plan } = await supabase
          .from('billing_plans')
          .select('*')
          .eq('code', planCode)
          .single();

        if (!plan) {
          console.error('Plan not found:', planCode);
          break;
        }

        // Create or update subscription
        const periodStart = new Date(subscription.current_period_start * 1000).toISOString();
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        const { data: existingSub } = await supabase
          .from('billing_subscriptions')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();

        if (existingSub) {
          // Update existing
          await supabase
            .from('billing_subscriptions')
            .update({
              status: 'active',
              stripe_customer_id: session.customer,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingSub.id);

          console.log('Updated existing subscription:', existingSub.id);
        } else {
          // Create new
          const { data: newSub, error: subError } = await supabase
            .from('billing_subscriptions')
            .insert({
              tenant_id: tenantId,
              plan_id: plan.id,
              status: 'active',
              stripe_customer_id: session.customer,
              stripe_subscription_id: subscription.id,
              current_period_start: periodStart,
              current_period_end: periodEnd,
            })
            .select()
            .single();

          if (subError) {
            console.error('Error creating subscription:', subError);
            break;
          }

          // Create subscription limits
          await supabase
            .from('subscription_limits')
            .insert({
              subscription_id: newSub.id,
              included_assets: plan.included_assets,
              included_credits: plan.included_credits,
              remaining_credits: plan.included_credits,
              last_reset_at: periodStart,
            });

          console.log('Created new subscription:', newSub.id);
        }

        // Store subscription item IDs in metadata
        const { error: metaError } = await supabase
          .from('billing_subscriptions')
          .update({
            metadata: {
              stripe_base_item_id: baseItemId,
              stripe_credits_item_id: creditsItemId,
              plan_code: planCode,
            },
          })
          .eq('stripe_subscription_id', subscription.id);

        if (metaError) {
          console.error('Error storing item IDs:', metaError);
        } else {
          console.log('Stored subscription item IDs');
        }

        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const stripeInvoiceId = invoice.id;

        const { error } = await supabase
          .from('billing_invoices')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
          })
          .eq('stripe_invoice_id', stripeInvoiceId);

        if (error) {
          console.error('Error updating invoice:', error);
        } else {
          console.log('Invoice marked as paid:', stripeInvoiceId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const stripeInvoiceId = invoice.id;

        const { error: invoiceError } = await supabase
          .from('billing_invoices')
          .update({ status: 'payment_failed' })
          .eq('stripe_invoice_id', stripeInvoiceId);

        if (invoiceError) {
          console.error('Error updating failed invoice:', invoiceError);
        }

        const { data: invoiceData } = await supabase
          .from('billing_invoices')
          .select('subscription_id')
          .eq('stripe_invoice_id', stripeInvoiceId)
          .maybeSingle();

        if (invoiceData) {
          await supabase
            .from('billing_subscriptions')
            .update({ status: 'past_due' })
            .eq('id', invoiceData.subscription_id);
        }

        console.log('Invoice payment failed:', stripeInvoiceId);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const stripeSubId = subscription.id;
        const status = subscription.status;

        let ourStatus = 'active';
        if (status === 'canceled') ourStatus = 'cancelled';
        else if (status === 'past_due') ourStatus = 'past_due';
        else if (status === 'unpaid') ourStatus = 'past_due';

        const periodStart = new Date(subscription.current_period_start * 1000).toISOString();
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        const { error } = await supabase
          .from('billing_subscriptions')
          .update({
            status: ourStatus,
            current_period_start: periodStart,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', stripeSubId);

        if (error) {
          console.error('Error updating subscription:', error);
        } else {
          console.log('Subscription updated:', stripeSubId, ourStatus);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const stripeSubId = subscription.id;

        const { error } = await supabase
          .from('billing_subscriptions')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', stripeSubId);

        if (error) {
          console.error('Error cancelling subscription:', error);
        } else {
          console.log('Subscription cancelled:', stripeSubId);
        }
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }

    return new Response(
      JSON.stringify({ received: true, event_type: event.type }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Webhook processing failed' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});