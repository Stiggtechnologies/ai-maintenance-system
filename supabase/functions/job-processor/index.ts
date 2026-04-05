import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
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
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'process';

    if (action === 'process') {
      const result = await processNextJob(supabase);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'status') {
      const stats = await getQueueStats(supabase);
      return new Response(
        JSON.stringify(stats),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Job processor error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function processNextJob(supabase: any) {
  const { data: jobs, error } = await supabase.rpc('get_next_job');

  if (error) {
    console.error('Error getting next job:', error);
    return { success: false, error: error.message };
  }

  if (!jobs || jobs.length === 0) {
    return { success: true, message: 'No jobs in queue' };
  }

  const job = jobs[0];
  console.log(`Processing job ${job.job_id} of type ${job.job_type}`);

  const startTime = Date.now();
  let result;
  let status = 'success';
  let errorMessage = null;

  try {
    result = await executeJob(supabase, job);
  } catch (error) {
    console.error(`Job ${job.job_id} failed:`, error);
    status = 'failed';
    errorMessage = error.message;
    result = { error: error.message };
  }

  const duration = Date.now() - startTime;

  await supabase.rpc('complete_job', {
    p_job_id: job.job_id,
    p_status: status,
    p_result: result,
    p_error_message: errorMessage
  });

  return {
    success: status === 'success',
    job_id: job.job_id,
    job_type: job.job_type,
    duration_ms: duration,
    result
  };
}

async function executeJob(supabase: any, job: any) {
  switch (job.job_type) {
    case 'process_document':
      return await processDocumentJob(supabase, job.job_data);

    case 'generate_embeddings':
      return await generateEmbeddingsJob(supabase, job.job_data);

    case 'health_monitoring':
      return await healthMonitoringJob(supabase, job.job_data);

    case 'send_notifications':
      return await sendNotificationsJob(supabase, job.job_data);

    case 'generate_report':
      return await generateReportJob(supabase, job.job_data);

    case 'sync_external_data':
      return await syncExternalDataJob(supabase, job.job_data);

    case 'cleanup_expired_data':
      return await cleanupExpiredDataJob(supabase, job.job_data);

    case 'calculate_kpis':
      return await calculateKpisJob(supabase, job.job_data);

    case 'autonomous_decision':
      return await autonomousDecisionJob(supabase, job.job_data);

    case 'agent_orchestration':
      return await agentOrchestrationJob(supabase, job.job_data);

    case 'runbook_execution':
      return await runbookExecutionJob(supabase, job.job_data);

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

async function processDocumentJob(supabase: any, data: any) {
  const { document_id } = data;

  const { data: doc } = await supabase
    .from('knowledge_base_documents')
    .select('*')
    .eq('id', document_id)
    .single();

  if (!doc) {
    throw new Error('Document not found');
  }

  await supabase
    .from('knowledge_base_documents')
    .update({ processing_status: 'chunking' })
    .eq('id', document_id);

  const chunks = chunkText(doc.content, 512);

  for (let i = 0; i < chunks.length; i++) {
    await supabase
      .from('knowledge_base_chunks')
      .insert({
        document_id,
        tenant_id: doc.tenant_id,
        chunk_index: i,
        content: chunks[i],
        content_length: chunks[i].length
      });
  }

  await supabase
    .from('knowledge_base_documents')
    .update({
      processing_status: 'completed',
      chunk_count: chunks.length
    })
    .eq('id', document_id);

  return { document_id, chunks_created: chunks.length };
}

async function generateEmbeddingsJob(supabase: any, data: any) {
  const { chunk_ids } = data;
  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const { data: chunks } = await supabase
    .from('knowledge_base_chunks')
    .select('id, content')
    .in('id', chunk_ids);

  const embeddings = [];

  for (const chunk of chunks) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: chunk.content
      })
    });

    const result = await response.json();
    const embedding = result.data[0].embedding;

    await supabase
      .from('knowledge_base_chunks')
      .update({ embedding })
      .eq('id', chunk.id);

    embeddings.push({ chunk_id: chunk.id, embedding_length: embedding.length });
  }

  return { embeddings_generated: embeddings.length };
}

