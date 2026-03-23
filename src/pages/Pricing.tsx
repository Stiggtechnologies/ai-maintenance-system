export function Pricing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">Pricing Plans</h1>
          <p className="text-slate-300">Choose the plan that works best for you</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
            <h3 className="text-xl font-semibold text-white mb-2">Starter</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">$29</span>
              <span className="text-slate-400">/month</span>
            </div>
            <ul className="space-y-3 text-slate-300">
              <li>Basic features</li>
              <li>Up to 10 users</li>
              <li>Email support</li>
            </ul>
          </div>

          <div className="bg-blue-600/20 border-2 border-blue-500 rounded-lg p-8">
            <h3 className="text-xl font-semibold text-white mb-2">Professional</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">$99</span>
              <span className="text-slate-400">/month</span>
            </div>
            <ul className="space-y-3 text-slate-300">
              <li>All features</li>
              <li>Unlimited users</li>
              <li>Priority support</li>
            </ul>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
            <h3 className="text-xl font-semibold text-white mb-2">Enterprise</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">Custom</span>
            </div>
            <ul className="space-y-3 text-slate-300">
              <li>Custom solutions</li>
              <li>Dedicated support</li>
              <li>SLA guarantee</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
