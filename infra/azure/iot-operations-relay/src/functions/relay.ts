import { app, type InvocationContext } from "@azure/functions";
import { deliverEventHubBatch, relayRetryPolicy } from "../delivery.js";

export async function relay(
  messages: unknown[],
  context: InvocationContext,
): Promise<void> {
  const retryCount =
    (context as InvocationContext & { retryContext?: { retryCount?: number } })
      .retryContext?.retryCount ?? 0;
  await deliverEventHubBatch(messages, context, { attempt: retryCount });
}

app.eventHub("syncaiAzureIotOperationsRelay", {
  connection: "AioEventHubs",
  eventHubName: "%AIO_EVENT_HUB_NAME%",
  consumerGroup: "%AIO_EVENT_HUB_CONSUMER_GROUP%",
  cardinality: "many",
  retry: relayRetryPolicy,
  handler: relay,
});
