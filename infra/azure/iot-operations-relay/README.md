# SyncAI Azure IoT Operations relay

This Azure Functions v4 worker consumes an Azure Event Hubs consumer group and
forwards only normalized OPC UA telemetry to SyncAI. It has no Event Hubs send
role, MQTT publication, OPC UA write, method-call or plant-command code.

## Supported upstream shapes

The relay accepts:

- Azure IoT Operations flattened JSON carrying `_syncai_source`; and
- OPC Publisher 2.9/3.0 PubSub `Json` or `JsonGzip`, including Event Hubs
  wrappers, arrays of network messages, key/delta frames and reversible
  numeric scalar bodies.

Native PubSub messages must carry a stable `DataSetWriterName` or
`DataSetWriterId`; a writer group is included when available. The relay turns
each scalar point into
`opc/publisher-<fingerprint>/<writer-group>/<writer>/<field-name>` (or the
explicit `_syncai_source/<field-name>`). The non-secret publisher fingerprint
prevents identical writer names from different publishers colliding. A named
SyncAI data steward must confirm that exact tag against a canonical sensor
before any reading can land.

Metadata and keepalive frames are counted and skipped. Events and conditions
are deliberately withheld for the governed process-event path. UADP and raw
data sets lacking stable identity/source time are refused; configure JSON or
JSON+gzip rather than silently changing their meaning.

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
