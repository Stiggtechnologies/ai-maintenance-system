/* eslint-disable @typescript-eslint/no-unused-vars */
// SyncAI Command Center Dashboard
// 4-Zone Industrial Command Layout per Design Spec
// =====================================================

import { useState } from "react";
import {
  Factory,
  TrendingUp,
  TrendingDown,
  Users,
  Wrench,
  Bot,
  Zap,
  Activity,
  ChevronRight,
  ChevronDown,
  Search,
  Filter,
  RefreshCw,
} from "lucide-react";

// Types matching the design spec
interface AssetNode {
  id: string;
  name: string;
  type:
    | "enterprise"
    | "site"
    | "area"
    | "system"
    | "asset"
    | "component"
    | "sensor";
  status: "healthy" | "warning" | "critical" | "maintenance";
  children?: AssetNode[];
}

interface AIInsight {
  id: string;
  type: "anomaly" | "prediction" | "recommendation" | "alert";
  severity: "low" | "medium" | "high" | "critical";
  asset: string;
  message: string;
  impact?: number;
  confidence: number;
  timestamp: Date;
}

interface WorkOrder {
  id: string;
  asset: string;
  task: string;
  status:
    | "pending"
    | "scheduled"
    | "in_progress"
    | "blocked"
    | "completed"
    | "closed";
  technician?: string;
  priority: "low" | "medium" | "high" | "critical";
}

interface AgentStatus {
  name: string;
  status: "active" | "idle" | "error";
  tasksExecuted: number;
  lastActivity: Date;
}

