import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

interface TermsProps {
  onNavigate: (page: 'signin' | 'signup' | 'enterprise' | 'app' | 'pricing' | 'security' | 'privacy' | 'terms') => void;
}

export function Terms({ onNavigate }: TermsProps) {
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
          <h1 className="text-4xl font-semibold text-[#E6EDF3] mb-4">Terms of Service</h1>
          <p className="text-[#9BA7B4]">Last updated: February 2026</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-[#161C24] border border-[#232A33] rounded-xl p-8 space-y-8"
        >
          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">1. Agreement to Terms</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              By accessing or using SyncAI, you agree to be bound by these Terms of Service and all applicable laws and regulations. SyncAI provides industrial intelligence infrastructure for asset-intensive enterprises. If you do not agree with any of these terms, you are prohibited from using or accessing this service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">2. Service Description</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                SyncAI provides AI-driven operational intelligence for industrial operations, including:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Asset performance analysis and reliability insights</li>
                <li>Predictive maintenance recommendations</li>
                <li>Risk assessment and financial impact modeling</li>
                <li>Multi-agent autonomous execution (Enterprise tier)</li>
                <li>ISO 55000-aligned asset management intelligence</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">3. Account Registration & Security</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">Accuracy:</strong> You must provide accurate, current, and complete information during registration.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Security:</strong> You are responsible for maintaining the confidentiality of your account credentials. Enterprise accounts require multi-factor authentication.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Authorized Use:</strong> Your account may only be used by authorized personnel within your organization. You must notify us immediately of any unauthorized access.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">4. Acceptable Use Policy</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>You agree NOT to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Attempt unauthorized access to any part of the service or related systems</li>
                <li>Interfere with or disrupt the service or servers</li>
                <li>Use the service for any unlawful purpose or in violation of regulations</li>
                <li>Reverse engineer, decompile, or disassemble any portion of the platform</li>
                <li>Share your account credentials or allow unauthorized access</li>
                <li>Use the service to transmit malicious code or harmful content</li>
                <li>Scrape, mine, or extract data through automated means without authorization</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">5. Data Ownership & License</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">Your Data:</strong> You retain all ownership rights to your operational data. SyncAI does not claim ownership of any data you upload or generate through the service.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">License to SyncAI:</strong> You grant SyncAI a limited license to process, analyze, and store your data solely for the purpose of providing the service and improving platform intelligence.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Aggregated Data:</strong> SyncAI may use anonymized, aggregated data for research, benchmarking, and service improvement purposes.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">6. Service Levels & Availability</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">Explorer (Free Trial):</strong> Best-effort availability. No uptime guarantee. Limited to 10 sessions.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Professional:</strong> 99.5% monthly uptime target. Standard support response times.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Enterprise:</strong> 99.9% monthly uptime SLA with financial credits for violations. Priority support with dedicated account team.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">7. Payment Terms</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">Billing:</strong> Paid plans are billed monthly or annually in advance. Enterprise plans may have custom billing arrangements.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Refunds:</strong> No refunds for partial months. Enterprise customers may negotiate custom refund terms.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Price Changes:</strong> We reserve the right to modify pricing with 30 days notice. Enterprise contracts have locked pricing for the contract term.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">8. Intellectual Property</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              All intellectual property rights in SyncAI's platform, algorithms, models, and interface design remain the exclusive property of SyncAI. You receive a limited, non-exclusive, non-transferable license to use the service during your subscription term.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">9. Confidentiality</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              Both parties agree to maintain the confidentiality of any proprietary information disclosed during the use of the service. This includes operational data, system architecture, pricing, and strategic information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">10. Limitation of Liability</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                SyncAI provides operational intelligence and recommendations based on data analysis. These insights are advisory in nature. You remain responsible for all operational decisions, maintenance actions, and asset management strategies.
              </p>
              <p>
                To the maximum extent permitted by law, SyncAI shall not be liable for any indirect, incidental, consequential, or punitive damages, including loss of revenue, downtime costs, or operational losses.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">11. Indemnification</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              You agree to indemnify and hold harmless SyncAI from any claims, damages, or expenses arising from your use of the service, violation of these terms, or infringement of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">12. Termination</h2>
            <div className="space-y-3 text-[#9BA7B4] leading-relaxed">
              <p>
                <strong className="text-[#E6EDF3]">By You:</strong> You may cancel your subscription at any time. Access continues until the end of your billing period.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">By SyncAI:</strong> We may suspend or terminate accounts that violate these terms, pose security risks, or engage in fraudulent activity.
              </p>
              <p>
                <strong className="text-[#E6EDF3]">Effect of Termination:</strong> Upon termination, your access is revoked. Data is retained for 90 days for recovery purposes, then permanently deleted unless otherwise agreed.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">13. Modifications to Terms</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              We may modify these terms at any time. Material changes will be communicated via email 30 days in advance. Continued use of the service after changes constitute acceptance. Enterprise customers may negotiate change notification terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">14. Governing Law & Dispute Resolution</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              These terms are governed by the laws of the jurisdiction in which SyncAI is registered. Disputes shall be resolved through binding arbitration, except where prohibited by law. Enterprise customers may negotiate custom dispute resolution procedures.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">15. Compliance & Export</h2>
            <p className="text-[#9BA7B4] leading-relaxed">
              You agree to comply with all applicable export control laws and regulations. You may not use SyncAI in any country subject to trade embargoes or where such use would violate local law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">16. Contact Information</h2>
            <div className="text-[#9BA7B4] leading-relaxed">
              <p className="mb-3">For questions about these Terms of Service:</p>
              <p>
                Email:{' '}
                <a href="mailto:legal@syncai.com" className="text-[#3A8DFF] hover:underline">
                  legal@syncai.com
                </a>
              </p>
              <p className="mt-2">
                Enterprise Contracts:{' '}
                <a href="mailto:enterprise@syncai.com" className="text-[#3A8DFF] hover:underline">
                  enterprise@syncai.com
                </a>
              </p>
            </div>
          </section>

          <div className="pt-6 border-t border-[#232A33] text-sm text-[#9BA7B4]">
            <p>
              By using SyncAI, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
