// SyncAI Decision Logs
// Audit trail of all AI decisions and actions

import { useState } from 'react';
import { 
  FileText, Search, Download, Clock, Bot, 
  CheckCircle, XCircle, AlertTriangle
} from 'lucide-react';

interface DecisionLog {
  id: string;
  timestamp: Date;
  agent: string;
  action: string;
  asset?: string;
  confidence: number;
  status: 'approved' | 'executed' | 'rejected' | 'modified';
  humanOverride: boolean;
  financialImpact?: number;
  details: string;
}

const logs: DecisionLog[] = [
  { id: '1', timestamp: new Date(Date.now() - 1000 * 60 * 5), agent: 'Reliability Agent', action: 'Created Work Order WO-20435', asset: 'Pump P-145', confidence: 0.92, status: 'executed', humanOverride: false, financialImpact: 45000, details: 'Predicted bearing failure with 92% confidence. Auto-created work order for next scheduled maintenance window.' },
  { id: '2', timestamp: new Date(Date.now() - 1000 * 60 * 12), agent: 'Inventory Agent', action: 'Initiated Parts Reorder', asset: 'Bearing SKU-129', confidence: 0.98, status: 'approved', humanOverride: false, financialImpact: 12500, details: 'Stock level below threshold. Automatically approved reorder based on lead time analysis.' },
  { id: '3', timestamp: new Date(Date.now() - 1000 * 60 * 25), agent: 'Safety Agent', action: 'Escalated Safety Alert', asset: 'Conveyor C-22', confidence: 0.88, status: 'executed', humanOverride: true, financialImpact: 0, details: 'Safety sensor anomaly detected. Escalated to safety manager. Operator acknowledged.' },
  { id: '4', timestamp: new Date(Date.now() - 1000 * 60 * 45), agent: 'Planning Agent', action: 'Rescheduled Maintenance', asset: 'Haul Truck #23', confidence: 0.85, status: 'modified', humanOverride: true, financialImpact: 3500, details: 'Originally scheduled for Friday. Human operator rescheduled to Monday due to production requirements.' },
  { id: '5', timestamp: new Date(Date.now() - 1000 * 60 * 68), agent: 'Condition Monitoring Agent', action: 'Anomaly Detection', asset: 'Motor M-342', confidence: 0.76, status: 'approved', humanOverride: false, details: 'Vibration pattern abnormal. Created inspection ticket for technician review.' },
  { id: '6', timestamp: new Date(Date.now() - 1000 * 60 * 90), agent: 'Financial Agent', action: 'Budget Adjustment', confidence: 0.94, status: 'rejected', humanOverride: true, financialImpact: -25000, details: 'Proposed increasing maintenance budget by $25K. Rejected by finance director.' },
  { id: '7', timestamp: new Date(Date.now() - 1000 * 60 * 120), agent: 'Operations Agent', action: 'Technician Assignment', asset: 'Multiple', confidence: 0.91, status: 'executed', humanOverride: false, details: 'Auto-assigned 3 work orders to available technicians based on skills and location.' },
  { id: '8', timestamp: new Date(Date.now() - 1000 * 60 * 150), agent: 'Asset Management Agent', action: 'Updated Asset Criticality', asset: 'Compressor C-12', confidence: 0.89, status: 'executed', humanOverride: false, details: 'Updated criticality from medium to high based on production impact analysis.' },
];

function LogEntry({ log }: { log: DecisionLog }) {
  const statusConfig = {
    approved: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    executed: { icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    rejected: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
    modified: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10' },
  };

  const config = statusConfig[log.status];

  const formatTime = (date: Date) => {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 hover:border-[#3A4354] transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#2A3344] flex items-center justify-center">
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">{log.agent}</div>
            <div className="text-xs text-gray-400">{log.action}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs ${config.bg} ${config.color}`}>
            {log.status}
          </span>
          {log.humanOverride && (
            <span className="px-2 py-0.5 rounded text-xs bg-amber-400/10 text-amber-400">
              Override
            </span>
          )}
        </div>
      </div>

      {log.asset && (
        <div className="text-xs text-gray-400 mb-2">
          Asset: <span className="text-white">{log.asset}</span>
        </div>
      )}

      <div className="text-sm text-gray-300 mb-3">{log.details}</div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-gray-500">
            <Clock className="w-3 h-3" />
            {formatTime(log.timestamp)}
          </span>
          <span className="text-gray-500">
            Confidence: <span className="text-white">{(log.confidence * 100).toFixed(0)}%</span>
          </span>
        </div>
        {log.financialImpact !== undefined && (
          <span className={log.financialImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {log.financialImpact >= 0 ? '+' : ''}${log.financialImpact.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

export function DecisionLogs() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'executed' | 'rejected' | 'modified'>('all');
  const [agentFilter, setAgentFilter] = useState('all');

  const agents = [...new Set(logs.map(l => l.agent))];

  const filtered = logs.filter(log => {
    if (search && !log.action.toLowerCase().includes(search.toLowerCase()) && !log.agent.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && log.status !== statusFilter) return false;
    if (agentFilter !== 'all' && log.agent !== agentFilter) return false;
    return true;
  });

  const stats = {
    total: logs.length,
    executed: logs.filter(l => l.status === 'executed').length,
    approved: logs.filter(l => l.status === 'approved').length,
    overridden: logs.filter(l => l.humanOverride).length,
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <FileText className="w-8 h-8 text-blue-500" />
            Decision Logs
          </h1>
          <button className="px-4 py-2 bg-[#1A1F2E] border border-[#2A3344] rounded-lg text-sm flex items-center gap-2 hover:bg-[#2A3344]">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
        <p className="text-gray-400">Audit trail of all AI agent decisions and actions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-white">{stats.total}</div>
          <div className="text-sm text-gray-400">Total Decisions</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-blue-400">{stats.executed}</div>
          <div className="text-sm text-gray-400">Auto-Executed</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-emerald-400">{stats.approved}</div>
          <div className="text-sm text-gray-400">Approved</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
          <div className="text-3xl font-bold text-amber-400">{stats.overridden}</div>
          <div className="text-sm text-gray-400">Human Overrides</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input 
            type="text" 
            placeholder="Search decisions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1A1F2E] border border-[#2A3344] rounded-lg pl-10 pr-4 py-2 text-sm"
          />
        </div>
        
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="bg-[#1A1F2E] border border-[#2A3344] rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Agents</option>
          {agents.map(agent => (
            <option key={agent} value={agent}>{agent}</option>
          ))}
        </select>

        <div className="flex gap-2">
          {(['all', 'executed', 'approved', 'rejected', 'modified'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                statusFilter === f 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Logs List */}
      <div className="space-y-3">
        {filtered.map(log => (
          <LogEntry key={log.id} log={log} />
        ))}
      </div>
    </div>
  );
}

export default DecisionLogs;