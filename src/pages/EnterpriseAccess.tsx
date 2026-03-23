import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { AuthTabs } from '../components/AuthTabs';
import { motion } from 'framer-motion';

interface EnterpriseAccessProps {
  onSuccess: () => void;
  onTabChange: (tab: 'signin' | 'signup' | 'enterprise' | 'privacy' | 'terms' | 'security') => void;
}

export function EnterpriseAccess({ onSuccess, onTabChange }: EnterpriseAccessProps) {
  const [formData, setFormData] = useState({
    companyCode: '',
    employeeId: '',
    mfaCode: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Mock validation - in production this would verify against enterprise SSO
    setTimeout(() => {
      if (formData.companyCode.toLowerCase() === 'demo') {
        onSuccess();
      } else {
        setError('Company code not recognized. Contact your system administrator.');
        setLoading(false);
      }
    }, 1000);
  };

  return (
    <AuthShell>
      <div className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm">
        <AuthTabs activeTab="enterprise" onTabChange={onTabChange} />

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="companyCode" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              Company Code
            </label>
            <input
              id="companyCode"
              type="text"
              value={formData.companyCode}
              onChange={(e) => setFormData({ ...formData, companyCode: e.target.value })}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors uppercase"
              placeholder="XXXX-XXXX"
              required
            />
            <p className="mt-2 text-xs text-[#9BA7B4]">Use your assigned company code.</p>
          </div>

          <div>
            <label htmlFor="employeeId" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              Employee ID
            </label>
            <input
              id="employeeId"
              type="text"
              value={formData.employeeId}
              onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors"
              required
            />
          </div>

          <div>
            <label htmlFor="mfaCode" className="block text-sm font-medium text-[#E6EDF3] mb-2">
              MFA Code
            </label>
            <input
              id="mfaCode"
              type="text"
              value={formData.mfaCode}
              onChange={(e) => setFormData({ ...formData, mfaCode: e.target.value })}
              className="w-full px-4 py-3 bg-[#0B0F14] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF] transition-colors text-center tracking-widest"
              placeholder="000000"
              maxLength={6}
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

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying...' : 'Access Enterprise Instance'}
          </button>

          <p className="text-sm text-center">
            <button type="button" className="text-[#3A8DFF] hover:underline">
              Request Enterprise Access
            </button>
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
