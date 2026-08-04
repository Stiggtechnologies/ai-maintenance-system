import { useState } from "react";
import { AuthShell } from "../components/AuthShell";
import { AuthTabs } from "../components/AuthTabs";
import { signIn } from "../lib/auth";
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
  onSuccess: () => void;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

export function Login({ onSuccess, onTabChange }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

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
      onSuccess();
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
        throw new Error("No verified authenticator is enrolled on this account.");
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

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That code could not be verified. Please try again.",
      );
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border backdrop-blur-xs">
        <AuthTabs activeTab="signin" onTabChange={onTabChange} />

        {mfaStep ? (
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
                  setMfaCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
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
              <label
                htmlFor="password"
                className="block text-sm font-medium text-industrial-text mb-2"
              >
                Password
              </label>
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

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-signal-gold hover:bg-signal-gold-soft text-overlook-void font-semibold tracking-wide rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Authenticating…" : "Access SyncAI"}
            </motion.button>

            <div className="rounded-lg border border-overlook-rule bg-overlook-void/40 p-3 text-xs text-overlook-haze">
              Only a verified Supabase session can enter the application.
              Authenticator verification is enforced for enrolled accounts.
              Enterprise federation remains disabled until its supported OIDC
              session path is complete.
            </div>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">
          build {__BUILD_SHA__}
        </p>

        <div className="mt-8 pt-6 border-t border-industrial-border">
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
