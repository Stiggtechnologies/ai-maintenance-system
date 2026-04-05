import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface NodeRegistration {
  node_name: string;
  node_type?: string;
  deployment_mode?: string;
  capabilities?: any[];
  version?: string;
  ip_address?: string;
  hostname?: string;
  org_unit_id?: string;
}

interface Heartbeat {
  node_id: string;
  status?: any;
  latency_ms?: number;
  active_jobs?: number;
  queued_jobs?: number;
  errors_since_last?: number;
}

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

    const url = new URL(req.url);
    const path = url.pathname.split('/').filter(Boolean);
    const action = url.searchParams.get('action') || path[path.length - 1];

    switch (action) {
      case 'register': {
        const registration: NodeRegistration = await req.json();

        const { data: existingNode } = await supabase
          .from('edge_nodes')
          .select('id, status')
          .eq('node_name', registration.node_name)
          .maybeSingle();

        let nodeData;
        if (existingNode) {
          const { data, error } = await supabase
            .from('edge_nodes')
            .update({
              ...registration,
              status: 'online',
              last_heartbeat: new Date().toISOString(),
            })
            .eq('id', existingNode.id)
            .select()
            .single();

          if (error) throw error;
          nodeData = data;
        } else {
          const { data, error } = await supabase
            .from('edge_nodes')
            .insert({
              ...registration,
              status: 'online',
              last_heartbeat: new Date().toISOString(),
            })
            .select()
            .single();

          if (error) throw error;
          nodeData = data;
        }

        if (registration.capabilities && registration.capabilities.length > 0) {
          await supabase
            .from('edge_node_capabilities')
            .delete()
            .eq('node_id', nodeData.id);

          const capabilitiesData = registration.capabilities.map((cap: any) => ({
            node_id: nodeData.id,
            capability_type: cap.type || 'generic',
            capability_name: cap.name,
            capability_version: cap.version,
            enabled: cap.enabled !== false,
            config: cap.config || {},
          }));

          await supabase
            .from('edge_node_capabilities')
            .insert(capabilitiesData);
        }

        return new Response(
          JSON.stringify({ success: true, node: nodeData }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'heartbeat': {
        const heartbeat: Heartbeat = await req.json();

        const { error } = await supabase
          .from('edge_node_heartbeats')
          .insert({
            node_id: heartbeat.node_id,
            status: heartbeat.status || {},
            latency_ms: heartbeat.latency_ms,
            active_jobs: heartbeat.active_jobs || 0,
            queued_jobs: heartbeat.queued_jobs || 0,
            errors_since_last: heartbeat.errors_since_last || 0,
          });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, message: 'Heartbeat recorded' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list': {
        const { data: nodes, error } = await supabase
          .from('edge_nodes')
          .select('*')
          .order('registered_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ nodes }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'status': {
        const nodeId = url.searchParams.get('node_id');
        if (!nodeId) {
          throw new Error('node_id parameter required');
        }

        const { data: node, error: nodeError } = await supabase
          .from('edge_nodes')
          .select('*')
          .eq('id', nodeId)
          .single();

        if (nodeError) throw nodeError;

        const { data: recentHeartbeats, error: heartbeatError } = await supabase
          .from('edge_node_heartbeats')
          .select('*')
          .eq('node_id', nodeId)
          .order('heartbeat_at', { ascending: false })
          .limit(10);

        if (heartbeatError) throw heartbeatError;

        const { data: capabilities, error: capError } = await supabase
          .from('edge_node_capabilities')
          .select('*')
          .eq('node_id', nodeId);

        if (capError) throw capError;

        const { data: queueStats, error: queueError } = await supabase
          .from('edge_node_queue')
          .select('status')
          .eq('node_id', nodeId);

        const queueSummary = queueStats?.reduce((acc: any, item: any) => {
          acc[item.status] = (acc[item.status] || 0) + 1;
          return acc;
        }, {}) || {};

        return new Response(
          JSON.stringify({
            node,
            recent_heartbeats: recentHeartbeats,
            capabilities,
            queue_summary: queueSummary,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'decommission': {
        const nodeId = url.searchParams.get('node_id');
        if (!nodeId) {
          throw new Error('node_id parameter required');
        }

        const { error } = await supabase
          .from('edge_nodes')
          .update({ status: 'decommissioned' })
          .eq('id', nodeId);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, message: 'Node decommissioned' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'stale': {
        const { data, error } = await supabase
          .rpc('detect_stale_edge_nodes');

        if (error) throw error;

        return new Response(
          JSON.stringify({ stale_nodes: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'mark_offline': {
        const { data, error } = await supabase
          .rpc('mark_stale_nodes_offline');

        if (error) throw error;

        return new Response(
          JSON.stringify({ nodes_marked_offline: data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: 'Invalid action',
            available_actions: ['register', 'heartbeat', 'list', 'status', 'decommission', 'stale', 'mark_offline'],
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
