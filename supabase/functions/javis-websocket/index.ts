import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, Upgrade",
};

interface WebSocketMessage {
  type: 'message' | 'tool_call' | 'confirm' | 'reject' | 'ping';
  content?: string;
  tool_name?: string;
  parameters?: any;
  action_id?: string;
  conversation_id?: string;
}

Deno.serve(async (req: Request) => {
  // Handle WebSocket upgrade
  if (req.headers.get("upgrade") === "websocket") {
    return handleWebSocket(req);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ error: 'This endpoint requires WebSocket connection' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

async function handleWebSocket(req: Request) {
  const { socket, response } = Deno.upgradeWebSocket(req);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(supabaseUrl, supabaseKey);

  let sessionId: string;
  let userId: string;
  let tenantId: string;
  let conversationId: string | null = null;
  let turnNumber = 0;

  socket.onopen = async () => {
    console.log('WebSocket connection opened');
    sessionId = crypto.randomUUID();

    // Send welcome message
    socket.send(JSON.stringify({
      type: 'connected',
      session_id: sessionId,
      message: 'J.A.V.I.S connected. How can I assist you?'
    }));
  };

  socket.onmessage = async (event) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'init':
          // Initialize session with user details
          userId = (message as any).user_id;
          tenantId = (message as any).tenant_id;

          // Register WebSocket session
          await supabase
            .from('javis_websocket_sessions')
            .insert({
              tenant_id: tenantId,
              user_id: userId,
              session_id: sessionId,
              conversation_id: null,
              connected_at: new Date().toISOString()
            });

          socket.send(JSON.stringify({
            type: 'initialized',
            message: 'Session initialized'
          }));
          break;

        case 'message':
          // Handle conversational message
          const response = await handleConversationalMessage(
            supabase,
            openaiKey,
            tenantId,
            userId,
            message.content!,
            conversationId,
            turnNumber
          );

          conversationId = response.conversation_id;
          turnNumber = response.turn_number;

          socket.send(JSON.stringify({
            type: 'response',
            content: response.message,
            tool_calls: response.tool_calls,
            pending_actions: response.pending_actions,
            citations: response.citations,
            conversation_id: conversationId
          }));
          break;

        case 'confirm':
          // Confirm and execute tool
          const executeResult = await confirmAndExecuteTool(
            supabase,
            message.action_id!,
            userId
          );

          socket.send(JSON.stringify({
            type: 'tool_executed',
            result: executeResult,
            message: formatExecutionResult(executeResult)
          }));
          break;

        case 'reject':
          // Cancel pending action
          await supabase
            .from('javis_pending_actions')
            .delete()
            .eq('id', message.action_id!)
            .eq('user_id', userId);

          socket.send(JSON.stringify({
            type: 'action_cancelled',
            message: 'Action cancelled'
          }));
          break;

        case 'ping':
          // Update last activity
          await supabase
            .from('javis_websocket_sessions')
            .update({ last_activity: new Date().toISOString() })
            .eq('session_id', sessionId);

          socket.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          socket.send(JSON.stringify({
            type: 'error',
            message: 'Unknown message type'
          }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  };

  socket.onclose = async () => {
    console.log('WebSocket connection closed');

    // Mark session as disconnected
    if (sessionId) {
      await supabase
        .from('javis_websocket_sessions')
        .update({ disconnected_at: new Date().toISOString() })
        .eq('session_id', sessionId);
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  return response;
}

async function handleConversationalMessage(
  supabase: any,
  openaiKey: string,
  tenantId: string,
  userId: string,
  userMessage: string,
  conversationId: string | null,
  currentTurn: number
) {
  // Create or get conversation
  if (!conversationId) {
    const { data: conv } = await supabase
      .from('javis_conversations')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        session_id: crypto.randomUUID(),
        role_code: 'EXEC',
        started_at: new Date().toISOString()
      })
      .select('id')
      .single();
    conversationId = conv.id;
  }

  const turnNumber = currentTurn + 1;

  // Get conversation context
  const { data: contextData } = await supabase.rpc('get_conversation_context', {
    p_conversation_id: conversationId,
    p_limit: 10
  });

  const context = contextData || [];

  // Get user role
  const { data: roles } = await supabase
    .from('user_role_map')
    .select(`
      role_code,
      roles_raci (
        role_name,
        raci,
        comm_style
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('effective_to', null)
    .limit(1);

  const role = roles?.[0]?.roles_raci || { role_name: 'User', comm_style: { tone: 'helpful' } };

  // Get available tools for user's role
  const { data: tools } = await supabase
    .from('javis_tool_definitions')
    .select('tool_name, tool_description, parameters, requires_confirmation')
    .eq('tenant_id', tenantId)
    .eq('enabled', true)
    .contains('required_role', [role.role_code]);

  // Build messages for OpenAI with function calling
  const messages = [
    {
      role: 'system',
      content: buildSystemPrompt(role, tools, context)
    },
    ...context.map((c: any) => ([
      { role: 'user', content: c.user },
      { role: 'assistant', content: c.assistant }
    ])).flat(),
    {
      role: 'user',
      content: userMessage
    }
  ];

  // Call OpenAI with function calling
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages,
      tools: tools?.map(t => ({
        type: 'function',
        function: {
          name: t.tool_name,
          description: t.tool_description,
          parameters: t.parameters
        }
      })) || [],
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 800
    }),
  });

  const aiData = await openaiResponse.json();
  const aiMessage = aiData.choices?.[0]?.message;
  const toolCalls = aiMessage?.tool_calls || [];

  // Handle tool calls
  const pendingActions = [];
  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const toolParams = JSON.parse(toolCall.function.arguments);

    // Create pending action
    const { data: action } = await supabase
      .from('javis_pending_actions')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        conversation_id: conversationId,
        action_type: toolName,
        action_description: `Execute: ${toolName}`,
        action_payload: toolParams,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    pendingActions.push(action);

    // Create tool execution record
    await supabase
      .from('javis_tool_executions')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        conversation_id: conversationId,
        tool_name: toolName,
        parameters: toolParams,
        status: 'pending'
      });
  }

  const responseText = aiMessage?.content || 'I understand. Let me help with that.';

  // Save conversation state
  await supabase
    .from('javis_conversation_state')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      conversation_id: conversationId,
      turn_number: turnNumber,
      user_message: userMessage,
      assistant_message: responseText,
      tool_calls: toolCalls,
      context_summary: generateContextSummary(userMessage, responseText)
    });

  // Update conversation message count
  await supabase
    .from('javis_conversations')
    .update({
      message_count: supabase.raw('message_count + 1')
    })
    .eq('id', conversationId);

  return {
    conversation_id: conversationId,
    turn_number: turnNumber,
    message: responseText,
    tool_calls: toolCalls.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    })),
    pending_actions: pendingActions,
    citations: []
  };
}

async function confirmAndExecuteTool(supabase: any, actionId: string, userId: string) {
  // Get pending action
  const { data: action } = await supabase
    .from('javis_pending_actions')
    .select('*')
    .eq('id', actionId)
    .eq('user_id', userId)
    .single();

  if (!action) {
    throw new Error('Action not found or expired');
  }

  // Find corresponding tool execution
  const { data: execution } = await supabase
    .from('javis_tool_executions')
    .select('id')
    .eq('conversation_id', action.conversation_id)
    .eq('tool_name', action.action_type)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution) {
    throw new Error('Tool execution not found');
  }

  // Update status to confirmed
  await supabase
    .from('javis_tool_executions')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString()
    })
    .eq('id', execution.id);

  // Execute the tool
  const { data: result, error } = await supabase.rpc('execute_javis_tool', {
    p_execution_id: execution.id
  });

  if (error) throw error;

  // Delete pending action
  await supabase
    .from('javis_pending_actions')
    .delete()
    .eq('id', actionId);

  return result;
}

function buildSystemPrompt(role: any, tools: any[], context: any[]): string {
  return `You are J.A.V.I.S, an intelligent maintenance and reliability assistant.

User role: ${role.role_name}
Communication style: ${JSON.stringify(role.comm_style)}

You have access to these tools:
${tools?.map(t => `- ${t.tool_name}: ${t.tool_description}`).join('\n') || 'No tools available'}

Guidelines:
- Be conversational and natural, like talking to a colleague
- Ask clarifying questions when needed
- Use tools when the user requests actions
- Always confirm before executing tools that modify data
- Keep responses concise (${role.comm_style?.max_items || 5} items max)
- Use ${role.comm_style?.tone || 'professional'} tone

Conversation context: ${context.length} previous turns available.

When the user asks you to do something, use the appropriate tool. Always explain what you're about to do before calling the tool.`;
}

function generateContextSummary(userMsg: string, assistantMsg: string): string {
  return `User: ${userMsg.substring(0, 100)} | Assistant: ${assistantMsg.substring(0, 100)}`;
}

function formatExecutionResult(result: any): string {
  if (result.work_order_id) {
    return `✓ Work order created successfully. ID: WO-${result.work_order_id.substring(0, 8)}. Status: ${result.status}.`;
  }
  if (result.inspection_id) {
    return `✓ Inspection scheduled. ID: INS-${result.inspection_id.substring(0, 8)}. Date: ${new Date(result.scheduled_date).toLocaleString()}.`;
  }
  if (result.success) {
    return `✓ ${result.message || 'Action completed successfully'}.`;
  }
  return `✗ ${result.error || 'Action failed'}.`;
}
