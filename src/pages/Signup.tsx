import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { AuthTabs } from '../components/AuthTabs';
import { signUp } from '../lib/auth';
import { motion } from 'framer-motion';

interface SignupProps {
  onSuccess: () => void;
  onTabChange: (tab: 'signin' | 'signup' | 'enterprise' | 'privacy' | 'terms' | 'security') => void;
}

export function Signup({ onSuccess, onTabChange }: SignupProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    company: '',
    role: '',
    industry: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      setLoading(false);
      return;
    }

    const result = await signUp({
      email: formData.email,
      password: formData.password,
      fullName: formData.fullName,
      company: formData.company,
      role: formData.role,
      industry: formData.industry,
    });

    if (!result.success && result.error) {
      setError(result.error.message);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <AuthShell>
      <div className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm">
        <AuthTabs activeTab="signup" onTabChange={onTabChange} />

        <form onSubmit={handleSignup} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-[#E6EDF3] mb-2">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
                required
              />
            </div>
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-[#E6EDF3] mb-2">
                Company
              </label>
              <input
                id="company"
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-[#E6EDF3] mb-2">
                Role
              </label>
              <select
                id="role"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
                required
              >
                <option value="">Select role</option>
                <option value="reliability">Reliability Engineer</option>
                <option value="maintenance">Maintenance Planner</option>
                <option value="operations">Operations Manager</option>
                <option value="vp">VP Operations</option>
                <option value="executive">Executive</option>
              </select>
            </div>
            <div>
              <label htmlFor="industry" className="block text-sm font-medium text-[#E6EDF3] mb-2">
                Industry
              </label>
              <select
                id="industry"
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
                required
              >
                <option value="">Select industry</option>
                <option value="oil-gas">Oil & Gas</option>
                <option value="mining">Mining</option>
                <option value="utilities">Utilities</option>
                <option value="power-generation">Power Generation</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="pharmaceuticals">Pharmaceuticals</option>
                <option value="food-beverage">Food & Beverage</option>
                <option value="transportation-logistics">Transportation & Logistics</option>
                <option value="aviation">Aviation</option>
                <option value="marine-shipping">Marine & Shipping</option>
                <option value="data-centers">Data Centers</option>
                <option value="heavy-equipment">Heavy Equipment</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              Work Email
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
              placeholder="your.email@company.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
              placeholder="••••••••"
              minLength={8}
              required
            />
            <p className="mt-2 text-xs text-[#9BA7B4]">Minimum 8 characters required</p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating Account...' : 'Start Industrial Trial'}
          </motion.button>

          <p className="text-sm text-center text-[#9BA7B4]">
            10 full-capability sessions included. No credit card required.
          </p>
        </form>

        <div className="mt-8 pt-6 border-t border-[#232A33]">
          <div className="flex justify-center gap-4 text-xs text-[#9BA7B4]">
            <button
              onClick={() => onTabChange('security')}
              className="hover:text-[#E6EDF3] transition-colors"
            >
              Security
            </button>
            <span>•</span>
            <button
              onClick={() => onTabChange('privacy')}
              className="hover:text-[#E6EDF3] transition-colors"
            >
              Privacy
            </button>
            <span>•</span>
            <button
              onClick={() => onTabChange('terms')}
              className="hover:text-[#E6EDF3] transition-colors"
            >
              Terms
            </button>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
