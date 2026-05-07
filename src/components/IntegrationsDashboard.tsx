/**
 * IntegrationsDashboard
 * =====================
 * DB-driven integrations management surface.
 *
 * Reads from: v_integrations_for_org (org-scoped, no credentials exposed)
 *             integration_catalog    (all available integration types)
 *
 * Wires to:   integration-connect    (POST credentials, run live test)
 *             integration-test       (re-test an existing integration)
 *             integration-disconnect (clear credentials, optionally delete)
 *
 * Anthropic and OpenAI run real round-trips against their public APIs;
 * other vendors validate credential shape and mark connected pending a
 * real adapter (status surfaced in the UI as "credential-only").
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Plug, RefreshCw, Trash2, AlertCircle, CheckCircle2, Loader2, ChevronRight, Plus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ConnectIntegrationModal, type CatalogEntry } from './ConnectIntegrationModal';

interface IntegrationView {
  id: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  health: number;
  last_sync_at: string | null;
  last_test_at: string | null;
  last_error: string | null;
  error_count: number;
  has_credentials: boolean;
  // catalog
  catalog_code: string;
  vendor: string;
  product: string;
  category: string;
  catalog_description: string | null;
  auth_type: string;
  credentials_schema: Record<string, unknown>;
  has_test_endpoint: boolean;
  docs_url: string | null;
}

const STATUS_COLOR: Record<IntegrationView['status'], string> = {
  connected: '#10B981',
  syncing: '#F59E0B',
  connecting: '#3B82F6',
  error: '#EF4444',
  disconnected: '#6B7280',
};

const STATUS_LABEL: Record<IntegrationView['status'], string> = {
  connected: 'Connected',
  syncing: 'Syncing',
  connecting: 'Connecting',
  error: 'Error',
  disconnected: 'Disconnected',
};

export function IntegrationsDashboard() {
  const [instances, setInstances] = useState<IntegrationView[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [connectTarget, setConnectTarget] = useState<CatalogEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'disconnected' | 'error'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const refresh = async () => {
    setError(null);
    try {
      const [{ data: i, error: ie }, { data: c, error: ce }] = await Promise.all([
        supabase.from('v_integrations_for_org').select('*').order('updated_at', { ascending: false }),
        supabase.from('integration_catalog').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      ]);
      if (ie) throw ie;
      if (ce) throw ce;
      setInstances((i ?? []) as IntegrationView[]);
      setCatalog((c ?? []) as CatalogEntry[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const callEdge = async (fn: 'integration-connect' | 'integration-test' | 'integration-disconnect', body: unknown) => {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
    if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL not configured');
    const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  };

  const handleTest = async (i: IntegrationView) => {
    setActionInFlight(i.id);
    try {
      await callEdge('integration-test', { integration_id: i.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setActionInFlight(null);
    }
  };

  const handleDisconnect = async (i: IntegrationView, hardDelete: boolean) => {
    if (!confirm(hardDelete ? `Delete integration "${i.name}"?` : `Disconnect "${i.name}"?`)) return;
    setActionInFlight(i.id);
    try {
      await callEdge('integration-disconnect', { integration_id: i.id, hard_delete: hardDelete });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setActionInFlight(null);
    }
  };

  const handleConnectSubmit = async (entry: CatalogEntry, name: string, credentials: Record<string, unknown>) => {
    await callEdge('integration-connect', {
      catalog_code: entry.code,
      name,
      credentials,
    });
    setConnectTarget(null);
    setShowCatalog(false);
    await refresh();
  };

  const categories = useMemo(() => {
    const set = new Set<string>(catalog.map(c => c.category).concat(instances.map(i => i.category)));
    return ['all', ...Array.from(set).sort()];
  }, [catalog, instances]);

  const visibleInstances = useMemo(() => {
    return instances.filter(i => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
      return true;
    });
  }, [instances, statusFilter, categoryFilter]);

  const stats = useMemo(() => ({
    total: instances.length,
    connected: instances.filter(i => i.status === 'connected').length,
    syncing: instances.filter(i => i.status === 'syncing').length,
    errors: instances.filter(i => i.status === 'error').length,
  }), [instances]);

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Plug className="w-8 h-8 text-blue-500" />
            Integrations
          </h1>
          <p className="text-gray-400 mt-1">Connect and manage external systems and data sources</p>
        </div>
        <button
          onClick={() => setShowCatalog(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2"
          data-testid="add-integration-btn"
        >
          <Plus className="w-4 h-4" />
          Add Integration
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Stat value={stats.total}     label="Total"     color="#E6EDF3" />
        <Stat value={stats.connected} label="Connected" color="#10B981" />
        <Stat value={stats.syncing}   label="Syncing"   color="#F59E0B" />
        <Stat value={stats.errors}    label="Errors"    color="#EF4444" />
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${
              categoryFilter === cat ? 'bg-blue-600 text-white' : 'bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]'
            }`}
          >
            {cat === 'all' ? 'All' : cat.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'connected', 'disconnected', 'error'] as const).map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm capitalize ${
              statusFilter === f ? 'bg-blue-600 text-white' : 'bg-[#1A1F2E] text-gray-400 hover:bg-[#2A3344]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      ) : visibleInstances.length === 0 ? (
        <div className="border border-dashed border-[#2A3344] rounded-lg p-12 text-center" data-testid="integrations-empty">
          <Plug className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No integrations yet</h3>
          <p className="text-gray-400 mb-4">Connect Anthropic to wire Claude into your AI agents, or pick from {catalog.length} other vendors.</p>
          <button
            onClick={() => setShowCatalog(true)}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium inline-flex items-center gap-2"
          >
            Browse catalog <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleInstances.map(i => (
            <IntegrationCard
              key={i.id}
              integration={i}
              busy={actionInFlight === i.id}
              onTest={() => handleTest(i)}
              onDisconnect={() => handleDisconnect(i, false)}
              onDelete={() => handleDisconnect(i, true)}
            />
          ))}
        </div>
      )}

      {showCatalog && (
        <CatalogPicker
          catalog={catalog}
          onClose={() => setShowCatalog(false)}
          onPick={(entry) => setConnectTarget(entry)}
        />
      )}

      {connectTarget && (
        <ConnectIntegrationModal
          entry={connectTarget}
          onClose={() => setConnectTarget(null)}
          onSubmit={handleConnectSubmit}
        />
      )}
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
      <div className="text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </div>
  );
}

interface CardProps {
  integration: IntegrationView;
  busy: boolean;
  onTest: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}

function IntegrationCard({ integration, busy, onTest, onDisconnect, onDelete }: CardProps) {
  const lastTested = integration.last_test_at
    ? `Tested ${formatRelative(integration.last_test_at)}`
    : 'Never tested';

  return (
    <div
      className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 hover:border-[#3A4354] transition-all"
      data-testid={`integration-card-${integration.catalog_code}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 rounded-lg bg-[#2A3344] flex items-center justify-center">
          <span className="text-xs font-bold text-blue-400">
            {integration.vendor.slice(0, 3).toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[integration.status] }} />
          <span className="text-xs text-gray-400">{STATUS_LABEL[integration.status]}</span>
        </div>
      </div>

      <h4 className="text-sm font-semibold text-white mb-1">{integration.name}</h4>
      <p className="text-xs text-gray-400 mb-3">{integration.vendor} · {integration.product}</p>

      {integration.last_error && (
        <div className="mb-3 p-2 bg-red-900/20 border border-red-500/20 rounded text-xs text-red-300 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span className="break-words">{integration.last_error.slice(0, 140)}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span>{lastTested}</span>
        <div className="flex items-center gap-1">
          <span className="text-emerald-400">{Math.round(integration.health)}%</span>
          {integration.has_test_endpoint && integration.status === 'connected' && (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          )}
        </div>
      </div>

      <div className="h-1.5 bg-[#2A3344] rounded-full overflow-hidden mb-3">
        <div
          className="h-full transition-all"
          style={{
            width: `${integration.health}%`,
            backgroundColor:
              integration.health >= 90 ? '#10B981' :
              integration.health >= 70 ? '#F59E0B' : '#EF4444',
          }}
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={onTest}
          disabled={busy || !integration.has_credentials}
          className="flex-1 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs text-gray-300 flex items-center justify-center gap-1"
          data-testid={`test-${integration.catalog_code}`}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Test
        </button>
        <button
          onClick={onDisconnect}
          disabled={busy || !integration.has_credentials}
          className="px-3 py-1.5 bg-[#2A3344] hover:bg-[#3A4354] disabled:opacity-40 rounded text-xs text-gray-300"
          title="Disconnect (clear credentials)"
        >
          Disconnect
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="px-3 py-1.5 bg-[#2A3344] hover:bg-red-900/30 hover:border-red-500/30 disabled:opacity-40 rounded text-red-400"
          title="Delete integration"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function CatalogPicker({
  catalog, onClose, onPick,
}: { catalog: CatalogEntry[]; onClose: () => void; onPick: (e: CatalogEntry) => void }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(c =>
      c.vendor.toLowerCase().includes(q) ||
      c.product.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  }, [catalog, query]);

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6">
      <div onClick={(e) => e.stopPropagation()} className="bg-[#0F1419] border border-[#232A33] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="p-5 border-b border-[#232A33] flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add an Integration</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5 border-b border-[#232A33]">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendors, products, or categories…"
            className="w-full bg-[#161C24] border border-[#232A33] rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(entry => (
            <button
              key={entry.code}
              onClick={() => onPick(entry)}
              className="text-left bg-[#161C24] hover:bg-[#1A1F2E] border border-[#232A33] hover:border-blue-500/30 rounded-lg p-4 transition-all"
              data-testid={`catalog-${entry.code}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-[#2A3344] flex items-center justify-center">
                    <span className="text-xs font-bold text-blue-400">
                      {entry.vendor.slice(0, 3).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{entry.product}</div>
                    <div className="text-xs text-gray-400">{entry.vendor}</div>
                  </div>
                </div>
                {entry.has_test_endpoint && (
                  <span className="text-[10px] uppercase tracking-wide bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded">
                    Live test
                  </span>
                )}
              </div>
              {entry.description && (
                <p className="text-xs text-gray-400 mt-2 line-clamp-2">{entry.description}</p>
              )}
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-2">
                {entry.category.replace(/_/g, ' ')} · {entry.auth_type.replace(/_/g, ' ')}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-gray-500 py-8">No integrations match "{query}"</div>
          )}
        </div>
      </div>
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

export default IntegrationsDashboard;
