#!/usr/bin/env node
/**
 * Ingest the reliability RAG corpus into reliability_kb_chunks.
 *
 * Reads chunks.jsonl (from scripts/reliability_rag_corpus.py), embeds with
 * Gemini text-embedding-004 (768 dims, free tier, 100-per-batch), and upserts
 * via PostgREST with the service role key.
 *
 * Usage:
 *   node scripts/ingest_reliability_kb.mjs <chunks.jsonl> <SUPABASE_URL> \
 *     <SERVICE_ROLE_KEY> <GEMINI_API_KEY>
 */
import { readFileSync } from "node:fs";

const [, , chunksPath, supabaseUrl, serviceKey, geminiKey] = process.argv;
if (!chunksPath || !supabaseUrl || !serviceKey || !geminiKey) {
  console.error("usage: ingest_reliability_kb.mjs <chunks.jsonl> <SUPABASE_URL> <SERVICE_KEY> <GEMINI_KEY>");
  process.exit(1);
}

const chunks = readFileSync(chunksPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

console.log(`chunks: ${chunks.length}`);

const EMBED_BATCH = 40; // rows per upsert page
const EMBED_MODEL = "gemini-embedding-2"; // 768-dim truncation via outputDimensionality
const CONCURRENCY = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedOne(text) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: 768,
        }),
      },
    );
    if (res.status === 429 || res.status >= 500) {
      await sleep(8000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`embed failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.embedding.values;
  }
  throw new Error("embed failed after retries (rate limit)");
}

async function embedBatch(texts) {
  const out = new Array(texts.length);
  let idx = 0;
  async function worker() {
    while (idx < texts.length) {
      const i = idx++;
      out[i] = await embedOne(texts[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
  return out;
}

async function upsertRows(rows) {
  const res = await fetch(`${supabaseUrl}/rest/v1/reliability_kb_chunks?on_conflict=chunk_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

let done = 0;
for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
  const batch = chunks.slice(i, i + EMBED_BATCH);
  const embeddings = await embedBatch(batch.map((c) => c.text));
  const rows = batch.map((c, j) => ({
    chunk_id: c.chunk_id,
    source_id: c.source_id,
    title: c.title,
    document_type: c.document_type,
    page_start: c.page_start,
    page_end: c.page_end,
    chunk_index: c.chunk_index,
    domain_tags: c.domain_tags ?? [],
    content: c.text,
    embedding: JSON.stringify(embeddings[j]),
  }));
  await upsertRows(rows);
  done += batch.length;
  console.log(`  upserted ${done}/${chunks.length}`);
  await sleep(800); // stay under free-tier RPM
}
console.log("ingestion complete");
