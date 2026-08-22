import {
  Calculator,
  FileQuestion,
  Lightbulb,
  Link2,
  ListChecks,
  ShieldAlert,
} from "lucide-react";
import type { AssistantBlock } from "../types/sync-stream";

export function SyncStructuredBlock({ block }: { block: AssistantBlock }) {
  if (block.kind === "markdown" || block.kind === "evidence") return null;

  if (block.kind === "warning") {
    const critical = ["critical", "high", "warning"].includes(block.severity.toLowerCase());
    return (
      <div className={`mt-4 rounded-xl border px-3.5 py-3 text-[13px] leading-5 ${critical ? "border-amber-500/25 bg-amber-500/5 text-amber-100" : "border-sky-500/20 bg-sky-500/5 text-sky-100"}`}>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          {block.severity}
        </div>
        {block.content}
      </div>
    );
  }

  if (block.kind === "facts" || block.kind === "hypotheses" || block.kind === "missing_evidence") {
    const title = block.kind === "facts" ? "Facts" : block.kind === "hypotheses" ? "Hypotheses" : "Missing evidence";
    const Icon = block.kind === "missing_evidence" ? FileQuestion : ListChecks;
    return (
      <div className="mt-4 rounded-xl border border-white/7 bg-white/2 p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <Icon className="h-3.5 w-3.5" aria-hidden />{title}
        </div>
        <ul className="space-y-2 text-[13px] leading-5 text-slate-300">
          {block.items.map((item, index) => <li key={`${title}-${index}`} className="flex gap-2"><span className="text-slate-500" aria-hidden>•</span><span>{item}</span></li>)}
        </ul>
      </div>
    );
  }

  if (block.kind === "calculation") {
    return (
      <div className="mt-4 rounded-xl border border-white/7 bg-white/2 p-3.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Calculator className="h-3.5 w-3.5" aria-hidden />Calculation</div>
        <div className="mt-2 text-[13px] font-medium text-slate-200">{block.calculation.title}</div>
        {block.calculation.result !== undefined ? <div className="mt-1 text-[13px] text-teal-200">{String(block.calculation.result)}{block.calculation.units ? ` ${block.calculation.units}` : ""}</div> : null}
        {block.calculation.method ? <div className="mt-1 text-[12px] leading-5 text-slate-500">{block.calculation.method}</div> : null}
      </div>
    );
  }

  if (block.kind === "recommendation") {
    return (
      <div className="mt-4 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-300"><Lightbulb className="h-3.5 w-3.5" aria-hidden />Recommendation</div>
        <div className="mt-2 text-[13px] leading-5 text-slate-200">{block.recommendation.summary}</div>
        {block.recommendation.rationale ? <div className="mt-1 text-[12px] leading-5 text-slate-400">{block.recommendation.rationale}</div> : null}
      </div>
    );
  }

  if (block.kind === "entity_links") {
    return (
      <div className="mt-4 rounded-xl border border-white/7 bg-white/2 p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Link2 className="h-3.5 w-3.5" aria-hidden />Related records</div>
        <div className="space-y-1.5 text-[13px] text-slate-300">{block.entities.map((entity) => <div key={`${entity.type}:${entity.id}`}>{entity.displayName ?? entity.id}<span className="ml-1.5 text-[10px] text-slate-500">{entity.type}</span></div>)}</div>
      </div>
    );
  }

  if (block.kind === "action_proposal") {
    return <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5 text-[13px] text-amber-100">Proposed action: {block.action.title}</div>;
  }

  return null;
}
