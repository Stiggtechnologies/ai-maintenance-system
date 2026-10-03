# Azure IoT Operations ingestion boundary

## Supported production route

`OPC UA server → Azure IoT Operations connector → MQTT broker → data flow → Event Hubs → SyncAI relay → signed ingress → canonical condition reading`

Azure IoT Operations owns edge discovery, OPC UA sessions, certificate trust,
MQTT and data-flow delivery. SyncAI owns decision evidence after the cloud
trust boundary. The MIT-licensed `Azure/Industrial-IoT` repository is a
compatibility and test reference, not a vendored SyncAI platform dependency.
SyncAI implements only the narrow receive boundary it needs and does not import
the repository's write, method-call, capture, replay, key-management or MCP
control surfaces.

## OPC Publisher compatibility

The relay accepts the existing Azure IoT Operations flattened JSON contract
and OPC Publisher 2.9/3.0 PubSub JSON network messages. It handles Event Hubs
wrappers, batched network/data-set messages, key and delta frames, reversible
numeric scalar encoding, standards-compliant `Status` and compatibility-mode
`StatusCode` severity, and JSON+gzip. The normalizer
preserves publisher, writer-group, data-set writer, metadata-version, message,
transport and status-code identity in the protected staging evidence.
When no explicit `_syncai_source` is supplied, the canonical tag includes a
non-secret SHA-256 publisher fingerprint plus writer-group and writer identity;
two publishers reusing the same writer names therefore cannot collapse onto
one confirmed sensor mapping.

Metadata and keepalive messages are counted but do not become condition
readings. `ua-event` and `ua-condition` messages are counted and withheld from
this scalar path so the governed process-event workstream can own their richer
semantics. UADP, raw data sets without source timestamps, and messages without
a stable data-set writer identity fail closed. Configure OPC Publisher with
`Json` or `JsonGzip`; binary UADP requires a separately reviewed decoder.

## Control commitments

1. **Read only.** SyncAI grants the relay Event Hubs Data Receiver only. There
   is no Data Sender role, command topic, OPC UA write or method-call code.
2. **Tenant bound.** A non-secret ingress key ID selects exactly one secret,
   tenant and connector in the Edge Function secret registry. The signed body
   cannot nominate a tenant.
3. **Exact-request authentication.** The relay signs
   `<unix-seconds>.<raw-body>` with HMAC-SHA256. Ingress enforces a five-minute
   window, constant-time signature comparison and a 1 MiB/500-point ceiling.
4. **Human-confirmed identity.** A tag lands only when the canonical
   `historian_tag_map` binds it to a same-tenant sensor and asset, with a named
   confirmer, timestamp, unit, measurement and basis.
5. **Replay safety.** The relay external ID combines Event Hubs partition and
   offset, nested message/data-set position, and a source/tag fingerprint.
   Delivery receipts are unique per connector and every condition reading
   remains unique on source/external ID.
6. **Evidence preservation.** Run rows retain delivery ID, body SHA-256,
   receipt time and transport. Staging retains the normalized provenance and
   every refusal reason.
7. **Fail closed.** Unknown tags, stale authorization, malformed values,
   future timestamps and cross-tenant mappings are refused. Any rejection
   makes the run partial and prevents the watermark from advancing.
8. **Honest source state.** Configuration starts `not_connected`; only an
   accepted signed delivery whose newest source timestamp is within twice the
   expected interval becomes `live`. Old but valid backfill remains `stale`;
   disabled and unproven sources are never labelled live plant data.

## Activation sequence

1. Deploy Azure IoT Operations on a Microsoft-supported production platform.
2. Establish OPC UA mutual certificate trust and read-only node permissions.
3. Enable OPC Publisher strict standards compliance where supported, then route
   PubSub JSON/JSON+gzip to Event Hubs. For native messages, configure a
   stable `DataSetWriterName` or ID; for flattened data flows, enrich each
   message with `_syncai_source`.
4. Create a dedicated SyncAI consumer group and deploy the relay with a
   receiver-only managed identity.
5. Save the disabled connector from **Integrations** with customer data-rights
   evidence, Key Vault reference and ingress key ID.
6. Confirm every `<source>/<field>` tag in **Data Governance** against the
   canonical sensor and asset.
7. Configure the Edge Function key registry, enable the connector and send a
   bounded test batch.
8. Verify accepted/rejected arithmetic, replay idempotency, live/stale posture,
   condition alerts and evidence citation before authorizing production load.

The Edge Function secret has this tenant-bound shape (values shown are
placeholders):

```json
{
  "mine-a-key": {
    "organization_id": "00000000-0000-4000-8000-000000000000",
    "connector_key": "mine-a-aio",
    "secret": "generated-32-plus-character-random-value"
  }
}
```

Store that object as `AZURE_IOT_OPERATIONS_INGRESS_KEYS_JSON`. The database
retains only `mine-a-key` and the opaque Key Vault reference, never the secret.

This code proves the governed product path, not a customer deployment. C2.13
remains yellow until a real tenant completes those deployment and acceptance
steps with production evidence.
