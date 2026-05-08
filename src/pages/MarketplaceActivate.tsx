/**
 * MarketplaceActivate
 * ===================
 * Landing page for Microsoft AppSource activation flow.
 *
 * Microsoft redirects buyers to:
 *   https://app.syncai.ca/marketplace/activate?token=<marketplace_token>
 *
 * after they purchase the offer in AppSource. This component:
 *   1. Pulls the token from the URL
 *   2. Calls marketplace-fulfillment-webhook (action: "resolve")
 *   3. Shows the resolved subscription (offer / plan / quantity / purchaser)
 *   4. Routes the buyer into account setup with email + plan pre-populated
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuthShell } from '../components/AuthShell';

interface ResolvedSubscription {
  ok: boolean;
  subscription_id?: string;
  marketplace_subscription_id?: string;
  offer_id?: string;
  plan_id?: string;
  quantity?: number;
  purchaser_email?: string;
  status?: string;
  error?: string;
}

interface Props {
  onContinueToSignup: (params: { email?: string; planCode?: string }) => void;
}

export function MarketplaceActivate({ onContinueToSignup }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [result, setResult] = useState<ResolvedSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    setToken(t);
    if (!t) {
      setError('Missing ?token=… parameter. Make sure you arrived here from Microsoft AppSource.');
      setResolving(false);
      return;
    }
    resolve(t);
  }, []);

  const resolve = async (marketplaceToken: string) => {
    try {
      const url = (import.meta as any).env?.VITE_SUPABASE_URL;
      if (!url) throw new Error('VITE_SUPABASE_URL not configured');

      const res = await fetch(`${url}/functions/v1/marketplace-fulfillment-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', marketplace_token: marketplaceToken }),
      });
      const json = (await res.json().catch(() => ({}))) as ResolvedSubscription;
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
      // Stash for the Signup flow (Signup reads sessionStorage in Industry handoff
      // — same pattern, different key).
      try {
        sessionStorage.setItem('syncai.marketplace_email', json.purchaser_email ?? '');
        sessionStorage.setItem('syncai.marketplace_plan', json.plan_id ?? '');
        sessionStorage.setItem('syncai.marketplace_subscription_id', json.marketplace_subscription_id ?? '');
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
          <img alt="Microsoft" className="h-7" src="https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg" />
          <span className="text-gray-500">×</span>
          <span className="text-xl font-semibold text-white">SyncAI</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Welcome from Microsoft AppSource</h1>
        <p className="text-gray-400 mb-6 text-sm">
          We're activating your SyncAI subscription. This takes a few seconds.
        </p>

        {resolving && (
          <div className="flex items-center gap-3 p-4 bg-[#0F1419] rounded-lg border border-[#232A33]">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span className="text-sm text-gray-300">Resolving your AppSource subscription…</span>
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
              If you arrived here from Microsoft AppSource and this error persists, contact support@syncai.ca with your subscription id.
            </p>
          </div>
        )}

        {!resolving && result?.ok && (
          <>
            <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-lg mb-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-emerald-300 font-medium mb-1">Subscription activated</div>
                  <p className="text-emerald-200/80 text-sm">
                    Your AppSource subscription has been linked to SyncAI. One last step: create your account.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#0F1419] border border-[#232A33] rounded-lg p-4 mb-6">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Subscription</div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Offer</dt>
                  <dd className="text-white font-medium">{result.offer_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Plan</dt>
                  <dd className="text-white font-medium uppercase">{result.plan_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Seats</dt>
                  <dd className="text-white font-medium">{result.quantity}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Purchaser</dt>
                  <dd className="text-white font-medium truncate max-w-[200px]">{result.purchaser_email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Status</dt>
                  <dd className="text-emerald-400 font-medium">{result.status}</dd>
                </div>
              </dl>
            </div>

            <button
              onClick={() => onContinueToSignup({ email: result.purchaser_email, planCode: result.plan_id })}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium inline-flex items-center justify-center gap-2"
              data-testid="marketplace-continue"
            >
              Continue to account setup
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {!resolving && !error && !result?.ok && (
          <div className="p-4 bg-[#0F1419] rounded-lg border border-[#232A33] text-sm text-gray-400">
            No subscription resolved. If you came from AppSource, try refreshing the page.
          </div>
        )}
      </div>
    </AuthShell>
  );
}

export default MarketplaceActivate;
