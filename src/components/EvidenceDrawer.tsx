import { useState } from "react";
import {
  X,
  FileText,
  TrendingUp,
  Activity,
  Clock,
  ChevronRight,
  ExternalLink,
  TriangleAlert as AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface EvidenceItem {
  id: string;
  type: "sensor" | "trend" | "document" | "historical" | "model";
  title: string;
  summary: string;
  confidence: number;
  timestamp: string;
  source: string;
  details?: string;
}

interface EvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  asset?: string;
  evidence?: EvidenceItem[];
}

const defaultEvidence: EvidenceItem[] = [
  {
    id: "ev-1",
    type: "sensor",
    title: "Vibration Level — Bearing DE",
    summary:
      "Peak velocity 12.4 mm/s (threshold 10.0 mm/s). Trending upward for 14 days.",
    confidence: 94,
    timestamp: "2026-05-30 06:42 UTC",
    source: "Sensor GW-C22-VIB-01",
    details:
      "Spectral analysis shows 1x and 2x harmonics consistent with inner race defect at 142 Hz BPFI.",
  },
  {
    id: "ev-2",
    type: "trend",
    title: "Temperature Trend — Drive End",
    summary: "Operating temperature increased 8C over baseline in 21 days.",
    confidence: 87,
    timestamp: "2026-05-30 06:40 UTC",
    source: "Sensor GW-C22-TEMP-03",
  },
  {
    id: "ev-3",
    type: "historical",
    title: "Historical Failure Pattern Match",
    summary:
      "Current signature matches 4 of 5 previous bearing failures on this asset class.",
    confidence: 82,
    timestamp: "2026-05-30 05:00 UTC",
    source: "Failure History DB — 847 records analyzed",
    details:
      "Mean time from this signature to failure: 9.2 days (std dev: 3.1 days). P10: 4 days, P90: 14 days.",
  },
  {
    id: "ev-4",
    type: "model",
    title: "Predictive Model Output",
    summary:
      "Random forest model predicts 82% failure probability within 14-day window.",
    confidence: 91,
    timestamp: "2026-05-30 06:00 UTC",
    source: "Model: bearing-failure-rf-v4.2",
    details:
      "Top features: vibration_velocity (0.34), temperature_delta (0.22), operating_hours_since_pm (0.18).",
  },
  {
    id: "ev-5",
    type: "document",
    title: "OEM Technical Bulletin",
    summary:
      "Manufacturer recommends replacement when vibration exceeds 10 mm/s sustained for 7+ days.",
    confidence: 100,
    timestamp: "2024-03-15",
    source: "TB-2024-0891 — ABC Bearings Ltd",
  },
];

const typeConfig: Record<
  string,
  { icon: React.ElementType; color: string; bg: string }
> = {
  sensor: { icon: Activity, color: "text-teal-400", bg: "bg-teal-500/10" },
  trend: { icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10" },
  document: { icon: FileText, color: "text-slate-400", bg: "bg-slate-500/10" },
  historical: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
  model: { icon: AlertTriangle, color: "text-cyan-400", bg: "bg-cyan-500/10" },
};

function EvidenceCard({ item }: { item: EvidenceItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = typeConfig[item.type];
  const Icon = config.icon;

  return (
    <div
      className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.02] hover:bg-white/[0.03] transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${config.bg} flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-200">
              {item.title}
            </h4>
            <ChevronRight
              className={`w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {item.summary}
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs">
            <span className="text-slate-400">{item.source}</span>
            <span className="text-slate-400">|</span>
            <span className="font-mono text-teal-400">
              {item.confidence}% confidence
            </span>
          </div>

          <AnimatePresence>
            {expanded && item.details && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {item.details}
                  </p>
                  <div className="text-xs text-slate-400 mt-2">
                    {item.timestamp}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export function EvidenceDrawer({
  open,
  onClose,
  title,
  asset,
  evidence = defaultEvidence,
}: EvidenceDrawerProps) {
  const overallConfidence = Math.round(
    evidence.reduce((acc, e) => acc + e.confidence, 0) / evidence.length,
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 h-full w-full max-w-lg bg-[#0A0F15] border-l border-white/[0.06] z-50 flex flex-col overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Evidence Package
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {title}
                  {asset ? ` — ${asset}` : ""}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Bar */}
            <div className="px-6 py-3 border-b border-white/[0.06] flex items-center gap-4 bg-white/[0.02] flex-shrink-0">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">
                  Evidence Points
                </div>
                <div className="text-lg font-black text-slate-200">
                  {evidence.length}
                </div>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">
                  Avg Confidence
                </div>
                <div className="text-lg font-black text-teal-400">
                  {overallConfidence}%
                </div>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">
                  Sources
                </div>
                <div className="text-lg font-black text-blue-400">
                  {new Set(evidence.map((e) => e.type)).size}
                </div>
              </div>
            </div>

            {/* Evidence List */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {evidence.map((item) => (
                <EvidenceCard key={item.id} item={item} />
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/[0.06] flex-shrink-0 flex items-center justify-between">
              <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
                Export Evidence Package
              </button>
              <div className="text-xs text-slate-400">
                All evidence is immutable and audit-logged
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
