import { useState } from 'react';
import { Check, Sparkles, Zap, Crown, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../AuthProvider';

interface Plan {
  code: string;
  name: string;
  tagline: string;
  price: number;
  period: string;
  icon: any;
  iconColor: string;
  gradient: string;
  popular?: boolean;
  features: string[];
  limits: {
    assets: number;
    sites: number;
    credits: string;
  };
}

const plans: Plan[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    tagline: 'Perfect for pilot programs',
    price: 4000,
    period: 'month',
    icon: Sparkles,
    iconColor: 'text-blue-600',
    gradient: 'from-blue-500 to-cyan-500',
    features: [
      '200 assets monitored',
      '1 site location',
      '250K AI credits/month',
      'Core 8 AI agents',
      'Email support',
      'Help center access',
      'Standard security'
    ],
    limits: {
      assets: 200,
      sites: 1,
      credits: '250K'
    }
  },
  {
    code: 'PRO',
    name: 'Professional',
    tagline: 'Scale your operations',
    price: 9000,
    period: 'month',
    icon: Zap,
    iconColor: 'text-purple-600',
    gradient: 'from-purple-500 to-pink-500',
    popular: true,
    features: [
      '1,000 assets monitored',
      '3 site locations',
      '1M AI credits/month',
      'All 15 AI agents',
      'Priority support (4h)',
      'Dedicated CSM',
      'CMMS integration',
      'Custom dashboards',
      'Advanced security'
    ],
    limits: {
      assets: 1000,
      sites: 3,
      credits: '1M'
    }
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Full autonomous operations',
    price: 18000,
    period: 'month',
    icon: Crown,
    iconColor: 'text-amber-600',
    gradient: 'from-amber-500 to-orange-500',
    features: [
      '3,000+ assets (unlimited)',
      '8+ sites (unlimited)',
      '5M+ AI credits/month',
      'All 15 AI agents',
      '24/7 premium support',
      'Technical Account Manager',
      'Custom integrations',
      'White-label options',
      'Gain-share eligible',
      'On-premise deployment',
      'SSO/SAML',
      'SLA guarantee'
    ],
    limits: {
      assets: 3000,
      sites: 8,
      credits: '5M'
    }
  }
];

export function PremiumCheckout() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectPlan = async (plan: Plan) => {
    if (!user) {
      setError('Please sign in to subscribe');
      return;
    }

    setLoading(plan.code);
    setError(null);

    try {
      const { data, error: apiError } = await supabase.functions.invoke('stripe-checkout/checkout', {
        body: {
          tenant_id: user.id,
          plan_code: plan.code
        }
      });

      if (apiError) throw apiError;

      if (data?.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 py-16 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center space-x-2 bg-teal-100 text-teal-800 px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            <span>Simple, Transparent Pricing</span>
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Start with a pilot, scale to enterprise. All plans include AI-powered insights and 24/7 monitoring.
          </p>
          <p className="text-sm text-gray-500 mt-4">
            All prices in CAD • Cancel anytime • 30-day money-back guarantee
          </p>
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {plans.map((plan) => (
            <div
              key={plan.code}
              className={`relative bg-white rounded-2xl shadow-xl border-2 transition-all duration-300 hover:shadow-2xl hover:scale-105 ${
                plan.popular ? 'border-purple-500' : 'border-gray-200'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-5 left-1/2 transform -translate-x-1/2">
                  <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg">
                    Most Popular
                  </div>
                </div>
              )}

              <div className="p-8">
                {/* Icon & Name */}
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${plan.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                  <plan.icon className="w-8 h-8 text-white" />
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <p className="text-gray-600 mb-6">{plan.tagline}</p>

                {/* Price */}
                <div className="mb-8">
                  <div className="flex items-baseline">
                    <span className="text-5xl font-bold text-gray-900">
                      ${plan.price.toLocaleString()}
                    </span>
                    <span className="text-gray-600 ml-2">/{plan.period}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Plus asset uplift beyond {plan.limits.assets} assets
                  </p>
                </div>

                {/* CTA Button */}
                <button
                  onClick={() => handleSelectPlan(plan)}
                  disabled={loading !== null}
                  className={`w-full py-4 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center space-x-2 ${
                    plan.popular
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg hover:shadow-xl'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {loading === plan.code ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <span>Get Started</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>

                {/* Features */}
                <div className="mt-8 space-y-4">
                  <p className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    What's Included:
                  </p>
                  <ul className="space-y-3">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-start space-x-3">
                        <Check className={`w-5 h-5 flex-shrink-0 ${plan.iconColor}`} />
                        <span className="text-gray-700 text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust Indicators */}
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-teal-600 mb-2">30 Days</div>
                <p className="text-gray-600">Money-back guarantee</p>
              </div>
              <div>
                <div className="text-3xl font-bold text-teal-600 mb-2">SOC 2</div>
                <p className="text-gray-600">Type II certified</p>
              </div>
              <div>
                <div className="text-3xl font-bold text-teal-600 mb-2">99.9%</div>
                <p className="text-gray-600">Uptime SLA</p>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ Link */}
        <div className="text-center mt-12">
          <p className="text-gray-600 mb-4">Need help choosing the right plan?</p>
          <div className="flex justify-center space-x-6">
            <a href="mailto:sales@syncai.ca" className="text-teal-600 hover:text-teal-700 font-medium">
              Talk to Sales
            </a>
            <span className="text-gray-300">•</span>
            <a href="#" className="text-teal-600 hover:text-teal-700 font-medium">
              View Pricing FAQ
            </a>
            <span className="text-gray-300">•</span>
            <a href="#" className="text-teal-600 hover:text-teal-700 font-medium">
              Schedule Demo
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
