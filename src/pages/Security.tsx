import { motion } from 'framer-motion';
import { Shield, Lock, FileCheck, Eye, Key, Server, ArrowLeft } from 'lucide-react';

interface SecurityProps {
  onNavigate: (page: 'signin' | 'signup' | 'enterprise' | 'app' | 'pricing' | 'security' | 'privacy' | 'terms') => void;
}

export function Security({ onNavigate }: SecurityProps) {
  const features = [
    {
      icon: Lock,
      title: 'Role-Based Access Control',
      description:
        'Granular permissions ensure users only access data relevant to their role and responsibilities.',
    },
    {
      icon: Server,
      title: 'Row-Level Data Isolation',
      description:
        'Database-level security ensures complete data separation between organizations and tenants.',
    },
    {
      icon: FileCheck,
      title: 'Audit Logging',
      description:
        'Comprehensive activity logs track all system interactions for compliance and forensic analysis.',
    },
    {
      icon: Shield,
      title: 'Encrypted at Rest and in Transit',
      description: 'AES-256 encryption protects data storage; TLS 1.3 secures all network communications.',
    },
    {
      icon: Key,
      title: 'Multi-Factor Authentication',
      description:
        'Enterprise SSO integration with Azure AD, Okta, and Google Workspace, plus hardware token support.',
    },
    {
      icon: Eye,
      title: 'Zero Trust Architecture',
      description:
        'Every request is authenticated and authorized; no implicit trust within the network perimeter.',
    },
  ];

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
          className="text-center mb-16"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#3A8DFF]/10 rounded-2xl mb-6">
            <Shield className="w-8 h-8 text-[#3A8DFF]" />
          </div>
          <h1 className="text-4xl font-semibold text-[#E6EDF3] mb-4">
            Security by Architecture.
            <br />
            Not by Add-On.
          </h1>
          <p className="text-lg text-[#9BA7B4]">
            Built for regulated industries including healthcare and industrial operations
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{
                y: -4,
                borderColor: 'rgba(58, 141, 255, 0.3)',
                transition: { duration: 0.2 }
              }}
              transition={{ delay: index * 0.1 }}
              className="bg-[#161C24] border border-[#232A33] rounded-xl p-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-[#3A8DFF]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-5 h-5 text-[#3A8DFF]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">{feature.title}</h3>
                  <p className="text-sm text-[#9BA7B4] leading-relaxed">{feature.description}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-[#161C24] border border-[#232A33] rounded-xl p-8"
        >
          <h2 className="text-xl font-semibold text-[#E6EDF3] mb-4">Compliance & Certifications</h2>
          <div className="grid md:grid-cols-3 gap-4 text-center">
            {['SOC 2 Type II', 'ISO 27001', 'GDPR Ready'].map((cert) => (
              <div key={cert} className="bg-[#0B0F14] rounded-lg py-4 px-6 border border-[#232A33]">
                <span className="text-[#E6EDF3] font-medium">{cert}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-8 text-center"
        >
          <p className="text-sm text-[#9BA7B4]">
            For detailed security documentation or to request a security audit report, contact{' '}
            <a href="mailto:security@syncai.com" className="text-[#3A8DFF] hover:underline">
              security@syncai.com
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
