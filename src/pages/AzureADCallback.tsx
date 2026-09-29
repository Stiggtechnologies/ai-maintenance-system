import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingScreen } from "../components/LoadingScreen";
import {
  clearAzureADCallbackUrl,
  exchangeCodeForSession,
  handleAzureADCallback,
} from "../lib/azure-ad";
import { hasWorkspaceMembership } from "../lib/auth";
import { supabase } from "../lib/supabase";

export function AzureADCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const handleCallback = useCallback(async () => {
    try {
      const result = await handleAzureADCallback();
      try {
        const verified = await exchangeCodeForSession(result.code, result.flowId);

        const hasPendingMarketplacePurchase = Boolean(
          sessionStorage.getItem("marketplace_token") &&
            sessionStorage.getItem("marketplace_subscription"),
        );
        if (
          !hasPendingMarketplacePurchase &&
          !(await hasWorkspaceMembership(verified.user.id))
        ) {
          await supabase.auth.signOut();
          throw new Error(
            "Your Microsoft identity is verified, but it has not been provisioned into a SyncAI organization. Contact your administrator.",
          );
        }
      } catch (exchangeErr) {
        console.error("Code exchange failed:", exchangeErr);
        throw new Error(
          exchangeErr instanceof Error
            ? exchangeErr.message
            : "Failed to authenticate with Azure AD",
          { cause: exchangeErr },
        );
      } finally {
        clearAzureADCallbackUrl();
      }

      // Authentication and commerce are separate controls. A marketplace
      // purchase returns to its landing page; only the backend fulfillment
      // workflow may bind or activate that subscription.
      const hasPendingMarketplacePurchase = Boolean(
        sessionStorage.getItem("marketplace_token") &&
          sessionStorage.getItem("marketplace_subscription"),
      );
      navigate(
        hasPendingMarketplacePurchase
          ? "/marketplace/signup?resume=1"
          : "/overview",
      );
    } catch (err) {
      clearAzureADCallbackUrl();
      const errorMessage =
        err instanceof Error ? err.message : "Authentication failed";
      console.error("Azure AD callback error:", err);
      setError(errorMessage);

      // Redirect to login with error message after a delay
      setTimeout(() => {
        navigate(`/?view=enterprise&error=${encodeURIComponent(errorMessage)}`);
      }, 3000);
    }
  }, [navigate]);

  useEffect(() => {
    handleCallback();
  }, [handleCallback]);

  if (error) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-800/50 backdrop-blur-xs border border-slate-700 rounded-2xl shadow-2xl p-8">
            <div className="text-center space-y-4">
              <h2 className="text-xl font-bold text-red-400">
                Authentication Failed
              </h2>
              <p className="text-slate-300">{error}</p>
              <p className="text-sm text-slate-400">Redirecting to login...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <LoadingScreen />;
}
