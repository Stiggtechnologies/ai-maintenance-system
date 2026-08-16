/**
 * Attaching a data file to a decision case.
 *
 * The public workspace tells the visitor, in the composer's own footer, that
 * data is isolated to this browser tab. That promise decides the design: the
 * file is parsed HERE, in the page, and never uploaded. What travels with the
 * message is a profile — filename, row and column counts, the column names,
 * and a handful of sample rows — and the message is rendered in the transcript
 * so the person can see precisely what was included before and after they send
 * it. No hidden payload.
 *
 * The formats it refuses matter as much as the ones it accepts. A spreadsheet
 * or a PDF cannot be read without a parser this page does not have, and an
 * audio file cannot be transcribed without a service this product has not
 * built. Each refusal says which of those it is, because "unsupported file
 * type" teaches the visitor nothing and a prospect evaluating the tool deserves
 * to know whether the gap is a missing parser or a missing capability.
 */
import { parseCSV } from "./fleet-import";

/** 5 MB. Large enough for a real work-order export, small enough to parse in
 *  the page without freezing the tab. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Rows of the file included verbatim in the message. Enough to show shape,
 *  few enough that a careless upload of sensitive data is bounded. */
export const SAMPLE_ROWS = 5;

export interface AttachmentProfile {
  name: string;
  bytes: number;
  rowCount: number;
  headers: string[];
  sampleRows: string[][];
}

export interface AttachmentRefusal {
  error: string;
}

export type AttachmentResult = AttachmentProfile | AttachmentRefusal;

export function isRefusal(r: AttachmentResult): r is AttachmentRefusal {
  return (r as AttachmentRefusal).error !== undefined;
}

const DELIMITED = /\.(csv|tsv|txt|log)$/i;
const SPREADSHEET = /\.(xlsx|xls|xlsm|ods|numbers)$/i;
const DOCUMENT = /\.(pdf|docx?|pptx?)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;

/** Why this file cannot be read, or null if it can. */
export function refuseFileType(name: string): string | null {
  if (DELIMITED.test(name)) return null;
  if (SPREADSHEET.test(name)) {
    return "Spreadsheets are not readable in this browser session. Export the sheet as CSV and attach that — the columns and rows come through identically.";
  }
  if (DOCUMENT.test(name)) {
    return "Documents need server-side extraction, which this demonstration session deliberately does not do. Paste the relevant passage into the message instead.";
  }
  if (AUDIO.test(name)) {
    return "Audio transcription is not built yet — SyncAI has no speech-to-text service, and pretending otherwise would waste your time. Use the microphone button to dictate instead: that runs in your browser.";
  }
  if (IMAGE.test(name)) {
    return "Images are not read in this session. Describe what the image shows, or attach the underlying data as CSV.";
  }
  return "Only delimited text is readable here: .csv, .tsv, .txt or .log.";
}

export async function profileAttachment(file: File): Promise<AttachmentResult> {
  const refusal = refuseFileType(file.name);
  if (refusal) return { error: refusal };

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit here is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB so the page stays responsive. Attach an extract, or use the 48-hour value proof for a full history.`,
    };
  }
  if (file.size === 0) return { error: "That file is empty." };

  let rows: string[][];
  try {
    rows = parseCSV(await file.text());
  } catch {
    return { error: "That file could not be parsed as delimited text." };
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length < 2) {
    return {
      error:
        "That file needs a header row and at least one data row to be worth discussing.",
    };
  }

  const [headers, ...body] = nonEmpty;
  return {
    name: file.name,
    bytes: file.size,
    rowCount: body.length,
    headers: headers.map((h) => h.trim()),
    sampleRows: body.slice(0, SAMPLE_ROWS),
  };
}

/**
 * The block prepended to the outgoing message. Deliberately plain text and
 * deliberately visible in the transcript: the person can read exactly what
 * left the tab, because it is sitting in their own conversation.
 */
export function formatAttachmentForMessage(p: AttachmentProfile): string {
  const sample = p.sampleRows
    .map((r) =>
      r.map((c) => (c.length > 60 ? `${c.slice(0, 57)}…` : c)).join(" | "),
    )
    .join("\n");
  return [
    `[Attached data — ${p.name}]`,
    `${p.rowCount.toLocaleString()} rows × ${p.headers.length} columns.`,
    `Columns: ${p.headers.join(", ")}`,
    `First ${Math.min(SAMPLE_ROWS, p.sampleRows.length)} rows:`,
    sample,
    `(Only the column names and these sample rows were included. The file itself stayed in the browser.)`,
  ].join("\n");
}
