import { useCallback, useEffect, useMemo, useState } from "react";
import { HardDriveDownload } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";
import {
  DIGITAL_MAINTAINABILITY_FIELDS,
  assessAssetDigitalMaintainability,
  getAssetDigitalMaintainability,
  recordDigitalConfigurationItem,
  type AssetDigitalMaintainability,
  type DigitalMaintainabilityField,
} from "../services/digitalAssetMaintainabilityService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const buttonClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

const FIELD_LABELS: Record<DigitalMaintainabilityField, string> = {
  firmware: "Firmware",
  software_version: "Software version",
  dependencies: "Dependencies",
  licenses: "Licences",
  patches: "Patch status",
  vendor_support_horizon: "Vendor support horizon",
  backup: "Backup",
  restore_procedures: "Restore procedures",
  configuration_files: "Configuration files",
};

interface Choice {
  id: string;
  label: string;
}

function parseArray(value: string, label: string): unknown[] | null {
  if (!value.trim()) return null;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON list.`);
  return parsed;
}

export function DigitalAssetMaintainabilityPanel() {
  const { profile } = useAuth();
  const canWrite = ["admin", "engineer", "maintenance_manager", "planner", "project_manager"].includes(
    String(profile?.role ?? "").toLowerCase(),
  );
  const [assets, setAssets] = useState<Choice[]>([]);
  const [evidence, setEvidence] = useState<Choice[]>([]);
  const [assetId, setAssetId] = useState("");
  const [baselineKind, setBaselineKind] = useState<AssetDigitalMaintainability["baselineKind"]>("as_built");
  const [readiness, setReadiness] = useState<AssetDigitalMaintainability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState({ applicability: "applicable" as "applicable" | "not_applicable", basis: "", sourceReference: "", evidenceItemId: "" });
  const [item, setItem] = useState({ positionRef: "", firmware: "", software: "", dependencies: "", licenses: "", patches: "", supportHorizon: "", backupEvidence: "", restoreEvidence: "", configurationEvidence: "", recordEvidence: "", basis: "" });
  const [exemptions, setExemptions] = useState<DigitalMaintainabilityField[]>([]);

  useEffect(() => {
    void Promise.all([
      supabase.from("assets").select("id,name").order("name").limit(500),
      supabase.from("evidence_items").select("id,description").order("created_at", { ascending: false }).limit(200),
    ]).then(([a, e]) => {
      if (a.error) throw new Error(a.error.message);
      if (e.error) throw new Error(e.error.message);
      const assetChoices = (a.data ?? []).map((x) => ({ id: x.id, label: x.name }));
      setAssets(assetChoices);
      setAssetId((current) => current || assetChoices[0]?.id || "");
      setEvidence((e.data ?? []).map((x) => ({ id: x.id, label: x.description || x.id })));
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const load = useCallback(async () => {
    if (!assetId) { setReadiness(null); return; }
    setError(null);
    try { setReadiness(await getAssetDigitalMaintainability(assetId, baselineKind)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [assetId, baselineKind]);
  useEffect(() => { void load(); }, [load]);

  const missing = useMemo(() => {
    const values = new Set<string>();
    for (const gap of readiness?.gaps ?? []) {
      if (typeof gap !== "string") gap.missing.forEach((field) => values.add(field));
    }
    return values;
  }, [readiness]);

  async function assess() {
    setBusy(true); setError(null);
    try {
      await assessAssetDigitalMaintainability({ assetId, baselineKind, ...scope });
      setScope((current) => ({ ...current, basis: "" }));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function saveItem() {
    if (!readiness?.baselineId) return;
    setBusy(true); setError(null);
    try {
      await recordDigitalConfigurationItem({
        baselineId: readiness.baselineId,
        positionRef: item.positionRef,
        firmwareVersion: item.firmware,
        softwareVersion: item.software,
        dependencies: parseArray(item.dependencies, "Dependencies"),
        licenses: parseArray(item.licenses, "Licences"),
        patchStatus: item.patches,
        vendorSupportHorizon: item.supportHorizon,
        backupEvidenceItemId: item.backupEvidence,
        restoreProcedureEvidenceItemId: item.restoreEvidence,
        configurationFileEvidenceItemId: item.configurationEvidence,
        fieldExemptions: exemptions,
        basis: item.basis,
        recordEvidenceItemId: item.recordEvidence,
      });
      setItem({ positionRef: "", firmware: "", software: "", dependencies: "", licenses: "", patches: "", supportHorizon: "", backupEvidence: "", restoreEvidence: "", configurationEvidence: "", recordEvidence: "", basis: "" });
      setExemptions([]);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const evidenceSelect = (value: string, onChange: (value: string) => void, placeholder: string) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
      <option value="">{placeholder}</option>
      {evidence.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select>
  );

  return <section aria-labelledby="digital-maintainability-heading" className="space-y-4 rounded-xl border border-white/6 bg-[#0D1520] p-5">
    <div>
      <h3 id="digital-maintainability-heading" className="flex items-center gap-2 text-sm font-semibold text-white">
        <HardDriveDownload className="h-4 w-4 text-signal-cyan" aria-hidden />
        Digital asset maintainability
      </h3>
      <p className="mt-1 text-xs text-slate-400">The physical asset and its digital estate are handed over together. Unknown information never counts as not applicable.</p>
    </div>
    {error && <div className="rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
    <div className="grid gap-2 md:grid-cols-2">
      <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className={inputClass}>
        <option value="">Choose an asset…</option>
        {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
      </select>
      <select value={baselineKind} onChange={(event) => setBaselineKind(event.target.value as AssetDigitalMaintainability["baselineKind"])} className={inputClass}>
        <option value="as_designed">As designed</option><option value="as_built">As built / handover</option><option value="as_maintained">As maintained</option>
      </select>
    </div>
    {readiness && <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-1 font-semibold ${readiness.status === "READY" || readiness.status === "NOT_APPLICABLE" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{readiness.status.replaceAll("_", " ")}</span>
        {readiness.totalItems != null && <span className="text-slate-300">{readiness.completeItems} / {readiness.totalItems} items complete</span>}
      </div>
      {readiness.gaps.length > 0 && <ul className="space-y-1 text-amber-200">{readiness.gaps.map((gap, index) => <li key={index}>{typeof gap === "string" ? gap : `${gap.positionRef}: ${gap.missing.join(", ")}`}</li>)}</ul>}
      {readiness.items.length > 0 && <div className="grid gap-2 md:grid-cols-2">{readiness.items.map((entry) => <div key={entry.configurationItemId} className="rounded border border-white/6 p-2"><span className="font-medium text-slate-200">{entry.positionRef}</span><span className={entry.complete ? "ml-2 text-emerald-300" : "ml-2 text-amber-200"}>{entry.complete ? "complete" : "incomplete"}</span></div>)}</div>}
    </div>}
    {canWrite && <div className="space-y-3 rounded-lg border border-white/6 p-3">
      <p className="text-xs font-semibold text-slate-200">1. Record the applicability decision</p>
      <div className="grid gap-2 md:grid-cols-2">
        <select value={scope.applicability} onChange={(event) => setScope({ ...scope, applicability: event.target.value as typeof scope.applicability })} className={inputClass}><option value="applicable">Applicable</option><option value="not_applicable">Not applicable</option></select>
        <input value={scope.sourceReference} onChange={(event) => setScope({ ...scope, sourceReference: event.target.value })} placeholder="Configuration source reference" className={inputClass} />
        <textarea value={scope.basis} onChange={(event) => setScope({ ...scope, basis: event.target.value })} placeholder="Human assessment basis (20+ characters)" className={inputClass} />
        {evidenceSelect(scope.evidenceItemId, (value) => setScope({ ...scope, evidenceItemId: value }), "Assessment evidence…")}
      </div>
      <button disabled={busy || !assetId || scope.basis.trim().length < 20 || !scope.sourceReference.trim() || !scope.evidenceItemId} onClick={() => void assess()} className={buttonClass}>Save applicability assessment</button>
    </div>}
    {canWrite && readiness?.applicability === "applicable" && readiness.baselineId && <div className="space-y-3 rounded-lg border border-white/6 p-3">
      <p className="text-xs font-semibold text-slate-200">2. Record the nine-field digital handover item</p>
      <div className="grid gap-2 md:grid-cols-2">
        <input value={item.positionRef} onChange={(event) => setItem({ ...item, positionRef: event.target.value })} placeholder="Digital component / position" className={inputClass} />
        <input value={item.firmware} onChange={(event) => setItem({ ...item, firmware: event.target.value })} placeholder="Firmware version" className={inputClass} />
        <input value={item.software} onChange={(event) => setItem({ ...item, software: event.target.value })} placeholder="Software version" className={inputClass} />
        <input value={item.dependencies} onChange={(event) => setItem({ ...item, dependencies: event.target.value })} placeholder={'Dependencies JSON, e.g. ["runtime 4"] or []'} className={inputClass} />
        <input value={item.licenses} onChange={(event) => setItem({ ...item, licenses: event.target.value })} placeholder={'Licences JSON, e.g. [{"id":"LIC-1"}] or []'} className={inputClass} />
        <input value={item.patches} onChange={(event) => setItem({ ...item, patches: event.target.value })} placeholder="Patch status and assessed date" className={inputClass} />
        <label className="text-xs text-slate-400">Vendor support horizon<input type="date" value={item.supportHorizon} onChange={(event) => setItem({ ...item, supportHorizon: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
        {evidenceSelect(item.backupEvidence, (value) => setItem({ ...item, backupEvidence: value }), "Backup evidence…")}
        {evidenceSelect(item.restoreEvidence, (value) => setItem({ ...item, restoreEvidence: value }), "Restore-procedure evidence…")}
        {evidenceSelect(item.configurationEvidence, (value) => setItem({ ...item, configurationEvidence: value }), "Configuration-file evidence…")}
        {evidenceSelect(item.recordEvidence, (value) => setItem({ ...item, recordEvidence: value }), "Overall record evidence…")}
        <textarea value={item.basis} onChange={(event) => setItem({ ...item, basis: event.target.value })} placeholder="Record basis and source context (20+ characters)" className={inputClass} />
      </div>
      <div>
        <p className="text-[11px] text-slate-500">Only mark a field not applicable when the evidence and basis support that decision.</p>
        <div className="mt-2 flex flex-wrap gap-2">{DIGITAL_MAINTAINABILITY_FIELDS.map((field) => <label key={field} className={`rounded border px-2 py-1 text-[11px] ${missing.has(field) ? "border-amber-400/25 text-amber-200" : "border-white/10 text-slate-400"}`}><input type="checkbox" checked={exemptions.includes(field)} onChange={(event) => setExemptions(event.target.checked ? [...exemptions, field] : exemptions.filter((value) => value !== field))} className="mr-1" />{FIELD_LABELS[field]} N/A</label>)}</div>
      </div>
      <button disabled={busy || !item.positionRef.trim() || item.basis.trim().length < 20 || !item.recordEvidence} onClick={() => void saveItem()} className={buttonClass}>Save digital configuration item</button>
    </div>}
    {readiness && <p className="text-[11px] text-slate-500">{readiness.decisionBoundary}</p>}
  </section>;
}
