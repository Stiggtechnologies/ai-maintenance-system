import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, Clock, AlertTriangle, FileText, TrendingUp, Users } from 'lucide-react';

interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: string;
  assigned_to?: string;
  due_date?: string;
  asset_name?: string;
}

interface Decision {
  id: string;
  decision_type: string;
  rationale: string;
  confidence_score: number;
  status: string;
  created_at: string;
}

export function TacticalDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'workorders' | 'kpis'>('overview');
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  const [metrics, setMetrics] = useState({
    openWorkOrders: 0,
    highPriority: 0,
    completedToday: 0,
    pendingApprovals: 0,
    mtbf: 0,
    mttr: 0,
    plannedMaintenance: 0
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const { data: workOrdersData } = await supabase
        .from('work_orders')
        .select(`
          id,
          title,
          description,
          priority,
          status,
          due_date,
          assets (asset_name)
        `)
        .order('created_at', { ascending: false })
        .limit(20);

      const { data: decisionsData } = await supabase
        .from('autonomous_decisions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: kpiData } = await supabase
        .from('kpi_measurements')
        .select(`
          measured_value,
          kpis_kois (kpi_code)
        `)
        .in('kpis_kois.kpi_code', ['KPI-001', 'KPI-002', 'KOI-004'])
        .order('created_at', { ascending: false })
        .limit(10);

      const enrichedWorkOrders = workOrdersData?.map((wo: any) => ({
        id: wo.id,
        title: wo.title,
        description: wo.description,
        priority: wo.priority,
        status: wo.status,
        due_date: wo.due_date,
        asset_name: wo.assets?.asset_name
      })) || [];

      setWorkOrders(enrichedWorkOrders);
      setDecisions(decisionsData || []);

      const openCount = enrichedWorkOrders.filter(wo => wo.status !== 'completed').length;
      const highPriorityCount = enrichedWorkOrders.filter(wo => wo.priority === 'high' && wo.status !== 'completed').length;

      const mtbfMeasurement = kpiData?.find((m: any) => m.kpis_kois?.kpi_code === 'KPI-001');
      const mttrMeasurement = kpiData?.find((m: any) => m.kpis_kois?.kpi_code === 'KPI-002');
      const plannedMeasurement = kpiData?.find((m: any) => m.kpis_kois?.kpi_code === 'KOI-005');

      setMetrics({
        openWorkOrders: openCount,
        highPriority: highPriorityCount,
        completedToday: 0,
        pendingApprovals: decisionsData?.length || 0,
        mtbf: mtbfMeasurement?.measured_value || 0,
        mttr: mttrMeasurement?.measured_value || 0,
        plannedMaintenance: plannedMeasurement?.measured_value || 0
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-700 border-green-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const handleApproveDecision = async (decisionId: string) => {
    try {
      await supabase
        .from('autonomous_decisions')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', decisionId);

      fetchData();
    } catch (error) {
      console.error('Error approving decision:', error);
    }
  };

  const handleRejectDecision = async (decisionId: string) => {
    try {
      await supabase
        .from('autonomous_decisions')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', decisionId);

      fetchData();
    } catch (error) {
      console.error('Error rejecting decision:', error);
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Tactical Management Dashboard</h1>
          <p className="text-gray-600">Manage work orders, approvals, and team performance</p>
        </div>

        <div className="flex gap-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 font-medium transition-colors relative ${
              activeTab === 'overview'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('workorders')}
            className={`px-4 py-3 font-medium transition-colors relative ${
              activeTab === 'workorders'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Work Orders
          </button>
          <button
            onClick={() => setActiveTab('kpis')}
            className={`px-4 py-3 font-medium transition-colors relative ${
              activeTab === 'kpis'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Performance KPIs
          </button>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white rounded-xl p-5 border border-gray-200">
                <FileText className="w-8 h-8 text-teal-600 mb-2" />
                <div className="text-2xl font-bold text-gray-900">{metrics.openWorkOrders}</div>
                <div className="text-sm text-gray-600">Open Work Orders</div>
              </div>
              <div className="bg-red-50 rounded-xl p-5 border border-red-200">
                <AlertTriangle className="w-8 h-8 text-red-600 mb-2" />
                <div className="text-2xl font-bold text-red-700">{metrics.highPriority}</div>
                <div className="text-sm text-red-700">High Priority</div>
              </div>
              <div className="bg-green-50 rounded-xl p-5 border border-green-200">
                <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
                <div className="text-2xl font-bold text-green-700">{metrics.completedToday}</div>
                <div className="text-sm text-green-700">Completed Today</div>
              </div>
              <div className="bg-yellow-50 rounded-xl p-5 border border-yellow-200">
                <Clock className="w-8 h-8 text-yellow-600 mb-2" />
                <div className="text-2xl font-bold text-yellow-700">{metrics.pendingApprovals}</div>
                <div className="text-sm text-yellow-700">Pending Approvals</div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-teal-600" />
                Pending Approvals
              </h2>
              <div className="space-y-3">
                {decisions.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No pending approvals</p>
                ) : (
                  decisions.map(decision => (
                    <div key={decision.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-medium text-gray-900">{decision.decision_type}</h3>
                          <p className="text-sm text-gray-600 mt-1">{decision.rationale}</p>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-teal-50 border border-teal-200 rounded-full text-sm font-medium text-teal-700">
                          {decision.confidence_score}% confidence
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleApproveDecision(decision.id)}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectDecision(decision.id)}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                        >
                          Reject
                        </button>
                        <span className="text-xs text-gray-500 ml-auto">
                          {new Date(decision.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'workorders' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {workOrders.map(wo => (
                    <tr key={wo.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{wo.title}</div>
                        <div className="text-sm text-gray-500">{wo.description}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{wo.asset_name || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(wo.priority)}`}>
                          {wo.priority.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 capitalize">{wo.status}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {wo.due_date ? new Date(wo.due_date).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'kpis' && (
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">MTBF</h3>
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {metrics.mtbf.toFixed(0)} <span className="text-lg text-gray-500">hrs</span>
              </div>
              <div className="text-sm text-gray-600">Target: 720 hrs</div>
              <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500" style={{ width: `${Math.min((metrics.mtbf / 720) * 100, 100)}%` }}></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">MTTR</h3>
                <Clock className="w-5 h-5 text-teal-600" />
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {metrics.mttr.toFixed(1)} <span className="text-lg text-gray-500">hrs</span>
              </div>
              <div className="text-sm text-gray-600">Target: 4 hrs</div>
              <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500" style={{ width: `${Math.min((4 / metrics.mttr) * 100, 100)}%` }}></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Planned Maintenance</h3>
                <Users className="w-5 h-5 text-teal-600" />
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {metrics.plannedMaintenance.toFixed(0)}<span className="text-lg text-gray-500">%</span>
              </div>
              <div className="text-sm text-gray-600">Target: 80%</div>
              <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500" style={{ width: `${Math.min(metrics.plannedMaintenance, 100)}%` }}></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
