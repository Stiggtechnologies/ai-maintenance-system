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

    const { limit = 10 } = await req.json();

    const { data: notifications, error } = await supabase
      .from('openclaw_notifications')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    const results: any[] = [];

    for (const n of notifications || []) {
      try {
        // Resolve endpoint for channel + target
        const { data: endpoints } = await supabase
          .from('openclaw_notification_endpoints')
          .select('*')
          .eq('channel', n.channel)
          .eq('target', n.target)
          .eq('is_active', true)
          .limit(1);

        const endpoint = endpoints && endpoints[0];
        if (endpoint?.endpoint_url) {
          await fetch(endpoint.endpoint_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(endpoint.headers || {})
            },
            body: JSON.stringify({ message: n.message, channel: n.channel, target: n.target })
          });
        }

        await supabase
          .from('openclaw_notifications')
          .update({ status: 'sent' })
          .eq('id', n.id);

        results.push({ id: n.id, status: 'sent' });
      } catch (err) {
        await supabase
          .from('openclaw_notifications')
          .update({ status: 'failed' })
          .eq('id', n.id);

        results.push({ id: n.id, status: 'failed', error: String(err) });
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
