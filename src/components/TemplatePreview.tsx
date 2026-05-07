/**
 * TemplatePreview — modal that shows the contents of an industry template
 * before the user commits to deploying it.
 *
 * Reads template_config from the v_deployment_templates_public view (DB
 * source of truth) and renders the four pillars: asset classes, failure
 * modes, KPIs, and integrations. Compliance + agent priorities are
 * collapsible to keep the modal short.
 *
 * This component fixes the orphaned import in TemplateSelector.tsx.
 */
import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp, ShieldCheck, Boxes, AlertTriangle, BarChart3, Plug, Brain } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AssetClass {
  code: string;
  name: string;
  iso55000_class?: string;
  criticality_default?: string;
}

interface FailureMode {
  code: string;
  asset_class: string;
  name: string;
  fmea_severity?: number;
  detection_method?: string;
}

interface Kpi {
  code: string;
  name: string;
  iso55000?: boolean;
  unit?: string;
}

interface Integration {
  vendor: string;
  product: string;
  category: string;
  status: 'core' | 'recommended' | 'supported' | 'optional';
}

interface AgentPriority {
  agent: string;
  weight: number;
}

interface TemplateConfig {
  asset_classes?: AssetClass[];
  failure_modes?: FailureMode[];
  kpis_kois?: Kpi[];
  integrations?: Integration[];
  compliance?: string[];
  agent_priorities?: AgentPriority[];
  default_dashboards?: string[];
  default_governance?: string;
  oee_model?: string;
  inherits_from?: string;
  summary_metrics?: { kpi_count: number; asset_class_count: number; failure_mode_count: number; scaffold?: boolean };
}

interface TemplateLite {
  code: string;
  name: string;
  industry: string;
}

interface Props {
  template: TemplateLite;
  onClose: () => void;
  onSelect: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  core:        '#10B981',
  recommended: '#3A8DFF',
  supported:   '#9BA7B4',
  optional:    '#6B7280',
};

