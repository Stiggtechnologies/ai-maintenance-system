import { useState, useEffect } from 'react';
import { Check, Zap } from 'lucide-react';

interface Plan {
  id: string;
  code: string;
  name: string;
  base_price_cad: number;
  included_assets: number;
  included_credits: number;
  asset_uplift_cad: number;
  overage_per_credit_cad: number;
  max_sites: number;
}

export function PlansAndPricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/billing-api/plans`, {
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch plans');

      const data = await response.json();
      setPlans(data.plans || []);
    } catch (error) {
      console.error('Error fetching plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (planCode: string) => {
    setSelectedPlan(planCode);
    // Here you would integrate with Stripe Checkout or your payment flow
    alert(`Selected plan: ${planCode}. Payment integration would go here.`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
          <p className="text-xl text-gray-600">
            Hybrid SaaS + usage-based pricing for autonomous reliability
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan, idx) => {
            const isPopular = plan.code === 'PRO';
            const features = [
              `${plan.included_assets.toLocaleString()} assets included`,
              `${(plan.included_credits / 1000).toFixed(0)}K monthly credits`,
              `Up to ${plan.max_sites} site${plan.max_sites > 1 ? 's' : ''}`,
              `$${plan.asset_uplift_cad}/asset overage`,
              `$${plan.overage_per_credit_cad.toFixed(4)}/credit overage`,
              'AI-powered maintenance optimization',
              'Predictive analytics',
              'Real-time monitoring',
              'Mobile access',
            ];

            if (plan.code === 'ENTERPRISE') {
              features.push('Dedicated support', 'Custom integrations', 'Gain-share pricing');
            } else if (plan.code === 'PRO') {
              features.push('Priority support', 'API access');
            }

            return (
              <div
                key={plan.id}
                className={`relative bg-white rounded-2xl border-2 p-8 ${
                  isPopular ? 'border-teal-500 shadow-xl' : 'border-gray-200'
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <div className="bg-teal-600 text-white px-4 py-1 rounded-full text-sm font-semibold flex items-center gap-1">
                      <Zap className="w-4 h-4" />
                      Most Popular
                    </div>
                  </div>
                )}

                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-5xl font-bold text-gray-900">
                      ${(plan.base_price_cad / 1000).toFixed(0)}K
                    </span>
                    <span className="text-gray-600">/month</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">+ usage overages</div>
                </div>

                <ul className="space-y-3 mb-8">
                  {features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700 text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSelectPlan(plan.code)}
                  disabled={selectedPlan === plan.code}
                  className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
                    isPopular
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {selectedPlan === plan.code ? 'Selected' : 'Get Started'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Pricing Details */}
        <div className="mt-16 bg-white rounded-xl border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">How Pricing Works</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="bg-teal-50 rounded-lg p-4 mb-3">
                <h3 className="font-semibold text-teal-900 mb-2">Base Subscription</h3>
                <p className="text-sm text-teal-700">
                  Fixed monthly fee for your plan tier, includes base asset and credit allowance
                </p>
              </div>
            </div>

            <div>
              <div className="bg-blue-50 rounded-lg p-4 mb-3">
                <h3 className="font-semibold text-blue-900 mb-2">Asset Uplift</h3>
                <p className="text-sm text-blue-700">
                  Pay per additional asset beyond your included limit at your plan's asset rate
                </p>
              </div>
            </div>

            <div>
              <div className="bg-purple-50 rounded-lg p-4 mb-3">
                <h3 className="font-semibold text-purple-900 mb-2">Usage Overage</h3>
                <p className="text-sm text-purple-700">
                  Credits consumed beyond monthly allowance billed at your plan's overage rate
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">Credit Consumption Guide</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-semibold text-gray-900">LLM Query</div>
                <div className="text-gray-600">1 credit / 1K tokens</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-semibold text-gray-900">Vision Batch</div>
                <div className="text-gray-600">5 credits / 100 frames</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-semibold text-gray-900">Optimizer Job</div>
                <div className="text-gray-600">500 credits / job</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-semibold text-gray-900">Simulator Run</div>
                <div className="text-gray-600">1000 credits / run</div>
              </div>
            </div>
          </div>
        </div>

        {/* Enterprise CTA */}
        <div className="mt-8 bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl p-8 text-white text-center">
          <h2 className="text-2xl font-bold mb-2">Need a Custom Solution?</h2>
          <p className="text-teal-100 mb-6">
            Enterprise plan includes gain-share pricing based on performance improvements
          </p>
          <button className="px-6 py-3 bg-white text-teal-600 rounded-lg font-semibold hover:bg-teal-50 transition-colors">
            Contact Sales
          </button>
        </div>
      </div>
    </div>
  );
}
