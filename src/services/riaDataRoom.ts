/**
 * The Data Room's client side.
 *
 * PROFILING REUSES THE REPOSITORY'S CSV READER. The shipped upload path
 * computed `record_count` as `text.split(/\r?\n/).filter(Boolean).length - 1`,
 * which over-counts every export containing a quoted field with a line break
 * inside it. Work-order long_text does that routinely, so the number shown
 * against a work-order export was reliably wrong and reliably too big.
 * `parseCSV` in src/lib/fleet-import already handles quoting, escaped quotes
 * and the Excel BOM, and `profileColumns` already computes non-empty share,
 * distinct counts and numeric/date shares. Both are used here rather than
 * a second parser being written against the same files.
 *
 * WHAT THE BROWSER MAY DECIDE, AND WHAT IT MAY NOT. Everything here is a
 * measurement — row counts, coverage dates, which required fields are absent.
 * Green/Amber/Red is a judgement about whether the customer's question can be
 * answered from what arrived, and this module cannot set one: the only path is
 * set_ria_dataset_readiness(), which is role-gated and refuses a colour with no
 * reason. The distinction is the specification's, and it is why the readiness
 * shown to a customer cannot be produced by an upload.
 */
import { supabase } from "../lib/supabase";
import { parseCSV, profileColumns } from "../lib/fleet-import";

/** The intake pack's datasets. Keys match the categories already persisted. */
export type DatasetKey =
  | "asset_register"
  | "work_orders"
  | "pm_plans"
  | "downtime_meter"
  | "dealer_oem"
  | "operating_measure"
  | "alias_map";

export type Readiness =
  "missing" | "received" | "profiled" | "green" | "amber" | "red";

export interface DatasetSlot {
  id: string;
  assessment_id: string;
  organization_id: string;
  dataset_key: DatasetKey;
  requirement: "required" | "preferred" | "optional";
  label: string;
  minimum_fields: string[];
  preferred_history: string | null;
  readiness: Readiness;
  readiness_note: string | null;
  rated_at: string | null;
}

export interface DataRoomSource {
  id: string;
  assessment_id: string;
  slot_id: string | null;
  category: string;
  file_name: string;
  status: string;
  quality_grade: string;
  record_count: number | null;
  row_count: number | null;
  column_count: number | null;
  identifier_coverage: number | null;
  coverage_from: string | null;
  coverage_to: string | null;
  dq_exceptions: Array<{ rows?: number; reason?: string }>;
  missing_required_fields: string[];
  object_path: string;
  content_sha256: string | null;
  /**
   * §3's Data Source sensitivity. Defaults to customer_confidential in the
   * schema rather than to nothing: for a workspace holding a customer's raw
   * CMMS exports, "unclassified" is not a safe default, it is an absent
   * decision.
   */
  sensitivity:
    | "customer_confidential"
    | "commercially_sensitive"
    | "personal_data"
    | "public";
  raw_retained: boolean;
  profiled_at: string | null;
  deleted_at: string | null;
  delete_note: string | null;
  notes: string | null;
  created_at: string;
}

export interface Clarification {
  id: string;
  dataset_key: string | null;
  question: string;
  context: string | null;
  blocks_analysis: boolean;
  status: "open" | "answered" | "withdrawn";
  answer: string | null;
  asked_at: string;
  answered_at: string | null;
}

export interface AssetAlias {
  id: string;
  source_system: string;
  source_alias: string;
  canonical_asset_id: string | null;
  canonical_asset_ref: string | null;
  resolved: boolean;
  notes: string | null;
}

/** get_ria_readiness()'s four conditions, kept separate on purpose. */
export interface ReadinessRollup {
  assessment_id: string;
  scope_confirmed: boolean;
  asset_register_received: boolean;
  work_orders_received: boolean;
  primary_question_agreed: boolean;
  gaps_explicitly_logged: boolean;
  kickoff_data_ready: boolean;
  required_datasets_missing: number;
  open_blocking_clarifications: number;
  slots: Array<{
    slot_id: string;
    dataset_key: DatasetKey;
    label: string;
    requirement: string;
    readiness: Readiness;
    readiness_note: string | null;
    sources: number;
  }>;
}

export interface DataRoomState {
  slots: DatasetSlot[];
  sources: DataRoomSource[];
  clarifications: Clarification[];
  aliases: AssetAlias[];
  readiness: ReadinessRollup | null;
}

/**
 * The pack's §3 required fields, per dataset. `*` in the pack means "required
 * where the dataset is supplied", so these are what a profile checks for — an
 * absent one is reported, never invented.
 */
