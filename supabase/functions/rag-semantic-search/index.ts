import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

async function generateEmbedding(text: string, openaiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const {
      query,
      tenant_id,
      user_id,
      match_threshold = 0.7,
      match_count = 5,
      document_types,
      categories,
    } = body;

    if (!query || !tenant_id) {
      throw new Error('Missing query or tenant_id');
    }

    const startTime = Date.now();

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query, openaiKey);

    // Semantic search using pgvector
    const { data: results, error: searchError } = await supabase.rpc(
      'search_knowledge_base',
      {
        query_embedding: JSON.stringify(queryEmbedding),
        query_text: query,
        match_threshold,
        match_count,
        target_tenant_id: tenant_id,
      }
    );

    if (searchError) {
      throw searchError;
    }

    const retrievalTime = Date.now() - startTime;

    // Filter by document types and categories if specified
    let filteredResults = results || [];
    if (document_types && document_types.length > 0) {
      filteredResults = filteredResults.filter((r: any) =>
        document_types.includes(r.document_type)
      );
    }

    // Log search for analytics
    await supabase.from('rag_search_logs').insert({
      tenant_id,
      user_id,
      query_text: query,
      query_embedding: JSON.stringify(queryEmbedding),
      retrieved_chunk_ids: filteredResults.map((r: any) => r.chunk_id),
      similarity_scores: filteredResults.map((r: any) => r.similarity),
      retrieval_method: 'cosine',
      retrieval_time_ms: retrievalTime,
      num_results: filteredResults.length,
    });

    // Update chunk retrieval stats
    for (const result of filteredResults) {
      await supabase.rpc('update_chunk_retrieval_stats', {
        chunk_id: result.chunk_id,
        relevance_score: result.similarity,
      });
    }

    return new Response(
      JSON.stringify({
        results: filteredResults,
        retrieval_time_ms: retrievalTime,
        query_embedding_size: queryEmbedding.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Semantic search error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});