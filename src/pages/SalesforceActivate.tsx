/**
 * SalesforceActivate
 * ==================
 * Landing page for Salesforce AppExchange post-install setup.
 *
 * Unlike Microsoft and AWS, Salesforce doesn't redirect users with a
 * token after install — the customer installs the managed package, then
 * navigates to setup the integration. This page shows installation
 * verification + setup steps, and confirms the LMA license is being
 * synced to our backend.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, ChevronRight, Database, Shield, Workflow } from 'lucide-react';
import { AuthShell } from '../components/AuthShell';

interface Props {
  onContinueToSignup: () => void;
}

export function SalesforceActivate({ onContinueToSignup }: Props) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [packageVersion, setPackageVersion] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrgId(params.get('organization_id') ?? params.get('orgId'));
    setPackageVersion(params.get('package_version_id') ?? params.get('pkg'));
  }, []);

  return (
    <AuthShell>
      <div className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm font-medium text-blue-400">salesforce</span>
          <span className="text-gray-500">×</span>
          <span className="text-xl font-semibold text-white">SyncAI</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Welcome from Salesforce AppExchange</h1>
        <p className="text-gray-400 mb-6 text-sm">
          The SyncAI managed package is installed in your Salesforce org. Three steps to complete activation.
        </p>

        {orgId && (
          <div className="bg-[#0F1419] border border-[#232A33] rounded-lg p-4 mb-6">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Salesforce Org</div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-400">Org ID</dt>
                <dd className="text-white font-medium font-mono text-xs">{orgId}</dd>
              </div>
              {packageVersion && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Package version</dt>
                  <dd className="text-white font-medium font-mono text-xs">{packageVersion}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="space-y-3 mb-6">
          <SetupStep
            number={1}
            icon={Database}
            title="Configure object permissions"
            body="In Salesforce, grant the SyncAI Integration User read+write on Asset, WorkOrder, MaintenanceWorkRule. Saved as a permission set in our package."
          />
          <SetupStep
            number={2}
            icon={Workflow}
            title="Activate the LMA license flow"
            body="A pre-built Flow ships with the package. It posts license changes to our license-event webhook so seat counts and lifecycle stay in sync."
          />
          <SetupStep
            number={3}
            icon={Shield}
            title="Connect your Anthropic key"
            body="After signup, add Anthropic in Integrations. All 15 agents activate immediately for your SF org."
          />
        </div>

        <button
          onClick={onContinueToSignup}
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium inline-flex items-center justify-center gap-2"
          data-testid="sf-continue"
        >
          Continue to account setup
          <ChevronRight className="w-4 h-4" />
        </button>

        <p className="text-xs text-gray-500 mt-4 flex items-start gap-2">
          <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />
          <span>Once setup is complete, your license records in LMA automatically sync to SyncAI within 5 minutes.</span>
        </p>
      </div>
    </AuthShell>
  );
}

function SetupStep({
  number, icon: Icon, title, body,
}: { number: number; icon: typeof Database; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/15 text-blue-400 text-sm font-bold flex items-center justify-center">
        {number}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <Icon size={14} className="text-blue-400" />
          <span className="text-sm font-medium text-white">{title}</span>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

export default SalesforceActivate;
