-- Speech abuse ceiling for sync-tts.
--
-- sync-tts calls OpenAI Speech for any signed-in user and, before this
-- migration, recorded nothing. Character spend is not token spend. Inserting
-- it into private.llm_usage would count those rows toward the engineering
-- daily call cap and the commercial-period call cap, and a commercial
-- subscription would also require the speech model on an approved plan.
-- This ledger is separate so the speech ceiling does not change commercial
-- plan policy, Marketplace state, or check_llm_quota / record_llm_usage.
--
-- It does not call configure_ai_commercial_plan_policy or
-- approve_ai_commercial_plan_policy. It does not write
-- private.ai_commercial_plan_policies, private.llm_org_quotas, or
-- billing_subscriptions.
--
-- Sizing is an abuse ceiling, not an OEM specification and not a price.
-- sync-tts speaks at most 420 characters, plus one ellipsis when the cut
-- cannot land on a sentence (421). The speech adapter may split one turn
-- into two requests. Twenty turns x 2 requests x 421 characters = 16,840
-- characters per organization per UTC day. Ten requests per 60 seconds is
-- five split turns a minute. Callers may pass a lower cap. They cannot
-- raise it, and they cannot shrink the rate window.
--
-- The reservation row is the usage record. It is inserted before the
-- provider call under a per-organization advisory lock, together with every
-- other open reservation, so concurrent requests cannot all read the same
-- total and pass. Settlement only attaches the model that was actually
-- used. A failed provider call may release the open reservation. A failed
-- settlement leaves it in place.
--
-- The table stores counts and identifiers only. Spoken text is not stored.

create schema if not exists private;

create table if not exists private.sync_tts_usage (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  characters integer not null,
  fn text not null default 'sync-tts',
  model text,
  reserved boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sync_tts_usage_characters_bounds check (
    characters > 0 and characters <= 421
  ),
  constraint sync_tts_usage_fn_check check (fn = 'sync-tts'),
  constraint sync_tts_usage_model_length check (
    model is null or char_length(model) <= 80
  )
);

comment on table private.sync_tts_usage is
  'One row per sync-tts utterance: tenant, user, character count, model. '
  'Abuse ceiling for OpenAI Speech. Not the commercial token ledger. '
  'Never stores spoken text.';

create index if not exists idx_sync_tts_usage_org_created
  on private.sync_tts_usage (organization_id, created_at);

create index if not exists idx_sync_tts_usage_user_window
  on private.sync_tts_usage (organization_id, user_id, created_at);

alter table private.sync_tts_usage enable row level security;

revoke all on private.sync_tts_usage from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reserve: membership, rate limit, daily characters, then the usage row.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_sync_tts_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_characters integer,
  p_max_characters integer default null,
  p_max_requests integer default null,
  p_window_seconds integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $sync_tts$
declare
  c_default_max_characters constant integer := 16840;
  c_default_max_requests constant integer := 10;
  c_default_window_seconds constant integer := 60;
  c_max_utterance_characters constant integer := 421;
  v_profile_org uuid;
  v_max_characters integer;
  v_max_requests integer;
  v_window_seconds integer;
  v_day_start timestamptz;
  v_resets_at timestamptz;
  v_window_start timestamptz;
  v_oldest timestamptz;
  v_rate_resets_at timestamptz;
  v_chars_used bigint;
  v_user_requests bigint;
  v_reservation_id bigint;
