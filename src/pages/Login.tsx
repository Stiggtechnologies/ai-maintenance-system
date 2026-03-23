import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { AuthTabs } from '../components/AuthTabs';
import { signIn } from '../lib/auth';
import { motion } from 'framer-motion';

interface LoginProps {
  onSuccess: () => void;
  onTabChange: (tab: 'signin' | 'signup' | 'enterprise' | 'privacy' | 'terms' | 'security') => void;
}

export function Login({ onSuccess, onTabChange }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn(email, password);

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
        <AuthTabs activeTab="signin" onTabChange={onTabChange} />

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              Work Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
              placeholder="your.email@company.com"
              required
            />
            <p className="mt-2 text-xs text-[#9BA7B4]">Use your enterprise work email.</p>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
              placeholder="••••••••"
              required
            />
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

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-[#9BA7B4] cursor-pointer">
              <input type="checkbox" className="rounded border-[#232A33]" />
              <span>Remember me</span>
            </label>
            <button type="button" className="text-[#3A8DFF] hover:underline">
              Forgot password?
            </button>
          </div>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Accessing...' : 'Access SyncAI'}
          </motion.button>

          <div className="space-y-3">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#232A33]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-[#161C24] text-[#9BA7B4]">Or continue with</span>
              </div>
            </div>

            <button
              type="button"
              className="w-full py-3 px-4 bg-[#11161D] hover:bg-[#161C24] border border-[#232A33] text-[#E6EDF3] font-medium rounded-lg transition-colors"
            >
              Microsoft Azure AD
            </button>
            <button
              type="button"
              className="w-full py-3 px-4 bg-[#11161D] hover:bg-[#161C24] border border-[#232A33] text-[#E6EDF3] font-medium rounded-lg transition-colors"
            >
              Google Workspace
            </button>

            <motion.button
              type="button"
              onClick={onSuccess}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#3A8DFF]/20 to-[#2E7AE6]/20 hover:from-[#3A8DFF]/30 hover:to-[#2E7AE6]/30 border border-[#3A8DFF]/30 text-[#3A8DFF] font-medium rounded-lg transition-all"
            >
              Try Demo Mode
            </motion.button>
          </div>

          <p className="text-xs text-[#9BA7B4] text-center">
            MFA enabled for enterprise tenants
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