export const REQUIRED_FIELDS: Record<DatasetKey, string[]> = {
  asset_register: [
    "asset_id",
    "asset_description",
    "asset_class",
    "site_or_fleet",
    "status",
  ],
  work_orders: [
    "work_order_id",
    "asset_id",
    "created_date",
    "complete_date",
    "work_type",
    "status",
    "short_text",
  ],
  pm_plans: [
    "pm_id",
    "asset_id_or_class",
    "task_name",
    "trigger_type",
    "frequency",
    "frequency_unit",
    "active_status",
  ],
  downtime_meter: ["asset_id", "period_start", "period_end"],
  dealer_oem: [
    "external_event_id",
    "asset_id_or_alias",
    "vendor",
    "event_date",
  ],
  operating_measure: ["asset_id", "period_start", "period_end"],
  alias_map: ["source_system", "source_alias"],
};

/** Header text normalised so "Asset ID", "asset-id" and "asset_id" agree. */
function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

const DATE_LIKE = /^(\d{4})-(\d{2})-(\d{2})/;

function toISODate(value: string): string | null {
  const trimmed = value.trim();
  const iso = DATE_LIKE.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    // Ambiguous by construction (dd/mm vs mm/dd). Coverage is reported as a
    // range, so the safe reading is the one that cannot invent a wider window
    // than the data supports: treat the first field as the month only when it
    // cannot be a month, and otherwise leave the ambiguity visible upstream.
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export interface SourceProfile {
  row_count: number;
  column_count: number;
  headers: string[];
  identifier_coverage: number | null;
  coverage_from: string | null;
  coverage_to: string | null;
  missing_required_fields: string[];
  dq_exceptions: Array<{ rows: number; reason: string }>;
  content_sha256: string | null;
  columns: Record<string, unknown>;
}

/** sha-256 of the file, computed in the browser. Null where unavailable. */
export async function fingerprint(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const bytes = new TextEncoder().encode(text);
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * Measures one export against its dataset's required fields.
 *
 * Returns what is THERE. A dataset with no identifier column reports
 * identifier_coverage null rather than 0, because "no such column" and "the
 * column is empty" are different facts and a customer is owed the difference.
 */
export async function profileFile(
  datasetKey: DatasetKey,
  text: string,
): Promise<SourceProfile> {
  const grid = parseCSV(text);
  const headers = (grid[0] ?? []).map((h) => h.trim());
  const rows = grid.slice(1);
  const profiles = profileColumns(headers, rows);
  const normalised = headers.map(normaliseHeader);

  const required = REQUIRED_FIELDS[datasetKey] ?? [];
  const missing = required.filter((field) => !normalised.includes(field));

  // Identifier coverage: the share of rows carrying the dataset's key column.
  const idField = required[0];
  const idIndex = idField ? normalised.indexOf(idField) : -1;
  const identifierCoverage =
    idIndex >= 0 && rows.length > 0
      ? (profiles[idIndex]?.nonEmpty ?? 0) / rows.length
      : null;

  // Date coverage across every column that reads as a date in most of its rows.
  let from: string | null = null;
  let to: string | null = null;
  profiles.forEach((profile, index) => {
    if (profile.dateShare < 0.6) return;
    for (const row of rows) {
      const iso = toISODate((row[index] ?? "").toString());
      if (!iso) continue;
      if (from === null || iso < from) from = iso;
      if (to === null || iso > to) to = iso;
    }
  });

  const exceptions: Array<{ rows: number; reason: string }> = [];
  for (const field of required) {
    const index = normalised.indexOf(field);
    if (index < 0) continue;
    const blank = rows.length - (profiles[index]?.nonEmpty ?? 0);
    if (blank > 0)
      exceptions.push({ rows: blank, reason: `${field} is blank` });
  }
  const widthMismatch = rows.filter((r) => r.length !== headers.length).length;
  if (widthMismatch > 0) {
    exceptions.push({
      rows: widthMismatch,
      reason: `row has a different column count to the header`,
    });
  }

  const columns: Record<string, unknown> = {};
  profiles.forEach((profile) => {
    columns[profile.header] = {
      nonEmpty: profile.nonEmpty,
      distinct: profile.distinct,
      numericShare: Number(profile.numericShare.toFixed(3)),
      dateShare: Number(profile.dateShare.toFixed(3)),
      samples: profile.samples,
    };
  });

  return {
    row_count: rows.length,
    column_count: headers.length,
    headers,
    identifier_coverage: identifierCoverage,
    coverage_from: from,
    coverage_to: to,
    missing_required_fields: missing,
    dq_exceptions: exceptions,
    content_sha256: await fingerprint(text),
    columns,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function selectRows<T>(
  table: string,
  assessmentId: string,
  order: string,
): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("assessment_id", assessmentId)
    .order(order, { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function loadDataRoom(
  assessmentId: string,
): Promise<DataRoomState> {
  const [slots, sources, clarifications, aliases] = await Promise.all([
    selectRows<DatasetSlot>("ria_dataset_slots", assessmentId, "dataset_key"),
    selectRows<DataRoomSource>("ria_data_sources", assessmentId, "created_at"),
    selectRows<Clarification>("ria_clarifications", assessmentId, "asked_at"),
    selectRows<AssetAlias>("ria_asset_aliases", assessmentId, "source_alias"),
  ]);
  return {
    slots,
    sources,
    clarifications,
    aliases,
    readiness: await loadReadiness(assessmentId),
  };
}

export async function loadReadiness(
  assessmentId: string,
): Promise<ReadinessRollup | null> {
  const { data, error } = await supabase.rpc("get_ria_readiness", {
    p_assessment_id: assessmentId,
  });
  if (error) throw new Error(error.message);
  const result = data as (ReadinessRollup & { error?: string }) | null;
  if (!result) return null;
  if (result.error) throw new Error(result.error);
  return result;
}

// ---------------------------------------------------------------------------
// Writes. Every one goes through an RPC that returns {error} rather than
// throwing, so a refusal is a message the person reads — not a silent no-op.
// ---------------------------------------------------------------------------

/** Unwraps the house jsonb error contract. */
function unwrap(data: unknown, fallback: string): Record<string, unknown> {
  const result = (data ?? {}) as Record<string, unknown>;
  if (typeof result.error === "string") throw new Error(result.error);
  if (Object.keys(result).length === 0) throw new Error(fallback);
  return result;
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return unwrap(data, `${name} returned nothing`);
}

export async function recordSourceProfile(
  sourceId: string,
  profile: SourceProfile,
): Promise<void> {
  await callRpc("record_ria_source_profile", {
    p_source_id: sourceId,
    p_profile: {
      row_count: profile.row_count,
      column_count: profile.column_count,
      identifier_coverage: profile.identifier_coverage,
      coverage_from: profile.coverage_from,
      coverage_to: profile.coverage_to,
      content_sha256: profile.content_sha256,
      columns: profile.columns,
      dq_exceptions: profile.dq_exceptions,
      missing_required_fields: profile.missing_required_fields,
    },
  });
}

export async function rateDataset(
  slotId: string,
  readiness: "green" | "amber" | "red",
  note: string,
): Promise<void> {
  await callRpc("set_ria_dataset_readiness", {
    p_slot_id: slotId,
    p_readiness: readiness,
    p_note: note,
  });
}

/**
 * Retire a source, then actually remove the raw export.
 *
 * THE ORDER IS THE POINT, AND SO IS THE HONESTY OF THE RESULT. The stub is
 * written first, so a failure at any later step still leaves an accountable
 * record. Storage removal only becomes permitted once `deleted_at` is set —
 * that is what `ria_source_files_delete` keys on. `raw_retained` is flipped by
 * confirm_ria_source_raw_purged() ONLY after the object is gone, never in
 * anticipation: a retention claim set in hope is a false one, and the Data
 * Room renders this flag to the customer verbatim.
 *
 * A failed removal is reported, not swallowed. The source is retired either
 * way; what the caller learns is whether the file is still in the bucket.
 */
export async function retireSource(
  sourceId: string,
  note: string,
  retentionBasis?: string,
  objectPath?: string,
): Promise<{ retired: true; rawPurged: boolean; purgeError?: string }> {
  await callRpc("retire_ria_data_source", {
    p_source_id: sourceId,
    p_note: note,
    p_retention_basis: retentionBasis ?? null,
  });

  if (!objectPath) {
    return {
      retired: true,
      rawPurged: false,
      purgeError:
        "The audit stub is written. The raw export was not purged because its storage path was not supplied.",
    };
  }

  const { error: removeError } = await supabase.storage
    .from("ria-source-files")
    .remove([objectPath]);
  if (removeError) {
    return { retired: true, rawPurged: false, purgeError: removeError.message };
  }

  await callRpc("confirm_ria_source_raw_purged", {
    p_source_id: sourceId,
    p_note: "Storage object removed by the client after retirement.",
  });
  return { retired: true, rawPurged: true };
}

export async function openClarification(
  assessmentId: string,
  question: string,
  datasetKey?: string,
  blocksAnalysis = false,
): Promise<void> {
  await callRpc("open_ria_clarification", {
    p_assessment_id: assessmentId,
    p_question: question,
    p_dataset_key: datasetKey ?? null,
    p_data_source_id: null,
    p_blocks_analysis: blocksAnalysis,
  });
}

export async function answerClarification(
  clarificationId: string,
  answer: string,
): Promise<void> {
  await callRpc("answer_ria_clarification", {
    p_clarification_id: clarificationId,
    p_answer: answer,
  });
}

/**
 * An alias resolves to the CANONICAL asset when one is named.
 *
 * This used to hardcode `p_canonical_asset_id: null`, which made
 * ria_asset_aliases.canonical_asset_id permanently NULL: `resolved` could only
 * ever be earned by free text, and the RPC's org-checked asset lookup was
 * unreachable from the application. Invariant 1 is one canonical asset
 * hierarchy — an alias map that can only point at a string is a second one.
 */
export async function upsertAlias(
  assessmentId: string,
  sourceSystem: string,
  sourceAlias: string,
  canonicalAssetRef?: string,
  notes?: string,
  canonicalAssetId?: string,
): Promise<void> {
  await callRpc("upsert_ria_asset_alias", {
    p_assessment_id: assessmentId,
    p_source_system: sourceSystem,
    p_source_alias: sourceAlias,
    p_canonical_asset_id: canonicalAssetId ?? null,
    p_canonical_asset_ref: canonicalAssetRef ?? null,
    p_notes: notes ?? null,
  });
}

/**
 * Assets in the caller's organization, for resolving an alias to one of them.
 * RLS scopes it; this function does not filter by org and must not, because a
 * browser-side org filter is a suggestion.
 */
export async function loadCanonicalAssets(): Promise<
  Array<{ id: string; name: string; tag: string | null }>
> {
  const { data, error } = await supabase
    .from("assets")
    .select("id,name,tag")
    .order("name")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    name: string;
    tag: string | null;
  }>;
}

/**
 * Upload: object to storage, metadata row, then the profile.
 *
 * The metadata insert is what the audit stub is made of, so a failure there is
 * not survivable — the object is removed and the caller is told. Profiling
 * failing is survivable: the source is received and visible, just not yet
 * measured, which is a state the slot vocabulary already has a word for.
 */
export async function uploadSource(
  organizationId: string,
  assessmentId: string,
  datasetKey: DatasetKey,
  file: File,
): Promise<{ sourceId: string; profiled: boolean; profileError?: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 140);
  const path = `${organizationId}/${assessmentId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("ria-source-files")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (uploadError) throw new Error(uploadError.message);

  const { data: userData } = await supabase.auth.getUser();
  const { data: inserted, error: insertError } = await supabase
    .from("ria_data_sources")
    .insert({
      assessment_id: assessmentId,
      organization_id: organizationId,
      category: datasetKey,
      file_name: file.name,
      object_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: userData?.user?.id ?? null,
    })
    .select("id")
    .maybeSingle();

  // An RLS refusal is zero rows and no error. Treating that as success is how
  // a refused write becomes a green tick (the failure ApprovalQueue.test.tsx
  // exists to prevent), so the absent row is the error here.
  if (insertError || !inserted) {
    // The cleanup can itself be refused — `ria_source_files_delete` matches the
    // uploader on `owner`/`owner_id`, and storage-api does not always populate
    // the deprecated `owner`. A silently failed remove leaves raw customer data
    // in the bucket with no metadata row to account for it, so it is reported
    // alongside the refusal rather than assumed.
    const { error: removeError } = await supabase.storage
      .from("ria-source-files")
      .remove([path]);
    const base =
      insertError?.message ??
      "The assessment source could not be recorded — the upload was refused. Your role may not permit supplying assessment data.";
    throw new Error(
      removeError
        ? `${base} The uploaded file could NOT be removed from storage (${removeError.message}) — it is at ${path} and needs clearing.`
        : base,
    );
  }

  const sourceId = String((inserted as { id: string }).id);

  const isCsv =
    file.type.includes("csv") || file.name.toLowerCase().endsWith(".csv");
  if (!isCsv || file.size > 25_000_000) {
    return {
      sourceId,
      profiled: false,
      profileError: isCsv
        ? "File is too large to profile in the browser; profile it server-side before rating the dataset."
        : "Only CSV exports are profiled in the browser. The file is recorded and awaiting profiling.",
    };
  }

  try {
    const profile = await profileFile(datasetKey, await file.text());
    await recordSourceProfile(sourceId, profile);
    return { sourceId, profiled: true };
  } catch (error) {
    return {
      sourceId,
      profiled: false,
      profileError:
        error instanceof Error ? error.message : "Profiling failed.",
    };
  }
}
