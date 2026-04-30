import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers matching existing pattern
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-Marketplace-Token',
};

// Types for webhook payload and responses
interface WebhookPayload {
  id: string;
  activityId: string;
  subscriptionId: string;
  publisherId: string;
  offerId: string;
  planId: string;
  action: 'ChangePlan' | 'ChangeQuantity' | 'Suspend' | 'Reinstate' | 'Unsubscribe' | 'Renew';
  operationId: string;
  status?: string;
  effectiveDate?: string;
  quantity?: number;
}

interface AzureAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface AzureOperationUpdate {
  status: 'Success' | 'Failure';
  quantity?: number;
}

// Helper: Get Azure AD access token using client credentials
async function getMarketplaceAccessToken(): Promise<string> {
  const clientId = Deno.env.get('AZURE_AD_CLIENT_ID');
  const clientSecret = Deno.env.get('AZURE_AD_CLIENT_SECRET');
  const tenantId = Deno.env.get('AZURE_AD_TENANT_ID');

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Missing Azure AD credentials (AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID)');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: '20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Azure AD token: ${response.status} ${error}`);
  }

  const data: AzureAccessToken = await response.json();
  return data.access_token;
}

// Helper: Update Microsoft SaaS Fulfillment API operation status
async function updateMarketplaceOperationStatus(
  subscriptionId: string,
  operationId: string,
  status: 'Success' | 'Failure',
  quantity?: number
): Promise<void> {
  const accessToken = await getMarketplaceAccessToken();

  const updateUrl = `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/operations/${operationId}?api-version=2018-08-31`;

  const payload: AzureOperationUpdate = { status };
  if (quantity !== undefined) {
    payload.quantity = quantity;
  }

  const response = await fetch(updateUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update marketplace operation: ${response.status} ${error}`);
  }
}

// Handler for ChangePlan action
async function handleChangePlan(
  supabase: any,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[ChangePlan] Processing subscription ${payload.subscriptionId}`);

    // Get the marketplace subscription
    const { data: subscription, error: lookupError } = await supabase
      .from('billing_subscriptions')
      .select('id, plan_id')
      .eq('marketplace_subscription_id', payload.subscriptionId)
      .single();

    if (lookupError || !subscription) {
      throw new Error(`Subscription not found: ${payload.subscriptionId}`);
    }

    // Get new plan ID
    const { data: newPlan, error: planError } = await supabase
      .from('billing_plans')
      .select('id')
      .eq('code', payload.planId)
      .eq('is_active', true)
      .single();

    if (planError || !newPlan) {
      throw new Error(`Plan not found: ${payload.planId}`);
    }

    // Update subscription with new plan
    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        plan_id: newPlan.id,
        marketplace_plan_id: payload.planId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscription.id);

    if (updateError) {
      throw updateError;
    }

    // Log event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: payload.subscriptionId,
      action: 'change_plan',
      status: 'success',
      request_payload: payload,
      response_payload: { new_plan: payload.planId },
      processed_at: new Date().toISOString(),
    });

    // Update marketplace operation status
    await updateMarketplaceOperationStatus(
      payload.subscriptionId,
      payload.operationId,
      'Success'
    );

    return { success: true };
  } catch (error) {
    console.error(`[ChangePlan] Error: ${error.message}`);

    // Log failure event
    try {
      await supabase.from('marketplace_events').insert({
        marketplace_subscription_id: payload.subscriptionId,
        action: 'change_plan',
        status: 'failure',
        request_payload: payload,
        error_message: error.message,
      });
    } catch (e) {
      console.error('Failed to log error event:', e);
    }

    // Try to mark operation as failed
    try {
      await updateMarketplaceOperationStatus(
        payload.subscriptionId,
        payload.operationId,
        'Failure'
      );
    } catch (e) {
      console.error('Failed to update operation status:', e);
    }

    return { success: false, error: error.message };
  }
}

// Handler for ChangeQuantity action
async function handleChangeQuantity(
  supabase: any,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[ChangeQuantity] Processing subscription ${payload.subscriptionId}, quantity: ${payload.quantity}`);

    if (payload.quantity === undefined) {
      throw new Error('Quantity is required for ChangeQuantity action');
    }

    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        marketplace_quantity: payload.quantity,
        updated_at: new Date().toISOString(),
      })
      .eq('marketplace_subscription_id', payload.subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: payload.subscriptionId,
      action: 'change_quantity',
      status: 'success',
      request_payload: payload,
      response_payload: { quantity: payload.quantity },
      processed_at: new Date().toISOString(),
    });

    // Update marketplace operation status
    await updateMarketplaceOperationStatus(
      payload.subscriptionId,
      payload.operationId,
      'Success',
      payload.quantity
    );

    return { success: true };
  } catch (error) {
    console.error(`[ChangeQuantity] Error: ${error.message}`);

    // Log failure
    try {
      await supabase.from('marketplace_events').insert({
        marketplace_subscription_id: payload.subscriptionId,
        action: 'change_quantity',
        status: 'failure',
        request_payload: payload,
        error_message: error.message,
      });

      await updateMarketplaceOperationStatus(
        payload.subscriptionId,
        payload.operationId,
        'Failure'
      );
    } catch (e) {
      console.error('Failed to log/update status:', e);
    }

    return { success: false, error: error.message };
  }
}