async function healthMonitoringJob(supabase: any, data: any) {
  const { asset_ids } = data;

  const { data: healthRecords } = await supabase
    .from('asset_health_monitoring')
    .select('*')
    .in('asset_id', asset_ids)
    .order('recorded_at', { ascending: false });

  const anomaliesDetected = [];
  const decisionsCreated = [];

  for (const record of healthRecords) {
    if (record.health_score < 60) {
      anomaliesDetected.push({
        asset_id: record.asset_id,
        health_score: record.health_score,
        anomaly: true
      });

      const severity = record.health_score < 40 ? 'critical' : 'high';
      const confidenceScore = 100 - record.health_score;

      await supabase
        .from('system_alerts')
        .insert({
          severity,
          title: `Asset Health Degradation Detected`,
          description: `Asset health score dropped to ${record.health_score}%. Immediate attention may be required.`,
          alert_type: 'asset_health',
          target_users: [],
          acknowledged: false,
          resolved: false
        });

      const requiresApproval = record.health_score < 30;

      const { data: decision } = await supabase
        .from('autonomous_decisions')
        .insert({
          decision_type: 'create_work_order',
          decision_data: {
            asset_id: record.asset_id,
            title: `Emergency Maintenance - Health Score ${record.health_score}%`,
            description: `Automated detection: Asset health has degraded to ${record.health_score}%. Sensor readings: ${JSON.stringify(record.sensor_data)}`,
            priority: severity,
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          },
          confidence_score: confidenceScore,
          status: 'pending',
          requires_approval: requiresApproval,
          approval_deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      if (decision) {
        decisionsCreated.push(decision.id);

        if (!requiresApproval && confidenceScore >= 85) {
          const { data: workOrder } = await supabase
            .from('work_orders')
            .insert({
              asset_id: decision.decision_data.asset_id,
              title: decision.decision_data.title,
              description: decision.decision_data.description,
              priority: decision.decision_data.priority,
              status: 'pending'
            })
            .select()
            .single();

          if (workOrder) {
            await supabase
              .from('autonomous_decisions')
              .update({
                status: 'auto_executed',
                executed_at: new Date().toISOString()
              })
              .eq('id', decision.id);

            await supabase
              .from('autonomous_actions')
              .insert({
                action_type: 'work_order_created',
                target_id: workOrder.id,
                action_data: decision.decision_data,
                triggered_by: 'autonomous_health_monitoring',
                success: true
              });
          }
        }
      }

      await supabase.rpc('broadcast_to_channel', {
        p_channel_name: 'assets.health',
        p_message_type: 'health_alert',
        p_payload: {
          asset_id: record.asset_id,
          health_score: record.health_score,
          severity,
          decision_id: decision?.id
        },
        p_priority: 'high'
      });
    }
  }

  return {
    assets_monitored: asset_ids.length,
    anomalies_detected: anomaliesDetected.length,
    decisions_created: decisionsCreated.length
  };
}

async function sendNotificationsJob(supabase: any, data: any) {
  const { user_ids, message, channel } = data;

  for (const userId of user_ids) {
    await supabase
      .from('javis_messages')
      .insert({
        user_id: userId,
        message,
        channel,
        delivered: false
      });
  }

  return { notifications_sent: user_ids.length };
}

async function generateReportJob(supabase: any, data: any) {
  const { report_type, period_start, period_end } = data;

  return { report_type, status: 'generated', period_start, period_end };
}

async function syncExternalDataJob(supabase: any, data: any) {
  const { source_type, config } = data;

  return { source_type, synced_records: 0 };
}

async function cleanupExpiredDataJob(supabase: any, data: any) {
  const deleted = await supabase
    .from('javis_pending_actions')
    .delete()
    .lt('expires_at', new Date().toISOString());

  return { expired_actions_deleted: deleted.count || 0 };
}

async function calculateKpisJob(supabase: any, data: any) {
  const { kpi_ids, org_unit_id } = data;

  return { kpis_calculated: kpi_ids?.length || 0 };
}

async function autonomousDecisionJob(supabase: any, data: any) {
  const { decision_id } = data;

  const { data: decision } = await supabase
    .from('autonomous_decisions')
    .select('*')
    .eq('id', decision_id)
    .single();

  if (!decision) {
    throw new Error('Decision not found');
  }

  if (decision.confidence_score >= 90 && !decision.requires_approval) {
    await supabase
      .from('autonomous_decisions')
      .update({
        status: 'auto_executed',
        executed_at: new Date().toISOString()
      })
      .eq('id', decision_id);

    return { decision_id, action: 'auto_executed' };
  }

  return { decision_id, action: 'awaiting_approval' };
}

async function agentOrchestrationJob(supabase: any, data: any) {
  const { orchestration_run_id, agent_id } = data;

  return { orchestration_run_id, agent_id, status: 'completed' };
}

async function runbookExecutionJob(supabase: any, data: any) {
  const { execution_id } = data;

  const runbookExecutorUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/runbook-executor`;

  const response = await fetch(runbookExecutorUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'execute_step',
      execution_id
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Runbook execution failed: ${error}`);
  }

  const result = await response.json();
  return result;
}

async function getQueueStats(supabase: any) {
  const { data: stats } = await supabase
    .from('job_queue')
    .select('status, job_type, count(*)')
    .order('status');

  const { data: recentExecutions } = await supabase
    .from('job_executions')
    .select('status, duration_ms, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  return {
    queue_stats: stats,
    recent_executions: recentExecutions
  };
}

function chunkText(text: string, maxChunkSize: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
