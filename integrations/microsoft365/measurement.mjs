import { portfolio } from "./portfolio.mjs";
const channels = new Set([
  "microsoft-365-copilot",
  "teams",
  "outlook",
  "microsoft-marketplace",
  "other",
]);
const outcomes = new Set(["advisory-returned", "access-or-read-refused"]);
// Non-persistent hook only. No collector/vendor is configured by preparation.
// Event shape is fixed; never spread request, token, identity or response data.
export async function measureAdvisory(
  { agentId, channelId, outcome, durationMs },
  approvedCollector,
) {
  if (!approvedCollector) return;
  const agent = portfolio.find((p) => p.id === agentId);
  if (!agent || !outcomes.has(outcome))
    throw new Error("unknown measurement identity");
  const event = {
    version: 1,
    productId: "syncai-platform",
    experienceId: "m365-portfolio-read-advisory",
    agentId: agent.id,
    channelId: channels.has(channelId) ? channelId : "other",
    outcome,
    sourceStatus: agent.sourceStatus,
    durationBucketMs: Number.isFinite(durationMs)
      ? Math.min(60000, Math.max(0, Math.ceil(durationMs / 1000) * 1000))
      : null,
  };
  // Collector failure must not bypass/refuse an already authorized read response.
  try {
    await approvedCollector(event);
  } catch {
    /* best-effort hook; no separate queue */
  }
}
export const measurementPolicy = {
  collectorConfigured: false,
  persistenceAdded: false,
  customerContentIncluded: false,
  thirdPartyTransmissionEnabled: false,
  portfolioIsClosed: false,
  retirementAuthorized: false,
};
