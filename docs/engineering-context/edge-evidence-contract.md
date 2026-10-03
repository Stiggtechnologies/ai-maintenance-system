# SyncAI Edge Evidence Contract

**Status: implementation in review; not production deployed or hardware validated.**

This contract is the hardware-neutral boundary between an edge inference device
and SyncAI's governed industrial decision system. It is designed so Coral NPU,
Synaptics Coralboard, or another approved edge runtime can supply observations
without becoming an autonomous operational authority.

## Product position

> Edge hardware detects. SyncAI turns the observation into governed,
> evidence-backed industrial decisions.

The device may perform local inference and submit a signed observation. SyncAI
records that observation as **unverified `AI_INFERENCE`** in the canonical
`evidence_items` store. A valid device signature proves which enrolled key sent
the exact bytes; it does not prove the inference is correct. Existing human
evidence verification, recommendation, approval, risk, and work-release
controls remain authoritative.

## Canonical flow

1. A human tenant administrator requests enrollment with a public-only Ed25519
   JWK and a substantive basis.
2. A different human administrator or executive approves the tenant, site,
   node identity, and public-key fingerprint. The decision is recorded in the
   canonical `approvals` and `audit_events` stores.
3. The device signs the exact request digest, node ID, key ID, sequence, and
   timestamp using the `syncai-edge-evidence-v1` context.
4. `edge-evidence-ingest` verifies the signature and freshness before invoking
   the service-role-only database function.
5. The database rechecks active state, key ID, monotonic sequence, tenant-bound
   asset and sensor identities, and the exact independently approved current
   `model_register` version.
6. The observation is appended to `evidence_items` with immutable signature,
   model, asset, sensor, device, timestamp, digest, and observation provenance.
7. The result remains unverified and carries `operationalAuthorization=false`.
   It creates no recommendation, work order, decision, approval, or equipment
   command.

## Offline and replay behavior

Devices may buffer observations while disconnected, but they must deliver them
in monotonically increasing sequence order. A duplicate observation ID, reused
sequence, stale request signature, wrong key, suspended/revoked node, or
cross-tenant asset/sensor/model binding is refused. `capturedAt` may be
historical for store-and-forward evidence; `signedAt` must be current when the
request is transmitted.

An approved key rotation resets the sequence only when the new key becomes
active. Requester and reviewer must be different humans. Suspension, revocation,
and decommissioning immediately stop ingestion; activation cannot be restored
through the restriction function.

## Deliberate non-claims

This implementation does **not** establish any of the following:

- Google, Coral, or Synaptics partnership, certification, endorsement, or
  production compatibility;
- measured Coralboard latency, power, accuracy, thermal, availability, or
  environmental performance;
- secure boot, hardware-rooted keys, remote attestation, signed OTA update,
  fleet rollout, rollback, rate limiting, DDoS protection, or field support;
- automatic validation of an inference or authorization to act on it;
- a production edge or air-gapped deployment offering.

Those claims require a physical-board qualification campaign, threat model,
gateway/network controls, device lifecycle runbook, recovery tests, and
customer acceptance. The current slice provides the secure application
contract and simulator-testable cryptographic seam on which that evidence can
be built.

## Coral implementation path

The first proposed hardware adapter targets the open Coral NPU ecosystem while
keeping the envelope vendor-neutral. The adapter should run the approved model,
construct this contract's JSON body, sign it using a device-protected Ed25519
key, buffer it in sequence order when offline, and submit it without raw private
key material ever leaving the device.

Primary public references:

- [Google Research — Coral NPU: a full-stack platform for Edge AI](https://research.google/blog/coral-npu-a-full-stack-platform-for-edge-ai/)
- [Google Coral NPU open-source repository](https://github.com/google-coral/coralnpu)
- [Synaptics Coralboard documentation](https://developers.google.com/coral/products/SL2610-dev-board)
