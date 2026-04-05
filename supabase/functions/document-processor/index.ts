import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DocumentRequest {
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  agentType?: string;
  query?: string;
  openaiKey?: string;
  document_id?: string;
  user_id?: string;
  action?: string;
}

async function extractTextFromDocument(fileUrl: string, fileType: string): Promise<string> {
  if (fileType.includes('text') || fileType.includes('plain')) {
    const response = await fetch(fileUrl);
    return await response.text();
  }

  if (fileType.includes('pdf')) {
    return `PDF document content extraction not yet implemented for ${fileUrl}`;
  }

  return `Document content from ${fileUrl}`;
}

function chunkText(text: string, maxChunkSize: number = 512, overlap: number = 50): Array<{ content: string; index: number }> {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: Array<{ content: string; index: number }> = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push({ content: currentChunk.trim(), index: chunkIndex++ });
        const words = currentChunk.trim().split(' ');
        currentChunk = words.slice(-overlap).join(' ') + ' ';
      }
      currentChunk += sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), index: chunkIndex });
  }

  return chunks;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data[0].embedding;
}

async function analyzeDocumentWithAI(documentText: string, fileName: string, query: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an expert document analyzer for asset-intensive industries. Analyze documents for maintenance insights, asset data, work orders, compliance information, and operational metrics."
        },
        { 
          role: "user", 
          content: `Analyze this document: ${fileName}\n\nContent:\n${documentText.substring(0, 4000)}\n\nUser question: ${query}\n\nProvide a concise analysis with key insights and actionable recommendations.`
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 800
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestData: DocumentRequest = await req.json();
    const { fileUrl, fileName, fileType, agentType, query, openaiKey, document_id, user_id, action } = requestData;

    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === 'process_and_chunk') {
      if (!document_id) {
        return new Response(
          JSON.stringify({ error: "document_id is required for chunking" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: doc } = await supabase
        .from('knowledge_base_documents')
        .select('*')
        .eq('id', document_id)
        .single();

      if (!doc) {
        return new Response(
          JSON.stringify({ error: "Document not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase
        .from('knowledge_base_documents')
        .update({ processing_status: 'chunking' })
        .eq('id', document_id);

      const chunks = chunkText(doc.content);

      const chunkRecords = [];
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.content, apiKey);

        const { data: chunkData } = await supabase
          .from('knowledge_base_chunks')
          .insert({
            document_id,
            tenant_id: doc.tenant_id,
            chunk_index: chunk.index,
            content: chunk.content,
            content_length: chunk.content.length,
            embedding
          })
          .select()
          .single();

        chunkRecords.push(chunkData);
      }

      await supabase
        .from('knowledge_base_documents')
        .update({
          processing_status: 'completed',
          chunk_count: chunks.length
        })
        .eq('id', document_id);

      return new Response(
        JSON.stringify({
          success: true,
          document_id,
          chunks_created: chunks.length,
          embeddings_generated: chunks.length
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!fileUrl || !fileName) {
      return new Response(
        JSON.stringify({ error: "fileUrl and fileName are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const documentText = await extractTextFromDocument(fileUrl, fileType || 'text/plain');

    const userQuery = query || `Analyze this document: ${fileName}. Extract key maintenance insights, asset information, and provide actionable recommendations.`;

    const analysis = await analyzeDocumentWithAI(documentText, fileName, userQuery, apiKey);

    if (user_id) {
      await supabase
        .from('document_uploads')
        .insert({
          file_name: fileName,
          file_path: fileUrl,
          file_type: fileType || 'text/plain',
          file_size: documentText.length,
          uploaded_by: user_id,
          analysis_result: { analysis, query: userQuery },
          agent_type: agentType || 'DocumentAnalysis'
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis: analysis,
        fileName: fileName,
        agentType: agentType || 'DocumentAnalysis'
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing document:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
