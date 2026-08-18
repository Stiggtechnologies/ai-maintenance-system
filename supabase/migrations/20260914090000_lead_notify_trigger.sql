-- ============================================================================
-- Speed to first response — a pilot lead must never go cold.
--
-- WHAT WAS BROKEN. A visitor completes /pilot/reliability,
-- submit_pilot_intake_request() writes the row with
-- notification_status='queued', and then nothing happens. No mail to the
-- lead, no alert to the owner, no clock. The only thing that ever looked at
-- the queue was a weekday cron on a laptop, which means a Friday-evening lead
-- sat untouched until Monday and the person who sent it heard nothing at all.
-- PilotLeads.tsx already styles 'notified' and 'failed'; nothing has ever
-- written either value.
--
-- WHAT THIS ADDS.
--   1. first_response_due — a real SLA clock. One BUSINESS hour from
--      created_at, where "business" means Mon-Fri 08:00-17:00 in
--      America/Edmonton, the wall clock of the person who answers.
--   2. Per-channel notification bookkeeping (ack_sent_at, owner_alerted_at,
--      notify_claimed_at) so a retry can resume exactly the channel that
--      failed and can never re-send one that already landed.
--   3. private.lead_notify_config — the edge function URL + calling key, in
--      the private schema PostgREST does not expose (same shape as
--      private.enrichment_config, 00000000000009_llm_enrichment.sql).
--   4. configure_lead_notify() — service-role-only RPC to set that config,
--      mirroring configure_onboarding_enrichment
--      (00000000000011_autonomous_onboarding.sql).
--   5. A dispatch allowance (private.lead_notify_dispatch_log) that caps how
--      much outbound mail an anonymous form can cause. See ABUSE below.
--   6. An AFTER INSERT ROW trigger that fires the lead-notify edge function
--      through pg_net the instant a lead lands. A trigger, not a cron:
--      caller-agnostic (the frontend never inserts directly, it calls the
--      SECURITY DEFINER RPC), instant rather than up to N minutes late, and
--      invisible to the E2E cron freeze in ci.yml.
--   7. retry_stalled_lead_notifications() on a 5-minute pg_cron job — pg_net
--      does not retry, so the trigger alone means one transient Resend 429, or
--      a secret that was not set yet, loses the lead silently. The sweeper is
--      the safety net; the trigger is still the fast path.
--   8. mark_pilot_lead_responded() — the admin-gated write that lets the
--      overdue flag on /pilot-leads actually clear. Without it every lead goes
--      red one business hour after arrival and stays red forever, and the one
--      cold-lead signal in the product becomes noise.
--
-- ABUSE. submit_pilot_intake_request is granted to anon and has no captcha or
-- rate limit, so before this migration an anonymous insert was inert. Wiring
-- mail to it turns that endpoint into an amplifier: a loop with a victim's
-- address in `email` would mail the victim, repeatedly, DKIM-signed by
-- syncai.ca, with attacker-authored text. lead_notify_allow_dispatch() caps
-- dispatches at 3 per recipient per 24h and 40 per hour globally, so the
-- damage is bounded and the domain reputation and the owner's alert inbox
-- survive. Suppressed leads still commit and still show on /pilot-leads.
--
-- FAIL-SOFT IS THE WHOLE POINT. A notification problem must never cost us the
-- lead. Every function added here swallows its own errors and lets the INSERT
-- commit: unconfigured, pg_net missing, network dead, bad URL — the row still
-- lands, and the worst case is the status the admin page already renders in
-- amber. Nothing here can roll back an intake.
--
-- NO SECRET IS WRITTEN HERE. private.lead_notify_config is created empty and
-- populated at deploy time by calling configure_lead_notify() with the service
-- key; this file contains no key material of any kind.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The SLA clock
-- ----------------------------------------------------------------------------

alter table public.pilot_intake_requests
  add column if not exists first_response_due timestamptz;

comment on column public.pilot_intake_requests.first_response_due is
  'One business hour after created_at (Mon-Fri 08:00-17:00 America/Edmonton). '
  'Set by trg_pilot_intake_first_response_due; see business_hours_deadline().';

