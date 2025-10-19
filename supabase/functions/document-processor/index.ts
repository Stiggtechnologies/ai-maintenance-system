import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DocumentRequest {
  fileUrl: string;
  fileName: string;
  fileType: string;
  agentType?: string;
  query?: string;
  openaiKey?: string;
}

async function extractTextFromDocument(fileUrl: string, fileType: string): Promise<string> {
  if (fileType.includes('text')) {
    const response = await fetch(fileUrl);
    return await response.text();
  }
  
  return `Document content from ${fileUrl}`;
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
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { fileUrl, fileName, fileType, agentType, query, openaiKey }: DocumentRequest = await req.json();

    if (!fileUrl || !fileName) {
      return new Response(
        JSON.stringify({ error: "fileUrl and fileName are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiKey = openaiKey || Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const documentText = await extractTextFromDocument(fileUrl, fileType);
    
    const userQuery = query || `Analyze this document: ${fileName}. Extract key maintenance insights, asset information, and provide actionable recommendations.`;
    
    const analysis = await analyzeDocumentWithAI(documentText, fileName, userQuery, apiKey);

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
