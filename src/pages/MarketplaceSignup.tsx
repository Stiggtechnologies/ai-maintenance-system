import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { motion } from "framer-motion";
import {
  resolveMarketplaceToken,
  MarketplaceSubscription,
} from "../lib/azure-marketplace";
import { signInWithAzureAD } from "../lib/azure-ad";

type MarketplaceStep =
  | "loading"
  | "resolved"
  | "auth-in-progress"
  | "activation-complete"
  | "error";

interface ErrorState {
  type: "invalid-token" | "resolution-failed" | "activation-failed" | "unknown";
  message: string;
}

export function MarketplaceSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<MarketplaceStep>("loading");
  const [subscription, setSubscription] =
    useState<MarketplaceSubscription | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Extract and validate token from URL
  useEffect(() => {
    const marketplaceToken = searchParams.get("token");

    if (!marketplaceToken) {
      setError({
        type: "invalid-token",
        message:
          "No marketplace token found in URL. This page must be accessed from Azure Marketplace.",
      });
      setStep("error");
      return;
    }

    setToken(marketplaceToken);
    resolveTokenAndDisplaySubscription(marketplaceToken);
  }, [searchParams]);

  const resolveTokenAndDisplaySubscription = async (
    marketplaceToken: string,
  ) => {
    try {
      setStep("loading");
      const resolved = await resolveMarketplaceToken(marketplaceToken);
      setSubscription(resolved);
      setStep("resolved");
    } catch (err) {
      console.error("Failed to resolve marketplace token:", err);
      setError({
        type: "resolution-failed",
        message:
          err instanceof Error
            ? err.message
            : "Failed to resolve your marketplace subscription. Please try again or contact support.",
      });
      setStep("error");
    }
  };

  const handleAzureADSignIn = async () => {
    try {
      setStep("auth-in-progress");
      // Store subscription data in sessionStorage for the callback handler
      if (subscription) {
        sessionStorage.setItem(
          "marketplace_subscription",
          JSON.stringify(subscription),
        );
        sessionStorage.setItem("marketplace_token", token || "");
      }
      await signInWithAzureAD();
      // User will be redirected to Azure AD login
    } catch (err) {
      console.error("Failed to initiate Azure AD sign-in:", err);
      setError({
        type: "unknown",
        message:
          "Failed to initiate sign-in. Please check your configuration and try again.",
      });
      setStep("error");
    }
  };

  const handleActivationComplete = () => {
    // Navigate to the main application
    navigate("/overview");
  };

  const handleRetry = () => {
    if (token) {
      resolveTokenAndDisplaySubscription(token);
    }
  };

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm"
      >
        {/* Loading State */}
        {step === "loading" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
                Activating your SyncAI subscription...
              </h2>
              <p className="text-[#9BA7B4]">
                Please wait while we process your Azure Marketplace purchase.
              </p>
            </div>

            {/* Loading spinner */}
            <div className="flex justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 border-4 border-[#232A33] border-t-[#3A8DFF] rounded-full"
              />
            </div>
          </div>
        )}

        {/* Token Resolved - Show Subscription Details */}
        {step === "resolved" && subscription && (
          <div className="space-y-6">
            <div className="text-center">
              <motion.h2
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-2xl font-bold text-[#E6EDF3] mb-2"
              >
                Welcome to SyncAI!
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-[#9BA7B4]"
              >
                Complete your setup to start using SyncAI
              </motion.p>
            </div>

            {/* Subscription Details Card */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-[#0B0F14] border border-[#232A33] rounded-lg p-6 space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Plan</p>
                  <p className="text-sm font-semibold text-[#E6EDF3]">
                    {subscription.subscription.name || "Standard Plan"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Licenses</p>
                  <p className="text-sm font-semibold text-[#E6EDF3]">
                    {subscription.quantity} seats
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Billing Term</p>
                  <p className="text-sm font-semibold text-[#E6EDF3]">
                    {subscription.term || "Monthly"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Status</p>
                  <p className="text-sm font-semibold text-[#3A8DFF]">
                    {subscription.saasSubscriptionStatus || "Pending"}
                  </p>
                </div>
              </div>

              <div className="border-t border-[#232A33] pt-4">
                <p className="text-xs text-[#9BA7B4] mb-2">Account Details</p>
                <div className="space-y-2">
                  <p className="text-sm text-[#E6EDF3]">
                    <span className="text-[#9BA7B4]">Purchaser:</span>{" "}
                    {subscription.purchaser.emailId}
                  </p>
                  <p className="text-sm text-[#E6EDF3]">
                    <span className="text-[#9BA7B4]">Beneficiary:</span>{" "}
                    {subscription.beneficiary.emailId}
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Sign In with Azure AD Button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              onClick={handleAzureADSignIn}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-colors"
            >
              Sign in with Azure AD
            </motion.button>

            <p className="text-xs text-[#9BA7B4] text-center">
              You will be redirected to Microsoft Azure AD to authenticate your
              account.
            </p>
          </div>
        )}

        {/* Auth In Progress State */}
        {step === "auth-in-progress" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
                Completing your authentication...
              </h2>
              <p className="text-[#9BA7B4]">
                We're setting up your SyncAI account with your Azure AD
                credentials.
              </p>
            </div>

            <div className="flex justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 border-4 border-[#232A33] border-t-[#3A8DFF] rounded-full"
              />
            </div>
          </div>
        )}

        {/* Activation Complete State */}
        {step === "activation-complete" && (
          <div className="space-y-6">
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 100, damping: 15 }}
                className="inline-flex items-center justify-center w-16 h-16 bg-[#3A8DFF]/20 border border-[#3A8DFF]/50 rounded-full mb-4"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-3xl text-[#3A8DFF]"
                >
                  ✓
                </motion.span>
              </motion.div>

              <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
                You&apos;re all set!
              </h2>
              <p className="text-[#9BA7B4] mb-6">
                Your SyncAI subscription has been activated and is ready to use.
              </p>
            </div>

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              onClick={handleActivationComplete}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-colors"
            >
              Launch SyncAI
            </motion.button>
          </div>
        )}

        {/* Error State */}
        {step === "error" && error && (
          <div className="space-y-6">
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 100, damping: 15 }}
                className="inline-flex items-center justify-center w-16 h-16 bg-red-500/20 border border-red-500/50 rounded-full mb-4"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-3xl text-red-400"
                >
                  !
                </motion.span>
              </motion.div>

              <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
                {error.type === "invalid-token" && "Invalid Access Link"}
                {error.type === "resolution-failed" &&
                  "Failed to Load Subscription"}
                {error.type === "activation-failed" && "Activation Failed"}
                {error.type === "unknown" && "Something went wrong"}
              </h2>
              <p className="text-[#9BA7B4] mb-6">{error.message}</p>
            </div>

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              onClick={handleRetry}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-colors"
            >
              Try Again
            </motion.button>

            <p className="text-xs text-[#9BA7B4] text-center">
              If this problem persists, please contact{" "}
              <a
                href="mailto:support@syncai.com"
                className="text-[#3A8DFF] hover:underline"
              >
                support@syncai.com
              </a>
            </p>
          </div>
        )}
      </motion.div>
    </AuthShell>
  );
}
