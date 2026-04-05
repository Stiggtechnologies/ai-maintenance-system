import { useState, useEffect } from 'react';
import { Gauge, TrendingUp, TrendingDown, Clock, AlertTriangle, Factory, Loader2 } from 'lucide-react';
import { oeeService } from '../services/syncaiDataService';
import { platformService } from '../services/platform';

interface OEEMeasurement {
  id: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  measurement_date: string;
  production_line_id: string;
  production_lines: { code: string; name: string } | null;
  sites: { name: string } | null;
}

interface LineOEE {
  production_line_id: string;
  production_lines: { name: string } | null;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  measurement_date: string;
}

interface LossEvent {
  id: string;
  description: string;
  duration_minutes: number;
  start_time: string;
  oee_loss_categories: { code: string; name: string } | null;
  assets: { name: string; asset_tag: string } | null;
}

const LOSS_CATEGORIES = [
  'Equipment Failure',
  'Setup',
  'Minor Stops',
  'Reduced Speed',
  'Defects',
  'Startup',
];

function getColorClass(value: number): string {
  if (value >= 85) return 'text-green-600';
  if (value >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

function getBgColorClass(value: number): string {
  if (value >= 85) return 'bg-green-50 border-green-200';
  if (value >= 70) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

function getBarColor(value: number): string {
  if (value >= 85) return 'bg-green-500';
  if (value >= 70) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function OEEDashboard() {
  const [measurements, setMeasurements] = useState<OEEMeasurement[]>([]);
  const [lineData, setLineData] = useState<LineOEE[]>([]);
  const [lossEvents, setLossEvents] = useState<LossEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const context = await platformService.getCurrentUserContext();
      if (!context) {
        setError('Unable to load user context. Please try again.');
        setLoading(false);
        return;
      }

      const orgId = context.organization_id;
      const siteId = context.default_site_id || undefined;

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [dashboardData, byLineData, lossData] = await Promise.all([
        oeeService.getOEEDashboard(orgId, siteId),
        oeeService.getOEEByLine(orgId),
        oeeService.getLossBreakdown(orgId, thirtyDaysAgo, now),
      ]);

      setMeasurements(dashboardData);
      setLineData(byLineData);
      setLossEvents(lossData);
    } catch (err) {
      console.error('Error loading OEE data:', err);
      setError('Failed to load OEE data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Compute summary averages from measurements
  const summary = (() => {
    if (measurements.length === 0) {
      return { oee: 0, availability: 0, performance: 0, quality: 0 };
    }
    const sum = measurements.reduce(
      (acc, m) => ({
        oee: acc.oee + (m.oee || 0),
        availability: acc.availability + (m.availability || 0),
        performance: acc.performance + (m.performance || 0),
        quality: acc.quality + (m.quality || 0),
      }),
      { oee: 0, availability: 0, performance: 0, quality: 0 }
    );
    const count = measurements.length;
    return {
      oee: Math.round((sum.oee / count) * 10) / 10,
      availability: Math.round((sum.availability / count) * 10) / 10,
      performance: Math.round((sum.performance / count) * 10) / 10,
      quality: Math.round((sum.quality / count) * 10) / 10,
    };
  })();

  // Get latest measurement per production line
  const latestByLine = (() => {
    const map = new Map<string, LineOEE>();
    for (const item of lineData) {
      if (!map.has(item.production_line_id)) {
        map.set(item.production_line_id, item);
      }
    }
    return Array.from(map.values());
  })();

  // Group loss events by category
  const lossGrouped = (() => {
    const groups: Record<string, { events: LossEvent[]; totalMinutes: number }> = {};
    for (const cat of LOSS_CATEGORIES) {
      groups[cat] = { events: [], totalMinutes: 0 };
    }
    for (const event of lossEvents) {
      const catName = event.oee_loss_categories?.name || 'Other';
      if (!groups[catName]) {
        groups[catName] = { events: [], totalMinutes: 0 };
      }
      groups[catName].events.push(event);
      groups[catName].totalMinutes += event.duration_minutes || 0;
    }
    return groups;
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading OEE data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="mx-auto text-red-500 mb-2" size={32} />
        <p className="text-red-700">{error}</p>
        <button
          onClick={loadData}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const hasData = measurements.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">OEE Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Overall Equipment Effectiveness across your production lines
        </p>
      </div>

      {!hasData ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Factory className="mx-auto text-slate-300 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-slate-700">No OEE Data Available</h3>
          <p className="text-sm text-slate-500 mt-2">
            OEE measurements will appear here once production data is being tracked.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Overall OEE', value: summary.oee, icon: Gauge },
              { label: 'Availability', value: summary.availability, icon: TrendingUp },
              { label: 'Performance', value: summary.performance, icon: TrendingUp },
              { label: 'Quality', value: summary.quality, icon: TrendingDown },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={`border rounded-xl p-5 ${getBgColorClass(card.value)}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-slate-600">{card.label}</span>
                    <Icon size={18} className={getColorClass(card.value)} />
                  </div>
                  <div className={`text-3xl font-bold ${getColorClass(card.value)}`}>
                    {card.value}%
                  </div>
                  <div className="mt-2 w-full bg-white/60 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${getBarColor(card.value)}`}
                      style={{ width: `${Math.min(card.value, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Production Line Breakdown */}
          <div className="bg-white border border-slate-200 rounded-xl">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Production Line Breakdown</h2>
              <p className="text-sm text-slate-500">Latest OEE values per production line</p>
            </div>
            {latestByLine.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No production line data available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Production Line
                      </th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        OEE
                      </th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Availability
                      </th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Performance
                      </th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Quality
                      </th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {latestByLine.map((line) => (
                      <tr key={line.production_line_id} className="hover:bg-slate-50">
                        <td className="px-6 py-3 text-sm font-medium text-slate-900">
                          {line.production_lines?.name || 'Unknown Line'}
                        </td>
                        <td className={`px-6 py-3 text-sm font-semibold text-right ${getColorClass(line.oee)}`}>
                          {Math.round(line.oee * 10) / 10}%
                        </td>
                        <td className={`px-6 py-3 text-sm text-right ${getColorClass(line.availability)}`}>
                          {Math.round(line.availability * 10) / 10}%
                        </td>
                        <td className={`px-6 py-3 text-sm text-right ${getColorClass(line.performance)}`}>
                          {Math.round(line.performance * 10) / 10}%
                        </td>
                        <td className={`px-6 py-3 text-sm text-right ${getColorClass(line.quality)}`}>
                          {Math.round(line.quality * 10) / 10}%
                        </td>
                        <td className="px-6 py-3 text-sm text-right text-slate-500">
                          {new Date(line.measurement_date).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Loss Events */}
          <div className="bg-white border border-slate-200 rounded-xl">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Loss Events</h2>
              <p className="text-sm text-slate-500">Recent loss events grouped by category (last 30 days)</p>
            </div>
            {lossEvents.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No loss events recorded in the last 30 days.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {Object.entries(lossGrouped)
                  .filter(([_, group]) => group.events.length > 0)
                  .sort((a, b) => b[1].totalMinutes - a[1].totalMinutes)
                  .map(([category, group]) => (
                    <div key={category} className="px-6 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={16} className="text-amber-500" />
                          <span className="text-sm font-semibold text-slate-900">{category}</span>
                          <span className="text-xs text-slate-400">
                            ({group.events.length} event{group.events.length !== 1 ? 's' : ''})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-slate-600">
                          <Clock size={14} />
                          <span className="font-medium">
                            {group.totalMinutes >= 60
                              ? `${Math.round(group.totalMinutes / 60 * 10) / 10}h`
                              : `${Math.round(group.totalMinutes)}m`}
                          </span>
                          <span className="text-slate-400">total</span>
                        </div>
                      </div>
                      <div className="space-y-1 ml-6">
                        {group.events.slice(0, 5).map((event) => (
                          <div
                            key={event.id}
                            className="flex items-center justify-between text-xs text-slate-600"
                          >
                            <span className="truncate flex-1">
                              {event.description || 'No description'}
                              {event.assets && (
                                <span className="text-slate-400 ml-1">
                                  - {event.assets.name}
                                </span>
                              )}
                            </span>
                            <span className="text-slate-500 ml-3 whitespace-nowrap">
                              {event.duration_minutes}m
                            </span>
                          </div>
                        ))}
                        {group.events.length > 5 && (
                          <div className="text-xs text-slate-400">
                            +{group.events.length - 5} more events
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
