import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

interface PrivacyProps {
  onNavigate: (page: 'signin' | 'signup' | 'enterprise' | 'app' | 'pricing' | 'security' | 'privacy' | 'terms') => void;
}

export function Privacy({ onNavigate }: PrivacyProps) {
  return (
    <div className="min-h-screen bg-[#0B0F14] py-16 px-6">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => onNavigate('signin')}
          className="flex items-center gap-2 text-[#9BA7B4] hover:text-[#E6EDF3] mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sign In
        </button>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <h1 className="text-4xl font-semibold text-[#E6EDF3] mb-4">Privacy Policy</h1>
          <p className="text-[#9BA7B4]">Last updated: February 2026</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-[#161C24] border border-[#232A33] rounded-xl p-8 space-y-8"
        >
          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Introduction</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              SyncAI operates as a secure intelligence layer for industrial operations. This Privacy Policy explains how we collect, use, protect, and handle your operational data. Your trust is paramount, and we've designed our platform with data security at its core.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Information We Collect</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">Operational Data:</strong> Asset performance metrics, maintenance records, work orders, reliability data, failure analysis, and operational intelligence necessary to provide AI-driven insights.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Account Information:</strong> Name, work email, company, role, and industry to personalize your experience and provide relevant recommendations.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Usage Data:</strong> How you interact with the platform, queries submitted, features used, and session analytics to improve service quality.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Data Security Architecture</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">Encryption:</strong> All data is encrypted at rest using AES-256 and in transit using TLS 1.3. No operational data is transmitted without encryption.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Access Control:</strong> Row-level security policies ensure users can only access data within their authorization scope. Role-based access control (RBAC) governs all system interactions.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Audit Logging:</strong> Comprehensive audit trails record all data access and modifications. Enterprise customers receive detailed audit reports.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Multi-Factor Authentication:</strong> Enterprise tenants require MFA for enhanced security.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">How We Use Your Data</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                Your operational data powers SyncAI's intelligence layer. We use it to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Generate AI-driven operational insights and reliability recommendations</li>
                <li>Identify optimization opportunities and downtime drivers</li>
                <li>Provide risk assessment and financial impact analysis</li>
                <li>Improve model accuracy and intelligence quality</li>
                <li>Enable multi-agent autonomous execution (Enterprise tier)</li>
              </ul>
              <p className="font-semibold text-[#E6EDF3] mt-4">
                We never sell your data to third parties. Your operational intelligence remains yours.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Data Isolation</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              Each enterprise tenant operates in a logically isolated environment. No operational data is shared between customers. SyncAI operates as a secure intelligence layer—no operational data is shared externally without explicit authorization.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Compliance & Certifications</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>SyncAI maintains industry-leading security and compliance standards:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className="text-[#E6EDF3]">SOC 2 Type II:</strong> Annual third-party audits verify security controls</li>
                <li><strong className="text-[#E6EDF3]">ISO 27001:</strong> Information security management certification</li>
                <li><strong className="text-[#E6EDF3]">GDPR:</strong> Full compliance for European operations</li>
                <li><strong className="text-[#E6EDF3]">ISO 55000:</strong> Aligned with asset management standards</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Your Rights</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Access all data associated with your account</li>
                <li>Request data correction or deletion</li>
                <li>Export your operational data in standard formats</li>
                <li>Opt out of non-essential data collection</li>
                <li>Withdraw consent at any time</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Data Retention</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              Operational data is retained for the duration of your active subscription plus 90 days for recovery purposes. Upon request, we can permanently delete all data within 30 days. Enterprise customers may negotiate custom retention policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Third-Party Services</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              SyncAI uses select third-party infrastructure providers (hosting, authentication, monitoring) who are bound by strict data processing agreements. No third party has access to your raw operational data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Updates to This Policy</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              We may update this Privacy Policy to reflect operational changes or regulatory requirements. Enterprise customers will be notified 30 days in advance of material changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Contact Us</h2>
            <div className="text-[#9BA7B4] leading-relaxed">
              <p className="mb-3">For privacy inquiries or to exercise your rights:</p>
              <p>
                Email:{' '}
                <a href="mailto:privacy@syncai.com" className="text-[#3A8DFF] hover:underline">
                  privacy@syncai.com
                </a>
              </p>
              <p className="mt-2">
                Enterprise Support:{' '}
                <a href="mailto:enterprise@syncai.com" className="text-[#3A8DFF] hover:underline">
                  enterprise@syncai.com
                </a>
              </p>
            </div>
          </section>

          <div className="pt-6 border-t border-[#232A33] text-sm text-[#9BA7B4]">
            <p>
              Built for regulated industries including healthcare and industrial operations. SyncAI operates as a secure intelligence layer—no operational data is shared externally.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