// Handler for Suspend action
async function handleSuspend(
  supabase: any,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[Suspend] Processing subscription ${payload.subscriptionId}`);

    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        marketplace_status: 'Suspended',
        status: 'suspended',
        updated_at: new Date().toISOString(),
      })
      .eq('marketplace_subscription_id', payload.subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: payload.subscriptionId,
      action: 'suspend',
      status: 'success',
      request_payload: payload,
      processed_at: new Date().toISOString(),
    });

    // Update marketplace operation status
    await updateMarketplaceOperationStatus(
      payload.subscriptionId,
      payload.operationId,
      'Success'
    );

    return { success: true };
  } catch (error) {
    console.error(`[Suspend] Error: ${error.message}`);

    try {
      await supabase.from('marketplace_events').insert({
        marketplace_subscription_id: payload.subscriptionId,
        action: 'suspend',
        status: 'failure',
        request_payload: payload,
        error_message: error.message,
      });

      await updateMarketplaceOperationStatus(
        payload.subscriptionId,
        payload.operationId,
        'Failure'
      );
    } catch (e) {
      console.error('Failed to log/update status:', e);
    }

    return { success: false, error: error.message };
  }
}

// Handler for Reinstate action
async function handleReinstate(
  supabase: any,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[Reinstate] Processing subscription ${payload.subscriptionId}`);

    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        marketplace_status: 'Subscribed',
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('marketplace_subscription_id', payload.subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: payload.subscriptionId,
      action: 'reinstate',
      status: 'success',
      request_payload: payload,
      processed_at: new Date().toISOString(),
    });

    // Update marketplace operation status
    await updateMarketplaceOperationStatus(
      payload.subscriptionId,
      payload.operationId,
      'Success'
    );

    return { success: true };
  } catch (error) {
    console.error(`[Reinstate] Error: ${error.message}`);

    try {
      await supabase.from('marketplace_events').insert({
        marketplace_subscription_id: payload.subscriptionId,
        action: 'reinstate',
        status: 'failure',
        request_payload: payload,
        error_message: error.message,
      });

      await updateMarketplaceOperationStatus(
        payload.subscriptionId,
        payload.operationId,
        'Failure'
      );
    } catch (e) {
      console.error('Failed to log/update status:', e);
    }

    return { success: false, error: error.message };
  }
}

// Handler for Unsubscribe action
async function handleUnsubscribe(
  supabase: any,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[Unsubscribe] Processing subscription ${payload.subscriptionId}`);

    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        marketplace_status: 'Unsubscribed',
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('marketplace_subscription_id', payload.subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: payload.subscriptionId,
      action: 'unsubscribe',
      status: 'success',
      request_payload: payload,
      processed_at: new Date().toISOString(),
    });

    // Update marketplace operation status
    await updateMarketplaceOperationStatus(
      payload.subscriptionId,
      payload.operationId,
      'Success'
    );

    return { success: true };
  } catch (error) {
    console.error(`[Unsubscribe] Error: ${error.message}`);

    try {
      await supabase.from('marketplace_events').insert({
        marketplace_subscription_id: payload.subscriptionId,
        action: 'unsubscribe',
        status: 'failure',
        request_payload: payload,
        error_message: error.message,
      });

      await updateMarketplaceOperationStatus(
        payload.subscriptionId,
        payload.operationId,
        'Failure'
      );
    } catch (e) {
      console.error('Failed to log/update status:', e);
    }

    return { success: false, error: error.message };
  }
}

// Handler for Renew action
async function handleRenew(
  supabase: any,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[Renew] Processing subscription ${payload.subscriptionId}`);

    // Calculate new period end (30 days from now for monthly subscriptions)
    const newPeriodEnd = new Date();
    newPeriodEnd.setDate(newPeriodEnd.getDate() + 30);

    const { error: updateError } = await supabase
      .from('billing_subscriptions')
      .update({
        current_period_start: new Date().toISOString(),
        current_period_end: newPeriodEnd.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('marketplace_subscription_id', payload.subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log event
    await supabase.from('marketplace_events').insert({
      marketplace_subscription_id: payload.subscriptionId,
      action: 'renew',
      status: 'success',
      request_payload: payload,
      response_payload: { new_period_end: newPeriodEnd.toISOString() },
      processed_at: new Date().toISOString(),
    });

    // Update marketplace operation status
    await updateMarketplaceOperationStatus(
      payload.subscriptionId,
      payload.operationId,
      'Success'
    );

    return { success: true };
  } catch (error) {
    console.error(`[Renew] Error: ${error.message}`);

    try {
      await supabase.from('marketplace_events').insert({
        marketplace_subscription_id: payload.subscriptionId,
        action: 'renew',
        status: 'failure',
        request_payload: payload,
        error_message: error.message,
      });

      await updateMarketplaceOperationStatus(
        payload.subscriptionId,
        payload.operationId,
        'Failure'
      );
    } catch (e) {
      console.error('Failed to log/update status:', e);
    }

    return { success: false, error: error.message };
  }
}

// Main handler
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const payload: WebhookPayload = await req.json();

    // Validate required fields
    if (!payload.subscriptionId || !payload.action || !payload.operationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: subscriptionId, action, operationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let result: { success: boolean; error?: string };

    // Route to appropriate handler
    switch (payload.action) {
      case 'ChangePlan':
        result = await handleChangePlan(supabase, payload);
        break;
      case 'ChangeQuantity':
        result = await handleChangeQuantity(supabase, payload);
        break;
      case 'Suspend':
        result = await handleSuspend(supabase, payload);
        break;
      case 'Reinstate':
        result = await handleReinstate(supabase, payload);
        break;
      case 'Unsubscribe':
        result = await handleUnsubscribe(supabase, payload);
        break;
      case 'Renew':
        result = await handleRenew(supabase, payload);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${payload.action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    if (result.success) {
      return new Response(
        JSON.stringify({ success: true, action: payload.action, subscriptionId: payload.subscriptionId }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Webhook error:', error);

    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
