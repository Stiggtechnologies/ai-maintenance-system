/**
 * KB intake core — pure, framework-free logic shared by the
 * `kb-document-intake` edge function and unit tests.
 *
 * Register: C2.15 Document-management integration (Reliability Knowledge
 * Activation offer). Chunker ported from the legacy rag-document-processor
 * (paragraph-preserving, maxChunkSize 1000 / overlap 200, >50 char floor).
 *
 * Deliberately no I/O here: tenancy, RLS and audit live in the SQL RPC
 * (`kb_ingest_document`); HTTP/auth lives in the edge function.
 */

export interface ChunkConfig {
  maxChunkSize: number;
  overlapSize: number;
  preserveParagraphs: boolean;
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  maxChunkSize: 1000,
  overlapSize: 200,
  preserveParagraphs: true,
};

export interface IntakeChunk {
  chunk_index: number;
  content: string;
  page_start?: number | null;
  page_end?: number | null;
}

/** Stable document classes from kb_document_classes (20260825090000). */
export const KB_DOCUMENT_CLASSES = [
  "engineering_standard",
  "government_technical_report",
  "incident_investigation",
  "operator_history",
  "oem_service_manual",
  "oem_marketing",
  "unclassified",
] as const;

export type KbDocumentClass = (typeof KB_DOCUMENT_CLASSES)[number];

/** Roles permitted to write into the tenant KB (matches user_profiles.role). */
export const KB_INTAKE_ROLES = [
  "admin",
  "ai_admin",
  "reliability_engineer",
] as const;

/**
 * Paragraph-preserving chunker. Ported verbatim from the legacy
 * rag-document-processor so behaviour is identical to the corpus that is
 * already verified live; only the empty-chunk filter is retained.
 */
export function chunkDocument(
  content: string,
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG,
): string[] {
  const { maxChunkSize, overlapSize, preserveParagraphs } = config;
  const chunks: string[] = [];

  if (preserveParagraphs) {
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = "";

    for (const para of paragraphs) {
      // A single paragraph larger than the window must still be split:
      // paragraph preservation is not a licence to create one giant chunk
      // (a 10k-character paragraph would otherwise become one chunk).
      if (para.length > maxChunkSize && currentChunk.length === 0) {
        for (let i = 0; i < para.length; i += maxChunkSize - overlapSize) {
          const slice = para.slice(i, i + maxChunkSize).trim();
          if (slice.length > 50) chunks.push(slice);
        }
        continue;
      }

      if (
        currentChunk.length + para.length > maxChunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.trim());
        const words = currentChunk.split(" ");
        const overlapWords = words.slice(-Math.floor(overlapSize / 5));
        currentChunk = overlapWords.join(" ") + " " + para;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + para;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
  } else {
    for (let i = 0; i < content.length; i += maxChunkSize - overlapSize) {
      chunks.push(content.slice(i, i + maxChunkSize));
    }
  }

  return chunks.filter((c) => c.length > 50);
}

/**
 * Suggest a document class from the title/source id. The suggestion is a
 * convenience default only — the uploader confirms, and the safe default is
 * `unclassified` (an unreviewed document must not gain standing by being
 * forgotten about).
 */
export function suggestDocumentClass(title: string): KbDocumentClass {
  const hay = `${title}`.toLowerCase();
  if (
    /service manual|parts manual|maintenance manual|repair manual|shop manual/.test(
      hay,
    )
  ) {
    return "oem_service_manual";
  }
  if (/brochure|specification sheet|datasheet|data sheet/.test(hay)) {
    return "oem_marketing";
  }
  if (/incident|investigation|failure report|rc[a]?a/.test(hay)) {
    return "incident_investigation";
  }
  if (/work order|workorder|history|maintenance record/.test(hay)) {
    return "operator_history";
  }
  if (/standard|handbook|procedure|code of practice/.test(hay)) {
    return "engineering_standard";
  }
  return "unclassified";
}

export interface IntakeValidation {
  ok: boolean;
  errors: string[];
}

export function validateIntakeInput(input: {
  source_id?: string;
  title?: string;
  document_class?: string;
  content?: string;
}): IntakeValidation {
  const errors: string[] = [];
  if (!input.source_id || input.source_id.trim().length < 3) {
    errors.push("source_id is required (min 3 characters)");
  } else if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input.source_id)) {
    errors.push(
      "source_id may contain only letters, digits, dot, dash, underscore",
    );
  }
  if (!input.title || input.title.trim().length < 2) {
    errors.push("title is required");
  }
  if (
    input.document_class &&
    !(KB_DOCUMENT_CLASSES as readonly string[]).includes(input.document_class)
  ) {
    errors.push(
      `document_class must be one of: ${KB_DOCUMENT_CLASSES.join(", ")}`,
    );
  }
  if (!input.content || input.content.trim().length < 20) {
    errors.push("content is required (min 20 characters)");
  }
  return { ok: errors.length === 0, errors };
}

