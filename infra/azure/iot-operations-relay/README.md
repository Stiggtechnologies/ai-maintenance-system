# SyncAI Azure IoT Operations relay

This Azure Functions v4 worker consumes an Azure Event Hubs consumer group and
forwards only normalized OPC UA telemetry to SyncAI. It has no Event Hubs send
role, MQTT publication, OPC UA write, method-call or plant-command code.

## Required upstream shape

The Azure IoT Operations data flow must enrich each OPC UA PubSub JSON message
with `_syncai_source`, a stable asset/dataset identity. Native data points keep
their `{ "SourceTimestamp": "...", "Value": 12.3, "StatusCode": "Good" }`
shape. The relay turns each point into the stable tag
`<source>/<field-name>`. A named SyncAI data steward must confirm that exact tag
against a canonical sensor before any reading can land.

## Application settings

- `AioEventHubs__fullyQualifiedNamespace`: the Event Hubs namespace, using the
  Azure Functions identity-based connection convention.
- `AIO_EVENT_HUB_NAME`: source hub name.
- `AIO_EVENT_HUB_CONSUMER_GROUP`: a dedicated SyncAI consumer group.
- `SYNCAI_INGRESS_URL`: the deployed
  `azure-iot-operations-ingest` Supabase Edge Function URL.
- `SYNCAI_INGRESS_KEY_ID`: non-secret key ID recorded on the SyncAI connector.
- `SYNCAI_INGRESS_SECRET`: 32+ character secret stored in Azure Key Vault and
  represented in SyncAI only by an opaque `keyvault://...` reference.

Grant the Function's managed identity **Azure Event Hubs Data Receiver** only
on the selected hub or consumer group. Do not grant Data Sender, Contributor or
Owner. Configure the same key ID/secret pair in the Edge Function's
`AZURE_IOT_OPERATIONS_INGRESS_KEYS_JSON` secret registry.

Build with `npm ci && npm run build`, package `dist`, `host.json`,
`package.json` and production dependencies, then deploy through the customer's
approved Azure pipeline. A failed or refused SyncAI request throws: Functions
does not checkpoint that Event Hubs batch and the stable partition/offset/tag
identity makes retry idempotent. Large Event Hubs batches are split into stable
500-point deliveries; a retry safely replays already accepted chunks before it
continues with the failed chunk.
