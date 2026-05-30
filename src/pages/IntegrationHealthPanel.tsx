import { useState } from "react";
import { Plug, Activity, Clock, CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, TrendingUp, RefreshCw, Server, Database, Cloud, Radio, ChevronRight, Zap, Shield, Cpu } from "lucide-react";
import { motion } from "framer-motion";

type IntegrationStatus = "healthy" | "degraded" | "down" | "maintenance";

interface Integration {
  id: string;
  name: string;
  type: "data_source" | "ai_model" | "enterprise" | "iot";
  status: IntegrationStatus;
  latency: string;
  uptime: string;
  lastSync: string;
  throughput: string;
  description: string;
  icon: React.ElementType;
}

const integrations: Integration[] = [
  { id: "erp", name: "SAP EAM", type: "enterprise", status: "healthy", latency: "42ms", uptime: "99.97%", lastSync: "2 min ago", throughput: "1,240 records/hr", description: "Work orders, asset master, parts inventory", icon: Database },
  { id: "scada", name: "SCADA / OSIsoft PI", type: "data_source", status: "healthy", latency: "8ms", uptime: "99.99%", lastSync: "Real-time", throughput: "48K points/sec", description: "Process data, sensor signals, alarms", icon: Radio },
  { id: "iot", name: "IoT Gateway Cluster", type: "iot", status: "healthy", latency: "15ms", uptime: "99.94%", lastSync: "Real-time", throughput: "12K messages/sec", description: "Vibration, temperature, pressure sensors", icon: Cpu },
  { id: "cmms", name: "Maximo (Legacy)", type: "enterprise", status: "degraded", latency: "380ms", uptime: "98.2%", lastSync: "14 min ago", throughput: "420 records/hr", description: "Historical work orders, PM schedules", icon: Server },
  { id: "ai-primary", name: "SyncAI Inference Engine", type: "ai_model", status: "healthy", latency: "120ms", uptime: "99.98%", lastSync: "Active", throughput: "2.4K inferences/hr", description: "Predictive models, anomaly detection, NLP", icon: Zap },
  { id: "ai-training", name: "Model Training Pipeline", type: "ai_model", status: "healthy", latency: "—", uptime: "99.5%", lastSync: "Last run: 6h ago", throughput: "3 models/week", description: "Retraining, validation, deployment", icon: RefreshCw },
  { id: "weather", name: "Weather Service API", type: "data_source", status: "healthy", latency: "95ms", uptime: "99.9%", lastSync: "5 min ago", throughput: "24 calls/hr", description: "Ambient conditions for baseline adjustment", icon: Cloud },
  { id: "identity", name: "Azure AD / SSO", type: "enterprise", status: "healthy", latency: "55ms", uptime: "99.99%", lastSync: "Active", throughput: "—", description: "Authentication, role mapping, access control", icon: Shield },
];

const statusConfig: Record<IntegrationStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
  healthy: { color: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20", dot: "bg-teal-400", label: "Healthy" },
  degraded: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", dot: "bg-amber-400 animate-pulse", label: "Degraded" },
  down: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", dot: "bg-red-400 animate-pulse", label: "Down" },
  maintenance: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-400", label: "Maintenance" },
};

const typeLabels: Record<string, string> = {
  data_source: "Data Source",
  ai_model: "AI / ML",
  enterprise: "Enterprise",
  iot: "IoT / Edge",
};

function IntegrationCard({ integration, index }: { integration: Integration; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const sc = statusConfig[integration.status];
  const Icon = integration.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`border ${sc.border} rounded-xl overflow-hidden bg-[#0D1520] cursor-pointer hover:border-white/[0.12] transition-colors`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${sc.bg} flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${sc.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-200">{integration.name}</h4>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.color}`}>
                  {sc.label}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{integration.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-mono text-slate-300">{integration.latency}</div>
              <div className="text-[10px] text-slate-600">latency</div>
            </div>
            <ChevronRight className={`w-3.5 h-3.5 text-slate-600 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>
      </div>

      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        className="overflow-hidden"
      >
        <div className="px-4 pb-4 pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-white/[0.06]">
            <div>
              <div className="text-[10px] text-slate-600">Uptime</div>
              <div className="text-sm font-bold text-teal-400 mt-0.5">{integration.uptime}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600">Last Sync</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">{integration.lastSync}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600">Throughput</div>
              <div className="text-sm font-bold text-blue-400 mt-0.5">{integration.throughput}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600">Type</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">{typeLabels[integration.type]}</div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function IntegrationHealthPanel() {
  const [filter, setFilter] = useState<string>("all");
  const healthy = integrations.filter(i => i.status === "healthy").length;
  const degraded = integrations.filter(i => i.status === "degraded").length;
  const down = integrations.filter(i => i.status === "down").length;

  const filtered = filter === "all" ? integrations : integrations.filter(i => i.type === filter);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Integration Health</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time status of all connected systems and data pipelines</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-400 hover:bg-white/[0.08] transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh All
          </button>
        </div>
      </div>

      {/* Health Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-teal-400" />
            <span className="text-xs text-slate-500">Healthy</span>
          </div>
          <div className="text-3xl font-black text-teal-400">{healthy}</div>
          <div className="text-[10px] text-slate-600 mt-0.5">integrations</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs text-slate-500">Degraded</span>
          </div>
          <div className="text-3xl font-black text-amber-400">{degraded}</div>
          <div className="text-[10px] text-slate-600 mt-0.5">integrations</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-slate-500">Down</span>
          </div>
          <div className="text-3xl font-black text-red-400">{down}</div>
          <div className="text-[10px] text-slate-600 mt-0.5">integrations</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs text-slate-500">Avg Latency</span>
          </div>
          <div className="text-3xl font-black text-blue-400">102<span className="text-sm text-slate-500">ms</span></div>
          <div className="text-[10px] text-slate-600 mt-0.5">across all systems</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { value: "all", label: "All Systems" },
          { value: "data_source", label: "Data Sources" },
          { value: "ai_model", label: "AI / ML" },
          { value: "enterprise", label: "Enterprise" },
          { value: "iot", label: "IoT / Edge" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              filter === f.value
                ? "bg-teal-500/20 border border-teal-500/30 text-teal-400"
                : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Integration Cards */}
      <div className="space-y-3">
        {filtered.map((integration, i) => (
          <IntegrationCard key={integration.id} integration={integration} index={i} />
        ))}
      </div>

      {/* Data Pipeline Status */}
      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <Plug className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">Data Pipeline Health</div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            All integration health is monitored by SyncAI. Degraded connections trigger automatic failover or buffering.
            Historical data is preserved during outages and reconciled on reconnection.
          </p>
        </div>
      </div>
    </div>
  );
}
