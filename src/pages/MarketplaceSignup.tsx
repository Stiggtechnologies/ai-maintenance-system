import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { signInWithAzureAD } from "../lib/azure-ad";
import {
  activateMarketplaceSubscription,
  getMarketplaceSubscriptionStatus,
  MARKETPLACE_FULFILLMENT_STORAGE_KEY,
  marketplaceContext,
  parseMarketplaceContext,
  resolveMarketplaceToken,
  type MarketplaceFulfillmentContext,
} from "../lib/azure-marketplace";

type MarketplaceStep =
  | "loading"
  | "resolved"
  | "auth-in-progress"
  | "identity-verified"
  | "activating"
  | "activation-pending"
  | "activation-complete"
  | "error";

interface ErrorState {
  type: "invalid-token" | "resolution-failed" | "activation-failed";
  message: string;
}

function retainContext(context: MarketplaceFulfillmentContext): void {
  sessionStorage.setItem(
    MARKETPLACE_FULFILLMENT_STORAGE_KEY,
    JSON.stringify(context),
  );
}

function clearContext(): void {
  sessionStorage.removeItem(MARKETPLACE_FULFILLMENT_STORAGE_KEY);
}

function statusLabel(
  status: MarketplaceFulfillmentContext["subscription"]["status"],
): string {
  const labels = {
    PendingFulfillmentStart: "Awaiting activation",
    Subscribed: "Subscribed",
    Suspended: "Suspended",
    Unsubscribed: "Unsubscribed",
  } as const;
  return labels[status];
}

