-- Azure Marketplace Gate A6: canonical, hourly, idempotent usage metering.
--
-- The old marketplace-metering prototype trusted caller-supplied quantity and
-- emitted one request per call. This contract does neither. It derives usage
-- from settled private.llm_usage rows, applies an explicitly configured offer
-- dimension and included quantity, emits at most one row per Microsoft SaaS
-- subscription/dimension/UTC hour, and retains Microsoft's exact terminal
-- response. The dispatcher is service-only and remains disabled until the
-- publisher, plan dimension and protected caller key are all configured.

create table if not exists private.marketplace_meter_definitions (
  plan_id text not null,
  dimension text not null,
  source_metric text not null default 'llm_total_tokens',
  unit_size numeric not null,
  included_quantity numeric not null default 0,
  quantity_scale integer not null default 0,
  active boolean not null default true,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, dimension),
  constraint marketplace_meter_definition_plan check (btrim(plan_id) <> '' and length(plan_id) <= 200),
  constraint marketplace_meter_definition_dimension check (btrim(dimension) <> '' and length(dimension) <= 100),
  constraint marketplace_meter_definition_source check (source_metric = 'llm_total_tokens'),
  constraint marketplace_meter_definition_unit check (
    unit_size > 0 and unit_size <> 'NaN'::numeric
    and unit_size <> 'Infinity'::numeric and unit_size <> '-Infinity'::numeric
  ),
  constraint marketplace_meter_definition_included check (
    included_quantity >= 0 and included_quantity <> 'NaN'::numeric
    and included_quantity <> 'Infinity'::numeric and included_quantity <> '-Infinity'::numeric
  ),
  constraint marketplace_meter_definition_scale check (quantity_scale between 0 and 6)
);

alter table private.marketplace_meter_definitions enable row level security;
revoke all on table private.marketplace_meter_definitions from public, anon, authenticated, service_role;

create table if not exists public.marketplace_hourly_metering_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  billing_subscription_id uuid not null references public.billing_subscriptions(id) on delete restrict,
  marketplace_subscription_id text not null,
  plan_id text not null,
  dimension text not null,
  source_metric text not null,
  term_start timestamptz not null,
  usage_hour timestamptz not null,
  source_window_end timestamptz not null,
  source_event_count bigint not null,
  source_max_id bigint,
  source_units numeric not null,
  included_quantity numeric not null,
  prior_unreportable_quantity numeric not null,
  prior_allocated_quantity numeric not null,
  quantity numeric not null,
  request_fingerprint text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  request_id uuid,
  correlation_id uuid,
  microsoft_usage_event_id text,
  microsoft_status text,
  microsoft_message_time timestamptz,
  microsoft_response jsonb,
  last_error_code text,
  last_http_status integer,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace_subscription_id, dimension, usage_hour),
  constraint marketplace_hourly_meter_identity check (
    btrim(marketplace_subscription_id) <> '' and btrim(plan_id) <> ''
    and btrim(dimension) <> '' and source_metric = 'llm_total_tokens'
  ),
  constraint marketplace_hourly_meter_source check (
    source_event_count >= 0 and source_units >= 0 and included_quantity >= 0
    and prior_unreportable_quantity >= 0
    and prior_allocated_quantity >= 0
  ),
  constraint marketplace_hourly_meter_quantity check (
    quantity > 0 and quantity <> 'NaN'::numeric
    and quantity <> 'Infinity'::numeric and quantity <> '-Infinity'::numeric
  ),
  constraint marketplace_hourly_meter_fingerprint check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint marketplace_hourly_meter_status check (
    status in ('pending','claimed','retry','accepted','duplicate','rejected','expired','conflict')
  ),
  constraint marketplace_hourly_meter_attempt check (attempt_count >= 0),
  constraint marketplace_hourly_meter_claim check (
    (status = 'claimed' and claim_token is not null and claimed_at is not null)
    or status <> 'claimed'
  ),
  constraint marketplace_hourly_meter_response_size check (
    microsoft_response is null or octet_length(microsoft_response::text) <= 131072
  )
);

create index if not exists marketplace_hourly_meter_pending_idx
  on public.marketplace_hourly_metering_events (next_attempt_at, usage_hour)
  where status in ('pending','retry');
