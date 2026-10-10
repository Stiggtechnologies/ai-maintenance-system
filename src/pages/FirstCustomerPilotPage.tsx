import { useEffect } from "react";
import {
  ArrowUpRight,
  Building2,
  ClipboardCheck,
  Rocket,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { PublicProductHeader } from "../components/PublicProductHeader";
import {
  CANONICAL_RIA_LEDE,
  COMMERCIAL_VALUE_LADDER,
} from "../lib/commercial-value-ladder";
import { RiaAssessmentWorkspacePage } from "./RiaAssessmentWorkspacePage";
import { usePublicJourneyTheme } from "../lib/use-public-journey-theme";
import { publicJourneyPath } from "../lib/public-journey-context";

const ASSESSMENT_URL = "https://syncai.ca/contact";

export function FirstCustomerPilotPage() {
  const { theme } = usePublicJourneyTheme();
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
    <main className="public-journey" data-theme={theme}>
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
          Standard fee: US$35,000 fixed · normally 6–8 weeks · final terms in
          the proposal/SOW.
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
            Discuss an assessment <ArrowUpRight size={16} />
          </a>
          <a
            href={publicJourneyPath("/workspace", window.location.search)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-white"
          >
            <ShieldCheck size={16} />
            Try Reliability Engineer
          </a>
        </div>

        <section className="mt-14 border-t border-white/10 pt-10 sm:mt-20 sm:pt-14">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
              From evidence to operating capability
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
              Start bounded. Expand only when the proof earns it.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
              The assessment is the entry product when the baseline is not yet
              defensible. Each later scope closes with a customer-owned
              expansion decision—never an automatic upgrade.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COMMERCIAL_VALUE_LADDER.map((step, index) => {
              const Icon = [ClipboardCheck, Workflow, Rocket, Building2][
                index
              ]!;
              return (
                <article
                  key={step.title}
                  className="rounded-xl border border-white/10 bg-white/[0.025] p-5"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-300/20 bg-teal-300/10 text-teal-200">
                    <Icon size={17} aria-hidden />
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1 font-semibold text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {step.detail}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-teal-300/20 bg-teal-300/[0.06] p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-teal-100">
              Forward-Deployed Engineering
            </h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
              During implementation, named SyncAI practitioners work virtually
              with your product, reliability, maintenance, engineering, data,
              and security owners to configure the approved solution and
              transfer the operating runbook. Your organization retains every
              engineering, investment, operating, safety, and risk-acceptance
              decision.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
