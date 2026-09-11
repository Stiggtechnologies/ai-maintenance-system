import { Activity, Clock3 } from "lucide-react";
import { FormEvent, useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";

interface MechanismMetric {
  mechanismKey: string;
  mechanismName: string;
  available: boolean;
  eventRateAvailable: boolean;
  mtbfAvailable: boolean;
  failures: number;
  failuresWithRunningExposure: number;
  runningHours: number;
  scopedAssets: number;
  assetsWithRunningExposure: number;
  mtbfHours: number | null;
  eventRatePer1000RunningHours: number | null;
  limitation: string;
}

interface FailureModeResult {
  reportingDays: number;
  minFailures: number;
  uncodedCorrectiveEventsExcluded?: number;
  incompleteCodingProvenanceExcluded?: number;
  codedEventsOutsideApprovedScopeExcluded?: number;
  basis: string;
  mechanisms: MechanismMetric[];
  error?: string;
}

interface ScopeOptions {
  assets: { id: string; tag: string; name: string }[];
  mechanisms: { key: string; name: string }[];
  evidence: { id: string; description: string | null; sourceSystem: string | null }[];
  error?: string;
}

interface FailureModeData { result: FailureModeResult; options: ScopeOptions }

async function loadFailureModeReliability(): Promise<FailureModeData> {
  const [metricResponse, optionsResponse] = await Promise.all([
    supabase.rpc("get_failure_mode_reliability", { p_reporting_days: 365, p_min_failures: 2 }),
    supabase.rpc("get_failure_mode_scope_options"),
  ]);
  if (metricResponse.error) throw new Error(metricResponse.error.message);
  if (optionsResponse.error) throw new Error(optionsResponse.error.message);
  const result = metricResponse.data as FailureModeResult;
  const options = optionsResponse.data as ScopeOptions;
  if (result.error) throw new Error(result.error);
  if (options.error) throw new Error(options.error);
  return { result, options };
}

export function FailureModeReliability() {
  const { data, loading, error, refetch } = useAsyncData(loadFailureModeReliability, []);
  const [assetId, setAssetId] = useState("");
  const [mechanismKey, setMechanismKey] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [basis, setBasis] = useState("");
  const [applicable, setApplicable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  if (loading) return <LoadingState label="Measuring failure-mode reliability" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const rows = data?.result.mechanisms ?? [];
  const options = data?.options;

  async function saveScope(event: FormEvent) {
    event.preventDefault(); setSaveMessage(""); setSaving(true);
    const { data: response, error: saveError } = await supabase.rpc("record_asset_failure_mechanism_scope", {
      p_asset_id: assetId, p_mechanism_key: mechanismKey, p_applicable: applicable,
      p_basis: basis, p_evidence_item_id: evidenceId,
    });
    setSaving(false);
    const result = response as { error?: string } | null;
    if (saveError || result?.error) { setSaveMessage(saveError?.message ?? result?.error ?? "Scope was not saved."); return; }
    setSaveMessage("Approved applicability scope saved."); setBasis(""); await refetch();
  }

  return (
    <section aria-labelledby="mode-reliability-heading" className="space-y-3">
      <div>
        <h2 id="mode-reliability-heading" className="flex items-center gap-2 text-lg font-semibold text-white">
          <Activity className="h-5 w-5 text-signal-cyan" aria-hidden /> Reliability by Failure Mechanism
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-slate-300">{data?.result.basis}</p>
      </div>
      <form onSubmit={saveScope} className="grid gap-3 rounded-xl border border-white/10 bg-white/3 p-4 md:grid-cols-2" aria-label="Approve asset failure mechanism scope">
        <div className="md:col-span-2"><h3 className="font-medium text-white">Approve an at-risk asset</h3><p className="text-xs text-slate-400">A named reliability or maintenance authority must link applicability to canonical evidence before the asset enters this metric.</p></div>
        <select required value={assetId} onChange={(e) => setAssetId(e.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" aria-label="Asset"><option value="">Select asset</option>{options?.assets.map((a) => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}</select>
        <select required value={mechanismKey} onChange={(e) => setMechanismKey(e.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" aria-label="Failure mechanism"><option value="">Select failure mechanism</option>{options?.mechanisms.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
        <select required value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white md:col-span-2" aria-label="Supporting evidence"><option value="">Select supporting evidence</option>{options?.evidence.map((e) => <option key={e.id} value={e.id}>{e.description || "Undescribed evidence"}{e.sourceSystem ? ` — ${e.sourceSystem}` : ""}</option>)}</select>
        <textarea required minLength={20} value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Explain why this mechanism is or is not applicable (at least 20 characters)." className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white md:col-span-2" />
        <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={applicable} onChange={(e) => setApplicable(e.target.checked)} /> Include this asset in the at-risk cohort</label>
        <button disabled={saving || basis.trim().length < 20} className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{saving ? "Saving…" : "Record approval"}</button>
        {saveMessage && <p role="status" className="text-sm text-slate-300 md:col-span-2">{saveMessage}</p>}
      </form>
      {rows.length === 0 ? <EmptyState message="No approved applicable asset–mechanism cohort exists yet. Record one above; no asset is assumed susceptible." /> : <>
      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="min-w-full divide-y divide-white/6 text-sm">
          <thead className="bg-white/3 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2">Mechanism</th><th className="px-3 py-2 text-right">Events</th><th className="px-3 py-2 text-right">Running hours</th><th className="px-3 py-2 text-right">MTBF</th><th className="px-3 py-2 text-right">Events / 1,000 h</th></tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {rows.map((row) => <tr key={row.mechanismKey}>
              <td className="px-3 py-3"><div className="font-medium text-white">{row.mechanismName}</div><div className="text-xs text-slate-400">{row.assetsWithRunningExposure}/{row.scopedAssets} assets with exposure</div><div className="mt-1 max-w-xl text-xs text-slate-500">{row.limitation}</div></td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-200">{row.failuresWithRunningExposure}/{row.failures}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-200">{row.runningHours}</td>
              <td className="px-3 py-3 text-right tabular-nums text-signal-cyan">{row.mtbfHours == null ? "Not measurable" : `${row.mtbfHours} h`}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-200">{row.eventRatePer1000RunningHours ?? "Not measurable"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Clock3 className="h-3.5 w-3.5" aria-hidden /> {data?.result.reportingDays}-day evidence window; at least {data?.result.minFailures} coded events for MTBF.
        {(data?.result.uncodedCorrectiveEventsExcluded ?? 0) > 0 && ` ${data?.result.uncodedCorrectiveEventsExcluded} uncoded event(s) excluded.`}
        {(data?.result.incompleteCodingProvenanceExcluded ?? 0) > 0 && ` ${data?.result.incompleteCodingProvenanceExcluded} incompletely evidenced coding(s) excluded.`}
        {(data?.result.codedEventsOutsideApprovedScopeExcluded ?? 0) > 0 && ` ${data?.result.codedEventsOutsideApprovedScopeExcluded} coded event(s) outside approved scope excluded.`}
      </p>
      </>}
    </section>
  );
}
