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
between host retries (`relayRetryPolicy`). A throw never finishes that
policy, so the checkpoint stays on the last batch the function was allowed
to return.

The function returns, which lets the host checkpoint, only when:

- every 500-point chunk receives HTTP 2xx from canonical ingress (a new
  acceptance, an idempotent replay, or a partial run whose rejects were
  staged);
- normalization finds no deliverable points because the batch contained only
  metadata, keepalives, or event/condition frames withheld from this scalar
  path; or
- the batch was durably dead-lettered. A permanent ingress 4xx, an
  undecodable payload, or the eighth host attempt of a transient failure
  (database, network, HTTP 5xx) is written as a refused `connector_runs` row
  when ingress can store it, otherwise as one JSON blob under
  `SYNCAI_DEAD_LETTER_CONTAINER_URL`. The checkpoint advances only after that
  write succeeds. If neither store accepts the refusal, the function throws
  and the checkpoint stays.

Three in-process HTTP attempts are only a short retry before a transient
throw. They are not the checkpoint guarantee. `maxRetryCount` stays `-1` so
exhaustion of a host policy cannot move past a batch that was neither
accepted nor dead-lettered.

Ingress returns 4xx for a permanent refusal and 503 for a database or other
transient failure. The relay does not retry a permanent refusal.

Process restart resumes from the last checkpoint. Delivery IDs are the stable
partition/offset/chunk identity, so an already accepted chunk replays without
a second write. There is no second queue and no Event Hubs send permission.

Three failed runs in an hour, or an Event Hubs enqueue time at least 15
minutes behind the relay clock, raise one open `system_alerts` row and a
relay log line. Those are operator alarms for a stuck consumer, not
equipment limits. This repository's unit test models the documented host
rule. It is not an observed checkpoint from a customer Event Hubs namespace.
