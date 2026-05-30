export interface ReliabilityKnowledgeSource {
  id: string;
  title: string;
  source: string;
  pageRange: string;
  summary: string;
  keywords: string[];
  supports: string[];
}

export interface KnowledgeCitation {
  id: string;
  title: string;
  source: string;
  pageRange: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  supports: string[];
}

const SOURCES: ReliabilityKnowledgeSource[] = [
  {
    id: "mil-hdbk-338b-fracas",
    title: "FRACAS closed-loop failure reporting",
    source: "MIL-HDBK-338B",
    pageRange: "FRACAS sections in local RAG corpus",
    summary:
      "FRACAS practice centers on reporting failures, analyzing causes, documenting corrective action, and verifying that recurrence is prevented.",
    keywords: [
      "fracas",
      "dcacas",
      "failure",
      "corrective",
      "recurrence",
      "verification",
      "root",
      "cause",
    ],
    supports: [
      "Use a closed-loop case workflow for recurring failures.",
      "Track corrective action effectiveness before closing the case.",
    ],
  },
  {
    id: "dod-ram-guide-ram",
    title: "RAM definitions and decision support",
    source: "DoD Reliability Availability and Maintainability Guide",
    pageRange: "RAM overview sections in local RAG corpus",
    summary:
      "RAM decisions should distinguish reliability, availability, and maintainability, then use the right metric for the decision being made.",
    keywords: [
      "ram",
      "mtbf",
      "mttr",
      "availability",
      "maintainability",
      "reliability",
      "trade",
      "mission",
    ],
    supports: [
      "Keep deterministic RAM calculations separate from narrative recommendations.",
      "Validate exposure hours, repair definitions, and mission time before using metrics contractually.",
    ],
  },
  {
    id: "mil-hdbk-338b-tradeoffs",
    title: "Quantified RAM trade-off analysis",
    source: "MIL-HDBK-338B",
    pageRange: "Trade-off and analysis sections in local RAG corpus",
    summary:
      "Reliability trade-offs should be supported by quantifiable, analytic, or empirical relationships whenever possible.",
    keywords: [
      "trade",
      "analysis",
      "quantifiable",
      "empirical",
      "cost",
      "risk",
      "schedule",
      "performance",
    ],
    supports: [
      "Pair recommendations with calculations, assumptions, and validation needs.",
      "Avoid permanent strategy changes until data quality and consequence risk are understood.",
    ],
  },
  {
    id: "tc-oil-nd-2017-rca",
    title: "Failure investigation report structure and evidence discipline",
    source: "TC Oil ND 2017 failure investigation report",
    pageRange: "Investigation report format example in local RAG corpus",
    summary:
      "Use this as a guide for how a rigorous failure investigation report can be structured: event narrative, evidence organization, analytical discipline, conclusions, and recommendations. Do not use its asset-specific facts as evidence for unrelated customer assets.",
    keywords: [
      "rca",
      "investigation",
      "evidence",
      "timeline",
      "hypothesis",
      "failure",
      "root",
      "cause",
    ],
    supports: [
      "Use the format and evidence discipline when the user asks for a failure investigation report.",
      "Build an evidence table and timeline before declaring root cause.",
      "Call out missing evidence and verification tasks explicitly.",
      "Do not transfer facts from this report to unrelated assets or industries.",
    ],
  },
  {
    id: "nswc-11-mechanical",
    title: "Mechanical equipment reliability prediction",
    source: "NSWC-11 Mechanical Equipment Reliability Prediction Handbook",
    pageRange: "Mechanical component sections in local RAG corpus",
    summary:
      "Mechanical reliability analysis depends on component type, operating environment, load, duty, and failure mechanism assumptions.",
    keywords: [
      "mechanical",
      "pump",
      "valve",
      "bearing",
      "gearbox",
      "seal",
      "compressor",
      "equipment",
    ],
    supports: [
      "Tie asset strategy recommendations to equipment class and operating context.",
      "Treat generic mechanical recommendations as provisional until duty and environment are confirmed.",
    ],
  },
  {
    id: "mil-hdbk-217f-electronics",
    title: "Electronic reliability prediction context",
    source: "MIL-HDBK-217F",
    pageRange: "Electronic component sections in local RAG corpus",
    summary:
      "Electronic reliability prediction requires component stress, environment, quality level, and application assumptions.",
    keywords: [
      "electronic",
      "electrical",
      "instrumentation",
      "control",
      "protection",
      "component",
      "stress",
    ],
    supports: [
      "Escalate electrical protection, control, and OEM-limit recommendations for qualified review.",
      "Avoid applying electronics reliability predictions without component and stress assumptions.",
    ],
  },
  {
    id: "rag-corpus-rights",
    title: "Customer-controlled RAG rights boundary",
    source: "SyncAI local RAG corpus policy",
    pageRange: "docs/rag-training-corpus.md",
    summary:
      "Customer documents, OEM manuals, and licensed standards should be used only when the customer has rights to upload and process them.",
    keywords: [
      "rag",
      "citation",
      "source",
      "document",
      "rights",
      "oem",
      "standard",
      "manual",
    ],
    supports: [
      "Cite sources without reproducing long copyrighted passages.",
      "Keep proprietary document ingestion tenant-controlled.",
    ],
  },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function confidenceFromScore(score: number): KnowledgeCitation["confidence"] {
  if (score >= 5) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function retrieveReliabilityKnowledge(
  query: string,
  limit = 3,
): KnowledgeCitation[] {
  const tokens = new Set(tokenize(query));

  return SOURCES.map((source) => {
    const score = source.keywords.reduce(
      (total, keyword) => total + (tokens.has(keyword) ? 2 : 0),
      0,
    );
    const titleScore = tokenize(source.title).reduce(
      (total, token) => total + (tokens.has(token) ? 1 : 0),
      0,
    );

    return {
      source,
      score: score + titleScore,
    };
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ source, score }) => ({
      id: source.id,
      title: source.title,
      source: source.source,
      pageRange: source.pageRange,
      summary: source.summary,
      confidence: confidenceFromScore(score),
      supports: source.supports,
    }));
}

export function getReliabilityKnowledgeSources() {
  return [...SOURCES];
}
