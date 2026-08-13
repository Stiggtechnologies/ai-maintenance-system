import { useState } from "react";
import { AuthShell } from "../components/AuthShell";
import { ArrowUpRight, KeyRound, LockKeyhole } from "lucide-react";
import { signIn } from "../lib/auth";
import { readDecisionCaseHandoff } from "../lib/decision-case";
import { supabase } from "../lib/supabase";
import { motion } from "framer-motion";

/** True when the signed-in user has a verified factor and must step up to AAL2. */
async function mfaChallengeRequired(): Promise<boolean> {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unable to verify authentication assurance.");
  return data.currentLevel === "aal1" && data.nextLevel === "aal2";
}

interface LoginProps {
  onSuccess: () => void | Promise<void>;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

export function Login({ onSuccess, onTabChange }: LoginProps) {
  const handoff = readDecisionCaseHandoff(window.sessionStorage);
  const journey = handoff?.decisionCase ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(
    () =>
      new URLSearchParams(window.location.search).get("mode") === "recovery",
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    const result = await signIn(email, password);

    if (!result.success && result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    try {
      if (await mfaChallengeRequired()) {
        setMfaStep(true);
        setLoading(false);
        return;
      }
      await onSuccess();
    } catch {
      // Password authentication alone is not enough when assurance state cannot
      // be established. End the partial session rather than failing open.
      await supabase.auth.signOut();
      setError(
        "Authentication assurance could not be verified. Please try again or contact your administrator.",
      );
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data: factors, error: factorError } =
        await supabase.auth.mfa.listFactors();
      if (factorError) throw new Error(factorError.message);
      const factor = factors?.totp?.find((item) => item.status === "verified");
      if (!factor) {
        throw new Error(
          "No verified authenticator is enrolled on this account.",
        );
      }

      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError) throw new Error(challengeError.message);

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: mfaCode.trim(),
      });
      if (verifyError) throw new Error(verifyError.message);

      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || assurance?.currentLevel !== "aal2") {
        throw new Error("Two-factor assurance was not established.");
      }

      await onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That code could not be verified. Please try again.",
      );
      setLoading(false);
    }
  };

  const requestPasswordReset = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your work email, then request a reset link.");
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}/signin?mode=recovery`,
      },
    );
    if (resetError) {
      setError(resetError.message);
    } else {
      setNotice(
        "Check your email for a secure password reset link. Your Decision Case will remain staged in this tab.",
      );
    }
    setLoading(false);
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    setRecoveryMode(false);
    await onSuccess();
  };

  return (
    <AuthShell journey={journey}>
      <div>
        <div className="mb-7">
          <span className="text-signal-cyan flex items-center gap-2 text-xs font-semibold tracking-[0.16em] uppercase">
            <LockKeyhole size={14} /> Secure workspace
          </span>
          <h2 className="text-overlook-paper mt-3 text-2xl font-semibold tracking-normal">
            {recoveryMode
              ? "Set a new password"
              : journey
                ? `Continue ${journey.caseNumber}`
                : "Welcome back"}
          </h2>
          <p className="text-overlook-mist mt-2 text-sm leading-relaxed">
            {recoveryMode
              ? "Choose a strong password to restore access to your governed workspace."
              : journey
                ? `${journey.asset} is staged and will be secured after authentication.`
                : "Use your verified work identity to enter SyncAI."}
          </p>
        </div>

        {recoveryMode ? (
          <form onSubmit={handlePasswordUpdate} className="space-y-6">
            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-medium text-industrial-text mb-2"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                className="w-full px-4 py-3 bg-overlook-void/60 border border-overlook-rule rounded-lg text-overlook-paper placeholder-overlook-haze focus:outline-hidden focus:border-signal-cyan/70 focus:ring-1 focus:ring-signal-cyan/50 transition-colors"
                placeholder="At least 12 characters"
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || newPassword.length < 12}
              className="w-full py-3 px-4 bg-signal-gold hover:bg-signal-gold-soft text-overlook-void font-semibold tracking-wide rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Updating…" : "Update password and continue"}
            </button>
          </form>
        ) : mfaStep ? (
          <form onSubmit={handleMfaVerify} className="space-y-6">
            <div>
              <label
                htmlFor="mfa-code"
                className="block text-sm font-medium text-industrial-text mb-2"
              >
                Two-factor code
              </label>
              <input
                id="mfa-code"
                value={mfaCode}
                onChange={(event) =>
                  setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className="w-full px-4 py-3 bg-overlook-void/60 border border-overlook-rule rounded-lg text-overlook-paper tracking-[0.4em] text-center placeholder-overlook-haze focus:outline-hidden focus:border-signal-cyan/70 focus:ring-1 focus:ring-signal-cyan/50 transition-colors"
                placeholder="123456"
                required
              />
              <p className="mt-2 text-xs text-industrial-muted">
                Enter the six-digit code from your authenticator app.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || mfaCode.length < 6}
              className="w-full py-3 px-4 bg-signal-gold hover:bg-signal-gold-soft text-overlook-void font-semibold tracking-wide rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-industrial-text mb-2"
              >
                Work email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                className="w-full px-4 py-3 bg-overlook-void/60 border border-overlook-rule rounded-lg text-overlook-paper placeholder-overlook-haze focus:outline-hidden focus:border-signal-cyan/70 focus:ring-1 focus:ring-signal-cyan/50 transition-colors"
                placeholder="your.email@company.com"
                required
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-industrial-text"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => void requestPasswordReset()}
                  disabled={loading}
                  className="text-overlook-mist hover:text-signal-cyan text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full px-4 py-3 bg-overlook-void/60 border border-overlook-rule rounded-lg text-overlook-paper placeholder-overlook-haze focus:outline-hidden focus:border-signal-cyan/70 focus:ring-1 focus:ring-signal-cyan/50 transition-colors"
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

            {notice && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-signal-cyan/25 bg-signal-cyan/10 text-overlook-paper rounded-lg border p-3 text-sm leading-relaxed"
              >
                {notice}
              </motion.div>
            )}

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-signal-gold hover:bg-signal-gold-soft text-overlook-void font-semibold tracking-wide rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Authenticating…" : "Access SyncAI"}
            </motion.button>

            <div className="border-overlook-rule border-t pt-4 text-xs leading-relaxed text-overlook-haze">
              Identity and approval authority are verified before governed
              actions can be released. Enrolled accounts must complete MFA.
            </div>
          </form>
        )}

        {!recoveryMode && !mfaStep && (
          <a
            href="/setup#value-proof-intake"
            className="text-overlook-mist hover:text-overlook-paper mt-6 flex items-center justify-center gap-2 text-sm font-semibold transition-colors"
          >
            <KeyRound size={15} /> New to SyncAI? Start a 48-hour value proof
            <ArrowUpRight size={14} />
          </a>
        )}

        <div className="mt-7 pt-5 border-t border-industrial-border">
          <div className="flex justify-center gap-4 text-xs text-industrial-muted">
            <button
              onClick={() => onTabChange("security")}
              className="hover:text-industrial-text transition-colors"
            >
              Security
            </button>
            <span>•</span>
            <button
              onClick={() => onTabChange("privacy")}
              className="hover:text-industrial-text transition-colors"
            >
              Privacy
            </button>
            <span>•</span>
            <button
              onClick={() => onTabChange("terms")}
              className="hover:text-industrial-text transition-colors"
            >
              Terms
            </button>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
