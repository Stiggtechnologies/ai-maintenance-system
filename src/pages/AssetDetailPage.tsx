/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Activity,
  Wrench,
  AlertTriangle,
  Shield,
  TrendingUp,
  TrendingDown,
  Clock,
  MapPin,
  Tag,
  Calendar,
  DollarSign,
} from "lucide-react";
import { supabase } from "../lib/supabase";

export function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<any>(null);
  const [healthHistory, setHealthHistory] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [criticality, setCriticality] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "overview" | "health" | "work" | "criticality"
  >("overview");

  useEffect(() => {
    if (assetId) loadAssetData(assetId);
  }, [assetId]);

  const loadAssetData = async (id: string) => {
    try {
      const [assetRes, healthRes, woRes, critRes] = await Promise.all([
        supabase
          .from("assets")
          .select(`*, asset_classes(name), asset_locations(name), sites(name)`)
          .eq("id", id)
          .single(),
        supabase
          .from("asset_health_monitoring")
          .select("*")
          .eq("asset_id", id)
          .order("recorded_at", { ascending: false })
          .limit(50),
        supabase
          .from("work_orders")
          .select("*")
          .eq("asset_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("asset_criticality_profiles")
          .select("*")
          .eq("asset_id", id)
          .maybeSingle(),
      ]);

      if (assetRes.data) setAsset(assetRes.data);
      if (healthRes.data) setHealthHistory(healthRes.data);
      if (woRes.data) setWorkOrders(woRes.data);
      if (critRes.data) setCriticality(critRes.data);
    } catch (error) {
      console.error("Error loading asset:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading asset details...</div>
      </div>
    );
  if (!asset)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Asset not found</div>
      </div>
    );

  const statusColors: Record<string, string> = {
    operational:
      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    degraded: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    failed: "bg-red-500/10 text-red-400 border border-red-500/20",
    maintenance: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
    decommissioned: "bg-[#1A2030] text-slate-400",
  };

  const priorityColors: Record<string, string> = {
    critical: "text-red-400",
    high: "text-orange-600",
    medium: "text-teal-400",
    low: "text-slate-400",
  };

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    {
      id: "health" as const,
      label: "Health History",
      count: healthHistory.length,
    },
    { id: "work" as const, label: "Work Orders", count: workOrders.length },
    { id: "criticality" as const, label: "Criticality" },
  ];

  const latestHealth = healthHistory[0];

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => navigate("/assets")}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-300 mb-3"
        >
          <ArrowLeft size={16} /> Back to Assets
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#E6EDF3]">{asset.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
              {asset.asset_tag && (
                <span className="flex items-center gap-1">
                  <Tag size={14} /> {asset.asset_tag}
                </span>
              )}
              {asset.asset_classes?.name && (
                <span>{asset.asset_classes.name}</span>
              )}
              {asset.asset_locations?.name && (
                <span className="flex items-center gap-1">
                  <MapPin size={14} /> {asset.asset_locations.name}
                </span>
              )}
              {asset.sites?.name && <span>{asset.sites.name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {latestHealth && (
              <div
                className={`px-3 py-1 rounded-lg text-sm font-medium ${latestHealth.health_score >= 80 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : latestHealth.health_score >= 60 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}
              >
                Health: {latestHealth.health_score}%
              </div>
            )}
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[asset.status] || "bg-[#1A2030] text-slate-400"}`}
            >
              {asset.status?.replace("_", " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#232A33]">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-teal-500 text-teal-400" : "border-transparent text-slate-500 hover:text-slate-300"}`}
            >
              {tab.label}{" "}
              {tab.count !== undefined && (
                <span className="ml-1 text-xs bg-[#1A2030] text-slate-400 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Asset Info */}
          <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
              Asset Information
            </h2>
            <dl className="space-y-3">
              {[
                ["Manufacturer", asset.manufacturer],
                ["Model", asset.model],
                ["Serial Number", asset.serial_number],
                [
                  "Install Date",
                  asset.install_date
                    ? new Date(asset.install_date).toLocaleDateString()
                    : null,
                ],
                ["Lifecycle State", asset.lifecycle_state],
                [
                  "Criticality Level",
                  asset.criticality_level || asset.criticality,
                ],
                [
                  "Replacement Value",
                  asset.replacement_value
                    ? `$${Number(asset.replacement_value).toLocaleString()}`
                    : null,
                ],
              ]
                .filter(([, val]) => val)
                .map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between">
                    <dt className="text-sm text-slate-500">{label}</dt>
                    <dd className="text-sm font-medium text-[#E6EDF3]">
                      {value}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>

          {/* Quick Stats */}
          <div className="space-y-4">
            {latestHealth && (
              <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-500 mb-2">
                  Latest Health Assessment
                </h3>
                <div className="text-3xl font-bold text-[#E6EDF3]">
                  {latestHealth.health_score}%
                </div>
                <div className="text-sm text-slate-500 mt-1">
                  {new Date(
                    latestHealth.recorded_at || latestHealth.created_at,
                  ).toLocaleString()}
                </div>
                {latestHealth.anomaly_detected && (
                  <div className="mt-2 flex items-center gap-1 text-sm text-red-400">
                    <AlertTriangle size={14} /> Anomaly Detected
                  </div>
                )}
                {latestHealth.ai_analysis && (
                  <p className="mt-2 text-sm text-slate-400">
                    {typeof latestHealth.ai_analysis === "string"
                      ? latestHealth.ai_analysis.slice(0, 200)
                      : JSON.stringify(latestHealth.ai_analysis).slice(0, 200)}
                    ...
                  </p>
                )}
              </div>
            )}
            <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
              <h3 className="text-sm font-medium text-slate-500 mb-2">
                Work Order Summary
              </h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-[#E6EDF3]">
                    {
                      workOrders.filter(
                        (w) =>
                          w.status === "pending" || w.status === "in_progress",
                      ).length
                    }
                  </div>
                  <div className="text-xs text-slate-500">Open</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-[#E6EDF3]">
                    {workOrders.filter((w) => w.status === "completed").length}
                  </div>
                  <div className="text-xs text-slate-500">Completed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-[#E6EDF3]">
                    {workOrders.length}
                  </div>
                  <div className="text-xs text-slate-500">Total</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "health" && (
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
            Health History
          </h2>
          {healthHistory.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              No health readings recorded
            </p>
          ) : (
            <div className="space-y-3">
              {healthHistory.map((h, i) => (
                <div
                  key={h.id || i}
                  className="flex items-center justify-between p-3 bg-[#0B0F14] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${h.health_score >= 80 ? "bg-emerald-500/10 text-emerald-400" : h.health_score >= 60 ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"}`}
                    >
                      {h.health_score}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {new Date(
                          h.recorded_at || h.created_at,
                        ).toLocaleString()}
                      </div>
                      {h.anomaly_detected && (
                        <span className="text-xs text-red-400">
                          Anomaly detected
                        </span>
                      )}
                    </div>
                  </div>
                  {h.recommendations && (
                    <div className="text-xs text-slate-500 max-w-xs truncate">
                      {typeof h.recommendations === "string"
                        ? h.recommendations
                        : JSON.stringify(h.recommendations)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "work" && (
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
            Work Orders
          </h2>
          {workOrders.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              No work orders for this asset
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-[#232A33]">
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Priority</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((wo) => (
                  <tr
                    key={wo.id}
                    className="border-b border-[#1A2030] hover:bg-[#0B0F14] cursor-pointer"
                    onClick={() => navigate(`/work/${wo.id}`)}
                  >
                    <td className="py-3 text-sm font-medium text-[#E6EDF3]">
                      {wo.title}
                    </td>
                    <td
                      className={`py-3 text-sm font-medium ${priorityColors[wo.priority] || "text-slate-400"}`}
                    >
                      {wo.priority}
                    </td>
                    <td className="py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${wo.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : wo.status === "in_progress" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-teal-500/10 text-teal-400 border border-teal-500/20"}`}
                      >
                        {wo.status?.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-3 text-sm text-slate-500">
                      {new Date(wo.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "criticality" && (
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
            Criticality Assessment
          </h2>
          {!criticality ? (
            <p className="text-slate-500 text-center py-8">
              No criticality assessment available
            </p>
          ) : (
            <div>
              <div className="flex items-center gap-4 mb-6">
                <div className="text-4xl font-bold text-[#E6EDF3]">
                  {criticality.total_criticality_score?.toFixed(1)}
                </div>
                <div>
                  <div className="text-sm font-medium text-[#E6EDF3]">
                    Total Criticality Score
                  </div>
                  <div
                    className={`text-sm font-medium ${criticality.criticality_band === "A" ? "text-red-400" : criticality.criticality_band === "B" ? "text-orange-600" : criticality.criticality_band === "C" ? "text-yellow-600" : "text-green-600"}`}
                  >
                    Band {criticality.criticality_band}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  ["Safety", criticality.safety_score, Shield],
                  [
                    "Environmental",
                    criticality.environmental_score,
                    AlertTriangle,
                  ],
                  ["Production", criticality.production_score, Activity],
                  ["Quality", criticality.quality_score, TrendingUp],
                  ["Cost", criticality.cost_score, DollarSign],
                  ["Regulatory", criticality.regulatory_score, Shield],
                  ["Reputation", criticality.reputation_score, TrendingDown],
                ]
                  .filter(([, val]) => val != null)
                  .map(([label, score, Icon]: any) => (
                    <div key={label} className="bg-[#0B0F14] rounded-lg p-4">
                      <Icon size={16} className="text-slate-400 mb-1" />
                      <div className="text-sm text-slate-500">{label}</div>
                      <div className="text-xl font-bold text-[#E6EDF3]">
                        {score}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
