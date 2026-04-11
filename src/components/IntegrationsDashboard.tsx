// SyncAI Integrations Dashboard
// Connect and manage external systems

import { useState } from "react";
import { Plug, Clock, Settings, RefreshCw, Gauge } from "lucide-react";

interface Integration {
  id: string;
  name: string;
  category: "data" | "cloud" | "iot" | "enterprise" | "ai";
  status: "connected" | "disconnected" | "error" | "syncing";
  lastSync: string;
  health: number;
  description: string;
  logo: string;
}

const integrations: Integration[] = [
  {
    id: "1",
    name: "SAP PM",
    category: "enterprise",
    status: "connected",
    lastSync: "2 min ago",
    health: 98,
    description: "Plant Maintenance integration",
    logo: "SAP",
  },
  {
    id: "2",
    name: "Oracle Fusion",
    category: "enterprise",
    status: "connected",
    lastSync: "5 min ago",
    health: 95,
    description: "ERP & Asset Management",
    logo: "ORC",
  },
  {
    id: "3",
    name: "SCADA System",
    category: "iot",
    status: "connected",
    lastSync: "Real-time",
    health: 99,
    description: "Process control data",
    logo: "SCD",
  },
  {
    id: "4",
    name: "PLC Network",
    category: "iot",
    status: "connected",
    lastSync: "Real-time",
    health: 97,
    description: "Programmable logic controllers",
    logo: "PLC",
  },
  {
    id: "5",
    name: "Azure IoT",
    category: "cloud",
    status: "syncing",
    lastSync: "In progress",
    health: 100,
    description: "Cloud IoT hub",
    logo: "AZI",
  },
  {
    id: "6",
    name: "AWS IoT",
    category: "cloud",
    status: "connected",
    lastSync: "1 min ago",
    health: 96,
    description: "AWS cloud integration",
    logo: "AWI",
  },
  {
    id: "7",
    name: "PI System",
    category: "data",
    status: "connected",
    lastSync: "Real-time",
    health: 94,
    description: "OSIsoft PI historian",
    logo: "PIS",
  },
  {
    id: "8",
    name: "InfluxDB",
    category: "data",
    status: "connected",
    lastSync: "30 sec ago",
    health: 100,
    description: "Time-series database",
    logo: "INF",
  },
  {
    id: "9",
    name: "OpenAI",
    category: "ai",
    status: "connected",
    lastSync: "Active",
    health: 100,
    description: "AI language models",
    logo: "OAI",
  },
  {
    id: "10",
    name: "Anthropic",
    category: "ai",
    status: "connected",
    lastSync: "Active",
    health: 100,
    description: "Claude AI integration",
    logo: "ANT",
  },
  {
    id: "11",
    name: "Azure DevOps",
    category: "enterprise",
    status: "disconnected",
    lastSync: "Never",
    health: 0,
    description: "CI/CD pipelines",
    logo: "AZD",
  },
  {
    id: "12",
    name: "Grafana",
    category: "data",
    status: "connected",
    lastSync: "1 min ago",
    health: 92,
    description: "Visualization & monitoring",
    logo: "GRF",
  },
];

function IntegrationCard({ integration }: { integration: Integration }) {
  const statusColors = {
    connected: "bg-emerald-500",
    disconnected: "bg-[#0B0F14]0",
    error: "bg-red-500",
    syncing: "bg-amber-500",
  };

  const statusLabels = {
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error",
    syncing: "Syncing",
  };

  return (
    <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 hover:border-[#3A4354] transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 rounded-lg bg-[#2A3344] flex items-center justify-center">
          <span className="text-sm font-bold text-blue-400">
            {integration.logo}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${statusColors[integration.status]}`}
          />
          <span className="text-xs text-gray-400">
            {statusLabels[integration.status]}
          </span>
        </div>
      </div>

      <h4 className="text-sm font-semibold text-white mb-1">
        {integration.name}
      </h4>
      <p className="text-xs text-gray-400 mb-3">{integration.description}</p>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {integration.lastSync}
        </span>
        <div className="flex items-center gap-1">
          <Gauge className="w-3 h-3 text-emerald-400" />
          <span className="text-emerald-400">{integration.health}%</span>
        </div>
      </div>

      {/* Health bar */}
      <div className="h-1.5 bg-[#2A3344] rounded-full overflow-hidden mb-3">
        <div
          className={`h-full ${
            integration.health >= 90
              ? "bg-emerald-500"
              : integration.health >= 70
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
          style={{ width: `${integration.health}%` }}
        />
      </div>

      <div className="flex gap-2">
        <button className="flex-1 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] rounded text-xs text-gray-300 flex items-center justify-center gap-1">
          <Settings className="w-3 h-3" />
          Configure
        </button>
        {integration.status === "connected" ? (
          <button className="px-3 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] rounded text-gray-300">
            <RefreshCw className="w-3 h-3" />
          </button>
        ) : (
          <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs">
            Connect
          </button>
        )}
      </div>
    </div>
  );
}

export function IntegrationsDashboard() {
  const [filter, setFilter] = useState<"all" | "connected" | "disconnected">(
    "all",
  );
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "data" | "cloud" | "iot" | "enterprise" | "ai"
  >("all");

  const filtered = integrations.filter((i) => {
    if (filter !== "all" && i.status !== filter) return false;
    if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
    return true;
  });

  const stats = {
    total: integrations.length,
    connected: integrations.filter((i) => i.status === "connected").length,
    syncing: integrations.filter((i) => i.status === "syncing").length,
    errors: integrations.filter((i) => i.status === "error").length,
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Plug className="w-8 h-8 text-blue-500" />
            Integrations
          </h1>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2">
            <Plug className="w-4 h-4" />
            Add Integration
          </button>
        </div>
        <p className="text-gray-400">
          Connect and manage external systems and data sources
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-white">{stats.total}</div>
          <div className="text-sm text-gray-400">Total</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-emerald-400">
            {stats.connected}
          </div>
          <div className="text-sm text-gray-400">Connected</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-amber-400">
            {stats.syncing}
          </div>
          <div className="text-sm text-gray-400">Syncing</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-red-400">{stats.errors}</div>
          <div className="text-sm text-gray-400">Errors</div>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {(["all", "data", "cloud", "iot", "enterprise", "ai"] as const).map(
          (cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize whitespace-nowrap ${
                categoryFilter === cat
                  ? "bg-blue-600 text-white"
                  : "bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]"
              }`}
            >
              {cat}
            </button>
          ),
        )}
      </div>

      {/* Status Filter */}
      <div className="flex gap-2 mb-6">
        {(["all", "connected", "disconnected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm capitalize ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Integration Grid */}
      <div className="grid grid-cols-4 gap-4">
        {filtered.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>
    </div>
  );
}

export default IntegrationsDashboard;
