import { useEffect, useState } from "react";
import { CircleAlert, Gauge, Layers3, Plus, Save } from "lucide-react";
import {
  getSiteChangeLoad,
  listSiteChangeLoadInputs,
  recordSiteOutageWindow,
  recordSiteTrainingPlan,
  type SiteChangeLoad,
} from "../../services/siteChangeLoadService";

const LABELS: Record<keyof SiteChangeLoad["dimensions"], string> = {
  activeProjects: "Projects",
  outageWindows: "Outages",
  temporaryModifications: "Temporary modifications",
  activeTrainingPlans: "Training plans",
  releasedScheduleOptions: "Released schedules",
  maintenanceBacklog: "Maintenance backlog",
  capacityDeductions: "Capacity deductions",
};

export function SiteChangeLoadPanel({ siteId, canPlan }: { siteId: string | null; canPlan: boolean }) {
  const [load, setLoad] = useState<SiteChangeLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"outage" | "training" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inputs, setInputs] = useState<{members:Array<{id:number;label:string}>;competencies:Array<{id:number;label:string}>}>({members:[],competencies:[]});
  const [outage, setOutage] = useState({windowKey:"",title:"",kind:"shutdown",startsAt:"",endsAt:"",scope:""});
  const [training, setTraining] = useState({memberId:"",competencyId:"",planKind:"cross_training",targetDate:"",driver:""});

  useEffect(() => {
    if (!siteId) { setLoad(null); return; }
    let active=true;
    void getSiteChangeLoad(siteId).then((result) => { if(active){setLoad(result);setError(null);} })
      .catch((cause) => { if(active)setError(cause instanceof Error?cause.message:"Could not calculate site change load"); });
    return () => { active=false; };
  }, [siteId]);

  useEffect(() => {
    if (!siteId || !canPlan) return;
    void listSiteChangeLoadInputs(siteId).then(setInputs).catch(() => setInputs({members:[],competencies:[]}));
  }, [siteId,canPlan]);

  async function refresh() {
    if (siteId) setLoad(await getSiteChangeLoad(siteId));
  }

  async function saveOutage() {
    if (!siteId) return;
    setBusy(true);setMessage(null);
    try {
      await recordSiteOutageWindow({...outage,siteId,startsAt:new Date(outage.startsAt).toISOString(),endsAt:new Date(outage.endsAt).toISOString()});
      setMessage("Outage window recorded by an accountable human and included in site load.");
      setOutage({windowKey:"",title:"",kind:"shutdown",startsAt:"",endsAt:"",scope:""});setForm(null);await refresh();
    } catch(cause) { setMessage(cause instanceof Error?cause.message:"Could not record outage window"); }
    finally { setBusy(false); }
  }

  async function saveTraining() {
    if (!siteId) return;
    setBusy(true);setMessage(null);
    try {
      await recordSiteTrainingPlan({siteId,memberId:Number(training.memberId),competencyId:Number(training.competencyId),planKind:training.planKind,targetDate:training.targetDate,driver:training.driver});
      setMessage("Training plan recorded by an accountable human and included in site load.");
      setTraining({memberId:"",competencyId:"",planKind:"cross_training",targetDate:"",driver:""});setForm(null);await refresh();
    } catch(cause) { setMessage(cause instanceof Error?cause.message:"Could not record training plan"); }
    finally { setBusy(false); }
  }

  return (
    <section className="glass rounded-xl border border-white/6 p-5" aria-labelledby="site-change-load-title">
      <div className="flex items-start gap-2">
        <Layers3 className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h2 id="site-change-load-title" className="text-sm font-semibold text-industrial-text">Site change load</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Concurrent projects, outages, modifications, training, schedules, maintenance burden, and capacity constraints over the next 13 weeks.</p>
        </div>
      </div>
      {siteId && canPlan && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={()=>setForm(form==="outage"?null:"outage")} className="flex items-center gap-1 rounded border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"><Plus className="h-3 w-3" aria-hidden/>Plan outage window</button>
        <button type="button" onClick={()=>setForm(form==="training"?null:"training")} className="flex items-center gap-1 rounded border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"><Plus className="h-3 w-3" aria-hidden/>Plan site training</button>
      </div>}
      {form==="outage" && <div className="mt-3 grid gap-2 rounded-lg border border-white/8 bg-black/10 p-3 sm:grid-cols-2">
        <input aria-label="Outage key" placeholder="Outage key" value={outage.windowKey} onChange={e=>setOutage({...outage,windowKey:e.target.value})} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"/>
        <input aria-label="Outage title" placeholder="Outage title" value={outage.title} onChange={e=>setOutage({...outage,title:e.target.value})} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"/>
        <select aria-label="Outage kind" value={outage.kind} onChange={e=>setOutage({...outage,kind:e.target.value})} className="rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-xs text-slate-200">{["shutdown","turnaround","opportunity","campaign"].map(x=><option key={x}>{x}</option>)}</select>
        <input aria-label="Outage scope" placeholder="Scope (optional)" value={outage.scope} onChange={e=>setOutage({...outage,scope:e.target.value})} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"/>
        <label className="text-[11px] text-slate-400">Starts<input type="datetime-local" value={outage.startsAt} onChange={e=>setOutage({...outage,startsAt:e.target.value})} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"/></label>
        <label className="text-[11px] text-slate-400">Ends<input type="datetime-local" value={outage.endsAt} onChange={e=>setOutage({...outage,endsAt:e.target.value})} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"/></label>
        <button type="button" disabled={busy||outage.windowKey.trim().length<2||outage.title.trim().length<3||!outage.startsAt||!outage.endsAt} onClick={()=>void saveOutage()} className="flex items-center justify-center gap-1 rounded bg-signal-cyan/15 px-3 py-1.5 text-xs text-signal-cyan disabled:opacity-40"><Save className="h-3 w-3" aria-hidden/>Record outage</button>
      </div>}
      {form==="training" && <div className="mt-3 grid gap-2 rounded-lg border border-white/8 bg-black/10 p-3 sm:grid-cols-2">
        <select aria-label="Workforce member" value={training.memberId} onChange={e=>setTraining({...training,memberId:e.target.value})} className="rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-xs text-slate-200"><option value="">Workforce member</option>{inputs.members.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <select aria-label="Competency" value={training.competencyId} onChange={e=>setTraining({...training,competencyId:e.target.value})} className="rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-xs text-slate-200"><option value="">Competency</option>{inputs.competencies.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <select aria-label="Training kind" value={training.planKind} onChange={e=>setTraining({...training,planKind:e.target.value})} className="rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-xs text-slate-200">{["apprenticeship","requalification","cross_training","succession"].map(x=><option key={x}>{x}</option>)}</select>
        <input aria-label="Training target date" type="date" value={training.targetDate} onChange={e=>setTraining({...training,targetDate:e.target.value})} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"/>
        <input aria-label="Training driver" placeholder="Why this training is needed" value={training.driver} onChange={e=>setTraining({...training,driver:e.target.value})} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2"/>
        <button type="button" disabled={busy||!training.memberId||!training.competencyId||!training.targetDate||training.driver.trim().length<10} onClick={()=>void saveTraining()} className="flex items-center justify-center gap-1 rounded bg-signal-cyan/15 px-3 py-1.5 text-xs text-signal-cyan disabled:opacity-40"><Save className="h-3 w-3" aria-hidden/>Record training plan</button>
      </div>}
      {message && <p className="mt-2 text-xs text-slate-300">{message}</p>}
      {!siteId && <p className="mt-3 text-xs text-amber-200">Choose a site in the header to calculate its change load. An all-sites total could hide a local capacity constraint.</p>}
      {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
      {load && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-white/6 bg-black/10 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Unweighted load index</div><div className="mt-1 text-xl font-semibold text-signal-cyan">{load.changeLoadIndex}</div></div>
            <div className="rounded-lg border border-white/6 bg-black/10 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Quantified backlog</div><div className="mt-1 text-sm font-semibold text-slate-200">{load.quantifiedLoadHours.toLocaleString()} h</div></div>
            <div className="rounded-lg border border-white/6 bg-black/10 p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">13-week net capacity</div><div className="mt-1 text-sm font-semibold text-slate-200">{load.horizonCapacityHours.toLocaleString()} h</div></div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {Object.entries(load.dimensions).map(([key,value]) => <div key={key} className="rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-2"><div className="text-[10px] text-slate-500">{LABELS[key as keyof SiteChangeLoad["dimensions"]]}</div><div className="mt-0.5 text-sm font-medium text-slate-200">{value}</div></div>)}
          </div>
          {load.forecastComputable ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-signal-cyan/15 bg-signal-cyan/[0.03] px-3 py-2.5 text-xs text-slate-300"><Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-cyan" aria-hidden /><span>Declared backlog consumes {load.horizonUtilizationPct?.toFixed(2)}% of the measured 13-week capacity envelope ({load.weeksToAbsorb?.toFixed(2)} weeks at the recorded net weekly capacity).</span></div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>Absorption forecast not computable: {load.forecastState.replaceAll("_"," ")}. Missing evidence is shown below; it is not treated as zero.</span></div>
          )}
          {Object.keys(load.evidenceGaps).length>0 && <div className="mt-2 text-[11px] text-amber-100/80">Evidence gaps: {Object.entries(load.evidenceGaps).map(([key,value])=>`${key}: ${String(value)}`).join(" · ")}</div>}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Each canonical record contributes one unweighted signal; unlike records are not claimed to have equal severity. Capacity deductions are context only because recorded craft capacity is already net. Decision support only—no work, change, or person is approved or ranked here.</p>
        </>
      )}
    </section>
  );
}
