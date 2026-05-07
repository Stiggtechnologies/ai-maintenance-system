/**
 * ConnectIntegrationModal
 * =======================
 * Modal that renders a credential entry form driven by a catalog entry's
 * `credentials_schema` (JSON Schema, partial support — object/required/
 * properties with type & format). Supports password-format inputs that
 * mask their value, enums (rendered as <select>), and string inputs.
 *
 * On submit: calls onSubmit(entry, name, credentials) — the parent makes
 * the actual integration-connect Edge Function call.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Eye, EyeOff } from 'lucide-react';

export interface CatalogEntry {
  code: string;
  vendor: string;
  product: string;
  category: string;
  description: string | null;
  auth_type: string;
  credentials_schema: Record<string, unknown>;
  has_test_endpoint: boolean;
  docs_url: string | null;
}

interface FieldDef {
  key: string;
  type: string;
  format?: string;
  title?: string;
  description?: string;
  default?: string;
  required: boolean;
  enumValues?: string[];
}

interface Props {
  entry: CatalogEntry;
  onClose: () => void;
  onSubmit: (entry: CatalogEntry, name: string, credentials: Record<string, unknown>) => Promise<void>;
}

export function ConnectIntegrationModal({ entry, onClose, onSubmit }: Props) {
  const fields = useMemo(() => parseSchema(entry.credentials_schema), [entry.credentials_schema]);
  const [name, setName] = useState(`${entry.vendor} ${entry.product}`);
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map(f => [f.key, f.default ?? '']))
  );
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(`${entry.vendor} ${entry.product}`);
    setValues(Object.fromEntries(fields.map(f => [f.key, f.default ?? ''])));
  }, [entry.code, fields]);

  const canSubmit = name.trim().length > 0 && fields.every(f => !f.required || (values[f.key] ?? '').length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(entry, name.trim(), values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0F1419] border border-[#232A33] rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col"
        data-testid="connect-modal"
      >
        <div className="p-5 border-b border-[#232A33] flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">Connect integration</div>
            <h2 className="text-lg font-semibold">{entry.vendor} · {entry.product}</h2>
            {entry.description && <p className="text-sm text-gray-400 mt-1.5 max-w-md">{entry.description}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Display name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#161C24] border border-[#232A33] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                required
              />
              <p className="text-xs text-gray-500 mt-1">A friendly label for this connection — e.g. "ACME Production SAP"</p>
            </div>

            {fields.length === 0 ? (
              <div className="text-sm text-gray-400 p-3 bg-[#161C24] rounded border border-[#232A33]">
                This integration has no credential fields defined yet. Connecting will create a placeholder you can configure later.
              </div>
            ) : (
              fields.map((f) => (
                <Field
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? ''}
                  reveal={!!reveal[f.key]}
                  onChange={(v) => setValues(prev => ({ ...prev, [f.key]: v }))}
                  onToggleReveal={() => setReveal(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                />
              ))
            )}

            {entry.docs_url && (
              <a href={entry.docs_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 inline-flex items-center gap-1 hover:underline">
                Setup docs <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {error && (
            <div className="px-5 pb-3">
              <div className="p-3 bg-red-900/30 border border-red-500/30 rounded text-red-300 text-sm">{error}</div>
            </div>
          )}

          <div className="p-5 border-t border-[#232A33] flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">
              {entry.has_test_endpoint
                ? 'A live connectivity test will run on connect.'
                : 'Credentials will be stored encrypted (live test not yet available for this vendor).'}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium text-white inline-flex items-center gap-2"
                data-testid="connect-submit"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Connect
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  field, value, reveal, onChange, onToggleReveal,
}: {
  field: FieldDef;
  value: string;
  reveal: boolean;
  onChange: (v: string) => void;
  onToggleReveal: () => void;
}) {
  const isPassword = field.format === 'password';
  return (
    <div>
      <label className="block text-xs font-medium text-gray-300 mb-1.5">
        {field.title ?? field.key} {field.required && <span className="text-red-400">*</span>}
      </label>
      {field.enumValues ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className="w-full bg-[#161C24] border border-[#232A33] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">Select…</option>
          {field.enumValues.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <div className="relative">
          <input
            type={isPassword && !reveal ? 'password' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            className="w-full bg-[#161C24] border border-[#232A33] rounded px-3 py-2 pr-10 text-sm text-white focus:outline-none focus:border-blue-500"
            autoComplete={isPassword ? 'new-password' : 'off'}
          />
          {isPassword && (
            <button
              type="button"
              onClick={onToggleReveal}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              tabIndex={-1}
            >
              {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
      )}
      {field.description && <p className="text-xs text-gray-500 mt-1">{field.description}</p>}
    </div>
  );
}

/**
 * Partial JSON-Schema → flat field list for our credential forms.
 *
 * Supports the subset we actually use in catalog seeds:
 *   { type: "object", required: [...], properties: { x: { type, format, title, default, description, enum } } }
 */
function parseSchema(schema: Record<string, unknown>): FieldDef[] {
  if (!schema || schema.type !== 'object') return [];
  const required = (schema.required as string[] | undefined) ?? [];
  const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  return Object.entries(props).map(([key, def]) => ({
    key,
    type: (def.type as string) ?? 'string',
    format: def.format as string | undefined,
    title: def.title as string | undefined,
    description: def.description as string | undefined,
    default: def.default as string | undefined,
    required: required.includes(key),
    enumValues: def.enum as string[] | undefined,
  }));
}

export default ConnectIntegrationModal;
