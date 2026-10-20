import { useCallback, useEffect, useState } from "react";
import { Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  getCurrentSecurityPosture,
  type SecurityPosture,
} from "../services/securityPolicyService";
import { useAuth } from "./AuthProvider";
import { BrandWordmark } from "./BrandWordmark";
import { MfaManager } from "./MfaManager";

export function MfaAccessGate({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuth();
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshPosture = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getCurrentSecurityPosture();
      setPosture(next);
    } catch (caught) {
      setPosture(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Security posture could not be verified.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPosture();
  }, [refreshPosture]);

  const refreshAfterEnrollment = async () => {
    await supabase.auth.refreshSession();
    await refreshPosture();
  };

  const verifyChallenge = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data: factors, error: factorError } =
        await supabase.auth.mfa.listFactors();
      if (factorError) throw new Error(factorError.message);
      const factor = factors?.totp?.find((item) => item.status === "verified");
      if (!factor) throw new Error("No verified authenticator is available.");

      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError) throw new Error(challengeError.message);
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw new Error(verifyError.message);
      await supabase.auth.refreshSession();
      const next = await getCurrentSecurityPosture();
      if (!next.satisfied) {
        throw new Error("AAL2 assurance was not established.");
      }
      setPosture(next);
      setCode("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That code could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!loading && posture?.satisfied) return <>{children}</>;

  return (
    <main className="min-h-screen bg-overlook-void px-4 py-10 text-overlook-paper">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <BrandWordmark />
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-lg border border-overlook-rule px-3 py-2 text-sm text-overlook-mist hover:border-signal-cyan/50 hover:text-signal-cyan"
          >
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>

        <section className="glass rounded-2xl border border-white/8 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="rounded-xl border border-signal-cyan/25 bg-signal-cyan/8 p-3 text-signal-cyan">
              {posture?.verifiedFactorCount ? (
                <ShieldCheck size={24} aria-hidden />
              ) : (
                <LockKeyhole size={24} aria-hidden />
              )}
            </span>
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-signal-cyan uppercase">
                Workspace assurance
              </p>
              <h1 className="mt-2 text-2xl font-semibold">
                {posture?.verifiedFactorCount
                  ? "Verify your second factor"
                  : "Secure this account before continuing"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-overlook-mist">
                {posture?.required
                  ? "Your organization requires verified multi-factor assurance for this role. Tenant records remain unavailable until enrollment and AAL2 verification are complete."
                  : "SyncAI could not establish the assurance required to open this workspace."}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-8 flex items-center gap-2 text-sm text-overlook-mist">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Verifying security posture…
            </div>
          ) : posture?.required && posture.verifiedFactorCount === 0 ? (
            <div className="mt-7">
              <MfaManager
                protectLastFactor
                onAssuranceChange={refreshAfterEnrollment}
              />
            </div>
          ) : posture?.required ? (
            <form
              onSubmit={verifyChallenge}
              className="mt-7 max-w-sm space-y-4"
            >
              <div>
                <label
                  htmlFor="workspace-mfa-code"
                  className="text-sm font-medium"
                >
                  Authenticator code
                </label>
                <input
                  id="workspace-mfa-code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  className="mt-2 w-full rounded-lg border border-overlook-rule bg-overlook-void/70 px-4 py-3 text-center tracking-[0.4em] focus:border-signal-cyan focus:outline-hidden focus:ring-1 focus:ring-signal-cyan"
                />
              </div>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-400 px-4 py-3 font-semibold text-slate-950 hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Verify and enter workspace
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => void refreshPosture()}
              className="mt-7 rounded-lg border border-signal-cyan/35 px-4 py-2 text-sm font-semibold text-signal-cyan hover:bg-signal-cyan/8"
            >
              Retry verification
            </button>
          )}

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-red-500/25 bg-red-500/8 p-3 text-sm text-red-300"
            >
              {error}
            </p>
          )}
          <p className="mt-7 border-t border-white/8 pt-4 text-xs leading-5 text-overlook-haze">
            MFA establishes identity assurance only. It does not approve
            engineering recommendations, change delegated authority, or
            authorize plant action.
          </p>
        </section>
      </div>
    </main>
  );
}
