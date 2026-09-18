import { Timer } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";

interface ComponentMetric { key:string; label:string; meanHours:number|null; sampleCount:number }
interface Result { available:boolean; closedEvents:number; mttrHours:number|null; components:ComponentMetric[]; basis:string; error?:string }

async function load():Promise<Result> {
  const {data,error}=await supabase.rpc("get_restoration_time_components",{p_window_days:365});
  if(error) throw new Error(error.message);
  const result=data as Result;
  if(result.error) throw new Error(result.error);
  return result;
}

export function RestorationTimeComponents(){
  const {data,loading,error,refetch}=useAsyncData(load,[]);
  if(loading) return <LoadingState label="Measuring restoration time"/>;
  if(error) return <ErrorState message={error} onRetry={refetch}/>;
  if(!data?.available) return <section aria-labelledby="restoration-time-heading" className="space-y-3"><h2 id="restoration-time-heading" className="text-lg font-semibold text-white">Restoration Time</h2><EmptyState message="No closed restoration event is recorded in the reporting window."/></section>;
  return <section aria-labelledby="restoration-time-heading" className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="restoration-time-heading" className="flex items-center gap-2 text-lg font-semibold text-white"><Timer className="h-5 w-5 text-signal-cyan" aria-hidden/>Restoration Time</h2><p className="mt-1 max-w-4xl text-sm text-slate-300">{data.basis}</p></div><div className="text-right"><div className="text-3xl font-semibold tabular-nums text-signal-cyan">{data.mttrHours} h</div><div className="text-xs text-slate-500">mean total restoration · {data.closedEvents} event(s)</div></div></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{data.components.map(c=><div key={c.key} className="rounded-lg border border-white/8 bg-white/3 p-3"><div className="text-xl font-semibold tabular-nums text-white">{c.meanHours==null?"Not measurable":`${c.meanHours} h`}</div><div className="mt-1 text-xs text-slate-400">{c.label}</div><div className="mt-1 text-[11px] text-slate-600">{c.sampleCount} measured event(s)</div></div>)}</div>
  </section>;
}
