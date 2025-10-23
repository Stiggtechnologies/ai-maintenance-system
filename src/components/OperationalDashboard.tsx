import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Wrench, AlertCircle, CheckCircle, Clock, Camera, Mic } from 'lucide-react';
import { useAuth } from './AuthProvider';

interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: string;
  asset_name?: string;
  due_date?: string;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  created_at: string;
}

export function OperationalDashboard() {
  const { } = useAuth();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);

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
        .in('status', ['pending', 'in_progress'])
        .order('priority', { ascending: false })
        .limit(10);

      const { data: alertsData } = await supabase
        .from('system_alerts')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false})
        .limit(5);

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
      setAlerts(alertsData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityIndicator = (priority: string) => {
    switch (priority) {
      case 'high':
        return <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>;
      case 'medium':
        return <div className="w-3 h-3 rounded-full bg-yellow-500"></div>;
      case 'low':
        return <div className="w-3 h-3 rounded-full bg-green-500"></div>;
      default:
        return <div className="w-3 h-3 rounded-full bg-gray-300"></div>;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-300';
      case 'warning': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'info': return 'bg-blue-100 text-blue-700 border-blue-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const handleStartTask = (workOrder: WorkOrder) => {
    setSelectedWorkOrder(workOrder);
  };

  const handleCompleteTask = async () => {
    if (!selectedWorkOrder) return;

    try {
      await supabase
        .from('work_orders')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', selectedWorkOrder.id);

      setSelectedWorkOrder(null);
      fetchData();
    } catch (error) {
      console.error('Error completing task:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (selectedWorkOrder) {
    return (
      <div className="h-full overflow-auto bg-gray-50">
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">{selectedWorkOrder.title}</h2>
              <button
                onClick={() => setSelectedWorkOrder(null)}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                Back to List
              </button>
            </div>

            <div className="mb-6">
              <div className="text-sm text-gray-500 mb-2">Asset</div>
              <div className="text-lg font-medium text-gray-900">{selectedWorkOrder.asset_name || 'N/A'}</div>
            </div>

            <div className="mb-6">
              <div className="text-sm text-gray-500 mb-2">Description</div>
              <div className="text-gray-700">{selectedWorkOrder.description}</div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="text-sm font-medium text-gray-900 mb-3">Task Checklist</div>

              <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 text-teal-600 rounded" />
                <span className="text-gray-700">Inspect equipment condition</span>
              </label>

              <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 text-teal-600 rounded" />
                <span className="text-gray-700">Check safety systems</span>
              </label>

              <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 text-teal-600 rounded" />
                <span className="text-gray-700">Perform maintenance tasks</span>
              </label>

              <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 text-teal-600 rounded" />
                <span className="text-gray-700">Document findings</span>
              </label>
            </div>

            <div className="mb-6">
              <div className="text-sm font-medium text-gray-900 mb-3">Add Documentation</div>
              <div className="flex gap-3">
                <button className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <Camera className="w-5 h-5 text-gray-600" />
                  <span className="text-sm">Add Photo</span>
                </button>
                <button className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <Mic className="w-5 h-5 text-gray-600" />
                  <span className="text-sm">Voice Note</span>
                </button>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-900 mb-2">Work Notes</label>
              <textarea
                rows={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Add any notes about the work performed..."
              />
            </div>

            <button
              onClick={handleCompleteTask}
              className="w-full bg-teal-600 text-white py-4 rounded-lg hover:bg-teal-700 transition-colors font-medium flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-5 h-5" />
              Complete Task
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Operational Dashboard</h1>
          <p className="text-gray-600">Your assigned work orders and active alerts</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl p-5 border border-gray-200">
            <Wrench className="w-8 h-8 text-teal-600 mb-2" />
            <div className="text-2xl font-bold text-gray-900">{workOrders.length}</div>
            <div className="text-sm text-gray-600">My Work Orders</div>
          </div>
          <div className="bg-red-50 rounded-xl p-5 border border-red-200">
            <AlertCircle className="w-8 h-8 text-red-600 mb-2" />
            <div className="text-2xl font-bold text-red-700">{alerts.length}</div>
            <div className="text-sm text-red-700">Active Alerts</div>
          </div>
          <div className="bg-teal-50 rounded-xl p-5 border border-teal-200">
            <Clock className="w-8 h-8 text-teal-600 mb-2" />
            <div className="text-2xl font-bold text-teal-700">
              {workOrders.filter(wo => wo.due_date && new Date(wo.due_date) <= new Date(Date.now() + 86400000)).length}
            </div>
            <div className="text-sm text-teal-700">Due Today</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-teal-600" />
            My Tasks
          </h2>
          <div className="space-y-3">
            {workOrders.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No work orders assigned</p>
            ) : (
              workOrders.map(wo => (
                <div key={wo.id} className="border border-gray-200 rounded-lg p-4 hover:border-teal-300 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="mt-1">{getPriorityIndicator(wo.priority)}</div>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900 mb-1">{wo.title}</h3>
                      <p className="text-sm text-gray-600 mb-2">{wo.description}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>{wo.asset_name || 'No asset'}</span>
                        {wo.due_date && (
                          <span>Due: {new Date(wo.due_date).toLocaleDateString()}</span>
                        )}
                        <span className="capitalize">{wo.priority} priority</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleStartTask(wo)}
                      className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm whitespace-nowrap"
                    >
                      Start Task
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              Active Alerts
            </h2>
            <div className="space-y-3">
              {alerts.map(alert => (
                <div key={alert.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityColor(alert.severity)}`}>
                          {alert.severity.toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500">{alert.alert_type}</span>
                      </div>
                      <p className="text-sm text-gray-700">{alert.message}</p>
                      <p className="text-xs text-gray-500 mt-2">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
