# E5.13 — platform database recovery drill

**Controlled implementation, not production disaster-recovery qualification.**
The enterprise register remains partial. This work owns platform database
backup/restore qualification, not industrial operating-mode policy (#617),
Recovery field evidence (#608), or offline operational execution.

## What runs

`SYNC_DR_LOCAL_SOURCE=supabase_db_ai-maintenance-system node scripts/database-restore-drill.mjs`

The source must be the running local Supabase CLI database for this repository,
on a local Docker Unix socket. Docker endpoint/context overrides, remote
connections, arbitrary URLs, input backups and target names are not accepted.
The recorded migration versions must exactly equal the repository's full chain.

The tool exports a repeatable-read snapshot, inventories it, dumps cluster roles
without role passwords and makes a complete custom-format database dump. It
restores only into a newly created empty database on the source's immutable
image ID. The target has no network, published ports, host mounts, persistent
volumes, root privileges or ambient production credentials. Its root filesystem
is read-only, scheduled cron execution is disabled and extension/parallel
background-worker slots are set to zero before restore starts. Libraries stay
preloaded for extension reconstruction, but their workers cannot execute jobs,
HTTP calls or hold a session on the initial database. Actual target settings are
checked before restoring source SQL. This contains worker execution only in the
throwaway target; enabling recovered jobs requires a separately approved path.

The target guard inspects actual Docker metadata before startup, after startup,
before restore/reference execution and before cleanup. It verifies the exact
immutable source image, `postgres` process user, nonprivileged/read-only root,
all capabilities dropped with none added, no-new-privileges, private IPC/cgroup
namespaces and no host/shared PID, UTS or user-namespace override. Memory, CPU
and process limits must be positive and bounded; swap cannot exceed memory and
OOM termination cannot be disabled. Only the two exact bounded tmpfs mounts
are accepted; bind/volume inheritance, additional mounts, devices and groups
are refused. Actual network attachments and port publications must also remain
isolated. Image healthchecks are explicitly disabled so they cannot introduce
an additional execution path. Missing critical metadata or any unqualified
setting fails closed, including during cleanup; an unverified target is not
removed. Fixed isolation-category hints contain no names, paths or values.
Docker's nullable OOM-disable field is qualified separately: exact `false` is
accepted, while exact `null` requires actual local daemon evidence of cgroup v2
and an unsupported OOM-disable feature. Moby discards that field when the kernel
cannot disable OOM termination. Missing, enabled or malformed settings remain
failures. The tool queries only these two daemon capability fields after local
source identity verification, never full host metadata. Positive bounded
memory/swap/CPU/process limits are still required independently. Resource
failures report fixed field labels only, not values. This is a documented
provider representation qualification, not a resource-limit waiver.
`targetContainmentVerified` is recorded only after actual pre/post-start
inspection succeeds, not because creation flags were requested. These Docker
controls contain this trusted-source drill, not arbitrary hostile SQL or a
claim of production recovery or a hardened multi-tenant execution service.

The canonical records are restored, not remodelled: assets, components, evidence,
recommendations, decisions, approvals, work, audit history and customer identity
remain the existing tables. No application queue, workflow engine, audit store,
new migration or parallel evidence model is introduced.

Qualification compares all ordinary table and populated materialized-view rows
in `public`, `auth`, `storage` and `supabase_migrations` using counts and ordered
multiset SHA-256 digests. Materialized-view populated/unpopulated state is also
compared. An intentionally unpopulated view is not queried or treated as a
populated empty view. Its definition, columns, owner and privileges still match.
It compares roles/memberships, extensions and schemas, plus canonical relation
owners/ACLs/RLS flags, columns, policies, functions (including SECURITY DEFINER,
owner/search path/grants), constraints, indexes and noninternal triggers.
Sequences include exact data type, start/increment/minimum/maximum/cache/cycle,
canonical owning column, current counter and called state. Integer values are
captured as text so JavaScript cannot round bigint counters. Inventory reads
never advance or reset a sequence. Sequence state is not protected by the
exported MVCC snapshot, so a second source inventory under the same snapshot
must match after the dump and before snapshot release; observed counter drift
fails qualification before any target is created. The restored sequence state
must match as well. This checks the observed backup interval, not an assertion
that the source has no concurrent activity.
Column position is the ordinal among live columns, not the physical `attnum`
slot left after a historical column drop. Logical dump/restore does not recreate
inaccessible tombstone slots. Live-column identity and order still compare
exactly, as do type, nullability, default, generated/identity settings and ACLs.
An isolated real PostgreSQL dump/restore reproduced the old position mismatch;
the corrected inventory matched, while a reordered-column mutation still failed.
Database owner/ACL/locale/connection properties, database-specific role settings
and parameter privileges are included in the inventory. Restore connects to
the isolated target's `template1` and reconstructs the archived database with
`--create --clean --if-exists`; it does not retain initdb's substitute database
owner or default privileges. Default PostgreSQL ownership reconstruction is
used: create as the restore authority, then apply the original owner. The
alternative `--use-set-session-authorization` requires historical object owners
to retain creation privileges they may correctly no longer possess. Neither
owners nor ACLs are omitted.

Supabase adds `graphql_public.graphql(text,text,jsonb,jsonb)` to the
`pg_graphql` extension through a platform event trigger. A logical archive omits
that extension-member definition but retains its grants. A bare target cannot
apply those grants before the platform trigger has been restored. The baseline
snapshot therefore also captures the actual source wrapper definition, owner,
extension membership, SECURITY DEFINER setting, search path and ACL. Its private
overlay script reconstructs the captured definition and owner, never an invented
replacement body or new grants; the archive applies the original ACL afterward.
The full comparison includes this platform function and fails on any difference.

The source snapshot also captures the exact privileges on `graphql` and
`graphql_public`. The platform's initial grants may be absent from a logical
archive when they are recorded as extension initialization privileges. A private
script reconstructs those captured schema grants after extension creation and
before the remaining archive entries. It preserves recipient, owner-grantor,
USAGE/CREATE privileges, PUBLIC versus a role named PUBLIC, and grant options.
No role or privilege is invented. This bounded path requires the verified source
bootstrap owner, owner-issued grants and a fresh target's null/default schema
ACL; other owners/grantors, duplicate identities, unsupported privileges or
unexpected target permissions fail closed. Default source ACLs are untouched.
The schema and captured privilege inventories must still match afterward.

Every archive entry is assigned exactly once to two exhaustive TOC partitions.
The first restores the database (including properties, ACL, comments and security
labels), schema definitions and extension definitions. The captured wrapper is
then reconstructed, followed by every remaining archive entry. Only the first
pass uses `--create --clean --if-exists`; the second connects to the restored
database without those flags. PostgreSQL handles database entries independently
of the TOC filter in create mode, so leaving `--create` on the second pass would
attempt to create the database again. Malformed/duplicate TOC entries or an
unexpected database identity fail closed. No ACL or other archive entry is
excluded to obtain a pass.
ACL entry ordering is normalized; grantor, recipient, privileges and grant
options remain exact, and a null/default ACL remains distinct from an explicitly
empty ACL. A changed privilege is a mismatch, not an ignorable restore detail.
It then runs a rollback-only tenant witness against the restored canonical
tables: the existing demo user must retain its tenant context and positive asset
read, while another tenant's asset read and insert must be refused.

Empty/missing namespaces, differing rows or control definitions, subprocess
errors, restore errors, missing witness and cleanup failures fail closed. The
tool never drops, restores or writes the source database. It removes only the
target whose exact ID, per-run label, generated name and isolation it verifies.
Failure to verify those properties leaves the target in place and reports FAIL.

## Evidence and confidentiality

Each run creates a unique 0700 directory, with exclusive 0600 artifacts. Database
dumps include authentication password hashes and may contain other sensitive
data. They are not uploaded by CI. Provider diagnostics and raw SQL/row payloads
are not printed. The only uploaded artifact is a bounded summary: source commit,
migration-chain digest, immutable database image, backup digests, comparison
counts, phase durations, witness result, exclusions and cleanup result.
On failure it records only a SQLSTATE and fixed allowlisted diagnostic hints;
verbose provider errors remain in memory and are never printed or uploaded.
Comparison failures report only fixed inventory classes, fixed field labels and
aggregate changed/missing/unexpected/duplicate counts. Object identities, SQL,
owners, ACL values and row digests remain private. This diagnostic summary does
not change the strict comparison or turn a mismatch into a pass.
For unresolved schema ACLs it reports fixed platform namespace/role hints and
counts only; unknown names become `other`. Constraint-definition diagnostics
report fixed constraint types and NOT VALID booleans only, never expressions.
Definition deltas report changed-span lengths and fixed character classes only;
they do not print changed values or normalize a definition mismatch away.
Source-after-backup inventory and exact sequence values remain private. The
summary contains only the source-stability result and counts of compared
sequences/materialized views, never their identities, counters or row digests.

The source inventory backends also collect diagnostic-only raw routine catalogs,
reconstructed definitions and rendering-session settings. These observations
are stored separately in exclusive **0600** `source-function-diagnostics.json`,
`source-after-backup-function-diagnostics.json` and, after a function mismatch,
`source-current-function-diagnostics.json` artifacts. They are not authoritative
restore manifests and are never uploaded by the workflow.

After a function-definition mismatch, one bounded read-only fresh catalog read
can add fixed drift/equality flags to the public summary. It reuses the actual
inventory's validated rendering-setting preamble rather than depending on a
fresh backend's default search path; its statement timeout is shortened to
30 seconds. An incomplete, duplicate or non-setting preamble fails closed.
Function identities,
OIDs, raw SQL, catalog tuples, settings and identity digests remain private.
Missing, malformed or uncorrelated observations are `UNAVAILABLE`, never assumed
equal. These flags classify observations only: they do not establish a harmless
cause, authorize source changes, normalize definitions or turn any mismatch
into PASS. Diagnostic failure preserves the original qualification failure.
Raw catalog OIDs are correlated as exact canonical decimal strings, matching
PostgreSQL's JSON serialization rather than coercing private catalog values.
A fixed synthetic OID constant checks this engine representation in each
source observation; only its boolean witness is included in the public report.
Missing or false representation evidence makes drift hints unavailable.
The post-reference rollback comparison also records the existing fixed
mismatch summary, marked `post_reference_rollback`, then rethrows its original
failure. A summary-formatting failure cannot replace that failure. Neither
manifest, the rollback acceptance check nor any recovery claim is changed.

The source function-definition instability seen in two October 6 CI runs is
still unqualified until its actual cause and a successful strict restore are
demonstrated. No PostgreSQL rendering or concurrent-DDL hypothesis is asserted
as the incident's proven cause.

### Diagnostic qualification states

Each changed-function hint also records separate, fixed qualification states
for the before and after observations: capture status, the first allowlisted
refusal reason, and identity/definition correlation status. A malformed routine
still refuses the **entire** capture, even when that routine is unrelated to the
changed function. The OID witness alone does not qualify all remaining fields.
The fresh observation records read success/failure independently of snapshot
correlation, plus capture qualification and identity presence. Direct helper
calls without a recorded read use `NOT_RECORDED`, not an inferred success.
`readStatus` describes the complete existing observation callback, including
envelope parsing and private artifact persistence. `FAILED` alone does not
establish that the SQL read failed; `SUCCEEDED` does not qualify malformed data.
A successfully read and qualified fresh observation does not enable equality
or catalog-drift claims when either snapshot is uncorrelated; those hints remain
`UNAVAILABLE`. Only fixed labels are public: no routine identities, indices,
catalog fields' values, session-setting values, OIDs, digests or raw errors.
These states explain diagnostic availability, not the restore failure's cause,
and do not change any manifest, strict comparison or recovery acceptance flag.

Subprocess stdout and bounded private stderr use separate lifetime UTF-8
decoders, flushed at completion. Pipe chunks are not character boundaries;
decoding each chunk separately can corrupt a split multibyte character while
leaving its JSON parseable. Synthetic exact-listener regressions reproduce the
observed one-to-two/three punctuation shape and qualified-but-uncorrelated
diagnostics using identical input bytes. Streaming decoding preserves those
bytes' text without normalization; genuinely different Unicode definitions still
fail the strict comparison. The raw 32 MiB stdout limit, binary-artifact path and
timeout/subprocess failure guards remain unchanged. Private stderr retains its
existing pre-append decoded-length threshold; this is not a new hard byte cap,
and the final accepted chunk can exceed that threshold.
This repairs a demonstrated transport defect, not a proven attribution or
closeout of any particular hosted failure; corrected hosted qualification is
still required. See [Node's StringDecoder contract](https://nodejs.org/api/string_decoder.html).

For a differing, nondeferrable NOT VALID CHECK only, a bounded reference witness
may reparse the captured source definition on the restored relation in a
10-second, rollback-only transaction. The original constraint is not dropped,
changed or validated. PostgreSQL must produce the exact restored definition and
the same validation/deferrability state; identity, relation and CHECK type must
also match. Only that compiler-proven representation is used for comparison.
An altered predicate or control fails; unsupported kinds, identifiers or states
remain failures. A full post-rollback inventory must equal the pre-witness
restored inventory. Original source/restored inventories and compiler evidence
remain in private artifacts; the uploaded report contains counts/digests only.
This is an explicit logical representation qualification, not a waiver of a
constraint or an operational approval.
The target's expected bootstrap-superuser identity is checked before restoring
roles. A permission failure is not bypassed by dropping grants or ownership.
The local source's OID-10 bootstrap identity must be `postgres` or
`supabase_admin`, with the superuser attribute. The fresh target is initialized
with that same identity/OID so PostgreSQL's grant graph retains its root. Only
the single, exact duplicate bootstrap `CREATE ROLE` is replaced with a comment;
every `ALTER ROLE`, membership, grantor and option remains unchanged. Missing
or duplicate creation statements are refused. Both the original roles dump and
applied script have recorded SHA-256 digests. No bootstrap role is excluded from
the control comparison.

The report records measured local database-drill durations, **not an approved
RTO, RPO, production outage duration or service-level commitment**. Its
`productionRestored`, `capabilityComplete`, `rtoProven` and `rpoProven` flags stay
false even when this local drill passes. Unit tests qualify tool boundaries;
only a real hosted/local restore qualifies the database-drill execution.

## Private production metadata observation

`scripts/database-backup-metadata.mjs` provides a separate **read-only observation**
of the production provider's backup metadata. It does not run in public CI,
restore a backup, download backup bytes, change a plan, enable PITR or alter
any configuration. Its only provider commands are `projects list --output json`
and `backups list --project-ref <qualified-ref> --output json`.

The target comes from the canonical top-level deployment environment in
`.github/workflows/deploy-migrations.yml`, parsed as YAML with unique keys.
Aliases, anchors, tags, merge keys, job/step target overrides and conflicting
ambient identity are refused. The project must be uniquely present and healthy
in the authenticated provider catalogue. The public frontend must serve a single
same-origin `/assets/*.js` module containing that project reference and no
foreign Supabase reference. Redirects, unsafe paths, duplicate attributes,
unqualified HTTP/content types and oversized responses are refused. The report
explicitly does **not** claim that string presence proves the frontend's runtime
client binding.

Entrypoint qualification parses the original bounded HTML with the existing
`jsdom` development dependency. Comments are not deleted or rewritten into new
tags; template content, raw text and commented script decoys are not module
authority. Script execution and external resource loading remain disabled,
parser diagnostics are not forwarded, and the parser window is closed. Exact
source-tag attributes are checked separately so duplicate attributes do not
become accepted through the parser's first-attribute-wins projection. This is
passive entrypoint inspection, not a browser session or runtime-binding proof.

To obtain the private output directory without printing its contents:

```sh
SYNC_DR_PRODUCTION_METADATA=read_only node --input-type=module -e 'const {runProductionBackupMetadata}=await import("./scripts/database-backup-metadata.mjs"); const {output}=await runProductionBackupMetadata(); console.log(output);'
```

The existing operator's provider authentication is used; credentials must not be
passed as command-line arguments. Extra CLI targets/options and alternate
provider endpoint overrides are refused. Provider commands and public GETs are
bounded by time/size limits. Both the actual process environment and any supplied
environment are checked; injected options cannot hide CI, endpoint or identity
overrides inherited by the CLI. HTTP qualification uses exact media types before
parameters, not substring matches. Duplicate JSON keys, malformed dates/configuration,
duplicate inventory entries or differing project/provider regions fail closed.
Accepted timestamp fractions retain up to six digits for identity, ordering and
future-clock checks; microseconds are not silently rounded to milliseconds.
Raw payloads, signed URLs, backup identifiers, project names, other projects,
asset source and provider diagnostics are never persisted or printed.

The allowlisted report lives in a unique **0700** system-temporary directory,
with an exclusively created **0600** `report.json`; writing it inside this public
checkout is refused. Reports contain private configuration observations,
aggregate inventory counts, insertion timestamps, provider-reported physical
restore points when available, observer/workflow/bundle digests and fixed
warnings. Do not commit, attach to a public PR, upload as a public Actions
artifact or share these reports. Preserve them for the authorized recovery
custodian under the approved retention policy.

An insertion timestamp is **not** a recoverable-data cutoff. A reported restore
window is **not** a successful restore or an approved retention policy. Empty,
uncompleted or future-dated inventories remain observations with warnings.
`observationStatus` can be `CAPTURED`, but `recoveryQualification` remains
`UNPROVEN`; every production/byte restoration, retention, custodian/access,
RPO/RTO and capability-completion proof flag remains false. This closes the
metadata-capture mechanism, not the E5.13 acceptance requirements below.
The projected fields follow the provider's
[backup-list Management API schema](https://supabase.com/docs/reference/api/v1-list-all-backups).

## Remaining E5.13 acceptance requirements

1. Named recovery owner and approved production recovery objectives, dependency
   inventory, incident authority, customer communications and return-to-service
   acceptance criteria.
2. Authoritative production backup/PITR configuration, retention and recent
   restore-point evidence; provider access and custodian recovery must work.
3. Authorized production-like managed backup restore into an isolated recovery
   environment, with independently reviewed tenant/security and governance
   checks and measured loss/outage against approved RPO/RTO. Full-chain rebuild
   or a synthetic local dump is not this evidence.
4. Separate backup and actual byte restoration for private Storage objects;
   verify canonical references, integrity, access policy and legal retention.
5. Restore/re-provision Vault encryption root key, custom role credentials,
   identity-provider/Auth settings/API keys, Edge Functions/secrets, Realtime,
   application/configuration and approved external connectors. Disable restored
   external jobs before they can act; require approval before reconnecting.
6. Exercise application failover, real sign-in, authorized customer journeys,
   attachments and recovery communications. Preserve approval/provenance history;
   a restored historical approval does not authorize a new operational action.
7. Independent architecture/security and operational review, recorded drill
   findings and corrective actions, repeat schedule, then production verification
   and controlled register acceptance. Do not promote from CI alone.

## Provider limitations and basis

[Supabase database backups](https://supabase.com/docs/guides/platform/backups)
exclude Storage file bytes and custom-role passwords. Its
[restore-to-new-project guide](https://supabase.com/docs/guides/platform/clone-project)
requires separate configuration for Storage, Edge Functions, Auth/API keys and
Realtime; physical cloning can start external jobs immediately, while a logical
restore does not transfer the Vault root key. This local network-isolated drill
does not establish those cloud recovery paths.

[Docker's container controls](https://docs.docker.com/reference/cli/docker/container/run/)
define the process-user, privilege, read-only filesystem, capability, namespace,
healthcheck and resource settings independently of the network setting. The
drill qualifies their inspected state rather than assuming network isolation
also proves privilege or resource containment.
Moby's [resource validation](https://github.com/moby/moby/blob/master/daemon/daemon_unix.go)
discards unsupported OOM-disable metadata; its [system information contract](https://github.com/moby/moby/blob/master/api/types/system/info.go)
exposes the bounded cgroup-version and feature-support evidence used here.

[PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
provides a consistent database snapshot but excludes cluster-wide roles; those
come from [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html).
Restoring executes source SQL: this tool accepts only the trusted local migrated
source and contains the fresh target. It is not a production backup scheduler.

The platform wrapper mechanism is documented in Supabase's
[PostgreSQL schema source](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql).
The partitioning follows
[PostgreSQL pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
and its [archive selection implementation](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/pg_dump/pg_backup_archiver.c).
PostgreSQL's [column catalog documentation](https://www.postgresql.org/docs/17/catalog-pg-attribute.html)
distinguishes live columns from inaccessible physical dropped-column entries.
Its [catalog information functions](https://www.postgresql.org/docs/17/functions-info.html)
describe `pg_get_constraintdef` as a reconstructed creating command, not original
SQL text. The [NOT VALID constraint semantics](https://www.postgresql.org/docs/17/sql-altertable.html)
allow the reference to be parsed without scanning or modifying existing rows;
the transaction is rolled back and its inventory effects are verified absent.
PostgreSQL's [sequence semantics](https://www.postgresql.org/docs/16/functions-sequence.html)
distinguish the next value from its called state and explain why changes are not
rolled back. Its [sequence catalog](https://www.postgresql.org/docs/16/catalog-pg-sequence.html)
defines the configuration controls, while the [relation catalog](https://www.postgresql.org/docs/16/catalog-pg-class.html)
identifies materialized-view population state. A real synthetic phased
dump/restore retained counters beyond JavaScript's exact-number range and both
populated and unpopulated views. The previous inventory missed a changed counter
and materialized-view availability; the extended inventory rejected those,
called-state, increment, owning-column, materialized-row and source-counter-drift
mutations. This is a mechanism proof, not hosted full-chain or production proof.
Synthetic socket-only PostgreSQL 16 probes reproduced the missing-member ACL
failure and passed after reconstruction; a separate phased restore retained
database owner/ACL/settings and rejected changed grant options and null-to-empty
ACL mutations. Those stopped probes qualify mechanisms, not the full Supabase
chain, production recovery or an approved RPO/RTO.

## Rollback

Stop this tooling/workflow if qualification fails. Preserve the private artifacts
for an authorized reviewer; destroy them only under the retention policy. No
production rollback, migration reversal, approval-history rewrite or customer
data deletion is necessary because this slice changes no production database.
