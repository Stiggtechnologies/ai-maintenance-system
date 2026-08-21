import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Search,
} from "lucide-react";
import type {
  InvestigationCheckRecord,
  SyncTurnTelemetry,
} from "../types/sync-stream";

interface SyncInvestigationTraceProps {
  checks: InvestigationCheckRecord[];
  telemetry?: SyncTurnTelemetry | null;
  sourceCount?: number;
}

const LABELS: Record<string, string> = {
  "operational-kpis": "Operational KPIs reviewed",
  "asset-data-integrity": "Asset data integrity checked",
  "safety-indicators": "Safety indicators cross-checked",
  "open-recommendations": "Open recommendations reviewed",
  "current-asset": "Current asset context checked",
  "work-context": "Work execution context checked",
  attachments: "Attached source material read",
  "risk-ranking": "Highest-risk condition evaluated",
  "governed-context": "Relevant governed context checked",
};

function ms(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s` : `${Math.round(value)}ms`;
}

function TraceIcon({ state }: { state: InvestigationCheckRecord["state"] }) {
  if (state === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-teal-300" aria-hidden />;
  if (state === "attention") return <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
  return <Search className="h-3.5 w-3.5 text-slate-500" aria-hidden />;
}

export function SyncInvestigationTrace({
  checks,
  telemetry,
  sourceCount,
}: SyncInvestigationTraceProps) {
  if (checks.length === 0 && !telemetry) return null;
  const totalSources = sourceCount ?? telemetry?.sourceCount ?? 0;
  const total = ms(telemetry?.totalMs);
  const firstToken = ms(telemetry?.firstTokenMs);

  return (
    <details className="mt-4 rounded-xl border border-white/7 bg-white/2 px-3.5 py-3" data-testid="sync-investigation-trace">
      <summary className="cursor-pointer select-none list-none text-[12px] font-medium text-slate-400 hover:text-slate-200">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>What Sync checked · {checks.length} check{checks.length === 1 ? "" : "s"}</span>
          {totalSources > 0 ? <span className="text-slate-500">· {totalSources} source{totalSources === 1 ? "" : "s"}</span> : null}
          {total ? <span className="inline-flex items-center gap-1 text-slate-500"><Clock3 className="h-3 w-3" aria-hidden />{total}</span> : null}
        </span>
      </summary>

      <div className="mt-3 space-y-2 border-t border-white/6 pt-3">
        {checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2 text-[12px] leading-5 text-slate-400">
            <span className="mt-0.5 shrink-0"><TraceIcon state={check.state} /></span>
            <div className="min-w-0">
              <div className="text-slate-300">{LABELS[check.id] ?? check.label}</div>
              {check.detail ? <div className="text-slate-500">{check.detail}</div> : null}
            </div>
            {check.durationMs != null ? <span className="ml-auto shrink-0 text-[10px] text-slate-600">{ms(check.durationMs)}</span> : null}
          </div>
        ))}
      </div>

      {telemetry ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/6 pt-3 text-[10px] text-slate-500">
          {ms(telemetry.firstActivityMs) ? <span>First activity {ms(telemetry.firstActivityMs)}</span> : null}
          {firstToken ? <span>First token {firstToken}</span> : null}
          {ms(telemetry.retrievalMs) ? <span>Evidence {ms(telemetry.retrievalMs)}</span> : null}
          {ms(telemetry.specialistMs) ? <span>Specialists {ms(telemetry.specialistMs)}</span> : null}
          {ms(telemetry.modelMs) ? <span>Model {ms(telemetry.modelMs)}</span> : null}
        </div>
      ) : null}
    </details>
  );
}
