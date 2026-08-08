# Reliability RAG Training Corpus

The seed RAG corpus for SyncAI Reliability Engineering Copilot is built from
local PDF sources supplied by the product owner.

This is not model fine-tuning. It is retrieval corpus preparation: PDF text is
extracted, normalized, chunked with source/page metadata, and written to JSONL
for later embedding into Azure AI Search, pgvector, Qdrant, or another vector
store.

## Build The Corpus

Use the bundled Python runtime or any Python environment with `pypdf` installed.

```bash
/Users/orvilledavis/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/reliability_rag_corpus.py \
  "/Users/orvilledavis/Downloads/failure-investigation-report-tc-oil-nd-11162017 (1).pdf" \
  "/Users/orvilledavis/Downloads/MILHDBK338B (1).pdf" \
  "/Users/orvilledavis/Downloads/RADC-TR-85-194 (1).pdf" \
  "/Users/orvilledavis/Downloads/MILHDBK338B.pdf" \
  "/Users/orvilledavis/Downloads/DoD Reliability Availability and Maintainability (RAM) Guide.pdf" \
  "/Users/orvilledavis/Downloads/MIL-HDBK-217F.pdf" \
  "/Users/orvilledavis/Downloads/Handbook_of_Reliability_Prediction_Procedures_for_Mechanical_Equipment_NSWC-11.pdf" \
  --output rag-corpus/reliability
```

The script deduplicates identical PDFs by SHA-256, so duplicate handbook copies
do not create duplicate chunks.

Current local corpus summary:

- 6 unique sources.
- 1 duplicate skipped (`MILHDBK338B.pdf`).
- 2,659 extracted pages.
- 1,008 retrieval chunks.
- 735,349 extracted words.

Current sources:

- `tc-oil-nd-2017-failure-investigation` - failure investigation / RCA source.
- `mil-hdbk-338b` - RAM, FRACAS, reliability prediction, maintainability.
- `radc-tr-85-194` - nonelectronic parts reliability data.
- `dod-ram-guide` - RAM program governance and test/evaluation guidance.
- `mil-hdbk-217f` - electronic equipment reliability prediction, part-stress
  and parts-count methods.
- `nswc-11-mechanical` - mechanical equipment reliability prediction for
  bearings, gears, seals, springs, brakes, clutches, pumps, valves, and related
  components.

## Outputs

- `rag-corpus/reliability/manifest.json` - build summary and file locations.
- `rag-corpus/reliability/sources.json` - source metadata, hashes, page counts,
  word counts, and chunk counts.
- `rag-corpus/reliability/pages.jsonl` - page-level extracted text.
- `rag-corpus/reliability/chunks.jsonl` - retrieval-ready chunks.

## Chunk Metadata

Each chunk includes:

- `chunk_id`
- `source_id`
- `title`
- `document_type`
- `rights`
- `source_path`
- `sha256`
- `page_start`
- `page_end`
- `chunk_index`
- `domain_tags`
- `text`
- `char_count`
- `word_count`

## Commercial Caution

Before bundling any source text into a commercial default knowledge base, verify
redistribution rights. Public government documents are usually suitable for
retrieval use, but customer-supplied PDFs and investigation reports should be
treated as licensed/customer-controlled unless explicitly cleared.

## Next Product Step

Wire `chunks.jsonl` into the Copilot ingestion pipeline:

1. Create embeddings for each chunk.
2. Store embeddings and metadata in the selected vector store.
3. Retrieve source chunks during RCA/FRACAS/FMEA/RAM questions.
4. Show citations with source title and page range.
5. Keep deterministic calculations separate from retrieved text.

## Validate Retrieval Locally

Before embeddings are available, use the local lexical retriever to smoke-test
the corpus:

```bash
/Users/orvilledavis/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/query_reliability_rag_corpus.py \
  "FRACAS failure cause corrective action recurrence" \
  --corpus rag-corpus/reliability/chunks.jsonl \
  --limit 5
```

This is not the production retriever, but it confirms that the generated chunks
carry source IDs, page ranges, and useful excerpts.

Useful smoke-test queries:

- `FRACAS failure cause corrective action recurrence`
- `pipeline rupture failure investigation root cause`
- `MIL HDBK 217F electronic equipment base failure rate parts count`
- `mechanical equipment bearing seal gear reliability prediction failure rate`
