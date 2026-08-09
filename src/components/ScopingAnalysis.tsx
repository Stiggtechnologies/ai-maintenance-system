/**
 * ScopingAnalysis — findings from a file, with nothing imported and nothing
 * stored (capability register U21.02, C9.01).
 *
 * A prospect hands over a spreadsheet long before they hand over a CMMS
 * connection. Until now the only way to analyse one was to IMPORT it, which
 * creates sites, assets, work orders and states — asking someone to onboard
 * equipment they have not decided to onboard, just to learn whether the
 * analysis is any good.
 *
 * This path writes nothing and sends nothing. Parsing, classification and the
 * whole reliability calculation run in the browser against pure functions, so
 * the file never reaches the server. That is the honest privacy answer and it
 * is also why no data-governance question has to be settled before someone can
 * see the value.
 */
import { useState } from "react";
import {
  FlaskConical,
  Upload,
  TriangleAlert,
  Info,
  ShieldCheck,
} from "lucide-react";
import {
  parseCSV,
  profileColumns,
  suggestMapping,
  suggestVocabulary,
  type ColumnRole,
  type LabelKind,
} from "../lib/fleet-import";
import {
  analyseFleet,
  type AnalysisRow,
  type ScopingFindings,
} from "../lib/fleet-analysis";
import { findingsAsContext } from "../lib/fleet-analysis/context";
import { setCopilotEphemeralContext } from "../lib/copilot-context";

const SEV: Record<string, string> = {
  serious: "border-red-500/30 bg-red-500/5 text-red-200",
  warning: "border-amber-500/25 bg-amber-500/5 text-amber-200/90",
  info: "border-white/6 bg-white/2 text-slate-400",
};

