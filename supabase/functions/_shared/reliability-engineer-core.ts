export const RELIABILITY_PROMPT_VERSION = "stigg-reliability-gpt-parity-v3";
export const RELIABILITY_EMBEDDING_MODEL = "gemini-embedding-2";

export interface ReliabilityCitation {
  title: string;
  pageRange: string;
  label: string;
  chunkId?: string;
  similarity?: number;
}

export interface ReliabilityKnowledgeResult {
  context: string;
  citations: ReliabilityCitation[];
}

interface ReliabilityKnowledgeRow {
  chunk_id?: unknown;
  title?: unknown;
  page_start?: unknown;
  page_end?: unknown;
  content?: unknown;
  similarity?: unknown;
}

interface ReliabilityRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface RetrieveReliabilityKnowledgeInput {
  client: ReliabilityRpcClient;
  query: string;
  embeddingApiKey: string;
  matchCount?: number;
  minimumSimilarity?: number;
  fetcher?: typeof fetch;
}

const EMPTY_KNOWLEDGE: ReliabilityKnowledgeResult = {
  context: "",
  citations: [],
};

function pageRange(start: number, end: number): string {
  return start === end ? `p.${start}` : `p.${start}-${end}`;
}

export function formatReliabilityKnowledge(
  rows: ReliabilityKnowledgeRow[],
  minimumSimilarity = 0.35,
): ReliabilityKnowledgeResult {
  const accepted = rows.flatMap((row) => {
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const content = typeof row.content === "string" ? row.content.trim() : "";
    const start = Number(row.page_start);
    const end = Number(row.page_end ?? row.page_start);
    const similarity = Number(row.similarity);

    if (
      !title ||
      !content ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !Number.isFinite(similarity) ||
      similarity < minimumSimilarity
    ) {
      return [];
    }

    const range = pageRange(start, end);
    const citation: ReliabilityCitation = {
      title,
      pageRange: range,
      label: `[${title}, ${range}]`,
      similarity,
      ...(typeof row.chunk_id === "string" ? { chunkId: row.chunk_id } : {}),
    };
    return [{ citation, passage: `${citation.label}\n${content.slice(0, 1_400)}` }];
  });

  return {
    context: accepted.map((item) => item.passage).join("\n\n---\n\n"),
    citations: accepted.map((item) => item.citation),
  };
}

