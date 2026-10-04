# Engineering Diagram Intelligence

## Purpose and decision boundary

Engineering Diagram Intelligence converts one rasterized sheet from an exact,
effective controlled P&ID or engineering drawing into reviewable symbol and
connectivity evidence. It does not approve engineering content, alter an asset,
authorize work, change an operating limit, acknowledge an alarm, or execute a
plant control action.

The canonical records remain:

- `kb_intake_documents` for the controlled document revision;
- `assets` for equipment identity;
- `dependency_candidates` for findings awaiting graph review; and
- `asset_dependencies` for the independently confirmed operational graph.

The extraction tables retain machine provenance and review state. They are not
a second document register or asset graph.

## Controlled flow

1. A named engineering, maintenance, planning, or administrator human registers
   a drawing or P&ID in the controlled-document workflow.
2. A different named human with verified MFA and an AAL2 session makes that
   exact revision effective.
3. An authorized human uploads a PNG, JPEG, or WebP rendering, up to 25 MB, to
   the private `engineering-diagrams` bucket. The object key binds organization,
   document UUID, SHA-256, and filename. No authenticated update or delete
   policy exists.
4. `engineering-diagram-inference` rechecks tenant authority, claims the run,
   downloads the private bytes with service role, verifies their SHA-256, and
   calls the pinned Azure P&ID digitization API.
5. Provider output is bounded before persistence: at most 5,000 nodes, 10,000
   edges, 200 line segments per edge, normalized geometry in `[0,1]`, bounded
   payload sizes, valid endpoint references, and no duplicate provider IDs.
6. A named human proposes each node-to-asset mapping. A different named human
   with verified MFA and AAL2 accepts or rejects it.
7. A human explicitly chooses dependency orientation, kind, and basis. SyncAI
   publishes only to the existing `dependency_candidates` queue. Multi-candidate
   publication is atomic: one invalid item rolls back every candidate in that
   request, so an error cannot leave an unaudited partial batch.
8. A different named human with verified MFA and AAL2 confirms or rejects that
   candidate through the existing Asset Interdependency review. Only that
   confirmation can update `asset_dependencies`.

Effectivity and security standing are rechecked at mapping review and candidate
publication. Superseded, rejected, or quarantined source revisions fail closed.

## Provider contract and pin

The adapter is compatible with the API contract from:

- upstream: `Azure-Samples/digitization-of-piping-and-instrument-diagrams`;
- maintained fork:
  `https://github.com/Stiggtechnologies/digitization-of-piping-and-instrument-diagrams`;
- pinned commit: `c51302e3ec34147c676ef6eedbdd7551ea908b05`.

The SyncAI run UUID is used as the provider `pid_id`. This prevents one run
from overwriting another run's upstream blob, debug, or graph artifacts.

The adapter uses:

- `POST /api/pid-digitization/symbol-detection/{pid_id}`;
- `POST /api/pid-digitization/text-detection/{pid_id}`;
- `POST /api/pid-digitization/graph-construction/{pid_id}`;
- `GET /api/pid-digitization/graph-construction/{pid_id}/status`;
- `GET /api/pid-digitization/symbol-detection/{pid_id}`; and
- `GET /api/pid-digitization/graph-construction/{pid_id}`.

It deliberately never calls upstream `graph-persistence`. Upstream graph
persistence is overwrite-oriented and is not SyncAI's canonical, tenant-bound,
human-approved graph.

## Runtime configuration

Deploy `engineering-diagram-inference` with platform JWT verification enabled.
Configure these server-side values:

| Setting                           | Required                    | Meaning                                                              |
| --------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `AZURE_PID_DIGITIZATION_BASE_URL` | Yes for live extraction     | Credential-free HTTPS base URL for the approved provider deployment. |
| `AZURE_PID_DIGITIZATION_API_KEY`  | If the provider requires it | Secret API key sent only as `x-api-key`.                             |
| `ALLOWED_ORIGIN`                  | Recommended                 | Browser origin; defaults to `https://app.syncai.ca`.                 |

The base URL refuses plaintext HTTP, embedded credentials, query strings, and
fragments. Production networking should additionally restrict egress to the
approved provider hostname and keep the provider behind private connectivity or
an authenticated gateway.

## Failure and retry semantics

- Upload and run creation are idempotent by organization, controlled revision,
  source checksum, and pinned provider commit.
- A provider start failure marks only a run already authorized and claimed by
  the worker. A caller-supplied or cross-tenant run ID cannot be failed by the
  service-role catch path.
- Each claimed attempt increments a bounded counter. A named same-tenant human
  can review a terminal failure, record a 20-character-or-longer retry basis,
  and re-queue the same immutable input. Both the provider failure and retry
  are retained in the audit ledger; a superseded or quarantined source cannot
  be retried.
- A queued run has an explicit `Start extraction` recovery action, so a network
  interruption between run creation or retry and provider dispatch is resumable.
- Graph construction is asynchronous. The current UI uses an explicit
  `Check result` action; no completion is invented while the provider is still
  processing.
- Terminal provider results record raw-result SHA-256, provider manifest,
  normalized counts, and timestamps.
- Invalid, oversized, unscored, disconnected, or non-normalized provider output
  is rejected as a whole.

## Production acceptance

The deterministic fresh-chain smoke proves the database and authority boundary
without depending on an external service. A live customer claim additionally
requires all of the following evidence:

1. An approved provider deployment at an allowlisted HTTPS endpoint.
2. Successful extraction from a representative customer-controlled drawing.
3. Human comparison of symbols, tags, connections, false positives, and false
   negatives against that exact revision.
4. Two independent AAL2 review steps: asset mapping and graph confirmation.
5. Tenant-isolation, timeout, malformed-output, provider-unavailable, and
   superseded-revision tests in the target environment.
6. Recorded provider version/digest, model artifacts, configuration, rollback,
   data residency, retention, and incident owner.

Until that evidence exists, the honest status is **implemented and internally
verified, external provider/customer acceptance pending**.

## Rollback

1. Remove or disable the provider base URL so no new run can dispatch.
2. Leave controlled documents, immutable source objects, runs, mappings, audit
   events, candidates, and confirmed graph evidence retained.
3. Reject any still-open candidate groups through the canonical review queue.
4. If a confirmed edge is later shown incorrect, use the graph's governed human
   correction workflow; never delete provenance to conceal the prior decision.
5. Re-enable only after a new pinned provider version passes the same acceptance
   evidence and regression suite.

The migration is additive. A code rollback therefore disables new inference
without destroying evidence already used in a decision.
