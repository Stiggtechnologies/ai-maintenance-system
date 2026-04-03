// SyncAI Agent Control Center
// AI Agent Monitoring and Management Interface

import { useState } from 'react';
import { 
  Bot, Play, Settings, Activity, MessageSquare
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle' | 'error' | 'disabled';
  autonomyLevel: 'manual' | 'advisory' | 'autonomous';
  tasksToday: number;
  insightsGenerated: number;
  avgResponseTime: number;
  lastActivity: string;
  capabilities: string[];
}

const agents: Agent[] = [
  {
    id: '1', name: 'Maintenance Strategy Agent', role: 'Strategy Development',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 12, insightsGenerated: 8,
    avgResponseTime: 2.3, lastActivity: '2 min ago',
    capabilities: ['Strategy development', 'Policy generation', 'Best practice identification']
  },
  {
    id: '2', name: 'Asset Management Agent', role: 'Asset Lifecycle',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 34, insightsGenerated: 21,
    avgResponseTime: 1.1, lastActivity: '30 sec ago',
    capabilities: ['Criticality analysis', 'Life cycle optimization', 'Depreciation tracking']
  },
  {
    id: '3', name: 'Reliability Engineering Agent', role: 'Predictive Analytics',
    status: 'active', autonomyLevel: 'advisory', tasksToday: 89, insightsGenerated: 56,
    avgResponseTime: 0.8, lastActivity: '10 sec ago',
    capabilities: ['Failure prediction', 'Root cause analysis', 'Pattern detection']
  },
  {
    id: '4', name: 'Planning & Scheduling Agent', role: 'Work Order Optimization',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 45, insightsGenerated: 32,
    avgResponseTime: 1.5, lastActivity: '1 min ago',
    capabilities: ['Schedule optimization', 'Resource allocation', 'Backlog management']
  },
  {
    id: '5', name: 'Work Order Agent', role: 'Execution Management',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 67, insightsGenerated: 43,
    avgResponseTime: 0.9, lastActivity: '45 sec ago',
    capabilities: ['WO creation', 'Task assignment', 'Status tracking']
  },
  {
    id: '6', name: 'Condition Monitoring Agent', role: 'Real-time Analytics',
    status: 'active', autonomyLevel: 'advisory', tasksToday: 234, insightsGenerated: 89,
    avgResponseTime: 0.2, lastActivity: '5 sec ago',
    capabilities: ['Anomaly detection', 'Threshold monitoring', 'Trend analysis']
  },
  {
    id: '7', name: 'Inventory Agent', role: 'Spare Parts Management',
    status: 'idle', autonomyLevel: 'autonomous', tasksToday: 8, insightsGenerated: 12,
    avgResponseTime: 3.2, lastActivity: '45 min ago',
    capabilities: ['Reorder suggestions', 'Inventory optimization', 'Lead time tracking']
  },
  {
    id: '8', name: 'Operations Agent', role: 'Day-to-Day Management',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 156, insightsGenerated: 78,
    avgResponseTime: 0.5, lastActivity: '15 sec ago',
    capabilities: ['Task orchestration', 'Resource coordination', 'Escalation handling']
  },
  {
    id: '9', name: 'Quality Assurance Agent', role: 'Compliance & Standards',
    status: 'active', autonomyLevel: 'advisory', tasksToday: 23, insightsGenerated: 15,
    avgResponseTime: 2.1, lastActivity: '5 min ago',
    capabilities: ['Audit prep', 'Compliance checking', 'Documentation review']
  },
  {
    id: '10', name: 'Sustainability Agent', role: 'ESG Monitoring',
    status: 'active', autonomyLevel: 'advisory', tasksToday: 12, insightsGenerated: 7,
    avgResponseTime: 4.5, lastActivity: '10 min ago',
    capabilities: ['Carbon tracking', 'Energy optimization', 'Sustainability reporting']
  },
  {
    id: '11', name: 'Financial Intelligence Agent', role: 'Cost Optimization',
    status: 'active', autonomyLevel: 'advisory', tasksToday: 18, insightsGenerated: 11,
    avgResponseTime: 2.8, lastActivity: '8 min ago',
    capabilities: ['Cost analysis', 'Budget forecasting', 'ROI calculation']
  },
  {
    id: '12', name: 'Safety Agent', role: 'Risk Management',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 34, insightsGenerated: 22,
    avgResponseTime: 0.6, lastActivity: '2 min ago',
    capabilities: ['Risk assessment', 'Incident prediction', 'Safety alerts']
  },
  {
    id: '13', name: 'Procurement Agent', role: 'Vendor Management',
    status: 'idle', autonomyLevel: 'advisory', tasksToday: 5, insightsGenerated: 8,
    avgResponseTime: 5.2, lastActivity: '2 hours ago',
    capabilities: ['Vendor selection', 'Price negotiation', 'Contract management']
  },
  {
    id: '14', name: 'Training Agent', role: 'Skill Development',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 15, insightsGenerated: 9,
    avgResponseTime: 1.8, lastActivity: '12 min ago',
    capabilities: ['Skill assessment', 'Training recommendations', 'Certification tracking']
  },
  {
    id: '15', name: 'Central Coordination Agent', role: 'Cross-System Integration',
    status: 'active', autonomyLevel: 'autonomous', tasksToday: 78, insightsGenerated: 45,
    avgResponseTime: 0.4, lastActivity: '20 sec ago',
    capabilities: ['Multi-agent coordination', 'Cross-system insights', 'Escalation management']
  },
];

