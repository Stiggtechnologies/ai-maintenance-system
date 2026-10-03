import { Activity } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getProjectControlsAgent } from "../../services/projectControlsAgentService";
import { ErrorState, LoadingState } from "../ui/AsyncStates";

export function ProjectControlsAgentPanel() {
  const { data, loading, error, refetch } = useAsyncData(() => getProjectControlsAgent(), []);
  if (loading) return <LoadingState label="Cross-checking project controls evidence" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;
  return (
    <section className="space-y-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.025] p-5" data-testid="project-controls-agent">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">D12.11 · advisory Project Controls Agent</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white"><Activity className="h-5 w-5 text-emerald-300" aria-hidden />Controls signals requiring review</h2>
        <p className="mt-1 max-w-4xl text-xs text-slate-400">{data.method}</p>
        <p className="mt-2 text-xs text-slate-500">{data.findingCount} finding(s) across {data.reviewedCaseCount} active case(s).</p>
      </header>
      {data.cases.length === 0 ? <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">No explicit controls finding was returned. This is not proof that projects are on plan.</p> : (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.cases.map((item) => <article key={item.caseId} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3"><div><Link to={`/develop/cases/${item.caseId}`} className="font-semibold text-white hover:underline">{item.caseTitle}</Link><p className="text-[10px] uppercase text-slate-500">{item.status.replaceAll("_", " ")}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-300">{item.posture.replaceAll("_", " ")}</span></div>
            <ul className="mt-3 space-y-2">{item.findings.map((finding, index) => <li key={`${finding.code}-${index}`} className="rounded-lg border border-white/10 p-3 text-xs text-slate-300"><p className="font-semibold text-white">{finding.title}</p><p className="mt-1">{finding.detail}</p><details className="mt-2 text-[10px] text-slate-500"><summary>Record trail</summary><ul className="mt-1 font-mono">{finding.sourceRefs.map((ref) => <li key={ref}>{ref}</li>)}</ul></details></li>)}</ul>
          </article>)}
        </div>
      )}
      <aside className="rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300"><h3 className="font-semibold text-white">Interpretation limits</h3><ul className="mt-2 list-disc space-y-1 pl-5">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></aside>
      <footer className="text-xs font-medium text-emerald-50">{data.decisionBoundary}</footer>
    </section>
  );
}
