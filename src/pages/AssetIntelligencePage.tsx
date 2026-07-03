import { useState } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  TriangleAlert as AlertTriangle,
  Cpu,
  Clock,
  ChevronRight,
  Radio,
  Layers,
  Gauge,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import type { DerivedAssetIntelligence } from "../services/onboardingOperatingLoop";

const assetData = {
  id: "C-22",
  name: "Conveyor C-22",
  class: "Belt Conveyor — Overland",
  system: "Material Handling",
  area: "Processing Plant",
  site: "Fort McMurray Site A",
  criticality: "A",
  status: "Watch",
  healthScore: 74,
  riskScore: 82,
  digitalTwinReady: true,
  lastInspection: "2026-05-22",
  nextPM: "2026-06-02",
  installedDate: "2019-03-15",
  manufacturer: "Metso Outotec",
  model: "HBF-2400",
  serialNumber: "MO-2019-HBF-88412",
};

const sensorSignals = [
  {
    id: "vib-de",
    label: "Vibration — Drive End",
    value: "12.4 mm/s",
    threshold: "10.0 mm/s",
    status: "alarm",
    trend: "up",
  },
  {
    id: "vib-nde",
    label: "Vibration — Non-Drive End",
    value: "6.2 mm/s",
    threshold: "10.0 mm/s",
    status: "normal",
    trend: "stable",
  },
  {
    id: "temp-de",
    label: "Temperature — Drive End",
    value: "78°C",
    threshold: "85°C",
    status: "warning",
    trend: "up",
  },
  {
    id: "temp-nde",
    label: "Temperature — Non-Drive End",
    value: "52°C",
    threshold: "85°C",
    status: "normal",
    trend: "stable",
  },
  {
    id: "belt-speed",
    label: "Belt Speed",
    value: "4.2 m/s",
    threshold: "4.5 m/s",
    status: "normal",
    trend: "stable",
  },
  {
    id: "motor-current",
    label: "Motor Current",
    value: "142 A",
    threshold: "160 A",
    status: "normal",
    trend: "up",
  },
  {
    id: "belt-alignment",
    label: "Belt Alignment",
    value: "±2.1 mm",
    threshold: "±5 mm",
    status: "normal",
    trend: "stable",
  },
  {
    id: "oil-level",
    label: "Gearbox Oil Level",
    value: "82%",
    threshold: "70%",
    status: "normal",
    trend: "down",
  },
];

const failureModes = [
  {
    mode: "Bearing Inner Race Defect",
    probability: 82,
    severity: "High",
    detection: "Vibration",
    riskScore: 36,
  },
  {
    mode: "Belt Splice Failure",
    probability: 23,
    severity: "Critical",
    detection: "Visual + Load",
    riskScore: 28,
  },
  {
    mode: "Gearbox Oil Degradation",
    probability: 34,
    severity: "Medium",
    detection: "Oil Analysis",
    riskScore: 15,
  },
  {
    mode: "Motor Winding Insulation",
    probability: 12,
    severity: "High",
    detection: "Current Analysis",
    riskScore: 12,
  },
  {
    mode: "Idler Seizure",
    probability: 45,
    severity: "Low",
    detection: "Infrared",
    riskScore: 9,
  },
];

const maintenanceHistory = [
  {
    date: "2026-05-22",
    type: "Inspection",
    description: "Routine visual inspection — bearing noise noted",
    status: "completed",
  },
  {
    date: "2026-05-15",
    type: "PM",
    description: "Scheduled PM — lubrication, belt tension check",
    status: "completed",
  },
  {
    date: "2026-04-28",
    type: "Corrective",
    description: "Replaced idler roller — seized bearing",
    status: "completed",
  },
  {
    date: "2026-04-10",
    type: "PM",
    description: "Quarterly oil analysis — results normal",
    status: "completed",
  },
  {
    date: "2026-03-20",
    type: "Inspection",
    description: "Vibration route — all readings within spec",
    status: "completed",
  },
];

const hierarchy = [
  { level: "Enterprise", name: "SyncAI Corp" },
  { level: "Site", name: "Fort McMurray Site A" },
  { level: "Area", name: "Processing Plant" },
  { level: "System", name: "Material Handling" },
  { level: "Asset", name: "Conveyor C-22" },
  { level: "Component", name: "Drive Assembly" },
  { level: "Sensor", name: "GW-C22-VIB-01" },
];

