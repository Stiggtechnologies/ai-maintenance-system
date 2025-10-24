import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ChunkConfig {
  maxChunkSize: number;
  overlapSize: number;
  preserveParagraphs: boolean;
}

function chunkDocument(content: string, config: ChunkConfig): string[] {
  const { maxChunkSize, overlapSize, preserveParagraphs } = config;
  const chunks: string[] = [];

  if (preserveParagraphs) {
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(overlapSize / 5));
        currentChunk = overlapWords.join(' ') + ' ' + para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
  } else {
    for (let i = 0; i < content.length; i += maxChunkSize - overlapSize) {
      chunks.push(content.slice(i, i + maxChunkSize));
    }
  }

  return chunks.filter(c => c.length > 50);
}

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

    const url = new URL(req.url);
    const path = url.pathname.replace('/rag-document-processor', '');

    // POST /process - Process and chunk a document
    if (req.method === 'POST' && path === '/process') {
      const body = await req.json();
      const { document_id, tenant_id } = body;

      if (!document_id || !tenant_id) {
        throw new Error('Missing document_id or tenant_id');
      }

      // Get document
      const { data: doc, error: docError } = await supabase
        .from('knowledge_base_documents')
        .select('*')
        .eq('id', document_id)
        .eq('tenant_id', tenant_id)
        .single();

      if (docError || !doc) {
        throw new Error('Document not found');
      }

      // Update status
      await supabase
        .from('knowledge_base_documents')
        .update({ processing_status: 'chunking' })
        .eq('id', document_id);

      // Chunk document
      const chunks = chunkDocument(doc.content, {
        maxChunkSize: 1000,
        overlapSize: 200,
        preserveParagraphs: true,
      });

      console.log(`Created ${chunks.length} chunks for document ${document_id}`);

      // Update status
      await supabase
        .from('knowledge_base_documents')
        .update({ processing_status: 'embedding' })
        .eq('id', document_id);

      // Generate embeddings and store chunks
      const chunkRecords = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await generateEmbedding(chunk, openaiKey);

        chunkRecords.push({
          document_id,
          tenant_id,
          chunk_index: i,
          content: chunk,
          content_length: chunk.length,
          embedding: JSON.stringify(embedding),
          chunk_metadata: {
            total_chunks: chunks.length,
            is_first: i === 0,
            is_last: i === chunks.length - 1,
          },
        });

        // Batch insert every 10 chunks
        if (chunkRecords.length === 10 || i === chunks.length - 1) {
          const { error: insertError } = await supabase
            .from('knowledge_base_chunks')
            .insert(chunkRecords);

          if (insertError) {
            console.error('Error inserting chunks:', insertError);
            throw insertError;
          }

          chunkRecords.length = 0;
        }
      }

      // Update document status
      await supabase
        .from('knowledge_base_documents')
        .update({
          processing_status: 'completed',
          chunk_count: chunks.length,
        })
        .eq('id', document_id);

      return new Response(
        JSON.stringify({
          success: true,
          document_id,
          chunks_created: chunks.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /batch-process - Process multiple documents
    if (req.method === 'POST' && path === '/batch-process') {
      const body = await req.json();
      const { tenant_id, max_documents } = body;

      // Get pending documents
      const { data: documents } = await supabase
        .from('knowledge_base_documents')
        .select('id, tenant_id')
        .eq('tenant_id', tenant_id)
        .eq('processing_status', 'pending')
        .limit(max_documents || 10);

      const results = [];
      for (const doc of documents || []) {
        try {
          const processResponse = await fetch(
            `${supabaseUrl}/functions/v1/rag-document-processor/process`,
            {
              method: 'POST',
              headers: {
                'Authorization': req.headers.get('Authorization')!,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                document_id: doc.id,
                tenant_id: doc.tenant_id,
              }),
            }
          );

          const result = await processResponse.json();
          results.push({ document_id: doc.id, ...result });
        } catch (error) {
          results.push({
            document_id: doc.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return new Response(
        JSON.stringify({ results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET /status/:document_id - Get processing status
    if (req.method === 'GET' && path.startsWith('/status/')) {
      const documentId = path.split('/')[2];

      const { data: doc } = await supabase
        .from('knowledge_base_documents')
        .select('processing_status, chunk_count')
        .eq('id', documentId)
        .single();

      return new Response(
        JSON.stringify(doc || { error: 'Document not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Route not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Document processor error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});