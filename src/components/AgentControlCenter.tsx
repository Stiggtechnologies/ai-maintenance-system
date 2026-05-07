/**
 * AgentControlCenter
 * ==================
 * DB-driven view of the 16 canonical AI agents (15 functional +
 * 1 orchestrator). Replaces the hardcoded mock array with real metrics
 * computed from `agent_runs` via the `v_agent_summary` view.
 *
 * Each card has a "Run" action that opens AgentRunModal — the modal
 * calls the ai-agent-processor Edge Function which routes the request
 * through the org's Anthropic integration (or platform fallback) and
 * persists the run to agent_runs.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Bot, Play, AlertCircle, Loader2,
  Brain, Zap, ShieldCheck, BarChart3, Cog,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AgentRunModal, type AgentLite } from './AgentRunModal';

interface AgentSummary {
  code: string;
  name: string;
  role: string;
  category: 'strategic' | 'operational' | 'quality' | 'intelligence' | 'orchestration';
  description: string | null;
  capabilities: string[];
  default_autonomy: 'manual' | 'advisory' | 'autonomous';
  preferred_model: string;
  runs_24h: number;
  successes_24h: number;
  failures_24h: number;
  avg_latency_ms_24h: number | null;
  last_run_at: string | null;
}

const CATEGORY_LABEL: Record<AgentSummary['category'], string> = {
  strategic: 'Strategic Planning',
  operational: 'Operational',
  quality: 'Quality & Compliance',
  intelligence: 'Strategic Intelligence',
  orchestration: 'Orchestration',
};

const CATEGORY_ICON: Record<AgentSummary['category'], typeof Brain> = {
  strategic: Brain,
  operational: Cog,
  quality: ShieldCheck,
  intelligence: BarChart3,
  orchestration: Zap,
};

const AUTONOMY_COLOR: Record<AgentSummary['default_autonomy'], string> = {
  manual: '#9BA7B4',
  advisory: '#3B82F6',
  autonomous: '#10B981',
};

export function AgentControlCenter() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runTarget, setRunTarget] = useState<AgentLite | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | AgentSummary['category']>('all');

  const refresh = async () => {
    setError(null);
    try {
      const { data, error } = await supabase
        .from('v_agent_summary')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setAgents((data ?? []) as AgentSummary[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (categoryFilter === 'all') return agents;
    return agents.filter(a => a.category === categoryFilter);
  }, [agents, categoryFilter]);

  const stats = useMemo(() => ({
    total: agents.length,
    runs_24h: agents.reduce((sum, a) => sum + (a.runs_24h ?? 0), 0),
    successes_24h: agents.reduce((sum, a) => sum + (a.successes_24h ?? 0), 0),
    failures_24h: agents.reduce((sum, a) => sum + (a.failures_24h ?? 0), 0),
  }), [agents]);

  const successRate = stats.runs_24h > 0
    ? Math.round((stats.successes_24h / stats.runs_24h) * 100)
    : null;

  const handleRunComplete = () => {
    setRunTarget(null);
    refresh();
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Bot className="w-8 h-8 text-blue-500" />
          Agent Control Center
        </h1>
        <p className="text-gray-400 mt-1">15 specialized AI agents + 1 orchestrator. Powered by your connected Anthropic integration.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat value={stats.total} label="Agents" color="#E6EDF3" />
        <Stat value={stats.runs_24h} label="Runs (24h)" color="#3B82F6" />
        <Stat value={stats.successes_24h} label="Succeeded" color="#10B981" />
        <Stat value={successRate !== null ? `${successRate}%` : '—'} label="Success Rate" color="#10B981" />
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {(['all', 'strategic', 'operational', 'quality', 'intelligence', 'orchestration'] as const).map(c => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${
              categoryFilter === c ? 'bg-blue-600 text-white' : 'bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]'
            }`}
          >
            {c === 'all' ? 'All categories' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-[#2A3344] rounded-lg p-12 text-center" data-testid="agents-empty">
          <Bot className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No agents registered</h3>
          <p className="text-gray-400">Run migration 014 to seed the 16 canonical agents.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(a => (
            <AgentCard key={a.code} agent={a} onRun={() => setRunTarget(toLite(a))} />
          ))}
        </div>
      )}

      {runTarget && (
        <AgentRunModal agent={runTarget} onClose={handleRunComplete} />
      )}
    </div>
  );
}

function toLite(a: AgentSummary): AgentLite {
  return {
    code: a.code,
    name: a.name,
    role: a.role,
    description: a.description,
    capabilities: a.capabilities,
    preferred_model: a.preferred_model,
  };
}

function Stat({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
      <div className="text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </div>
  );
}

function AgentCard({ agent, onRun }: { agent: AgentSummary; onRun: () => void }) {
  const Icon = CATEGORY_ICON[agent.category];
  const lastRun = agent.last_run_at ? formatRelative(agent.last_run_at) : 'Never run';

  return (
    <div
      className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 hover:border-[#3A4354] transition-all"
      data-testid={`agent-card-${agent.code}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{agent.name}</div>
            <div className="text-xs text-gray-400">{agent.role}</div>
          </div>
        </div>
        <span
          className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
          style={{ backgroundColor: `${AUTONOMY_COLOR[agent.default_autonomy]}20`, color: AUTONOMY_COLOR[agent.default_autonomy] }}
        >
          {agent.default_autonomy}
        </span>
      </div>

      {agent.description && (
        <p className="text-xs text-gray-400 mb-3 line-clamp-2">{agent.description}</p>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Metric label="Runs 24h" value={agent.runs_24h} accent="#3B82F6" />
        <Metric label="Latency" value={agent.avg_latency_ms_24h ? `${Math.round(agent.avg_latency_ms_24h)}ms` : '—'} accent="#10B981" />
        <Metric label="Last" value={lastRun} accent="#9BA7B4" />
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {agent.capabilities.slice(0, 3).map(c => (
          <span key={c} className="text-[10px] uppercase tracking-wide bg-[#161C24] text-gray-400 px-1.5 py-0.5 rounded">
            {c.replace(/_/g, ' ')}
          </span>
        ))}
        {agent.capabilities.length > 3 && (
          <span className="text-[10px] text-gray-500">+{agent.capabilities.length - 3}</span>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onRun}
          className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium text-white flex items-center justify-center gap-1"
          data-testid={`run-${agent.code}`}
        >
          <Play className="w-3 h-3" />
          Run Agent
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-[#161C24] rounded p-2 text-center">
      <div className="text-sm font-semibold" style={{ color: accent }}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default AgentControlCenter;