function AgentCard({ agent }: { agent: Agent }) {
  const statusColors = {
    active: 'bg-emerald-500',
    idle: 'bg-gray-500', 
    error: 'bg-red-500',
    disabled: 'bg-amber-500'
  };

  const autonomyColors = {
    manual: 'text-gray-400',
    advisory: 'text-amber-400',
    autonomous: 'text-emerald-400'
  };

  return (
    <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 hover:border-[#3A4354] transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2A3344] flex items-center justify-center">
            <Bot className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">{agent.name}</h4>
            <p className="text-xs text-gray-400">{agent.role}</p>
          </div>
        </div>
        <span className={`w-2.5 h-2.5 rounded-full ${statusColors[agent.status]}`} />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs px-2 py-0.5 rounded ${autonomyColors[agent.autonomyLevel]} bg-[#2A3344]`}>
          {agent.autonomyLevel.toUpperCase()}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="bg-[#11161D] rounded p-2 text-center">
          <div className="text-lg font-bold text-white">{agent.tasksToday}</div>
          <div className="text-gray-500">Tasks</div>
        </div>
        <div className="bg-[#11161D] rounded p-2 text-center">
          <div className="text-lg font-bold text-blue-400">{agent.insightsGenerated}</div>
          <div className="text-gray-500">Insights</div>
        </div>
        <div className="bg-[#11161D] rounded p-2 text-center">
          <div className="text-lg font-bold text-amber-400">{agent.avgResponseTime}s</div>
          <div className="text-gray-500">Avg Time</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span>Last: {agent.lastActivity}</span>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] rounded text-xs text-gray-300 flex items-center justify-center gap-1">
          <MessageSquare className="w-3 h-3" />
          View
        </button>
        <button className="flex-1 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] rounded text-xs text-gray-300 flex items-center justify-center gap-1">
          <Activity className="w-3 h-3" />
          Metrics
        </button>
        <button className="px-2 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] rounded text-gray-300">
          <Settings className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function AgentControlCenter() {
  const [filter, setFilter] = useState<'all' | 'active' | 'idle' | 'error'>('all');
  const [search, setSearch] = useState('');

  const filteredAgents = agents.filter(agent => {
    if (filter !== 'all' && agent.status !== filter) return false;
    if (search && !agent.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: agents.length,
    active: agents.filter(a => a.status === 'active').length,
    tasksToday: agents.reduce((acc, a) => acc + a.tasksToday, 0),
    insightsToday: agents.reduce((acc, a) => acc + a.insightsGenerated, 0)
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Bot className="w-8 h-8 text-blue-500" />
            AI Agent Control Center
          </h1>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2">
            <Play className="w-4 h-4" />
            Trigger Agent
          </button>
        </div>
        <p className="text-gray-400">Monitor and manage all 15 AI agents</p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#1A1F2E] rounded-lg p-4 border border-[#2A3344]">
          <div className="text-3xl font-bold text-white">{stats.total}</div>
          <div className="text-sm text-gray-400">Total Agents</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg p-4 border border-[#2A3344]">
          <div className="text-3xl font-bold text-emerald-400">{stats.active}</div>
          <div className="text-sm text-gray-400">Active Now</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg p-4 border border-[#2A3344]">
          <div className="text-3xl font-bold text-blue-400">{stats.tasksToday}</div>
          <div className="text-sm text-gray-400">Tasks Today</div>
        </div>
        <div className="bg-[#1A1F2E] rounded-lg p-4 border border-[#2A3344]">
          <div className="text-3xl font-bold text-amber-400">{stats.insightsToday}</div>
          <div className="text-sm text-gray-400">Insights Today</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Bot className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input 
            type="text" 
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1A1F2E] border border-[#2A3344] rounded-lg pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'active', 'idle', 'error'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                filter === f 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-3 gap-4">
        {filteredAgents.map(agent => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}

export default AgentControlCenter;