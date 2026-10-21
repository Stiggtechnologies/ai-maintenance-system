import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import {
  planReferenceHierarchy,
  planStepStatuses,
  systemReferenceModelsByIndustry,
  type ExistingLocationRef,
  type HierarchyPlanStep,
  type PlanStepState,
} from "../lib/asset-twins/reference-hierarchy-plan";

const STATE_LABEL: Record<PlanStepState, string> = {
  verified: "Verified",
  proposed: "Awaiting review",
  ready: "Ready to propose",
  waiting_for_parent: "Waiting for parent",
};

const STATE_CLASS: Record<PlanStepState, string> = {
  verified: "bg-teal-400/10 text-teal-200",
  proposed: "bg-amber-400/10 text-amber-200",
  ready: "bg-cyan-400/10 text-cyan-200",
  waiting_for_parent: "bg-white/5 text-slate-400",
};

const INDENT: Record<HierarchyPlanStep["kind"], string> = {
  area: "",
  system: "pl-4",
  functional_location: "pl-8",
};

/**
 * Lays out an industry reference model as the hierarchy proposals a site
 * would make, in the order the database accepts them. "Use this step" only
 * fills the proposal form; the person still chooses their own verified
 * evidence and submits, and an independent person verifies.
 */
export function ReferenceHierarchyPlanPanel({
  existing,
  onUseStep,
}: {
  existing: ExistingLocationRef[];
  onUseStep: (step: HierarchyPlanStep, parentLocationId: string | null) => void;
}) {
  const industries = Object.keys(systemReferenceModelsByIndustry);
  const [industry, setIndustry] = useState(industries[0] ?? "");
  const [areaCode, setAreaCode] = useState("DH1");
  const [areaName, setAreaName] = useState("Data hall 1");
  const [showEquipment, setShowEquipment] = useState(false);

  const result = useMemo(() => {
    const model = systemReferenceModelsByIndustry[industry];
    if (!model) return { error: "No reference model for this industry." } as const;
    try {
      const plan = planReferenceHierarchy(model, { code: areaCode, name: areaName });
      return { plan, statuses: planStepStatuses(plan, existing) } as const;
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Plan could not be built." } as const;
    }
  }, [industry, areaCode, areaName, existing]);

  return (
    <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-violet-300" aria-hidden />
        <h3 className="font-semibold text-white">Start from an industry reference model</h3>
      </div>
      <p className="text-sm text-slate-400">
        Draft reference structure: systems, subsystems and the equipment under them. Each node is still
        proposed by you with your own verified evidence and verified by an independent reviewer; nothing is
        created automatically.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-slate-400">
          <span>Industry model</span>
          <select
            aria-label="Industry model"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
          >
            {industries.map((code) => (
              <option key={code} value={code}>
                {systemReferenceModelsByIndustry[code].name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-slate-400">
          <span>Area code</span>
          <input
            aria-label="Area code"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-400">
          <span>Area name</span>
          <input
            aria-label="Area name"
            value={areaName}
            onChange={(e) => setAreaName(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      {"error" in result ? (
        <p role="alert" className="text-sm text-rose-300">
          {result.error}
        </p>
      ) : (
        <>
          <ol className="max-h-80 space-y-1 overflow-y-auto text-sm" aria-label="Reference hierarchy steps">
            {result.plan.steps.map((step, i) => {
              const status = result.statuses[i];
              return (
                <li key={step.code} className={`flex items-center gap-3 ${INDENT[step.kind]}`}>
                  <span className="w-48 shrink-0 truncate font-mono text-xs text-slate-400">{step.code}</span>
                  <span className="flex-1 truncate text-slate-200">{step.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_CLASS[status.state]}`}>
                    {STATE_LABEL[status.state]}
                  </span>
                  <button
                    type="button"
                    disabled={status.state !== "ready"}
                    onClick={() => onUseStep(step, status.parentLocationId)}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Use this step
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={() => setShowEquipment((v) => !v)}
            className="text-xs text-slate-400 underline"
          >
            {showEquipment ? "Hide" : "Show"} equipment and twin templates ({result.plan.equipment.length})
          </button>
          {showEquipment && (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs text-slate-400" aria-label="Reference equipment">
              {result.plan.equipment.map((item) => (
                <li key={item.referenceNodeCode} className="flex gap-3">
                  <span className="w-48 shrink-0 truncate font-mono">{item.locationCode}</span>
                  <span className="flex-1 truncate text-slate-300">{item.name}</span>
                  <span className="font-mono">{item.assetClassTemplateCode ?? "template planned"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
