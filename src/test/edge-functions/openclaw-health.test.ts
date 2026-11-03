// @vitest-environment node
import { describeAgentHealth } from "../support/agentEdgeTwins";

describeAgentHealth({
  name: "openclaw-health",
  path: "supabase/functions/openclaw-health/index.ts",
  agents: "openclaw_agents",
  memory: "openclaw_memory",
  history: "openclaw_health_history",
});
