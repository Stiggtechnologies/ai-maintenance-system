-- Keep Marketplace metering's injected processing clock internally consistent.
--
-- prepare_marketplace_metering accepts p_now so retries, recovery and the
-- certification harness can operate against one deterministic clock. The A6
-- implementation used p_now for its source window but allowed new rows to use
-- the database wall clock for next_attempt_at/created_at/updated_at. A row
-- prepared with an injected clock could therefore be ineligible for the claim
-- made with that same clock. This forward migration preserves deployed history
-- while making the preparation contract atomic and deterministic.

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
        prior_unreportable_quantity,prior_allocated_quantity,quantity,request_fingerprint,
        next_attempt_at,created_at,updated_at
      ) values (
        v.organization_id,v.billing_subscription_id,v.marketplace_subscription_id,
        v.marketplace_plan_id,v.dimension,v.source_metric,v.term_start,v_hour,
        least(v_hour+interval '1 hour',coalesce(v.term_end,'infinity'::timestamptz)),
        v_source_count,v_source_max,v_source_tokens,v.included_quantity,
        v_unreportable,v_allocated,v_due,encode(extensions.digest(jsonb_build_object(
          'resourceId',v.marketplace_subscription_id,'dimension',v.dimension,
          'quantity',v_due,'effectiveStartTime',v_hour,'planId',v.marketplace_plan_id
        )::text,'sha256'),'hex'),
        p_now,p_now,p_now
      ) on conflict (marketplace_subscription_id,dimension,usage_hour) do nothing;
      if found then v_inserted := v_inserted+1; end if;
    end loop;
  end loop;
  return jsonb_build_object('prepared',v_inserted,'throughHour',v_last_hour);
end;
$$;

revoke all on function public.prepare_marketplace_metering(timestamptz) from public,anon,authenticated;
grant execute on function public.prepare_marketplace_metering(timestamptz) to service_role;

comment on function public.prepare_marketplace_metering(timestamptz) is
  'Prepares canonical hourly Marketplace usage using one injected processing clock for source windows, retry eligibility and record provenance.';

notify pgrst, 'reload schema';
