/**
 * Fleet-history import: profiling, mapping proposal and vocabulary
 * classification (capability register U21.02, C9.01).
 *
 * The auxiliary fleet — 21,450 down events, 79 vocabulary codes — was loaded
 * by a hand-written parser. That is the right way to explore a dataset once
 * and the wrong way to run a customer onboarding, because the parser made
 * judgement calls the customer never saw: that unit numbers repeat across
 * equipment types, that MIDLIFE is an activity rather than a failure, that
 * timestamps beat a disagreeing duration column.
 *
 * So this module PROPOSES and never decides. Every function returns a
 * suggestion with the evidence behind it and a confidence, for a human to
 * confirm or overrule. Nothing here writes anything.
 */

export type ColumnRole =
  | "asset_name"
  | "asset_type"
  | "unit_number"
  | "start_date"
  | "start_time"
  | "end_date"
  | "end_time"
  | "duration_hours"
  | "reason_code"
  | "comment"
  | "ignore";

export interface ColumnProfile {
  header: string;
  index: number;
  nonEmpty: number;
  distinct: number;
  samples: string[];
  /** Share of non-empty values that parse as a number. */
  numericShare: number;
  /** Share that parse as a date or datetime. */
  dateShare: number;
  /** Share that look like a clock time. */
  timeShare: number;
}

export interface ColumnSuggestion {
  header: string;
  index: number;
  role: ColumnRole;
  confidence: "high" | "medium" | "low";
  why: string;
}

const NUM = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}/;
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

export function profileColumns(
  headers: string[],
  rows: string[][],
  sampleLimit = 2000,
): ColumnProfile[] {
  const take = rows.slice(0, sampleLimit);
  return headers.map((header, index) => {
    const vals = take
      .map((r) => (r[index] ?? "").toString().trim())
      .filter((v) => v.length > 0);
    const distinct = new Set(vals);
    const n = Math.max(vals.length, 1);
    return {
      header,
      index,
      nonEmpty: vals.length,
      distinct: distinct.size,
      samples: [...distinct].slice(0, 5),
      numericShare: vals.filter((v) => NUM.test(v)).length / n,
      dateShare: vals.filter((v) => DATE.test(v)).length / n,
      timeShare: vals.filter((v) => TIME.test(v)).length / n,
    };
  });
}

/**
 * Proposes a role per column from the header text and the values beneath it.
 *
 * Header text alone is not trusted: real exports repeat "Date" and "Time" for
 * both ends of an event — the auxiliary sheet did exactly that — so ORDER
 * disambiguates the second pair, and the shape of the data has to agree.
 */
export function suggestMapping(profiles: ColumnProfile[]): ColumnSuggestion[] {
  const out: ColumnSuggestion[] = [];
  let dateSeen = 0;
  let timeSeen = 0;

  for (const p of profiles) {
    const h = p.header.toLowerCase().trim();
    const say = (
      role: ColumnRole,
      confidence: ColumnSuggestion["confidence"],
      why: string,
    ) => out.push({ header: p.header, index: p.index, role, confidence, why });

    if (p.nonEmpty === 0) {
      say("ignore", "high", "Column is entirely empty.");
      continue;
    }

    if (p.dateShare > 0.8) {
      dateSeen += 1;
      if (dateSeen === 1)
        say(
          "start_date",
          "high",
          "First date-shaped column; events start before they end.",
        );
      else if (dateSeen === 2)
        say("end_date", "high", "Second date-shaped column.");
      else
        say(
          "ignore",
          "low",
          "A third date column — unclear which event boundary it marks.",
        );
      continue;
    }
    if (p.timeShare > 0.8) {
      timeSeen += 1;
      if (timeSeen === 1) say("start_time", "high", "First clock-time column.");
      else if (timeSeen === 2)
        say("end_time", "high", "Second clock-time column.");
      else say("ignore", "low", "A third time column.");
      continue;
    }
    if (/duration|hours|hrs|downtime/.test(h) && p.numericShare > 0.8) {
      say("duration_hours", "high", "Numeric column named for duration.");
      continue;
    }
    if (/equip.*(type|class)|^equipment$|^type$|class|category|model/.test(h)) {
      say(
        "asset_type",
        p.distinct < 60 ? "high" : "medium",
        `${p.distinct} distinct values — a class vocabulary rather than an identifier.`,
      );
      continue;
    }
    if (/unit|equip.*#|equip.*no|asset.*(id|no|#)|tag|fleet.*no/.test(h)) {
      say("unit_number", "high", "Header names a unit or equipment number.");
      continue;
    }
    if (/reason|complaint|failure|fault|cause|problem|code/.test(h)) {
      say(
        "reason_code",
        p.distinct < 300 ? "high" : "medium",
        `${p.distinct} distinct values — a coded vocabulary.`,
      );
      continue;
    }
    if (/comment|description|detail|note|remark|narrative/.test(h)) {
      say("comment", "high", "Free-text description.");
      continue;
    }
    if (/asset.*name|^name$|^description$/.test(h) && p.distinct > 5) {
      say("asset_name", "medium", "Looks like an asset label.");
      continue;
    }
    say("ignore", "low", "No role inferred from the header or the values.");
  }
  return out;
}

/**
 * A mapping is usable only if the event can be located in time and attached to
 * an asset. This states what is missing rather than failing at load.
 */
