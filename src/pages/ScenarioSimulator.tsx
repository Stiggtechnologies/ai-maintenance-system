import { useState } from "react";
import { ChartBar as BarChart2, Zap, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Scenario {
  id: string;
  label: string;
  description: string;
  cost: string;
  downtimeHours: number;
  productionImpact: string;
  safetyRisk: "High" | "Medium" | "Low" | "None";
  failureProbability: number;
  financialExposure: string;
  aiRecommended: boolean;
  pros: string[];
  cons: string[];
}

const assetOptions = [
  { id: "c22", label: "Conveyor C-22", risk: 82, window: "9 days" },
  { id: "p101", label: "Pump P-101", risk: 67, window: "14 days" },
  { id: "k05", label: "Compressor K-05", risk: 44, window: "21 days" },
];

const scenarioSets: Record<string, Scenario[]> = {
  c22: [
    {
      id: "now",
      label: "Execute Maintenance Now",
      description: "Advance bearing replacement — 8-hour planned outage today",
      cost: "$28,000",
      downtimeHours: 8,
      productionImpact: "$420K lost production",
      safetyRisk: "Low",
      failureProbability: 4,
      financialExposure: "$448K",
      aiRecommended: true,
      pros: [
        "Eliminates $2.4M unplanned downtime risk",
        "Planned outage minimizes production disruption",
        "Addresses root cause",
      ],
      cons: ["8 hours of planned downtime", "$28K immediate cost"],
    },
    {
      id: "defer7",
      label: "Defer Maintenance 7 Days",
      description: "Monitor and proceed with PM in 7 days",
      cost: "$28,000",
      downtimeHours: 14,
      productionImpact: "$1.1M potential loss",
      safetyRisk: "Medium",
      failureProbability: 54,
      financialExposure: "$1.15M",
      aiRecommended: false,
      pros: ["Allows production to continue for 7 days"],
      cons: [
        "54% failure probability during deferral",
        "Unplanned failure costs 3× more",
        "Safety risk increases",
      ],
    },
    {
      id: "defer14",
      label: "Defer Maintenance 14 Days",
      description: "Continue operation, schedule PM in 14 days",
      cost: "$28,000",
      downtimeHours: 48,
      productionImpact: "$2.4M potential loss",
      safetyRisk: "High",
      failureProbability: 82,
      financialExposure: "$2.43M",
      aiRecommended: false,
      pros: ["Allows 14 days of continued production"],
      cons: [
        "82% failure probability",
        "$2.4M downtime exposure",
        "High safety risk",
        "Possible catastrophic damage",
      ],
    },
    {
      id: "rtf",
      label: "Run to Failure",
      description: "No maintenance — allow natural failure",
      cost: "$180,000",
      downtimeHours: 96,
      productionImpact: "$4.8M+",
      safetyRisk: "High",
      failureProbability: 100,
      financialExposure: "$4.98M",
      aiRecommended: false,
      pros: ["No immediate cost"],
      cons: [
        "Guaranteed catastrophic failure",
        "$4.8M+ unplanned downtime",
        "High safety risk",
        "Potential secondary damage",
      ],
    },
    {
      id: "replace",
      label: "Replace Asset",
      description: "Capital replacement of Conveyor C-22",
      cost: "$1.4M",
      downtimeHours: 240,
      productionImpact: "$12.6M",
      safetyRisk: "Low",
      failureProbability: 2,
      financialExposure: "$14M",
      aiRecommended: false,
      pros: [
        "Eliminates all future bearing failures",
        "New asset warranty",
        "Modern specification",
      ],
      cons: [
        "$1.4M capital cost",
        "240-hour shutdown required",
        "Requires capital approval",
      ],
    },
    {
      id: "reduce",
      label: "Reduce Production Rate",
      description: "Reduce load by 30% to extend asset life",
      cost: "$8,000",
      downtimeHours: 0,
      productionImpact: "$640K/week lost production",
      safetyRisk: "Low",
      failureProbability: 24,
      financialExposure: "$648K/week",
      aiRecommended: false,
      pros: [
        "Reduces failure probability from 82% to 24%",
        "No downtime required",
      ],
      cons: [
        "$640K/week production loss",
        "Does not address root cause",
        "Temporary solution only",
      ],
    },
  ],
};

const safetyColors: Record<string, string> = {
  High: "text-red-400 bg-red-500/10",
  Medium: "text-amber-400 bg-amber-500/10",
  Low: "text-teal-400 bg-teal-500/10",
  None: "text-slate-400 bg-slate-500/10",
};

function ScenarioCard({
  scenario,
  selected,
  onSelect,
}: {
  scenario: Scenario;
  selected: boolean;
  onSelect: () => void;
}) {
  const probColor =
    scenario.failureProbability >= 70
      ? "text-red-400"
      : scenario.failureProbability >= 40
        ? "text-amber-400"
        : "text-teal-400";
  const probBar =
    scenario.failureProbability >= 70
      ? "bg-red-500"
      : scenario.failureProbability >= 40
        ? "bg-amber-500"
        : "bg-teal-500";

  return (
    <motion.div
      layout
      onClick={onSelect}
      className={`bg-[#0D1520] rounded-xl border cursor-pointer transition-all ${
        selected
          ? "border-teal-500/50 ring-1 ring-teal-500/30"
          : scenario.aiRecommended
            ? "border-teal-500/20 hover:border-teal-500/40"
            : "border-white/[0.06] hover:border-white/[0.12]"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-200">
                {scenario.label}
              </h3>
              {scenario.aiRecommended && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500/30 font-semibold flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> AI Recommended
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {scenario.description}
            </p>
          </div>
          <div
            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selected ? "border-teal-400 bg-teal-400" : "border-slate-700"}`}
          >
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-white/[0.02] rounded-lg p-2">
            <div className="text-xs text-slate-400">Immediate Cost</div>
            <div className="text-sm font-bold text-slate-200 mt-0.5">
              {scenario.cost}
            </div>
          </div>
          <div className="bg-white/[0.02] rounded-lg p-2">
            <div className="text-xs text-slate-400">Downtime</div>
            <div className="text-sm font-bold text-slate-200 mt-0.5">
              {scenario.downtimeHours}h
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-400">Failure probability</span>
            <span className={`font-bold ${probColor}`}>
              {scenario.failureProbability}%
            </span>
          </div>
          <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${scenario.failureProbability}%` }}
              transition={{ duration: 0.6 }}
              className={`h-full rounded-full ${probBar}`}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${safetyColors[scenario.safetyRisk]}`}
          >
            {scenario.safetyRisk} Safety Risk
          </span>
          <span className="text-xs text-slate-400">
            Exposure:{" "}
            <span className="text-slate-300 font-medium">
              {scenario.financialExposure}
            </span>
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function ScenarioSimulator() {
  const [selectedAsset, setSelectedAsset] = useState("c22");
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>(["now"]);
  const [comparing, setComparing] = useState(false);

  const scenarios = scenarioSets[selectedAsset] || scenarioSets["c22"];
  const compareScenarios = scenarios.filter((s) =>
    selectedScenarios.includes(s.id),
  );

  const toggleScenario = (id: string) => {
    setSelectedScenarios((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Scenario Simulator
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Compare operational decisions before committing
          </p>
        </div>
        <button
          onClick={() => setComparing(!comparing)}
          disabled={selectedScenarios.length < 2}
          className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 rounded-lg text-xs text-teal-400 font-medium hover:bg-teal-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <BarChart2 className="w-3.5 h-3.5" /> Compare Selected (
          {selectedScenarios.length})
        </button>
      </div>

      {/* Asset Selector */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
        <div className="text-xs text-slate-400 mb-3">
          Select Asset to Simulate
        </div>
        <div className="flex flex-wrap gap-2">
          {assetOptions.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setSelectedAsset(a.id);
                setSelectedScenarios(["now"]);
                setComparing(false);
              }}
              className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                selectedAsset === a.id
                  ? "border-teal-500/40 bg-teal-500/10 text-teal-400"
                  : "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-slate-200"
              }`}
            >
              <div>{a.label}</div>
              <div className="text-xs mt-0.5 font-normal opacity-70">
                {a.risk}% risk · {a.window}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Scenario Grid */}
      {!comparing && (
        <>
          <div className="text-xs text-slate-400">
            Select 2+ scenarios to compare.{" "}
            <span className="text-teal-400">
              AI recommendation highlighted.
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {scenarios.map((scenario, i) => (
              <motion.div
                key={scenario.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <ScenarioCard
                  scenario={scenario}
                  selected={selectedScenarios.includes(scenario.id)}
                  onSelect={() => toggleScenario(scenario.id)}
                />
              </motion.div>
            ))}
          </div>
        </>
      )}

      {/* Comparison View */}
      <AnimatePresence>
        {comparing && compareScenarios.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">
                Scenario Comparison
              </h2>
              <button
                onClick={() => setComparing(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Back to Selection
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr>
                    <td className="text-[11px] text-slate-400 pb-3 w-36">
                      Metric
                    </td>
                    {compareScenarios.map((s) => (
                      <td
                        key={s.id}
                        className="text-[11px] text-slate-200 font-semibold pb-3 px-3"
                      >
                        {s.label}
                        {s.aiRecommended && (
                          <span className="ml-1 text-xs text-teal-400">
                            ★ AI
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {[
                    { label: "Immediate Cost", key: "cost" as keyof Scenario },
                    {
                      label: "Downtime",
                      key: "downtimeHours" as keyof Scenario,
                      suffix: "h",
                    },
                    {
                      label: "Production Impact",
                      key: "productionImpact" as keyof Scenario,
                    },
                    {
                      label: "Safety Risk",
                      key: "safetyRisk" as keyof Scenario,
                    },
                    {
                      label: "Failure Probability",
                      key: "failureProbability" as keyof Scenario,
                      suffix: "%",
                    },
                    {
                      label: "Financial Exposure",
                      key: "financialExposure" as keyof Scenario,
                    },
                  ].map((metric) => (
                    <tr key={metric.key}>
                      <td className="text-[11px] text-slate-400 py-2.5">
                        {metric.label}
                      </td>
                      {compareScenarios.map((s) => {
                        const val = s[metric.key];
                        return (
                          <td
                            key={s.id}
                            className="py-2.5 px-3 text-sm text-slate-300 font-medium"
                          >
                            {metric.suffix
                              ? `${val}${metric.suffix}`
                              : val?.toString()}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recommendation Summary */}
            <div className="bg-[#0D1520] border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
              <Zap className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-bold text-teal-400">
                  AI Recommendation
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Based on failure probability, financial exposure, safety risk,
                  and mission impact —
                  <span className="text-slate-200 font-medium">
                    {" "}
                    Execute Maintenance Now
                  </span>{" "}
                  is the optimal intervention. Deferral scenarios carry {">"}50%
                  failure probability and expose the operation to up to $2.4M in
                  unplanned costs.
                </p>
                <button className="mt-2 px-4 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors flex items-center gap-1.5">
                  <Plus className="w-3 h-3" /> Create Work Order — Execute Now
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
