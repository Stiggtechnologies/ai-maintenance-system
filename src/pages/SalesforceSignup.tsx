import { MarketplaceSetupUnavailable } from "../components/MarketplaceSetupUnavailable";

/** Provider fulfillment remains gated pending verified canonical organization binding. */
export function SalesforceSignup() {
  return <MarketplaceSetupUnavailable provider="Salesforce AppExchange" />;
}

export default SalesforceSignup;
