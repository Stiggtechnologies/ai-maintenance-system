# Ignition SCADA tag read adapter

**2026-11-03 — BUILT AND TESTED AGAINST A MOCK GATEWAY ONLY.** Not certified
against a live Ignition server. Not added to the production deploy allowlist.

## Contract

One connector reads one administrator-approved Ignition WebDev resource and an
explicit list of 1–20 tag paths. Ignition remains the system of record. The
adapter issues `GET` only. It has no tag-write, alarm-acknowledgement, setpoint
or limit-change call.

The adapter extends the existing canonical path:

`connectors` → service-attested `connector_runs` → `ingest_staging` →
`ingest_watermarks`

`system_kind` stays `historian`. The product profile is `ignition_tag_read`.
Readings are retained as `ignition_tag_reading` staging evidence with path,
value, quality and timestamp. They are not promoted into `condition_readings`
and they do not raise `condition_alerts`. A confirmed historian-tag mapping
remains a separate named-human decision. This adapter does not invent sensor
limits, engineering units or alarm thresholds.

An empty response, a missing approved tag, an extra tag, or a field other than
path, value, quality and timestamp is refused. A repeated identical qualified
value is retained as duplicate evidence. The clean watermark advances only
when every approved tag was read and none were rejected.

## What the gateway must expose

Inductive Automation documents the WebDev mount and the tag read this adapter
calls. The gateway resource is customer-owned; SyncAI does not deploy it.

- WebDev Python resources: `https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev`
- URL shape and `doGet`: `https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev/simple-web-server`
- `system.tag.readBlocking` QualifiedValue (`value`, `quality`, `timestamp`): `https://www.docs.inductiveautomation.com/docs/8.3/appendix/scripting-functions/system-tag/system-tag-readBlocking`
- Provider-qualified paths: `https://www.docs.inductiveautomation.com/docs/8.3/platform/scripting/scripting-examples/reading-and-writing-to-tags`

Published resources are mounted at `/system/webdev/<project>/<resource>`.
`doGet` reads `request['params']['tagPath']` as a string. Returning
`{'json': ...}` sets `Content-Type: application/json`. JSON has no Java Date,
so the resource must emit the timestamp as ISO-8601 and quality as text.

The resource must call `system.tag.readBlocking` only. It must not call
`system.tag.writeBlocking`, `system.tag.writeAsync`, or any other write.

```python
def doGet(request, session):
    path = request['params'].get('tagPath')
    if not path:
        return {'json': {'error': 'tagPath is required'}}
    qualified = system.tag.readBlocking([path])[0]
    return {'json': {
        'path': path,
        'value': qualified.value,
        'quality': str(qualified.quality),
        'timestamp': system.date.format(qualified.timestamp, "yyyy-MM-dd'T'HH:mm:ssXXX")
    }}
```

Each response object contains only `path`, `value`, `quality` and `timestamp`.
`value` is a JSON string, number, boolean or null. `path` must echo the
requested tag. One GET is issued per approved path, with only the `tagPath`
query parameter.

## Protected runtime configuration

The function is present and JWT-verified in `supabase/config.toml`. It is not
in `config/edge-function-boundary.json` and it is not deployed by
`.github/workflows/deploy-migrations.yml`. Adding it to that allowlist is a
separate change. Until then a production invoke will not find the function.

When it is deployed, set both Edge Function secrets before an administrator
enables a source:

- `IGNITION_SCADA_READ_ALLOWED_HOSTS`: comma-separated exact gateway hostnames.
- `IGNITION_SCADA_READ_CREDENTIALS_JSON`: secret registry keyed by the opaque
  reference stored on the connector. Supported entries are HTTP Basic, for a
  WebDev resource that requires gateway authentication, and a bearer token:

  ```json
  {
    "vault://customer/ignition-scada": {
      "type": "http_basic",
      "username": "reader",
      "password": "REDACTED"
    }
  }
  ```

Never put a password or token in a connector row, browser, URL, repository,
log or capability register. The pull request body cannot change the host, the
resource or the tag list.

## Runtime controls

- The configured resource must be credential-free public HTTPS, end in a
  published `/system/webdev/<project>/<resource>` path, and contain no `write`
  segment. Private addresses, localhost, redirects, query strings and fragments
  are refused. Loopback is refused by the edge function.
- `write_enabled` must be false and `direction` must be `read_only`. A
  write-enabled source fails before any socket is opened.
- Each tag response is limited to 64 KB. A pull cannot cross 2 MB or 55
  seconds, or the configured list of at most 20 paths. These are adapter
  transport ceilings, not Ignition product limits.
- Each response is SHA-256 hashed. Page number, tag path and byte count must
  reconcile to the approved list before a run is opened.
- Only the service-attested transport can begin, ingest or finish a run.
- A watermark advances only when every approved tag was read and no row was
  rejected.
- Tenant scope and actor identity are derived from the verified bearer and
  rechecked in every service-only database function. `ai_admin` cannot
  configure or read the source.

## Live acceptance still required

Use a non-production Ignition gateway and an approved tag list. Witness:

1. Dry-run fetches every approved tag and writes no run, staging row or watermark.
2. A committed pull retains path, value, quality and timestamp, including a
   null value with bad quality.
3. An identical replay is duplicate evidence and does not advance a second
   canonical series.
4. A path outside the list, a write resource, a non-GET response and a
   write-enabled connector all fail closed.
5. Gateway audit evidence shows no tag write from SyncAI.
6. A foreign tenant cannot read the connector, run, staging or watermark.

Only that evidence can move C2.21 past yellow.
