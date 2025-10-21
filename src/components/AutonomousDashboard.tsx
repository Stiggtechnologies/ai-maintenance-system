import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthProvider';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Activity,
  TrendingUp,
  Zap,
  FileCheck,
  Eye,
  ThumbsUp,
  ThumbsDown
} from 'lucide-react';

interface Decision {
  id: string;
  decision_type: string;
  decision_data: any;
  confidence_score: number;
  status: string;
  requires_approval: boolean;
  created_at: string;
  approval_deadline: string;
}

interface Alert {
  id: string;
  severity: string;
  title: string;
  description: string;
  acknowledged: boolean;
  created_at: string;
}

export function AutonomousDashboard() {
  const { profile } = useAuth();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState({
    pending_decisions: 0,
    auto_executed: 0,
    critical_alerts: 0,
    assets_monitored: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      const [decisionsRes, alertsRes, metricsRes] = await Promise.all([
        supabase
          .from('autonomous_decisions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('system_alerts')
          .select('*')
          .eq('resolved', false)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('maintenance_metrics')
          .select('*')
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);

      if (decisionsRes.data) setDecisions(decisionsRes.data);
      if (alertsRes.data) setAlerts(alertsRes.data);

      const pendingCount = decisionsRes.data?.filter(d => d.status === 'pending').length || 0;
      const autoExecutedCount = decisionsRes.data?.filter(d => d.status === 'auto_executed').length || 0;
      const criticalAlerts = alertsRes.data?.filter(a => a.severity === 'critical').length || 0;

      setStats({
        pending_decisions: pendingCount,
        auto_executed: autoExecutedCount,
        critical_alerts: criticalAlerts,
        assets_monitored: metricsRes.data?.total_assets || 0
      });

      setLoading(false);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setLoading(false);
    }
  };

  const handleDecision = async (decisionId: string, approved: boolean) => {
    try {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/autonomous-orchestrator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'process_decision',
          data: {
            decision_id: decisionId,
            approved,
            approver_id: profile?.id
          }
        })
      });

      await loadDashboardData();
    } catch (error) {
      console.error('Error processing decision:', error);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    await supabase
      .from('system_alerts')
      .update({ acknowledged: true })
      .eq('id', alertId);

    await loadDashboardData();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'approved':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'auto_executed':
        return <Zap className="w-5 h-5 text-teal-600" />;
      default:
        return <Eye className="w-5 h-5 text-gray-600" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-300 text-red-800';
      case 'high':
        return 'bg-orange-100 border-orange-300 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      default:
        return 'bg-blue-100 border-blue-300 text-blue-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  const canApprove = profile?.role === 'admin' || profile?.role === 'manager';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Autonomous Operations</h1>
          <p className="text-gray-600 mt-1">AI-powered asset management with human oversight</p>
        </div>
        <div className="flex items-center gap-2 bg-green-50 px-4 py-2 rounded-lg border border-green-200">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-green-700">System Active</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-8 h-8 text-yellow-600" />
            <span className="text-3xl font-bold text-gray-900">{stats.pending_decisions}</span>
          </div>
          <p className="text-sm font-medium text-gray-600">Pending Decisions</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-8 h-8 text-teal-600" />
            <span className="text-3xl font-bold text-gray-900">{stats.auto_executed}</span>
          </div>
          <p className="text-sm font-medium text-gray-600">Auto-Executed</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-8 h-8 text-red-600" />
            <span className="text-3xl font-bold text-gray-900">{stats.critical_alerts}</span>
          </div>
          <p className="text-sm font-medium text-gray-600">Critical Alerts</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <Activity className="w-8 h-8 text-blue-600" />
            <span className="text-3xl font-bold text-gray-900">{stats.assets_monitored}</span>
          </div>
          <p className="text-sm font-medium text-gray-600">Assets Monitored</p>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-4 rounded-lg border ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-4 h-4" />
                      <p className="font-semibold">{alert.title}</p>
                      <span className="text-xs px-2 py-0.5 bg-white rounded uppercase font-medium">
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-sm">{alert.description}</p>
                    <p className="text-xs mt-2 opacity-75">
                      {new Date(alert.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!alert.acknowledged && (
                    <button
                      onClick={() => acknowledgeAlert(alert.id)}
                      className="ml-4 px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium transition-colors"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Autonomous Decisions</h2>
          {!canApprove && (
            <span className="text-xs bg-gray-100 px-3 py-1 rounded-full text-gray-600">
              View Only - {profile?.role}
            </span>
          )}
        </div>

        <div className="space-y-3">
          {decisions.map((decision) => (
            <div
              key={decision.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-teal-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {getStatusIcon(decision.status)}
                    <div>
                      <p className="font-semibold text-gray-900">
                        {decision.decision_data.asset_name || 'Asset'} - {decision.decision_type.replace('_', ' ')}
                      </p>
                      <p className="text-sm text-gray-600">{decision.decision_data.reason}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-600 mt-3">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      <span>Confidence: {decision.confidence_score.toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileCheck className="w-4 h-4" />
                      <span className="capitalize">{decision.status.replace('_', ' ')}</span>
                    </div>
                    {decision.requires_approval && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
                        Requires Approval
                      </span>
                    )}
                  </div>
                </div>

                {decision.status === 'pending' && decision.requires_approval && canApprove && (
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleDecision(decision.id, true)}
                      className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Approve
                    </button>
                    <button
                      onClick={() => handleDecision(decision.id, false)}
                      className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {decisions.length === 0 && (
            <div className="text-center py-12">
              <FileCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No recent decisions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
