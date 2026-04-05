import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft,
  Wrench,
  Clock,
  User,
  AlertTriangle,
  CheckCircle,
  Calendar,
  FileText,
} from 'lucide-react';

type TabKey = 'details' | 'tasks' | 'history';

export function WorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();

  const [workOrder, setWorkOrder] = useState<any>(null);
  const [statusHistory, setStatusHistory] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (workOrderId) {
      loadWorkOrderData(workOrderId);
    }
  }, [workOrderId]);

  const loadWorkOrderData = async (id: string) => {
    try {
      setLoading(true);
      const [woResult, historyResult, tasksResult] = await Promise.all([
        supabase
          .from('work_orders')
          .select('*, assets(name, asset_tag), sites(name)')
          .eq('id', id)
          .single(),
        supabase
          .from('work_order_status_history')
          .select('*')
          .eq('work_order_id', id)
          .order('changed_at', { ascending: false }),
        supabase
          .from('work_order_tasks')
          .select('*')
          .eq('work_order_id', id)
          .order('task_sequence'),
      ]);

      if (woResult.data) setWorkOrder(woResult.data);
      if (historyResult.data) setStatusHistory(historyResult.data);
      if (tasksResult.data) setTasks(tasksResult.data);
    } catch (error) {
      console.error('Error loading work order:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!workOrder || !workOrderId) return;
    setUpdatingStatus(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase
        .from('work_orders')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
          ...(newStatus === 'completed'
            ? { completed_at: new Date().toISOString() }
            : {}),
        })
        .eq('id', workOrderId);

      await supabase.from('work_order_status_history').insert({
        work_order_id: workOrderId,
        status_from: workOrder.status,
        status_to: newStatus,
        changed_by: user?.id,
        changed_at: new Date().toISOString(),
      });

      loadWorkOrderData(workOrderId);
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const statusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    pending: 'bg-slate-100 text-slate-700',
    in_progress: 'bg-yellow-100 text-yellow-800',
    pending_approval: 'bg-orange-100 text-orange-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-slate-100 text-slate-600',
  };

  const priorityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-slate-100 text-slate-600',
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatLabel = (str: string) =>
    str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading work order...</div>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-slate-500">Work order not found</div>
        <button
          onClick={() => navigate('/work')}
          className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          <ArrowLeft size={16} />
          Back to Work Management
        </button>
      </div>
    );
  }

  const nextStatus: Record<string, string> = {
    new: 'in_progress',
    pending: 'in_progress',
    in_progress: 'completed',
  };

  const nextStatusLabel: Record<string, string> = {
    new: 'Start Work',
    pending: 'Start Work',
    in_progress: 'Mark Completed',
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'history', label: 'Status History' },
  ];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/work')}
        className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 transition-colors font-medium text-sm"
      >
        <ArrowLeft size={16} />
        Back to Work Management
      </button>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Wrench size={20} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {workOrder.wo_number || `WO-${workOrder.id?.slice(0, 8)}`}
              </h1>
              <p className="text-slate-600 text-sm">{workOrder.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                statusColors[workOrder.status] || 'bg-slate-100 text-slate-600'
              }`}
            >
              {formatLabel(workOrder.status || 'unknown')}
            </span>
            {workOrder.priority && (
              <span
                className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                  priorityColors[workOrder.priority] ||
                  'bg-slate-100 text-slate-600'
                }`}
              >
                {formatLabel(workOrder.priority)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <InfoItem
            icon={<Wrench size={16} className="text-slate-400" />}
            label="Asset"
            value={
              workOrder.assets
                ? `${workOrder.assets.name}${workOrder.assets.asset_tag ? ` (${workOrder.assets.asset_tag})` : ''}`
                : '--'
            }
          />
          <InfoItem
            icon={<AlertTriangle size={16} className="text-slate-400" />}
            label="Site"
            value={workOrder.sites?.name || '--'}
          />
          <InfoItem
            icon={<User size={16} className="text-slate-400" />}
            label="Assigned To"
            value={workOrder.assigned_to || '--'}
          />
          <InfoItem
            icon={<Calendar size={16} className="text-slate-400" />}
            label="Created"
            value={formatDate(workOrder.created_at)}
          />
          <InfoItem
            icon={<Calendar size={16} className="text-slate-400" />}
            label="Due Date"
            value={formatDate(workOrder.due_date)}
          />
          <InfoItem
            icon={<Clock size={16} className="text-slate-400" />}
            label="Estimated Hours"
            value={
              workOrder.estimated_hours != null
                ? `${workOrder.estimated_hours}h`
                : '--'
            }
          />
          <InfoItem
            icon={<Clock size={16} className="text-slate-400" />}
            label="Actual Hours"
            value={
              workOrder.actual_hours != null
                ? `${workOrder.actual_hours}h`
                : '--'
            }
          />
        </div>
      </div>

      {/* Status Action Buttons */}
      {nextStatus[workOrder.status] && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 font-medium">
              Update Status:
            </span>
            <button
              onClick={() => updateStatus(nextStatus[workOrder.status])}
              disabled={updatingStatus}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                nextStatus[workOrder.status] === 'completed'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {updatingStatus ? 'Updating...' : nextStatusLabel[workOrder.status]}
            </button>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="border-b border-slate-200">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'details' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {workOrder.work_type && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Work Type
              </h3>
              <p className="text-slate-900">{formatLabel(workOrder.work_type)}</p>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Description
            </h3>
            <p className="text-slate-700 whitespace-pre-wrap">
              {workOrder.description || 'No description provided.'}
            </p>
          </div>
          {workOrder.closeout_notes && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Closeout Notes
              </h3>
              <p className="text-slate-700 whitespace-pre-wrap">
                {workOrder.closeout_notes}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
            <span className="ml-auto px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-medium rounded">
              {tasks.length}
            </span>
          </div>
          {tasks.length === 0 ? (
            <p className="text-slate-500 text-sm">No tasks for this work order.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg"
                >
                  <div className="mt-0.5">
                    {task.status === 'completed' ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <div className="w-4.5 h-4.5 border-2 border-slate-300 rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono">
                        #{task.task_sequence}
                      </span>
                      <span
                        className={`font-medium text-sm ${
                          task.status === 'completed'
                            ? 'text-slate-400 line-through'
                            : 'text-slate-900'
                        }`}
                      >
                        {task.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          statusColors[task.status] ||
                          'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {formatLabel(task.status || 'pending')}
                      </span>
                      {task.estimated_hours != null && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {task.estimated_hours}h est
                        </span>
                      )}
                      {task.actual_hours != null && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {task.actual_hours}h actual
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900">
              Status History
            </h2>
          </div>
          {statusHistory.length === 0 ? (
            <p className="text-slate-500 text-sm">No status changes recorded.</p>
          ) : (
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-slate-200" />
              <div className="space-y-4">
                {statusHistory.map((entry) => (
                  <div key={entry.id} className="flex gap-4 relative">
                    <div className="w-6 h-6 bg-white border-2 border-slate-300 rounded-full flex items-center justify-center z-10 mt-0.5">
                      <div className="w-2 h-2 bg-slate-400 rounded-full" />
                    </div>
                    <div className="flex-1 pb-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            statusColors[entry.status_from] ||
                            'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {formatLabel(entry.status_from || 'unknown')}
                        </span>
                        <span className="text-slate-400">-&gt;</span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            statusColors[entry.status_to] ||
                            'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {formatLabel(entry.status_to || 'unknown')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{formatDate(entry.changed_at)}</span>
                        {entry.changed_by && (
                          <span className="flex items-center gap-1">
                            <User size={12} />
                            {entry.changed_by}
                          </span>
                        )}
                      </div>
                      {entry.comments && (
                        <p className="text-sm text-slate-600 mt-1.5 bg-slate-50 rounded-lg p-2">
                          {entry.comments}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-slate-500 font-medium">{label}</div>
        <div className="text-sm text-slate-900 font-medium">{value}</div>
      </div>
    </div>
  );
}
