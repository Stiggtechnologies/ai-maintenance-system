import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { TrendingUp, Zap, Eye, Cpu, PlayCircle, AlertTriangle } from 'lucide-react';

interface UsageSummary {
  subscription_id: string;
  period: string;
  total_credits: number;
  by_type: Record<string, { count: number; units: number; credits: number }>;
}

export function UsageDashboard() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<any>(null);

  useEffect(() => {
    fetchUsageData();
  }, []);

  const fetchUsageData = async () => {
    try {
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

      const sub = subscriptions[0];
      setSubscription(sub);

      // Get current month usage
      const currentPeriod = new Date().toISOString().substring(0, 7); // YYYY-MM

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/billing-api/usage/summary?subscriptionId=${sub.id}&period=${currentPeriod}`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setUsage(data);
      }

      // Get historical monthly data
      const { data: monthlyData } = await supabase
        .from('v_tenant_monthly_usage')
        .select('*')
        .eq('subscription_id', sub.id)
        .order('month', { ascending: false })
        .limit(6);

      setHistoricalData(monthlyData || []);
    } catch (error) {
      console.error('Error fetching usage data:', error);
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

  if (!subscription) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-600">No active subscription found</p>
        </div>
      </div>
    );
  }

  const plan = (subscription as any).plan;
  const limits = (subscription as any).limits?.[0];
  const creditsUsed = limits?.included_credits - limits?.remaining_credits || 0;
  const usagePercent = (creditsUsed / limits?.included_credits) * 100;
  const isLow = usagePercent > 90;

  const eventTypeIcons: Record<string, any> = {
    'LLM_token_usage': Zap,
    'vision_frame_batch': Eye,
    'optimizer_job': Cpu,
    'simulator_run': PlayCircle,
  };

  const eventTypeLabels: Record<string, string> = {
    'LLM_token_usage': 'LLM Queries',
    'vision_frame_batch': 'Vision Analysis',
    'optimizer_job': 'Optimizer Jobs',
    'simulator_run': 'Simulator Runs',
  };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Usage Dashboard</h1>
          <p className="text-gray-600">Monitor your credit consumption and usage patterns</p>
        </div>

        {/* Alert for low credits */}
        {isLow && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900">Credit Usage Alert</h3>
              <p className="text-sm text-yellow-700">
                You've used {usagePercent.toFixed(0)}% of your monthly credit allowance. Consider upgrading your plan or monitoring usage carefully.
              </p>
            </div>
          </div>
        )}

        {/* Current Period Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 p-6">
            <div className="text-sm text-gray-600 mb-1">Total Credits Used</div>
            <div className="text-3xl font-bold text-gray-900">
              {creditsUsed.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              of {limits?.included_credits?.toLocaleString()} included
            </div>
            <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${isLow ? 'bg-yellow-500' : 'bg-teal-500'}`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage by Type</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(usage?.by_type || {}).map(([type, data]) => {
                const Icon = eventTypeIcons[type] || Zap;
                const label = eventTypeLabels[type] || type;

                return (
                  <div key={type} className="bg-gray-50 rounded-lg p-4">
                    <Icon className="w-6 h-6 text-teal-600 mb-2" />
                    <div className="text-2xl font-bold text-gray-900">
                      {data.credits.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-600 mb-1">{label}</div>
                    <div className="text-xs text-gray-500">{data.count} events</div>
                  </div>
                );
              })}

              {Object.keys(usage?.by_type || {}).length === 0 && (
                <div className="col-span-4 text-center py-8 text-gray-500">
                  No usage recorded this period
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Historical Trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-teal-600" />
            Historical Usage Trend
          </h2>

          {historicalData.length > 0 ? (
            <div className="space-y-3">
              {historicalData.map((month: any) => {
                const monthDate = new Date(month.month);
                const monthLabel = monthDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
                const monthPercent = (month.total_credits / limits?.included_credits) * 100;

                return (
                  <div key={month.month}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700">{monthLabel}</span>
                      <span className="text-sm text-gray-600">
                        {month.total_credits?.toLocaleString()} credits ({monthPercent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-teal-500"
                        style={{ width: `${Math.min(monthPercent, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No historical data available yet
            </div>
          )}
        </div>

        {/* Rate Information */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Credit Rates for Your Plan</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">LLM Token Usage</div>
              <div className="font-semibold text-gray-900">1 credit</div>
              <div className="text-xs text-gray-500">per 1,000 tokens</div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">Vision Frames</div>
              <div className="font-semibold text-gray-900">5 credits</div>
              <div className="text-xs text-gray-500">per 100 frames</div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">Optimizer Job</div>
              <div className="font-semibold text-gray-900">500 credits</div>
              <div className="text-xs text-gray-500">per job</div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">Simulator Run</div>
              <div className="font-semibold text-gray-900">1,000 credits</div>
              <div className="text-xs text-gray-500">per run</div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">Overage Rate</div>
                <div className="font-semibold text-gray-900">
                  ${plan?.overage_per_credit_cad.toFixed(4)} CAD per credit
                </div>
              </div>
              <button className="px-4 py-2 text-teal-600 hover:text-teal-700 font-medium text-sm">
                Upgrade Plan →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
