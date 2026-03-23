import { supabase } from '../lib/supabase';

export interface KPI {
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

export interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  asset_id: string;
  assigned_to: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  status: string;
  location: string;
  criticality: string;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  severity: string;
  title: string;
  description: string;
  alert_type: string;
  target_users: string[];
  acknowledged: boolean;
  resolved: boolean;
  created_at: string;
  resolved_at?: string;
}

export interface Decision {
  id: string;
  decision_type: string;
  decision_data: any;
  confidence_score: number;
  status: string;
  requires_approval: boolean;
  created_at: string;
  executed_at?: string;
  approval_deadline?: string;
}

export async function getExecutiveKPIs(): Promise<KPI[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('user_kpi_dashboard')
    .select('*')
    .eq('user_id', user.id)
    .eq('kpi_type', 'KOI')
    .order('category_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getTacticalKPIs(): Promise<KPI[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('user_kpi_dashboard')
    .select('*')
    .eq('user_id', user.id)
    .eq('kpi_type', 'KPI')
    .order('category_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getWorkOrders(filters?: {
  status?: string;
  priority?: string;
  assigned_to?: string;
  limit?: number;
}): Promise<WorkOrder[]> {
  let query = supabase
    .from('work_orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.priority) {
    query = query.eq('priority', filters.priority);
  }

  if (filters?.assigned_to) {
    query = query.eq('assigned_to', filters.assigned_to);
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function getAssets(filters?: {
  status?: string;
  criticality?: string;
  limit?: number;
}): Promise<Asset[]> {
  let query = supabase
    .from('assets')
    .select('*')
    .order('name', { ascending: true });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.criticality) {
    query = query.eq('criticality', filters.criticality);
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function getAlerts(filters?: {
  severity?: string;
  resolved?: boolean;
  limit?: number;
}): Promise<Alert[]> {
  let query = supabase
    .from('system_alerts')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.severity) {
    query = query.eq('severity', filters.severity);
  }

  if (filters?.resolved !== undefined) {
    query = query.eq('resolved', filters.resolved);
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function getPendingDecisions(limit: number = 10): Promise<Decision[]> {
  const { data, error } = await supabase
    .from('autonomous_decisions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getAssetHealthMetrics() {
  const { data, error } = await supabase
    .from('asset_health_monitoring')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return data || [];
}

export async function getMaintenanceMetrics() {
  const { data, error } = await supabase
    .from('maintenance_metrics')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data;
}

export async function getKPIMeasurements(kpiId: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('kpi_measurements')
    .select('*')
    .eq('kpi_id', kpiId)
    .gte('measurement_date', startDate.toISOString())
    .order('measurement_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getWorkOrderStats() {
  const { data: all } = await supabase
    .from('work_orders')
    .select('id, status, priority, created_at');

  if (!all) return null;

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

  return {
    total: all.length,
    pending: all.filter(wo => wo.status === 'pending').length,
    in_progress: all.filter(wo => wo.status === 'in_progress').length,
    completed: all.filter(wo => wo.status === 'completed').length,
    high_priority: all.filter(wo => wo.priority === 'high' || wo.priority === 'critical').length,
    recent: all.filter(wo => new Date(wo.created_at) > lastMonth).length,
  };
}

export async function getAssetStats() {
  const { data: all } = await supabase
    .from('assets')
    .select('id, status, criticality');

  if (!all) return null;

  return {
    total: all.length,
    operational: all.filter(a => a.status === 'operational').length,
    degraded: all.filter(a => a.status === 'degraded').length,
    failed: all.filter(a => a.status === 'failed').length,
    maintenance: all.filter(a => a.status === 'maintenance').length,
    critical: all.filter(a => a.criticality === 'critical' || a.criticality === 'high').length,
  };
}

export async function getAlertStats() {
  const { data: all } = await supabase
    .from('system_alerts')
    .select('id, severity, acknowledged, resolved, created_at');

  if (!all) return null;

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return {
    total: all.length,
    critical: all.filter(a => a.severity === 'critical' && !a.resolved).length,
    high: all.filter(a => a.severity === 'high' && !a.resolved).length,
    unresolved: all.filter(a => !a.resolved).length,
    unacknowledged: all.filter(a => !a.acknowledged && !a.resolved).length,
    recent: all.filter(a => new Date(a.created_at) > last24h).length,
  };
}

export async function getAutonomousDecisionStats() {
  const { data: all } = await supabase
    .from('autonomous_decisions')
    .select('id, status, confidence_score, created_at');

  if (!all) return null;

  const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return {
    total: all.length,
    pending: all.filter(d => d.status === 'pending').length,
    approved: all.filter(d => d.status === 'approved').length,
    auto_executed: all.filter(d => d.status === 'auto_executed').length,
    rejected: all.filter(d => d.status === 'rejected').length,
    high_confidence: all.filter(d => d.confidence_score >= 90).length,
    recent: all.filter(d => new Date(d.created_at) > last7days).length,
  };
}

export async function createWorkOrder(data: {
  title: string;
  description: string;
  priority: string;
  asset_id?: string;
  assigned_to?: string;
  due_date?: string;
}) {
  const { data: workOrder, error } = await supabase
    .from('work_orders')
    .insert({
      ...data,
      status: 'pending'
    })
    .select()
    .single();

  if (error) throw error;

  await supabase.rpc('broadcast_to_channel', {
    p_channel_name: 'workorders.updates',
    p_message_type: 'work_order_created',
    p_payload: { work_order_id: workOrder.id, title: data.title },
    p_priority: data.priority === 'critical' || data.priority === 'high' ? 'high' : 'normal'
  });

  return workOrder;
}

export async function updateWorkOrderStatus(id: string, status: string) {
  const { data, error } = await supabase
    .from('work_orders')
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {})
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  await supabase.rpc('broadcast_to_channel', {
    p_channel_name: 'workorders.updates',
    p_message_type: 'work_order_status_changed',
    p_payload: { work_order_id: id, new_status: status },
    p_priority: 'normal'
  });

  return data;
}

export async function acknowledgeAlert(id: string) {
  const { data, error } = await supabase
    .from('system_alerts')
    .update({ acknowledged: true })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function resolveAlert(id: string) {
  const { data, error } = await supabase
    .from('system_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
