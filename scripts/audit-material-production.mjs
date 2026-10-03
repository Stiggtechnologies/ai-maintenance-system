import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// API contract: https://supabase.com/docs/reference/api/v1-run-a-query
export async function auditMaterialProduction({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  const project = env.SUPABASE_PROJECT_ID?.trim();
  if (!token || !project || !/^[a-z0-9]+$/.test(project)) {
    throw new Error('Valid SUPABASE_PROJECT_ID and SUPABASE_ACCESS_TOKEN are required');
  }
  const source = await readFile(new URL('./audit-material-relationship-history.sql', import.meta.url), 'utf8');
  // Reuse the exact psql audit; only its client-side directive is removed.
  const query = source.replace(/^\\set ON_ERROR_STOP on\r?$/m, '');
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
    signal: AbortSignal.timeout(90_000),
  });
  // Do not echo a remote response that could contain SQL, customer data or secrets.
  if (!response.ok) throw new Error(`Material historical audit failed (HTTP ${response.status}); rollout refused`);
  const result = await response.json();
  if (result && typeof result === 'object' && ('error' in result || 'message' in result)) {
    throw new Error('Material historical audit returned an error; rollout refused');
  }
  return { project, passed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditMaterialProduction();
  console.log(`Material history audit passed for ${result.project}; read-only snapshot, no records changed`);
}
