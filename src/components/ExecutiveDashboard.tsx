import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  TrendingUp, TrendingDown, Minus, Target, DollarSign, Shield,
  Leaf, Users, BarChart3, AlertTriangle, CheckCircle, Activity,
  ArrowUpRight, ArrowDownRight, Calendar
} from 'lucide-react';

interface KPI {
  kpi_id: string;
  kpi_code: string;
  kpi_name: string;
  kpi_type: string;
  category_name: string;
  latest_value: number | null;
  target_value: number | null;
  status: 'green' | 'yellow' | 'red' | 'unknown';
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  last_updated: string;
}

interface CategorySummary {
  category: string;
  icon: any;
  color: string;
  kpis: KPI[];
  avgStatus: string;
}

export default function ExecutiveDashboard() {
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('current');
  const [categoryView, setCategoryView] = useState<string | null>(null);

  useEffect(() => {
    loadExecutiveKPIs();
  }, []);

  const loadExecutiveKPIs = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_kpi_dashboard')
        .select('*')
        .eq('user_id', user.id)
        .eq('kpi_type', 'KOI')
        .order('category_name', { ascending: true });

      if (error) throw error;
      setKpis(data || []);
    } catch (error) {
      console.error('Error loading KPIs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    const iconMap: { [key: string]: any } = {
      'Strategic Alignment & Value Realization': Target,
      'Maintenance & Reliability': Activity,
      'Risk Management': Shield,
      'Financial and Lifecycle Costing': DollarSign,
      'Asset Information & Data Integrity': BarChart3,
      'Planning & Decision Support': Calendar,
      'Sustainability & ESG': Leaf,
      'People, Competence & Culture': Users,
      'Performance Monitoring': TrendingUp,
      'Digital Enablement': Activity
    };
    return iconMap[category] || BarChart3;
  };

  const getCategoryColor = (category: string) => {
    const colorMap: { [key: string]: string } = {
      'Strategic Alignment & Value Realization': 'purple',
      'Maintenance & Reliability': 'blue',
      'Risk Management': 'red',
      'Financial and Lifecycle Costing': 'green',
      'Asset Information & Data Integrity': 'teal',
      'Planning & Decision Support': 'indigo',
      'Sustainability & ESG': 'emerald',
      'People, Competence & Culture': 'orange',
      'Performance Monitoring': 'cyan',
      'Digital Enablement': 'violet'
    };
    return colorMap[category] || 'gray';
  };

  const groupByCategory = (): CategorySummary[] => {
    const categories = [...new Set(kpis.map(k => k.category_name))];
    return categories.map(cat => {
      const categoryKpis = kpis.filter(k => k.category_name === cat);
      const statusCounts = categoryKpis.reduce((acc, k) => {
        acc[k.status] = (acc[k.status] || 0) + 1;
        return acc;
      }, {} as any);

      let avgStatus = 'unknown';
      if (statusCounts.red > 0) avgStatus = 'red';
      else if (statusCounts.yellow > 0) avgStatus = 'yellow';
      else if (statusCounts.green > 0) avgStatus = 'green';

      return {
        category: cat,
        icon: getCategoryIcon(cat),
        color: getCategoryColor(cat),
        kpis: categoryKpis,
        avgStatus
      };
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'green': return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'yellow': return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'red': return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default: return <Minus className="w-5 h-5 text-gray-400" />;
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'declining': return <TrendingDown className="w-4 h-4 text-red-600" />;
      default: return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'green': return 'bg-green-50 border-green-200';
      case 'yellow': return 'bg-yellow-50 border-yellow-200';
      case 'red': return 'bg-red-50 border-red-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const formatValue = (value: number | null, kpiName: string): string => {
    if (value === null) return 'N/A';

    if (kpiName.includes('%') || kpiName.includes('Percentage')) {
      return `${value.toFixed(1)}%`;
    }
    if (kpiName.includes('Cost') || kpiName.includes('Value')) {
      return `$${value.toLocaleString()}`;
    }
    if (kpiName.includes('Score') || kpiName.includes('Index')) {
      return value.toFixed(1);
    }
    return value.toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  const categorySummaries = groupByCategory();

  if (categoryView) {
    const category = categorySummaries.find(c => c.category === categoryView);
    if (!category) return null;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCategoryView(null)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowDownRight className="w-5 h-5 rotate-180" />
            Back to Overview
          </button>
          <div className="flex items-center gap-3">
            <category.icon className={`w-6 h-6 text-${category.color}-600`} />
            <h2 className="text-2xl font-bold text-gray-900">{category.category}</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {category.kpis.map((kpi) => (
            <div key={kpi.kpi_id} className={`rounded-xl border-2 p-6 ${getStatusBgColor(kpi.status)}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {getStatusIcon(kpi.status)}
                    <h3 className="text-lg font-semibold text-gray-900">{kpi.kpi_name}</h3>
                    <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded">{kpi.kpi_code}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Current</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {formatValue(kpi.latest_value, kpi.kpi_name)}
                      </p>
                    </div>
                    {kpi.target_value && (
                      <div>
                        <p className="text-sm text-gray-600">Target</p>
                        <p className="text-lg font-semibold text-gray-700">
                          {formatValue(kpi.target_value, kpi.kpi_name)}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {getTrendIcon(kpi.trend)}
                      <span className="text-sm text-gray-600 capitalize">{kpi.trend}</span>
                    </div>
                  </div>
                </div>
              </div>
              {kpi.last_updated && (
                <p className="text-xs text-gray-500">
                  Last updated: {new Date(kpi.last_updated).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-gray-600 mt-1">ISO 55000 Key Objective Indicators (KOIs)</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedPeriod('current')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedPeriod === 'current'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Current Period
          </button>
          <button
            onClick={() => setSelectedPeriod('ytd')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedPeriod === 'ytd'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Year to Date
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {categorySummaries.map((category) => (
          <button
            key={category.category}
            onClick={() => setCategoryView(category.category)}
            className={`rounded-xl border-2 p-6 text-left transition-all hover:shadow-lg ${
              getStatusBgColor(category.avgStatus)
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <category.icon className={`w-8 h-8 text-${category.color}-600`} />
              {getStatusIcon(category.avgStatus)}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{category.category}</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{category.kpis.length} KOIs</span>
              <div className="flex items-center gap-1 text-teal-600">
                <span>View Details</span>
                <ArrowUpRight className="w-4 h-4" />
              </div>
            </div>
          </button>
        ))}
      </div>

      {kpis.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border-2 border-gray-200">
          <Target className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No KPIs Available</h3>
          <p className="text-gray-600">
            KPI data will appear here once measurements are recorded.
          </p>
        </div>
      )}
    </div>
  );
}
