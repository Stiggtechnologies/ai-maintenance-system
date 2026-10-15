import { AuthShell } from "./AuthShell";

/** Read-only landing gate until provider identity and canonical entitlement are verified. */
export function MarketplaceSetupUnavailable({
  provider,
}: {
  provider: "AWS Marketplace" | "Salesforce AppExchange";
}) {
  return (
    <AuthShell>
      <section aria-labelledby="marketplace-setup-title" className="space-y-5">
        <p className="text-xs uppercase tracking-widest text-signal-gold">
          Marketplace setup
        </p>
        <h2 id="marketplace-setup-title" className="text-2xl font-semibold">
          {provider} activation requires assistance
        </h2>
        <p className="text-overlook-mist">
          Self-service activation for this marketplace is not available here.
          SyncAI must verify the provider subscription and bind it to an
          authorized organization before marketplace access can be enabled.
        </p>
        <p className="text-sm text-overlook-mist">
          An organization ID or token in a link does not confirm installation,
          licensing, or an active SyncAI subscription. Keep purchase details out
          of this public page.
        </p>
        <a className="journey-primary-action" href="https://syncai.ca/contact">
          Discuss marketplace setup
        </a>
        <a className="journey-secondary-action" href="/signin?returnTo=%2F">
          Sign in to an existing SyncAI workspace
        </a>
        <p className="text-xs text-overlook-mist">
          Existing workspace access remains subject to your organization
          membership and entitlements.
        </p>
      </section>
    </AuthShell>
  );
}