export function ScopingAnalysis() {
  const [findings, setFindings] = useState<ScopingFindings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File) {
    setMsg(null);
    setBusy(true);
    try {
      if (!f.name.toLowerCase().endsWith(".csv")) {
        setMsg("CSV only for now — export the sheet as CSV.");
        return;
      }
      const all = parseCSV(await f.text());
      if (all.length < 2) {
        setMsg("That file has no data rows.");
        return;
      }
      const [hdr, ...body] = all;
      const cols = suggestMapping(profileColumns(hdr, body));
      const idx = (role: ColumnRole) =>
        cols.find((c) => c.role === role)?.index;

      const iAsset = idx("unit_number") ?? idx("asset_name");
      const iType = idx("asset_type");
      const iSd = idx("start_date");
      const iSt = idx("start_time");
      const iEd = idx("end_date");
      const iEt = idx("end_time");
      const iDur = idx("duration_hours");
      const iReason = idx("reason_code");

      if (iAsset === undefined || iSd === undefined) {
        setMsg(
          "Could not find an asset identifier and a start date in that file. The import wizard lets you map columns by hand.",
        );
        return;
      }

      const counts = new Map<string, number>();
      if (iReason !== undefined)
        for (const r of body) {
          const v = (r[iReason] ?? "").trim().toUpperCase();
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      const kindOf = new Map<string, LabelKind>(
        suggestVocabulary(counts).map((v) => [v.label, v.kind]),
      );

      const at = (r: string[], i?: number) =>
        i === undefined ? "" : (r[i] ?? "").trim();
      const when = (dpart: string, tpart: string) =>
        dpart
          ? new Date(`${dpart.split(" ")[0]}T${tpart || "00:00:00"}`)
          : null;

      const rows: AnalysisRow[] = [];
      for (const r of body) {
        const start = when(at(r, iSd), at(r, iSt));
        if (!start || Number.isNaN(start.getTime())) continue;
        let end = when(at(r, iEd), at(r, iEt));
        const durRaw = at(r, iDur);
        const dur = durRaw === "" ? NaN : Number(durRaw);
        if ((!end || Number.isNaN(end.getTime())) && Number.isFinite(dur))
          end = new Date(start.getTime() + dur * 3_600_000);
        if (!end || Number.isNaN(end.getTime())) continue;
        const hours = Number.isFinite(dur)
          ? dur
          : (end.getTime() - start.getTime()) / 3_600_000;
        const unit = at(r, iAsset);
        if (!unit) continue;
        const cls = iType === undefined ? undefined : at(r, iType) || undefined;
        const reason = (at(r, iReason) || "UNSPECIFIED").toUpperCase();
        rows.push({
          asset: [cls, unit].filter(Boolean).join(" "),
          assetClass: cls,
          start,
          end,
          hours,
          reason,
          kind: kindOf.get(reason) ?? "unclassified",
        });
      }
      if (rows.length === 0) {
        setMsg("No row had both an asset and a usable start and end.");
        return;
      }
      const result = analyseFleet(rows);
      setFindings(result);
      // Hand the findings to the copilot so the agents can be worked with over
      // this dataset. A summary only — the rows stay in the browser.
      setCopilotEphemeralContext(findingsAsContext(result, f.name));
    } finally {
      setBusy(false);
    }
  }

  const f = findings;

  return (
    <section aria-labelledby="scoping-heading" className="space-y-4">
      <div>
        <h2
          id="scoping-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <FlaskConical className="h-5 w-5 text-signal-gold" aria-hidden />
          Analyse Without Importing
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Drop a downtime export and see the findings. Nothing is imported, no
          assets are created, and the file never leaves this browser — the
          parsing and the whole reliability calculation run locally. Use the
          import wizard when you decide the fleet should live here.
        </p>
      </div>

      {msg && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200/90">
          {msg}
        </p>
      )}

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/2 p-5 text-center text-sm text-slate-200 hover:bg-white/5 focus-within:ring-2 focus-within:ring-signal-gold">
        <Upload className="h-4 w-4 text-slate-400" aria-hidden />
        {busy
          ? "Analysing…"
          : f
            ? "Analyse a different file"
            : "Choose a CSV export"}
        <input
          type="file"
          accept=".csv"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>

      {f && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Events",
                f.events.toLocaleString(),
                `${f.assets} assets, ${f.spanDays} days`,
              ],
              [
                "Total downtime",
                `${f.totalDownHours.toLocaleString()} h`,
                `${f.correctiveEvents.toLocaleString()} corrective`,
              ],
              [
                "Waiting, not working",
                `${f.delaySharePct}%`,
                `${f.delayHours.toLocaleString()} h across ${f.delayEvents} events`,
              ],
              [
                "Planned work",
                f.plannedEvents.toLocaleString(),
                "events classed as activity",
              ],
            ].map(([label, value, sub]) => (
              <div
                key={label}
                className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
              >
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {label}
                </p>
                <p className="mt-1 font-mono text-2xl text-slate-100">
                  {value}
                </p>
                <p className="mt-1 text-xs text-slate-500">{sub}</p>
              </div>
            ))}
          </div>

          {f.rankingInverts && (
            <p className="flex items-start gap-2 rounded-xl border border-signal-gold/30 bg-signal-gold/5 p-3 text-xs leading-relaxed text-signal-gold">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Ranking by event count points at{" "}
                <strong>{f.byCount[0].label}</strong> ({f.byCount[0].meanHours}{" "}
                h mean); ranking by hours points at{" "}
                <strong>{f.byHours[0].label}</strong> ({f.byHours[0].meanHours}{" "}
                h mean). They are different problems — the first is usually
                planning and materials, the second is reliability. A programme
                aimed by count would work on the wrong one.
              </span>
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {[
              ["Biggest losses by hours", f.byHours],
              ["Most frequent by count", f.byCount],
            ].map(([title, list]) => (
              <div
                key={title as string}
                className="overflow-x-auto rounded-xl border border-white/6"
              >
                <table className="w-full text-left text-sm">
                  <caption className="bg-white/2 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {title as string}
                  </caption>
                  <tbody>
                    {(list as typeof f.byHours).map((p) => (
                      <tr key={p.label} className="border-t border-white/6">
                        <td className="px-4 py-2 text-slate-200">{p.label}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-400 tabular-nums">
                          {p.events} ev
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-300 tabular-nums">
                          {p.hours.toLocaleString()} h
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-500 tabular-nums">
                          {p.meanHours} h ea
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/6">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="bg-white/2 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                Worst actors by downtime
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Asset
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Failures
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Downtime
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    MTBF
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    MTTR
                  </th>
                </tr>
              </thead>
              <tbody>
                {f.worstAssets.map((a) => (
                  <tr key={a.asset} className="border-t border-white/6">
                    <td className="px-4 py-2 text-slate-200">{a.asset}</td>
                    <td className="px-4 py-2 font-mono text-slate-400 tabular-nums">
                      {a.failures}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-300 tabular-nums">
                      {a.downtimeHours.toLocaleString()} h
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-400 tabular-nums">
                      {a.mtbfHours ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-400 tabular-nums">
                      {a.mttrHours ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {f.dataQuality.length > 0 && (
            <ul className="space-y-1.5">
              {f.dataQuality.map((q) => (
                <li
                  key={q.kind}
                  className={`rounded-xl border p-3 text-xs leading-relaxed ${SEV[q.severity]}`}
                >
                  <strong>
                    {q.kind} — {q.count.toLocaleString()}
                  </strong>
                  . {q.detail}
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-xl border border-white/6 bg-white/2 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
              What these numbers do not tell you
            </p>
            <ul className="mt-1.5 space-y-1">
              {f.caveats.map((c) => (
                <li key={c} className="text-xs text-slate-500">
                  {c}
                </li>
              ))}
            </ul>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Nothing above was saved. Close this page and the analysis is gone —
            no asset, work order or state record was created. The copilot is now
            grounded in these findings, so you can question them directly; it
            receives the summary above, not the rows.
          </p>
        </>
      )}
    </section>
  );
}
