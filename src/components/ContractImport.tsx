/**
 * ContractImport — load operational data through the ingest contract
 * (capability register C2.04, C8.03, C2.12, C6.10).
 *
 * This was MaintenancePlanImport, and it was welded to one entity type in three
 * places: the RPC argument, a hardcoded column list, and a payload literal that
 * named plan fields one by one. Everything else about it — batching, the run
 * lifecycle, the summary, the rendered rejects — was already entity-agnostic.
 *
 * WHY IT CARRIES EIGHT TYPES NOW. begin_manual_import named three, and four
 * more were fully validated and unreachable: condition_reading and
 * material_stock in ingest_batch, operating_state and production_record in
 * ingest_context_batch. The second function had never had a caller at all.
 * 20261004090000 gives the run a route so the RIGHT validator sees the rows,
 * and this screen is what a customer walks through to reach it. The eighth,
 * schedule_activity (20261112090000), is the P6 import half of D5.28: same
 * door, same route table, a third validator — P6 stays system-of-record and
 * Sync never writes back.
 *
 * WHY THERE IS ONE SCREEN AND NOT SEVEN. The parts that differ between entity
 * types are DATA — required columns, the dedupe key, what a re-upload does —
 * and they live in src/lib/ingest-entities.ts beside the reasons a person needs
 * them. A second importer component would be a fourth CSV path in this product,
 * after CSVImportWizard and FleetHistoryImport, and the third one already
 * disagreed with the other two about what a re-upload means.
 *
 * WHAT IS SAID BEFORE THE UPLOAD, NOT AFTER. The shipped screen told everybody
 * "a re-upload updates rather than duplicates" — true of three of the seven
 * types, false of the other four, which skip a re-upload as a duplicate. Every
 * sentence about identity, de-duplication and prerequisites is now per entity
 * and shown before the file is sent, because none of it is guessable from a
 * reject reason.
 */
