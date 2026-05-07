/**
 * TemplateSelector — DB-driven industry template chooser.
 *
 * Reads from v_deployment_templates_public (added in migration 012) so
 * adding a new industry doesn't require a frontend change. Wires the
 * "Deploy" button to the deploy-tenant Edge Function for end-to-end
 * single-command provisioning.
 *
 * Migration 012 ships 13 templates: oil-and-gas, data-centers, pharma
 * (fully fleshed) + 10 scaffolded (mining, utilities, manufacturing,
 * chemicals, pulp/paper, aerospace, pipelines, rail/marine/aviation,
 * equipment-rental, multi-site).
 */
import { useEffect, useState } from 'react';
import { Factory, ChevronRight, Eye, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import { StatusBadge } from './ui/StatusBadge';
import { EmptyState } from './ui/EmptyState';
import { TemplatePreview } from './TemplatePreview';
import { supabase } from '../lib/supabase';

interface Template {
  id: string;
  code: string;
  slug: string;
  name: string;
  industry: string;
  category: string | null;
  hero_summary: string | null;
  recommended_pricing_tier: string | null;
  governance: 'advisory' | 'conditional' | 'autonomous';
  kpi_count: number;
  asset_class_count: number;
  failure_mode_count: number;
  oee_model: string;
  is_scaffold: boolean;
}

interface DeployResult {
  ok: boolean;
  deployment_instance_id?: string;
  error?: string;
}

interface Props {
  onComplete?: (result: DeployResult & { template: Template }) => void;
}

export function TemplateSelector({ onComplete }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [deployingCode, setDeployingCode] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('v_deployment_templates_public')
          .select('id, code, slug, name, industry, category, hero_summary, recommended_pricing_tier, governance, kpi_count, asset_class_count, failure_mode_count, oee_model, is_scaffold')
          .order('sort_order', { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        setTemplates((data ?? []) as Template[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDeploy = async (template: Template, opts?: { tenantName?: string; assetCount?: number }) => {
    setDeployError(null);
    setDeployingCode(template.code);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
      if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL not configured');

      const res = await fetch(`${supabaseUrl}/functions/v1/deploy-tenant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          industry: template.slug,
          tenant_name: opts?.tenantName ?? `${template.name} Deployment`,
          asset_count: opts?.assetCount ?? 100,
        }),
      });
      const result: DeployResult = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error ?? `Deploy failed: HTTP ${res.status}`);

      onComplete?.({ ...result, template });
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : 'Deploy failed');
    } finally {
      setDeployingCode(null);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Select Deployment Template"
          subtitle="Loading available industry templates…"
        />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#9BA7B4' }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Select Deployment Template" subtitle="Failed to load templates" />
        <div style={{ padding: '20px', backgroundColor: '#7F1D1D40', border: '1px solid #EF4444', borderRadius: '8px', color: '#FCA5A5' }}>
          <AlertCircle size={16} style={{ display: 'inline', marginRight: '8px' }} />
          {error}
        </div>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div>
        <PageHeader title="Select Deployment Template" subtitle="Choose an industry template to configure your deployment" />
        <EmptyState
          title="No templates available"
          description="Run migration 012 to register industry templates."
          icon={Factory}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Select Deployment Template"
        subtitle={`Choose from ${templates.length} asset-intensive industry templates. Each ships with industry-specific KPIs, asset classes, failure modes, and 15-agent priority weights.`}
      />

      {deployError && (
        <div style={{ padding: '12px 16px', marginTop: '16px', backgroundColor: '#7F1D1D40', border: '1px solid #EF4444', borderRadius: '8px', color: '#FCA5A5', fontSize: '13px' }}>
          <AlertCircle size={14} style={{ display: 'inline', marginRight: '8px' }} />
          {deployError}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '20px',
        marginTop: '24px',
      }}>
        {templates.map(template => (
          <TemplateCard
            key={template.code}
            template={template}
            onPreview={setPreviewTemplate}
            onDeploy={handleDeploy}
            deploying={deployingCode === template.code}
          />
        ))}
      </div>

      {previewTemplate && (
        <TemplatePreview
          template={{ code: previewTemplate.code, name: previewTemplate.name, industry: previewTemplate.industry }}
          onClose={() => setPreviewTemplate(null)}
          onSelect={() => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            handleDeploy(t);
          }}
        />
      )}
    </div>
  );
}

interface CardProps {
  template: Template;
  onPreview: (t: Template) => void;
  onDeploy: (t: Template) => void;
  deploying: boolean;
}

function TemplateCard({ template, onPreview, onDeploy, deploying }: CardProps) {
  return (
    <div style={{
      backgroundColor: '#11161D',
      borderRadius: '12px',
      border: '1px solid #232A33',
      padding: '20px',
      transition: 'all 200ms ease',
      position: 'relative',
    }}>
      {template.is_scaffold && (
        <span style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          fontSize: '10px',
          backgroundColor: '#3A8DFF20',
          color: '#9BC9FF',
          padding: '2px 8px',
          borderRadius: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Scaffold
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Factory size={20} color="#3A8DFF" />
          <div>
            <div style={{ fontSize: '17px', fontWeight: 600, color: '#E6EDF3', lineHeight: 1.2 }}>
              {template.name}
            </div>
            <span style={{ fontSize: '12px', color: '#9BA7B4', textTransform: 'capitalize' }}>
              {template.industry.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      {template.hero_summary && (
        <p style={{ fontSize: '13px', color: '#9BA7B4', marginBottom: '14px', lineHeight: 1.5 }}>
          {template.hero_summary}
        </p>
      )}

      <div style={{ marginBottom: '14px' }}>
        <StatusBadge
          status={template.governance === 'autonomous' ? 'success' : template.governance === 'conditional' ? 'warning' : 'normal'}
          label={template.governance}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
        <Metric value={template.kpi_count} label="KPIs" />
        <Metric value={template.asset_class_count} label="Asset Classes" />
        <Metric value={template.failure_mode_count} label="Failure Modes" />
      </div>

      <div style={{ fontSize: '11px', color: '#9BA7B4', marginBottom: '14px', padding: '8px 10px', backgroundColor: '#161C24', borderRadius: '6px' }}>
        <span style={{ color: '#3A8DFF' }}>OEE:</span> {template.oee_model}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => onPreview(template)}
          disabled={deploying}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: 'transparent',
            border: '1px solid #3A8DFF',
            borderRadius: '8px',
            color: '#3A8DFF',
            fontSize: '13px',
            fontWeight: 500,
            cursor: deploying ? 'not-allowed' : 'pointer',
            opacity: deploying ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <Eye size={14} />
          Preview
        </button>
        <button
          onClick={() => onDeploy(template)}
          disabled={deploying}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#3A8DFF',
            border: 'none',
            borderRadius: '8px',
            color: '#FFFFFF',
            fontSize: '13px',
            fontWeight: 500,
            cursor: deploying ? 'not-allowed' : 'pointer',
            opacity: deploying ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          {deploying ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
          {deploying ? 'Deploying…' : 'Deploy'}
        </button>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ backgroundColor: '#161C24', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#E6EDF3' }}>{value}</div>
      <div style={{ fontSize: '10px', color: '#9BA7B4', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    </div>
  );
}

export default TemplateSelector;
