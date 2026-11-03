# OPC-UA read adapter

**Status:** built and tested against the in-repo mock OPC-UA server. Not
certified against a live OPC-UA server. Not deployed. Capability-register item
C2.23 stays partial until the live acceptance evidence below exists.

## Why the edge function does not speak OPC-UA binary

Supabase Edge Functions run on Deno. The supported outbound API is `fetch`
over HTTP and HTTPS. An OPC-UA session is a TCP conversation on `opc.tcp`
(commonly port 4840), including Hello, OpenSecureChannel, CreateSession,
ActivateSession and Read. `Deno.connect` is not a supported Supabase Edge API,
and a Node OPC-UA stack such as `node-opcua` depends on Node `net` and `tls`.

The pull function `opc-ua-read-pull` therefore does not open a socket. It
validates the governed connector profile, resolves the credential from the
edge secret registry, and POSTs one read-only JSON envelope to an allowlisted
HTTPS gateway whose path ends in `/v1/read`.

The gateway shim lives in `services/opc-ua-read-gateway`. It is the OPC-UA
client. It implements a bounded OPC UA Binary subset:

- SecurityPolicy `http://opcfoundation.org/UA/SecurityPolicy#None`
- MessageSecurityMode None
- Anonymous and UserName identity tokens
- Read of attribute Value (13) only

Write (binary encoding node id 673) and Call (712) are refused by the mock
server and are not methods on the client. HistoryRead is not implemented.
Sign and SignAndEncrypt are accepted as stored configuration and refused
before a socket opens. The shim will not downgrade a secure endpoint onto an
open channel. A certified secure-channel stack is still required before those
modes can be claimed.

This repository does not add `node-opcua`. The codec follows OPC 10000-6
message framing and the standard binary encoding node ids. Contract tests
run it against `startMockOpcUaServer` on `127.0.0.1` only.

## Contract

One connector reads one administrator-approved `opc.tcp` endpoint and an
explicit list of 1 to 50 node ids. Each reading keeps `nodeId`, `value`,
`statusCode` and `sourceTimestamp`. Bad status codes are evidence. A Good
status cannot omit its value. An empty response is refused. The pull request
cannot change the endpoint, security mode, credential or node list.

The adapter extends the existing canonical path:

`connectors` → service-attested `connector_runs` → `ingest_staging` →
`ingest_watermarks`

It does not create a sensor, asset, condition series or second queue. Node
values are staged as `opc_ua_node_value` evidence. Promotion into
`condition_readings` remains the separate, sensor-bound path and is not
inferred here.

## Protected runtime configuration

Set these Edge Function secrets before an administrator enables a source:

- `OPC_UA_READ_GATEWAY_URL`: credential-free public HTTPS URL ending in
  `/v1/read`. Private addresses, localhost, redirects, query strings and URL
  credentials are refused.
- `OPC_UA_READ_GATEWAY_ALLOWED_HOSTS`: comma-separated exact gateway hostnames.
- `OPC_UA_READ_GATEWAY_TOKEN`: bearer of at least 32 characters presented to
  the gateway. It is not the OPC-UA password.
- `OPC_UA_READ_SERVER_ALLOWED_HOSTS`: exact `opc.tcp` hostnames the gateway
  may dial. Plant servers are often private; they are reachable only when
  this list names them. The edge function still does not dial them.
- `OPC_UA_READ_CREDENTIALS_JSON`: secret registry keyed by the opaque
  reference stored on the connector.

```json
{
  "vault://customer/opc-ua": { "type": "anonymous" },
  "vault://customer/opc-ua-user": {
    "type": "username",
    "username": "reader",
    "password": "REDACTED"
  }
}
```

Never put a password or gateway token in a connector row, browser, URL,
repository, log or capability register. The authentication mode on the
connector must match the registry entry. An anonymous entry that also carries
a password is refused.

The gateway process is not deployed by this change. The pull function is also
intentionally absent from `config/edge-function-boundary.json` and from
`.github/workflows/deploy-migrations.yml`, so production deploy does not
publish it until that allowlist is reviewed separately.

## Runtime controls

- The browser request is `{ connector_key, dry_run }` only. Dry run is the
  default.
- `ai_admin` cannot configure or enable the source. A named human
  administrator records the endpoint, security mode, security policy,
  authentication mode, node list, opaque credential reference and a
  substantive basis.
- The database forces `direction = read_only` and `write_enabled = false`.
- One response is limited to 1 MB and the transport budget is 55 seconds.
- The response SHA-256, byte count, security mode, security policy and row
  count must reconcile before a run opens.
- A watermark advances only when every approved node was returned once and no
  row was rejected.
- Only the service role can begin, ingest or finish a run. Direct client
  inserts of governed runs are trigger-blocked.

## Live acceptance required before green

Use a non-production OPC-UA server and the customer gateway to retain
evidence for all of the following:

1. Dry-run reads the approved nodes and writes no run, staging row or
   watermark.
2. A committed read stages node id, value, status code and source timestamp
   for exactly the approved list.
3. Identical replay is retained as duplicate evidence.
4. An unknown node returns its bad status code and does not invent a value.
5. A wrong username or password fails without exposing the secret.
6. Sign and SignAndEncrypt fail closed and do not open a None channel.
7. Write and Call attempts are refused and do not change server values.
8. A foreign tenant cannot read the connector, run, staging or watermark.

Attach the server product and version, endpoint host, security mode actually
negotiated, witness identities, timestamps, run ids and the page hash to the
acceptance record. Only then may C2.23 move to green.

## References

- OPC 10000-4, Services: Read, CreateSession, ActivateSession
- OPC 10000-6, Mappings: OPC UA Binary, secure conversation headers
- Binary encoding node ids used by the shim: OpenSecureChannelRequest 446,
  CreateSessionRequest 461, ActivateSessionRequest 467, ReadRequest 631,
  WriteRequest 673, CallRequest 712
