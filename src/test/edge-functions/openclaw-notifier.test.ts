// @vitest-environment node
import { describeAgentNotifier } from "../support/agentEdgeTwins";

describeAgentNotifier({
  name: "openclaw-notifier",
  path: "supabase/functions/openclaw-notifier/index.ts",
  notifications: "openclaw_notifications",
  endpoints: "openclaw_notification_endpoints",
});
