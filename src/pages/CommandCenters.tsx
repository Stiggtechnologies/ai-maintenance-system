import { useState } from "react";
import {
  Users,
  Factory,
  MapPin,
  TriangleAlert as AlertTriangle,
  CircleCheck as CheckCircle,
  Activity,
  ChevronRight,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getAssets,
  getWorkOrders,
  getRecommendations,
} from "../services/operatingLoopService";
import type { AssetRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

/* -------------------------------------------------------------------------- */
/* Page-local queries                                                         */
/* -------------------------------------------------------------------------- */

interface SiteRow {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
}

interface SensorRow {
  id: string;
  asset_id: string;
  name: string;
  status: string | null;
  last_value: number | null;
  threshold: number | null;
  unit: string | null;
}

interface SystemAlertRow {
  id: string;
  severity: string | null;
  title: string | null;
  description: string | null;
}

async function getSites(): Promise<SiteRow[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id,name,code,location")
    .order("name")
    .returns<SiteRow[]>();
  if (error) throw new Error(`Could not load sites: ${error.message}`);
  return data ?? [];
}

async function getSensors(): Promise<SensorRow[]> {
  const { data, error } = await supabase
    .from("sensors")
    .select("id,asset_id,name,status,last_value,threshold,unit")
    .returns<SensorRow[]>();
  if (error) throw new Error(`Could not load sensors: ${error.message}`);
  return data ?? [];
}

async function getOpenSystemAlerts(): Promise<SystemAlertRow[]> {
  const { data, error } = await supabase
    .from("system_alerts")
    .select("id,severity,title,description")
    .eq("resolved", false)
    .returns<SystemAlertRow[]>();
  if (error) throw new Error(`Could not load system alerts: ${error.message}`);
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Rollup model — every number aggregated from queried rows                   */
/* -------------------------------------------------------------------------- */

type AlertLevel = "critical" | "action" | "advisory";

interface RollupAlert {
  text: string;
  level: AlertLevel;
}

interface RollupRec {
  title: string;
  action: string | null;
  urgency: string;
}

interface SiteRollup {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  color: string;
  assetCount: number;
  avgHealth: number | null;
  criticalAssets: number;
  highRiskAssets: number;
  openWOs: number;
  activeAlarms: number;
  warningSensors: number;
  pendingRecs: number;
  alerts: RollupAlert[];
  assets: AssetRow[];
  recommendations: RollupRec[];
}

interface CommandCenterData {
  rollups: SiteRollup[];
  orgAlerts: SystemAlertRow[];
}

const CLOSED_WO_STATUSES = new Set(["completed", "closed", "cancelled"]);

async function loadCommandCenters(): Promise<CommandCenterData> {
  const [sites, assets, workOrders, recs, sensors, orgAlerts] =
    await Promise.all([
      getSites(),
      getAssets(),
      getWorkOrders(),
      getRecommendations(),
      getSensors(),
      getOpenSystemAlerts(),
    ]);

  const buildRollup = (
    id: string,
    name: string,
    code: string | null,
    location: string | null,
    siteAssets: AssetRow[],
  ): SiteRollup => {
    const assetIds = new Set(siteAssets.map((a) => a.id));
    const assetById = new Map(siteAssets.map((a) => [a.id, a]));
    const siteSensors = sensors.filter((s) => assetIds.has(s.asset_id));
    const alarms = siteSensors.filter((s) => s.status === "alarm");
    const warnings = siteSensors.filter((s) => s.status === "warning");
    const openWOs = workOrders.filter(
      (w) =>
        w.asset_id != null &&
        assetIds.has(w.asset_id) &&
        !CLOSED_WO_STATUSES.has(w.status),
    );
    const pendingRecs = recs.filter(
      (r) =>
        r.asset_id != null &&
        assetIds.has(r.asset_id) &&
        (r.status === "pending" || r.status === "escalated"),
    );
    const highRisk = siteAssets.filter((a) => a.risk_score >= 70);
    const avgHealth = siteAssets.length
      ? Math.round(
          siteAssets.reduce((s, a) => s + a.health_score, 0) /
            siteAssets.length,
        )
      : null;

    const alerts: RollupAlert[] = [
      ...alarms.map((s) => {
        const asset = assetById.get(s.asset_id);
        const reading =
          s.last_value != null && s.threshold != null
            ? ` — ${s.last_value}${s.unit ? ` ${s.unit}` : ""} vs ${s.threshold} threshold`
            : "";
        return {
          text: `${s.name}${asset ? ` on ${asset.name}` : ""} in alarm${reading}`,
          level: "critical" as const,
        };
      }),
      ...warnings.map((s) => {
        const asset = assetById.get(s.asset_id);
        const reading =
          s.last_value != null && s.threshold != null
            ? ` — ${s.last_value}${s.unit ? ` ${s.unit}` : ""} vs ${s.threshold} threshold`
            : "";
        return {
          text: `${s.name}${asset ? ` on ${asset.name}` : ""} in warning${reading}`,
          level: "action" as const,
        };
      }),
      ...highRisk.map((a) => ({
        text: `${a.name} at elevated risk — risk score ${a.risk_score}, health ${a.health_score}%`,
        level: (a.risk_score >= 80 ? "critical" : "action") as AlertLevel,
      })),
    ];

    return {
      id,
      name,
      code,
      location,
      color:
        alarms.length > 0 || highRisk.length > 0
          ? "amber"
          : (avgHealth ?? 100) >= 85
            ? "teal"
            : "blue",
      assetCount: siteAssets.length,
      avgHealth,
      criticalAssets: siteAssets.filter((a) => a.criticality === "critical")
        .length,
      highRiskAssets: highRisk.length,
      openWOs: openWOs.length,
      activeAlarms: alarms.length,
      warningSensors: warnings.length,
      pendingRecs: pendingRecs.length,
      alerts,
      assets: [...siteAssets].sort((a, b) => b.risk_score - a.risk_score),
      recommendations: pendingRecs.map((r) => ({
        title: r.title,
        action: r.action,
        urgency: r.urgency,
      })),
    };
  };

  const rollups = sites.map((site) =>
    buildRollup(
      site.id,
      site.name,
      site.code,
      site.location,
      assets.filter((a) => a.site_id === site.id),
    ),
  );

  // Assets not linked to any site still deserve an honest rollup card.
  const unassigned = assets.filter(
    (a) => a.site_id == null || !sites.some((s) => s.id === a.site_id),
  );
  if (unassigned.length > 0) {
    rollups.push(
      buildRollup(
        "unassigned",
        "Unassigned Assets",
        null,
        "Not linked to a site",
        unassigned,
      ),
    );
  }

  return { rollups, orgAlerts };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

const colorMap: Record<
  string,
  { card: string; badge: string; text: string; icon: string }
> = {
  teal: {
    card: "border-teal-500/20 hover:border-teal-500/40",
    badge: "bg-teal-500/10 text-teal-400",
    text: "text-teal-400",
    icon: "bg-teal-500/10",
  },
  blue: {
    card: "border-blue-500/20 hover:border-blue-500/40",
    badge: "bg-blue-500/10 text-blue-400",
    text: "text-blue-400",
    icon: "bg-blue-500/10",
  },
  amber: {
    card: "border-amber-500/20 hover:border-amber-500/40",
    badge: "bg-amber-500/10 text-amber-400",
    text: "text-amber-400",
    icon: "bg-amber-500/10",
  },
  green: {
    card: "border-green-500/20 hover:border-green-500/40",
    badge: "bg-green-500/10 text-green-400",
    text: "text-green-400",
    icon: "bg-green-500/10",
  },
};

const alertColors: Record<AlertLevel, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  action: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  advisory: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

const healthColor = (h: number) =>
  h >= 85 ? "text-teal-400" : h >= 70 ? "text-amber-400" : "text-red-400";

function rollupKpis(site: SiteRollup) {
  return [
    { label: "Assets", value: `${site.assetCount}` },
    {
      label: "Avg Health",
      value: site.avgHealth != null ? `${site.avgHealth}%` : "—",
    },
    { label: "Critical Assets", value: `${site.criticalAssets}` },
    { label: "Open Work Orders", value: `${site.openWOs}` },
    { label: "Active Alarms", value: `${site.activeAlarms}` },
    { label: "Pending Recs", value: `${site.pendingRecs}` },
  ];
}

function SiteCard({
  site,
  onOpen,
}: {
  site: SiteRollup;
  onOpen: (id: string) => void;
}) {
  const c = colorMap[site.color];
  const criticalAlert = site.alerts.find((a) => a.level === "critical");

  return (
    <motion.div
      className={`bg-[#0D1520] border ${c.card} rounded-2xl p-5 cursor-pointer transition-all group`}
      whileHover={{ y: -2 }}
      onClick={() => onOpen(site.id)}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-10 h-10 rounded-xl ${c.icon} flex items-center justify-center flex-shrink-0`}
        >
          <Factory className={`w-5 h-5 ${c.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 leading-tight">
              {site.name}
            </h3>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors" />
          </div>
          <div
            className={`text-xs font-semibold mt-0.5 flex items-center gap-1 ${c.text}`}
          >
            <MapPin className="w-3 h-3" />
            {[site.code, site.location].filter(Boolean).join(" — ") ||
              "No location on record"}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
        {site.assetCount} asset{site.assetCount === 1 ? "" : "s"} monitored —{" "}
        {site.criticalAssets} critical-criticality, {site.openWOs} open work
        order{site.openWOs === 1 ? "" : "s"}, {site.activeAlarms} active alarm
        {site.activeAlarms === 1 ? "" : "s"}.
      </p>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {rollupKpis(site)
          .slice(0, 4)
          .map((kpi) => (
            <div key={kpi.label} className="bg-white/[0.02] rounded-lg p-2">
              <div className="text-xs text-slate-400 truncate">{kpi.label}</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">
                {kpi.value}
              </div>
            </div>
          ))}
      </div>

      {/* Critical Alert */}
      {criticalAlert && (
        <div
          className={`text-xs px-2.5 py-2 rounded-lg border ${alertColors[criticalAlert.level]} mb-3`}
        >
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          {criticalAlert.text}
        </div>
      )}

      {/* Top pending recommendations */}
      {site.recommendations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {site.recommendations.slice(0, 2).map((rec) => (
            <span
              key={rec.title}
              className="text-xs px-2 py-1 bg-white/[0.03] border border-white/[0.06] rounded-full text-slate-400 truncate max-w-full"
            >
              {rec.title}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function SiteDetail({
  site,
  orgAlerts,
  onBack,
}: {
  site: SiteRollup;
  orgAlerts: SystemAlertRow[];
  onBack: () => void;
}) {
  const c = colorMap[site.color];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-slate-200 transition-colors text-xs flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3 rotate-180" /> Command Centers
        </button>
        <ChevronRight className="w-3 h-3 text-slate-400" />
        <span className="text-xs text-slate-400">{site.name}</span>
      </div>

      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-xl ${c.icon} flex items-center justify-center flex-shrink-0`}
        >
          <Factory className={`w-6 h-6 ${c.text}`} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{site.name}</h1>
          <div
            className={`text-sm font-semibold mt-0.5 flex items-center gap-1 ${c.text}`}
          >
            <MapPin className="w-3.5 h-3.5" />
            {[site.code, site.location].filter(Boolean).join(" — ") ||
              "No location on record"}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Live rollup computed from this site's assets, sensors, work orders
            and recommendations.
          </p>
        </div>
      </div>

      {/* All KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {rollupKpis(site).map((kpi) => (
          <div
            key={kpi.label}
            className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 text-center"
          >
            <div className="text-xs text-slate-400">{kpi.label}</div>
            <div className={`text-xl font-black mt-1 ${c.text}`}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" /> Active Alerts
        </h3>
        {site.alerts.length === 0 && orgAlerts.length === 0 ? (
          <EmptyState message="No active sensor alarms, warnings or unresolved alerts for this site." />
        ) : (
          <div className="space-y-2">
            {site.alerts.map((alert, i) => (
              <div
                key={`site-${i}`}
                className={`flex items-start gap-2.5 p-3 rounded-lg border ${alertColors[alert.level]} text-xs`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-0.5 flex-shrink-0 ${alert.level === "critical" ? "bg-red-500" : alert.level === "action" ? "bg-amber-500" : "bg-blue-400"}`}
                />
                {alert.text}
              </div>
            ))}
            {orgAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-2.5 p-3 rounded-lg border ${alertColors[alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "action" : "advisory"]} text-xs`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-0.5 flex-shrink-0 ${alert.severity === "critical" ? "bg-red-500" : alert.severity === "warning" ? "bg-amber-500" : "bg-blue-400"}`}
                />
                <span>
                  {alert.title ?? "System alert"}
                  {alert.description ? ` — ${alert.description}` : ""}
                  <span className="text-slate-400"> (org-wide)</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assets */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-teal-400" /> Assets at this Site
        </h3>
        {site.assets.length === 0 ? (
          <EmptyState message="No assets linked to this site yet." />
        ) : (
          <div className="space-y-2">
            {site.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm"
              >
                <span className="text-xs font-mono text-slate-400 w-16 flex-shrink-0">
                  {asset.tag ?? "—"}
                </span>
                <span className="text-slate-200 flex-1 min-w-0 truncate">
                  {asset.name}
                </span>
                <span className="text-xs text-slate-400 capitalize hidden md:inline">
                  {asset.criticality} criticality
                </span>
                <span
                  className={`text-xs font-bold ${healthColor(asset.health_score)}`}
                >
                  {asset.health_score}% health
                </span>
                <span className="text-xs text-slate-400">
                  risk {asset.risk_score}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Recommendations */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-teal-400" /> Pending Recommendations
        </h3>
        {site.recommendations.length === 0 ? (
          <EmptyState message="No pending recommendations for this site's assets." />
        ) : (
          <div className="space-y-2">
            {site.recommendations.map((rec) => (
              <div
                key={rec.title}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-slate-300"
              >
                <CheckCircle
                  className={`w-4 h-4 flex-shrink-0 ${rec.urgency === "critical" ? "text-red-400" : rec.urgency === "action" ? "text-amber-400" : "text-teal-400"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200">{rec.title}</div>
                  {rec.action && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      {rec.action}
                    </div>
                  )}
                </div>
                <span className="text-xs text-slate-400 capitalize flex-shrink-0">
                  {rec.urgency}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommandCenters() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refetch } = useAsyncData(loadCommandCenters);

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState label="Rolling up live site data…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }
  if (!data || data.rollups.length === 0) {
    return (
      <div className="p-6">
        <EmptyState message="No sites configured yet — command centers connect once sites and assets are onboarded." />
      </div>
    );
  }

  const selectedSite = data.rollups.find((r) => r.id === selected);

  return (
    <div className="p-6 space-y-6">
      {!selectedSite ? (
        <>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Command Centers
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Per-site operational rollups — {data.rollups.length} site
              {data.rollups.length === 1 ? "" : "s"} monitored live
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.rollups.map((site, i) => (
              <motion.div
                key={site.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <SiteCard site={site} onOpen={(id) => setSelected(id)} />
              </motion.div>
            ))}
          </div>

          {/* Live rollup note */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-start gap-3">
            <Users className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-teal-400">
                Live Site Rollups
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Every figure on this page is aggregated at load time from the
                assets, sensors, work orders and recommendations recorded for
                each site — no static snapshots.
              </p>
            </div>
          </div>
        </>
      ) : (
        <SiteDetail
          site={selectedSite}
          orgAlerts={data.orgAlerts}
          onBack={() => setSelected(null)}
        />
      )}
    </div>
  );
}
