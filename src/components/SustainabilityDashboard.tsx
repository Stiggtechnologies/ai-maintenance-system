// SyncAI Sustainability & ESG Dashboard
// Environmental, Social, and Governance Monitoring

import { useState } from 'react';
import { 
  Recycle, Leaf, Zap, TrendingUp, TrendingDown,
  Calendar
} from 'lucide-react';

interface ESGMetric {
  id: string;
  category: 'environmental' | 'social' | 'governance';
  name: string;
  value: number;
  unit: string;
  target: number;
  trend: 'up' | 'down' | 'stable';
  status: 'on-track' | 'at-risk' | 'off-track';
}

const metrics: ESGMetric[] = [
  // Environmental
  { id: '1', category: 'environmental', name: 'Carbon Emissions (Scope 1)', value: 1245, unit: 'tonnes CO2', target: 1000, trend: 'down', status: 'at-risk' },
  { id: '2', category: 'environmental', name: 'Carbon Emissions (Scope 2)', value: 856, unit: 'tonnes CO2', target: 800, trend: 'down', status: 'on-track' },
  { id: '3', category: 'environmental', name: 'Energy Consumption', value: 24500, unit: 'MWh', target: 25000, trend: 'stable', status: 'on-track' },
  { id: '4', category: 'environmental', name: 'Water Usage', value: 8900, unit: 'm³', target: 10000, trend: 'down', status: 'on-track' },
  { id: '5', category: 'environmental', name: 'Waste Diversion Rate', value: 78, unit: '%', target: 85, trend: 'up', status: 'at-risk' },
  { id: '6', category: 'environmental', name: 'Renewable Energy', value: 34, unit: '%', target: 50, trend: 'up', status: 'at-risk' },
  // Social
  { id: '7', category: 'social', name: 'Safety Incidents', value: 2, unit: 'incidents', target: 0, trend: 'down', status: 'off-track' },
  { id: '8', category: 'social', name: 'Employee Training Hours', value: 4520, unit: 'hours', target: 5000, trend: 'up', status: 'on-track' },
  { id: '9', category: 'social', name: 'Community Investment', value: 125000, unit: '$', target: 100000, trend: 'up', status: 'on-track' },
  { id: '10', category: 'social', name: 'Diversity Score', value: 72, unit: '%', target: 75, trend: 'stable', status: 'on-track' },
  // Governance
  { id: '11', category: 'governance', name: 'Policy Compliance', value: 96, unit: '%', target: 100, trend: 'stable', status: 'on-track' },
  { id: '12', category: 'governance', name: 'Audit Findings', value: 3, unit: 'findings', target: 0, trend: 'down', status: 'on-track' },
  { id: '13', category: 'governance', name: 'Board Diversity', value: 45, unit: '%', target: 50, trend: 'up', status: 'on-track' },
];

interface CarbonEntry {
  month: string;
  scope1: number;
  scope2: number;
  scope3: number;
}

const carbonData: CarbonEntry[] = [
  { month: 'Jan', scope1: 145, scope2: 98, scope3: 234 },
  { month: 'Feb', scope1: 138, scope2: 92, scope3: 228 },
  { month: 'Mar', scope1: 156, scope2: 88, scope3: 245 },
  { month: 'Apr', scope1: 142, scope2: 85, scope3: 231 },
  { month: 'May', scope1: 135, scope2: 82, scope3: 225 },
  { month: 'Jun', scope1: 128, scope2: 78, scope3: 218 },
];

