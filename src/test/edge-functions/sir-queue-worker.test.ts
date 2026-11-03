// @vitest-environment node
import { describeAgentQueue } from "../support/agentEdgeTwins";

describeAgentQueue({
  name: "sir-queue-worker",
  path: "supabase/functions/sir-queue-worker/index.ts",
  queue: "sir_queue",
  notifications: "sir_notifications",
});