export function MarketplaceSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.toString();
  const [step, setStep] = useState<MarketplaceStep>("loading");
  const [context, setContext] = useState<MarketplaceFulfillmentContext | null>(
    null,
  );
  const [error, setError] = useState<ErrorState | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(query);

    if (params.get("resume") === "1") {
      const pending = parseMarketplaceContext(
        sessionStorage.getItem(MARKETPLACE_FULFILLMENT_STORAGE_KEY),
      );
      if (pending) {
        setContext(pending);
        setStep("identity-verified");
      } else {
        clearContext();
        setError({
          type: "activation-failed",
          message:
            "The pending purchase context is missing or expired. Return to Azure Marketplace to restart activation.",
        });
        setStep("error");
      }
      return () => {
        active = false;
      };
    }

    const purchaseToken = params.get("token");
    if (!purchaseToken) {
      setError({
        type: "invalid-token",
        message:
          "No Marketplace purchase token was supplied. Open this page from the SyncAI offer in Azure Marketplace.",
      });
      setStep("error");
      return () => {
        active = false;
      };
    }

    // The Microsoft purchase token is single-purpose, URL-encoded evidence.
    // Remove it before any network request, navigation, analytics or storage.
    const scrubbed = new URL(window.location.href);
    scrubbed.searchParams.delete("token");
    window.history.replaceState(
      window.history.state,
      document.title,
      `${scrubbed.pathname}${scrubbed.search}${scrubbed.hash}`,
    );

    void resolveMarketplaceToken(purchaseToken)
      .then((resolution) => {
        if (!active) return;
        const pending = marketplaceContext(resolution);
        retainContext(pending);
        setContext(pending);
        setStep("resolved");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError({
          type: "resolution-failed",
          message:
            cause instanceof Error
              ? cause.message
              : "The Marketplace purchase could not be resolved. Return to Azure Marketplace or contact SyncAI support.",
        });
        setStep("error");
      });

    return () => {
      active = false;
    };
  }, [query]);

  const handleAzureADSignIn = async () => {
    if (!context) return;
    try {
      setStep("auth-in-progress");
      retainContext(context);
      await signInWithAzureAD();
    } catch {
      setError({
        type: "activation-failed",
        message:
          "Microsoft sign-in could not be started. Verify the enterprise sign-in configuration or contact SyncAI support.",
      });
      setStep("error");
    }
  };

  const applyFulfillment = async (action: "activate" | "status") => {
    if (!context) return;
    try {
      setError(null);
      setStep("activating");
      const result =
        action === "activate"
          ? await activateMarketplaceSubscription(context)
          : await getMarketplaceSubscriptionStatus(context);
      const updated = { ...context, subscription: result.subscription };
      setContext(updated);
      if (result.state === "active") {
        clearContext();
        setStep("activation-complete");
      } else {
        retainContext(updated);
        setStep("activation-pending");
      }
    } catch (cause) {
      setError({
        type: "activation-failed",
        message:
          cause instanceof Error
            ? cause.message
            : "Activation could not be completed. Try again or contact SyncAI support.",
      });
      setStep("error");
    }
  };

  const launch = () => {
    clearContext();
    navigate("/deployments/new/configure?implementation=1");
  };

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border border-industrial-border bg-industrial-slate p-8 backdrop-blur-xs"
      >
        {(step === "loading" ||
          step === "auth-in-progress" ||
          step === "activating") && (
          <div className="space-y-6 text-center">
            <div>
              <h2 className="mb-2 text-2xl font-bold text-industrial-text">
                {step === "loading"
                  ? "Verifying your SyncAI purchase"
                  : step === "auth-in-progress"
                    ? "Opening Microsoft sign-in"
                    : "Activating your subscription"}
              </h2>
              <p className="text-industrial-muted">
                {step === "activating"
                  ? "SyncAI is confirming the subscription directly with Microsoft."
                  : "This secure step can take a few seconds."}
              </p>
            </div>
            <div className="flex justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="h-12 w-12 rounded-full border-4 border-industrial-border border-t-[#3A8DFF]"
              />
            </div>
          </div>
        )}

        {step === "resolved" && context && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="mb-2 text-2xl font-bold text-industrial-text">
                Purchase verified
              </h2>
              <p className="text-industrial-muted">
                Sign in with the Microsoft tenant that purchased or will use
                SyncAI. Activation requires an existing SyncAI organization
                administrator.
              </p>
            </div>
            <SubscriptionCard context={context} />
            <button
              type="button"
              onClick={() => void handleAzureADSignIn()}
              className="w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white transition-colors hover:bg-[#2E7AE6]"
            >
              Continue with Microsoft
            </button>
            <p className="text-center text-xs text-industrial-muted">
              Resolving a purchase does not create a tenant, grant membership or
              start an entitlement.
            </p>
          </div>
        )}

        {step === "identity-verified" && context && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-3xl text-emerald-300">
              ✓
            </div>
            <div>
              <h2 className="text-2xl font-bold text-industrial-text">
                Microsoft identity verified
              </h2>
              <p className="mt-2 text-industrial-muted">
                Review the purchase, then explicitly activate it for your
                existing SyncAI organization. Microsoft remains authoritative
                for the subscription status.
              </p>
            </div>
            <SubscriptionCard context={context} />
            <button
              type="button"
              onClick={() => void applyFulfillment("activate")}
              className="w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white transition-colors hover:bg-[#2E7AE6]"
            >
              Activate subscription
            </button>
          </div>
        )}

        {step === "activation-pending" && context && (
          <div className="space-y-6 text-center">
            <div>
              <h2 className="text-2xl font-bold text-industrial-text">
                Activation submitted
              </h2>
              <p className="mt-2 text-industrial-muted">
                Microsoft has not yet reported this subscription as active. No
                active entitlement is being claimed until that status is
                confirmed.
              </p>
            </div>
            <SubscriptionCard context={context} />
            <button
              type="button"
              onClick={() => void applyFulfillment("status")}
              className="w-full rounded-lg border border-industrial-border px-4 py-3 font-medium text-industrial-text transition-colors hover:border-[#3A8DFF]/60 hover:text-[#3A8DFF]"
            >
              Check Microsoft status
            </button>
          </div>
        )}

        {step === "activation-complete" && context && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#3A8DFF]/50 bg-[#3A8DFF]/20 text-3xl text-[#3A8DFF]">
              ✓
            </div>
            <div>
              <h2 className="text-2xl font-bold text-industrial-text">
                Subscription active
              </h2>
              <p className="mt-2 text-industrial-muted">
                Microsoft confirms the SyncAI subscription is active for your
                governed workspace. Asset readiness and completed implementation
                still require evidence and customer acceptance.
              </p>
            </div>
            <SubscriptionCard context={context} />
            <button
              type="button"
              onClick={launch}
              className="w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white transition-colors hover:bg-[#2E7AE6]"
            >
              Continue implementation
            </button>
          </div>
        )}

        {step === "error" && error && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-red-500/50 bg-red-500/20 text-3xl text-red-400">
              !
            </div>
            <div>
              <h2 className="text-2xl font-bold text-industrial-text">
                Activation needs attention
              </h2>
              <p className="mt-2 text-industrial-muted">{error.message}</p>
            </div>
            {context && (
              <button
                type="button"
                onClick={() => setStep("identity-verified")}
                className="w-full rounded-lg bg-[#3A8DFF] px-4 py-3 font-medium text-white transition-colors hover:bg-[#2E7AE6]"
              >
                Review and try again
              </button>
            )}
            <a
              href="mailto:support@syncai.ca?subject=Azure%20Marketplace%20activation"
              className="inline-flex w-full justify-center rounded-lg border border-industrial-border px-4 py-3 font-medium text-industrial-text transition-colors hover:border-[#3A8DFF]/60 hover:text-[#3A8DFF]"
            >
              Contact SyncAI support
            </a>
          </div>
        )}
      </motion.div>
    </AuthShell>
  );
}

function SubscriptionCard({
  context,
}: {
  context: MarketplaceFulfillmentContext;
}) {
  const { subscription } = context;
  return (
    <div className="rounded-lg border border-industrial-border bg-industrial-black p-5 text-left">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-industrial-muted">Plan</p>
          <p className="mt-1 text-sm font-semibold text-industrial-text">
            {subscription.name || subscription.planId}
          </p>
        </div>
        <div>
          <p className="text-xs text-industrial-muted">Quantity</p>
          <p className="mt-1 text-sm font-semibold text-industrial-text">
            {subscription.quantity ?? "Plan managed"}
          </p>
        </div>
        <div>
          <p className="text-xs text-industrial-muted">Term</p>
          <p className="mt-1 text-sm font-semibold text-industrial-text">
            {subscription.termUnit ?? "Defined by plan"}
          </p>
        </div>
        <div>
          <p className="text-xs text-industrial-muted">Microsoft status</p>
          <p className="mt-1 text-sm font-semibold text-[#3A8DFF]">
            {statusLabel(subscription.status)}
          </p>
        </div>
      </div>
    </div>
  );
}
