import { ArrowRight, Building2, FolderKanban } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { DevelopmentPortfolioRow } from "../../lib/develop/developmentPortfolio";
import {
  resolvePmoFunctionHref,
  SYNC_PMO_FUNCTIONS,
} from "../../lib/develop/syncPmoWorkspace";
import { ProjectInterventionTriagePanel } from "./ProjectInterventionTriagePanel";

export function SyncPmoWorkspacePanel({
  rows,
}: {
  rows: DevelopmentPortfolioRow[];
}) {
  const [caseId, setCaseId] = useState("");
  return (
    <section className="space-y-5" data-testid="sync-pmo-workspace">
      <div className="rounded-2xl border border-signal-cyan/20 bg-signal-cyan/[0.025] p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-signal-cyan">
              D13.01 · Sync PMO
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Intervention first—not another dashboard
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              Start with projects requiring management attention, then move into
              the governed record that owns the work. Nothing here creates a
              parallel PMO score, approval or system of record.
            </p>
          </div>
          <label className="min-w-64 text-xs text-slate-300">
            Project context for case-scoped functions
            <select
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Choose a project…</option>
              {rows.map((row) => (
                <option key={row.caseId} value={row.caseId}>
                  {row.project}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {SYNC_PMO_FUNCTIONS.map((item) => {
            const href = resolvePmoFunctionHref(item, caseId || null);
            const Icon = item.scope === "case" ? FolderKanban : Building2;
            const content = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Icon className="h-4 w-4 text-signal-cyan" aria-hidden />
                  <span className="text-[9px] uppercase tracking-wide text-slate-500">
                    {item.scope}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-white">
                  {item.label}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {item.purpose}
                </p>
                <p className="mt-2 text-[10px] text-slate-500">{item.source}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-signal-cyan">
                  {href ? "Open governed surface" : "Choose a project to open"}
                  {href && <ArrowRight className="h-3 w-3" aria-hidden />}
                </span>
              </>
            );
            return href ? (
              <Link
                key={item.key}
                to={href}
                className="rounded-xl border border-white/8 bg-black/15 p-3 transition hover:border-signal-cyan/30 hover:bg-signal-cyan/[0.04]"
              >
                {content}
              </Link>
            ) : (
              <div
                key={item.key}
                aria-disabled="true"
                className="rounded-xl border border-white/8 bg-black/10 p-3 opacity-70"
              >
                {content}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          The workspace routes work; it does not decide it. Gate passage,
          funding, risk acceptance, framework adoption and benefit acceptance
          remain named-human acts in their canonical workflows.
        </p>
      </div>
      <ProjectInterventionTriagePanel rows={rows} />
    </section>
  );
}
