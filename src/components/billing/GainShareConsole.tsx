import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { TrendingUp, DollarSign, CheckCircle, Clock, FileText } from 'lucide-react';

interface GainShareRun {
  id: string;
  period_start: string;
  period_end: string;
  calculated_savings_cad: number;
  share_pct: number;
  fee_cad: number;
  status: string;
  report: any;
  created_at: string;
}

export function GainShareConsole() {
  const [runs, setRuns] = useState<GainShareRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    period_start: '',
    period_end: '',
    share_pct: 15,
  });

  useEffect(() => {
    fetchGainShareRuns();
  }, []);

  const fetchGainShareRuns = async () => {
    try {
      const { data, error } = await supabase
        .from('gainshare_runs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRuns(data || []);
    } catch (error) {
      console.error('Error fetching gain-share runs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRun = async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Get tenant_id from user profile
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (!profile) throw new Error('Profile not found');

      const response = await fetch(`${supabaseUrl}/functions/v1/billing-gainshare`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenant_id: profile.id,
          ...formData,
        }),
      });

      if (!response.ok) throw new Error('Failed to create gain-share run');

      const result = await response.json();
      alert(`Gain-share run created! Fee: $${result.fee_cad.toFixed(2)} CAD`);
      setShowCreateForm(false);
      fetchGainShareRuns();
    } catch (error) {
      console.error('Error creating gain-share run:', error);
      alert('Failed to create gain-share run');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'pending_approval':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Gain-Share Console</h1>
            <p className="text-gray-600">Performance-based billing based on operational improvements</p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            {showCreateForm ? 'Cancel' : 'New Calculation'}
          </button>
        </div>

        {/* Info Card */}
        <div className="bg-gradient-to-r from-teal-50 to-blue-50 rounded-xl border border-teal-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">How Gain-Share Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-semibold text-gray-900 mb-1">1. Baseline Metrics</div>
              <p className="text-gray-700">We establish baseline KPIs for availability, MTBF, MTTR, and costs</p>
            </div>
            <div>
              <div className="font-semibold text-gray-900 mb-1">2. Measure Improvements</div>
              <p className="text-gray-700">Calculate financial impact of performance gains over evaluation period</p>
            </div>
            <div>
              <div className="font-semibold text-gray-900 mb-1">3. Share Savings</div>
              <p className="text-gray-700">You pay 10-20% of documented savings as performance fee</p>
            </div>
          </div>
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Gain-Share Calculation</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Period Start
                </label>
                <input
                  type="date"
                  value={formData.period_start}
                  onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Period End
                </label>
                <input
                  type="date"
                  value={formData.period_end}
                  onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Share % (10-20%)
                </label>
                <input
                  type="number"
                  min="10"
                  max="20"
                  step="0.5"
                  value={formData.share_pct}
                  onChange={(e) => setFormData({ ...formData, share_pct: parseFloat(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={handleCreateRun}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
              >
                Calculate Savings
              </button>
            </div>
          </div>
        )}

        {/* Runs List */}
        {runs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <TrendingUp className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Gain-Share Calculations Yet</h2>
            <p className="text-gray-600">Create your first calculation to see performance-based fees</p>
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => (
              <div key={run.id} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {new Date(run.period_start).toLocaleDateString()} - {new Date(run.period_end).toLocaleDateString()}
                      </h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(run.status)}`}>
                        {run.status.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      Created {new Date(run.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-gray-900">
                      ${run.fee_cad.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">Performance Fee</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <DollarSign className="w-5 h-5 text-teal-600 mb-2" />
                    <div className="text-2xl font-bold text-gray-900">
                      ${run.calculated_savings_cad.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600">Total Savings</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <TrendingUp className="w-5 h-5 text-teal-600 mb-2" />
                    <div className="text-2xl font-bold text-gray-900">{run.share_pct}%</div>
                    <div className="text-xs text-gray-600">Share Percentage</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    {run.status === 'approved' ? (
                      <CheckCircle className="w-5 h-5 text-green-600 mb-2" />
                    ) : (
                      <Clock className="w-5 h-5 text-yellow-600 mb-2" />
                    )}
                    <div className="text-lg font-bold text-gray-900">
                      {run.status === 'approved' ? 'Approved' : 'Pending'}
                    </div>
                    <div className="text-xs text-gray-600">Status</div>
                  </div>
                </div>

                {run.report?.savings_breakdown && (
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3 text-sm">Savings Breakdown</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                      {Object.entries(run.report.savings_breakdown).map(([key, value]: [string, any]) => (
                        <div key={key} className="border border-gray-200 rounded-lg p-3">
                          <div className="font-medium text-gray-900 mb-1 capitalize">
                            {key.replace('_', ' ')}
                          </div>
                          <div className="text-teal-600 font-semibold">
                            ${value.savings?.toLocaleString() || 0}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Improvement: {value.improvement?.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <button className="px-4 py-2 text-teal-600 hover:text-teal-700 text-sm font-medium flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    View Report
                  </button>
                  {run.status === 'pending_approval' && (
                    <>
                      <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                        Approve
                      </button>
                      <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
