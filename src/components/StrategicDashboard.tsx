import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TrendingUp, TrendingDown, Minus, Filter, Download } from 'lucide-react';

interface KPI {
  id: string;
  kpi_code: string;
  kpi_name: string;
  description: string;
  category_name: string;
  unit_of_measure: string;
  target_value: number;
  threshold_green: number;
  threshold_yellow: number;
  current_value?: number;
  variance?: number;
  status?: 'green' | 'yellow' | 'red';
  trend?: 'improving' | 'stable' | 'declining';
  last_updated?: string;
}

export function StrategicDashboard() {
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    fetchKPIs();
  }, []);

  const fetchKPIs = async () => {
    try {
      const { data: kpisData, error: kpisError } = await supabase
        .from('kpis_kois')
        .select(`
          id,
          kpi_code,
          kpi_name,
          description,
          unit_of_measure,
          target_value,
          threshold_green,
          threshold_yellow,
          kpi_categories (category_name)
        `)
        .order('kpi_code');

      if (kpisError) throw kpisError;

      const { data: measurements, error: measurementsError } = await supabase
        .from('kpi_measurements')
        .select('kpi_id, measured_value, status, created_at')
        .order('created_at', { ascending: false });

      if (measurementsError) throw measurementsError;

      const latestMeasurements = new Map();
      measurements?.forEach((m: any) => {
        if (!latestMeasurements.has(m.kpi_id)) {
          latestMeasurements.set(m.kpi_id, m);
        }
      });

      const enrichedKPIs: KPI[] = kpisData?.map((kpi: any) => {
        const measurement = latestMeasurements.get(kpi.id);
        const currentValue = measurement?.measured_value || 0;
        const variance = kpi.target_value ? ((currentValue - kpi.target_value) / kpi.target_value * 100) : 0;

        let status: 'green' | 'yellow' | 'red' = 'red';
        if (currentValue >= kpi.threshold_green) status = 'green';
        else if (currentValue >= kpi.threshold_yellow) status = 'yellow';

        const previousMeasurements = measurements?.filter((m: any) => m.kpi_id === kpi.id).slice(0, 5) || [];
        let trend: 'improving' | 'stable' | 'declining' = 'stable';
        if (previousMeasurements.length >= 3) {
          const values = previousMeasurements.map((m: any) => m.measured_value);
          const avg1 = values.slice(0, 2).reduce((a: number, b: number) => a + b, 0) / 2;
          const avg2 = values.slice(2, 4).reduce((a: number, b: number) => a + b, 0) / 2;
          if (avg1 > avg2 * 1.05) trend = 'improving';
          else if (avg1 < avg2 * 0.95) trend = 'declining';
        }

        return {
          id: kpi.id,
          kpi_code: kpi.kpi_code,
          kpi_name: kpi.kpi_name,
          description: kpi.description,
          category_name: kpi.kpi_categories?.category_name || 'General',
          unit_of_measure: kpi.unit_of_measure,
          target_value: kpi.target_value,
          threshold_green: kpi.threshold_green,
          threshold_yellow: kpi.threshold_yellow,
          current_value: currentValue,
          variance,
          status: measurement?.status || status,
          trend,
          last_updated: measurement?.created_at
        };
      }) || [];

      setKpis(enrichedKPIs);

      const uniqueCategories = [...new Set(enrichedKPIs.map(k => k.category_name))];
      setCategories(uniqueCategories);
    } catch (error) {
      console.error('Error fetching KPIs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredKPIs = kpis.filter(kpi => {
    if (selectedCategory !== 'all' && kpi.category_name !== selectedCategory) return false;
    if (selectedStatus !== 'all' && kpi.status !== selectedStatus) return false;
    return true;
  });

  const summary = {
    total: kpis.length,
    green: kpis.filter(k => k.status === 'green').length,
    yellow: kpis.filter(k => k.status === 'yellow').length,
    red: kpis.filter(k => k.status === 'red').length
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'green': return 'text-green-600 bg-green-50 border-green-200';
      case 'yellow': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'red': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'improving': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'declining': return <TrendingDown className="w-4 h-4 text-red-600" />;
      default: return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Strategic Performance Dashboard</h1>
          <p className="text-gray-600">Monitor all 29 ISO 55000 KPIs across your organization</p>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Total KPIs</div>
            <div className="text-3xl font-bold text-gray-900">{summary.total}</div>
          </div>
          <div className="bg-green-50 rounded-xl p-4 border border-green-200">
            <div className="text-sm text-green-700 mb-1">On Target</div>
            <div className="text-3xl font-bold text-green-700">{summary.green}</div>
          </div>
          <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
            <div className="text-sm text-yellow-700 mb-1">At Risk</div>
            <div className="text-3xl font-bold text-yellow-700">{summary.yellow}</div>
          </div>
          <div className="bg-red-50 rounded-xl p-4 border border-red-200">
            <div className="text-sm text-red-700 mb-1">Off Target</div>
            <div className="text-3xl font-bold text-red-700">{summary.red}</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-4">
            <Filter className="w-5 h-5 text-gray-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">All Status</option>
              <option value="green">Green</option>
              <option value="yellow">Yellow</option>
              <option value="red">Red</option>
            </select>
            <button className="ml-auto px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredKPIs.map(kpi => (
            <div key={kpi.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">{kpi.kpi_code}</div>
                  <h3 className="font-semibold text-gray-900 text-sm">{kpi.kpi_name}</h3>
                </div>
                <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(kpi.status || 'red')}`}>
                  {kpi.status?.toUpperCase()}
                </div>
              </div>

              <div className="text-xs text-gray-600 mb-3 line-clamp-2">{kpi.description}</div>

              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Current</span>
                  <span className="text-lg font-bold text-gray-900">
                    {kpi.current_value?.toFixed(1)} {kpi.unit_of_measure}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Target</span>
                  <span className="text-sm text-gray-600">
                    {kpi.target_value?.toFixed(1)} {kpi.unit_of_measure}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Variance</span>
                  <span className={`text-sm font-medium ${kpi.variance && kpi.variance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kpi.variance ? `${kpi.variance > 0 ? '+' : ''}${kpi.variance.toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1">
                  {getTrendIcon(kpi.trend)}
                  <span className="text-xs text-gray-500 capitalize">{kpi.trend}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {kpi.last_updated ? new Date(kpi.last_updated).toLocaleDateString() : 'No data'}
                </div>
              </div>

              <div className="mt-2">
                <div className="text-xs text-gray-500 mb-1">{kpi.category_name}</div>
              </div>
            </div>
          ))}
        </div>

        {filteredKPIs.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500">No KPIs match the selected filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
