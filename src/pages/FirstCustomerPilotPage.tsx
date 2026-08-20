import { useEffect } from "react";
import { ArrowUpRight, ClipboardCheck, ShieldCheck } from "lucide-react";
import { PublicProductHeader } from "../components/PublicProductHeader";

const ASSESSMENT_URL = "https://syncai.ca/reliability-assessment";

export function FirstCustomerPilotPage() {
  useEffect(() => {
    document.title = "Reliability Intelligence Assessment | SyncAI";
  }, []);

  return (
    <main className="min-h-screen bg-[#0B0F14] text-[#E6EDF3]">
      <PublicProductHeader active="proof" />
      <section className="mx-auto max-w-5xl px-6 py-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-teal-200"><ClipboardCheck size={14} />Reliability Intelligence Assessment</div>
        <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">Know what your maintenance data actually proves.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">The former 48-hour value-proof offer has been retired. SyncAI now uses one bounded entry product: a US$35,000, 6–8 week Reliability Intelligence Assessment built from customer-provided exports with evidence-graded findings and a 90-day action plan.</p>
        <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-2"><p className="rounded-lg border border-white/10 p-4">No software installation or production credentials for the assessment.</p><p className="rounded-lg border border-white/10 p-4">No unsupported ROI or engineering conclusion is presented as fact.</p></div>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row"><a href={ASSESSMENT_URL} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-300 px-6 py-3 text-sm font-bold text-slate-950">View the assessment <ArrowUpRight size={16} /></a><a href="/demo/copilot#syncai-chat" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-white"><ShieldCheck size={16} />Try Reliability Engineer</a></div>
      </section>
    </main>
  );
}
