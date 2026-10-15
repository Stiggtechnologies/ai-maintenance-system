import { MarketplaceSetupUnavailable } from "../components/MarketplaceSetupUnavailable";

/** Provider fulfillment remains gated pending verified canonical organization binding. */
export function AwsMarketplaceSignup() {
  return <MarketplaceSetupUnavailable provider="AWS Marketplace" />;
}

export default AwsMarketplaceSignup;
