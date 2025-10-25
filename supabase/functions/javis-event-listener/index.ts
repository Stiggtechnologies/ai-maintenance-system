import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EventPayload {
  event_type: string;
  tenant_id: string;
  event_data: any;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  target_users?: string[];
  target_roles?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    switch (path) {
      case 'ingest':
        return await handleEventIngest(req, supabase, openaiKey);
      case 'process':
        return await processQueuedEvents(supabase, openaiKey);
      default:
        return new Response(
          JSON.stringify({ error: 'Unknown endpoint' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error in J.A.V.I.S event listener:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleEventIngest(req: Request, supabase: any, openaiKey: string) {
  const payload: EventPayload = await req.json();

  // Queue the event
  const { data: eventId, error } = await supabase.rpc('queue_javis_event', {
    p_tenant_id: payload.tenant_id,
    p_event_type: payload.event_type,
    p_event_data: payload.event_data,
    p_priority: payload.priority || 'medium',
    p_target_users: payload.target_users || null,
    p_target_roles: payload.target_roles || null
  });

  if (error) throw error;

  // Process immediately for high/critical priority
  if (payload.priority === 'high' || payload.priority === 'critical') {
    await processEvent(eventId, payload, supabase, openaiKey);
  }

  return new Response(
    JSON.stringify({ success: true, event_id: eventId }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function processQueuedEvents(supabase: any, openaiKey: string) {
  // Get unprocessed events
  const { data: events, error } = await supabase
    .from('javis_event_queue')
    .select('*')
    .eq('processed', false)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) throw error;

  const processed = [];

  for (const event of events) {
    try {
      await processEvent(event.id, event, supabase, openaiKey);
      processed.push(event.id);
    } catch (err) {
      console.error(`Error processing event ${event.id}:`, err);
    }
  }

  return new Response(
    JSON.stringify({ success: true, processed_count: processed.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function processEvent(eventId: string, event: any, supabase: any, openaiKey: string) {
  // Determine target users
  let targetUsers = event.target_users || [];

  if (event.target_roles && event.target_roles.length > 0) {
    const { data: roleUsers } = await supabase
      .from('user_role_map')
      .select('user_id')
      .eq('tenant_id', event.tenant_id)
      .in('role_code', event.target_roles)
      .is('effective_to', null);

    if (roleUsers) {
      targetUsers = [...targetUsers, ...roleUsers.map((u: any) => u.user_id)];
    }
  }

  // Remove duplicates
  targetUsers = [...new Set(targetUsers)];

  // Generate natural language message for each user
  for (const userId of targetUsers) {
    // Get user role and preferences
    const { data: userRoles } = await supabase
      .from('user_role_map')
      .select(`
        role_code,
        roles_raci (
          role_name,
          comm_style
        )
      `)
      .eq('tenant_id', event.tenant_id)
      .eq('user_id', userId)
      .is('effective_to', null)
      .limit(1);

    const role = userRoles?.[0]?.roles_raci || { comm_style: { tone: 'operational' } };

    // Generate message using OpenAI
    const message = await generateEventMessage(event, role, openaiKey);

    // Create pending action if applicable
    let pendingActionId = null;
    if (requiresAction(event.event_type)) {
      const { data: action } = await supabase
        .from('javis_pending_actions')
        .insert({
          tenant_id: event.tenant_id,
          user_id: userId,
          action_type: event.event_type,
          action_description: message,
          action_payload: event.event_data,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        })
        .select('id')
        .single();

      pendingActionId = action?.id;
    }

    // Send message
    await supabase
      .from('javis_messages')
      .insert({
        tenant_id: event.tenant_id,
        user_id: userId,
        channel: 'in_app',
        message_type: 'alert',
        message: message,
        event_meta: {
          event_id: eventId,
          event_type: event.event_type,
          priority: event.priority,
          pending_action_id: pendingActionId
        },
        delivered_at: new Date().toISOString()
      });

    // Push to WebSocket if connected
    await pushToWebSocket(supabase, userId, {
      type: 'event',
      event_type: event.event_type,
      message: message,
      priority: event.priority,
      pending_action_id: pendingActionId,
      actions: getEventActions(event.event_type)
    });
  }

  // Mark event as processed
  await supabase
    .from('javis_event_queue')
    .update({
      processed: true,
      processed_at: new Date().toISOString()
    })
    .eq('id', eventId);
}

async function generateEventMessage(event: any, role: any, openaiKey: string): Promise<string> {
  const systemPrompt = `You are J.A.V.I.S, generating a concise, actionable notification.
Role: ${role.role_name}
Tone: ${role.comm_style?.tone || 'operational'}

Generate a 1-2 sentence notification in natural language, as if speaking to a colleague.
Include specific details and suggest actions when appropriate.`;

  const userPrompt = `Event: ${event.event_type}
Priority: ${event.priority}
Data: ${JSON.stringify(event.event_data, null, 2)}

Generate a natural-language notification.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 150
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || `Event: ${event.event_type}`;
}

function requiresAction(eventType: string): boolean {
  const actionableEvents = [
    'asset_status_changed',
    'kpi_threshold_breached',
    'workorder_blocked',
    'inventory_stockout',
    'safety_incident',
    'approval_required'
  ];
  return actionableEvents.includes(eventType);
}

function getEventActions(eventType: string): string[] {
  const actions: Record<string, string[]> = {
    'asset_status_changed': ['Acknowledge', 'Create WO', 'Show Details', 'Snooze'],
    'kpi_threshold_breached': ['Investigate', 'Approve Action', 'Defer', 'Show Trend'],
    'workorder_blocked': ['Resolve', 'Reassign', 'Escalate', 'Show Details'],
    'inventory_stockout': ['Order Parts', 'Find Alternative', 'Defer', 'Show Usage'],
    'safety_incident': ['Review', 'Assign Investigation', 'Notify HSE', 'Show Report'],
    'approval_required': ['Approve', 'Reject', 'Request More Info', 'Defer']
  };

  return actions[eventType] || ['Acknowledge', 'Show Details'];
}

async function pushToWebSocket(supabase: any, userId: string, payload: any) {
  // Get active WebSocket sessions for user
  const { data: sessions } = await supabase
    .from('javis_websocket_sessions')
    .select('session_id')
    .eq('user_id', userId)
    .is('disconnected_at', null);

  // In production, use a WebSocket broadcast service (Redis Pub/Sub, Supabase Realtime, etc.)
  // For now, we'll store in messages and poll
  console.log('WebSocket push to user:', userId, 'sessions:', sessions?.length);

  // TODO: Implement actual WebSocket push when sessions are available
  // This would use Supabase Realtime or a custom WebSocket server
}
