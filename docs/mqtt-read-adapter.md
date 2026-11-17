# MQTT read adapter

**Status:** built and tested against an in-process mock broker only. Not
certified against a live broker. Not on the Edge Function deployment
allowlist, so this pull request does not deploy it. Capability-register item
C2.21 stays partial until the live acceptance evidence below exists.

## Transport

Supabase Edge functions run on Deno. Deno exposes WebSocket and does not
provide the raw TCP socket a classic `mqtts://` client needs. The pull
function therefore uses **mqtt.js 5.16.1** (`npm:mqtt@5.16.1`) over **TLS
WebSockets** (`wss://`), MQTT 3.1.1 (`protocolVersion: 4`). Cleartext
`ws://`, raw `mqtt://`, and raw `mqtts://` are refused.

The session is subscribe-only. It sets a clean session, disables reconnect,
sets no last-will message, and the client wrapper has no publish call.

## Contract

One connector is one administrator-approved broker URL plus 1–8 topic
filters. The adapter extends the existing canonical path and stops at
staging:

`connectors` → service-attested `connector_runs` → `ingest_staging` →
`ingest_watermarks`

Collected fields are topic, payload, QoS, retain flag, and received
timestamp. Payloads are kept as evidence. They are not promoted into
`condition_readings`, alarms, limits, or work orders. An empty window is a
successful listen with an explicit note: silence is not a process state.

## Protected runtime configuration

Set both Edge Function secrets before an administrator enables a source:

- `MQTT_READ_ALLOWED_HOSTS`: comma-separated exact broker hostnames.
  Wildcards, private addresses, localhost, URL credentials, non-`wss`
  targets, query strings, and fragments are refused.
- `MQTT_READ_CREDENTIALS_JSON`: secret registry keyed by the opaque
  reference stored on the connector. Each entry is a username and password:

  ```json
  {
    "vault://customer/mqtt-read": {
      "type": "mqtt_password",
      "username": "reader",
      "password": "REDACTED"
    }
  }
  ```

Never put a password in a connector row, browser, URL, repository, log, or
capability register.

In `/integrations`, the MQTT card opens the setup screen. A named human
administrator records the `wss://` URL, topic filters, a 1–30 second listen
window, a 1–200 message cap, subscribe QoS 0–2, the expected interval, the
opaque credential reference, and a substantive activation basis. The
`ai_admin` identity is refused.

## Runtime controls

- The request body cannot change the broker, filters, window, or QoS.
- Each payload is limited to 8 KiB and the listen to 256 KiB. Hitting the
  message or byte cap stops the window early and marks it truncated.
- The broker host must be on the deployment allowlist.
- The database checks the manifest against the saved profile, refuses topics
  outside the approved filters, and blocks direct run creation with a
  trigger. Only the service-attested Edge transport can begin, ingest, or
  finish a run.
- A watermark advances only when every retained message was accepted. Partial
  runs keep refusals and do not move the clean cursor.

These ceilings are adapter transport bounds. They are not OEM or process
limits.

## Why it is not deployed from this change

Adding the function to `config/edge-function-boundary.json` requires the
same name in `.github/workflows/deploy-migrations.yml`. That workflow is
intentionally untouched here. The function is present for review and mock
tests. A later change that is allowed to edit the workflow can add
`mqtt-read-pull` to the allowlist.

## Live acceptance required before green

Use a non-production broker and retain evidence for all of the following:

1. Dry-run connects, subscribes, reports counts, and writes no run or
   staging row.
2. A committed listen stores topic, payload, QoS, and received time, then
   disconnects. Broker logs show no publish from the SyncAI client.
3. A topic outside the filters is not retained.
4. An oversize payload, a disallowed host, and a bad credential fail closed
   without logging the password.
5. A foreign tenant cannot read the connector, run, staging, or watermark.

Attach the broker, host, topic filters, witness identities, timestamps, and
run IDs to the acceptance record. Only then may C2.21 move to green.
