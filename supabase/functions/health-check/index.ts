import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: any = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {}
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check database connection
    const dbStart = Date.now();
    const { error: dbError } = await supabase
      .from('assets')
      .select('id')
      .limit(1);

    checks.checks.database = {
      status: dbError ? 'unhealthy' : 'healthy',
      responseTime: Date.now() - dbStart,
      error: dbError?.message
    };

    // Check auth service
    const authStart = Date.now();
    try {
      const { data: { users }, error: authError } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1
      });
      checks.checks.auth = {
        status: authError ? 'unhealthy' : 'healthy',
        responseTime: Date.now() - authStart,
        error: authError?.message
      };
    } catch (e) {
      checks.checks.auth = {
        status: 'unhealthy',
        responseTime: Date.now() - authStart,
        error: e.message
      };
    }

    // Check autonomous system
    const autonomousStart = Date.now();
    const { data: recentDecisions, error: decisionsError } = await supabase
      .from('autonomous_decisions')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);

    checks.checks.autonomous_system = {
      status: decisionsError ? 'unhealthy' : 'healthy',
      responseTime: Date.now() - autonomousStart,
      hasRecentActivity: recentDecisions && recentDecisions.length > 0,
      error: decisionsError?.message
    };

    // Check overall health
    const unhealthyChecks = Object.values(checks.checks).filter(
      (check: any) => check.status === 'unhealthy'
    );

    if (unhealthyChecks.length > 0) {
      checks.status = 'degraded';
    }

    if (unhealthyChecks.length === Object.keys(checks.checks).length) {
      checks.status = 'unhealthy';
    }

    checks.totalResponseTime = Date.now() - startTime;

    const statusCode = checks.status === 'healthy' ? 200 : checks.status === 'degraded' ? 200 : 503;

    return new Response(
      JSON.stringify(checks, null, 2),
      {
        status: statusCode,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  } catch (error) {
    checks.status = 'unhealthy';
    checks.error = error.message;
    checks.totalResponseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify(checks, null, 2),
      {
        status: 503,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  }
});