begin
  if p_organization_id is null or p_user_id is null then
    return jsonb_build_object('allowed', false, 'limit', 'organization_required');
  end if;
  if p_characters is null or p_characters < 1
    or p_characters > c_max_utterance_characters then
    return jsonb_build_object('allowed', false, 'limit', 'invalid_characters');
  end if;

  -- A shorter window counts fewer requests and would weaken the limit.
  -- A longer window is not the published ceiling. The configured minute stands.
  if p_window_seconds is not null
    and p_window_seconds < c_default_window_seconds then
    v_window_seconds := c_default_window_seconds;
  else
    v_window_seconds := c_default_window_seconds;
  end if;

  v_max_characters := case
    when p_max_characters is null or p_max_characters < 1
      then c_default_max_characters
    else least(p_max_characters, c_default_max_characters)
  end;
  v_max_requests := case
    when p_max_requests is null or p_max_requests < 1
      then c_default_max_requests
    else least(p_max_requests, c_default_max_requests)
  end;

  perform pg_advisory_xact_lock(
    hashtextextended('sync_tts_quota:' || p_organization_id::text, 0)
  );

  select organization_id into v_profile_org
  from public.user_profiles
  where id = p_user_id;
  if v_profile_org is null then
    return jsonb_build_object('allowed', false, 'limit', 'organization_required');
  end if;
  if v_profile_org is distinct from p_organization_id then
    return jsonb_build_object('allowed', false, 'limit', 'organization_mismatch');
  end if;

  v_day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_resets_at := v_day_start + interval '1 day';
  v_window_start := now() - (v_window_seconds * interval '1 second');

  select count(*), min(created_at)
    into v_user_requests, v_oldest
  from private.sync_tts_usage
  where organization_id = p_organization_id
    and user_id = p_user_id
    and created_at > v_window_start;
  v_rate_resets_at := coalesce(v_oldest, now())
    + (v_window_seconds * interval '1 second');
  if v_user_requests >= v_max_requests then
    return jsonb_build_object(
      'allowed', false,
      'limit', 'user_rate_limit_exceeded',
      'requests_in_window', v_user_requests,
      'max_requests', v_max_requests,
      'window_seconds', v_window_seconds,
      'resets_at', v_rate_resets_at
    );
  end if;

  select coalesce(sum(characters), 0) into v_chars_used
  from private.sync_tts_usage
  where organization_id = p_organization_id
    and created_at >= v_day_start;
  if v_chars_used + p_characters > v_max_characters then
    return jsonb_build_object(
      'allowed', false,
      'limit', 'org_daily_character_quota_exceeded',
      'characters_used', v_chars_used,
      'max_characters', v_max_characters,
      'resets_at', v_resets_at
    );
  end if;

  insert into private.sync_tts_usage (
    organization_id, user_id, characters, fn, reserved
  ) values (
    p_organization_id, p_user_id, p_characters, 'sync-tts', true
  ) returning id into v_reservation_id;

  return jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'characters', p_characters,
    'characters_used', v_chars_used + p_characters,
    'max_characters', v_max_characters,
    'requests_in_window', v_user_requests + 1,
    'max_requests', v_max_requests,
    'window_seconds', v_window_seconds,
    'resets_at', v_resets_at
  );
end
$sync_tts$;

