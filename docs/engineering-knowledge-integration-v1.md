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

1. Persist document-to-engineering mappings with organization-scoped RLS.
2. Add hybrid retrieval using semantic similarity plus canonical metadata filters.
3. Add conflict and supersession detection.
4. Backfill relationships from compiled twins and existing knowledge chunks.
5. Implement failure-propagation and detection-path graph queries.
6. Package retrieved knowledge, physics results, evidence, conflicts, and missing evidence for governed agents.
