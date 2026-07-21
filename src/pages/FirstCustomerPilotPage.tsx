import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  ShieldCheck,
  Wrench,
} from "lucide-react";

const deliverables = [
  "Data quality assessment",
  "Bad actor Pareto",
  "MTBF / MTTR / availability where data supports it",
  "Guided reliability-ready asset onboarding package",
  "RCA or FRACAS starter pack for the top issue",
  "PM optimization opportunity list",
  "Executive reliability brief",
  "30-minute review call",
];

const fitSignals = [
  "250+ maintainable assets or one critical high-value system",
  "Exportable work-order history",
  "Repeat failures, backlog pressure, or painful reporting",
  "Reliability, maintenance, asset, or operations owner",
];

export function FirstCustomerPilotPage() {
  const subject = encodeURIComponent("SyncAI 14-day reliability pilot");
  const body = encodeURIComponent(
    [
      "Hi SyncAI team,",
      "",
      "I would like to discuss the 14-day Reliability Data-To-Decision Pilot.",
      "",
      "Company:",
      "Asset/system in scope:",
      "CMMS/EAM:",
      "Work-order history available:",
      "Primary reliability pain:",
      "",
      "Thanks,",
    ].join("\n"),
  );

  return (
    <main className="min-h-screen bg-industrial-black text-industrial-text gradient-mesh">
      <section className="mx-auto flex min-h-[88vh] max-w-7xl flex-col justify-center px-6 py-10">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-300">
            <Wrench size={14} />
            First 3 design partners
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight md:text-6xl">
            Turn one work-order export into a reliability decision package in 14
            days.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
            SyncAI Reliability Engineering Copilot helps maintenance and
            reliability teams convert existing asset history into bad actor
            analysis, RCA/FRACAS starter packs, PM optimization opportunities,
            asset onboarding, and executive reliability briefs.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`mailto:support@syncai.ca?subject=${subject}&body=${body}`}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
            >
              Start pilot
              <ArrowRight size={16} />
            </a>
            <a
              href="/demo/copilot"
              className="inline-flex items-center gap-2 rounded-lg border border-white/8 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/5"
            >
              Open live demo
            </a>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Metric icon={Gauge} label="Pilot length" value="14 days" />
          <Metric
            icon={BarChart3}
            label="Design partner fee"
            value="CAD $7.5K"
          />
          <Metric
            icon={ShieldCheck}
            label="Operating mode"
            value="Decision support"
          />
        </div>
      </section>

      <section className="border-y border-white/6 bg-black/20 px-6 py-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
              <ClipboardCheck size={17} />
              What the pilot delivers
            </div>
            <h2 className="mt-3 text-2xl font-bold">
              Concrete outputs, not a generic AI demo.
            </h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {deliverables.map((item) => (
                <div
                  key={item}
                  className="flex gap-3 rounded-lg border border-white/6 bg-white/3 p-4 text-sm text-slate-300"
                >
                  <CheckCircle2
                    size={17}
                    className="mt-0.5 shrink-0 text-teal-300"
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <ShieldCheck size={17} />
              Engineering boundary
            </div>
            <p className="mt-3 text-sm leading-6 text-amber-50">
              SyncAI provides reliability engineering decision support. Safety,
              environmental, regulatory, OEM-limit, operating-envelope, and
              production-critical decisions remain with qualified customer
              approvers.
            </p>
            <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-industrial-text">
              <FileText size={17} className="text-teal-300" />
              Best fit
            </div>
            <div className="mt-3 space-y-2">
              {fitSignals.map((item) => (
                <div key={item} className="flex gap-2 text-sm text-slate-300">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/3 p-5">
      <Icon size={18} className="text-teal-300" />
      <div className="mt-4 text-xs font-semibold uppercase text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