revoke all on function public.reserve_sync_tts_usage(
  uuid, uuid, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_sync_tts_usage(
  uuid, uuid, integer, integer, integer, integer
) to service_role;

comment on function public.reserve_sync_tts_usage(
  uuid, uuid, integer, integer, integer, integer
) is
  'Atomic sync-tts check-and-reserve. Refuses when the user has no matching '
  'organization, the per-user rate window is full, or the tenant UTC-day '
  'character ceiling would be exceeded. Inserts the usage row before any '
  'provider call. Caps cannot be raised above the configured defaults.';

-- ---------------------------------------------------------------------------
-- Settle attaches the model. The character count was fixed at reserve time.
-- ---------------------------------------------------------------------------

create or replace function public.settle_sync_tts_usage(
  p_reservation_id bigint,
  p_organization_id uuid,
  p_user_id uuid,
  p_model text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $sync_tts$
declare
  v_model text := nullif(left(btrim(coalesce(p_model, '')), 80), '');
  v_count integer;
begin
  update private.sync_tts_usage
  set reserved = false,
      model = v_model
  where id = p_reservation_id
    and organization_id = p_organization_id
    and user_id = p_user_id
    and reserved;
  get diagnostics v_count = row_count;
  return jsonb_build_object('recorded', v_count = 1);
end
$sync_tts$;

revoke all on function public.settle_sync_tts_usage(bigint, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.settle_sync_tts_usage(bigint, uuid, uuid, text)
  to service_role;

comment on function public.settle_sync_tts_usage(bigint, uuid, uuid, text) is
  'Marks one open sync-tts reservation settled and records the model that '
  'spoke. Does not change the reserved character count. Returns recorded '
  'false when the row is missing or belongs to another user or organization.';

-- ---------------------------------------------------------------------------
-- Release deletes only an open reservation. Settled usage stays counted.
-- ---------------------------------------------------------------------------

create or replace function public.release_sync_tts_usage(
  p_reservation_id bigint,
  p_organization_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $sync_tts$
declare
  v_count integer;
begin
  delete from private.sync_tts_usage
  where id = p_reservation_id
    and organization_id = p_organization_id
    and user_id = p_user_id
    and reserved;
  get diagnostics v_count = row_count;
  return jsonb_build_object('released', v_count = 1);
end
$sync_tts$;

revoke all on function public.release_sync_tts_usage(bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_sync_tts_usage(bigint, uuid, uuid)
  to service_role;

comment on function public.release_sync_tts_usage(bigint, uuid, uuid) is
  'Deletes one open sync-tts reservation after the provider returned no '
  'audio. Settled rows cannot be released.';

-- ---------------------------------------------------------------------------
-- Operator read. Service role only; the caller names the organization.
-- ---------------------------------------------------------------------------

create or replace function public.get_sync_tts_usage(
  p_organization_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $sync_tts$
declare
  c_default_max_characters constant integer := 16840;
  c_default_max_requests constant integer := 10;
  c_default_window_seconds constant integer := 60;
  v_day_start timestamptz;
  v_resets_at timestamptz;
  v_characters bigint;
  v_requests bigint;
  v_open bigint;
begin
  if p_organization_id is null then
    return jsonb_build_object('error', 'organization_required');
  end if;
  v_day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_resets_at := v_day_start + interval '1 day';
  select coalesce(sum(characters), 0),
         count(*),
         count(*) filter (where reserved)
    into v_characters, v_requests, v_open
  from private.sync_tts_usage
  where organization_id = p_organization_id
    and created_at >= v_day_start;
  return jsonb_build_object(
    'organization_id', p_organization_id,
    'characters_used', v_characters,
    'max_characters', c_default_max_characters,
    'requests_today', v_requests,
    'open_reservations', v_open,
    'max_requests_per_window', c_default_max_requests,
    'window_seconds', c_default_window_seconds,
    'resets_at', v_resets_at
  );
end
$sync_tts$;

revoke all on function public.get_sync_tts_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.get_sync_tts_usage(uuid) to service_role;

comment on function public.get_sync_tts_usage(uuid) is
  'Service-role view of one tenant''s sync-tts character usage for the '
  'current UTC day, including open reservations.';

-- ---------------------------------------------------------------------------
-- Tenant read. The organization comes from the signed-in profile, never
-- from an argument the caller could name.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_sync_tts_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $sync_tts$
declare
  c_default_max_characters constant integer := 16840;
  c_default_max_requests constant integer := 10;
  c_default_window_seconds constant integer := 60;
  v_uid uuid := auth.uid();
  v_org uuid;
  v_day_start timestamptz;
  v_resets_at timestamptz;
  v_characters bigint;
  v_requests bigint;
  v_open bigint;
  v_mine bigint;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  select organization_id into v_org
  from public.user_profiles
  where id = v_uid;
  if v_org is null then
    return jsonb_build_object('error', 'organization_required');
  end if;
  v_day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_resets_at := v_day_start + interval '1 day';
  select coalesce(sum(characters), 0),
         count(*),
         count(*) filter (where reserved)
    into v_characters, v_requests, v_open
  from private.sync_tts_usage
  where organization_id = v_org
    and created_at >= v_day_start;
  select count(*) into v_mine
  from private.sync_tts_usage
  where organization_id = v_org
    and user_id = v_uid
    and created_at > now() - (c_default_window_seconds * interval '1 second');
  return jsonb_build_object(
    'organization_id', v_org,
    'characters_used', v_characters,
    'max_characters', c_default_max_characters,
    'requests_today', v_requests,
    'open_reservations', v_open,
    'my_requests_in_window', v_mine,
    'max_requests_per_window', c_default_max_requests,
    'window_seconds', c_default_window_seconds,
    'resets_at', v_resets_at
  );
end
$sync_tts$;

revoke all on function public.get_my_sync_tts_usage()
  from public, anon;
grant execute on function public.get_my_sync_tts_usage() to authenticated;

comment on function public.get_my_sync_tts_usage() is
  'Signed-in view of the caller''s own organization sync-tts usage for the '
  'current UTC day. The organization is the caller''s profile, not an argument.';
