import { useEffect } from "react";
import { ArrowUpRight, ClipboardCheck, ShieldCheck } from "lucide-react";
import { PublicProductHeader } from "../components/PublicProductHeader";
import { RiaAssessmentWorkspacePage } from "./RiaAssessmentWorkspacePage";

const ASSESSMENT_URL = "https://syncai.ca/reliability-assessment";

export const CANONICAL_RIA_LEDE =
  "SyncAI uses one bounded entry product: a 6–8 week Reliability Intelligence Assessment, built from customer-provided exports, with evidence-graded findings and a 90-day action plan.";

export function FirstCustomerPilotPage() {
  const isAssessmentWorkspace =
    typeof window !== "undefined" &&
    window.location.pathname === "/pilot/reliability";

  useEffect(() => {
    if (!isAssessmentWorkspace) {
      document.title = "Reliability Intelligence Assessment | SyncAI";
    }
  }, [isAssessmentWorkspace]);

  if (isAssessmentWorkspace) {
    return <RiaAssessmentWorkspacePage />;
  }

  return (
    <main className="min-h-screen bg-[#0B0F14] text-[#E6EDF3]">
      <PublicProductHeader active="proof" />
      <section className="mx-auto max-w-5xl px-6 py-10 sm:py-20">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-teal-200">
          <ClipboardCheck size={14} />
          Reliability Intelligence Assessment
        </div>
        <h1 className="mt-6 max-w-4xl text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.04em] text-white min-[420px]:text-[2rem] sm:text-5xl md:text-6xl">
          Know what your maintenance data actually proves.
        </h1>
        {/*
          Do not use leading-8 / leading-12 / leading-16 here. This repo
          remaps --spacing-8 to 8px, and Tailwind v4 resolves leading-*
          through the spacing scale, so leading-8 becomes line-height: 8px
          and paints every line of this lede on top of the last.
        */}
        <p
          data-testid="assessment-hero-lede"
          className="mt-6 max-w-3xl text-[0.95rem] leading-[1.7] text-slate-300 min-[420px]:text-base sm:text-lg"
        >
          {CANONICAL_RIA_LEDE}
        </p>
        <p
          data-testid="assessment-hero-price"
          className="mt-4 max-w-3xl text-sm font-semibold text-teal-200/90"
        >
          Standard fee: US$35,000 fixed · normally 6–8 weeks · final terms in the proposal/SOW.
        </p>
        <div
          data-testid="assessment-hero-constraints"
          className="mt-6 grid gap-3 text-sm leading-[1.55] text-slate-300 sm:grid-cols-2"
        >
          <p className="rounded-lg border border-white/10 p-4">
            No software installation or production credentials for the
            assessment.
          </p>
          <p className="rounded-lg border border-white/10 p-4">
            No unsupported ROI or engineering conclusion is presented as fact.
          </p>
        </div>
        <div
          data-testid="assessment-hero-cta"
          className="mt-6 flex flex-col gap-3 sm:mt-10 sm:flex-row"
        >
          <a
            href={ASSESSMENT_URL}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-300 px-6 py-3 text-sm font-bold text-slate-950"
          >
            View the assessment <ArrowUpRight size={16} />
          </a>
          <a
            href="/workspace"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-white"
          >
            <ShieldCheck size={16} />
            Try Reliability Engineer
          </a>
        </div>
      </section>
    </main>
  );
}
