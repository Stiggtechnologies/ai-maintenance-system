import { AuthShell } from "../components/AuthShell";
import { AuthTabs } from "../components/AuthTabs";
import { ENTERPRISE_SSO_DISABLED_MESSAGE } from "../lib/azure-ad";
import { ShieldAlert } from "lucide-react";

interface EnterpriseAccessProps {
  onSuccess: () => void;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

/**
 * Enterprise federation is intentionally unavailable until verified OIDC
 * identity exchange, tenant mapping, provisioning, and Supabase session
 * establishment are implemented end to end.
 */
export function EnterpriseAccess({ onTabChange }: EnterpriseAccessProps) {
  return (
    <AuthShell>
      <div className="bg-industrial-slate rounded-xl p-8 border border-industrial-border backdrop-blur-xs">
        <AuthTabs activeTab="enterprise" onTabChange={onTabChange} />

        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold text-industrial-text">
                Enterprise SSO is not enabled
              </h2>
              <p className="mt-1 text-sm text-industrial-muted">
                {ENTERPRISE_SSO_DISABLED_MESSAGE}
              </p>
            </div>
          </div>

          <p className="text-sm text-industrial-muted">
            This page does not accept company codes, employee identifiers, or
            MFA codes. Those values are not a substitute for verified identity,
            tenant assignment, and an authenticated Supabase session.
          </p>

          <button
            type="button"
            onClick={() => onTabChange("signin")}
            className="w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white transition-colors hover:bg-[#2E7AE6]"
          >
            Return to approved sign-in
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
