import { motion } from "framer-motion";
import { ArrowLeft, FileCheck, KeyRound, Shield, UsersRound } from "lucide-react";

interface SecurityProps {
  onNavigate: (page: "signin" | "signup" | "enterprise" | "app" | "security" | "privacy" | "terms") => void;
}

const controls = [
  [Shield, "Tenant isolation", "Organization-scoped Row Level Security and guarded server functions are used to keep customer data within its authorized tenant boundary."],
  [UsersRound, "Human authority", "Consequential recommendations remain subject to named technical and operational approval boundaries. SyncAI does not present the model as the final approver."],
  [FileCheck, "Traceability", "Governed workflows retain evidence references, decision state, approvals, and audit/security events where those controls are implemented."],
  [KeyRound, "Identity controls", "Authentication is provided through the configured identity layer. Enterprise SSO or additional identity controls are represented as available only when enabled for the customer environment."],
] as const;

export function Security({ onNavigate }: SecurityProps) {
  return <div className="min-h-screen bg-industrial-black py-16 px-6"><div className="max-w-4xl mx-auto"><button onClick={() => onNavigate("signin")} className="mb-8 flex items-center gap-2 text-industrial-muted hover:text-industrial-text"><ArrowLeft className="w-4 h-4" />Back to Sign In</button><motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Security posture</p><h1 className="mt-3 text-4xl font-semibold text-industrial-text">Describe the controls that exist. Do not overstate the ones still being validated.</h1><p className="mt-5 text-industrial-muted leading-7">SyncAI is designed around tenant isolation, governed decision rights, human approval, and evidence traceability. Public security statements are limited to controls we can support with current implementation evidence.</p></motion.div><div className="mt-10 grid gap-5 md:grid-cols-2">{controls.map(([Icon,title,description]) => <div key={title} className="rounded-xl border border-industrial-border bg-industrial-slate p-6"><Icon className="w-5 h-5 text-teal-300" /><h2 className="mt-4 text-lg font-semibold text-industrial-text">{title}</h2><p className="mt-2 text-sm leading-6 text-industrial-muted">{description}</p></div>)}</div><div className="mt-8 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-6"><h2 className="font-semibold text-industrial-text">Certifications and assurance</h2><p className="mt-2 text-sm leading-6 text-industrial-muted">SyncAI does not claim SOC 2 Type II, ISO 27001, HIPAA certification/readiness, or other third-party assurance publicly unless that status is formally achieved, current, and within the represented scope. Current control evidence and deployment-specific security requirements can be reviewed during enterprise diligence.</p></div><p className="mt-8 text-sm text-industrial-muted">Security questions: <a className="text-[#3A8DFF] hover:underline" href="mailto:security@syncai.ca">security@syncai.ca</a></p></div></div>;
}
