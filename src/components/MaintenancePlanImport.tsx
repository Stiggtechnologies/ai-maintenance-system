/**
 * MaintenancePlanImport — load a PM programme through the ingest contract
 * (capability register C6.10, C2.12).
 *
 * Until this existed, get_work_management_health reported PM compliance as
 * "PROXY — ... Load maintenance_plans to measure compliance against work
 * actually due" and no customer could perform the remedy it named: the
 * contract's entry point registers connectors disabled and admin-only, and
 * nothing enabled one. begin_manual_import is the narrow door — role-gated,
 * one connector per entity type so a re-upload deduplicates instead of
 * duplicating.
 *
 * Rejects are rendered, not merely retained. The contract keeps every refused
 * row with its reason precisely so a connector cannot report success while
 * losing data — which only means something if the person who uploaded is shown
 * what was refused and why.
 *
 * Nothing here invents an interval. The CSV is the customer's own programme;
 * the `source` column carries their stated basis for each interval, and rows
 * without one are recorded as "Ingested from manual upload", which is
 * provenance, not an engineering claim.
 */
import { useState } from "react";
import { FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { parseCSV } from "../lib/fleet-import";

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

// The columns ingest_batch validates for maintenance_plan (20260905090000):
// asset by name or id, task_label, interval_value, optional basis/last/source.
const EXPECTED = [
  "asset_name",
  "task_code",
  "task_label",
  "interval_basis",
  "interval_value",
  "last_performed_at",
  "source",
] as const;

export function MaintenancePlanImport() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rejects, setRejects] = useState<Reject[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File) {
    setMsg(null);
    setSummary(null);
    setRejects([]);
    const text = await f.text();
    const all = parseCSV(text);
    if (all.length < 2) {
      setMsg("The file needs a header row and at least one plan.");
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

  async function commit() {
    setBusy(true);
    setMsg(null);
    try {
      const { data: begin, error: beginErr } = await supabase.rpc(
        "begin_manual_import",
        { p_entity_type: "maintenance_plan", p_source_name: "Manual upload" },
      );
      if (beginErr) throw new Error(beginErr.message);
      const started = begin as { run_id?: string; error?: string };
      if (started.error || !started.run_id) {
        setMsg(started.error ?? "Could not start the import.");
        return;
      }
      const runId = started.run_id;

      const totals: Summary = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r, j) => ({
          external_id: r.task_code || `upload-row-${i + j + 1}`,
          asset_name: r.asset_name || null,
          task_code: r.task_code || null,
          task_label: r.task_label || null,
          interval_basis: r.interval_basis || null,
          interval_value: r.interval_value || null,
          last_performed_at: r.last_performed_at || null,
          source: r.source || null,
        }));
        const { data: res, error: batchErr } = await supabase.rpc("ingest_batch", {
          p_run_id: runId,
          p_rows: batch,
        });
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

      if (totals.rejected > 0) {
        const { data: rej } = await supabase.rpc("get_import_rejects", {
          p_run_id: runId,
        });
        setRejects((rej ?? []) as Reject[]);
      }
      setSummary(totals);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const missingHeaders =
    headers.length > 0 && !headers.includes("task_label")
      ? "The file needs at least a task_label column. Recognised columns: " +
        EXPECTED.join(", ")
      : null;

  return (
    <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-5">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm text-slate-200">Import maintenance plans</h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Your PM programme, from a CSV. Until plans are loaded, PM compliance is
        computed against work raised rather than work due, and says so on its
        face. Intervals are yours: the source column should say where each one
        came from.
      </p>

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

      {msg && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {msg}
        </p>
      )}
      {missingHeaders && (
        <p className="mt-3 text-xs text-amber-300">{missingHeaders}</p>
      )}

      {rows.length > 0 && !missingHeaders && (
        <div className="mt-3">
          <p className="text-xs text-slate-400">
            {rows.length} row(s) parsed. Rows are validated by the same contract
            a live CMMS connector uses; anything refused is kept with its
            reason, shown below, and can be fixed and re-uploaded — a re-upload
            updates rather than duplicates.
          </p>
          <button
            onClick={commit}
            disabled={busy}
            className="mt-2 rounded-lg border border-signal-cyan/40 bg-signal-cyan/10 px-3 py-2 text-xs text-signal-cyan disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import through the contract"}
          </button>
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-lg border border-white/8 bg-overlook-void/40 px-4 py-3 text-xs text-slate-300">
          Read {summary.read} · accepted {summary.accepted} · duplicate{" "}
          {summary.duplicate} · rejected {summary.rejected}
          {summary.accepted > 0 && (
            <span className="block pt-1 text-slate-500">
              PM compliance now measures against occurrences falling due from
              these plans. A PM never raised counts as missed.
            </span>
          )}
        </div>
      )}

      {rejects.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-amber-200">Refused rows — kept, not dropped:</p>
          {rejects.map((r, i) => (
            <p key={`${r.external_id}-${i}`} className="text-xs text-slate-400">
              <span className="font-mono text-slate-500">{r.external_id ?? "(no id)"}</span>{" "}
              — {r.reject_reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
