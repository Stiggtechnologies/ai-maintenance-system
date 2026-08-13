/**
 * Governed reliability retrieval shared by every supported copilot surface.
 *
 * Retrieval is claim-scoped before content reaches a model. Public callers add
 * a second boundary: only shared, explicitly redistributable passages survive.
 */

export const RELIABILITY_CLAIM_TYPES = [
  "analysis_method",
  "failure_behaviour",
] as const;

export interface ReliabilityCitation {
  chunkId: string;
  title: string;
  pageRange: string;
  documentClass: string;
  redistributable: boolean;
  isClientPrivate: boolean;
  label: string;
}

export interface ReliabilityContext {
  promptContext: string;
  citations: ReliabilityCitation[];
  knowledgeBaseUsed: boolean;
}

interface RpcResult {
  data: unknown;
  error?: { message?: string } | null;
}

export interface ReliabilityContextClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

interface RetrievedChunk {
  chunk_id: string;
  title: string;
  page_start: number;
  page_end: number;
  content: string;
  documentClass: string;
  redistributable: boolean;
  isClientPrivate: boolean;
}

export async function retrieveReliabilityContext(
  client: ReliabilityContextClient,
  query: string,
  options: {
    organizationId?: string | null;
    publicOnly?: boolean;
    limitPerClaim?: number;
  } = {},
): Promise<ReliabilityContext> {
  if (query.trim().length < 12) return emptyContext();

  try {
    const results = await Promise.all(
      RELIABILITY_CLAIM_TYPES.map((claimType) =>
        client.rpc("retrieve_kb_context", {
          p_query: query.slice(0, 500),
          p_claim_type: claimType,
          p_limit: options.limitPerClaim ?? 3,
          p_organization_id: options.organizationId || null,
        }),
      ),
    );

    const seen = new Set<string>();
    const chunks: RetrievedChunk[] = [];
    for (const result of results) {
      if (result.error) continue;
      for (const chunk of (result.data ?? []) as RetrievedChunk[]) {
        if (
          options.publicOnly &&
          (chunk.isClientPrivate || chunk.redistributable !== true)
        ) {
          continue;
        }
        const key = `${chunk.title}|${chunk.page_start}|${chunk.content.slice(0, 60)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chunks.push(chunk);
      }
    }
    if (chunks.length === 0) return emptyContext();

    const citations = chunks.map(toCitation);
    return {
      promptContext: chunks
        .map((chunk, index) => {
          const citation = citations[index];
          return `${citation.label}\n${String(chunk.content).slice(0, 1200)}`;
        })
        .join("\n\n---\n\n"),
      citations,
      knowledgeBaseUsed: true,
    };
  } catch {
    return emptyContext();
  }
}

function toCitation(chunk: RetrievedChunk): ReliabilityCitation {
  const pageRange =
    chunk.page_end !== chunk.page_start
      ? `p.${chunk.page_start}-${chunk.page_end}`
      : `p.${chunk.page_start}`;
  const provenance = chunk.isClientPrivate
    ? `${chunk.documentClass}, client-supplied`
    : chunk.documentClass;
  return {
    chunkId: chunk.chunk_id,
    title: chunk.title,
    pageRange,
    documentClass: chunk.documentClass,
    redistributable: chunk.redistributable,
    isClientPrivate: chunk.isClientPrivate,
    label: `[${chunk.title}, ${pageRange} — ${provenance}]`,
  };
}

function emptyContext(): ReliabilityContext {
  return { promptContext: "", citations: [], knowledgeBaseUsed: false };
}
