import {
  BadgeCheck,
  BookCheck,
  Boxes,
  Calculator,
  ChartNoAxesCombined,
  ClipboardCheck,
  RefreshCw,
  ScanSearch,
} from "lucide-react";

const engineeringLoop = [
  {
    title: "Approved intent",
    detail: "Requirements, standards, and approved engineering knowledge.",
    icon: BookCheck,
  },
  {
    title: "Asset truth",
    detail: "Configuration, hierarchy, and current operating context.",
    icon: Boxes,
  },
  {
    title: "Operational evidence",
    detail: "Work history, inspections, events, and condition data.",
    icon: ScanSearch,
  },
  {
    title: "Deterministic analysis",
    detail: "Transparent reliability, risk, and value calculations.",
    icon: Calculator,
  },
  {
    title: "Technical authority",
    detail: "Qualified people review uncertainty and approve the decision.",
    icon: BadgeCheck,
  },
  {
    title: "Controlled execution",
    detail: "Approved work and change with an owner and traceable controls.",
    icon: ClipboardCheck,
  },
  {
    title: "Verified outcomes",
    detail: "Measure risk, uptime, cost, and value after the action window.",
    icon: ChartNoAxesCombined,
  },
  {
    title: "Learning",
    detail: "Feed results back into the next requirement and decision.",
    icon: RefreshCw,
  },
];

export function GovernedEngineeringLoop() {
  return (
    <section
      aria-labelledby="governed-engineering-loop-title"
      className="border-y border-white/[0.07] bg-black/20 px-4 py-12 sm:px-6"
    >
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
            <BadgeCheck size={17} />
            Governed industrial engineering intelligence
          </div>
          <h2
            id="governed-engineering-loop-title"
            className="mt-3 text-2xl font-bold text-[#F8FAFC] sm:text-3xl"
          >
            From approved intent to measured outcome.
          </h2>
          <p className="mt-3 text-sm leading-[1.65] text-slate-400 sm:text-base">
            Every recommendation moves through an evidence and authority chain.
            There is no black-box jump from a prompt to controlled work.
          </p>
        </div>

        <ol className="mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-6 xl:grid-cols-4">
          {engineeringLoop.map((stage, index) => {
            const Icon = stage.icon;

            return (
              <li
                key={stage.title}
                className="relative border-l border-white/[0.09] pl-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-300/10 text-teal-200">
                    <Icon size={16} />
                  </span>
                  <span className="text-xs font-semibold text-slate-600">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-100">
                  {stage.title}
                </div>
                <p className="mt-1 text-xs leading-[1.55] text-slate-500">
                  {stage.detail}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
