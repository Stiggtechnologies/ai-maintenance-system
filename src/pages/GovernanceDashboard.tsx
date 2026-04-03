import { useState, useEffect } from 'react';
import { Shield, CircleCheck as CheckCircle, Circle as XCircle, Clock } from 'lucide-react';
import { governanceService } from '../services/governance';
import { platformService } from '../services/platform';

export function GovernanceDashboard() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGovernanceData();
  }, []);

  const loadGovernanceData = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) return;

      const [approvalsData, auditData] = await Promise.all([
        governanceService.getApprovals(userContext.organization_id),
        governanceService.getAuditEvents(userContext.organization_id, 50),
      ]);

      setApprovals(approvalsData);
      setAuditEvents(auditData);
    } catch (error) {
      console.error('Error loading governance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (recommendationId: string) => {
    const result = await governanceService.approveRecommendation(recommendationId, 'Approved via dashboard');
    if (result.success) {
      loadGovernanceData();
    }
  };

  const handleReject = async (recommendationId: string) => {
    const result = await governanceService.rejectRecommendation(recommendationId, 'Rejected via dashboard');
    if (result.success) {
      loadGovernanceData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading governance data...</div>
      </div>
    );
  }

  const pendingApprovals = approvals.filter(a => a.status === 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Governance & Compliance</h1>
        <p className="text-slate-600 mt-1">Approval queue and audit trail</p>
      </div>

      {/* Pending Approvals */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={20} className="text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Pending Approvals</h2>
          <span className="ml-auto px-2 py-1 bg-orange-100 text-orange-800 text-sm font-medium rounded">{pendingApprovals.length}</span>
        </div>

        <div className="space-y-3">
          {pendingApprovals.length > 0 ? (
            pendingApprovals.map((approval) => (
              <div key={approval.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-medium text-slate-900">{approval.entity_type}</div>
                    <div className="text-sm text-slate-600 mt-1">
                      Created {new Date(approval.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded">
                    {approval.status}
                  </div>
                </div>
                {approval.recommendations && (
                  <div className="text-sm text-slate-700 mb-3 p-3 bg-slate-50 rounded">
                    {approval.recommendations.recommendation_text || 'No description available'}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(approval.entity_id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700"
                  >
                    <CheckCircle size={16} />
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(approval.entity_id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700"
                  >
                    <XCircle size={16} />
                    Reject
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 py-8">No pending approvals</div>
          )}
        </div>
      </div>

      {/* Audit Trail */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} className="text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Audit Trail</h2>
        </div>

        <div className="space-y-2">
          {auditEvents.length > 0 ? (
            auditEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
                <div className="flex-1">
                  <div className="text-sm text-slate-900">
                    <span className="font-medium">{event.event_type}</span> on <span className="font-medium">{event.entity_type}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {new Date(event.event_time).toLocaleString()} • Actor: {event.actor_type}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 py-8">No audit events found</div>
          )}
        </div>
      </div>
    </div>
  );
}
