import { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, Clock, Activity, Zap, Server } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Metrics {
  latency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  cost: {
    total: number;
    byModel: Record<string, number>;
    trend: number;
  };
  throughput: {
    totalRuns: number;
    successRate: number;
    runsPerHour: number;
  };
  tools: {
    totalCalls: number;
    successRate: number;
    avgDuration: number;
  };
}

export function MetricsDashboard() {
  const [metrics, setMetrics] = useState<Metrics>({
    latency: { avg: 0, p50: 0, p95: 0, p99: 0 },
    cost: { total: 0, byModel: {}, trend: 0 },
    throughput: { totalRuns: 0, successRate: 0, runsPerHour: 0 },
    tools: { totalCalls: 0, successRate: 0, avgDuration: 0 }
  });
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 60000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const timeThreshold = getTimeThreshold(timeRange);

      const [runsData, toolCallsData, costsData] = await Promise.all([
        loadRunsMetrics(timeThreshold),
        loadToolMetrics(timeThreshold),
        loadCostMetrics(timeThreshold)
      ]);

      setMetrics({
        latency: calculateLatencyMetrics(runsData),
        cost: calculateCostMetrics(costsData),
        throughput: calculateThroughputMetrics(runsData, timeRange),
        tools: calculateToolMetrics(toolCallsData)
      });
    } catch (error) {
      console.error('Error loading metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTimeThreshold = (range: string): string => {
    const now = new Date();
    switch (range) {
      case '1h':
        return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    }
  };

  const loadRunsMetrics = async (since: string) => {
    const { data } = await supabase
      .from('openclaw_orchestration_runs')
      .select('id, status, total_duration_ms, created_at, completed_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    return data || [];
  };

  const loadToolMetrics = async (since: string) => {
    const { data } = await supabase
      .from('openclaw_tool_calls')
      .select('id, status, duration_ms, created_at')
      .gte('created_at', since);

    return data || [];
  };

  const loadCostMetrics = async (since: string) => {
    const { data } = await supabase
      .from('openclaw_costs')
      .select('total_cost, model_name, created_at')
      .gte('created_at', since);

    return data || [];
  };

  const calculateLatencyMetrics = (runs: any[]) => {
    const durations = runs
      .filter(r => r.total_duration_ms)
      .map(r => r.total_duration_ms)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return { avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

    return { avg, p50, p95, p99 };
  };

  const calculateCostMetrics = (costs: any[]) => {
    const total = costs.reduce((sum, c) => sum + (c.total_cost || 0), 0);
    const byModel: Record<string, number> = {};

    costs.forEach(c => {
      if (c.model_name) {
        byModel[c.model_name] = (byModel[c.model_name] || 0) + (c.total_cost || 0);
      }
    });

    return { total, byModel, trend: 0 };
  };

  const calculateThroughputMetrics = (runs: any[], range: string) => {
    const totalRuns = runs.length;
    const successfulRuns = runs.filter(r => r.status === 'completed').length;
    const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

    const hoursInRange = {
      '1h': 1,
      '24h': 24,
      '7d': 168,
      '30d': 720
    }[range] || 24;

    const runsPerHour = totalRuns / hoursInRange;

    return { totalRuns, successRate, runsPerHour };
  };

  const calculateToolMetrics = (toolCalls: any[]) => {
    const totalCalls = toolCalls.length;
    const successfulCalls = toolCalls.filter(t => t.status === 'success').length;
    const successRate = totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;

    const durations = toolCalls.filter(t => t.duration_ms).map(t => t.duration_ms);
    const avgDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    return { totalCalls, successRate, avgDuration };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">System Metrics</h2>
        <div className="flex items-center gap-2">
          {(['1h', '24h', '7d', '30d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range === '1h' ? 'Last Hour' : range === '24h' ? 'Last 24h' : range === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <Clock className="w-8 h-8 text-blue-600" />
            <span className="text-xs text-blue-600 font-medium">AVG LATENCY</span>
          </div>
          <div className="text-3xl font-bold text-blue-900">{metrics.latency.avg.toFixed(0)}ms</div>
          <div className="mt-2 text-sm text-blue-700">
            P95: {metrics.latency.p95.toFixed(0)}ms
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
          <div className="flex items-center justify-between mb-4">
            <DollarSign className="w-8 h-8 text-green-600" />
            <span className="text-xs text-green-600 font-medium">TOTAL COST</span>
          </div>
          <div className="text-3xl font-bold text-green-900">${metrics.cost.total.toFixed(2)}</div>
          <div className="mt-2 text-sm text-green-700">
            {Object.keys(metrics.cost.byModel).length} models
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 border border-purple-200">
          <div className="flex items-center justify-between mb-4">
            <Activity className="w-8 h-8 text-purple-600" />
            <span className="text-xs text-purple-600 font-medium">THROUGHPUT</span>
          </div>
          <div className="text-3xl font-bold text-purple-900">{metrics.throughput.runsPerHour.toFixed(1)}</div>
          <div className="mt-2 text-sm text-purple-700">runs/hour</div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-6 border border-orange-200">
          <div className="flex items-center justify-between mb-4">
            <Zap className="w-8 h-8 text-orange-600" />
            <span className="text-xs text-orange-600 font-medium">SUCCESS RATE</span>
          </div>
          <div className="text-3xl font-bold text-orange-900">{metrics.throughput.successRate.toFixed(1)}%</div>
          <div className="mt-2 text-sm text-orange-700">
            {metrics.throughput.totalRuns} total runs
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            Latency Distribution
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600">Average</span>
                <span className="font-medium text-gray-900">{metrics.latency.avg.toFixed(0)}ms</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${Math.min((metrics.latency.avg / metrics.latency.p99) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600">P50 (Median)</span>
                <span className="font-medium text-gray-900">{metrics.latency.p50.toFixed(0)}ms</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{ width: `${Math.min((metrics.latency.p50 / metrics.latency.p99) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600">P95</span>
                <span className="font-medium text-gray-900">{metrics.latency.p95.toFixed(0)}ms</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-500"
                  style={{ width: `${Math.min((metrics.latency.p95 / metrics.latency.p99) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-600">P99</span>
                <span className="font-medium text-gray-900">{metrics.latency.p99.toFixed(0)}ms</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-red-500" style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            Cost by Model
          </h3>
          <div className="space-y-3">
            {Object.entries(metrics.cost.byModel)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([model, cost]) => (
                <div key={model}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600 truncate">{model}</span>
                    <span className="font-medium text-gray-900">${cost.toFixed(4)}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${(cost / metrics.cost.total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            {Object.keys(metrics.cost.byModel).length === 0 && (
              <p className="text-gray-500 text-sm">No cost data available</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-purple-600" />
            Tool Execution
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
              <span className="text-sm text-gray-600">Total Calls</span>
              <span className="text-lg font-semibold text-purple-900">{metrics.tools.totalCalls}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-600">Success Rate</span>
              <span className="text-lg font-semibold text-green-900">{metrics.tools.successRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <span className="text-sm text-gray-600">Avg Duration</span>
              <span className="text-lg font-semibold text-blue-900">{metrics.tools.avgDuration.toFixed(0)}ms</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-orange-600" />
            System Health
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-600">Success Rate</span>
              <div className="flex items-center gap-2">
                <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${metrics.throughput.successRate}%` }}
                  />
                </div>
                <span className="text-lg font-semibold text-green-900">{metrics.throughput.successRate.toFixed(0)}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <span className="text-sm text-gray-600">Runs/Hour</span>
              <span className="text-lg font-semibold text-blue-900">{metrics.throughput.runsPerHour.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
              <span className="text-sm text-gray-600">Total Runs</span>
              <span className="text-lg font-semibold text-purple-900">{metrics.throughput.totalRuns}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
