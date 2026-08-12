/**
 * FleetHistoryImport — the front door for a fleet's work and downtime history
 * (capability register U21.02; part of the asset-onboarding capability).
 *
 * The auxiliary fleet was loaded by a hand-written parser. A customer
 * onboarding cannot depend on that — and more importantly, the parser made
 * judgement calls the customer never saw:
 *
 *   * unit numbers repeated across equipment types, so keying on the number
 *     alone would have merged twenty machines into ten;
 *   * MIDLIFE is a rebuild, not a failure — counted wrongly it inflates every
 *     reliability metric;
 *   * a duration column disagreed with the timestamps on 0.2% of rows.
 *
 * Each of those changes the numbers. So this wizard PROPOSES and the person
 * confirms: mapping, then vocabulary, then a preview of exactly what will load
 * and what will be rejected — before anything is written.
 */
import { useState } from "react";
import {
  Upload,
  ArrowRight,
  CircleCheck,
  TriangleAlert,
  FileSpreadsheet,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  parseCSV,
  profileColumns,
  suggestMapping,
  validateMapping,
  suggestVocabulary,
  previewImport,
  type ColumnRole,
  type ColumnSuggestion,
  type LabelSuggestion,
  type ImportPreview,
} from "../lib/fleet-import";

const ROLES: ColumnRole[] = [
  "asset_name",
  "asset_type",
  "unit_number",
  "start_date",
  "start_time",
  "end_date",
  "end_time",
  "duration_hours",
  "reason_code",
  "comment",
  "ignore",
];
const KINDS = [
  "system_group",
  "activity_type",
  "delay_reason",
  "unclassified",
] as const;

type Step = "upload" | "map" | "vocab" | "preview" | "done";

