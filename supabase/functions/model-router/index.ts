import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { user_id, task_type, task_complexity, data_sensitivity, messages, max_cost } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const complexity = task_complexity || analyzeTaskComplexity(task_type, messages);
    const sensitivity = data_sensitivity || 'internal';

    const { data: modelSelection, error } = await supabase.rpc('select_model_for_task', {
      p_user_id: user_id,
      p_task_complexity: complexity,
      p_data_sensitivity: sensitivity,
      p_max_cost: max_cost
    });

    if (error) throw error;

    if (!modelSelection || modelSelection.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No suitable model found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const selectedModel = modelSelection[0];

    const { data: session } = await supabase
      .from('runtime_sessions')
      .insert({
        user_id,
        session_type: task_type || 'general',
        selected_model: selectedModel.model_name,
        selection_reason: selectedModel.selection_reason,
        task_complexity: complexity,
        data_sensitivity: sensitivity
      })
      .select()
      .single();

    const apiResponse = await callModelAPI(
      selectedModel.model_name,
      selectedModel.model_provider,
      messages,
      task_type
    );

    if (session) {
      await supabase
        .from('runtime_sessions')
        .update({
          total_tokens: apiResponse.usage?.total_tokens || 0,
          total_cost: calculateCost(selectedModel.model_name, apiResponse.usage),
          ended_at: new Date().toISOString()
        })
        .eq('id', session.id);
    }

    return new Response(
      JSON.stringify({
        model: selectedModel.model_name,
        provider: selectedModel.model_provider,
        reason: selectedModel.selection_reason,
        response: apiResponse.response,
        usage: apiResponse.usage,
        session_id: session?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Model router error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function analyzeTaskComplexity(taskType: string, messages: any[]): string {
  const lastMessage = messages?.[messages.length - 1]?.content || '';
  const messageLength = lastMessage.length;

  if (taskType === 'root_cause_analysis' || taskType === 'strategic_planning') {
    return 'reasoning';
  }

  if (taskType === 'code_generation' || taskType === 'technical_analysis') {
    return 'high';
  }

  if (messageLength > 2000 || taskType === 'document_analysis') {
    return 'high';
  }

  if (taskType === 'classification' || taskType === 'simple_qa') {
    return 'low';
  }

  if (messageLength < 200) {
    return 'low';
  }

  return 'medium';
}

async function callModelAPI(modelName: string, provider: string, messages: any[], taskType?: string) {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

  if (provider === 'openai') {
    if (!openaiKey) throw new Error('OpenAI API key not configured');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages || [{ role: 'user', content: 'Hello' }],
        temperature: modelName.includes('o1') ? 1 : 0.7,
        max_completion_tokens: 2000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      response: data.choices[0].message.content,
      usage: data.usage
    };
  }

  if (provider === 'anthropic') {
    if (!anthropicKey) throw new Error('Anthropic API key not configured');

    const systemMessage = messages.find((m: any) => m.role === 'system');
    const userMessages = messages.filter((m: any) => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 2000,
        system: systemMessage?.content,
        messages: userMessages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    return {
      response: data.content[0].text,
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens
      }
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function calculateCost(modelName: string, usage: any): number {
  if (!usage) return 0;

  const costMap: { [key: string]: { input: number; output: number } } = {
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'o1': { input: 0.015, output: 0.06 },
    'o1-mini': { input: 0.003, output: 0.012 },
    'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku': { input: 0.0008, output: 0.004 }
  };

  const costs = costMap[modelName] || { input: 0.001, output: 0.002 };

  const inputCost = (usage.prompt_tokens / 1000) * costs.input;
  const outputCost = (usage.completion_tokens / 1000) * costs.output;

  return inputCost + outputCost;
}
