// @vitest-environment node
import { describeAgentNotifier } from "../support/agentEdgeTwins";

describeAgentNotifier({
  name: "sir-notifier",
  path: "supabase/functions/sir-notifier/index.ts",
  notifications: "sir_notifications",
  endpoints: "sir_notification_endpoints",
});
