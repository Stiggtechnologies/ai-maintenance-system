import { useState, useEffect } from 'react';
import { AlertTriangle, Activity, Clock, Users, TrendingUp, CheckCircle, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Incident {
  id: string;
  asset_id: string;
  asset_name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'investigating' | 'mitigating' | 'resolved';
  started_at: string;
  description: string;
  assigned_to?: string;
  impact_description?: string;
  estimated_downtime_minutes?: number;
}

interface Timeline {
  id: string;
  incident_id: string;
  timestamp: string;
  event_type: string;
  description: string;
  user_name?: string;
}

export function WarRoomDashboard() {
  const [activeIncidents, setActiveIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<Timeline[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({
    totalIncidents: 0,
    avgResolutionTime: 0,
    activeResponders: 0,
    criticalCount: 0
  });

  useEffect(() => {
    loadActiveIncidents();
    loadTeamMembers();
    loadMetrics();

    const incidentSubscription = supabase
      .channel('war-room-incidents')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'assets', filter: 'status=eq.failed' },
        () => loadActiveIncidents()
      )
      .subscribe();

    return () => {
      incidentSubscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (selectedIncident) {
      loadIncidentTimeline(selectedIncident.id);
    }
  }, [selectedIncident]);

  const loadActiveIncidents = async () => {
    const { data: assets } = await supabase
      .from('assets')
      .select('*, workorders:WorkOrders(id, Title, Status, Priority)')
      .eq('Status', 'failed')
      .order('UpdatedAt', { ascending: false });

    if (assets) {
      const incidents: Incident[] = assets.map(asset => ({
        id: asset.Id,
        asset_id: asset.Id,
        asset_name: asset.Name,
        severity: determineSeverity(asset),
        status: 'active',
        started_at: asset.UpdatedAt,
        description: `Equipment failure: ${asset.Name}`,
        impact_description: asset.CriticalityLevel === 'Critical' ? 'Production stopped' : 'Performance degraded'
      }));
      setActiveIncidents(incidents);
    }
  };

  const loadTeamMembers = async () => {
    const { data } = await supabase
      .from('user_profiles')
      .select('id, display_name, role')
      .in('role', ['admin', 'manager', 'operator'])
      .limit(10);

    if (data) {
      setTeamMembers(data);
    }
  };

  const loadMetrics = async () => {
    const { data: incidents } = await supabase
      .from('assets')
      .select('Status, CriticalityLevel')
      .eq('Status', 'failed');

    const criticalCount = incidents?.filter(i => i.CriticalityLevel === 'Critical').length || 0;

    setMetrics({
      totalIncidents: incidents?.length || 0,
      avgResolutionTime: 0,
      activeResponders: teamMembers.length,
      criticalCount
    });
  };

  const loadIncidentTimeline = async (incidentId: string) => {
    const mockTimeline: Timeline[] = [
      {
        id: '1',
        incident_id: incidentId,
        timestamp: new Date().toISOString(),
        event_type: 'detected',
        description: 'Incident detected by monitoring system'
      },
      {
        id: '2',
        incident_id: incidentId,
        timestamp: new Date(Date.now() - 120000).toISOString(),
        event_type: 'assigned',
        description: 'Incident assigned to operations team',
        user_name: 'System'
      }
    ];
    setTimeline(mockTimeline);
  };

  const determineSeverity = (asset: any): 'critical' | 'high' | 'medium' | 'low' => {
    if (asset.CriticalityLevel === 'Critical') return 'critical';
    if (asset.CriticalityLevel === 'High') return 'high';
    return 'medium';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-red-500';
      case 'investigating': return 'bg-yellow-500';
      case 'mitigating': return 'bg-blue-500';
      case 'resolved': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-gradient-to-r from-red-600 to-orange-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 p-3 rounded-lg">
                <AlertTriangle className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">War Room</h1>
                <p className="text-red-100">Crisis Response & Incident Management</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-3xl font-bold text-white">{activeIncidents.length}</div>
                <div className="text-sm text-red-100">Active Incidents</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-5 h-5 text-red-400" />
              <span className="text-2xl font-bold text-white">{metrics.criticalCount}</span>
            </div>
            <div className="text-sm text-gray-400">Critical Severity</div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-yellow-400" />
              <span className="text-2xl font-bold text-white">{metrics.avgResolutionTime}m</span>
            </div>
            <div className="text-sm text-gray-400">Avg Resolution Time</div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-5 h-5 text-blue-400" />
              <span className="text-2xl font-bold text-white">{metrics.activeResponders}</span>
            </div>
            <div className="text-sm text-gray-400">Active Responders</div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              <span className="text-2xl font-bold text-white">{metrics.totalIncidents}</span>
            </div>
            <div className="text-sm text-gray-400">Total Incidents (24h)</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">Active Incidents</h2>
              </div>
              <div className="divide-y divide-gray-700">
                {activeIncidents.length === 0 ? (
                  <div className="p-8 text-center">
                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                    <p className="text-gray-400">No active incidents</p>
                  </div>
                ) : (
                  activeIncidents.map((incident) => (
                    <button
                      key={incident.id}
                      onClick={() => setSelectedIncident(incident)}
                      className={`w-full text-left p-4 hover:bg-gray-700/50 transition-colors ${
                        selectedIncident?.id === incident.id ? 'bg-gray-700' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${getStatusColor(incident.status)} animate-pulse`} />
                          <div>
                            <h3 className="font-semibold text-white">{incident.asset_name}</h3>
                            <p className="text-sm text-gray-400">{incident.description}</p>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getSeverityColor(incident.severity)}`}>
                          {incident.severity.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(incident.started_at).toLocaleTimeString()}
                        </span>
                        {incident.impact_description && (
                          <span className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            {incident.impact_description}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {selectedIncident ? (
              <>
                <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4">
                  <h2 className="text-lg font-bold text-white mb-4">Incident Details</h2>
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Asset</div>
                      <div className="text-white font-medium">{selectedIncident.asset_name}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Severity</div>
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getSeverityColor(selectedIncident.severity)}`}>
                        {selectedIncident.severity.toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Status</div>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(selectedIncident.status)}`} />
                        <span className="text-white capitalize">{selectedIncident.status}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Started</div>
                      <div className="text-white">{new Date(selectedIncident.started_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4">
                  <h2 className="text-lg font-bold text-white mb-4">Timeline</h2>
                  <div className="space-y-3">
                    {timeline.map((event) => (
                      <div key={event.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-2 h-2 bg-blue-500 rounded-full" />
                          <div className="w-px h-full bg-gray-700" />
                        </div>
                        <div className="flex-1 pb-4">
                          <div className="text-xs text-gray-400 mb-1">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </div>
                          <div className="text-sm text-white">{event.description}</div>
                          {event.user_name && (
                            <div className="text-xs text-gray-500 mt-1">by {event.user_name}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-8 text-center">
                <Activity className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">Select an incident to view details</p>
              </div>
            )}

            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4">
              <h2 className="text-lg font-bold text-white mb-4">Response Team</h2>
              <div className="space-y-2">
                {teamMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-700/50">
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {member.display_name?.charAt(0) || 'U'}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-white font-medium">{member.display_name || 'User'}</div>
                      <div className="text-xs text-gray-400 capitalize">{member.role}</div>
                    </div>
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