export function TemplatePreview({ template, onClose, onSelect }: Props) {
  const [config, setConfig] = useState<TemplateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCompliance, setShowCompliance] = useState(false);
  const [showAgents, setShowAgents] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('v_deployment_templates_public')
          .select('template_config')
          .eq('code', template.code)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        setConfig((data?.template_config as TemplateConfig) ?? {});
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load template');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [template.code]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#0F1419',
          border: '1px solid #232A33',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '900px',
          maxHeight: '90vh',
          overflowY: 'auto',
          color: '#E6EDF3',
        }}
      >
        {/* Header */}
        <div style={{ padding: '24px', borderBottom: '1px solid #232A33', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#9BA7B4', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
              Industry Template
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>{template.name}</h2>
            <span style={{ fontSize: '13px', color: '#9BA7B4' }}>{template.industry}</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#9BA7B4', cursor: 'pointer', padding: '4px' }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {loading && <p style={{ color: '#9BA7B4' }}>Loading template…</p>}
          {error && <p style={{ color: '#EF4444' }}>Error: {error}</p>}

          {!loading && !error && config && (
            <>
              {config.summary_metrics?.scaffold && (
                <div style={{
                  backgroundColor: '#3A8DFF15',
                  border: '1px solid #3A8DFF40',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '20px',
                  fontSize: '13px',
                  color: '#9BC9FF',
                }}>
                  This template is scaffolded and inherits defaults from <strong>{config.inherits_from ?? 'oil-and-gas'}</strong>. Asset classes, failure modes, and KPIs will be filled in during deployment from the inheritance source.
                </div>
              )}

              {/* Pillars */}
              <Pillar icon={Boxes}        title="Asset Classes" count={config.asset_classes?.length ?? 0} accent="#3A8DFF">
                {(config.asset_classes ?? []).slice(0, 12).map(c => (
                  <Chip key={c.code} label={c.name} suffix={c.criticality_default ? `crit ${c.criticality_default}` : undefined} />
                ))}
                {(config.asset_classes?.length ?? 0) > 12 && (
                  <span style={{ fontSize: '12px', color: '#9BA7B4' }}>+{(config.asset_classes!.length - 12)} more</span>
                )}
              </Pillar>

              <Pillar icon={AlertTriangle} title="Failure Modes" count={config.failure_modes?.length ?? 0} accent="#F59E0B">
                {(config.failure_modes ?? []).slice(0, 8).map(f => (
                  <Chip key={f.code} label={f.name} suffix={f.fmea_severity ? `S=${f.fmea_severity}` : undefined} />
                ))}
                {(config.failure_modes?.length ?? 0) > 8 && (
                  <span style={{ fontSize: '12px', color: '#9BA7B4' }}>+{(config.failure_modes!.length - 8)} more</span>
                )}
              </Pillar>

              <Pillar icon={BarChart3} title="KPIs / KOIs (ISO 55000)" count={config.kpis_kois?.length ?? 0} accent="#10B981">
                {(config.kpis_kois ?? []).map(k => (
                  <Chip key={k.code} label={k.name} suffix={k.unit} />
                ))}
              </Pillar>

              <Pillar icon={Plug} title="Integrations" count={config.integrations?.length ?? 0} accent="#A855F7">
                {(config.integrations ?? []).map(i => (
                  <Chip
                    key={`${i.vendor}-${i.product}`}
                    label={`${i.vendor} · ${i.product}`}
                    suffix={i.status}
                    suffixColor={STATUS_COLORS[i.status]}
                  />
                ))}
              </Pillar>

              {/* Collapsibles */}
              <Collapsible
                icon={ShieldCheck}
                title="Compliance Frameworks"
                count={config.compliance?.length ?? 0}
                expanded={showCompliance}
                onToggle={() => setShowCompliance(!showCompliance)}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {(config.compliance ?? []).map(c => (
                    <span key={c} style={{ fontSize: '12px', backgroundColor: '#161C24', padding: '4px 8px', borderRadius: '4px', color: '#E6EDF3' }}>
                      {c.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </Collapsible>

              <Collapsible
                icon={Brain}
                title="15-Agent Priority Weights"
                count={config.agent_priorities?.length ?? 0}
                expanded={showAgents}
                onToggle={() => setShowAgents(!showAgents)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                  {(config.agent_priorities ?? []).map(a => (
                    <div key={a.agent} style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161C24', padding: '8px 12px', borderRadius: '6px' }}>
                      <span>{a.agent.replace(/_/g, ' ')}</span>
                      <span style={{ color: '#3A8DFF', fontWeight: 600 }}>{a.weight.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </Collapsible>

              {/* Defaults summary */}
              <div style={{ marginTop: '20px', padding: '12px 16px', backgroundColor: '#161C24', borderRadius: '8px', fontSize: '13px', color: '#9BA7B4' }}>
                Default governance: <strong style={{ color: '#E6EDF3' }}>{config.default_governance ?? 'advisory'}</strong> ·
                OEE model: <strong style={{ color: '#E6EDF3' }}>{config.oee_model ?? 'availability-performance-quality'}</strong> ·
                Dashboards: <strong style={{ color: '#E6EDF3' }}>{(config.default_dashboards ?? []).join(', ')}</strong>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '20px 24px', borderTop: '1px solid #232A33', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: 'transparent',
              border: '1px solid #232A33',
              borderRadius: '8px',
              color: '#E6EDF3',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSelect}
            disabled={loading}
            style={{
              padding: '10px 20px',
              backgroundColor: loading ? '#3A8DFF80' : '#3A8DFF',
              border: 'none',
              borderRadius: '8px',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Deploy this template →
          </button>
        </div>
      </div>
    </div>
  );
}

function Pillar({
  icon: Icon, title, count, accent, children,
}: { icon: any; title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <Icon size={16} color={accent} />
        <span style={{ fontSize: '14px', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: '12px', color: '#9BA7B4' }}>· {count}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{children}</div>
    </div>
  );
}

function Chip({ label, suffix, suffixColor }: { label: string; suffix?: string; suffixColor?: string }) {
  return (
    <span style={{
      fontSize: '12px',
      backgroundColor: '#161C24',
      padding: '4px 10px',
      borderRadius: '4px',
      color: '#E6EDF3',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
    }}>
      {label}
      {suffix && (
        <span style={{ fontSize: '10px', color: suffixColor ?? '#9BA7B4', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          · {suffix}
        </span>
      )}
    </span>
  );
}

function Collapsible({
  icon: Icon, title, count, expanded, onToggle, children,
}: { icon: any; title: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px', border: '1px solid #232A33', borderRadius: '8px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          color: '#E6EDF3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon size={16} />
          <span style={{ fontSize: '14px', fontWeight: 500 }}>{title}</span>
          <span style={{ fontSize: '12px', color: '#9BA7B4' }}>· {count}</span>
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  );
}

export default TemplatePreview;
