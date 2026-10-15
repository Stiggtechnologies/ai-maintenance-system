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
approved Azure pipeline.

## Checkpoint and recovery

Microsoft's Event Hubs trigger advances a partition checkpoint when the
function execution finishes, including when it finishes by throwing, unless a
function-level retry policy is still open. Checkpoints are written only after
that policy finishes. This relay registers `exponentialBackoff` with
`maxRetryCount: -1`, waiting at least 10 seconds and at most 5 minutes
between host retries (`relayRetryPolicy`). A failed delivery never finishes
that policy, so the checkpoint stays on the last batch the function was
allowed to return.

The function returns, which lets the host checkpoint, only when:

- every 500-point chunk receives HTTP 2xx from canonical ingress (a new
  acceptance, an idempotent replay, or a partial run whose rejects were
  staged); or
- normalization finds no deliverable points because the batch contained only
  metadata, keepalives, or event/condition frames withheld from this scalar
  path.

The function throws, and the checkpoint does not advance, when:

- ingress returns a non-2xx status, times out, or cannot be reached, because
  that body was not durably recorded; or
- the payload cannot be decoded (UADP, invalid JSON, or missing writer
  identity or source time).

Three in-process HTTP attempts are only a short retry before that throw. They
are not the checkpoint guarantee. A bounded `maxRetryCount` is not used:
exhaustion would let the host checkpoint past events whose delivery failed.

Process restart resumes from the last checkpoint. The in-memory retry count
resets and the same batch is retried. Delivery IDs are the stable
partition/offset/chunk identity, so an already accepted chunk replays without
a second write. There is no second queue and no Event Hubs send permission.

An undecodable or persistently refused batch pauses that partition. Event Hubs
can still expire the paused events when the hub's own retention elapses. That
expiry is not a successful delivery; operators have to alarm on a stuck
consumer before retention passes the offset. This repository's unit test
models the documented host rule. It is not an observed checkpoint from a
customer Event Hubs namespace.
