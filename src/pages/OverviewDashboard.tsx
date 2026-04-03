import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, TriangleAlert as AlertTriangle, Shield, Zap, Activity, Wrench, Video as LucideIcon } from 'lucide-react';
import { performanceService, KPIValue } from '../services/performance';
import { workService, WorkBacklogSummary } from '../services/work';
import { platformService } from '../services/platform';

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon: LucideIcon;
  iconColor: string;
  status?: 'good' | 'warning' | 'critical';
}

function StatCard({ title, value, unit, trend, trendValue, icon: Icon, iconColor, status }: StatCardProps) {
  const statusColors = {
    good: 'border-green-200 bg-green-50',
    warning: 'border-yellow-200 bg-yellow-50',
    critical: 'border-red-200 bg-red-50',
  };

  return (
    <div className={`bg-white border rounded-xl p-6 ${status ? statusColors[status] : 'border-slate-200'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-600 mb-1">{title}</div>
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-bold text-slate-900">{value}</div>
            {unit && <div className="text-sm text-slate-500">{unit}</div>}
          </div>
          {trend && trendValue && (
            <div className={`flex items-center gap-1 mt-2 text-sm ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-slate-600'}`}>
              {trend === 'up' ? <TrendingUp size={16} /> : trend === 'down' ? <TrendingDown size={16} /> : null}
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg ${iconColor}`}>
          <Icon size={24} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export function OverviewDashboard() {
  const [kpiValues, setKpiValues] = useState<KPIValue[]>([]);
  const [workBacklog, setWorkBacklog] = useState<WorkBacklogSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) return;

      const [kpis, backlog] = await Promise.all([
        performanceService.getLatestKPIValues(userContext.organization_id, userContext.default_site_id || undefined),
        workService.getBacklogSummary(userContext.organization_id, userContext.default_site_id || undefined),
      ]);

      setKpiValues(kpis);
      setWorkBacklog(backlog);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading dashboard...</div>
      </div>
    );
  }

  const enterpriseRiskKPI = kpiValues.find(k => k.kpi_code === 'enterprise_risk_index');
  const downtimeCostKPI = kpiValues.find(k => k.kpi_code === 'downtime_cost_exposure');
  const aiConfidenceKPI = kpiValues.find(k => k.kpi_code === 'ai_confidence_score');
  const governanceComplianceKPI = kpiValues.find(k => k.kpi_code === 'governance_compliance');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Strategic Overview</h1>
        <p className="text-slate-600 mt-1">Enterprise intelligence and operational performance</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Enterprise Risk Index"
          value={enterpriseRiskKPI?.value.toFixed(1) || '5.2'}
          unit="/ 10"
          trend="down"
          trendValue="↓ 8% vs last month"
          icon={AlertTriangle}
          iconColor="bg-gradient-to-br from-orange-500 to-red-500"
          status="warning"
        />
        <StatCard
          title="Downtime Cost Exposure"
          value={downtimeCostKPI ? `$${(downtimeCostKPI.value / 1000000).toFixed(1)}` : '$2.4'}
          unit="M"
          trend="down"
          trendValue="↓ 12% vs last month"
          icon={TrendingDown}
          iconColor="bg-gradient-to-br from-blue-500 to-cyan-500"
          status="good"
        />
        <StatCard
          title="AI Confidence Score"
          value={aiConfidenceKPI?.value.toFixed(0) || '87'}
          unit="%"
          trend="up"
          trendValue="↑ 3% vs last week"
          icon={Zap}
          iconColor="bg-gradient-to-br from-violet-500 to-purple-500"
          status="good"
        />
        <StatCard
          title="Governance Compliance"
          value={governanceComplianceKPI?.value.toFixed(0) || '94'}
          unit="%"
          trend="up"
          trendValue="↑ 2% vs last week"
          icon={Shield}
          iconColor="bg-gradient-to-br from-green-500 to-emerald-500"
          status="good"
        />
      </div>

      {/* Work Backlog Summary */}
      {workBacklog && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={20} className="text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">Work Backlog</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-slate-600">Open Work Orders</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{workBacklog.open_work_order_count}</div>
            </div>
            <div>
              <div className="text-sm text-slate-600">Overdue</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{workBacklog.overdue_count}</div>
            </div>
            <div>
              <div className="text-sm text-slate-600">Critical</div>
              <div className="text-2xl font-bold text-orange-600 mt-1">{workBacklog.critical_count}</div>
            </div>
            <div>
              <div className="text-sm text-slate-600">Avg Age</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{workBacklog.avg_age_days?.toFixed(1) || '0'}<span className="text-sm text-slate-500 ml-1">days</span></div>
            </div>
          </div>
        </div>
      )}

      {/* OEE Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={20} className="text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Overall Equipment Effectiveness</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <div className="text-sm text-slate-600 mb-2">OEE</div>
            <div className="text-3xl font-bold text-slate-900">72.4<span className="text-lg text-slate-500">%</span></div>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-500" style={{ width: '72.4%' }} />
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-2">Availability</div>
            <div className="text-3xl font-bold text-slate-900">85.2<span className="text-lg text-slate-500">%</span></div>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-emerald-500" style={{ width: '85.2%' }} />
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-2">Performance</div>
            <div className="text-3xl font-bold text-slate-900">89.7<span className="text-lg text-slate-500">%</span></div>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: '89.7%' }} />
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-2">Quality</div>
            <div className="text-3xl font-bold text-slate-900">94.8<span className="text-lg text-slate-500">%</span></div>
            <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-purple-500" style={{ width: '94.8%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Recent AI Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Recent AI Actions</h2>
        <div className="space-y-3">
          {[
            { time: '2 mins ago', action: 'Autonomous work order created for Conveyor Belt 3A - bearing replacement', status: 'Awaiting Approval', color: 'bg-yellow-100 text-yellow-800' },
            { time: '15 mins ago', action: 'Predictive alert issued for Crusher Unit 2 - vibration anomaly detected', status: 'Approved', color: 'bg-green-100 text-green-800' },
            { time: '1 hour ago', action: 'Maintenance schedule optimized - 3 PM activities shifted to 4 PM', status: 'Executed', color: 'bg-blue-100 text-blue-800' },
          ].map((item, index) => (
            <div key={index} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
              <div className="flex-1">
                <div className="text-sm text-slate-900">{item.action}</div>
                <div className="text-xs text-slate-500 mt-1">{item.time}</div>
              </div>
              <div className={`px-2 py-1 rounded text-xs font-medium ${item.color}`}>
                {item.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
