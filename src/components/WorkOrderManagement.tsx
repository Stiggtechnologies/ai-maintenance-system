import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Edit2, CheckCircle, X, Clock } from 'lucide-react';

interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string;
  asset_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface Asset {
  id: string;
  name: string;
}

export const WorkOrderManagement = () => {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingWorkOrder, setEditingWorkOrder] = useState<WorkOrder | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'pending',
    assigned_to: '',
    asset_id: ''
  });

  useEffect(() => {
    fetchWorkOrders();
    fetchAssets();
  }, []);

  const fetchWorkOrders = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('work_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setWorkOrders(data);
    }
    setIsLoading(false);
  };

  const fetchAssets = async () => {
    const { data, error } = await supabase
      .from('assets')
      .select('id, name');

    if (!error && data) {
      setAssets(data);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingWorkOrder) {
      const updateData: any = {
        ...formData,
        updated_at: new Date().toISOString()
      };

      if (formData.status === 'completed' && editingWorkOrder.status !== 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('work_orders')
        .update(updateData)
        .eq('id', editingWorkOrder.id);

      if (!error) {
        await fetchWorkOrders();
        closeModal();
      }
    } else {
      const { error } = await supabase
        .from('work_orders')
        .insert([formData]);

      if (!error) {
        await fetchWorkOrders();
        closeModal();
      }
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString()
    };

    if (newStatus === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('work_orders')
      .update(updateData)
      .eq('id', id);

    if (!error) {
      await fetchWorkOrders();
    }
  };

  const openModal = (workOrder?: WorkOrder) => {
    if (workOrder) {
      setEditingWorkOrder(workOrder);
      setFormData({
        title: workOrder.title,
        description: workOrder.description || '',
        priority: workOrder.priority,
        status: workOrder.status,
        assigned_to: workOrder.assigned_to || '',
        asset_id: workOrder.asset_id || ''
      });
    } else {
      setEditingWorkOrder(null);
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        status: 'pending',
        assigned_to: '',
        asset_id: ''
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingWorkOrder(null);
    setFormData({
      title: '',
      description: '',
      priority: 'medium',
      status: 'pending',
      assigned_to: '',
      asset_id: ''
    });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in-progress': return 'bg-blue-100 text-blue-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'blocked': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAssetName = (assetId: string) => {
    const asset = assets.find(a => a.id === assetId);
    return asset ? asset.name : 'N/A';
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Work Order Management</h2>
          <p className="text-gray-600">Track and manage maintenance work orders</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Create Work Order</span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading work orders...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {workOrders.map((wo) => (
            <div key={wo.id} className={`bg-white rounded-xl shadow-sm border-l-4 p-6 hover:shadow-md transition-shadow ${getPriorityColor(wo.priority)}`}>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="font-semibold text-gray-900 text-lg">{wo.title}</h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(wo.status)}`}>
                      {wo.status}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(wo.priority)}`}>
                      {wo.priority} priority
                    </span>
                  </div>

                  {wo.description && (
                    <p className="text-sm text-gray-600 mb-3">{wo.description}</p>
                  )}

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Asset:</span>
                      <span className="ml-2 font-medium text-gray-900">{getAssetName(wo.asset_id)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Assigned to:</span>
                      <span className="ml-2 font-medium text-gray-900">{wo.assigned_to || 'Unassigned'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Created:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {new Date(wo.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex space-x-2 ml-4">
                  {wo.status !== 'completed' && (
                    <button
                      onClick={() => handleStatusChange(wo.id, wo.status === 'pending' ? 'in-progress' : 'completed')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      title={wo.status === 'pending' ? 'Start Work' : 'Complete'}
                    >
                      {wo.status === 'pending' ? <Clock className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                    </button>
                  )}
                  <button
                    onClick={() => openModal(wo)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {workOrders.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border">
              <p className="text-gray-500">No work orders found. Create one to get started!</p>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">
                {editingWorkOrder ? 'Edit Work Order' : 'Create Work Order'}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="pending">Pending</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Asset</label>
                <select
                  value={formData.asset_id}
                  onChange={(e) => setFormData({ ...formData, asset_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select an asset...</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                <input
                  type="text"
                  value={formData.assigned_to}
                  onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Technician name or ID"
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingWorkOrder ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