export function validateMapping(sugg: { role: ColumnRole }[]): {
  usable: boolean;
  missing: string[];
  notes: string[];
} {
  const roles = new Set(sugg.map((s) => s.role));
  const missing: string[] = [];
  const notes: string[] = [];

  if (!roles.has("asset_name") && !roles.has("unit_number"))
    missing.push("an asset name or unit number");
  if (!roles.has("start_date")) missing.push("a start date");
  if (!roles.has("end_date") && !roles.has("duration_hours"))
    missing.push("an end date or a duration");
  if (!roles.has("reason_code"))
    notes.push(
      "No reason code mapped. Events will load, but nothing can be segmented by system group or failure mode.",
    );
  if (roles.has("unit_number") && !roles.has("asset_type"))
    notes.push(
      "Unit numbers without an equipment type: if the same number is reused across equipment types the assets will merge. On the auxiliary fleet that would have merged twenty machines into ten.",
    );
  if (roles.has("end_date") && roles.has("duration_hours"))
    notes.push(
      "Both an end date and a duration are mapped. Timestamps will be treated as authoritative and disagreements reported, not silently averaged.",
    );
  return { usable: missing.length === 0, missing, notes };
}

export type LabelKind =
  "system_group" | "activity_type" | "delay_reason" | "unclassified";

export interface LabelSuggestion {
  label: string;
  count: number;
  kind: LabelKind;
  confidence: "high" | "medium" | "low";
  why: string;
}

const DELAY =
  /^(wait|waiting)\b|awaiting|\bdelay\b|out of fuel|no operator|standby for/i;
const ACTIVITY =
  /\b(planned|scheduled|preventive|pm\b|inspection|service|overhaul|midlife|rebuild|troubleshoot|oil sample|steaming|training|relocate|towing|contractor|welding|top up|testing|opportune)\b/i;
const SYSTEM =
  /\b(system|group|engine|hydraulic|brake|steering|transmission|undercarriage|tire|rim|electrical|cab|frame|drive|pump|boom|bucket|track|cooling|fuel|lube|air|generator|motor|valve|cylinder|bearing|gear)\b/i;

/**
 * Proposes what each distinct code IS. This is the judgement that most changes
 * the numbers downstream: a planned service counted as a failure inflates
 * every reliability metric, and a wait counted as work inflates maintenance
 * effort. Delay is tested FIRST because "WAIT PARTS - ENGINE" is a wait, not
 * an engine failure, and the system-group pattern would otherwise claim it.
 */
export function suggestVocabulary(
  counts: Map<string, number>,
): LabelSuggestion[] {
  const out: LabelSuggestion[] = [];
  for (const [raw, count] of counts) {
    const label = raw.trim();
    if (!label) continue;
    if (DELAY.test(label)) {
      out.push({
        label,
        count,
        kind: "delay_reason",
        confidence: "high",
        why: "Names a wait or a non-maintenance stoppage — this is delay, not work.",
      });
    } else if (ACTIVITY.test(label)) {
      out.push({
        label,
        count,
        kind: "activity_type",
        confidence: "high",
        why: "Names planned or investigative work rather than something that failed.",
      });
    } else if (SYSTEM.test(label)) {
      out.push({
        label,
        count,
        kind: "system_group",
        confidence: "medium",
        why: "Names an equipment system. Note this is a system group, not a failure mechanism.",
      });
    } else {
      out.push({
        label,
        count,
        kind: "unclassified",
        confidence: "low",
        why: "No pattern matched. Classify before it is used in analysis.",
      });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface RowVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * The same validation the load will apply, run against the sample so a human
 * sees what would be rejected BEFORE anything is written.
 */
export function previewRow(
  get: (role: ColumnRole) => string | undefined,
): RowVerdict {
  const unit = get("unit_number") || get("asset_name");
  if (!unit) return { ok: false, reason: "no asset name or unit number" };
  const sd = get("start_date");
  if (!sd) return { ok: false, reason: "no start date" };
  const ed = get("end_date");
  const dur = get("duration_hours");
  if (!ed && !dur)
    return { ok: false, reason: "neither an end date nor a duration" };
  if (dur !== undefined && dur !== "" && !NUM.test(dur.trim()))
    return { ok: false, reason: `duration "${dur}" is not a number` };
  if (dur !== undefined && NUM.test((dur || "").trim()) && parseFloat(dur) < 0)
    return { ok: false, reason: "negative duration" };
  return { ok: true };
}

export interface ImportPreview {
  rows: number;
  willLoad: number;
  willReject: number;
  rejectReasons: { reason: string; count: number }[];
}

export function previewImport(
  rows: string[][],
  mapping: { role: ColumnRole; index: number }[],
): ImportPreview {
  const byRole = new Map<ColumnRole, number>();
  for (const m of mapping) if (m.role !== "ignore") byRole.set(m.role, m.index);
  const reasons = new Map<string, number>();
  let ok = 0;
  for (const r of rows) {
    const v = previewRow((role) => {
      const i = byRole.get(role);
      return i === undefined ? undefined : (r[i] ?? "").toString();
    });
    if (v.ok) ok += 1;
    else reasons.set(v.reason!, (reasons.get(v.reason!) ?? 0) + 1);
  }
  return {
    rows: rows.length,
    willLoad: ok,
    willReject: rows.length - ok,
    rejectReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * RFC 4180 CSV parsing.
 *
 * The existing asset wizard parses with `line.split(",")`, which silently
 * corrupts any row containing a quoted comma — and maintenance comments are
 * full of them ("REPLACED SEAL, PRESSURE TESTED"). A field split in half
 * shifts every later column on that row, so the failure does not look like a
 * parse error; it looks like data.
 *
 * Handles quoted fields, embedded commas, embedded newlines, and the doubled
 * quote escape. Kept dependency-free deliberately: xlsx support needs a
 * parsing library, and adding one to a platform pursuing SOC 2 is a
 * supply-chain decision to take on its own merits rather than smuggle in here.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  // Strip a UTF-8 BOM: Excel writes one, and it otherwise becomes part of the
  // first header, which then matches nothing.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      endField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