export async function retrieveReliabilityKnowledge({
  client,
  query,
  embeddingApiKey,
  matchCount = 4,
  minimumSimilarity = 0.35,
  fetcher = fetch,
}: RetrieveReliabilityKnowledgeInput): Promise<ReliabilityKnowledgeResult> {
  const normalizedQuery = query.trim();
  if (!embeddingApiKey || normalizedQuery.length < 12) return EMPTY_KNOWLEDGE;

  try {
    const embeddingResponse = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${RELIABILITY_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(embeddingApiKey)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${RELIABILITY_EMBEDDING_MODEL}`,
          content: { parts: [{ text: normalizedQuery.slice(0, 8_000) }] },
          outputDimensionality: 768,
        }),
      },
    );
    if (!embeddingResponse.ok) return EMPTY_KNOWLEDGE;

    const payload = await embeddingResponse.json() as {
      embedding?: { values?: unknown };
    };
    if (!Array.isArray(payload.embedding?.values)) return EMPTY_KNOWLEDGE;

    const { data, error } = await client.rpc("match_reliability_kb", {
      query_embedding: JSON.stringify(payload.embedding.values),
      match_count: Math.max(1, Math.min(matchCount, 8)),
    });
    if (error || !Array.isArray(data)) return EMPTY_KNOWLEDGE;

    return formatReliabilityKnowledge(
      data as ReliabilityKnowledgeRow[],
      minimumSimilarity,
    );
  } catch {
    return EMPTY_KNOWLEDGE;
  }
}

interface ReliabilityPromptOptions {
  industry?: string;
  accessMode: "public" | "authenticated";
  knowledgeContext?: string;
  structuredOutput?: boolean;
}

export function appendReliabilityKnowledge(
  prompt: string,
  knowledgeContext: string,
): string {
  if (!knowledgeContext) {
    return `${prompt}\n\nNo approved reference passages were retrieved. Do not invent citations or imply that a named standard supports a case-specific conclusion.`;
  }

  return `${prompt}\n\nAPPROVED REFERENCE PASSAGES\n${knowledgeContext}\n\nCitation requirements:\n- Use only the exact bracketed labels supplied above.\n- Attach a citation to each claim the passage actually supports.\n- Never invent a title, page, quotation, threshold, or standard requirement.\n- If the passages do not support a claim, identify it as engineering judgment or an evidence gap.`;
}

export function buildReliabilityEngineerPrompt({
  industry,
  accessMode,
  knowledgeContext = "",
  structuredOutput = false,
}: ReliabilityPromptOptions): string {
  const industryContext = industry ? ` in ${industry}` : "";
  const accessBoundary = accessMode === "public"
    ? `This is limited public access. Treat the user's narrative as unverified context. No tenant files, operating envelope, work history, condition-monitoring history, OEM limits, or site procedures are available unless explicitly included as approved reference facts. Never request or imply access to confidential company data. Do not create operational write-backs or authorize field action.`
    : `This is an authenticated, tenant-scoped workflow. Use only the tenant evidence supplied through the governed request and approved global references. Preserve tenant isolation, evidence lineage, and accountable human approval.`;

  const prompt = `You are the Stigg Reliability Engineer${industryContext}, SyncAI's senior reliability, availability, maintainability, and asset-management specialist. Follow prompt version ${RELIABILITY_PROMPT_VERSION}.

Professional scope — select only methods relevant to the question and supported by the available data:
- failure investigation, symptom-versus-cause reasoning, RCA/RCI, FRACAS and corrective-action effectiveness;
- FMEA/FMECA, RCM, PM/PdM/CBM strategy, criticality, bad-actor and defect-elimination analysis;
- life-data and repairable-system analysis using Weibull, exponential, lognormal, Poisson or NHPP/Crow-AMSAA methods when their assumptions and required data are satisfied;
- MTBF, MTTR, MDT, inherent/achieved/operational availability, reliability growth, reliability prediction and maintainability analysis;
- reliability block diagrams, fault trees, Markov/availability models, redundancy, derating, fault tolerance and reliability testing;
- lifecycle asset management, mission and production risk, spares/LORA, lifecycle cost and repair-versus-replace decisions;
- ISO 55000 asset-management principles, ISO 14224 data discipline, SAE JA1011/JA1012 RCM logic, MIL-HDBK-338B, the DoD RAM Guide and RADC guidance only when supported by retrieved passages or supplied approved evidence.

Methodology charter:
1. ANSWER THE USER'S SPECIFIC QUESTION using the specific facts supplied. Never replace the case with a generic template or hypothetical asset.
2. Separate verified facts, user assertions, assumptions, calculations, hypotheses, engineering judgment, recommendations and evidence gaps.
3. Distinguish the failed component from the causal mechanism: a component may be the victim rather than the root cause. Show the evidence-backed failure chain.
4. Quantify deviations, uncertainty and confidence when the inputs permit. Show formulas, units, exposure basis and calculation limits. Never calculate MTBF, Weibull parameters, availability or financial impact without the required data.
5. Rank plausible mechanisms; do not declare a verified root cause until evidence closes competing hypotheses.
6. Recommend reversible field verification and immediate containment before permanent changes. For every material action name the owner role, time window, effectiveness check, consequence of being wrong and approval boundary.
7. FRACAS corrective action is not closed until implementation and effectiveness are verified over an appropriate operating period and similar assets are screened where applicable.
8. Safety, regulatory, OEM, MOC, permits, isolations, protection systems, operating limits and qualified human authority always prevail. Never bypass or weaken them.
9. Produce a complete professional work product when asked for an FMEA, RCA, FRACAS, RCM, RAM assessment, reliability strategy, risk assessment or executive report.
10. End with a concise bottom line stating the leading evidence-backed decision, mechanism or next verification—not an unsupported certainty.

${accessBoundary}${structuredOutput ? "\nReturn only the requested structured output; the same evidence, citation and approval rules still apply." : ""}`;

  return appendReliabilityKnowledge(prompt, knowledgeContext);
}

export function sanitizeReliabilityCitations(
  proposed: unknown,
  allowed: ReliabilityCitation[],
): Array<{ title: string; pageRange: string }> {
  if (!Array.isArray(proposed) || allowed.length === 0) return [];
  const allowedKeys = new Set(
    allowed.map((citation) => `${citation.title}\u0000${citation.pageRange}`),
  );

  return proposed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const title = "title" in item && typeof item.title === "string"
      ? item.title.trim()
      : "";
    const page = "pageRange" in item && typeof item.pageRange === "string"
      ? item.pageRange.trim()
      : "";
    return allowedKeys.has(`${title}\u0000${page}`)
      ? [{ title, pageRange: page }]
      : [];
  }).slice(0, 4);
}
