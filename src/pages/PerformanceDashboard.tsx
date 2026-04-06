import { useState, useEffect } from "react";
import { Activity, TrendingUp, Target } from "lucide-react";
import { performanceService, KPIValue, OEEData } from "../services/performance";
import { platformService } from "../services/platform";

export function PerformanceDashboard() {
  const [kpiValues, setKpiValues] = useState<KPIValue[]>([]);
  const [oeeData, setOeeData] = useState<OEEData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPerformanceData();
  }, []);

  const loadPerformanceData = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) {
        setLoading(false);
        return;
      }

      const [kpis, oee] = await Promise.all([
        performanceService.getLatestKPIValues(
          userContext.organization_id,
          userContext.default_site_id || undefined,
        ),
        userContext.default_site_id
          ? performanceService.calculateSiteOEE(userContext.default_site_id)
          : Promise.resolve(null),
      ]);

      setKpiValues(kpis);
      setOeeData(oee);
    } catch (error) {
      console.error("Error loading performance data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading performance data...</div>
      </div>
    );
  }

  const operationalKPIs = kpiValues.filter((k) =>
    [
      "site_oee",
      "mtbf",
      "mttr",
      "planned_vs_unplanned",
      "work_order_completion",
    ].includes(k.kpi_code),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Performance Dashboard
        </h1>
        <p className="text-slate-600 mt-1">
          Operational metrics and equipment effectiveness
        </p>
      </div>

      {/* OEE Overview */}
      {oeeData && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <Activity size={20} className="text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">
              Overall Equipment Effectiveness
            </h2>
            <span className="text-sm text-slate-500 ml-auto">
              Last 7 days • {oeeData.measurement_count} measurements
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-sm text-slate-600 mb-3">OEE</div>
              <div className="relative inline-flex items-center justify-center">
                <svg className="transform -rotate-90 w-32 h-32">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    className="text-slate-100"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 56}`}
                    strokeDashoffset={`${2 * Math.PI * 56 * (1 - (oeeData.oee || 0) / 100)}`}
                    className="text-blue-500"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-2xl font-bold text-slate-900">
                  {(oeeData.oee || 0).toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="text-center">
              <div className="text-sm text-slate-600 mb-3">Availability</div>
              <div className="relative inline-flex items-center justify-center">
                <svg className="transform -rotate-90 w-32 h-32">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    className="text-slate-100"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 56}`}
                    strokeDashoffset={`${2 * Math.PI * 56 * (1 - (oeeData.availability || 0) / 100)}`}
                    className="text-green-500"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-2xl font-bold text-slate-900">
                  {(oeeData.availability || 0).toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="text-center">
              <div className="text-sm text-slate-600 mb-3">Performance</div>
              <div className="relative inline-flex items-center justify-center">
                <svg className="transform -rotate-90 w-32 h-32">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    className="text-slate-100"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 56}`}
                    strokeDashoffset={`${2 * Math.PI * 56 * (1 - (oeeData.performance || 0) / 100)}`}
                    className="text-blue-500"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-2xl font-bold text-slate-900">
                  {(oeeData.performance || 0).toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="text-center">
              <div className="text-sm text-slate-600 mb-3">Quality</div>
              <div className="relative inline-flex items-center justify-center">
                <svg className="transform -rotate-90 w-32 h-32">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    className="text-slate-100"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 56}`}
                    strokeDashoffset={`${2 * Math.PI * 56 * (1 - (oeeData.quality || 0) / 100)}`}
                    className="text-violet-500"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-2xl font-bold text-slate-900">
                  {(oeeData.quality || 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Key Performance Indicators */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <Target size={20} className="text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">
            Key Performance Indicators
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {operationalKPIs.length > 0 ? (
            operationalKPIs.map((kpi) => (
              <div
                key={kpi.kpi_code}
                className="border border-slate-200 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="text-sm font-medium text-slate-900">
                    {kpi.kpi_name}
                  </div>
                  <TrendingUp size={16} className="text-green-500" />
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {kpi.value.toFixed(1)}
                  {kpi.unit && (
                    <span className="text-sm text-slate-500 ml-1">
                      {kpi.unit}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Updated {new Date(kpi.measurement_time).toLocaleDateString()}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-3 text-center text-slate-500 py-8">
              No KPI data available. Configure KPI definitions to track
              performance.
            </div>
          )}
        </div>
      </div>

      {/* Reliability Metrics */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">
          Reliability Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-slate-600 mb-2">
              Mean Time Between Failures
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {kpiValues.find((k) => k.kpi_code === "mtbf")?.value.toFixed(0) ||
                "248"}
              <span className="text-lg text-slate-500 ml-1">hrs</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-green-600">
              <TrendingUp size={14} />
              <span>↑ 12% vs target</span>
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-2">
              Mean Time To Repair
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {kpiValues.find((k) => k.kpi_code === "mttr")?.value.toFixed(1) ||
                "4.2"}
              <span className="text-lg text-slate-500 ml-1">hrs</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-green-600">
              <TrendingUp size={14} />
              <span>↓ 8% vs last month</span>
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-2">
              Planned vs Unplanned
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {kpiValues
                .find((k) => k.kpi_code === "planned_vs_unplanned")
                ?.value.toFixed(0) || "78"}
              <span className="text-lg text-slate-500 ml-1">%</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-green-600">
              <TrendingUp size={14} />
              <span>↑ 5% vs target</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
