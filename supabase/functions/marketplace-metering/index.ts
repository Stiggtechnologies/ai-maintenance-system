import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS headers matching existing pattern
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Types
interface UsageEvent {
  subscriptionId: string;
  dimension: string;
  quantity: number;
  effectiveStartTime: string;
  planId?: string;
}

interface BatchUsageEvent {
  subscriptionId: string;
  dimension: string;
  quantity: number;
  effectiveStartTime: string;
  planId?: string;
  usageEventId?: string;
}

interface AzureAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface AzureMeteringResponse {
  usageEventId: string;
  dimension: string;
  effectiveStartTime: string;
  quantity: number;
  status: 'Accepted' | 'Duplicate' | 'BadArgument' | 'BadArgument_Conflict' | 'NotFound' | 'Conflict' | 'Gone';
  messageTime?: string;
  statusCode: number;
}

// Helper: Get Azure AD access token
async function getMarketplaceAccessToken(): Promise<string> {
  const clientId = Deno.env.get('AZURE_AD_CLIENT_ID');
  const clientSecret = Deno.env.get('AZURE_AD_CLIENT_SECRET');
  const tenantId = Deno.env.get('AZURE_AD_TENANT_ID');

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Missing Azure AD credentials');
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

// Helper: Submit single usage event to Azure
async function submitUsageEvent(
  accessToken: string,
  event: UsageEvent
): Promise<AzureMeteringResponse> {
  const meteringUrl = 'https://marketplaceapi.microsoft.com/api/usageEvents?api-version=2018-08-31';

  const payload = {
    subscriptionId: event.subscriptionId,
    dimension: event.dimension,
    quantity: event.quantity,
    effectiveStartTime: event.effectiveStartTime,
    ...(event.planId && { planId: event.planId }),
  };

  const response = await fetch(meteringUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json() as AzureMeteringResponse;
  data.statusCode = response.status;

  if (!response.ok) {
    console.error(`Usage event submission failed: ${response.status}`, data);
  }

  return data;
}

// Helper: Submit batch usage events to Azure
async function submitBatchUsageEvents(
  accessToken: string,
  events: BatchUsageEvent[]
): Promise<AzureMeteringResponse[]> {
  const batchUrl = 'https://marketplaceapi.microsoft.com/api/batchUsageEvents?api-version=2018-08-31';

  const payload = {
    request: events.map((e) => ({
      subscriptionId: e.subscriptionId,
      dimension: e.dimension,
      quantity: e.quantity,
      effectiveStartTime: e.effectiveStartTime,
      ...(e.planId && { planId: e.planId }),
    })),
  };

  const response = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Batch submission failed: ${response.status} ${error}`);
  }

  const data = await response.json();

  // Azure returns array of responses
  return data.result || data || [];
}

// Handler: Submit single usage event
async function handleSingleUsageEvent(
  supabase: any,
  event: UsageEvent
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    console.log(`[SingleUsage] Submitting usage: ${event.subscriptionId} / ${event.dimension} / ${event.quantity}`);

    const accessToken = await getMarketplaceAccessToken();

    // Submit to Azure
    const azureResponse = await submitUsageEvent(accessToken, event);

    console.log(`[SingleUsage] Azure response status: ${azureResponse.status}`);

    // Store in database
    const recordStatus =
      azureResponse.status === 'Accepted' ? 'accepted' :
      azureResponse.status === 'Duplicate' ? 'duplicate' :
      azureResponse.status === 'BadArgument' || azureResponse.status === 'BadArgument_Conflict' ? 'rejected' :
      'submitted';

    const { data: record, error: dbError } = await supabase
      .from('marketplace_metering_records')
      .insert({
        marketplace_subscription_id: event.subscriptionId,
        dimension: event.dimension,
        quantity: event.quantity,
        effective_start_time: event.effectiveStartTime,
        plan_id: event.planId,
        status: recordStatus,
        usage_event_id: azureResponse.usageEventId,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (dbError) {
      throw new Error(`Failed to store metering record: ${dbError.message}`);
    }

    return {
      success: azureResponse.status === 'Accepted' || azureResponse.status === 'Duplicate',
      data: {
        usageEventId: azureResponse.usageEventId,
        status: azureResponse.status,
        recordId: record.id,
        dimension: event.dimension,
        quantity: event.quantity,
      },
    };
  } catch (error) {
    console.error(`[SingleUsage] Error: ${error.message}`);

    return { success: false, error: error.message };
  }
}

// Handler: Submit batch usage events
async function handleBatchUsageEvents(
  supabase: any,
  events: BatchUsageEvent[]
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    console.log(`[BatchUsage] Submitting ${events.length} usage events`);

    const accessToken = await getMarketplaceAccessToken();

    // Submit to Azure
    const azureResponses = await submitBatchUsageEvents(accessToken, events);

    console.log(`[BatchUsage] Received ${azureResponses.length} responses from Azure`);

    // Store results in database
    const recordsToInsert = azureResponses.map((response, idx) => {
      const event = events[idx] || events[0];
      const recordStatus =
        response.status === 'Accepted' ? 'accepted' :
        response.status === 'Duplicate' ? 'duplicate' :
        response.status === 'BadArgument' || response.status === 'BadArgument_Conflict' ? 'rejected' :
        'submitted';

      return {
        marketplace_subscription_id: event.subscriptionId,
        dimension: event.dimension,
        quantity: event.quantity,
        effective_start_time: event.effectiveStartTime,
        plan_id: event.planId,
        status: recordStatus,
        usage_event_id: response.usageEventId,
        submitted_at: new Date().toISOString(),
      };
    });

    const { data: records, error: dbError } = await supabase
      .from('marketplace_metering_records')
      .insert(recordsToInsert)
      .select();

    if (dbError) {
      console.error(`Failed to store metering records: ${dbError.message}`);
      // Don't fail - Azure accepted them
    }

    const acceptedCount = azureResponses.filter((r) => r.status === 'Accepted').length;
    const duplicateCount = azureResponses.filter((r) => r.status === 'Duplicate').length;

    return {
      success: true,
      data: {
        submitted: azureResponses.length,
        accepted: acceptedCount,
        duplicate: duplicateCount,
        responses: azureResponses.map((r) => ({
          usageEventId: r.usageEventId,
          status: r.status,
        })),
      },
    };
  } catch (error) {
    console.error(`[BatchUsage] Error: ${error.message}`);

    return { success: false, error: error.message };
  }
}

// Handler: Process pending metering records
async function handleProcessPendingMetering(
  supabase: any
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    console.log('[ProcessPending] Fetching pending metering records');

    // Get pending records
    const { data: pendingRecords, error: fetchError } = await supabase
      .from('marketplace_metering_records')
      .select('id, marketplace_subscription_id, dimension, quantity, effective_start_time, plan_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100);

    if (fetchError) {
      throw new Error(`Failed to fetch pending records: ${fetchError.message}`);
    }

    if (!pendingRecords || pendingRecords.length === 0) {
      console.log('[ProcessPending] No pending records found');
      return {
        success: true,
        data: { submitted: 0, processed: 0 },
      };
    }

    console.log(`[ProcessPending] Found ${pendingRecords.length} pending records`);

    const accessToken = await getMarketplaceAccessToken();

    // Convert to batch format
    const batchEvents: BatchUsageEvent[] = pendingRecords.map((r) => ({
      subscriptionId: r.marketplace_subscription_id,
      dimension: r.dimension,
      quantity: r.quantity,
      effectiveStartTime: r.effective_start_time,
      planId: r.plan_id,
      usageEventId: r.id,
    }));

    // Submit batch
    const azureResponses = await submitBatchUsageEvents(accessToken, batchEvents);

    console.log(`[ProcessPending] Received ${azureResponses.length} responses from Azure`);

    // Update database with results
    let successCount = 0;
    let duplicateCount = 0;
    let failureCount = 0;

    for (let i = 0; i < azureResponses.length; i++) {
      const response = azureResponses[i];
      const record = pendingRecords[i];

      let newStatus = 'submitted';
      if (response.status === 'Accepted') {
        newStatus = 'accepted';
        successCount++;
      } else if (response.status === 'Duplicate') {
        newStatus = 'duplicate';
        duplicateCount++;
      } else if (response.status === 'BadArgument' || response.status === 'BadArgument_Conflict') {
        newStatus = 'rejected';
        failureCount++;
      } else {
        failureCount++;
      }

      const { error: updateError } = await supabase
        .from('marketplace_metering_records')
        .update({
          status: newStatus,
          usage_event_id: response.usageEventId,
          submitted_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (updateError) {
        console.warn(`Failed to update record ${record.id}: ${updateError.message}`);
      }
    }

    return {
      success: true,
      data: {
        processed: pendingRecords.length,
        accepted: successCount,
        duplicate: duplicateCount,
        rejected: failureCount,
      },
    };
  } catch (error) {
    console.error(`[ProcessPending] Error: ${error.message}`);

    return { success: false, error: error.message };
  }
}

// Main handler
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let result: { success: boolean; data?: any; error?: string };

    if (req.method === 'POST') {
      const body = await req.json();

      if (pathname.includes('/batch')) {
        // Batch submission
        if (!Array.isArray(body.events)) {
          return new Response(
            JSON.stringify({ error: 'Expected events array' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        result = await handleBatchUsageEvents(supabase, body.events);
      } else {
        // Single event submission
        if (!body.subscriptionId || !body.dimension || body.quantity === undefined || !body.effectiveStartTime) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: subscriptionId, dimension, quantity, effectiveStartTime' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        result = await handleSingleUsageEvent(supabase, body as UsageEvent);
      }
    } else if (req.method === 'GET') {
      // Process pending records
      result = await handleProcessPendingMetering(supabase);
    } else {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (result.success) {
      return new Response(
        JSON.stringify({ success: true, data: result.data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Handler error:', error);

    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