function MetricCard({ metric }: { metric: ESGMetric }) {
  const statusColors = {
    'on-track': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    'at-risk': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    'off-track': 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  const trendIcon = metric.trend === 'up' ? <TrendingUp className="w-4 h-4" /> : metric.trend === 'down' ? <TrendingDown className="w-4 h-4" /> : null;
  const trendColor = metric.trend === 'up' ? 'text-emerald-400' : metric.trend === 'down' ? 'text-red-400' : 'text-gray-400';

  const progress = (metric.value / metric.target) * 100;
  const progressColor = metric.status === 'on-track' ? 'bg-emerald-500' : metric.status === 'at-risk' ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-gray-400 uppercase">{metric.category}</div>
          <div className="text-sm font-medium text-white mt-1">{metric.name}</div>
        </div>
        <span className={`text-xs px-2 py-1 rounded border ${statusColors[metric.status]}`}>
          {metric.status.replace('-', ' ')}
        </span>
      </div>
      
      <div className="flex items-end gap-2 mb-3">
        <span className="text-2xl font-bold text-white">{metric.value.toLocaleString()}</span>
        <span className="text-sm text-gray-400">{metric.unit}</span>
        <span className={`flex items-center text-xs ${trendColor}`}>{trendIcon}</span>
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress to target</span>
          <span>{progress.toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-[#2A3344] rounded-full overflow-hidden">
          <div 
            className={`h-full ${progressColor} transition-all`} 
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Target: {metric.target.toLocaleString()} {metric.unit}
      </div>
    </div>
  );
}

export function SustainabilityDashboard() {
  const [timeRange, setTimeRange] = useState('6m');
  const [filterCategory, setFilterCategory] = useState<'all' | 'environmental' | 'social' | 'governance'>('all');

  const filteredMetrics = metrics.filter(m => filterCategory === 'all' || m.category === filterCategory);

  const summary = {
    environmental: metrics.filter(m => m.category === 'environmental').filter(m => m.status === 'on-track').length,
    social: metrics.filter(m => m.category === 'social').filter(m => m.status === 'on-track').length,
    governance: metrics.filter(m => m.category === 'governance').filter(m => m.status === 'on-track').length,
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Recycle className="w-8 h-8 text-emerald-500" />
            Sustainability & ESG
          </h1>
          <div className="flex items-center gap-3">
            <select 
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="bg-[#1A1F2E] border border-[#2A3344] rounded-lg px-3 py-2 text-sm"
            >
              <option value="1m">Last Month</option>
              <option value="3m">Last 3 Months</option>
              <option value="6m">Last 6 Months</option>
              <option value="1y">Last Year</option>
            </select>
            <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Generate Report
            </button>
          </div>
        </div>
        <p className="text-gray-400">Monitor environmental, social, and governance performance</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Leaf className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-gray-400">Environmental</span>
          </div>
          <div className="text-2xl font-bold text-emerald-400">{summary.environmental}/6</div>
          <div className="text-xs text-gray-500">on track</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-blue-400" />
            <span className="text-sm text-gray-400">Social</span>
          </div>
          <div className="text-2xl font-bold text-blue-400">{summary.social}/4</div>
          <div className="text-xs text-gray-500">on track</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-purple-400" />
            <span className="text-sm text-gray-400">Governance</span>
          </div>
          <div className="text-2xl font-bold text-purple-400">{summary.governance}/3</div>
          <div className="text-xs text-gray-500">on track</div>
        </div>
      </div>

      {/* Carbon Trend Chart Placeholder */}
      <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          Carbon Emissions Trend
        </h3>
        <div className="h-48 flex items-end gap-4">
          {carbonData.map((entry) => (
            <div key={entry.month} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-full flex gap-1 h-32 items-end">
                <div className="flex-1 bg-blue-500/80 rounded-t" style={{ height: `${(entry.scope1 / 160) * 100}%` }} />
                <div className="flex-1 bg-emerald-500/80 rounded-t" style={{ height: `${(entry.scope2 / 160) * 100}%` }} />
                <div className="flex-1 bg-purple-500/80 rounded-t" style={{ height: `${(entry.scope3 / 300) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500">{entry.month}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-6 mt-4 text-xs">
          <span className="flex items-center gap-2"><span className="w-3 h-3 bg-blue-500 rounded" /> Scope 1</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 bg-emerald-500 rounded" /> Scope 2</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 bg-purple-500 rounded" /> Scope 3</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'environmental', 'social', 'governance'] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-4 py-2 rounded-lg text-sm capitalize ${
              filterCategory === cat 
                ? 'bg-blue-600 text-white' 
                : 'bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-4">
        {filteredMetrics.map(metric => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>
    </div>
  );
}

function Users({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function Shield({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export default SustainabilityDashboard;