export function FleetHistoryImport() {
  const [step, setStep] = useState<Step>("upload");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [cols, setCols] = useState<ColumnSuggestion[]>([]);
  const [vocab, setVocab] = useState<LabelSuggestion[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File) {
    setMsg(null);
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setMsg(
        "CSV only for now. Spreadsheet (.xlsx) support needs a parsing library, and adding one to a platform pursuing SOC 2 is a supply-chain decision to take on its own merits rather than smuggle into this feature. Export the sheet as CSV.",
      );
      return;
    }
    const text = await f.text();
    const all = parseCSV(text);
    if (all.length < 2) {
      setMsg("That file has no data rows.");
      return;
    }
    const [hdr, ...body] = all;
    setRows(body);
    setCols(suggestMapping(profileColumns(hdr, body)));
    setName(f.name.replace(/\.csv$/i, ""));
    setKey(
      f.name
        .replace(/\.csv$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40),
    );
    setStep("map");
  }

  function toVocab() {
    const ri = cols.find((c) => c.role === "reason_code")?.index;
    const counts = new Map<string, number>();
    if (ri !== undefined) {
      for (const r of rows) {
        const v = (r[ri] ?? "").toString().trim().toUpperCase();
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    setVocab(suggestVocabulary(counts));
    setStep("vocab");
  }

  function toPreview() {
    setPreview(
      previewImport(
        rows,
        cols.map((c) => ({ role: c.role, index: c.index })),
      ),
    );
    setStep("preview");
  }

  async function commit() {
    setBusy(true);
    setMsg(null);
    const start = await supabase.rpc("start_history_import", {
      p_source_name: name,
      p_source_system: key,
      p_column_profile: cols,
      p_vocabulary_profile: vocab,
      p_preview: preview,
    });
    const s = start.data as { session_id?: string; error?: string };
    if (s?.error) {
      setBusy(false);
      setMsg(s.error);
      return;
    }

    await supabase.rpc("confirm_history_import", {
      p_id: s.session_id,
      p_column_mapping: cols.map((c) => ({ role: c.role, index: c.index })),
      p_vocabulary_mapping: vocab.map((v) => ({
        label: v.label,
        kind: v.kind,
      })),
    });

    const at = (r: string[], role: ColumnRole) => {
      const i = cols.find((c) => c.role === role)?.index;
      return i === undefined
        ? undefined
        : (r[i] ?? "").toString().trim() || undefined;
    };
    const join = (d?: string, t?: string) =>
      d ? `${d}${t ? "T" + t : "T00:00:00"}` : undefined;

    let loaded = 0,
      rejected = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r, j) => ({
        external_id: `${key}-${i + j + 2}`,
        asset_name:
          [at(r, "asset_type"), at(r, "unit_number")]
            .filter(Boolean)
            .join(" ") || at(r, "asset_name"),
        asset_class: at(r, "asset_type"),
        started_at: join(at(r, "start_date"), at(r, "start_time")),
        ended_at: join(at(r, "end_date"), at(r, "end_time")),
        duration_hours: at(r, "duration_hours"),
        reason_code: at(r, "reason_code"),
        comment: at(r, "comment"),
      }));
      const res = await supabase.rpc("commit_history_import", {
        p_id: s.session_id,
        p_rows: batch,
      });
      const d = res.data as {
        loaded?: number;
        rejected?: number;
        error?: string;
      };
      if (d?.error) {
        setBusy(false);
        setMsg(d.error);
        return;
      }
      loaded += d?.loaded ?? 0;
      rejected += d?.rejected ?? 0;
      // Each batch commits the session; reopen it for the next one.
      if (i + 500 < rows.length) {
        await supabase.rpc("confirm_history_import", {
          p_id: s.session_id,
          p_column_mapping: cols.map((c) => ({ role: c.role, index: c.index })),
          p_vocabulary_mapping: vocab.map((v) => ({
            label: v.label,
            kind: v.kind,
          })),
        });
      }
    }
    setBusy(false);
    setMsg(
      `Loaded ${loaded.toLocaleString()} events; ${rejected.toLocaleString()} rejected with reasons retained.`,
    );
    setStep("done");
  }

  const check = validateMapping(cols);
  const unclassified = vocab.filter((v) => v.kind === "unclassified").length;

  return (
    <section aria-labelledby="import-heading" className="space-y-4">
      <div>
        <h2
          id="import-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <FileSpreadsheet className="h-5 w-5 text-signal-cyan" aria-hidden />
          Import Fleet History
          <span className="text-xs font-normal text-slate-500">{step}</span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Upload a downtime or work-history export. Every judgement the importer
          makes — which column is which, whether a code is a failure, a planned
          activity or a wait — is proposed for you to confirm. Nothing is
          written until you have seen what will load.
        </p>
      </div>

      {msg && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          {msg}
        </p>
      )}

      {step === "upload" && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/2 p-8 text-center hover:bg-white/5 focus-within:ring-2 focus-within:ring-signal-cyan">
          <Upload className="h-6 w-6 text-slate-400" aria-hidden />
          <span className="text-sm text-slate-200">Choose a CSV export</span>
          <span className="text-xs text-slate-500">
            One row per down event or work order
          </span>
          <input
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      )}

      {step === "map" && (
        <>
          <div className="overflow-x-auto rounded-xl border border-white/6">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Proposed column mapping</caption>
              <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Column
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Why
                  </th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c, i) => (
                  <tr
                    key={`${c.header}-${c.index}`}
                    className="border-t border-white/6"
                  >
                    <td className="px-4 py-2 text-slate-200">
                      {c.header || <em className="text-slate-500">unnamed</em>}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={c.role}
                        aria-label={`Role for column ${c.header}`}
                        onChange={(e) => {
                          const next = [...cols];
                          next[i] = {
                            ...c,
                            role: e.target.value as ColumnRole,
                          };
                          setCols(next);
                        }}
                        className="rounded border border-white/10 bg-overlook-deep px-2 py-1 text-xs text-slate-200"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {c.why}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {check.missing.length > 0 && (
            <p className="text-xs text-red-300">
              Cannot load without {check.missing.join(", ")}.
            </p>
          )}
          {check.notes.map((n) => (
            <p
              key={n}
              className="flex items-start gap-1.5 text-xs text-amber-200/90"
            >
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {n}
            </p>
          ))}
          <button
            disabled={!check.usable}
            onClick={toVocab}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            Review the vocabulary{" "}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}

      {step === "vocab" && (
        <>
          <p className="text-xs text-slate-400">
            {vocab.length} distinct codes. This is the judgement that most
            changes the numbers: a planned service counted as a failure inflates
            every reliability metric, and a wait counted as work inflates
            maintenance effort.
          </p>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-white/6">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Proposed vocabulary classification
              </caption>
              <tbody>
                {vocab.map((v, i) => (
                  <tr
                    key={v.label}
                    className="border-t border-white/6 first:border-0"
                  >
                    <td className="px-4 py-2 text-slate-200">{v.label}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {v.count}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={v.kind}
                        aria-label={`Kind for ${v.label}`}
                        onChange={(e) => {
                          const next = [...vocab];
                          next[i] = {
                            ...v,
                            kind: e.target.value as LabelSuggestion["kind"],
                          };
                          setVocab(next);
                        }}
                        className="rounded border border-white/10 bg-overlook-deep px-2 py-1 text-xs text-slate-200"
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {v.why}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unclassified > 0 && (
            <p className="text-xs text-amber-200/90">
              {unclassified} code(s) unclassified — they will load with their
              raw label and stay invisible to segmentation until classified.
            </p>
          )}
          <button
            onClick={toPreview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
          >
            Preview the load <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}

      {step === "preview" && preview && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Will load
              </p>
              <p className="mt-1 font-mono text-2xl text-green-300">
                {preview.willLoad.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Will reject
              </p>
              <p className="mt-1 font-mono text-2xl text-amber-300">
                {preview.willReject.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Rows read
              </p>
              <p className="mt-1 font-mono text-2xl text-slate-100">
                {preview.rows.toLocaleString()}
              </p>
            </div>
          </div>
          {preview.rejectReasons.length > 0 && (
            <ul className="space-y-1">
              {preview.rejectReasons.map((r) => (
                <li
                  key={r.reason}
                  className="flex justify-between gap-3 text-xs"
                >
                  <span className="text-slate-400">{r.reason}</span>
                  <span className="font-mono text-slate-300">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            disabled={busy || preview.willLoad === 0}
            onClick={commit}
            className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-3 py-1.5 text-sm font-medium text-signal-gold hover:bg-signal-gold/20 disabled:opacity-40"
          >
            {busy
              ? "Loading…"
              : `Load ${preview.willLoad.toLocaleString()} events`}
          </button>
        </>
      )}

      {step === "done" && (
        <p className="flex items-start gap-2 rounded-xl border border-green-500/25 bg-green-500/5 p-4 text-sm text-green-200">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {msg}
        </p>
      )}
    </section>
  );
}
