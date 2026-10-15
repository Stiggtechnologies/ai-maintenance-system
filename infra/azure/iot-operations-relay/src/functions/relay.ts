import { app, type InvocationContext } from "@azure/functions";
import { deliverEventHubBatch, relayRetryPolicy } from "../delivery.js";

export async function relay(
  messages: unknown[],
  context: InvocationContext,
): Promise<void> {
  await deliverEventHubBatch(messages, context);
}

app.eventHub("syncaiAzureIotOperationsRelay", {
  connection: "AioEventHubs",
  eventHubName: "%AIO_EVENT_HUB_NAME%",
  consumerGroup: "%AIO_EVENT_HUB_CONSUMER_GROUP%",
  cardinality: "many",
  retry: relayRetryPolicy,
  handler: relay,
});
