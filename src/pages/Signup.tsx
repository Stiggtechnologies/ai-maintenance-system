import { useState } from "react";
import { AuthShell } from "../components/AuthShell";
import { AuthTabs } from "../components/AuthTabs";
import { signUp } from "../lib/auth";
import { motion } from "framer-motion";

interface SignupProps {
  onSuccess: () => void;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

export function Signup({ onSuccess, onTabChange }: SignupProps) {
  const [formData, setFormData] = useState({
    fullName: "", company: "", role: "", industry: "", email: "", password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long");
      setLoading(false);
      return;
    }

    const result = await signUp(formData);
    if (!result.success) {
      setError(result.error?.message || "We could not create your evaluation workspace.");
      setLoading(false);
      return;
    }

    if (result.requiresConfirmation) {
      setConfirmationEmail(formData.email);
      setLoading(false);
      return;
    }

    // Route through the canonical sign-in transition. That transition persists
    // any staged public Reliability Engineer Decision Case before entering the app.
    onSuccess();
    window.location.assign("/signin?returnTo=/mission-control");
  };

  if (confirmationEmail) {
    return (
      <AuthShell>
        <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border">
          <h1 className="text-2xl font-semibold text-industrial-text">Verify your work email</h1>
          <p className="mt-3 text-sm leading-6 text-industrial-muted">
            We sent a confirmation link to <strong className="text-industrial-text">{confirmationEmail}</strong>.
            Keep this tab open while you verify so the Reliability Engineer case you started remains staged for handoff.
          </p>
          <button onClick={() => onTabChange("signin")} className="mt-6 w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white">
            Continue to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  const inputClass = "w-full px-4 py-3 bg-industrial-black border border-industrial-border rounded-lg text-industrial-text focus:outline-hidden focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF]";
  return (
    <AuthShell>
      <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border backdrop-blur-xs">
        <AuthTabs activeTab="signup" onTabChange={onTabChange} />
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-industrial-text">Create a private evaluation workspace</h1>
          <p className="mt-2 text-sm leading-6 text-industrial-muted">
            Continue the Reliability Engineer work you started. Self-signups receive an isolated evaluation organization; production tenant membership remains invitation-controlled.
          </p>
        </div>
        <form onSubmit={handleSignup} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-industrial-text">Full Name<input aria-label="Full Name" className={`${inputClass} mt-2`} value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required /></label>
            <label className="text-sm font-medium text-industrial-text">Company<input aria-label="Company" className={`${inputClass} mt-2`} value={formData.company} onChange={(e) => setFormData({ ...formData, company: e.target.value })} required /></label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-industrial-text">Role<select aria-label="Role" className={`${inputClass} mt-2`} value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} required><option value="">Select role</option><option value="reliability">Reliability Engineer</option><option value="maintenance">Maintenance Planner</option><option value="operations">Operations Manager</option><option value="vp">VP Operations</option><option value="executive">Executive</option></select></label>
            <label className="text-sm font-medium text-industrial-text">Industry<select aria-label="Industry" className={`${inputClass} mt-2`} value={formData.industry} onChange={(e) => setFormData({ ...formData, industry: e.target.value })} required><option value="">Select industry</option><option value="oil-gas">Oil & Gas</option><option value="mining">Mining</option><option value="utilities">Utilities</option><option value="power-generation">Power Generation</option><option value="manufacturing">Manufacturing</option><option value="transportation-logistics">Transportation & Logistics</option><option value="marine-shipping">Marine & Shipping</option><option value="heavy-equipment">Heavy Equipment</option><option value="other">Other asset-intensive industry</option></select></label>
          </div>
          <label className="block text-sm font-medium text-industrial-text">Work Email<input aria-label="Work Email" type="email" autoComplete="email" className={`${inputClass} mt-2`} value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required /></label>
          <label className="block text-sm font-medium text-industrial-text">Password<input aria-label="Password" type="password" autoComplete="new-password" className={`${inputClass} mt-2`} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} minLength={8} required /><span className="mt-2 block text-xs text-industrial-muted">Minimum 8 characters.</span></label>
          {error && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</motion.div>}
          <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.99 }} className="w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white disabled:opacity-50">{loading ? "Creating workspace…" : "Continue Reliability Engineer"}</motion.button>
          <p className="text-center text-xs leading-5 text-industrial-muted">Evaluation access is isolated from customer production tenants. Enterprise access is granted through an authorized organization invitation.</p>
        </form>
        <div className="mt-7 flex justify-center gap-4 border-t border-industrial-border pt-5 text-xs text-industrial-muted">
          <button onClick={() => onTabChange("security")} className="hover:text-industrial-text">Security</button><span>•</span><button onClick={() => onTabChange("privacy")} className="hover:text-industrial-text">Privacy</button><span>•</span><button onClick={() => onTabChange("terms")} className="hover:text-industrial-text">Terms</button>
        </div>
      </div>
    </AuthShell>
  );
}
