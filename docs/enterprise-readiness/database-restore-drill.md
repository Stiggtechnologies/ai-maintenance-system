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

The canonical records are restored, not remodelled: assets, components, evidence,
recommendations, decisions, approvals, work, audit history and customer identity
remain the existing tables. No application queue, workflow engine, audit store,
new migration or parallel evidence model is introduced.

Qualification compares all ordinary table rows in `public`, `auth`, `storage`
and `supabase_migrations` using counts and ordered multiset SHA-256 digests.
It compares roles/memberships, extensions and schemas, plus canonical relation
owners/ACLs/RLS flags, columns, policies, functions (including SECURITY DEFINER,
owner/search path/grants), constraints, indexes and noninternal triggers.
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
