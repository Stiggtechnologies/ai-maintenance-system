# Reliability knowledge base (RAG) — the citable copilot

The copilot's knowledge-heavy agents (Reliability, PM, Asset Health, Risk)
ground their answers in the same documents the owner's "Stigg Reliability
Engineer" GPT carries, and cite them inline as `[DoD RAM Guide, p.188-189]`.

**Corpus** (1,932 pages → 767 chunks, page-aware):
DoD RAM Guide · MIL-HDBK-338B · RADC-TR-85-194 · Failure Investigation Report (TC Oil, 2017)

**Pipeline**

1. `scripts/reliability_rag_corpus.py <pdfs…> --output <dir>` — page-aware chunking (850 words, 120 overlap)
2. `scripts/ingest_reliability_kb.mjs <chunks.jsonl> <url> <service_key> <gemini_key>` — embeds with `gemini-embedding-2` (768 dims via `outputDimensionality`, free tier), resume-safe upserts
3. `scripts/transfer_kb_to_cloud.mjs <src…> <dst…>` — copies embedded rows between projects without re-embedding (free-tier quota preservation); cleans citation titles

**Retrieval** (in `ai-agent-processor`): embed query → `match_reliability_kb`
(pgvector cosine, top 4, similarity > 0.35) → passages injected with mandatory
citation directives. Fail-soft: missing key/table/matches → uncited answer.
Response exposes `knowledgeBaseUsed`.

**Verified benchmark** (P-101 seal failures): response cites
`[DoD RAM Guide, p.188-189]` for seal-face loading and `[p.112-113]` for
low-flow cavitation — matching the GPT's source-grounded behavior.

**Gotchas:** `text-embedding-004` is retired — use `gemini-embedding-2`
(supports `outputDimensionality: 768`; no sync batch endpoint, use concurrent
`embedContent`). Query and corpus must use the same model + dimensionality.