// KPI Card Component
function KpiCard({
  label,
  value,
  change,
  trend,
  unit = "",
}: {
  label: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  unit?: string;
}) {
  const trendColor =
    trend === "up"
      ? "text-emerald-400"
      : trend === "down"
        ? "text-red-400"
        : "text-gray-400";
  const trendIcon =
    trend === "up" ? (
      <TrendingUp className="w-3 h-3" />
    ) : trend === "down" ? (
      <TrendingDown className="w-3 h-3" />
    ) : null;

  return (
    <div className="bg-[#1A1F2E] rounded-lg p-4 border border-[#2A3344]">
      <div className="text-xs text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div className="flex items-end gap-2 mt-1">
        <span className="text-2xl font-bold text-white">
          {value}
          {unit}
        </span>
        {change !== undefined && (
          <span className={`flex items-center text-sm ${trendColor}`}>
            {trendIcon}
            <span className="ml-1">{Math.abs(change)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}

// Asset Hierarchy Tree Component
function AssetHierarchyTree({
  assets,
  onSelect,
}: {
  assets: AssetNode[];
  onSelect: (asset: AssetNode) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "bg-emerald-500";
      case "warning":
        return "bg-amber-500";
      case "critical":
        return "bg-red-500";
      case "maintenance":
        return "bg-blue-500";
      default:
        return "bg-[#0B0F14]0";
    }
  };

  const getTypeIcon = (_type: string) => {
    return <Factory className="w-4 h-4 text-gray-400" />;
  };

  const renderNode = (node: AssetNode, depth: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 py-2 px-3 hover:bg-[#1E293B] cursor-pointer rounded`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => onSelect(node)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              className="p-0.5 hover:bg-[#2A3344] rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </button>
          ) : (
            <span className="w-5" />
          )}

          <span
            className={`w-2 h-2 rounded-full ${getStatusColor(node.status)}`}
          />
          {getTypeIcon(node.type)}
          <span className="text-sm text-gray-300 truncate">{node.name}</span>
        </div>

        {hasChildren &&
          isExpanded &&
          node.children!.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="p-2 overflow-auto h-full">
      {assets.map((asset) => renderNode(asset))}
    </div>
  );
}

// AI Decision Panel Component
function AIDecisionPanel({ insights }: { insights: AIInsight[] }) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "border-red-500 bg-red-500/10";
      case "high":
        return "border-orange-500 bg-orange-500/10";
      case "medium":
        return "border-amber-500 bg-amber-500/10";
      case "low":
        return "border-blue-500 bg-blue-500/10";
      default:
        return "border-gray-500";
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Bot className="w-4 h-4 text-blue-400" />
          AI DECISIONS
        </h3>
        <span className="text-xs text-gray-500">Live</span>
      </div>

      <div className="space-y-3">
        {insights.map((insight) => (
          <div
            key={insight.id}
            className={`p-3 rounded-lg border-l-4 ${getSeverityColor(insight.severity)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">
                  {insight.asset}
                </div>
                <div className="text-sm text-white">{insight.message}</div>
                {insight.impact && (
                  <div className="text-xs text-emerald-400 mt-2">
                    Est. Impact: ${(insight.impact / 1000).toFixed(0)}K
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-500">
                    Confidence: {(insight.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded">
                Approve
              </button>
              <button className="px-3 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] text-gray-300 text-xs rounded">
                Modify
              </button>
              <button className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded">
                Execute
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Maintenance Operations Panel
function MaintenanceOperationsPanel({
  workOrders,
}: {
  workOrders: WorkOrder[];
}) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "in_progress":
        return "bg-blue-500";
      case "scheduled":
        return "bg-amber-500";
      case "pending":
        return "bg-[#0B0F14]0";
      case "completed":
        return "bg-emerald-500";
      case "blocked":
        return "bg-red-500";
      default:
        return "bg-[#0B0F14]0";
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-amber-400" />
          ACTIVE WORK ORDERS
        </h3>
        <span className="text-xs text-gray-500">
          {workOrders.length} active
        </span>
      </div>

      <div className="space-y-2">
        {workOrders.map((wo) => (
          <div
            key={wo.id}
            className="p-3 bg-[#1A1F2E] rounded-lg border border-[#2A3344] hover:border-[#3A4354] transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono text-blue-400">{wo.id}</span>
              <span
                className={`w-2 h-2 rounded-full ${getStatusColor(wo.status)}`}
              />
            </div>
            <div className="text-sm text-white mb-1">{wo.task}</div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Factory className="w-3 h-3" />
                {wo.asset}
              </span>
              {wo.technician && (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {wo.technician}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Event Feed Component
function EventFeed({
  events,
}: {
  events: { time: string; message: string; type: string }[];
}) {
  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />
          EVENTS
        </h3>
        <button className="p-1 hover:bg-[#2A3344] rounded">
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="space-y-2">
        {events.map((event, i) => (
          <div
            key={i}
            className="flex gap-3 text-sm py-2 border-b border-[#2A3344] last:border-0"
          >
            <span className="text-gray-500 text-xs whitespace-nowrap">
              {event.time}
            </span>
            <span className="text-gray-300">{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// AI Agent Status Panel
function AgentStatusPanel({ agents }: { agents: AgentStatus[] }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-emerald-500";
      case "idle":
        return "bg-[#0B0F14]0";
      case "error":
        return "bg-red-500";
      default:
        return "bg-[#0B0F14]0";
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Bot className="w-4 h-4 text-cyan-400" />
          AI AGENTS
        </h3>
        <span className="text-xs text-gray-500">
          {agents.filter((a) => a.status === "active").length} active
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {agents.map((agent) => (
          <div
            key={agent.name}
            className="p-2 bg-[#1A1F2E] rounded border border-[#2A3344]"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`}
              />
              <span className="text-xs text-white truncate">{agent.name}</span>
            </div>
            <div className="text-xs text-gray-500">
              {agent.tasksExecuted} tasks
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Autonomy Status Indicator
function AutonomyIndicator({
  mode,
}: {
  mode: "human-directed" | "human-in-loop" | "autonomous";
}) {
  const colors = {
    "human-directed": "bg-blue-500",
    "human-in-loop": "bg-amber-500",
    autonomous: "bg-emerald-500",
  };

  const labels = {
    "human-directed": "HUMAN CONTROL",
    "human-in-loop": "HUMAN IN LOOP",
    autonomous: "AUTONOMOUS",
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1F2E] rounded-full border border-[#2A3344]">
      <Zap className="w-4 h-4 text-amber-400" />
      <span className={`w-2 h-2 rounded-full ${colors[mode]}`} />
      <span className="text-xs text-gray-300">{labels[mode]}</span>
    </div>
  );
}

// Financial Impact Widget
function FinancialImpactWidget({
  savings,
  interventions,
}: {
  savings: number;
  interventions: number;
}) {
  return (
    <div className="p-3 bg-[#1A1F2E] rounded-lg border border-[#2A3344]">
      <div className="text-xs text-gray-400 uppercase mb-2">
        FINANCIAL IMPACT
      </div>
      <div className="flex items-center gap-6">
        <div>
          <div className="text-xl font-bold text-emerald-400">
            ${(savings / 1000000).toFixed(1)}M
          </div>
          <div className="text-xs text-gray-500">Downtime Avoided</div>
        </div>
        <div>
          <div className="text-xl font-bold text-blue-400">{interventions}</div>
          <div className="text-xs text-gray-500">AI Interventions</div>
        </div>
      </div>
    </div>
  );
}

// Main Command Center Dashboard
export function CommandCenterDashboard() {
  // Sample data - in production this comes from Supabase
  const kpis = [
    {
      label: "Asset Availability",
      value: "94.2",
      change: 2.1,
      trend: "up" as const,
    },
    {
      label: "MTBF",
      value: "132",
      change: 8,
      trend: "up" as const,
      unit: "hrs",
    },
    { label: "Backlog", value: "218", change: -12, trend: "down" as const },
    {
      label: "OEE",
      value: "87.3",
      change: 1.5,
      trend: "up" as const,
      unit: "%",
    },
    {
      label: "MTTR",
      value: "4.2",
      change: -0.5,
      trend: "down" as const,
      unit: "hrs",
    },
    { label: "AI Actions", value: "17", change: 5, trend: "up" as const },
  ];

  const assetHierarchy: AssetNode[] = [
    {
      id: "ent-1",
      name: "SyncAI Operations",
      type: "enterprise",
      status: "healthy",
      children: [
        {
          id: "site-1",
          name: "Alberta Oil Sands",
          type: "site",
          status: "healthy",
          children: [
            {
              id: "area-1",
              name: "Primary Extraction",
              type: "area",
              status: "warning",
              children: [
                {
                  id: "sys-1",
                  name: "Haul Truck Fleet",
                  type: "system",
                  status: "healthy",
                  children: [
                    {
                      id: "asset-1",
                      name: "Haul Truck #12",
                      type: "asset",
                      status: "healthy",
                    },
                    {
                      id: "asset-2",
                      name: "Haul Truck #23",
                      type: "asset",
                      status: "critical",
                    },
                  ],
                },
              ],
            },
            {
              id: "area-2",
              name: "Processing Plant",
              type: "area",
              status: "healthy",
              children: [
                {
                  id: "sys-2",
                  name: "Pump Station",
                  type: "system",
                  status: "warning",
                  children: [
                    {
                      id: "asset-3",
                      name: "Pump P-145",
                      type: "asset",
                      status: "warning",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  const insights: AIInsight[] = [
    {
      id: "1",
      type: "prediction",
      severity: "critical",
      asset: "Pump P-145",
      message:
        "Failure probability: 82%. Recommend bearing replacement at next shutdown.",
      impact: 420000,
      confidence: 0.87,
      timestamp: new Date(),
    },
    {
      id: "2",
      type: "anomaly",
      severity: "high",
      asset: "Haul Truck #23",
      message:
        "Vibration anomaly detected in engine component. Schedule inspection.",
      impact: 85000,
      confidence: 0.72,
      timestamp: new Date(),
    },
    {
      id: "3",
      type: "recommendation",
      severity: "medium",
      asset: "Conveyor C-22",
      message:
        "Belt wear at 78%. Schedule replacement during next planned outage.",
      impact: 35000,
      confidence: 0.91,
      timestamp: new Date(),
    },
  ];

  const workOrders: WorkOrder[] = [
    {
      id: "WO-20431",
      asset: "Truck #45",
      task: "Hydraulic Pump Replacement",
      status: "in_progress",
      technician: "Alex M.",
      priority: "critical",
    },
    {
      id: "WO-20430",
      asset: "Conveyor C-22",
      task: "Belt Inspection",
      status: "scheduled",
      priority: "high",
    },
    {
      id: "WO-20429",
      asset: "Pump P-145",
      task: "Bearing Check",
      status: "pending",
      priority: "medium",
    },
  ];

  const events = [
    { time: "10:58", message: "Maintenance task started", type: "action" },
    {
      time: "10:42",
      message: "Technician assigned - Alex M.",
      type: "assignment",
    },
    { time: "10:35", message: "AI created work order WO-20431", type: "ai" },
    {
      time: "10:32",
      message: "Vibration anomaly detected - Pump P-145",
      type: "alert",
    },
  ];

  const agents: AgentStatus[] = [
    {
      name: "Reliability Agent",
      status: "active",
      tasksExecuted: 23,
      lastActivity: new Date(),
    },
    {
      name: "Condition Monitor",
      status: "active",
      tasksExecuted: 156,
      lastActivity: new Date(),
    },
    {
      name: "Planning Agent",
      status: "active",
      tasksExecuted: 12,
      lastActivity: new Date(),
    },
    {
      name: "Inventory Agent",
      status: "idle",
      tasksExecuted: 8,
      lastActivity: new Date(),
    },
    {
      name: "Compliance Agent",
      status: "active",
      tasksExecuted: 5,
      lastActivity: new Date(),
    },
    {
      name: "Safety Agent",
      status: "active",
      tasksExecuted: 31,
      lastActivity: new Date(),
    },
  ];

  return (
    <div className="min-h-screen bg-[#0D1117] text-white">
      {/* Global KPI Bar */}
      <div className="border-b border-[#232A33] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Factory className="w-6 h-6 text-blue-500" />
              SyncAI Command Center
            </h1>
            <AutonomyIndicator mode="human-in-loop" />
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search assets, work orders, ask SyncAI..."
                className="bg-[#1A1F2E] border border-[#2A3344] rounded-lg pl-10 pr-4 py-2 text-sm w-80 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-6 gap-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </div>
      </div>

      {/* 4-Zone Layout */}
      <div
        className="grid grid-cols-12 gap-4 p-4"
        style={{ minHeight: "calc(100vh - 200px)" }}
      >
        {/* Zone 1: Asset Health Map (Left, 4 cols) */}
        <div className="col-span-4 bg-[#11161D] rounded-lg border border-[#232A33] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              ASSET HEALTH MAP
            </h3>
            <button className="p-1 hover:bg-[#2A3344] rounded">
              <Filter className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <AssetHierarchyTree
            assets={assetHierarchy}
            onSelect={(a) => console.log("Selected:", a)}
          />
        </div>

        {/* Zone 2: AI Decision Panel (Right, 4 cols) */}
        <div className="col-span-4 bg-[#11161D] rounded-lg border border-[#232A33] p-4">
          <AIDecisionPanel insights={insights} />
        </div>

        {/* Zone 3: Maintenance Operations (Left-Bottom, 4 cols) */}
        <div className="col-span-4 bg-[#11161D] rounded-lg border border-[#232A33] p-4">
          <MaintenanceOperationsPanel workOrders={workOrders} />
        </div>

        {/* Row 2 */}

        {/* Zone 4: Event Feed (Left, 4 cols) */}
        <div className="col-span-4 bg-[#11161D] rounded-lg border border-[#232A33] p-4">
          <EventFeed events={events} />
        </div>

        {/* Agent Status Panel (Middle, 4 cols) */}
        <div className="col-span-4 bg-[#11161D] rounded-lg border border-[#232A33] p-4">
          <AgentStatusPanel agents={agents} />
        </div>

        {/* Financial Impact (Right, 4 cols) */}
        <div className="col-span-4 bg-[#11161D] rounded-lg border border-[#232A33] p-4 flex flex-col justify-between">
          <FinancialImpactWidget savings={1200000} interventions={17} />
          <div className="mt-4">
            <div className="p-3 bg-[#1A1F2E] rounded-lg border border-[#2A3344]">
              <div className="text-xs text-gray-400 uppercase mb-2">
                System Health
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#2A3344] rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full"
                    style={{ width: "94%" }}
                  />
                </div>
                <span className="text-sm text-emerald-400">94%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CommandCenterDashboard;
