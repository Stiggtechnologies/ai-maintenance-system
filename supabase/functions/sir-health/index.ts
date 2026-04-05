import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Verify authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; details?: any }> = [];

    const { error: dbError } = await supabase.from('sir_agents').select('id').limit(1);
    checks.push({ name: 'database', status: dbError ? 'error' : 'ok', details: dbError ? dbError.message : {} });

    const { error: memoryError } = await supabase.from('sir_memory').select('id').limit(1);
    checks.push({ name: 'memory_store', status: memoryError ? 'warn' : 'ok', details: memoryError ? memoryError.message : {} });

    for (const c of checks) {
      await supabase.from('sir_health_history').insert({ name: c.name, status: c.status, details: c.details || {} });
    }

    return new Response(JSON.stringify({ status: 'ok', checks }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
