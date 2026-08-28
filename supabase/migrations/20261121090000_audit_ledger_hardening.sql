-- ============================================================================
-- Sync Develop Slice 3B — the audit ledger hardened (D11.31, spec §71–78).
--
-- Overlap-map ruling 16 is binding: audit_events is the ONE ledger (AGENTS
-- invariant 8 forbids a parallel log). This file EXTENDS it — no second
-- store, no rename, no rewrite of history:
--
--   1. previous_state / new_state — the §71–78 ledger contract names
--      "previous/new" beside who/what/when/why/source. Sixty definer RPC
--      insert sites already write who/what/when/why; the columns land here
--      nullable so history is untouched, and the RPC families THIS slice
--      touches (condition closure, waiver decisions, sanction) populate
--      them — the register row records which families still write without
--      snapshots, so the gap stays named rather than implied closed.
--   2. approval_reference — the "approval" leg of the same contract: the id
--      of the governing approval record (an authority_limits row exercised,
--      a waiver decided, a review that carried the act). Polymorphic on
--      purpose — approvals live on many governed tables — so it carries no
--      FK; the event_data names which table the reference points into.
--   3. THE APPEND-ONLY BACKSTOP. The register row is exact: append-only
--      currently rests on POLICY ABSENCE (clients hold SELECT only,
--      20260917000000:78-83 — "an audit log a user can rewrite is not an
--      audit log"). Policy absence does not bind the service key. The
--      triggers below raise on UPDATE, DELETE and TRUNCATE UNCONDITIONALLY
--      — client, service, admin, every path: an audit log NOBODY can
--      rewrite. TRUNCATE needs its own statement-level trigger (a row-level
--      UPDATE/DELETE trigger never fires for it, and RLS does not gate it),
--      and the verb is additionally revoked from every API role: erasing
--      the whole ledger in one statement is the largest rewrite of all, not
--      an exemption from the rule. This is
--      deliberately NOT the admit-and-audit service posture of the §70
--      provenance triggers: those guard current-state tables where a
--      service restore/correction is legitimate; the ledger's whole value
--      is that no correction of it exists. A mistaken audit row is answered
--      by a new row saying so, never by editing the old one.
--        * A platform restore runs with session_replication_role=replica
--          (triggers disabled) and is unaffected.
--        * organizations teardown does not cascade here in practice: every
--          insert site writes the ACTING org's id (verified against the
--          20261120090000 tree RPCs, which audit into the caller's org, not
--          the created node's).
-- ============================================================================

alter table public.audit_events
  add column if not exists previous_state jsonb,
  add column if not exists new_state jsonb,
  add column if not exists approval_reference uuid;

-- Snapshots are objects (a state, not a scalar); enforced only when present
-- so the sixty existing insert sites are untouched.
alter table public.audit_events
  drop constraint if exists audit_events_previous_state_shape,
  drop constraint if exists audit_events_new_state_shape;
alter table public.audit_events
  add constraint audit_events_previous_state_shape
    check (previous_state is null or jsonb_typeof(previous_state) = 'object'),
  add constraint audit_events_new_state_shape
    check (new_state is null or jsonb_typeof(new_state) = 'object');

comment on column public.audit_events.previous_state is
  'D11.31: jsonb snapshot of the governed row BEFORE the recorded act. Populated by the definer RPCs as their families land; null on events recorded before the column existed or by families not yet capturing state.';
comment on column public.audit_events.new_state is
  'D11.31: jsonb snapshot of the governed row AFTER the recorded act.';
comment on column public.audit_events.approval_reference is
  'D11.31 / spec §71-78 "approval": id of the approval record governing this act (authority limit exercised, waiver decision, gate review). Polymorphic — event_data names the table it points into.';

-- ---------------------------------------------------------------------------
-- The backstop. BEFORE UPDATE OR DELETE, raises for every caller. No marker,
-- no service branch, no admit-and-audit: the ledger is the thing the audits
-- land IN, so an audited rewrite of it would be self-certifying.
-- ---------------------------------------------------------------------------
create or replace function public.audit_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_events is append-only for every caller, the service path included. '
    'An audit log a user can rewrite is not an audit log, and one the platform '
    'can rewrite is not one either (D11.31, spec §71-78: never overwrite '
    'decision history). A wrong audit row is answered by a NEW row that says '
    'so — recorded, attributed, beside the original.'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.audit_events_append_only() from public, anon, authenticated;

drop trigger if exists trg_audit_events_append_only on public.audit_events;
create trigger trg_audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.audit_events_append_only();

-- TRUNCATE fires no row-level trigger and is not filtered by RLS — without
-- this statement-level twin, one `truncate audit_events` from any service
-- surface erases the entire decision history with no trace. Same raise-only
-- function (TRUNCATE triggers ignore OLD/NEW), same no-exemptions posture.
drop trigger if exists trg_audit_events_no_truncate on public.audit_events;
create trigger trg_audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.audit_events_append_only();

-- Belt beside the suspenders: the baseline `grant all` handed TRUNCATE to
-- every API role. The statement trigger is the load-bearing half (a table
-- owner truncates regardless of grants); the revoke removes the verb from
-- the roles that never had a right to it.
revoke truncate on table public.audit_events from anon, authenticated, service_role;

notify pgrst, 'reload schema';
