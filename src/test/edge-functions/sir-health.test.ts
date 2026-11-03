// @vitest-environment node
import { describeAgentHealth } from "../support/agentEdgeTwins";

describeAgentHealth({
  name: "sir-health",
  path: "supabase/functions/sir-health/index.ts",
  agents: "sir_agents",
  memory: "sir_memory",
  history: "sir_health_history",
});
