/**
 * AwsMarketplaceActivate
 * ======================
 * Landing page for AWS Marketplace SaaS Listing activation flow.
 *
 * AWS redirects buyers to:
 *   https://app.syncai.ca/marketplace/aws/activate?x-amzn-marketplace-token=<token>
 *
 * after they subscribe to the offer in AWS Marketplace. This component:
 *   1. Pulls x-amzn-marketplace-token from the URL
 *   2. Calls marketplace-aws-fulfillment-webhook (action: "resolve")
 *   3. Shows the resolved customer (CustomerIdentifier, AWS account, product code)
 *   4. Routes the buyer into account setup
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { AuthShell } from '../components/AuthShell';

interface ResolvedAws {
  ok: boolean;
  subscription_id?: string;
  customer_identifier?: string;
  aws_account_id?: string;
  product_code?: string;
  status?: string;
  error?: string;
}

interface Props {
  onContinueToSignup: (params: { customerIdentifier?: string }) => void;
}

export function AwsMarketplaceActivate({ onContinueToSignup }: Props) {
  const [resolving, setResolving] = useState(true);
  const [result, setResult] = useState<ResolvedAws | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('x-amzn-marketplace-token') ?? params.get('token');
    if (!token) {
      setError('Missing AWS Marketplace token. Make sure you arrived here from AWS Marketplace.');
      setResolving(false);
      return;
    }
    resolve(token);
  }, []);

  const resolve = async (marketplaceToken: string) => {
    try {
      const url = (import.meta as any).env?.VITE_SUPABASE_URL;
      if (!url) throw new Error('VITE_SUPABASE_URL not configured');

      const res = await fetch(`${url}/functions/v1/marketplace-aws-fulfillment-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', marketplace_token: marketplaceToken }),
      });
      const json = (await res.json().catch(() => ({}))) as ResolvedAws;
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
      try {
        sessionStorage.setItem('syncai.aws_customer_identifier', json.customer_identifier ?? '');
        sessionStorage.setItem('syncai.aws_account_id', json.aws_account_id ?? '');
      } catch { /* private browsing */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setResolving(false);
    }
  };

  return (
    <AuthShell>
      <div className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm font-medium text-orange-400">aws</span>
          <span className="text-gray-500">×</span>
          <span className="text-xl font-semibold text-white">SyncAI</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Welcome from AWS Marketplace</h1>
        <p className="text-gray-400 mb-6 text-sm">
          We're activating your SyncAI subscription against your AWS account.
        </p>

        {resolving && (
          <div className="flex items-center gap-3 p-4 bg-[#0F1419] rounded-lg border border-[#232A33]">
            <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
            <span className="text-sm text-gray-300">Resolving customer via ResolveCustomer API…</span>
          </div>
        )}

        {!resolving && error && (
          <div className="p-4 bg-red-900/30 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-3 mb-2">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div>
                <div className="text-red-300 font-medium mb-1">Activation failed</div>
                <p className="text-red-300/80 text-sm">{error}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              If this persists, contact support@syncai.ca with your CustomerIdentifier from AWS Marketplace.
            </p>
          </div>
        )}

        {!resolving && result?.ok && (
          <>
            <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-lg mb-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-emerald-300 font-medium mb-1">Customer resolved</div>
                  <p className="text-emerald-200/80 text-sm">
                    Your AWS Marketplace subscription has been linked. One last step: create your SyncAI account.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#0F1419] border border-[#232A33] rounded-lg p-4 mb-6">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">AWS Subscription</div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Customer ID</dt>
                  <dd className="text-white font-medium font-mono text-xs truncate max-w-[220px]">{result.customer_identifier}</dd>
                </div>
                {result.aws_account_id && (
                  <div className="flex justify-between">
                    <dt className="text-gray-400">AWS account</dt>
                    <dd className="text-white font-medium font-mono text-xs">{result.aws_account_id}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-400">Product code</dt>
                  <dd className="text-white font-medium font-mono text-xs">{result.product_code}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Status</dt>
                  <dd className="text-emerald-400 font-medium">{result.status}</dd>
                </div>
              </dl>
              <p className="text-xs text-gray-500 mt-3">
                AWS sends a SubscribeSuccess event within ~5 minutes — your status will update to <code className="bg-white/5 px-1 rounded">aws_subscribed</code>.
              </p>
            </div>

            <button
              onClick={() => onContinueToSignup({ customerIdentifier: result.customer_identifier })}
              className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg text-white font-medium inline-flex items-center justify-center gap-2"
              data-testid="aws-marketplace-continue"
            >
              Continue to account setup
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export default AwsMarketplaceActivate;