create index if not exists marketplace_hourly_meter_org_idx
  on public.marketplace_hourly_metering_events (organization_id, usage_hour desc);

alter table public.marketplace_hourly_metering_events enable row level security;
alter table public.marketplace_hourly_metering_events force row level security;
revoke all on table public.marketplace_hourly_metering_events from public, anon, authenticated, service_role;
grant select on table public.marketplace_hourly_metering_events to service_role;

create table if not exists private.marketplace_metering_dispatch_config (
  id boolean primary key default true check (id),
  function_url text not null,
  service_key text not null,
  configured_at timestamptz not null default now()
);
alter table private.marketplace_metering_dispatch_config enable row level security;
revoke all on table private.marketplace_metering_dispatch_config from public, anon, authenticated, service_role;

create or replace function public.configure_marketplace_meter_dimension(
  p_plan_id text,
  p_dimension text,
  p_unit_size numeric,
  p_included_quantity numeric default 0,
  p_quantity_scale integer default 0,
  p_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if btrim(coalesce(p_plan_id,''))='' or length(btrim(p_plan_id))>200
    or btrim(coalesce(p_dimension,''))='' or length(btrim(p_dimension))>100 then
    raise exception 'Marketplace meter plan and dimension are required';
  end if;
  if p_unit_size is null or p_unit_size <= 0 or p_unit_size in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or p_included_quantity is null or p_included_quantity < 0
    or p_included_quantity in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or p_quantity_scale not between 0 and 6 then
    raise exception 'Marketplace meter conversion is invalid';
  end if;
  if exists (
    select 1 from private.marketplace_meter_definitions d
    where d.plan_id=btrim(p_plan_id) and d.dimension=btrim(p_dimension)
      and (d.unit_size<>p_unit_size or d.included_quantity<>p_included_quantity
        or d.quantity_scale<>p_quantity_scale)
  ) and exists (
    select 1 from public.marketplace_hourly_metering_events e
    where e.plan_id=btrim(p_plan_id) and e.dimension=btrim(p_dimension)
  ) then
    raise exception 'Marketplace meter conversion is locked after its first usage event';
  end if;
  insert into private.marketplace_meter_definitions (
    plan_id,dimension,unit_size,included_quantity,quantity_scale,active,updated_at
  ) values (
    btrim(p_plan_id),btrim(p_dimension),p_unit_size,p_included_quantity,p_quantity_scale,coalesce(p_active,true),now()
  ) on conflict (plan_id,dimension) do update set
    unit_size=excluded.unit_size,included_quantity=excluded.included_quantity,
    quantity_scale=excluded.quantity_scale,active=excluded.active,updated_at=now();
  return jsonb_build_object('planId',btrim(p_plan_id),'dimension',btrim(p_dimension),'active',coalesce(p_active,true));
end;
$$;

create or replace function public.prepare_marketplace_metering(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v record;
  v_hour timestamptz;
  v_last_hour timestamptz := date_trunc('hour',p_now) - interval '1 hour';
  v_first_hour timestamptz;
  v_source_count bigint;
  v_source_max bigint;
  v_source_tokens numeric;
  v_cumulative numeric;
  v_billable numeric;
  v_baseline_tokens numeric;
  v_unreportable numeric;
  v_allocated numeric;
  v_due numeric;
  v_inserted integer := 0;
begin
  if p_now is null then raise exception 'Metering preparation time is required'; end if;
  for v in
    select s.id as billing_subscription_id,s.organization_id,
      s.marketplace_subscription_id,s.marketplace_plan_id,
      r.term_start,r.term_end,d.dimension,d.source_metric,d.unit_size,
      d.included_quantity,d.quantity_scale
    from public.billing_subscriptions s
    join public.marketplace_fulfillment_resolutions r
      on r.billing_subscription_id=s.id and r.organization_id=s.organization_id
    join private.marketplace_meter_definitions d on d.plan_id=s.marketplace_plan_id and d.active
    where s.billing_source='azure_marketplace' and s.status='active'
      and s.marketplace_status='Subscribed'
      and s.marketplace_subscription_id is not null
      and r.internal_status='active' and r.marketplace_status='Subscribed'
      and r.term_start is not null
  loop
    v_first_hour := greatest(date_trunc('hour',v.term_start),date_trunc('hour',p_now)-interval '23 hours');
    if v_first_hour > v_last_hour then continue; end if;

    -- Microsoft refuses usage more than 24 hours old. Establish the already
    -- billable quantity before this reportable window as an explicit baseline
    -- so enabling a meter mid-term never disguises historical usage as current.
    select coalesce(sum(u.prompt_tokens::numeric+u.completion_tokens::numeric),0)
      into v_baseline_tokens
    from private.llm_usage u
    where u.organization_id=v.organization_id and not u.reserved
      and u.created_at >= v.term_start and u.created_at < v_first_hour;
    v_unreportable := greatest(
      trunc((v_baseline_tokens/v.unit_size)*power(10::numeric,v.quantity_scale))
        / power(10::numeric,v.quantity_scale) - v.included_quantity,
      0
    );

    for v_hour in select generate_series(v_first_hour,v_last_hour,interval '1 hour') loop
      if v.term_end is not null and v_hour >= v.term_end then continue; end if;
      if exists (
        select 1 from public.marketplace_hourly_metering_events e
        where e.marketplace_subscription_id=v.marketplace_subscription_id
          and e.dimension=v.dimension and e.usage_hour=v_hour
      ) then continue; end if;

      select count(*),max(u.id),coalesce(sum(u.prompt_tokens::numeric+u.completion_tokens::numeric),0)
        into v_source_count,v_source_max,v_source_tokens
      from private.llm_usage u
      where u.organization_id=v.organization_id and not u.reserved
        and u.created_at >= v.term_start
        and u.created_at < least(v_hour+interval '1 hour',coalesce(v.term_end,'infinity'::timestamptz));

      v_cumulative := trunc((v_source_tokens/v.unit_size)*power(10::numeric,v.quantity_scale))
        / power(10::numeric,v.quantity_scale);
      v_billable := greatest(v_cumulative-v.included_quantity,0);
      select coalesce(sum(e.quantity),0) into v_allocated
      from public.marketplace_hourly_metering_events e
      where e.marketplace_subscription_id=v.marketplace_subscription_id
        and e.dimension=v.dimension and e.term_start=v.term_start
        and e.usage_hour>=v_first_hour;
      v_due := v_billable-v_unreportable-v_allocated;
      if v_due <= 0 then continue; end if;

      insert into public.marketplace_hourly_metering_events (
        organization_id,billing_subscription_id,marketplace_subscription_id,
        plan_id,dimension,source_metric,term_start,usage_hour,source_window_end,
        source_event_count,source_max_id,source_units,included_quantity,
        prior_unreportable_quantity,prior_allocated_quantity,quantity,request_fingerprint
      ) values (
        v.organization_id,v.billing_subscription_id,v.marketplace_subscription_id,
        v.marketplace_plan_id,v.dimension,v.source_metric,v.term_start,v_hour,
        least(v_hour+interval '1 hour',coalesce(v.term_end,'infinity'::timestamptz)),
        v_source_count,v_source_max,v_source_tokens,v.included_quantity,
        v_unreportable,v_allocated,v_due,encode(extensions.digest(jsonb_build_object(
          'resourceId',v.marketplace_subscription_id,'dimension',v.dimension,
          'quantity',v_due,'effectiveStartTime',v_hour,'planId',v.marketplace_plan_id
        )::text,'sha256'),'hex')
      ) on conflict (marketplace_subscription_id,dimension,usage_hour) do nothing;
      if found then v_inserted := v_inserted+1; end if;
    end loop;
  end loop;
  return jsonb_build_object('prepared',v_inserted,'throughHour',v_last_hour);
end;
$$;

create or replace function public.claim_marketplace_metering_batch(
  p_limit integer default 25,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_claim uuid := gen_random_uuid();
  v_events jsonb;
begin
  update public.marketplace_hourly_metering_events
  set status='expired',claim_token=null,claimed_at=null,last_error_code='older_than_24_hours',updated_at=p_now
  where status in ('pending','claimed','retry') and usage_hour < p_now-interval '24 hours';
  update public.marketplace_hourly_metering_events
  set status='retry',claim_token=null,claimed_at=null,
      next_attempt_at=p_now,last_error_code='stale_claim_released',updated_at=p_now
  where status='claimed' and claimed_at < p_now-interval '15 minutes';

  with chosen as (
    select e.id from public.marketplace_hourly_metering_events e
    join public.billing_subscriptions s on s.id=e.billing_subscription_id
    where e.status in ('pending','retry') and e.next_attempt_at<=p_now
      and e.usage_hour>=p_now-interval '24 hours'
      and s.status='active' and s.marketplace_status='Subscribed'
    order by e.usage_hour,e.created_at
    limit least(greatest(coalesce(p_limit,25),1),25)
    for update of e skip locked
  ), claimed as (
    update public.marketplace_hourly_metering_events e
    set status='claimed',claim_token=v_claim,claimed_at=p_now,
        attempt_count=e.attempt_count+1,updated_at=p_now
    from chosen where e.id=chosen.id
    returning e.*
  )
  select jsonb_agg(jsonb_build_object(
    'recordId',id,'resourceId',marketplace_subscription_id,
    'dimension',dimension,'quantity',quantity,
    'effectiveStartTime',to_char(usage_hour,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'planId',plan_id
  ) order by usage_hour,created_at) into v_events from claimed;
  if v_events is null then return jsonb_build_object('empty',true); end if;
  return jsonb_build_object('claimToken',v_claim,'events',v_events);
end;
$$;

create or replace function public.complete_marketplace_metering_batch(
  p_claim_token uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_results jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.marketplace_hourly_metering_events%rowtype;
  v_result jsonb;
  v_status text;
  v_completed integer := 0;
  v_expected integer;
begin
  if p_claim_token is null or p_request_id is null or p_correlation_id is null
    or jsonb_typeof(p_results)<>'array' then
    raise exception 'Marketplace metering completion evidence is incomplete';
  end if;
  select count(*) into v_expected from public.marketplace_hourly_metering_events
  where claim_token=p_claim_token and status='claimed';
  if v_expected=0 or jsonb_array_length(p_results)<>v_expected then
    raise exception 'Marketplace metering completion does not match the claim';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_results) result
    where jsonb_typeof(result)<>'object'
      or coalesce(result->>'recordId','') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) or (
    select count(distinct result->>'recordId')
    from jsonb_array_elements(p_results) result
  )<>v_expected then
    raise exception 'Marketplace metering completion contains duplicate or invalid record identities';
  end if;
  for v_event in select * from public.marketplace_hourly_metering_events
    where claim_token=p_claim_token and status='claimed' for update
  loop
    select value into v_result from jsonb_array_elements(p_results)
    where value->>'recordId'=v_event.id::text;
    if v_result is null then raise exception 'Marketplace metering result is missing claimed event %',v_event.id; end if;
    v_status := case
      when v_result->>'status'='Accepted'
        and (v_result->>'acceptedQuantity')::numeric=v_event.quantity then 'accepted'
      when v_result->>'status'='Duplicate'
        and coalesce((v_result->>'exactDuplicate')::boolean,false)
        and (v_result->>'acceptedQuantity')::numeric=v_event.quantity then 'duplicate'
      when v_result->>'status'='Duplicate' then 'conflict'
      when v_result->>'status'='Expired' then 'expired'
      else 'rejected' end;
    update public.marketplace_hourly_metering_events set
      status=v_status,claim_token=null,claimed_at=null,request_id=p_request_id,
      correlation_id=p_correlation_id,microsoft_usage_event_id=nullif(v_result->>'usageEventId',''),
      microsoft_status=v_result->>'status',
      microsoft_message_time=case when nullif(v_result->>'messageTime','') is null then null
        else (v_result->>'messageTime')::timestamptz end,
      microsoft_response=v_result->'response',
      last_error_code=case when v_status in ('accepted','duplicate') then null else lower(v_result->>'status') end,
      last_http_status=200,submitted_at=now(),updated_at=now()
    where id=v_event.id;
    insert into public.audit_events (organization_id,entity_type,actor,event_data)
    values (v_event.organization_id,'azure_marketplace_metering','marketplace_metering_service',jsonb_build_object(
      'event','usage_emission_completed','meteringRecordId',v_event.id,
      'marketplaceSubscriptionId',v_event.marketplace_subscription_id,
      'dimension',v_event.dimension,'usageHour',v_event.usage_hour,
      'quantity',v_event.quantity,'status',v_status,'microsoftStatus',v_result->>'status',
      'requestId',p_request_id,'correlationId',p_correlation_id
    ));
    v_completed:=v_completed+1;
  end loop;
  return jsonb_build_object('completed',v_completed);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception 'Marketplace metering completion contains invalid typed evidence';
end;
$$;

create or replace function public.fail_marketplace_metering_batch(
  p_claim_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_http_status integer default null,
  p_response jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if p_claim_token is null or btrim(coalesce(p_error_code,''))=''
    or length(p_error_code)>100 or p_error_code !~ '^[a-z0-9_:-]+$'
    or (p_response is not null and octet_length(p_response::text)>131072) then
    raise exception 'Marketplace metering failure evidence is invalid';
  end if;
  update public.marketplace_hourly_metering_events set
    status=case when coalesce(p_retryable,false) then 'retry' else 'rejected' end,
    claim_token=null,claimed_at=null,last_error_code=p_error_code,
    last_http_status=p_http_status,microsoft_response=p_response,
    next_attempt_at=case when coalesce(p_retryable,false)
      then now()+make_interval(mins=>least(60,power(2,least(attempt_count,6))::integer))
      else next_attempt_at end,
    updated_at=now()
  where claim_token=p_claim_token and status='claimed';
  get diagnostics v_count=row_count;
  return jsonb_build_object('released',v_count,'retryable',coalesce(p_retryable,false));
end;
$$;

create or replace function public.configure_marketplace_metering_dispatch(
  p_function_url text,
  p_service_key text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_function_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/marketplace-metering$'
    or length(coalesce(p_service_key,''))<32 then
    raise exception 'Marketplace metering dispatcher configuration is invalid';
  end if;
  insert into private.marketplace_metering_dispatch_config (id,function_url,service_key,configured_at)
  values (true,p_function_url,p_service_key,now())
  on conflict (id) do update set function_url=excluded.function_url,
    service_key=excluded.service_key,configured_at=excluded.configured_at;
end;
$$;

create or replace function public.dispatch_marketplace_metering()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cfg private.marketplace_metering_dispatch_config%rowtype; v_request bigint;
begin
  select * into v_cfg from private.marketplace_metering_dispatch_config where id=true;
  if not found then
    raise warning 'dispatch_marketplace_metering: dispatcher is not configured';
    return null;
  end if;
  select net.http_post(
    url:=v_cfg.function_url,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_cfg.service_key),
    body:='{}'::jsonb,
    timeout_milliseconds:=30000
  ) into v_request;
  return v_request;
end;
$$;

revoke all on function public.configure_marketplace_meter_dimension(text,text,numeric,numeric,integer,boolean) from public,anon,authenticated;
revoke all on function public.prepare_marketplace_metering(timestamptz) from public,anon,authenticated;
revoke all on function public.claim_marketplace_metering_batch(integer,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_marketplace_metering_batch(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.fail_marketplace_metering_batch(uuid,text,boolean,integer,jsonb) from public,anon,authenticated;
revoke all on function public.configure_marketplace_metering_dispatch(text,text) from public,anon,authenticated;
revoke all on function public.dispatch_marketplace_metering() from public,anon,authenticated;
grant execute on function public.configure_marketplace_meter_dimension(text,text,numeric,numeric,integer,boolean) to service_role;
grant execute on function public.prepare_marketplace_metering(timestamptz) to service_role;
grant execute on function public.claim_marketplace_metering_batch(integer,timestamptz) to service_role;
grant execute on function public.complete_marketplace_metering_batch(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_marketplace_metering_batch(uuid,text,boolean,integer,jsonb) to service_role;
grant execute on function public.configure_marketplace_metering_dispatch(text,text) to service_role;
grant execute on function public.dispatch_marketplace_metering() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='syncai-marketplace-metering-hourly';
    perform cron.schedule(
      'syncai-marketplace-metering-hourly','5 * * * *',
      'select public.dispatch_marketplace_metering()'
    );
  end if;
end
$$;

comment on table public.marketplace_hourly_metering_events is
  'Immutable-identity hourly Azure Marketplace emission evidence derived from settled canonical usage. No raw prompts, bearer tokens or purchase tokens are stored.';
