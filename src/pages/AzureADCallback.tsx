import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingScreen } from "../components/LoadingScreen";
import { handleAzureADCallback, exchangeCodeForSession } from "../lib/azure-ad";
import { activateMarketplaceSubscription } from "../lib/azure-marketplace";

export function AzureADCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const handleCallback = useCallback(async () => {
    try {
      // Extract code and state from URL parameters
      const result = await handleAzureADCallback();

      if (!result) {
        throw new Error("Invalid callback: missing code or state parameter");
      }

      const { code } = result;

      // Check if this is a marketplace signup flow
      const marketplaceToken = sessionStorage.getItem("marketplace_token");
      const subscriptionData = sessionStorage.getItem(
        "marketplace_subscription",
      );

      try {
        // Exchange code for session
        await exchangeCodeForSession(code);

        // If this is a marketplace flow, activate the subscription
        if (subscriptionData && marketplaceToken) {
          const subscription = JSON.parse(subscriptionData);
          try {
            await activateMarketplaceSubscription(
              subscription.subscription.id,
              subscription.planId,
              subscription.quantity,
            );
          } catch (activationErr) {
            // Log activation error but don't fail the callback
            console.error("Marketplace activation error:", activationErr);
            // User can still access the app, subscription may need manual activation
          }

          // Clean up session storage
          sessionStorage.removeItem("marketplace_token");
          sessionStorage.removeItem("marketplace_subscription");
        }

        // Redirect to the application
        navigate("/overview");
      } catch (exchangeErr) {
        console.error("Code exchange failed:", exchangeErr);
        throw new Error(
          exchangeErr instanceof Error
            ? exchangeErr.message
            : "Failed to authenticate with Azure AD",
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Authentication failed";
      console.error("Azure AD callback error:", err);
      setError(errorMessage);

      // Redirect to login with error message after a delay
      setTimeout(() => {
        navigate(`/login?error=${encodeURIComponent(errorMessage)}`);
      }, 3000);
    }
  }, [navigate]);

  useEffect(() => {
    handleCallback();
  }, [handleCallback]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl shadow-2xl p-8">
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
