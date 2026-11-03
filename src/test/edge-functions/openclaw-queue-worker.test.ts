// @vitest-environment node
import { describeAgentQueue } from "../support/agentEdgeTwins";

describeAgentQueue({
  name: "openclaw-queue-worker",
  path: "supabase/functions/openclaw-queue-worker/index.ts",
  queue: "openclaw_queue",
  notifications: "openclaw_notifications",
});
