import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../AuthProvider';
import { CreditCard, TrendingUp, AlertCircle, DollarSign, Package, Calendar } from 'lucide-react';

interface BillingData {
  subscription?: any;
  plan?: any;
  limits?: any;
  latestInvoice?: any;
  assetCount?: number;
  creditUsagePercent?: number;
}

export function BillingOverview() {
  const { user } = useAuth();
  const [data, setData] = useState<BillingData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBillingData();
  }, [user]);

  const fetchBillingData = async () => {
    try {
      // Get user's tenant_id (simplified - adjust based on your schema)
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('id', user?.id)
        .maybeSingle();

      if (!profile) return;

      // Get active subscription
      const { data: subscriptions } = await supabase
        .from('billing_subscriptions')
        .select(`
          *,
          plan:billing_plans(*),
          limits:subscription_limits(*)
        `)
        .eq('status', 'active')
        .limit(1);

      if (!subscriptions || subscriptions.length === 0) {
        setLoading(false);
        return;
      }

      const subscription = subscriptions[0];
      const plan = (subscription as any).plan;
      const limits = (subscription as any).limits?.[0];

      // Get latest invoice
      const { data: invoices } = await supabase
        .from('billing_invoices')
        .select('*')
        .eq('subscription_id', subscription.id)
        .order('created_at', { ascending: false })
        .limit(1);

      // Get asset count
      const { data: assetSnapshot } = await supabase
        .from('asset_snapshots')
        .select('asset_count')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const creditUsagePercent = limits
        ? ((limits.included_credits - limits.remaining_credits) / limits.included_credits) * 100
        : 0;

      setData({
        subscription,
        plan,
        limits,
        latestInvoice: invoices?.[0],
        assetCount: assetSnapshot?.asset_count || 0,
        creditUsagePercent,
      });
    } catch (error) {
      console.error('Error fetching billing data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (!data.subscription) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <CreditCard className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Active Subscription</h2>
          <p className="text-gray-600 mb-6">Start your monetization journey by selecting a plan</p>
          <button
            onClick={() => window.location.href = '/app/billing/plans'}
            className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            View Plans
          </button>
        </div>
      </div>
    );
  }

  const { subscription, plan, limits, latestInvoice, assetCount, creditUsagePercent } = data;
  const isLowCredits = (limits?.remaining_credits || 0) < (limits?.included_credits || 1) * 0.1;
  const isOverage = (limits?.remaining_credits || 0) < 0;

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing Overview</h1>
          <p className="text-gray-600">Manage your subscription and monitor usage</p>
        </div>

        {/* Alerts */}
        {(isLowCredits || isOverage) && (
          <div className={`mb-6 rounded-xl border p-4 flex items-start gap-3 ${
            isOverage ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
          }`}>
            <AlertCircle className={`w-5 h-5 mt-0.5 ${isOverage ? 'text-red-600' : 'text-yellow-600'}`} />
            <div>
              <h3 className={`font-semibold ${isOverage ? 'text-red-900' : 'text-yellow-900'}`}>
                {isOverage ? 'Credit Overage' : 'Low Credits'}
              </h3>
              <p className={`text-sm ${isOverage ? 'text-red-700' : 'text-yellow-700'}`}>
                {isOverage
                  ? `You have exceeded your monthly credit limit. Overage charges will apply.`
                  : `You've used ${creditUsagePercent?.toFixed(0)}% of your monthly credits.`
                }
              </p>
            </div>
          </div>
        )}

        {/* Current Plan */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">{plan?.name}</h2>
                <p className="text-sm text-gray-600">Current subscription plan</p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-gray-900">${plan?.base_price_cad?.toLocaleString()}</div>
                <div className="text-sm text-gray-600">CAD/month</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-gray-600 mb-1">Assets</div>
                <div className="text-2xl font-bold text-gray-900">
                  {assetCount} <span className="text-sm text-gray-500">/ {plan?.included_assets}</span>
                </div>
                {assetCount && plan?.included_assets && assetCount > plan.included_assets && (
                  <div className="text-xs text-red-600 mt-1">
                    +${((assetCount - plan.included_assets) * plan.asset_uplift_cad).toFixed(2)} overage
                  </div>
                )}
              </div>

              <div>
                <div className="text-sm text-gray-600 mb-1">Credits Remaining</div>
                <div className="text-2xl font-bold text-gray-900">
                  {(limits?.remaining_credits || 0).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  of {(limits?.included_credits || 0).toLocaleString()} monthly
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-600 mb-1">Max Sites</div>
                <div className="text-2xl font-bold text-gray-900">{plan?.max_sites}</div>
              </div>

              <div>
                <div className="text-sm text-gray-600 mb-1">Billing Period</div>
                <div className="text-sm text-gray-900">
                  {new Date(subscription?.current_period_start).toLocaleDateString()} - <br/>
                  {new Date(subscription?.current_period_end).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <button className="px-4 py-2 text-teal-600 hover:text-teal-700 font-medium text-sm">
                Change Plan
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="space-y-4">
            <div className="bg-teal-50 rounded-xl border border-teal-200 p-5">
              <Package className="w-8 h-8 text-teal-600 mb-2" />
              <div className="text-2xl font-bold text-teal-900">{plan?.code}</div>
              <div className="text-sm text-teal-700">Plan Tier</div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <Calendar className="w-8 h-8 text-gray-600 mb-2" />
              <div className="text-2xl font-bold text-gray-900">
                {Math.ceil((new Date(subscription?.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))}
              </div>
              <div className="text-sm text-gray-600">Days until renewal</div>
            </div>

            {latestInvoice && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <DollarSign className="w-8 h-8 text-gray-600 mb-2" />
                <div className="text-2xl font-bold text-gray-900">
                  ${latestInvoice.total_cad?.toFixed(2)}
                </div>
                <div className="text-sm text-gray-600">Last invoice</div>
                <div className={`text-xs mt-1 ${
                  latestInvoice.status === 'paid' ? 'text-green-600' : 'text-yellow-600'
                }`}>
                  {latestInvoice.status.toUpperCase()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Credit Usage */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Credit Usage This Period</h2>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">
                {((limits?.included_credits - limits?.remaining_credits) || 0).toLocaleString()} credits used
              </span>
              <span className="text-sm text-gray-600">
                {creditUsagePercent?.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  isOverage ? 'bg-red-500' : isLowCredits ? 'bg-yellow-500' : 'bg-teal-500'
                }`}
                style={{ width: `${Math.min(creditUsagePercent || 0, 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-600">Included</div>
              <div className="font-semibold text-gray-900">
                {(limits?.included_credits || 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-gray-600">Used</div>
              <div className="font-semibold text-gray-900">
                {((limits?.included_credits - limits?.remaining_credits) || 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-gray-600">Remaining</div>
              <div className="font-semibold text-gray-900">
                {Math.max(limits?.remaining_credits || 0, 0).toLocaleString()}
              </div>
            </div>
            {isOverage && (
              <div>
                <div className="text-red-600">Overage</div>
                <div className="font-semibold text-red-700">
                  {Math.abs(limits?.remaining_credits || 0).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => window.location.href = '/app/billing/usage'}
            className="bg-white rounded-xl border border-gray-200 p-6 hover:border-teal-300 hover:shadow-sm transition-all text-left"
          >
            <TrendingUp className="w-8 h-8 text-teal-600 mb-2" />
            <h3 className="font-semibold text-gray-900 mb-1">Usage Dashboard</h3>
            <p className="text-sm text-gray-600">View detailed usage analytics</p>
          </button>

          <button
            onClick={() => window.location.href = '/app/billing/invoices'}
            className="bg-white rounded-xl border border-gray-200 p-6 hover:border-teal-300 hover:shadow-sm transition-all text-left"
          >
            <CreditCard className="w-8 h-8 text-teal-600 mb-2" />
            <h3 className="font-semibold text-gray-900 mb-1">Invoices</h3>
            <p className="text-sm text-gray-600">View and download invoices</p>
          </button>

          <button
            onClick={() => window.location.href = '/app/billing/gain-share'}
            className="bg-white rounded-xl border border-gray-200 p-6 hover:border-teal-300 hover:shadow-sm transition-all text-left"
          >
            <DollarSign className="w-8 h-8 text-teal-600 mb-2" />
            <h3 className="font-semibold text-gray-900 mb-1">Gain-Share</h3>
            <p className="text-sm text-gray-600">Performance-based billing</p>
          </button>
        </div>
      </div>
    </div>
  );
}
