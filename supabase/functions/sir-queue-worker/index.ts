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

    const { queue_name = 'default', limit = 5 } = await req.json();

    const { data: tasks, error } = await supabase
      .from('sir_queue')
      .select('*')
      .eq('queue_name', queue_name)
      .eq('status', 'queued')
      .lte('next_run_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    const results: any[] = [];

    for (const task of tasks || []) {
      try {
        await supabase
          .from('sir_queue')
          .update({ status: 'processing' })
          .eq('id', task.id);

        const payload = task.payload || {};

        if (payload.type === 'notify') {
          await supabase
            .from('sir_notifications')
            .insert({
              tenant_id: task.tenant_id,
              channel: payload.channel || 'internal',
              target: payload.target || 'system',
              message: payload.message || ''
            });
        }

        await supabase
          .from('sir_queue')
          .update({ status: 'done' })
          .eq('id', task.id);

        results.push({ id: task.id, status: 'done' });
      } catch (err) {
        const attempts = (task.attempts || 0) + 1;
        const backoffMinutes = Math.min(60, attempts * 5);
        const nextRun = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

        await supabase
          .from('sir_queue')
          .update({
            status: attempts >= 3 ? 'failed' : 'queued',
            attempts,
            next_run_at: nextRun
          })
          .eq('id', task.id);

        results.push({ id: task.id, status: 'failed', error: String(err) });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
