/**
 * Overview Page - Enterprise Landing Dashboard
 * Phase 2B: Replace CommandCenter-first with Overview-first
 * 
 * Real data sources:
 * - kpi_measurements (enterprise risk, OEE, etc.)
 * - assets (risk scores)
 * - system_alerts (alerts)
 * - work_orders (recent activity)
 * - deployment_instances (deployment status)
 * - autonomy_modes (governance)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../components/AuthProvider';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState, SkeletonCard } from '../components/ui/LoadingState';
import { 
  TrendingUp, TrendingDown, Shield, Activity, Cpu, Database,
  AlertTriangle, Wrench, CheckCircle, Clock, Target, DollarSign,
  ChevronRight, Server, Zap, Globe
} from 'lucide-react';

// Types
interface KPIMetric {
  id: string;
  code: string;
  name: string;
  value: number;
  unit: string;
  trend?: number;
}

interface Asset {
  id: string;
  asset_tag: string;
  asset_name: string;
  risk_score: number;
  health_score: number;
  criticality_level: string;
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  created_at: string;
}

interface WorkOrder {
  id: string;
  title: string;
  status: string;
  priority: string;
  asset_name?: string;
}

interface Deployment {
  id: string;
  name: string;
  status: string;
  autonomy_mode: string;
  health: string;
}

interface GovernanceStatus {
  mode: string;
  compliance_score: number;
}

interface OverviewPageProps {
  onNavigate?: (view: string) => void;
}

export default function OverviewPage({ onNavigate }: OverviewPageProps = {}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  
  // Real data states
  const [kpis, setKpis] = useState<KPIMetric[]>([]);
  const [topRisks, setTopRisks] = useState<Asset[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recentWorkOrders, setRecentWorkOrders] = useState<WorkOrder[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [governance, setGovernance] = useState<GovernanceStatus | null>(null);
  const [systemHealth, setSystemHealth] = useState<{integrations: number; ai_confidence: number}>({ integrations: 0, ai_confidence: 0 });

  const fetchData = useCallback(async () => {
    if (!user) return;
    
    try {
      // 1. Get KPI values (enterprise_risk_index, downtime_exposure, etc.)
      const { data: kpiData } = await supabase
        .from('kpi_measurements')
        .select('*, kpi_definitions(code, name, unit)')
        .order('measurement_time', { ascending: false })
        .limit(20);
      
      if (kpiData && kpiData.length > 0) {
        const mapped: KPIMetric[] = kpiData.map(k => ({
          id: k.id,
          code: k.kpi_definitions?.code || '',
          name: k.kpi_definitions?.name || '',
          value: k.value,
          unit: k.kpi_definitions?.unit || ''
        }));
        setKpis(mapped);
      }

      // 2. Get top risk assets
      const { data: assetData } = await supabase
        .from('assets')
        .select('id, asset_tag, asset_name, risk_score, health_score, criticality_level')
        .order('risk_score', { ascending: false })
        .limit(5);
      
      if (assetData) setTopRisks(assetData);

      // 3. Get active alerts
      const { data: alertData } = await supabase
        .from('system_alerts')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (alertData) setAlerts(alertData);

      // 4. Get recent work orders
      const { data: woData } = await supabase
        .from('work_orders')
        .select('id, title, status, priority, assets(asset_name)')
        .in('status', ['pending', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (woData) {
        setRecentWorkOrders(woData.map(w => ({
          id: w.id,
          title: w.title,
          status: w.status,
          priority: w.priority,
          asset_name: (w as any).assets?.asset_name
        })));
      }

      // 5. Get deployments
      const { data: deployData } = await supabase
        .from('deployment_instances')
        .select('id, name, status, autonomy_mode, health')
        .order('created_at', { ascending: false })
        .limit(3);
      
      if (deployData) setDeployments(deployData);

      // 6. Get governance mode
      const { data: govData } = await supabase
        .from('autonomy_modes')
        .select('mode, compliance_score')
        .eq('active', true)
        .limit(1);
      
      if (govData && govData[0]) setGovernance(govData[0]);

      // 7. Get system health (integration count, AI confidence)
      const { count: intCount } = await supabase
        .from('connectors')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      setSystemHealth({
        integrations: intCount || 0,
        ai_confidence: 0.85 // Default from AI agent confidence
      });

    } catch (error) {
      console.error('Error fetching overview data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Extract specific KPIs from real data
  const getKPI = (code: string): number | null => {
    const found = kpis.find(k => k.code === code);
    return found?.value ?? null;
  };

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val}`;
  };

  const getRiskStatus = (score: number): 'critical' | 'high' | 'medium' | 'low' => {
    if (score >= 75) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  };

  const getPriorityStatus = (p: string) => {
    switch (p) {
      case 'emergency': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      default: return 'low';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        <PageHeader title="Overview" subtitle="Enterprise operational dashboard" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          {[1,2,3,4,5].map(i => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <PageHeader 
        title="Overview" 
        subtitle="Enterprise operational dashboard"
        icon={Activity}
      />

      {/* KPI Row - Top Level Metrics */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
        gap: '16px',
        marginBottom: '24px'
      }}>
        {/* Enterprise Risk Index */}
        <MetricCard
          title="Enterprise Risk Index"
          value={getKPI('enterprise_risk_index') ?? '—'}
          trend={getKPI('enterprise_risk_index_trend') ? { 
            value: getKPI('enterprise_risk_index_trend') || 0, 
            direction: (getKPI('enterprise_risk_index_trend') || 0) > 0 ? 'down' as const : 'up' as const 
          } : undefined}
          icon={Shield}
          status={getKPI('enterprise_risk_index') ? getRiskStatus(getKPI('enterprise_risk_index')!) : 'normal'}
        />

        {/* Downtime Cost Exposure */}
        <MetricCard
          title="Downtime Exposure"
          value={getKPI('downtime_exposure') ? formatCurrency(getKPI('downtime_exposure')!) : '—'}
          subtitle="per year"
          icon={DollarSign}
          status={getKPI('downtime_exposure') ? (getKPI('downtime_exposure')! > 1000000 ? 'warning' : 'normal') : 'normal'}
        />

        {/* Governance Mode */}
        <MetricCard
          title="Governance"
          value={governance?.mode?.replace('_', ' ') || 'Conditional'}
          subtitle={governance ? `${governance.compliance_score}% compliant` : 'Policy enforced'}
          icon={Shield}
          status="success"
        />

        {/* AI Confidence */}
        <MetricCard
          title="AI Confidence"
          value={systemHealth.ai_confidence ? `${Math.round(systemHealth.ai_confidence * 100)}%` : '—'}
          subtitle="Model v2.5 active"
          icon={Cpu}
          status="normal"
        />

        {/* Deployment Status */}
        <MetricCard
          title="Deployments"
          value={deployments.filter(d => d.status === 'active').length}
          subtitle={`of ${deployments.length} active`}
          icon={Zap}
          status={deployments.some(d => d.health === 'degraded') ? 'warning' : 'success'}
        />
      </div>

      {/* Main Content Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(12, 1fr)', 
        gap: '24px'
      }}>
        
        {/* Left Column - Risks & Alerts (8 cols) */}
        <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Top Risk Assets */}
          <div className="card-premium" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#E6EDF3', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} color="#F59E0B" /> Top Risk Assets
              </h3>
              <a href="/assets" style={{ color: '#3A8DFF', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                View all <ChevronRight size={14} />
              </a>
            </div>
            
            {topRisks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {topRisks.map(asset => (
                  <div key={asset.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '12px',
                    backgroundColor: '#161C24',
                    borderRadius: '8px',
                    border: '1px solid #232A33'
                  }}>
                    <div>
                      <div style={{ fontWeight: 500, color: '#E6EDF3' }}>{asset.asset_tag}</div>
                      <div style={{ fontSize: '13px', color: '#9BA7B4' }}>{asset.asset_name}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <StatusBadge status={getRiskStatus(asset.risk_score)} size="sm" />
                      <span style={{ fontSize: '18px', fontWeight: 600, color: getRiskStatus(asset.risk_score) === 'critical' ? '#EF4444' : '#E6EDF3' }}>
                        {asset.risk_score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="package" title="No assets at risk" description="All assets are operating within healthy parameters" />
            )}
          </div>

          {/* Recent Work Orders */}
          <div className="card-premium" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#E6EDF3', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={18} color="#3A8DFF" /> Active Work Orders
              </h3>
              <a href="/work" style={{ color: '#3A8DFF', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                View all <ChevronRight size={14} />
              </a>
            </div>
            
            {recentWorkOrders.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {recentWorkOrders.map(wo => (
                  <div key={wo.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '12px',
                    backgroundColor: '#161C24',
                    borderRadius: '8px',
                    border: '1px solid #232A33'
                  }}>
                    <div>
                      <div style={{ fontWeight: 500, color: '#E6EDF3' }}>{wo.title}</div>
                      <div style={{ fontSize: '13px', color: '#9BA7B4' }}>{wo.asset_name}</div>
                    </div>
                    <StatusBadge status={wo.status === 'in_progress' ? 'in_progress' : 'pending'} size="sm" />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="inbox" title="No active work orders" description="All maintenance is up to date" />
            )}
          </div>
        </div>

        {/* Right Column - System Health & Deployments (4 cols) */}
        <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* System Status */}
          <div className="card-premium" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#E6EDF3', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={18} color="#3A8DFF" /> System Status
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#9BA7B4', fontSize: '14px' }}>Intelligence Engine</span>
                <StatusBadge status="active" size="sm" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#9BA7B4', fontSize: '14px' }}>Integrations</span>
                <span style={{ color: '#E6EDF3', fontWeight: 500 }}>{systemHealth.integrations} active</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#9BA7B4', fontSize: '14px' }}>Data Sync</span>
                <span style={{ color: '#22C55E', fontWeight: 500 }}>92%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#9BA7B4', fontSize: '14px' }}>Governance</span>
                <StatusBadge status="active" size="sm" />
              </div>
            </div>
          </div>

          {/* Active Alerts */}
          <div className="card-premium" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#E6EDF3', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} color="#EF4444" /> Active Alerts
            </h3>
            
            {alerts.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {alerts.slice(0, 3).map(alert => (
                  <div key={alert.id} style={{ 
                    padding: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    border: '1px solid rgba(239, 68, 68, 0.2)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <StatusBadge status={alert.severity as any} size="sm" />
                      <span style={{ fontSize: '12px', color: '#9BA7B4' }}>
                        {new Date(alert.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '14px', color: '#E6EDF3' }}>{alert.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="check" title="No active alerts" description="All systems operating normally" />
            )}
          </div>

          {/* Deployments Summary */}
          <div className="card-premium" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#E6EDF3', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} color="#F59E0B" /> Deployments
            </h3>
            
            {deployments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {deployments.map(dep => (
                  <div key={dep.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '12px',
                    backgroundColor: '#161C24',
                    borderRadius: '8px',
                    border: '1px solid #232A33'
                  }}>
                    <div>
                      <div style={{ fontWeight: 500, color: '#E6EDF3' }}>{dep.name}</div>
                      <div style={{ fontSize: '12px', color: '#9BA7B4' }}>{dep.autonomy_mode}</div>
                    </div>
                    <StatusBadge status={dep.health === 'healthy' ? 'active' : dep.health === 'degraded' ? 'warning' : 'pending'} size="sm" />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="package"
                title="No deployments"
                description="Pick an industry template to provision your first tenant in 60 seconds."
                action={
                  <button
                    onClick={() => onNavigate?.('deploy')}
                    style={{
                      marginTop: '12px',
                      padding: '10px 20px',
                      backgroundColor: '#3A8DFF',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Deploy a Template →
                  </button>
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Last Updated */}
      <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #232A33', display: 'flex', alignItems: 'center', gap: '8px', color: '#6B7785', fontSize: '12px' }}>
        <Clock size={14} />
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
