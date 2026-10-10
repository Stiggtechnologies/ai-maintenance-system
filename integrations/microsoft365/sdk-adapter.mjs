import { AgentApplication, MessageFactory } from "@microsoft/agents-hosting";
import { startServer } from "@microsoft/agents-hosting-express";
import { readAdvisory } from "./advisory-pilot.mjs";
import { portfolio } from "./portfolio.mjs";
import { measureAdvisory } from "./measurement.mjs";
export class SyncAIAdvisoryAgent extends AgentApplication {
  constructor({
    agentId,
    dependencies,
    authHandlerId = "syncai",
    options = {},
    measurementChannel = "other",
    approvedCollector,
  }) {
    super(options);
    if (!portfolio.some((p) => p.id === agentId))
      throw new Error("unknown requested agent");
    this.getAuthorizedUserToken = (context) =>
      this.authorization.getToken(context, authHandlerId);
    this.handleAdvisory = async (context) => {
      const started = performance.now();
      try {
        // Channel authentication does not establish the user's SyncAI identity.
        const userToken = await this.getAuthorizedUserToken(context);
        if (!userToken?.token) throw new Error("user sign-in required");
        const result = await readAdvisory(
          { agentId, token: userToken.token },
          dependencies,
        );
        const names =
          result.candidates.map((a) => `${a.name} (${a.status})`).join(", ") ||
          "No provisioned candidate found";
        await context.sendActivity(
          MessageFactory.text(
            `${result.agent}: ${result.sourceStatus}. Canonical tenant agents: ${names}. Read-only portfolio advisory; no industrial action performed. Human approval remains required. Microsoft installation qualification is pending.`,
          ),
        );
        await measureAdvisory(
          {
            agentId,
            channelId: measurementChannel,
            outcome: "advisory-returned",
            durationMs: performance.now() - started,
          },
          approvedCollector,
        );
      } catch {
        // Do not leak raw auth/backend failures, tokens, tenant IDs or evidence.
        await context.sendActivity(
          MessageFactory.text(
            "Unable to verify authorized access or retrieve this advisory. Sign in or contact your SyncAI administrator. No action was performed.",
          ),
        );
        await measureAdvisory(
          {
            agentId,
            channelId: measurementChannel,
            outcome: "access-or-read-refused",
            durationMs: performance.now() - started,
          },
          approvedCollector,
        );
      }
    };
    this.onMessage(/.*/, this.handleAdvisory);
  }
}
export function startRegisteredAgent(agent, config) {
  if (
    !config?.clientId ||
    !config?.tenantId ||
    !config?.authority ||
    !config?.authType
  )
    throw new Error("approved Bot/Entra authentication configuration required");
  return startServer(agent, {
    authConfig: config,
    routePath: "/api/messages",
    rateLimitOptions: { windowMs: 60000, max: 60 },
  });
}
