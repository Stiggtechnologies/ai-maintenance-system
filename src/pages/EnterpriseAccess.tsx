import { AuthShell } from "../components/AuthShell";
import { AuthTabs } from "../components/AuthTabs";
import { signInWithAzureAD } from "../lib/azure-ad";
import { Building2, ShieldCheck } from "lucide-react";
import { useState } from "react";

interface EnterpriseAccessProps {
  onSuccess: () => void;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

/**
 * Enterprise federation establishes identity only. Organization membership
 * and Marketplace entitlement remain separate, server-governed controls.
 */
export function EnterpriseAccess({ onTabChange }: EnterpriseAccessProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    () => new URLSearchParams(window.location.search).get("error") ?? "",
  );

  const handleMicrosoftSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      await signInWithAzureAD();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microsoft Entra sign-in is temporarily unavailable.",
      );
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border backdrop-blur-xs">
        <AuthTabs activeTab="enterprise" onTabChange={onTabChange} />

        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 p-4">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-signal-cyan"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold text-industrial-text">
                Verified Microsoft work identity
              </h2>
              <p className="mt-1 text-sm text-industrial-muted">
                Sign in through Microsoft Entra. Supabase validates the
                provider response and establishes the SyncAI application
                session.
              </p>
            </div>
          </div>

          <p className="text-sm text-industrial-muted">
            Signing in proves identity; it does not assign a customer tenant,
            elevate a role, activate a Marketplace purchase, or authorize an
            engineering decision. Those controls remain independently governed.
          </p>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleMicrosoftSignIn}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f6fed] px-4 py-3 font-medium text-white transition-colors hover:bg-[#255fd2] disabled:cursor-wait disabled:opacity-70"
          >
            <Building2 className="h-5 w-5" aria-hidden="true" />
            {loading ? "Opening Microsoft…" : "Continue with Microsoft"}
          </button>

          <button
            type="button"
            onClick={() => onTabChange("signin")}
            className="w-full rounded-lg border border-industrial-border px-4 py-3 font-medium text-industrial-text transition-colors hover:border-signal-cyan/40 hover:text-signal-cyan"
          >
            Use email sign-in
          </button>
        </div>

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