/** Build chunk rows from text + metadata, preserving page attribution. */
export function buildIntakeChunks(
  content: string,
  pageStart?: number | null,
  pageEnd?: number | null,
): IntakeChunk[] {
  const raw = chunkDocument(content);
  return raw.map((chunk, i) => ({
    chunk_index: i,
    content: chunk,
    page_start: pageStart ?? null,
    page_end: pageEnd ?? null,
  }));
}

/**
 * Scanned-document heuristic (C2.15 OCR lane). A PDF with a text layer
 * yields dense text; a scan yields almost nothing per page. Below the
 * threshold we refuse rather than index a near-empty corpus that would
 * retrieve as "the document says nothing".
 */
export function isScannedLike(
  extractedText: string,
  pageCount: number,
): boolean {
  const len = (extractedText ?? "").trim().length;
  if (len < 20) return true;
  if (pageCount > 0 && len / pageCount < 40) return true;
  return false;
}

/** Hard cap on pages processed per PDF — bounds extraction cost. */
export const MAX_PDF_PAGES = 200;

/**
 * Intake resource ceilings. They are enforced again in the edge function so a
 * caller cannot bypass the browser's file picker. The corpus is an evidence
 * store, not a general-purpose binary upload service.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_CHARACTERS = 5_000_000;
export const MAX_DOCUMENT_CHUNKS = 5_000;

const SUPPORTED_DOCUMENT_NAME = /\.(txt|csv|md|markdown|json|log|pdf)$/i;

export function isSupportedDocumentFilename(filename: string): boolean {
  return SUPPORTED_DOCUMENT_NAME.test(filename.trim());
}

export interface PromptInjectionFinding {
  signal: string;
  severity: "warning" | "critical";
  explanation: string;
}

const PROMPT_INJECTION_SIGNALS: ReadonlyArray<{
  signal: string;
  severity: "warning" | "critical";
  pattern: RegExp;
  explanation: string;
}> = [
  {
    signal: "instruction_override",
    severity: "critical",
    pattern:
      /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|system|developer)\s+(instructions?|messages?|prompts?)\b/i,
    explanation:
      "The document contains language attempting to override higher-priority instructions.",
  },
  {
    signal: "role_impersonation",
    severity: "critical",
    pattern: /(^|\n)\s*(system|developer|assistant)\s*(message\s*)?[:<[]/im,
    explanation:
      "The document contains a model-role marker that could be interpreted as a control message.",
  },
  {
    signal: "prompt_exfiltration",
    severity: "critical",
    pattern:
      /\b(reveal|show|print|repeat|expose)\b[\s\S]{0,60}\b(system|developer)\b[\s\S]{0,30}\b(prompt|message|instructions?)\b/i,
    explanation:
      "The document asks for protected prompt or instruction disclosure.",
  },
  {
    signal: "tool_control",
    severity: "warning",
    pattern:
      /\b(call|invoke|execute|run)\s+(the\s+)?(tool|function|shell|command|api)\b/i,
    explanation:
      "The document contains imperative tool-execution language and requires human review.",
  },
  {
    signal: "secret_exfiltration",
    severity: "critical",
    pattern:
      /\b(send|upload|post|exfiltrate|leak|return)\b[\s\S]{0,80}\b(secret|password|token|api[ _-]?key|credential)\b/i,
    explanation:
      "The document contains a possible credential or secret exfiltration instruction.",
  },
  {
    signal: "context_escape",
    severity: "warning",
    pattern:
      /(end\s+(of\s+)?(untrusted|retrieved)\s+(context|evidence)|<\/retrieved[_-]evidence>)/i,
    explanation:
      "The document attempts to imitate or close the retrieval-context boundary.",
  },
];

/**
 * Deterministic client-side preview of the database scanner. This is not an
 * antivirus verdict and does not decide whether content is malicious. Any
 * signal means quarantine; only the database controls retrieval eligibility.
 */
export function detectPromptInjectionSignals(
  content: string,
): PromptInjectionFinding[] {
  return PROMPT_INJECTION_SIGNALS.filter(({ pattern }) =>
    pattern.test(content),
  ).map(({ signal, severity, explanation }) => ({
    signal,
    severity,
    explanation,
  }));
}

export const PDF_SCANNED_MESSAGE =
  "This PDF has no usable text layer (scanned or image-only). The OCR lane is not wired yet — paste the text or provide the source document.";
