import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { motion } from "framer-motion";
import {
  resolveAwsMarketplaceToken,
  AwsMarketplaceSubscription,
} from "../lib/aws-marketplace";

/**
 * AwsMarketplaceSignup
 * --------------------
 * Mirrors `MarketplaceSignup.tsx` (Azure) but for the AWS Marketplace
 * SaaS Listing flow. AWS redirects buyers to:
 *   https://app.syncai.ca/marketplace/aws/signup?x-amzn-marketplace-token=<token>
 *
 * The token is exchanged for a CustomerIdentifier via the
 * marketplace-aws-resolve Edge Function (which calls AWS ResolveCustomer).
 * After display, the buyer continues to standard email signup which links
 * the AWS subscription to their org.
 */

type AwsStep =
  | "loading"
  | "resolved"
  | "auth-in-progress"
  | "activation-complete"
  | "error";

interface ErrorState {
  type: "invalid-token" | "resolution-failed" | "activation-failed" | "unknown";
  message: string;
}

export function AwsMarketplaceSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<AwsStep>("loading");
  const [subscription, setSubscription] =
    useState<AwsMarketplaceSubscription | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // AWS canonical query param is "x-amzn-marketplace-token". Fall back to "token"
    // for manual testing.
    const marketplaceToken =
      searchParams.get("x-amzn-marketplace-token") ?? searchParams.get("token");

    if (!marketplaceToken) {
      setError({
        type: "invalid-token",
        message:
          "No AWS Marketplace token found in URL. This page must be accessed from AWS Marketplace.",
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
      const resolved = await resolveAwsMarketplaceToken(marketplaceToken);
      setSubscription(resolved);
      setStep("resolved");
      // Stash for post-signup linking
      try {
        sessionStorage.setItem(
          "aws_customer_identifier",
          resolved.customerIdentifier,
        );
        sessionStorage.setItem("aws_marketplace_token", marketplaceToken);
      } catch {
        /* private browsing */
      }
    } catch (err) {
      console.error("Failed to resolve AWS Marketplace token:", err);
      setError({
        type: "resolution-failed",
        message:
          err instanceof Error
            ? err.message
            : "Failed to resolve your AWS Marketplace subscription. Please try again or contact support.",
      });
      setStep("error");
    }
  };

  const handleContinueToSignup = () => {
    // Send buyer to email-based signup. The aws_customer_identifier is in
    // sessionStorage; on successful signup, the linkAwsCustomerToOrg helper
    // attaches the subscription to the new org.
    navigate("/?next=signup");
  };

  const handleRetry = () => {
    if (token) resolveTokenAndDisplaySubscription(token);
  };

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-[#161C24] rounded-xl p-8 border border-[#232A33] backdrop-blur-sm"
      >
        {step === "loading" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
                Activating your SyncAI subscription…
              </h2>
              <p className="text-[#9BA7B4]">
                Resolving your AWS Marketplace customer via the ResolveCustomer
                API.
              </p>
            </div>
            <div className="flex justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 border-4 border-[#232A33] border-t-[#FF9900] rounded-full"
              />
            </div>
          </div>
        )}

        {step === "resolved" && subscription && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[#E6EDF3] mb-2">
                Welcome from AWS Marketplace
              </h2>
              <p className="text-[#9BA7B4]">
                Your subscription is linked. One last step: create your SyncAI
                account.
              </p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-[#0B0F14] border border-[#232A33] rounded-lg p-6 space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Customer ID</p>
                  <p className="text-xs font-mono text-[#E6EDF3] truncate">
                    {subscription.customerIdentifier}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">AWS account</p>
                  <p className="text-xs font-mono text-[#E6EDF3]">
                    {subscription.customerAWSAccountId || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Product code</p>
                  <p className="text-xs font-mono text-[#E6EDF3]">
                    {subscription.productCode}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BA7B4] mb-1">Status</p>
                  <p className="text-sm font-semibold text-[#FF9900]">
                    {subscription.status.replace("aws_", "").replace(/_/g, " ")}
                  </p>
                </div>
              </div>
              <div className="border-t border-[#232A33] pt-4">
                <p className="text-xs text-[#9BA7B4]">
                  AWS will send a SubscribeSuccess event within ~5 minutes;
                  status will update to{" "}
                  <code className="bg-[#161C24] px-1 rounded">
                    aws_subscribed
                  </code>{" "}
                  automatically.
                </p>
              </div>
            </motion.div>

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              onClick={handleContinueToSignup}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-[#FF9900] hover:bg-[#E6890A] text-white font-medium rounded-lg transition-colors"
            >
              Continue to account setup
            </motion.button>
          </div>
        )}

        {step === "error" && error && (
          <div className="space-y-6">
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 100, damping: 15 }}
                className="inline-flex items-center justify-center w-16 h-16 bg-red-500/20 border border-red-500/50 rounded-full mb-4"
              >
                <span className="text-3xl text-red-400">!</span>
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
              onClick={handleRetry}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 bg-[#FF9900] hover:bg-[#E6890A] text-white font-medium rounded-lg transition-colors"
            >
              Try Again
            </motion.button>
            <p className="text-xs text-[#9BA7B4] text-center">
              If this problem persists, contact{" "}
              <a
                href="mailto:support@syncai.ca"
                className="text-[#FF9900] hover:underline"
              >
                support@syncai.ca
              </a>
            </p>
          </div>
        )}
      </motion.div>
    </AuthShell>
  );
}

export default AwsMarketplaceSignup;
