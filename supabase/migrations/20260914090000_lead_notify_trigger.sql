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
--   2. private.lead_notify_config — the edge function URL + calling key, in
--      the private schema PostgREST does not expose (same shape as
--      private.enrichment_config, 00000000000009_llm_enrichment.sql).
--   3. configure_lead_notify() — service-role-only RPC to set that config,
--      mirroring configure_onboarding_enrichment
--      (00000000000011_autonomous_onboarding.sql).
--   4. An AFTER INSERT ROW trigger that fires the lead-notify edge function
--      through pg_net the instant a lead lands. A trigger, not a cron:
--      caller-agnostic (the frontend never inserts directly, it calls the
--      SECURITY DEFINER RPC), instant rather than up to N minutes late, and
--      invisible to the E2E cron freeze in ci.yml.
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
    if v_guard > 400 then
      return p_from + v_left;
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
-- 2. Where to send the alert (private schema — not exposed by PostgREST)
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
-- 3. The instant-dispatch trigger
-- ----------------------------------------------------------------------------

-- Fires lead-notify through pg_net the moment a lead lands. pg_net queues the
-- request and a background worker sends it, so the INSERT does not wait on the
-- network. The whole body sits inside an exception block: if config is
-- missing, if the net schema is not there, if anything at all raises, the
-- handler logs a warning and returns NEW so the lead still commits.
create or replace function public.on_pilot_intake_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg    record;
  req_id bigint;
begin
  begin
    select * into cfg from private.lead_notify_config where id = true;

    if cfg.function_url is null or length(trim(cfg.function_url)) = 0 then
      return new;
    end if;

    select net.http_post(
      url := cfg.function_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || cfg.service_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('lead_id', new.id),
      timeout_milliseconds := 30000
    ) into req_id;
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
-- 4. Realtime for the admin leads page
-- ----------------------------------------------------------------------------
-- PilotLeads.tsx already calls useRealtimeRefetch(['pilot_intake_requests']),
-- but the table was never in the publication, so the LIVE badge never lit and
-- a lead arriving while the page was open was invisible until a manual
-- refresh. Realtime enforces RLS per subscriber and the only policy is
-- pilot_intake_requests_admin_read, so this streams to admins and nobody else.
-- Idempotent: duplicate_object is swallowed, and the publication is only
-- touched when it exists.
alter table public.pilot_intake_requests replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.pilot_intake_requests';
    exception when duplicate_object then
      null;
    end;
  end if;
end
$$;
