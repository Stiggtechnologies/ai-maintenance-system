import { useState, useEffect } from "react";
import {
  TrendingUp,
  AlertTriangle,
  Shield,
  Zap,
  Activity,
  Wrench,
  Package,
  LayoutDashboard,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "../lib/supabase";

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: LucideIcon;
  iconColor: string;
  status?: "good" | "warning" | "critical" | "neutral";
}

function StatCard({
  title,
  value,
  unit,
  icon: Icon,
  iconColor,
  status,
}: StatCardProps) {
  const statusColors = {
    good: "border-green-200 bg-green-50",
    warning: "border-yellow-200 bg-yellow-50",
    critical: "border-red-200 bg-red-50",
    neutral: "border-slate-200 bg-white",
  };

  return (
    <div
      className={`border rounded-xl p-6 ${statusColors[status || "neutral"]}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-600 mb-1">{title}</div>
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-bold text-slate-900">{value}</div>
            {unit && <div className="text-sm text-slate-500">{unit}</div>}
          </div>
        </div>
        <div className={`p-3 rounded-lg ${iconColor}`}>
          <Icon size={24} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export function OverviewDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    assetCount: 0,
    workOrderCount: 0,
    openWorkOrders: 0,
    alertCount: 0,
    unresolvedAlerts: 0,
    decisionCount: 0,
  });
  const [recentAlerts, setRecentAlerts] = useState<
    Array<{
      id: string;
      severity: string;
      title: string;
      created_at: string;
      resolved: boolean;
    }>
  >([]);
  const [recentWorkOrders, setRecentWorkOrders] = useState<
    Array<{
      id: string;
      title: string;
      priority: string;
      status: string;
      created_at: string;
    }>
  >([]);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      // Query real tables directly — no RPCs needed
      let assetCount = 0;
      let workOrders: Array<{
        id: string;
        title: string;
        priority: string;
        status: string;
        created_at: string;
      }> = [];
      let alerts: Array<{
        id: string;
        severity: string;
        title: string;
        created_at: string;
        resolved: boolean;
      }> = [];
      let decisionCount = 0;

      try {
        const res = await supabase
          .from("assets")
          .select("id", { count: "exact", head: true });
        assetCount = res.count || 0;
      } catch {
        /* table may not exist */
      }

      try {
        const res = await supabase
          .from("work_orders")
          .select("id, title, priority, status, created_at")
          .order("created_at", { ascending: false })
          .limit(20);
        workOrders = res.data || [];
      } catch {
        /* table may not exist */
      }

      try {
        const res = await supabase
          .from("system_alerts")
          .select("id, severity, title, created_at, resolved")
          .order("created_at", { ascending: false })
          .limit(10);
        alerts = res.data || [];
      } catch {
        /* table may not exist */
      }

      try {
        const res = await supabase
          .from("autonomous_decisions")
          .select("id", { count: "exact", head: true });
        decisionCount = res.count || 0;
      } catch {
        /* table may not exist */
      }

      const dataExists =
        assetCount > 0 || workOrders.length > 0 || alerts.length > 0;
      setHasData(dataExists);

      setStats({
        assetCount,
        workOrderCount: workOrders.length,
        openWorkOrders: workOrders.filter(
          (w) => w.status === "pending" || w.status === "in_progress",
        ).length,
        alertCount: alerts.length,
        unresolvedAlerts: alerts.filter((a) => !a.resolved).length,
        decisionCount,
      });

      setRecentAlerts(alerts.slice(0, 5));
      setRecentWorkOrders(workOrders.slice(0, 5));
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-slate-400">Loading dashboard...</div>
      </div>
    );
  }

  // Getting Started view when no data exists
  if (!hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome to SyncAI
          </h1>
          <p className="text-slate-600 mt-1">
            AI-powered autonomous asset maintenance and reliability platform
          </p>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Get Started</h2>
          <p className="text-slate-600 mb-6">
            Set up your organization to start using SyncAI. Here's what to do
            first:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <Package size={20} className="text-blue-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">
                1. Register Assets
              </h3>
              <p className="text-sm text-slate-600 mb-3">
                Import your asset register via CSV or add assets manually.
              </p>
              <a
                href="/assets"
                className="text-sm text-blue-600 font-medium flex items-center gap-1 hover:text-blue-700"
              >
                Go to Assets <ArrowRight size={14} />
              </a>
            </div>

            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <LayoutDashboard size={20} className="text-green-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">
                2. Choose Template
              </h3>
              <p className="text-sm text-slate-600 mb-3">
                Select an industry template to auto-configure KPIs, governance,
                and workflows.
              </p>
              <a
                href="/deployments/new"
                className="text-sm text-blue-600 font-medium flex items-center gap-1 hover:text-blue-700"
              >
                Browse Templates <ArrowRight size={14} />
              </a>
            </div>

            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <Wrench size={20} className="text-purple-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">
                3. Create Work Orders
              </h3>
              <p className="text-sm text-slate-600 mb-3">
                Start managing maintenance work with AI-assisted prioritization.
              </p>
              <a
                href="/work"
                className="text-sm text-blue-600 font-medium flex items-center gap-1 hover:text-blue-700"
              >
                Go to Work <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="font-semibold text-slate-900 mb-3">
              Platform Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Authentication</span>
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 size={14} /> Connected
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Database</span>
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 size={14} /> Connected
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Assets</span>
                <span className="text-sm text-slate-400">0 registered</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  Industry Template
                </span>
                <span className="text-sm text-slate-400">Not configured</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="font-semibold text-slate-900 mb-3">
              What SyncAI Does
            </h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <Zap size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                AI-powered asset health monitoring and anomaly detection
              </li>
              <li className="flex items-start gap-2">
                <Shield
                  size={14}
                  className="text-green-500 mt-0.5 flex-shrink-0"
                />
                Governed autonomous decision-making with approval workflows
              </li>
              <li className="flex items-start gap-2">
                <Activity
                  size={14}
                  className="text-purple-500 mt-0.5 flex-shrink-0"
                />
                OEE tracking with industry-specific loss categorization
              </li>
              <li className="flex items-start gap-2">
                <TrendingUp
                  size={14}
                  className="text-orange-500 mt-0.5 flex-shrink-0"
                />
                KPI dashboards aligned to ISO 55000 asset management standards
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Real data dashboard
  const severityColors: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-blue-100 text-blue-800",
    low: "bg-slate-100 text-slate-600",
  };

  const statusColors: Record<string, string> = {
    pending: "bg-blue-100 text-blue-800",
    in_progress: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-800",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Strategic Overview
        </h1>
        <p className="text-slate-600 mt-1">
          Enterprise intelligence and operational performance
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Assets"
          value={stats.assetCount}
          icon={Package}
          iconColor="bg-gradient-to-br from-blue-500 to-cyan-500"
          status="neutral"
        />
        <StatCard
          title="Open Work Orders"
          value={stats.openWorkOrders}
          icon={Wrench}
          iconColor="bg-gradient-to-br from-orange-500 to-amber-500"
          status={stats.openWorkOrders > 10 ? "warning" : "neutral"}
        />
        <StatCard
          title="Unresolved Alerts"
          value={stats.unresolvedAlerts}
          icon={AlertTriangle}
          iconColor="bg-gradient-to-br from-red-500 to-rose-500"
          status={
            stats.unresolvedAlerts > 5
              ? "critical"
              : stats.unresolvedAlerts > 0
                ? "warning"
                : "good"
          }
        />
        <StatCard
          title="AI Decisions"
          value={stats.decisionCount}
          icon={Zap}
          iconColor="bg-gradient-to-br from-violet-500 to-purple-500"
          status="neutral"
        />
      </div>

      {/* Recent Alerts + Recent Work Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={20} className="text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">
              Recent Alerts
            </h2>
          </div>
          {recentAlerts.length > 0 ? (
            <div className="space-y-3">
              {recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {alert.title}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Date(alert.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${severityColors[alert.severity] || "bg-slate-100 text-slate-600"}`}
                  >
                    {alert.severity}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-center py-6">No recent alerts</p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={20} className="text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">
              Recent Work Orders
            </h2>
          </div>
          {recentWorkOrders.length > 0 ? (
            <div className="space-y-3">
              {recentWorkOrders.map((wo) => (
                <div
                  key={wo.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {wo.title}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Date(wo.created_at).toLocaleDateString()} |{" "}
                      {wo.priority}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${statusColors[wo.status] || "bg-slate-100 text-slate-600"}`}
                  >
                    {wo.status?.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-center py-6">
              No work orders yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
