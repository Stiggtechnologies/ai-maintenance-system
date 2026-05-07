#!/usr/bin/env node
/**
 * deploy-tenant CLI
 * =================
 * Single-command tenant deployment for SyncAI.
 *
 * Usage:
 *   npx tsx scripts/deploy-tenant-cli.ts \
 *     --industry oil-and-gas \
 *     --tenant "ACME Operations" \
 *     --assets 5000
 *
 *   # or as a globally distributed package once published:
 *   npx @syncai/deploy --industry data-centers --tenant "Acme DC" --assets 200
 *
 * Required env (from .env or shell):
 *   SUPABASE_URL                  e.g. https://<project>.supabase.co
 *   SUPABASE_ANON_KEY  OR  SUPABASE_SERVICE_ROLE_KEY
 *   SYNCAI_AUTH_TOKEN             user JWT (from `supabase auth login`)
 *
 * Calls POST {SUPABASE_URL}/functions/v1/deploy-tenant — same engine the
 * in-app TemplateSelector uses. Output: live step status + final URL.
 */

interface Args {
  industry: string;
  tenant: string;
  assets: number;
  governance?: 'advisory' | 'conditional' | 'autonomous';
  dryRun: boolean;
}

interface DeployStep {
  step_order: number;
  step_code: string;
  step_name: string;
  status: string;
}

interface DeployResponse {
  ok: boolean;
  deployment_instance_id?: string;
  status?: string;
  steps?: DeployStep[];
  template?: { code: string; name: string; industry: string };
  error?: string;
  error_code?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { assets: 100, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--industry':   args.industry = next; i++; break;
      case '--tenant':     args.tenant = next; i++; break;
      case '--assets':     args.assets = parseInt(next, 10); i++; break;
      case '--governance': args.governance = next as Args['governance']; i++; break;
      case '--dry-run':    args.dryRun = true; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }
  if (!args.industry || !args.tenant) {
    console.error('Error: --industry and --tenant are required');
    printHelp();
    process.exit(1);
  }
  return args as Args;
}

function printHelp() {
  console.log(`
SyncAI Deploy CLI

Usage:
  npx tsx scripts/deploy-tenant-cli.ts --industry <slug> --tenant <name> [options]

Required:
  --industry <slug>    Industry template slug (e.g. oil-and-gas, data-centers, pharmaceuticals)
  --tenant <name>      Human-readable deployment name (e.g. "ACME Operations")

Optional:
  --assets <count>     Synthetic asset seed count (default 100, max 100000)
  --governance <mode>  advisory | conditional | autonomous (default per template)
  --dry-run            Validate inputs only, do not provision
  --help, -h           Show this help

Available templates (13):
  oil-and-gas                       data-centers                pharmaceuticals
  mining-and-metals                 power-generation-and-utilities
  heavy-manufacturing               chemicals-and-petrochemicals
  pulp-paper-and-packaging          aerospace-and-defense
  pipelines-and-midstream           rail-marine-and-aviation
  equipment-rental                  multi-site-operators

Required env:
  SUPABASE_URL          Your Supabase project URL
  SYNCAI_AUTH_TOKEN     Your user JWT (from \`supabase auth login\`)

Examples:
  --industry oil-and-gas --tenant "ACME O&G" --assets 5000
  --industry data-centers --tenant "Hyperscale-DC1" --assets 2500 --governance conditional
  --industry pharmaceuticals --tenant "Pharma Test" --dry-run
`);
}

function envOrExit(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Error: missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = envOrExit('SUPABASE_URL');
  const authToken = process.env.SYNCAI_AUTH_TOKEN ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!authToken) {
    console.error('Error: set SYNCAI_AUTH_TOKEN (preferred) or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log(`\n  ${'⚡'} SyncAI Deploy`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Industry:   ${args.industry}`);
  console.log(`  Tenant:     ${args.tenant}`);
  console.log(`  Assets:     ${args.assets}`);
  if (args.governance) console.log(`  Governance: ${args.governance}`);
  if (args.dryRun)     console.log(`  Mode:       DRY RUN (no changes)`);
  console.log(`  ${'─'.repeat(50)}\n`);

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/deploy-tenant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        apikey: process.env.SUPABASE_ANON_KEY ?? authToken,
      },
      body: JSON.stringify({
        industry: args.industry,
        tenant_name: args.tenant,
        asset_count: args.assets,
        governance: args.governance,
        dry_run: args.dryRun,
      }),
    });
  } catch (e) {
    console.error('  ✗ Network error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const result = (await response.json().catch(() => ({}))) as DeployResponse;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!response.ok || !result.ok) {
    console.error(`  ✗ Deploy failed (${result.error_code ?? 'HTTP ' + response.status})`);
    console.error(`    ${result.error ?? 'Unknown error'}`);
    process.exit(1);
  }

  if (result.template) {
    console.log(`  Template:   ${result.template.name} (${result.template.code})`);
    console.log(`  Industry:   ${result.template.industry}`);
  }

  if (result.steps?.length) {
    console.log(`\n  Provisioning steps:`);
    for (const step of result.steps) {
      const icon = step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'would_execute' ? '·' : '○';
      const padded = `${step.step_order}.`.padEnd(4);
      console.log(`    ${icon} ${padded}${step.step_name.padEnd(35)} [${step.status}]`);
    }
  }

  console.log(`\n  ${'─'.repeat(50)}`);
  console.log(`  ${args.dryRun ? 'Dry run complete' : 'Deployment complete'} · ${elapsed}s`);
  if (result.deployment_instance_id) {
    console.log(`  Instance:   ${result.deployment_instance_id}`);
  }
  if (result.status) {
    console.log(`  Status:     ${result.status}`);
  }
  console.log();
}

main().catch((e) => {
  console.error('  ✗ Uncaught error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