import { useMemo, useState } from "react";
import {
  CircleAlert,
  Download,
  FileSpreadsheet,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { parseCSV } from "../lib/fleet-import";
import {
  INGEST_ENTITIES,
  INGEST_ENTITY_ORDER,
  preflight,
  templateCsv,
  templateHeader,
  toPayload,
  unrecognisedColumns,
  type Blocker,
  type IngestEntityKey,
} from "../lib/ingest-entities";

interface Reject {
  external_id: string | null;
  reject_reason: string;
}

interface Summary {
  read: number;
  accepted: number;
  duplicate: number;
  rejected: number;
}

const REJECT_LIMIT = 200;

export function ContractImport({
  initialEntity = "maintenance_plan",
}: {
  initialEntity?: IngestEntityKey;
}) {
  const [entityKey, setEntityKey] = useState<IngestEntityKey>(initialEntity);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rejects, setRejects] = useState<Reject[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entity = INGEST_ENTITIES[entityKey];

  const blockers: Blocker[] = useMemo(
    () => (rows.length > 0 ? preflight(entity, headers, rows) : []),
    [entity, headers, rows],
  );
  const ignored = useMemo(
    () => (headers.length > 0 ? unrecognisedColumns(entity, headers) : []),
    [entity, headers],
  );

  function clearFile() {
    setRows([]);
    setHeaders([]);
    setFileName(null);
    setSummary(null);
    setRejects([]);
    setMsg(null);
  }

  function chooseEntity(key: IngestEntityKey) {
    setEntityKey(key);
    clearFile();
  }

  async function onFile(f: File) {
    clearFile();
    setFileName(f.name);
    const all = parseCSV(await f.text());
    if (all.length < 2) {
      setMsg("The file needs a header row and at least one row of data.");
      return;
    }
    const [hdr, ...body] = all;
    const lower = hdr.map((h) => h.trim().toLowerCase());
    setHeaders(lower);
    setRows(
      body.map((r) =>
        Object.fromEntries(lower.map((h, i) => [h, (r[i] ?? "").trim()])),
      ),
    );
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv(entity)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `syncai-${entity.key.replace(/_/g, "-")}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function commit() {
    setBusy(true);
    setMsg(null);
    let runId: string | null = null;
    let finished = false;
    try {
      const { data: begin, error: beginErr } = await supabase.rpc(
        "begin_manual_import",
        { p_entity_type: entity.key, p_source_name: "Manual upload" },
      );
      if (beginErr) throw new Error(beginErr.message);
      const started = begin as { run_id?: string; error?: string };
      if (started.error || !started.run_id) {
        setMsg(started.error ?? "Could not start the import.");
        return;
      }
      runId = started.run_id;

      const totals: Summary = {
        read: 0,
        accepted: 0,
        duplicate: 0,
        rejected: 0,
      };
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows
          .slice(i, i + 500)
          .map((r, j) => toPayload(entity, r, i + j));
        // One RPC for every entity type. The RUN carries the entity type and
        // the router picks the validator, so this call site cannot send
        // operating states to the work-order validator the way a caller
        // choosing its own RPC could.
        const { data: res, error: batchErr } = await supabase.rpc(
          "ingest_rows",
          {
            p_run_id: runId,
            p_rows: batch,
          },
        );
        if (batchErr) throw new Error(batchErr.message);
        const counts = res as Partial<Summary> & { error?: string };
        if (counts.error) {
          setMsg(counts.error);
          return;
        }
        totals.read += counts.read ?? 0;
        totals.accepted += counts.accepted ?? 0;
        totals.duplicate += counts.duplicate ?? 0;
        totals.rejected += counts.rejected ?? 0;
      }

      await supabase.rpc("finish_connector_run", {
        p_run_id: runId,
        p_status: totals.rejected > 0 ? "partial" : "success",
      });
      finished = true;

      if (totals.rejected > 0) {
        const { data: rej } = await supabase.rpc("get_import_rejects", {
          p_run_id: runId,
          p_limit: REJECT_LIMIT,
        });
        setRejects((rej ?? []) as Reject[]);
      }
      setSummary(totals);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      // A run left `running` never completes and shows the connector as stale
      // for ever. The shipped component returned from inside the try on a
      // mid-batch error and leaked exactly that.
      if (runId && !finished) {
        await supabase.rpc("finish_connector_run", {
          p_run_id: runId,
          p_status: "failure",
          p_error: "Upload stopped before every batch was sent",
        });
      }
      setBusy(false);
    }
  }

  const canCommit = rows.length > 0 && blockers.length === 0 && !busy;

  return (
    <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-5">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm text-slate-200">
          Import through the ingest contract
        </h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        The same contract a live CMMS connector uses: every row is validated,
        every refused row is kept with its reason, and a run's watermark only
        advances when the run is clean. Choose what you are loading — the rules
        differ, and they are stated below before you upload.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {INGEST_ENTITY_ORDER.map((key) => {
          const active = key === entityKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => chooseEntity(key)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-lg border border-signal-cyan/40 bg-signal-cyan/10 px-2.5 py-1.5 text-xs text-signal-cyan"
                  : "rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              }
            >
              {INGEST_ENTITIES[key].label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-white/8 bg-overlook-void/40 px-4 py-3">
        <p className="text-xs leading-relaxed text-slate-300">
          {entity.purpose}
        </p>

        {entity.prerequisite && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-300">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">Load this first: </span>
              {entity.prerequisite}
            </span>
          </p>
        )}

        <p className="mt-3 text-xs text-slate-500">Columns</p>
        <ul className="mt-1 space-y-0.5">
          {entity.columns.map((c) => (
            <li key={c.name} className="text-xs text-slate-400">
              <span className="font-mono text-slate-300">{c.name}</span>
              {c.required && (
                <span className="text-amber-300/80"> · required</span>
              )}
              <span className="text-slate-500"> — {c.note}</span>
            </li>
          ))}
        </ul>
        {(entity.requiredOneOf ?? []).map((group) => (
          <p key={group.join("|")} className="mt-1 text-xs text-amber-300/80">
            Every row needs one of: {group.join(", ")}
          </p>
        ))}

        <p className="mt-3 text-xs text-slate-400">
          <span className="text-slate-500">Identity — </span>
          each row is identified by{" "}
          <span className="font-mono text-slate-300">
            {entity.externalIdFrom}
          </span>
          , and the contract deduplicates on {entity.dedupe}.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          <span className="text-slate-500">Re-uploading — </span>
          {entity.reuploadSentence}
        </p>
        {entity.caution && (
          <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-amber-200/90">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{entity.caution}</span>
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Once rows land: {entity.outcome}
        </p>

        <button
          type="button"
          onClick={downloadTemplate}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
        >
          <Download className="h-3.5 w-3.5" />
          Download {entity.label.toLowerCase()} template
        </button>
      </div>

      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">
        <Upload className="h-3.5 w-3.5" />
        Choose CSV
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
      {fileName && (
        <span className="ml-2 text-xs text-slate-500">{fileName}</span>
      )}

      {msg && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {msg}
        </p>
      )}

      {ignored.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Columns this import does not read, and will ignore:{" "}
          <span className="font-mono">{ignored.join(", ")}</span>
        </p>
      )}

      {blockers.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-amber-200">
            {blockers.length} thing(s) to fix before this file can be sent.
            These are not refusals the contract would keep for you — a cell the
            database cannot read stops the whole upload, taking the record of
            every other refused row with it, so the file is checked here first.
          </p>
          {blockers.slice(0, 50).map((b, i) => (
            <p
              key={`${b.row}-${b.column}-${i}`}
              className="text-xs text-slate-400"
            >
              <span className="font-mono text-slate-500">
                {b.row === null ? "file" : `row ${b.row}`}
              </span>{" "}
              — {b.message}
            </p>
          ))}
          {blockers.length > 50 && (
            <p className="text-xs text-slate-500">
              …and {blockers.length - 50} more.
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && blockers.length === 0 && (
        <div className="mt-3">
          <p className="text-xs text-slate-400">
            {rows.length} row(s) parsed and checked against the{" "}
            {templateHeader(entity).length} columns this import reads. Anything
            the contract refuses is kept with its reason and shown below.
          </p>
          <button
            onClick={commit}
            disabled={!canCommit}
            className="mt-2 rounded-lg border border-signal-cyan/40 bg-signal-cyan/10 px-3 py-2 text-xs text-signal-cyan disabled:opacity-50"
          >
            {busy
              ? "Importing…"
              : `Import ${rows.length} row(s) through the contract`}
          </button>
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-lg border border-white/8 bg-overlook-void/40 px-4 py-3 text-xs text-slate-300">
          Read {summary.read} · accepted {summary.accepted} · duplicate{" "}
          {summary.duplicate} · rejected {summary.rejected}
          {summary.duplicate > 0 && (
            <span className="block pt-1 text-slate-500">
              {summary.duplicate} row(s) were already loaded under the same
              identity and were skipped, not written twice.
            </span>
          )}
          {summary.accepted > 0 && (
            <span className="block pt-1 text-slate-500">{entity.outcome}</span>
          )}
          {summary.rejected > 0 && (
            <span className="block pt-1 text-slate-500">
              This run finished as “partial”, so the connector's watermark did
              not advance. Fix the rows below and upload them again.
            </span>
          )}
        </div>
      )}

      {rejects.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-amber-200">
            Refused rows — kept, not dropped:
          </p>
          {rejects.map((r, i) => (
            <p key={`${r.external_id}-${i}`} className="text-xs text-slate-400">
              <span className="font-mono text-slate-500">
                {r.external_id ?? "(no id)"}
              </span>{" "}
              — {r.reject_reason}
            </p>
          ))}
          {summary && summary.rejected > rejects.length && (
            <p className="text-xs text-slate-500">
              Showing {rejects.length} of {summary.rejected} refused rows.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
