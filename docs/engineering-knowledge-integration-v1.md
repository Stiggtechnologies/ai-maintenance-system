# Engineering Knowledge Integration v1

## Existing capabilities retained

- Canonical asset-class and component templates
- Digital Engineering DNA profiles and twin instantiation
- Shared Component DNA and dependency relationships
- Physics Capability Library
- Reliability knowledge-base chunks and semantic retrieval
- Existing document-processing and RAG edge functions
- Tenant-aware application and Supabase foundations

## Gaps addressed by this slice

The existing RAG layer is document-centric and lacks a canonical contract for mapping sources to asset classes, twins, components, failure modes, physics capabilities, and verified operational cases.

This slice adds:

- Canonical engineering entity references
- Typed engineering relationships
- Source authority and review states
- Revision and supersession controls
- Tenant, site, asset, component, failure, and physics metadata
- Applicability filtering
- Provenance requirements
- A governed context-package contract for engineering agents

## Non-duplication boundary

Knowledge-graph nodes reference canonical IDs. They do not store copies of complete twins, asset templates, component profiles, failure modes, documents, work orders, or recommendations.

The existing vector stores and RAG functions remain the retrieval infrastructure. Future database migrations should add mapping metadata and relationship tables around existing records rather than establish another knowledge-base corpus.

## Next slices

1. Persist document-to-engineering mappings with organization-scoped RLS. **Done (2026-10-20).** `persist_document_engineering_mappings` stores canonical entity references on the existing `engineering_knowledge_mappings` table for the caller's organization. `ai_admin` may draft a mapping and cannot approve or supersede one; changing an approved mapping requires an explicit reason. A mapping does not grant permission, work release, or approval.
2. Add hybrid retrieval using semantic similarity plus canonical metadata filters. **Done (2026-10-20).** `retrieve_engineering_knowledge_hybrid` ranks the canonical `reliability_kb_chunks` corpus by lexical rank and optional cosine similarity, then keeps rows whose approved mapping matches the requested canonical id or asset class. Index scans are disabled only for that query, and the caller's previous planner settings are restored. A hit does not grant permission, work release, or approval.
3. Add conflict and supersession detection. **Done (2026-10-20).** `detect_engineering_knowledge_conflicts` reports revision disagreements, authority disagreements, and broken supersession for one canonical target in the caller's organization. It does not choose a winner, supersede a source, or grant permission, work release, or approval.
4. Backfill relationships from compiled twins and existing knowledge chunks.
   **Done (2026-10-20).** Compiled twins produce draft canonical edges in memory, and `backfill_relationships_from_knowledge_chunks` stores draft edges from `asset_class` and provenance code arrays already on `reliability_kb_chunks`. Edges reference canonical ids. They do not copy records, and they do not grant permission, work release, or approval.
5. Implement failure-propagation and detection-path graph queries.
6. Package retrieved knowledge, physics results, evidence, conflicts, and missing evidence for governed agents.
   **Done (2026-10-20).** `build_governed_engineering_context` calls `retrieve_kb_context` on `reliability_kb_chunks`, checks evidence ids against `evidence_items` in the caller organization, names revision and authority conflicts among approved sources, and lists component, failure-mode, and physics-capability codes that have no approved mapping. Physics input is a capability code plus a result reference, returned with unverified set because no stored result is checked. The package sets human approval required and does not grant permission, work release, or approval.