const statusConfig: Record<string, { color: string; bg: string }> = {
  alarm: { color: "text-red-400", bg: "bg-red-500/10" },
  warning: { color: "text-amber-400", bg: "bg-amber-500/10" },
  normal: { color: "text-teal-400", bg: "bg-teal-500/10" },
};

type Tab = "overview" | "sensors" | "failures" | "history" | "hierarchy";

function HealthRing({ score, size = 100 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 85 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#1e2d3d"
        strokeWidth={6}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
    </svg>
  );
}

function KeyValueGrid({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data);
  if (entries.length === 0)
    return <div className="text-xs text-slate-600">Pending validation</div>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span className="text-slate-600">{key}: </span>
          <span className="text-slate-300">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function OnboardedAssetDetail({ asset }: { asset: DerivedAssetIntelligence }) {
  const baseline = asset.reliabilityBaseline;
  return (
    <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Section title="Identity">
        <KeyValueGrid data={asset.identity} />
      </Section>
      <Section title="Hierarchy">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {asset.hierarchy.map((level, i) => (
            <span
              key={`${level.level}-${i}`}
              className="flex items-center gap-1"
            >
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-700" />}
              <span className="text-slate-300">{level.name}</span>
            </span>
          ))}
        </div>
      </Section>
      <Section title="Functional Definition">
        <KeyValueGrid data={asset.functionalDefinition} />
      </Section>
      <Section title="Operating Context">
        <KeyValueGrid data={asset.operatingContext} />
      </Section>
      <Section title="Criticality">
        <div className="text-xs text-slate-300">
          {asset.criticality.criticalityClass} · {asset.criticality.score}/
          {asset.criticality.maxScore} · Class {asset.criticalityLetter}
          <div className="text-slate-500 mt-1">
            Drivers: {asset.criticality.riskDrivers.join(", ")}
          </div>
        </div>
      </Section>
      <Section title="Reliability Baseline">
        <div className="text-xs text-slate-300">
          Failures: {baseline.failureCount} · Data quality:{" "}
          {baseline.dataQualityScore}% · Confidence: {baseline.confidence}
          <div className="text-slate-500 mt-1">
            Bad actor: {baseline.badActorStatus}
          </div>
        </div>
      </Section>
      <Section title="Lifecycle">
        <div className="text-xs text-slate-300">
          {asset.lifecycle.lifecycleStatus}
          <div className="text-slate-500 mt-1">
            RUL: {asset.lifecycle.remainingUsefulLifeEstimate} · Obsolescence:{" "}
            {asset.lifecycle.obsolescenceRisk}
          </div>
        </div>
      </Section>
      <Section title="Risk Safeguards">
        <div className="text-xs text-slate-300">
          Safety: {asset.riskSafeguards.safetyCriticality}
          {asset.riskSafeguards.humanApprovalGates.length > 0 && (
            <div className="text-slate-500 mt-1">
              Approval gates: {asset.riskSafeguards.humanApprovalGates.length}
            </div>
          )}
        </div>
      </Section>
      <Section title="Data Gaps">
        <div className="flex flex-wrap gap-1.5">
          {asset.dataGaps.length === 0 ? (
            <span className="text-xs text-teal-400">
              No outstanding data gaps
            </span>
          ) : (
            asset.dataGaps.map((gap) => (
              <span
                key={gap}
                className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"
              >
                {gap}
              </span>
            ))
          )}
        </div>
      </Section>
      <Section title="Readiness Status">
        <div className="text-xs text-slate-300">
          {asset.status} · {asset.completionScore}% onboarded ·{" "}
          {asset.readiness} readiness
          <div className="text-slate-500 mt-1">{asset.readinessMessage}</div>
        </div>
      </Section>
    </div>
  );
}

function OnboardedAssetsPanel({
  assets,
}: {
  assets: DerivedAssetIntelligence[];
}) {
  const [selected, setSelected] = useState<string>(assets[0]?.sessionId ?? "");
  if (assets.length === 0) return null;
  const active =
    assets.find((asset) => asset.sessionId === selected) ?? assets[0];

  return (
    <div className="bg-[#0D1520] border border-cyan-500/20 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-slate-200">
          Onboarded Assets
        </h3>
        <span className="text-[10px] text-slate-600 ml-auto">
          Reliability-ready intelligence from asset onboarding
        </span>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {assets.map((asset) => (
          <button
            key={asset.sessionId}
            onClick={() => setSelected(asset.sessionId)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              active.sessionId === asset.sessionId
                ? "bg-cyan-500/20 border border-cyan-500/30 text-cyan-400"
                : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
            }`}
          >
            {asset.assetId} · {asset.classLabel}
            <span className="ml-1.5 text-[10px] text-slate-500">
              {asset.completionScore}%
            </span>
          </button>
        ))}
      </div>
      <OnboardedAssetDetail asset={active} />
    </div>
  );
}

export function AssetIntelligencePage() {
  const [tab, setTab] = useState<Tab>("overview");
  const { assetIntelligence } = useOnboardingOperatingLoop();
  const healthColor =
    assetData.healthScore >= 85
      ? "text-green-400"
      : assetData.healthScore >= 60
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="p-6 space-y-6">
      {assetIntelligence.length > 0 && (
        <OnboardedAssetsPanel assets={assetIntelligence} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-slate-600 mb-1">
            <Layers className="w-3 h-3 text-teal-400" />
            <span>
              {assetData.area} / {assetData.system}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {assetData.name}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {assetData.class} · Criticality {assetData.criticality} ·{" "}
            {assetData.manufacturer} {assetData.model}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
              assetData.status === "Watch"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-teal-500/10 border-teal-500/30 text-teal-400"
            }`}
          >
            {assetData.status}
          </div>
          {assetData.digitalTwinReady && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-xs text-cyan-400 font-medium">
              <Cpu className="w-3.5 h-3.5" /> Digital Twin
            </div>
          )}
        </div>
      </div>

      {/* Health & Risk Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5 flex items-center gap-5">
          <div className="relative">
            <HealthRing score={assetData.healthScore} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-black ${healthColor}`}>
                {assetData.healthScore}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Asset Health Index</div>
            <div className={`text-xl font-black ${healthColor} mt-1`}>
              {assetData.healthScore}/100
            </div>
            <div className="text-[10px] text-slate-600 mt-1">
              Based on 8 sensor signals
            </div>
          </div>
        </div>

        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-slate-500">Risk Score</span>
          </div>
          <div className="text-3xl font-black text-red-400">
            {assetData.riskScore}%
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Failure probability within 14 days
          </div>
          <div className="h-2 bg-white/[0.05] rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full"
              style={{ width: `${assetData.riskScore}%` }}
            />
          </div>
        </div>

        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-600">Installed</div>
              <div className="text-slate-200 font-semibold mt-0.5">
                {assetData.installedDate}
              </div>
            </div>
            <div>
              <div className="text-slate-600">Serial</div>
              <div className="text-slate-200 font-semibold mt-0.5 truncate">
                {assetData.serialNumber}
              </div>
            </div>
            <div>
              <div className="text-slate-600">Last Inspection</div>
              <div className="text-slate-200 font-semibold mt-0.5">
                {assetData.lastInspection}
              </div>
            </div>
            <div>
              <div className="text-slate-600">Next PM</div>
              <div className="text-amber-400 font-semibold mt-0.5">
                {assetData.nextPM}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.06] pb-0">
        {[
          { id: "overview" as Tab, label: "Overview", icon: Gauge },
          { id: "sensors" as Tab, label: "Sensor Signals", icon: Activity },
          {
            id: "failures" as Tab,
            label: "Failure Modes",
            icon: AlertTriangle,
          },
          { id: "history" as Tab, label: "Maintenance History", icon: Clock },
          { id: "hierarchy" as Tab, label: "Asset Hierarchy", icon: Layers },
        ].map((t) => {
          const TIcon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${
                tab === t.id
                  ? "text-teal-400 border-teal-400"
                  : "text-slate-500 border-transparent hover:text-slate-300"
              }`}
            >
              <TIcon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-400" /> Active Alerts
            </h3>
            <div className="space-y-2">
              {sensorSignals
                .filter((s) => s.status !== "normal")
                .map((sig) => {
                  const sc = statusConfig[sig.status];
                  return (
                    <div
                      key={sig.id}
                      className={`flex items-center justify-between p-3 rounded-xl ${sc.bg} border border-white/[0.06]`}
                    >
                      <div>
                        <div className={`text-sm font-semibold ${sc.color}`}>
                          {sig.label}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Threshold: {sig.threshold}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-black ${sc.color}`}>
                          {sig.value}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-500">
                          {sig.trend === "up" && (
                            <TrendingUp className="w-3 h-3 text-red-400" />
                          )}
                          Trending {sig.trend}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-teal-400" /> AI Insights
            </h3>
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                <div className="text-sm font-semibold text-red-400">
                  Bearing Failure Imminent
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Inner race defect signature detected. Recommend intervention
                  within 36 hours.
                </p>
                <div className="text-[10px] text-slate-500 mt-2">
                  Confidence: 91% | Model: bearing-failure-rf-v4.2
                </div>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                <div className="text-sm font-semibold text-amber-400">
                  Temperature Trending
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Drive end temperature increasing at 0.4C/day. Will reach alarm
                  threshold in ~17 days if unchecked.
                </p>
                <div className="text-[10px] text-slate-500 mt-2">
                  Confidence: 82% | Model: thermal-regression-v2.1
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "sensors" && (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Radio className="w-4 h-4 text-teal-400" /> Live Sensor Feed
            </h3>
            <span className="text-[10px] text-teal-400 font-medium">
              8 signals active
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sensorSignals.map((sig, i) => {
              const sc = statusConfig[sig.status];
              return (
                <motion.div
                  key={sig.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`flex items-center justify-between p-3 rounded-xl border border-white/[0.06] ${sc.bg}`}
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      {sig.label}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Threshold: {sig.threshold}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-base font-black ${sc.color}`}>
                      {sig.value}
                    </div>
                    <div className="flex items-center gap-1 justify-end text-[10px] text-slate-500">
                      {sig.trend === "up" ? (
                        <TrendingUp className="w-2.5 h-2.5" />
                      ) : sig.trend === "down" ? (
                        <TrendingDown className="w-2.5 h-2.5" />
                      ) : null}
                      {sig.trend}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "failures" && (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Failure Mode
            Analysis (FMEA)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left py-3 px-3 text-slate-500 font-semibold">
                    Failure Mode
                  </th>
                  <th className="text-center py-3 px-3 text-slate-500 font-semibold">
                    Probability
                  </th>
                  <th className="text-center py-3 px-3 text-slate-500 font-semibold">
                    Severity
                  </th>
                  <th className="text-center py-3 px-3 text-slate-500 font-semibold">
                    Detection
                  </th>
                  <th className="text-center py-3 px-3 text-slate-500 font-semibold">
                    Risk Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {failureModes.map((fm) => (
                  <tr
                    key={fm.mode}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-3 text-slate-200 font-medium">
                      {fm.mode}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`font-mono font-bold ${fm.probability >= 70 ? "text-red-400" : fm.probability >= 40 ? "text-amber-400" : "text-teal-400"}`}
                      >
                        {fm.probability}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          fm.severity === "Critical"
                            ? "bg-red-500/20 text-red-400"
                            : fm.severity === "High"
                              ? "bg-amber-500/20 text-amber-400"
                              : fm.severity === "Medium"
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-slate-500/20 text-slate-400"
                        }`}
                      >
                        {fm.severity}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center text-slate-400">
                      {fm.detection}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`font-mono font-black text-base ${fm.riskScore >= 30 ? "text-red-400" : fm.riskScore >= 15 ? "text-amber-400" : "text-teal-400"}`}
                      >
                        {fm.riskScore}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" /> Maintenance History
          </h3>
          <div className="space-y-3">
            {maintenanceHistory.map((entry, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
              >
                <div
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                    entry.type === "Corrective"
                      ? "bg-amber-500/20 text-amber-400"
                      : entry.type === "PM"
                        ? "bg-teal-500/20 text-teal-400"
                        : "bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {entry.type}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200">
                    {entry.description}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-1">
                    {entry.date}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {tab === "hierarchy" && (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" /> Asset Hierarchy
          </h3>
          <div className="space-y-1">
            {hierarchy.map((h, i) => (
              <motion.div
                key={h.level}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-2"
                style={{ paddingLeft: `${i * 24}px` }}
              >
                {i > 0 && (
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-px bg-white/[0.1]" />
                    <ChevronRight className="w-3 h-3 text-slate-700" />
                  </div>
                )}
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                    h.level === "Asset"
                      ? "bg-teal-500/10 border border-teal-500/20"
                      : "bg-white/[0.03] border border-white/[0.05]"
                  }`}
                >
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${h.level === "Asset" ? "text-teal-400" : "text-slate-600"}`}
                  >
                    {h.level}
                  </span>
                  <span
                    className={`text-sm font-medium ${h.level === "Asset" ? "text-teal-400" : "text-slate-300"}`}
                  >
                    {h.name}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