-- Adds a working duration to an instant, honouring Alberta business hours.
--
-- STABLE, not IMMUTABLE, and deliberately so: converting between a timestamptz
-- and Edmonton wall-clock depends on the timezone database, which can change
-- under us. That is exactly why first_response_due is a written column set by
-- a trigger rather than GENERATED ALWAYS — a stored deadline is a promise that
-- was made at a point in time, and it should not silently move later.
--
-- Algorithm: walk forward day by day, consuming the open window of each
-- business day until the duration is used up.
--   * a weekend day, or an instant at/after 17:00, supplies nothing — advance
--   * an instant before 08:00 is pulled forward to 08:00 (the clock cannot
--     start before the day does)
--   * otherwise consume min(remaining, time until 17:00) and, if anything is
--     left, carry it into the next business day
create or replace function public.business_hours_deadline(
  p_from timestamptz,
  p_duration interval
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  c_zone   constant text := 'America/Edmonton';
  c_open   constant interval := interval '8 hours';
  c_close  constant interval := interval '17 hours';
  v_cursor timestamp;
  v_day    date;
  v_open   timestamp;
  v_close  timestamp;
  v_left   interval;
  v_avail  interval;
  v_guard  integer := 0;
begin
  if p_from is null then
    return null;
  end if;

  v_left := greatest(coalesce(p_duration, interval '0'), interval '0');
  v_cursor := p_from at time zone c_zone;

  loop
    v_guard := v_guard + 1;
    -- 400 business days is ~18 months; only a pathological duration gets here.
    -- Fall back to the WHOLE requested duration in wall-clock time, never to
    -- v_left, which has already been decremented by the days consumed so far
    -- and would hand back a deadline earlier than the one asked for.
    if v_guard > 400 then
      return p_from + coalesce(p_duration, interval '0');
    end if;

    v_day   := v_cursor::date;
    v_open  := v_day + c_open;
    v_close := v_day + c_close;

    if extract(isodow from v_day) >= 6 or v_cursor >= v_close then
      v_cursor := (v_day + 1)::timestamp;
      continue;
    end if;

    if v_cursor < v_open then
      v_cursor := v_open;
    end if;

    v_avail := v_close - v_cursor;
    if v_left <= v_avail then
      return (v_cursor + v_left) at time zone c_zone;
    end if;

    v_left := v_left - v_avail;
    v_cursor := (v_day + 1)::timestamp;
  end loop;
end
$$;

comment on function public.business_hours_deadline(timestamptz, interval) is
  'Adds a working duration to an instant across Mon-Fri 08:00-17:00 America/Edmonton.';

-- BEFORE INSERT so the deadline is on the row the AFTER trigger then ships to
-- the notifier, and so it exists no matter which path wrote the lead.
create or replace function public.set_pilot_intake_first_response_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.first_response_due is null then
    begin
      new.first_response_due := public.business_hours_deadline(
        coalesce(new.created_at, now()),
        interval '1 hour'
      );
    exception when others then
      new.first_response_due := coalesce(new.created_at, now()) + interval '1 hour';
    end;
  end if;
  return new;
end
$$;

-- Trigger functions are not directly callable (Postgres refuses a plain
-- SELECT on a function returning `trigger`), and trigger firing does not
-- consult EXECUTE — verified against a live Postgres — so locking these down
-- costs nothing and leaves no publicly-executable surface behind.
revoke execute on function public.set_pilot_intake_first_response_due() from public, anon, authenticated;
grant execute on function public.set_pilot_intake_first_response_due() to service_role;

drop trigger if exists trg_pilot_intake_first_response_due on public.pilot_intake_requests;
create trigger trg_pilot_intake_first_response_due
  before insert on public.pilot_intake_requests
  for each row execute function public.set_pilot_intake_first_response_due();

-- Every lead that arrived before the clock existed still gets one.
update public.pilot_intake_requests
   set first_response_due = public.business_hours_deadline(created_at, interval '1 hour')
 where first_response_due is null;

create index if not exists idx_pilot_intake_requests_first_response_due
  on public.pilot_intake_requests (first_response_due);

-- ----------------------------------------------------------------------------
-- 2. Per-channel notification bookkeeping
-- ----------------------------------------------------------------------------
-- notification_status is an AGGREGATE — 'failed' means "not both channels
-- landed", which is indistinguishable from "nothing was sent". Deriving
-- idempotency from it means a retry after a half-delivery re-acknowledges the
-- visitor. These four columns record what actually happened, per channel, so a
-- retry resumes rather than repeats.

alter table public.pilot_intake_requests
  add column if not exists ack_sent_at timestamptz;
alter table public.pilot_intake_requests
  add column if not exists owner_alerted_at timestamptz;
alter table public.pilot_intake_requests
  add column if not exists notify_claimed_at timestamptz;
alter table public.pilot_intake_requests
  add column if not exists first_responded_at timestamptz;

comment on column public.pilot_intake_requests.ack_sent_at is
  'When the visitor acknowledgement actually left Resend. Set once, never reset '
  '— this is what stops a retry sending a second acknowledgement.';
comment on column public.pilot_intake_requests.owner_alerted_at is
  'When the owner alert actually left Resend. Set once, never reset.';
comment on column public.pilot_intake_requests.notify_claimed_at is
  'Concurrency claim held by an in-flight lead-notify run. Reclaimable once '
  'stale so a crashed run does not strand the lead.';
comment on column public.pilot_intake_requests.first_responded_at is
  'When a human actually answered. Set by mark_pilot_lead_responded(); the only '
  'thing that clears the overdue flag on /pilot-leads.';

-- Leads that predate the notifier must NOT be mailed now. Acknowledging
-- somebody weeks after they wrote in is worse than staying quiet, and the
-- retry sweeper below would otherwise treat every historic row as unsent.
-- Anything less than an hour old is still inside its SLA, so it is left alone
-- and gets a real notification.
update public.pilot_intake_requests
   set ack_sent_at = coalesce(ack_sent_at, created_at),
       owner_alerted_at = coalesce(owner_alerted_at, created_at)
 where (ack_sent_at is null or owner_alerted_at is null)
   and created_at < now() - interval '1 hour';

-- The sweeper's working set: unfinished, recent, not yet answered.
create index if not exists idx_pilot_intake_requests_notify_pending
  on public.pilot_intake_requests (created_at desc)
  where ack_sent_at is null or owner_alerted_at is null;

-- ----------------------------------------------------------------------------
-- 3. Where to send the alert (private schema — not exposed by PostgREST)
-- ----------------------------------------------------------------------------

create schema if not exists private;

create table if not exists private.lead_notify_config (
  id boolean primary key default true check (id),
  function_url text not null,
  service_key text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.configure_lead_notify(
  p_function_url text,
  p_service_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into private.lead_notify_config (id, function_url, service_key)
  values (true, p_function_url, p_service_key)
  on conflict (id) do update
    set function_url = excluded.function_url,
        service_key  = excluded.service_key,
        updated_at   = now();
  -- The key is never echoed back.
  return jsonb_build_object('configured', true, 'function_url', p_function_url);
end
$$;

revoke execute on function public.configure_lead_notify(text, text) from public, anon, authenticated;
grant execute on function public.configure_lead_notify(text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Dispatch allowance — the anonymous form is not an email cannon
-- ----------------------------------------------------------------------------
-- One row per lead we have ever asked the notifier to mail. The recipient is
-- stored as a SHA-256 digest: enough to count per-address, never a readable
-- address sitting outside the RLS-protected table.

-- attempts / last_dispatch_at drive the retry sweeper's backoff. They live
-- here rather than on the lead row so the AFTER INSERT trigger never has to
-- update the table it is firing on, and so the whole notion of "how hard have
-- we tried" stays in one place that PostgREST cannot see.
create table if not exists private.lead_notify_dispatch_log (
  lead_id uuid primary key,
  recipient_hash text not null,
  dispatched_at timestamptz not null default now(),
  last_dispatch_at timestamptz not null default now(),
  attempts integer not null default 0
);

create index if not exists idx_lead_notify_dispatch_log_recipient
  on private.lead_notify_dispatch_log (recipient_hash, dispatched_at desc);
create index if not exists idx_lead_notify_dispatch_log_dispatched
  on private.lead_notify_dispatch_log (dispatched_at desc);

-- True when this lead may cause outbound mail, recording the allowance it
-- consumes. Idempotent per lead: re-dispatching a lead the sweeper already
-- knows about consumes nothing further, so a retry is never throttled by its
-- own earlier attempt.
--
-- The caps are deliberately blunt. An anonymous, captcha-free endpoint cannot
-- be made safe by cleverness; it can be made bounded. A suppressed lead is not
-- lost — the row commits, keeps its SLA clock, and shows on /pilot-leads.
create or replace function public.lead_notify_allow_dispatch(
  p_lead_id uuid,
  p_email text,
  p_per_recipient_limit integer default 3,
  p_global_hourly_limit integer default 40
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash      text;
  v_recipient integer;
  v_global    integer;
  v_known     boolean;
begin
  if p_lead_id is null then
    return false;
  end if;

  select true into v_known
    from private.lead_notify_dispatch_log
   where lead_id = p_lead_id;
  if coalesce(v_known, false) then
    return true;   -- already counted; this is a retry of a known lead
  end if;

  -- convert_to(), not ::bytea: the text->bytea I/O cast would reinterpret a
  -- backslash sequence in an address instead of hashing the bytes as written.
  v_hash := encode(sha256(convert_to(lower(trim(coalesce(p_email, ''))), 'UTF8')), 'hex');

  select count(*) into v_recipient
    from private.lead_notify_dispatch_log
   where recipient_hash = v_hash
     and dispatched_at > now() - interval '24 hours';

  select count(*) into v_global
    from private.lead_notify_dispatch_log
   where dispatched_at > now() - interval '1 hour';

  if v_recipient >= greatest(p_per_recipient_limit, 1)
     or v_global >= greatest(p_global_hourly_limit, 1) then
    raise warning
      'lead_notify_allow_dispatch: suppressed lead % (recipient window %, global window %)',
      p_lead_id, v_recipient, v_global;
    return false;
  end if;

  -- Bounded by the caps above, so at most a few dozen deletes an hour.
  delete from private.lead_notify_dispatch_log
   where dispatched_at < now() - interval '30 days';

  insert into private.lead_notify_dispatch_log (lead_id, recipient_hash)
  values (p_lead_id, v_hash)
  on conflict (lead_id) do nothing;

  return true;
end
$$;

revoke execute on function public.lead_notify_allow_dispatch(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.lead_notify_allow_dispatch(uuid, text, integer, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Dispatch — shared by the instant trigger and the retry sweeper
-- ----------------------------------------------------------------------------

-- POSTs {"lead_id": …} at the configured function URL through pg_net. Returns
-- the pg_net request id, or null when it did not go (unconfigured, throttled).
-- Raises nothing the caller has to handle: every caller here is on the insert
-- path or a cron tick, and neither may be aborted by a notification problem.
--
-- timeout_milliseconds is 45s against the function's own ~8s-per-call budget
-- (two emails plus an SMS), so pg_net does not record a timeout while the
-- isolate is still legitimately working.
create or replace function public.dispatch_lead_notification(p_lead_id uuid, p_email text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg    record;
  req_id bigint;
begin
  select * into cfg from private.lead_notify_config where id = true;

  if cfg.function_url is null or length(trim(cfg.function_url)) = 0 then
    -- Loud on purpose. A silent no-op here is indistinguishable from "no leads
    -- arrived", and that is exactly how the previous version went cold.
    raise warning
      'dispatch_lead_notification: lead % not dispatched — private.lead_notify_config is empty. Run configure_lead_notify().',
      p_lead_id;
    return null;
  end if;

  if not public.lead_notify_allow_dispatch(p_lead_id, p_email) then
    return null;
  end if;

  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('lead_id', p_lead_id),
    timeout_milliseconds := 45000
  ) into req_id;

  update private.lead_notify_dispatch_log
     set last_dispatch_at = now(),
         attempts = attempts + 1
   where lead_id = p_lead_id;

  return req_id;
end
$$;

revoke execute on function public.dispatch_lead_notification(uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_lead_notification(uuid, text) to service_role;

-- Fires lead-notify the moment a lead lands. pg_net queues the request and a
-- background worker sends it, so the INSERT does not wait on the network. The
-- whole body sits inside an exception block: if config is missing, if the net
-- schema is not there, if anything at all raises, the handler logs a warning
-- and returns NEW so the lead still commits.
create or replace function public.on_pilot_intake_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  req_id bigint;
begin
  begin
    req_id := public.dispatch_lead_notification(new.id, new.email);
  exception when others then
    raise warning 'on_pilot_intake_created: dispatch failed for lead % (%)', new.id, sqlerrm;
    return new;
  end;

  return new;
end
$$;

revoke execute on function public.on_pilot_intake_created() from public, anon, authenticated;
grant execute on function public.on_pilot_intake_created() to service_role;

revoke execute on function public.business_hours_deadline(timestamptz, interval) from public, anon, authenticated;
grant execute on function public.business_hours_deadline(timestamptz, interval) to service_role;

drop trigger if exists trg_pilot_intake_notify on public.pilot_intake_requests;
create trigger trg_pilot_intake_notify
  after insert on public.pilot_intake_requests
  for each row execute function public.on_pilot_intake_created();

-- ----------------------------------------------------------------------------
-- 6. Claim and record — what the edge function calls back into
-- ----------------------------------------------------------------------------

-- A single-statement claim. Two concurrent pg_net deliveries cannot both win,
-- so the visitor cannot be acknowledged twice by a duplicate delivery. A claim
-- older than p_stale_seconds is reclaimable, so an isolate that was torn down
-- mid-send does not strand the lead forever.
create or replace function public.claim_lead_notification(
  p_lead_id uuid,
  p_stale_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.pilot_intake_requests
     set notify_claimed_at = now()
   where id = p_lead_id
     and (
       notify_claimed_at is null
       or notify_claimed_at < now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 300), 30))
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end
$$;

revoke execute on function public.claim_lead_notification(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_lead_notification(uuid, integer) to service_role;

-- Records what actually landed and derives the aggregate status FROM THE
-- CUMULATIVE COLUMNS, not from this attempt alone: an acknowledgement that
-- went out on attempt 1 and an owner alert that went out on attempt 2 add up
-- to a notified lead. Per-channel stamps are write-once.
create or replace function public.record_lead_notification(
  p_lead_id uuid,
  p_ack_sent boolean,
  p_owner_alerted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilot_intake_requests%rowtype;
begin
  update public.pilot_intake_requests
     set ack_sent_at = case
           when ack_sent_at is not null then ack_sent_at
           when coalesce(p_ack_sent, false) then now()
           else null
         end,
         owner_alerted_at = case
           when owner_alerted_at is not null then owner_alerted_at
           when coalesce(p_owner_alerted, false) then now()
           else null
         end
   where id = p_lead_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.pilot_intake_requests
     set notification_status = case
           when v_row.ack_sent_at is not null and v_row.owner_alerted_at is not null
             then 'notified'
           else 'failed'
         end,
         notified_at = case
           when v_row.ack_sent_at is not null and v_row.owner_alerted_at is not null
             then coalesce(notified_at, now())
           else notified_at
         end
   where id = p_lead_id
  returning * into v_row;

  return jsonb_build_object(
    'found', true,
    'notification_status', v_row.notification_status,
    'ack_sent_at', v_row.ack_sent_at,
    'owner_alerted_at', v_row.owner_alerted_at
  );
end
$$;

revoke execute on function public.record_lead_notification(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_lead_notification(uuid, boolean, boolean) to service_role;

-- ----------------------------------------------------------------------------
-- 7. The retry sweeper — pg_net does not retry, so something has to
-- ----------------------------------------------------------------------------
-- Without this, one transient Resend 429, one pg_net timeout, or a
-- RESEND_API_KEY that was not set until Monday means the lead is never
-- notified and the only trace is a coloured pill on a page nobody has open.
--
-- Backoff: a lead is re-dispatched no sooner than 5 minutes after its last
-- claim, widening to hourly after a dozen attempts, and is given up on after 7
-- days. Small batches so a backlog cannot stampede Resend.
create or replace function public.retry_stalled_lead_notifications(
  p_batch integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead      record;
  v_requested integer := 0;
  v_seen      integer := 0;
begin
  for v_lead in
    select l.id, l.email
      from public.pilot_intake_requests l
      left join private.lead_notify_dispatch_log d on d.lead_id = l.id
     where (l.ack_sent_at is null or l.owner_alerted_at is null)
       and l.first_responded_at is null
       and l.created_at > now() - interval '7 days'
       -- not while a run is genuinely in flight
       and (l.notify_claimed_at is null
            or l.notify_claimed_at < now() - interval '5 minutes')
       -- and not faster than the backoff for how often we have already tried
       and (d.last_dispatch_at is null
            or d.last_dispatch_at <
                 now() - make_interval(mins => least(greatest(d.attempts, 1), 12) * 5))
     order by l.created_at
     limit greatest(coalesce(p_batch, 20), 1)
  loop
    v_seen := v_seen + 1;
    begin
      if public.dispatch_lead_notification(v_lead.id, v_lead.email) is not null then
        v_requested := v_requested + 1;
      end if;
    exception when others then
      raise warning 'retry_stalled_lead_notifications: lead % (%)', v_lead.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('examined', v_seen, 'requested', v_requested);
end
$$;

revoke execute on function public.retry_stalled_lead_notifications(integer) from public, anon, authenticated;
grant execute on function public.retry_stalled_lead_notifications(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-lead-notify-retry';
    perform cron.schedule(
      'syncai-lead-notify-retry',
      '*/5 * * * *',
      'select public.retry_stalled_lead_notifications()'
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 8. Closing the loop — the admin-gated "I answered this" write
-- ----------------------------------------------------------------------------
-- pilot_intake_requests has exactly one policy (SELECT, admin/ai_admin) and no
-- write policy at all, so nothing in the product could ever move a lead out of
-- status 'new'. That made the overdue flag permanent: every lead red one
-- business hour after arrival, forever, including ones answered in ten
-- minutes. This is the one write the admin surface needs, gated by the same
-- role test the read policy uses (00000000000018_security_events.sql).
create or replace function public.mark_pilot_lead_responded(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row  public.pilot_intake_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select role into v_role from user_profiles where id = auth.uid();

  if v_role is null or v_role not in ('admin', 'ai_admin') then
    raise exception 'Pilot leads are administrator-only'
      using errcode = 'insufficient_privilege';
  end if;

  update public.pilot_intake_requests
     set first_responded_at = coalesce(first_responded_at, now()),
         status = case when status = 'new' then 'contacted' else status end
   where id = p_lead_id
  returning * into v_row;

  if not found then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'first_responded_at', v_row.first_responded_at
  );
end
$$;

revoke execute on function public.mark_pilot_lead_responded(uuid) from public, anon;
grant execute on function public.mark_pilot_lead_responded(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9. Realtime for the admin leads page
-- ----------------------------------------------------------------------------
-- PilotLeads.tsx already calls useRealtimeRefetch(['pilot_intake_requests']),
-- but the table was never in the publication, so the LIVE badge never lit and
-- a lead arriving while the page was open was invisible until a manual
-- refresh.
--
-- REPLICA IDENTITY STAYS DEFAULT. Realtime applies RLS to insert and update
-- events, but NOT to deletes — Postgres cannot check access to a row that no
-- longer exists — so `replica identity full` would put every column of a
-- deleted lead (name, work email, company, notes) into a payload any
-- publishable-key subscriber can receive. That is precisely the PII
-- 20260913090000 was written to lock down. The default identity puts only the
-- primary key in the delete payload, and the page discards the payload anyway
-- (useRealtimeRefetch just calls refetch), so nothing is lost.
alter table public.pilot_intake_requests replica identity default;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.pilot_intake_requests';
    exception when others then
      -- duplicate_object on a re-run, wrong_object_type if the publication is
      -- ever FOR ALL TABLES. Neither is worth failing a deploy over.
      raise notice 'pilot_intake_requests not added to supabase_realtime (%)', sqlerrm;
    end;
  end if;
end
$$;
