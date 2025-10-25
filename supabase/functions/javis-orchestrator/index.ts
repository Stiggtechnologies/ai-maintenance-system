import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BriefRequest {
  tenant_id: string;
  user_id: string;
  time_of_day?: 'morning' | 'afternoon' | 'evening';
}

interface AskRequest {
  tenant_id: string;
  user_id: string;
  query: string;
  conversation_id?: string;
  context?: any;
}

interface RoleContext {
  role_code: string;
  role_name: string;
  raci: any;
  comm_style: any;
  content_filters: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    switch (path) {
      case 'brief':
        return await handleBrief(req, supabase);
      case 'ask':
        return await handleAsk(req, supabase);
      case 'preferences':
        return await handlePreferences(req, supabase);
      default:
        return new Response(
          JSON.stringify({ error: 'Unknown endpoint' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error in J.A.V.I.S orchestrator:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleBrief(req: Request, supabase: any) {
  const { tenant_id, user_id, time_of_day = 'morning' }: BriefRequest = await req.json();

  // Get user preferences
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('user_id', user_id)
    .maybeSingle();

  // Get user profile for name
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, email')
    .eq('id', user_id)
    .single();

  const displayName = prefs?.display_name || profile?.display_name || profile?.email?.split('@')[0] || 'there';

  // Get user roles
  const { data: roles } = await supabase
    .from('user_role_map')
    .select(`
      role_code,
      roles_raci (
        role_name,
        raci,
        comm_style,
        content_filters
      )
    `)
    .eq('tenant_id', tenant_id)
    .eq('user_id', user_id)
    .is('effective_to', null);

  const primaryRole: RoleContext = roles?.[0]?.roles_raci || {
    role_code: 'EXEC',
    role_name: 'Executive',
    raci: {},
    comm_style: { tone: 'concise', bullets: true, max_items: 5 },
    content_filters: {}
  };

  // Get context from cache or build
  const { data: cachedContext } = await supabase
    .from('javis_context_cache')
    .select('context_data')
    .eq('tenant_id', tenant_id)
    .eq('user_id', user_id)
    .eq('context_type', 'morning_brief')
    .gte('valid_until', new Date().toISOString())
    .maybeSingle();

  let context = cachedContext?.context_data;

  if (!context) {
    context = await buildBriefContext(supabase, tenant_id, user_id, primaryRole);

    // Cache for 5 minutes
    await supabase
      .from('javis_context_cache')
      .upsert({
        tenant_id,
        user_id,
        context_type: 'morning_brief',
        context_data: context,
        valid_until: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      });
  }

  // Generate greeting based on time of day
  const greetings = {
    morning: `Good morning, ${displayName}.`,
    afternoon: `Good afternoon, ${displayName}.`,
    evening: `Good evening, ${displayName}.`
  };

  const greeting = greetings[time_of_day];

  // Generate brief using role-aware prompting
  const brief = await generateRoleAwareBrief(context, primaryRole);

  // Log the interaction
  await supabase.rpc('log_javis_interaction', {
    p_tenant_id: tenant_id,
    p_user_id: user_id,
    p_conversation_id: null,
    p_interaction_type: 'morning_brief',
    p_input: `Brief requested for ${time_of_day}`,
    p_output: JSON.stringify(brief),
    p_citations: brief.citations || []
  });

  // Save message
  await supabase
    .from('javis_messages')
    .insert({
      tenant_id,
      user_id,
      channel: prefs?.prefers_voice ? 'voice' : 'in_app',
      message_type: 'brief',
      message: JSON.stringify({ greeting, brief }),
      citations: brief.citations,
      delivered_at: new Date().toISOString()
    });

  return new Response(
    JSON.stringify({
      greeting,
      brief,
      citations: brief.citations || [],
      audio_url: prefs?.prefers_voice ? await generateTTS(greeting + ' ' + brief.summary, prefs) : null,
      role: primaryRole.role_name
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleAsk(req: Request, supabase: any) {
  const { tenant_id, user_id, query, conversation_id, context }: AskRequest = await req.json();

  // Get or create conversation
  let convId = conversation_id;
  if (!convId) {
    const { data: conv } = await supabase
      .from('javis_conversations')
      .insert({
        tenant_id,
        user_id,
        session_id: crypto.randomUUID(),
        role_code: 'EXEC',
        started_at: new Date().toISOString()
      })
      .select('id')
      .single();
    convId = conv.id;
  }

  // Get user roles
  const { data: roles } = await supabase
    .from('user_role_map')
    .select(`
      role_code,
      roles_raci (
        role_name,
        raci,
        comm_style,
        content_filters
      )
    `)
    .eq('tenant_id', tenant_id)
    .eq('user_id', user_id)
    .is('effective_to', null);

  const primaryRole: RoleContext = roles?.[0]?.roles_raci || {
    role_code: 'EXEC',
    role_name: 'Executive',
    raci: {},
    comm_style: { tone: 'concise' },
    content_filters: {}
  };

  // Search knowledge base if available
  const ragContext = await searchKnowledgeBase(supabase, tenant_id, query);

  // Generate response using OpenAI
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const systemPrompt = buildSystemPrompt(primaryRole, ragContext);

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
        { role: 'user', content: query }
      ],
      temperature: 0.7,
      max_tokens: 800
    }),
  });

  const aiResponse = await response.json();
  const answer = aiResponse.choices?.[0]?.message?.content || 'I apologize, but I could not generate a response.';

  // Log interaction
  await supabase.rpc('log_javis_interaction', {
    p_tenant_id: tenant_id,
    p_user_id: user_id,
    p_conversation_id: convId,
    p_interaction_type: 'question',
    p_input: query,
    p_output: answer,
    p_citations: ragContext.citations || []
  });

  // Update conversation message count
  await supabase
    .from('javis_conversations')
    .update({
      message_count: supabase.raw('message_count + 1')
    })
    .eq('id', convId);

  // Save message
  await supabase
    .from('javis_messages')
    .insert({
      tenant_id,
      user_id,
      conversation_id: convId,
      channel: 'in_app',
      message_type: 'response',
      message: answer,
      citations: ragContext.citations,
      delivered_at: new Date().toISOString()
    });

  return new Response(
    JSON.stringify({
      answer,
      citations: ragContext.citations || [],
      conversation_id: convId,
      actions: extractActions(answer)
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handlePreferences(req: Request, supabase: any) {
  const { tenant_id, user_id, ...preferences } = await req.json();

  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({
      tenant_id,
      user_id,
      ...preferences,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  return new Response(
    JSON.stringify({ ok: true, preferences: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function buildBriefContext(supabase: any, tenant_id: string, user_id: string, role: RoleContext) {
  const context: any = {
    timestamp: new Date().toISOString(),
    role: role.role_code,
  };

  // Get KPIs based on role
  if (role.raci.A?.includes('Availability') || role.raci.R?.includes('Operations')) {
    const { data: kpis } = await supabase
      .from('maintenance_metrics')
      .select('metric_name, metric_value, target_value, recorded_at')
      .eq('tenant_id', tenant_id)
      .in('metric_name', ['availability', 'mtbf', 'mttr', 'oee'])
      .order('recorded_at', { ascending: false })
      .limit(4);
    context.kpis = kpis;
  }

  // Get work orders if planner/tech
  if (['PLANNER', 'TECH', 'OPS_MGR'].includes(role.role_code)) {
    const { data: workOrders } = await supabase
      .from('work_orders')
      .select('id, title, status, priority, due_date')
      .eq('tenant_id', tenant_id)
      .in('status', ['pending', 'in_progress', 'blocked'])
      .order('priority', { ascending: false })
      .limit(5);
    context.workOrders = workOrders;
  }

  // Get alerts for all roles
  const { data: alerts } = await supabase
    .from('system_alerts')
    .select('id, alert_type, severity, message, created_at')
    .eq('tenant_id', tenant_id)
    .eq('resolved', false)
    .gte('severity', role.content_filters?.min_severity || 'medium')
    .order('severity', { ascending: false })
    .limit(3);
  context.alerts = alerts;

  return context;
}

function generateRoleAwareBrief(context: any, role: RoleContext) {
  const sections = [];
  const citations = [];

  // Build sections based on role and available context
  if (context.kpis && context.kpis.length > 0) {
    const kpiItems = context.kpis.map((kpi: any) => {
      const delta = kpi.target_value ? ((kpi.metric_value - kpi.target_value) / kpi.target_value * 100).toFixed(1) : 0;
      const trend = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
      return `${kpi.metric_name.toUpperCase()}: ${kpi.metric_value}% ${trend} (target: ${kpi.target_value}%)`;
    });

    sections.push({
      title: 'Key Performance Indicators',
      items: kpiItems,
      priority: 1
    });
  }

  if (context.alerts && context.alerts.length > 0) {
    const alertItems = context.alerts.map((alert: any) =>
      `${alert.severity.toUpperCase()}: ${alert.message}`
    );

    sections.push({
      title: 'Active Alerts',
      items: alertItems,
      priority: 2
    });
  }

  if (context.workOrders && context.workOrders.length > 0) {
    const woItems = context.workOrders
      .slice(0, role.comm_style.max_items || 5)
      .map((wo: any) =>
        `${wo.priority.toUpperCase()}: ${wo.title} (${wo.status})`
      );

    sections.push({
      title: 'Work Orders Requiring Attention',
      items: woItems,
      priority: 3
    });
  }

  // Generate summary based on comm_style
  const summary = generateSummary(sections, role);

  return {
    summary,
    sections,
    citations,
    metadata: {
      role: role.role_code,
      timestamp: new Date().toISOString()
    }
  };
}

function generateSummary(sections: any[], role: RoleContext): string {
  const itemCount = sections.reduce((sum, s) => sum + s.items.length, 0);

  if (itemCount === 0) {
    return "All systems operational. No action items at this time.";
  }

  let summary = `Here's your ${role.role_name.toLowerCase()} update. `;

  sections.forEach((section, idx) => {
    if (idx > 0) summary += ' ';
    summary += `${section.items.length} ${section.title.toLowerCase()}.`;
  });

  return summary;
}

function buildSystemPrompt(role: RoleContext, ragContext: any): string {
  return `You are J.A.V.I.S, a role-aware maintenance & reliability copilot.

User role: ${role.role_name} (${role.role_code})
RACI: ${JSON.stringify(role.raci)}
Communication style: ${JSON.stringify(role.comm_style)}

Guidelines:
- Use ${role.comm_style.tone} tone
- ${role.comm_style.bullets ? 'Format responses with bullet points' : 'Use natural paragraphs'}
- Focus on ${role.comm_style.focus || 'relevant'} information
- Only provide information the user is responsible for or needs to know
- Cite sources when available
- If data is missing, ask a concise follow-up question

Context from knowledge base:
${ragContext.content || 'No relevant documents found'}

Always be helpful, clear, and action-oriented.`;
}

async function searchKnowledgeBase(supabase: any, tenant_id: string, query: string) {
  try {
    const { data } = await supabase
      .from('knowledge_base_chunks')
      .select('content, document_id, knowledge_base_documents(title)')
      .eq('tenant_id', tenant_id)
      .textSearch('content', query)
      .limit(3);

    if (!data || data.length === 0) {
      return { content: '', citations: [] };
    }

    const content = data.map((d: any) => d.content).join('\n\n');
    const citations = data.map((d: any) => ({
      document_title: d.knowledge_base_documents?.title,
      document_id: d.document_id
    }));

    return { content, citations };
  } catch (error) {
    console.error('Error searching knowledge base:', error);
    return { content: '', citations: [] };
  }
}

function extractActions(text: string): any[] {
  const actions = [];

  // Simple pattern matching for common actions
  if (text.match(/create.*work order/i)) {
    actions.push({ type: 'create_work_order', suggested: true });
  }
  if (text.match(/schedule.*inspection/i)) {
    actions.push({ type: 'schedule_inspection', suggested: true });
  }
  if (text.match(/order.*part/i)) {
    actions.push({ type: 'order_part', suggested: true });
  }

  return actions;
}

async function generateTTS(text: string, prefs: any): Promise<string | null> {
  // Placeholder for TTS generation
  // In production, integrate with Azure Cognitive Services or similar
  // For now, return null to indicate browser-based TTS should be used
  return null;
}
