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

    // Verify webhook signature
    // Note: In production, use proper Stripe webhook verification
    // This is a simplified version
    
    const event = JSON.parse(body);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Stripe webhook event:', event.type);

    switch (event.type) {
      case 'invoice.paid': {
        const invoice = event.data.object;
        const stripeInvoiceId = invoice.id;

        // Update invoice status in database
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

        // Update invoice status
        const { error: invoiceError } = await supabase
          .from('billing_invoices')
          .update({ status: 'payment_failed' })
          .eq('stripe_invoice_id', stripeInvoiceId);

        if (invoiceError) {
          console.error('Error updating failed invoice:', invoiceError);
        }

        // Update subscription status
        const { data: invoiceData } = await supabase
          .from('billing_invoices')
          .select('subscription_id')
          .eq('stripe_invoice_id', stripeInvoiceId)
          .single();

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

        // Map Stripe status to our status
        let ourStatus = 'active';
        if (status === 'canceled') ourStatus = 'cancelled';
        else if (status === 'past_due') ourStatus = 'past_due';
        else if (status === 'unpaid') ourStatus = 'past_due';

        const { error } = await supabase
          .from('billing_subscriptions')
          .update({ status: ourStatus })
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

      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata;

        if (metadata?.subscription_id && session.customer) {
          // Link Stripe customer to subscription
          const { error } = await supabase
            .from('billing_subscriptions')
            .update({
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
            })
            .eq('id', metadata.subscription_id);

          if (error) {
            console.error('Error linking customer:', error);
          } else {
            console.log('Customer linked to subscription:', metadata.subscription_id);
          }
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