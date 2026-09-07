# Governed Engineering Knowledge

SyncAI uses one reliability knowledge corpus: `reliability_kb_chunks`. The governed-knowledge layer adds source authority, human approval, applicability and provenance to that canonical corpus instead of introducing another vector store or ontology.

This overlay composes with C2.15 tenant KB intake (`kb_ingest_document`). Ungoverned tenant chunks remain retrievable under the existing claim-type and document-class standing rules. Attaching a governed source is the opt-in that adds steward approval, provenance, applicability and supersession.

## Source lifecycle

Tenant knowledge that opts into this layer begins as an `engineering_knowledge_sources` record with source identity, revision/effective-date metadata, authority level, confidentiality, document class and checksum. `admin`, `ai_admin` and `reliability_engineer` are knowledge stewards.

A tenant chunk may still be ingested through C2.15 without a governed source. A chunk that **is** attached to a governed source must belong to that source's organization and carry both a content checksum and provenance metadata. Draft governed knowledge is not returned by the Reliability Engineer retrieval boundary.

A source can become `approved` only when:

1. it is not AI-generated, rejected or superseded;
2. it has provenance-bearing chunks in the canonical `reliability_kb_chunks` store;
3. it has at least one human-approved applicability mapping; and
4. every mapping provenance reference resolves to a chunk belonging to that exact source and organization.

Superseded sources immediately stop participating in tenant retrieval. Material source, mapping or governed-chunk drift returns the source to `in_review` until a steward re-approves it.

## Retrieval contract

`retrieve_kb_context` keeps the existing claim-type/document-class standing rules and tenant-safe SECURITY DEFINER behavior. Shared corpus material remains available according to its document class.

Tenant material is returned when the caller is scoped to that organization and either:

- the chunk has no governed source (C2.15 / ungoverned intake); or
- the attached governed source is approved and not superseded.

Natural-language retrieval uses OR-across-query-terms semantics. This restores the intended recall behavior while retaining the later security fix that prevents a signed-in but profile-less user from supplying another organization's UUID to a SECURITY DEFINER retrieval function.

Public Reliability Engineer access receives shared/publicly redistributable material only. Authenticated Reliability Engineer and Sync requests may receive their organization's ungoverned C2.15 chunks plus approved tenant knowledge.

## Applicability

`engineering_knowledge_mappings` records where a source applies: site, asset class, serialized asset, component, failure mode, maintenance task, procedure, standard or another governed canonical identifier. Mapping confidence is not authorization; an approved mapping names the reviewed applicability and carries the exact source-chunk provenance used to justify it.

## Deliberate boundaries

- No autonomous extraction is treated as approved knowledge.
- No AI-generated source may be promoted to authoritative status.
- No second chunk/vector store is created.
- No customer knowledge becomes global by omission.
- Confidentiality metadata does not by itself replace tenant authorization controls.
- Knowledge approval is evidence governance, not permission to execute work. Operational actions continue to use the existing human approval and audit rails (`recommend ≠ authorize`).
- C2.15 Knowledge Base intake is not closed by this overlay.
