/**
 * AgentRunModal
 * =============
 * Opens an agent for a one-off invocation. User types a query (with
 * optional industry context), submits, and watches the response stream
 * back from the ai-agent-processor Edge Function. The run is persisted
 * to agent_runs and shows up in v_agent_summary on next dashboard load.
 */
import { useState } from 'react';
import { X, Sparkles, Loader2, Zap, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface AgentLite {
  code: string;
  name: string;
  role: string;
  description: string | null;
  capabilities: string[];
  preferred_model: string;
}

interface RunResponse {
  ok: boolean;
  run_id?: string;
  response?: string;
  model_used?: string;
  provider?: 'anthropic' | 'openai';
  latency_ms?: number;
  error?: string;
}

interface Props {
  agent: AgentLite;
  defaultIndustry?: string;
  onClose: () => void;
}

const SUGGESTED_QUERIES: Record<string, string[]> = {
  maintenance_strategy: [
    'What PM/PdM mix would you recommend for a 50-MW gas turbine fleet?',
    'Compare time-based vs condition-based strategy for centrifugal pumps.',
  ],
  asset_management: [
    'Build a criticality matrix for an offshore production platform.',
    'How should I prioritize asset replacement on aging transmission lines?',
  ],
  reliability_engineering: [
    'I have repeated bearing failures on a centrifugal compressor. Walk me through an RCA.',
    'Estimate Weibull parameters from these 8 failure intervals: 412, 510, 380, 622, 491, 350, 580, 540 hours.',
  ],
  condition_monitoring: [
    'Vibration on Pump P-201 jumped from 2.1 to 4.8 mm/s overnight. What does that tell me?',
    'How should I set CBM thresholds for a refinery fired heater?',
  ],
  compliance_auditing: [
    'What documentation do I need for an API 580 RBI program audit?',
    'Build a 12-month FDA 21 CFR Part 11 audit-readiness calendar.',
  ],
  sustainability_esg: [
    'Identify the top 3 emissions reduction opportunities for a paper mill.',
    'Build an ISO 50001 energy-efficiency baseline framework.',
  ],
};

export function AgentRunModal({ agent, defaultIndustry, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState(defaultIndustry ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggestions = SUGGESTED_QUERIES[agent.code] ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = (import.meta as any).env?.VITE_SUPABASE_URL;
      if (!url) throw new Error('VITE_SUPABASE_URL not configured');

      const res = await fetch(`${url}/functions/v1/ai-agent-processor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          agent_code: agent.code,
          query: query.trim(),
          industry: industry.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as RunResponse;
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0F1419] border border-[#232A33] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        data-testid="agent-run-modal"
      >
        <div className="p-5 border-b border-[#232A33] flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-0.5">{agent.role}</div>
              <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
              {agent.description && <p className="text-sm text-gray-400 mt-1 max-w-md">{agent.description}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Industry context (optional)</label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. oil & gas, mining, pharmaceuticals"
                className="w-full bg-[#161C24] border border-[#232A33] rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Your query</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What would you like the agent to analyze, recommend, or generate?"
                rows={4}
                className="w-full bg-[#161C24] border border-[#232A33] rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                required
                data-testid="agent-query-input"
              />
            </div>

            {suggestions.length > 0 && !result && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Suggested queries:</div>
                <div className="flex flex-col gap-1.5">
                  {suggestions.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setQuery(s)}
                      className="text-left text-xs text-gray-400 hover:text-blue-400 px-3 py-2 bg-[#161C24] hover:bg-[#1A1F2E] border border-[#232A33] rounded transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {agent.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {agent.capabilities.slice(0, 6).map(c => (
                  <span key={c} className="text-[10px] uppercase tracking-wide bg-[#161C24] text-gray-400 px-2 py-1 rounded">
                    {c.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="px-5 pb-3">
              <div className="p-3 bg-red-900/30 border border-red-500/30 rounded text-red-300 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {result && result.response && (
            <div className="px-5 pb-3">
              <div className="bg-[#0B0E14] border border-[#232A33] rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Zap className="w-3 h-3" />
                    {result.provider} · {result.model_used}
                  </span>
                  <span>{result.latency_ms}ms</span>
                  {result.run_id && <span className="text-gray-600">run {result.run_id.slice(0, 8)}</span>}
                </div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed" data-testid="agent-response">
                  {result.response}
                </div>
              </div>
            </div>
          )}

          <div className="p-5 border-t border-[#232A33] flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">Powered by {agent.preferred_model}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">
                {result ? 'Close' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={!query.trim() || submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium text-white inline-flex items-center gap-2"
                data-testid="agent-run-submit"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {submitting ? 'Running…' : 'Run Agent'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AgentRunModal;
