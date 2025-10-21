export async function startAutonomousMonitoring() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase configuration missing');
    return;
  }

  const apiUrl = `${supabaseUrl}/functions/v1/autonomous-orchestrator`;

  const runMonitoring = async () => {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'monitor_assets'
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[Autonomous System]', result);
      }
    } catch (error) {
      console.error('[Autonomous System] Error:', error);
    }
  };

  runMonitoring();

  const interval = setInterval(runMonitoring, 5 * 60 * 1000);

  return () => clearInterval(interval);
}
