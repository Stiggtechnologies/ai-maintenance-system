-- AI commercial cost controls extend the canonical usage, quota, billing,
-- and Marketplace metering contracts. No commercial values are seeded.
-- Engineering daily quotas remain abuse ceilings. An approved commercial
-- policy adds a separate period allowance and absolute ceiling. Policy
-- approval fails unless the worst-priced allowed model passes the explicitly
-- supplied inference gross-margin threshold.

-- ---------------------------------------------------------------------------
-- 1. Extend the ONE usage ledger and ONE tenant quota row.
-- ---------------------------------------------------------------------------

alter table private.llm_usage
  add column if not exists cost_object_type text,
  add column if not exists cost_object_id text,
  add column if not exists billing_subscription_id uuid
    references public.billing_subscriptions(id) on delete set null,
  add column if not exists input_cad_per_mtok numeric,
  add column if not exists output_cad_per_mtok numeric,
  add column if not exists price_effective_date date,
  add column if not exists inference_cost_cad numeric,
  add column if not exists cost_status text not null default 'unsettled';

do $controls$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='llm_usage_cost_object_pair'
      and conrelid='private.llm_usage'::regclass
  ) then
    alter table private.llm_usage add constraint llm_usage_cost_object_pair
      check (
        (cost_object_type is null and cost_object_id is null)
        or (btrim(cost_object_type)<>'' and length(cost_object_type)<=80
          and btrim(cost_object_id)<>'' and length(cost_object_id)<=200)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='llm_usage_cost_nonnegative'
      and conrelid='private.llm_usage'::regclass
  ) then
    alter table private.llm_usage add constraint llm_usage_cost_nonnegative
      check (
        (input_cad_per_mtok is null or input_cad_per_mtok>=0)
        and (output_cad_per_mtok is null or output_cad_per_mtok>=0)
        and (inference_cost_cad is null or inference_cost_cad>=0)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='llm_usage_cost_status_values'
      and conrelid='private.llm_usage'::regclass
  ) then
    alter table private.llm_usage add constraint llm_usage_cost_status_values
      check (cost_status in ('unsettled','priced','unknown_price'));
  end if;
end
$controls$;

create index if not exists idx_llm_usage_org_cost_object_created
  on private.llm_usage
    (organization_id,cost_object_type,cost_object_id,created_at)
  where not reserved and cost_object_type is not null;

alter table private.llm_org_quotas
  add column if not exists billing_subscription_id uuid
    references public.billing_subscriptions(id) on delete set null,
  add column if not exists commercial_billing_source text,
  add column if not exists commercial_offer_id text,
  add column if not exists commercial_plan_id text,
  add column if not exists commercial_period_start timestamptz,
  add column if not exists commercial_period_end timestamptz,
  add column if not exists included_calls_per_period integer,
  add column if not exists included_tokens_per_period bigint,
  add column if not exists max_calls_per_period integer,
  add column if not exists max_tokens_per_period bigint,
  add column if not exists max_decisions_per_period integer,
  add column if not exists commercial_allowance_mode text;

do $controls$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='llm_org_quotas_commercial_complete'
      and conrelid='private.llm_org_quotas'::regclass
  ) then
    alter table private.llm_org_quotas
      add constraint llm_org_quotas_commercial_complete check (
        billing_subscription_id is null or (
          btrim(coalesce(commercial_billing_source,''))<>''
          and commercial_offer_id is not null
          and btrim(coalesce(commercial_plan_id,''))<>''
          and commercial_period_start is not null
          and commercial_period_end>commercial_period_start
          and included_calls_per_period>0
          and included_tokens_per_period>0
          and max_calls_per_period>=included_calls_per_period
          and max_tokens_per_period>=included_tokens_per_period
          and max_decisions_per_period>0
          and commercial_allowance_mode in ('hard_stop','metered_overage')
        )
      );
  end if;
end
$controls$;

-- ---------------------------------------------------------------------------
-- 2. Approved policy. No seed row: every price, allowance and threshold is an
--    explicit commercial-owner decision.
-- ---------------------------------------------------------------------------

create table if not exists private.ai_commercial_plan_policies (
  billing_source text not null,
  offer_id text not null default '',
  plan_id text not null,
  pricing_model text not null,
  allowance_mode text not null,
  included_calls_per_period integer not null,
  included_tokens_per_period bigint not null,
  max_calls_per_period integer not null,
  max_tokens_per_period bigint not null,
  max_decisions_per_period integer not null,
  minimum_period_revenue_cad numeric not null,
  non_inference_variable_cost_cad numeric not null,
  minimum_gross_margin_ratio numeric not null,
  allowed_models text[] not null,
  meter_dimension text,
  meter_unit_tokens numeric,
  overage_revenue_cad_per_unit numeric,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (billing_source,offer_id,plan_id),
  check (btrim(billing_source)<>'' and btrim(plan_id)<>''),
  check (pricing_model in ('per_user','flat_rate')),
  check (allowance_mode in ('hard_stop','metered_overage')),
  check (included_calls_per_period>0 and included_tokens_per_period>0),
  check (max_calls_per_period>=included_calls_per_period),
  check (max_tokens_per_period>=included_tokens_per_period),
  check (max_decisions_per_period>0),
  check (minimum_period_revenue_cad>0),
  check (non_inference_variable_cost_cad>=0),
  check (minimum_gross_margin_ratio>=0 and minimum_gross_margin_ratio<1),
  check (cardinality(allowed_models)>0),
  check (status in ('draft','approved','retired')),
  check (
    (status='approved' and approved_by is not null and approved_at is not null)
    or (status<>'approved' and approved_by is null and approved_at is null)
  ),
  check (
    (allowance_mode='hard_stop'
      and max_calls_per_period=included_calls_per_period
      and max_tokens_per_period=included_tokens_per_period
      and meter_dimension is null and meter_unit_tokens is null
      and overage_revenue_cad_per_unit is null)
    or
    (allowance_mode='metered_overage' and pricing_model='flat_rate'
      and btrim(coalesce(meter_dimension,''))<>''
      and coalesce(meter_unit_tokens,0)>0
      and coalesce(overage_revenue_cad_per_unit,0)>0)
  ),
  check (pricing_model<>'per_user' or allowance_mode='hard_stop')
);

alter table private.ai_commercial_plan_policies enable row level security;
revoke all on table private.ai_commercial_plan_policies
  from public,anon,authenticated,service_role;

comment on table private.ai_commercial_plan_policies is
  'Owner-approved commercial AI allowance and conservative inference-margin '
  'boundary. No row is seeded; configure then explicitly approve.';

-- ---------------------------------------------------------------------------
-- 3. Conservative policy evaluation and draft configuration.
-- ---------------------------------------------------------------------------

create or replace function public.evaluate_ai_commercial_plan_policy(
  p_billing_source text,p_offer_id text,p_plan_id text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_requested_models integer;
  v_priced_models integer;
  v_max_token_rate numeric;
  v_included_inference_cost numeric;
  v_base_cost numeric;
  v_base_margin numeric;
  v_overage_unit_cost numeric;
  v_overage_margin numeric;
  v_allowed boolean;
begin
  select * into v_policy from private.ai_commercial_plan_policies
  where billing_source=btrim(p_billing_source)
    and offer_id=btrim(coalesce(p_offer_id,''))
    and plan_id=btrim(p_plan_id);
  if not found then
    return jsonb_build_object('allowed',false,'reason','policy_not_found');
  end if;

  select count(*),count(pr.model),
    max(greatest(pr.input_cad_per_mtok,pr.output_cad_per_mtok))
  into v_requested_models,v_priced_models,v_max_token_rate
  from unnest(v_policy.allowed_models) model_name
  left join private.llm_prices pr on pr.model=model_name
    and pr.input_cad_per_mtok is not null
    and pr.output_cad_per_mtok is not null;
  if v_requested_models=0 or v_priced_models<>v_requested_models
    or v_max_token_rate is null then
    return jsonb_build_object(
      'allowed',false,'reason','allowed_model_price_missing',
      'requestedModels',v_requested_models,'pricedModels',v_priced_models
    );
  end if;

  v_included_inference_cost :=
    v_policy.included_tokens_per_period::numeric*v_max_token_rate/1000000;
  v_base_cost := v_included_inference_cost
    + v_policy.non_inference_variable_cost_cad;
  v_base_margin := (v_policy.minimum_period_revenue_cad-v_base_cost)
    /v_policy.minimum_period_revenue_cad;
  if v_policy.allowance_mode='metered_overage' then
    v_overage_unit_cost :=
      v_policy.meter_unit_tokens*v_max_token_rate/1000000;
    v_overage_margin :=
      (v_policy.overage_revenue_cad_per_unit-v_overage_unit_cost)
      /v_policy.overage_revenue_cad_per_unit;
  end if;
  v_allowed := v_base_margin>=v_policy.minimum_gross_margin_ratio and (
    v_policy.allowance_mode='hard_stop'
    or v_overage_margin>=v_policy.minimum_gross_margin_ratio
  );
  return jsonb_build_object(
    'allowed',v_allowed,
    'reason',case when v_allowed then 'margin_gate_passed'
      when v_base_margin<v_policy.minimum_gross_margin_ratio
        then 'base_margin_below_threshold'
      else 'overage_margin_below_threshold' end,
    'worstAllowedModelCadPerMillionTokens',v_max_token_rate,
    'includedInferenceCostCad',v_included_inference_cost,
    'nonInferenceVariableCostCad',v_policy.non_inference_variable_cost_cad,
    'baseGrossMarginRatio',v_base_margin,
    'overageUnitCostCad',v_overage_unit_cost,
    'overageGrossMarginRatio',v_overage_margin,
    'minimumGrossMarginRatio',v_policy.minimum_gross_margin_ratio
  );
end
$$;

revoke all on function public.evaluate_ai_commercial_plan_policy(text,text,text)
  from public,anon,authenticated;
grant execute on function public.evaluate_ai_commercial_plan_policy(text,text,text)
  to service_role;

create or replace function public.configure_ai_commercial_plan_policy(
  p_billing_source text,p_offer_id text,p_plan_id text,p_pricing_model text,
  p_allowance_mode text,p_included_calls_per_period integer,
  p_included_tokens_per_period bigint,p_max_calls_per_period integer,
  p_max_tokens_per_period bigint,p_max_decisions_per_period integer,
  p_minimum_period_revenue_cad numeric,
  p_non_inference_variable_cost_cad numeric,
  p_minimum_gross_margin_ratio numeric,p_allowed_models text[],
  p_meter_dimension text default null,p_meter_unit_tokens numeric default null,
  p_overage_revenue_cad_per_unit numeric default null,p_note text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_models text[];
  v_evaluation jsonb;
begin
  if btrim(coalesce(p_billing_source,''))=''
    or btrim(coalesce(p_plan_id,''))='' then
    raise exception 'Billing source and plan are required';
  end if;
  if p_pricing_model not in ('per_user','flat_rate')
    or p_allowance_mode not in ('hard_stop','metered_overage') then
    raise exception 'Pricing model or allowance mode is invalid';
  end if;
  if p_pricing_model='per_user' and p_allowance_mode<>'hard_stop' then
    raise exception 'Per-user plans cannot use metered overage';
  end if;
  if p_included_calls_per_period<=0 or p_included_tokens_per_period<=0
    or p_max_calls_per_period<p_included_calls_per_period
    or p_max_tokens_per_period<p_included_tokens_per_period
    or p_max_decisions_per_period<=0 or p_minimum_period_revenue_cad<=0
    or p_non_inference_variable_cost_cad<0
    or p_minimum_gross_margin_ratio<0
    or p_minimum_gross_margin_ratio>=1 then
    raise exception 'Commercial allowance or margin inputs are invalid';
  end if;
  if p_allowance_mode='hard_stop' and (
    p_max_calls_per_period<>p_included_calls_per_period
    or p_max_tokens_per_period<>p_included_tokens_per_period
  ) then
    raise exception 'Hard-stop plans cannot contain unpriced overage capacity';
  end if;
  if p_allowance_mode='metered_overage' and (
    p_pricing_model<>'flat_rate'
    or btrim(coalesce(p_meter_dimension,''))=''
    or coalesce(p_meter_unit_tokens,0)<=0
    or coalesce(p_overage_revenue_cad_per_unit,0)<=0
  ) then
    raise exception 'Metered plans require a priced flat-rate meter dimension';
  end if;

  select array_agg(distinct btrim(model_name) order by btrim(model_name))
  into v_models
  from unnest(coalesce(p_allowed_models,array[]::text[])) model_name
  where btrim(model_name)<>'';
  if coalesce(cardinality(v_models),0)=0 then
    raise exception 'At least one allowed model is required';
  end if;
  if exists (
    select 1 from unnest(v_models) model_name
    left join private.llm_prices p on p.model=model_name
    where p.model is null or p.input_cad_per_mtok is null
      or p.output_cad_per_mtok is null
  ) then
    raise exception 'Every allowed model requires a known canonical price';
  end if;

  insert into private.ai_commercial_plan_policies (
    billing_source,offer_id,plan_id,pricing_model,allowance_mode,
    included_calls_per_period,included_tokens_per_period,
    max_calls_per_period,max_tokens_per_period,max_decisions_per_period,
    minimum_period_revenue_cad,non_inference_variable_cost_cad,
    minimum_gross_margin_ratio,allowed_models,meter_dimension,
    meter_unit_tokens,overage_revenue_cad_per_unit,status,
    approved_by,approved_at,note,updated_at
  ) values (
    btrim(p_billing_source),btrim(coalesce(p_offer_id,'')),btrim(p_plan_id),
    p_pricing_model,p_allowance_mode,p_included_calls_per_period,
    p_included_tokens_per_period,p_max_calls_per_period,p_max_tokens_per_period,
    p_max_decisions_per_period,p_minimum_period_revenue_cad,
    p_non_inference_variable_cost_cad,p_minimum_gross_margin_ratio,v_models,
    case when p_allowance_mode='metered_overage'
      then btrim(p_meter_dimension) else null end,
    case when p_allowance_mode='metered_overage'
      then p_meter_unit_tokens else null end,
    case when p_allowance_mode='metered_overage'
      then p_overage_revenue_cad_per_unit else null end,
    'draft',null,null,nullif(btrim(coalesce(p_note,'')),''),now()
  ) on conflict (billing_source,offer_id,plan_id) do update set
    pricing_model=excluded.pricing_model,allowance_mode=excluded.allowance_mode,
    included_calls_per_period=excluded.included_calls_per_period,
    included_tokens_per_period=excluded.included_tokens_per_period,
    max_calls_per_period=excluded.max_calls_per_period,
    max_tokens_per_period=excluded.max_tokens_per_period,
    max_decisions_per_period=excluded.max_decisions_per_period,
    minimum_period_revenue_cad=excluded.minimum_period_revenue_cad,
    non_inference_variable_cost_cad=excluded.non_inference_variable_cost_cad,
    minimum_gross_margin_ratio=excluded.minimum_gross_margin_ratio,
    allowed_models=excluded.allowed_models,
    meter_dimension=excluded.meter_dimension,
    meter_unit_tokens=excluded.meter_unit_tokens,
    overage_revenue_cad_per_unit=excluded.overage_revenue_cad_per_unit,
    status='draft',approved_by=null,approved_at=null,note=excluded.note,
    updated_at=now();

  v_evaluation := public.evaluate_ai_commercial_plan_policy(
    btrim(p_billing_source),btrim(coalesce(p_offer_id,'')),btrim(p_plan_id)
  );
  return jsonb_build_object('status','draft','evaluation',v_evaluation);
end
$$;

revoke all on function public.configure_ai_commercial_plan_policy(
  text,text,text,text,text,integer,bigint,integer,bigint,integer,numeric,
  numeric,numeric,text[],text,numeric,numeric,text
) from public,anon,authenticated;
grant execute on function public.configure_ai_commercial_plan_policy(
  text,text,text,text,text,integer,bigint,integer,bigint,integer,numeric,
  numeric,numeric,text[],text,numeric,numeric,text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Canonical billing-subscription -> canonical organization-quota binding.
-- ---------------------------------------------------------------------------

create or replace function public.apply_ai_commercial_plan_allowance(
  p_billing_subscription_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_subscription public.billing_subscriptions%rowtype;
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_meter private.marketplace_meter_definitions%rowtype;
begin
  select * into v_subscription from public.billing_subscriptions
  where id=p_billing_subscription_id for update;
  if not found then raise exception 'Billing subscription not found'; end if;

  if v_subscription.status<>'active' or (
    v_subscription.billing_source='azure_marketplace'
    and v_subscription.marketplace_status<>'Subscribed'
  ) then
    update private.llm_org_quotas set
      billing_subscription_id=null,commercial_billing_source=null,
      commercial_offer_id=null,commercial_plan_id=null,
      commercial_period_start=null,commercial_period_end=null,
      included_calls_per_period=null,included_tokens_per_period=null,
      max_calls_per_period=null,max_tokens_per_period=null,
      max_decisions_per_period=null,commercial_allowance_mode=null,
      updated_at=now()
    where organization_id=v_subscription.organization_id
      and billing_subscription_id=v_subscription.id;
    return jsonb_build_object('bound',false,'reason','subscription_inactive');
  end if;

  select * into v_policy from private.ai_commercial_plan_policies
  where billing_source=v_subscription.billing_source
    and offer_id=case when v_subscription.billing_source='azure_marketplace'
      then coalesce(v_subscription.marketplace_offer_id,'') else '' end
    and plan_id=case when v_subscription.billing_source='azure_marketplace'
      then coalesce(v_subscription.marketplace_plan_id,v_subscription.plan)
      else v_subscription.plan end
    and status='approved';
  if not found then
    raise exception 'Approved AI commercial policy is absent for active plan';
  end if;

  if v_subscription.current_period_start is null
    or v_subscription.current_period_end is null
    or v_subscription.current_period_end<=v_subscription.current_period_start then
    raise exception 'Billing period is invalid';
  end if;

  if v_policy.allowance_mode='metered_overage' then
    select * into v_meter from private.marketplace_meter_definitions
    where plan_id=v_policy.plan_id and dimension=v_policy.meter_dimension
      and active;
    if not found or v_meter.unit_size<>v_policy.meter_unit_tokens
      or v_meter.included_quantity*v_meter.unit_size
        <>v_policy.included_tokens_per_period then
      raise exception 'Marketplace meter does not match approved AI policy';
    end if;
  end if;

  insert into private.llm_org_quotas (
    organization_id,billing_subscription_id,commercial_billing_source,
    commercial_offer_id,commercial_plan_id,commercial_period_start,
    commercial_period_end,included_calls_per_period,
    included_tokens_per_period,max_calls_per_period,max_tokens_per_period,
    max_decisions_per_period,commercial_allowance_mode,note,updated_at
  ) values (
    v_subscription.organization_id,v_subscription.id,v_policy.billing_source,
    v_policy.offer_id,v_policy.plan_id,v_subscription.current_period_start,
    v_subscription.current_period_end,v_policy.included_calls_per_period,
    v_policy.included_tokens_per_period,v_policy.max_calls_per_period,
    v_policy.max_tokens_per_period,v_policy.max_decisions_per_period,
    v_policy.allowance_mode,'Bound from approved commercial plan policy',now()
  ) on conflict (organization_id) do update set
    billing_subscription_id=excluded.billing_subscription_id,
    commercial_billing_source=excluded.commercial_billing_source,
    commercial_offer_id=excluded.commercial_offer_id,
    commercial_plan_id=excluded.commercial_plan_id,
    commercial_period_start=excluded.commercial_period_start,
    commercial_period_end=excluded.commercial_period_end,
    included_calls_per_period=excluded.included_calls_per_period,
    included_tokens_per_period=excluded.included_tokens_per_period,
    max_calls_per_period=excluded.max_calls_per_period,
    max_tokens_per_period=excluded.max_tokens_per_period,
    max_decisions_per_period=excluded.max_decisions_per_period,
    commercial_allowance_mode=excluded.commercial_allowance_mode,
    note=excluded.note,updated_at=now();

  return jsonb_build_object(
    'bound',true,'organizationId',v_subscription.organization_id,
    'billingSubscriptionId',v_subscription.id,'planId',v_policy.plan_id,
    'allowanceMode',v_policy.allowance_mode
  );
end
$$;

revoke all on function public.apply_ai_commercial_plan_allowance(uuid)
  from public,anon,authenticated;
grant execute on function public.apply_ai_commercial_plan_allowance(uuid)
  to service_role;

create or replace function public.approve_ai_commercial_plan_policy(
  p_billing_source text,p_offer_id text,p_plan_id text,p_approved_by uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_evaluation jsonb;
  v_subscription record;
begin
  if not exists (
    select 1 from public.user_profiles
    where id=p_approved_by and role in ('admin','ai_admin')
  ) then
    raise exception 'A named administrative commercial owner is required';
  end if;

  select * into v_policy from private.ai_commercial_plan_policies
  where billing_source=btrim(p_billing_source)
    and offer_id=btrim(coalesce(p_offer_id,''))
    and plan_id=btrim(p_plan_id) for update;
  if not found then raise exception 'AI commercial plan policy not found'; end if;

  v_evaluation := public.evaluate_ai_commercial_plan_policy(
    v_policy.billing_source,v_policy.offer_id,v_policy.plan_id
  );
  if coalesce((v_evaluation->>'allowed')::boolean,false) is not true then
    raise exception 'AI gross-margin gate failed: %',v_evaluation->>'reason';
  end if;
  if v_policy.allowance_mode='metered_overage' and not exists (
    select 1 from private.marketplace_meter_definitions d
    where d.plan_id=v_policy.plan_id and d.dimension=v_policy.meter_dimension
      and d.active and d.unit_size=v_policy.meter_unit_tokens
      and d.included_quantity*d.unit_size=v_policy.included_tokens_per_period
  ) then
    raise exception 'Approved Marketplace meter must match the policy';
  end if;

  update private.ai_commercial_plan_policies set
    status='approved',approved_by=p_approved_by,approved_at=now(),updated_at=now()
  where billing_source=v_policy.billing_source
    and offer_id=v_policy.offer_id and plan_id=v_policy.plan_id;

  for v_subscription in
    select id from public.billing_subscriptions
    where status='active' and billing_source=v_policy.billing_source and (
      (billing_source='azure_marketplace'
        and coalesce(marketplace_offer_id,'')=v_policy.offer_id
        and coalesce(marketplace_plan_id,plan)=v_policy.plan_id
        and marketplace_status='Subscribed')
      or (billing_source<>'azure_marketplace'
        and v_policy.offer_id='' and plan=v_policy.plan_id)
    )
  loop
    perform public.apply_ai_commercial_plan_allowance(v_subscription.id);
  end loop;
  return jsonb_build_object(
    'approved',true,'approvedBy',p_approved_by,'evaluation',v_evaluation
  );
end
$$;

revoke all on function public.approve_ai_commercial_plan_policy(text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.approve_ai_commercial_plan_policy(text,text,text,uuid)
  to service_role;

-- Activation is fail-closed. The trigger does not approve a price; it refuses
-- to activate a Microsoft subscription whose approved boundary is absent.
create or replace function public.enforce_ai_commercial_plan_before_sale()
returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if new.billing_source='azure_marketplace'
    and new.status='active' and new.marketplace_status='Subscribed'
    and not exists (
      select 1 from private.ai_commercial_plan_policies p
      where p.billing_source='azure_marketplace'
        and p.offer_id=coalesce(new.marketplace_offer_id,'')
        and p.plan_id=coalesce(new.marketplace_plan_id,new.plan)
        and p.status='approved'
    ) then
    raise exception 'Marketplace activation blocked: approved AI commercial policy is absent';
  end if;
  return new;
end
$$;

create or replace function public.sync_ai_commercial_plan_after_subscription()
returns trigger
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if new.billing_source='azure_marketplace' then
    perform public.apply_ai_commercial_plan_allowance(new.id);
  end if;
  return new;
end
$$;

drop trigger if exists billing_subscription_ai_commercial_gate
  on public.billing_subscriptions;
create trigger billing_subscription_ai_commercial_gate
before insert or update of status,billing_source,marketplace_status,
  marketplace_offer_id,marketplace_plan_id,plan,current_period_start,
  current_period_end
on public.billing_subscriptions
for each row execute function public.enforce_ai_commercial_plan_before_sale();

drop trigger if exists billing_subscription_ai_allowance_sync
  on public.billing_subscriptions;
create trigger billing_subscription_ai_allowance_sync
after insert or update of status,billing_source,marketplace_status,
  marketplace_offer_id,marketplace_plan_id,plan,current_period_start,
  current_period_end
on public.billing_subscriptions
for each row execute function public.sync_ai_commercial_plan_after_subscription();

revoke all on function public.enforce_ai_commercial_plan_before_sale()
  from public,anon,authenticated,service_role;
revoke all on function public.sync_ai_commercial_plan_after_subscription()
  from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 5. Extend the atomic quota check with the commercial-period hard ceiling.
-- ---------------------------------------------------------------------------

create or replace function public.check_llm_quota(
  p_organization_id uuid,p_fn text default 'unknown',
  p_model text default 'pending',p_estimated_tokens bigint default 0
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  c_default_max_calls constant integer := 5184;
  c_default_max_tokens constant bigint := 22000000;
  v_quota private.llm_org_quotas%rowtype;
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_max_calls integer;
  v_max_tokens bigint;
  v_calls bigint;
  v_tokens bigint;
  v_period_calls bigint;
  v_period_tokens bigint;
  v_estimate integer;
  v_day_start timestamptz;
  v_resets_at timestamptz;
  v_reservation_id bigint;
begin
  if p_organization_id is null then
    return jsonb_build_object('allowed',false,'limit','organization_required');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('llm_quota:'||p_organization_id::text,0)
  );
  select * into v_quota from private.llm_org_quotas
  where organization_id=p_organization_id;
  v_max_calls := coalesce(v_quota.max_calls_per_day,c_default_max_calls);
  v_max_tokens := coalesce(v_quota.max_tokens_per_day,c_default_max_tokens);
  v_estimate := least(greatest(coalesce(p_estimated_tokens,0),0),2000000000)::integer;
  v_day_start := date_trunc('day',now() at time zone 'utc') at time zone 'utc';
  v_resets_at := v_day_start+interval '1 day';

  if v_quota.billing_subscription_id is null and exists (
    select 1 from public.billing_subscriptions s
    where s.organization_id=p_organization_id
      and s.billing_source='azure_marketplace' and s.status='active'
      and s.marketplace_status='Subscribed'
  ) then
    return jsonb_build_object(
      'allowed',false,'limit','commercial_allowance_unconfigured'
    );
  end if;

  if v_quota.billing_subscription_id is not null then
    select * into v_policy from private.ai_commercial_plan_policies
    where billing_source=v_quota.commercial_billing_source
      and offer_id=v_quota.commercial_offer_id
      and plan_id=v_quota.commercial_plan_id and status='approved';
    if not found or not (p_model=any(v_policy.allowed_models)) then
      return jsonb_build_object(
        'allowed',false,'limit','model_not_approved_for_plan'
      );
    end if;
  end if;

  if v_quota.billing_subscription_id is not null then
    if now()<v_quota.commercial_period_start
      or now()>=v_quota.commercial_period_end then
      return jsonb_build_object(
        'allowed',false,'limit','commercial_period_inactive',
        'resets_at',v_quota.commercial_period_end
      );
    end if;
    select count(*),coalesce(sum(prompt_tokens+completion_tokens),0)
    into v_period_calls,v_period_tokens from private.llm_usage
    where organization_id=p_organization_id
      and created_at>=v_quota.commercial_period_start
      and created_at<v_quota.commercial_period_end;
    if v_period_calls>=v_quota.max_calls_per_period then
      return jsonb_build_object(
        'allowed',false,'limit','max_calls_per_commercial_period',
        'calls_used',v_period_calls,'max_calls',v_quota.max_calls_per_period,
        'resets_at',v_quota.commercial_period_end
      );
    end if;
    if v_period_tokens>=v_quota.max_tokens_per_period
      or v_period_tokens+v_estimate>v_quota.max_tokens_per_period then
      return jsonb_build_object(
        'allowed',false,'limit','max_tokens_per_commercial_period',
        'tokens_used',v_period_tokens,'max_tokens',v_quota.max_tokens_per_period,
        'resets_at',v_quota.commercial_period_end
      );
    end if;
  end if;

  select count(*),coalesce(sum(prompt_tokens+completion_tokens),0)
  into v_calls,v_tokens from private.llm_usage
  where organization_id=p_organization_id and created_at>=v_day_start;
  if v_calls>=v_max_calls then
    return jsonb_build_object(
      'allowed',false,'limit','max_calls_per_day','calls_used',v_calls,
      'max_calls',v_max_calls,'tokens_used',v_tokens,
      'max_tokens',v_max_tokens,'resets_at',v_resets_at
    );
  end if;
  if v_tokens>=v_max_tokens or v_tokens+v_estimate>v_max_tokens then
    return jsonb_build_object(
      'allowed',false,'limit','max_tokens_per_day','calls_used',v_calls,
      'max_calls',v_max_calls,'tokens_used',v_tokens,
      'max_tokens',v_max_tokens,'resets_at',v_resets_at
    );
  end if;

  insert into private.llm_usage (
    organization_id,fn,model,prompt_tokens,completion_tokens,reserved,
    billing_subscription_id
  ) values (
    p_organization_id,coalesce(nullif(btrim(p_fn),''),'unknown'),
    coalesce(nullif(btrim(p_model),''),'pending'),0,v_estimate,true,
    v_quota.billing_subscription_id
  ) returning id into v_reservation_id;
  return jsonb_build_object(
    'allowed',true,'reservation_id',v_reservation_id,'calls_used',v_calls,
    'max_calls',v_max_calls,'tokens_used',v_tokens,'max_tokens',v_max_tokens,
    'commercialPlanId',v_quota.commercial_plan_id,
    'commercialAllowanceMode',v_quota.commercial_allowance_mode,
    'resets_at',case when v_quota.billing_subscription_id is not null
      then least(v_resets_at,v_quota.commercial_period_end) else v_resets_at end
  );
end
$$;

revoke all on function public.check_llm_quota(uuid,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.check_llm_quota(uuid,text,text,bigint)
  to service_role;

comment on function public.check_llm_quota(uuid,text,text,bigint) is
  'Canonical atomic reservation gate. Enforces the engineering UTC-day abuse '
  'ceiling and, when an approved billing subscription is bound, the separate '
  'commercial-period calls and token ceiling. Use check_llm_commercial_quota '
  'for paid runtime calls so the governed cost object and allowed model are '
  'also enforced.';

create or replace function public.check_llm_commercial_quota(
  p_organization_id uuid,p_fn text,p_model text,p_estimated_tokens bigint,
  p_cost_object_type text default null,p_cost_object_id text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_result jsonb;
  v_reservation_id bigint;
  v_quota private.llm_org_quotas%rowtype;
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_decisions bigint;
  v_type text := nullif(btrim(coalesce(p_cost_object_type,'')),'');
  v_id text := nullif(btrim(coalesce(p_cost_object_id,'')),'');
begin
  if (v_type is null)<>(v_id is null)
    or length(coalesce(v_type,''))>80 or length(coalesce(v_id,''))>200 then
    return jsonb_build_object('allowed',false,'limit','cost_object_invalid');
  end if;
  v_result := public.check_llm_quota(
    p_organization_id,p_fn,p_model,p_estimated_tokens
  );
  if coalesce((v_result->>'allowed')::boolean,false) is not true then
    return v_result;
  end if;
  v_reservation_id := (v_result->>'reservation_id')::bigint;
  select * into v_quota from private.llm_org_quotas
  where organization_id=p_organization_id;

  if v_quota.billing_subscription_id is not null then
    -- WebRTC negotiation does not receive the provider's terminal usage yet.
    -- Do not sell that unmeterable path merely because its model has a price.
    if p_fn='sync-realtime-session' then
      delete from private.llm_usage
      where id=v_reservation_id and reserved;
      return jsonb_build_object(
        'allowed',false,'limit','realtime_usage_settlement_unavailable'
      );
    end if;
    select * into v_policy from private.ai_commercial_plan_policies
    where billing_source=v_quota.commercial_billing_source
      and offer_id=v_quota.commercial_offer_id
      and plan_id=v_quota.commercial_plan_id and status='approved';
    if not found or not (p_model=any(v_policy.allowed_models)) then
      delete from private.llm_usage
      where id=v_reservation_id and reserved;
      return jsonb_build_object(
        'allowed',false,'limit','model_not_approved_for_plan'
      );
    end if;
  end if;

  update private.llm_usage set cost_object_type=v_type,cost_object_id=v_id
  where id=v_reservation_id and organization_id=p_organization_id and reserved;

  if v_quota.billing_subscription_id is not null
    and v_type in ('decision_case','development_case','decision') then
    select count(*) into v_decisions from (
      select distinct cost_object_type,cost_object_id
      from private.llm_usage
      where organization_id=p_organization_id
        and created_at>=v_quota.commercial_period_start
        and created_at<v_quota.commercial_period_end
        and cost_object_type in ('decision_case','development_case','decision')
        and cost_object_id is not null
    ) scoped_decisions;
    if v_decisions>v_quota.max_decisions_per_period then
      delete from private.llm_usage
      where id=v_reservation_id and reserved;
      return jsonb_build_object(
        'allowed',false,'limit','max_decisions_per_commercial_period',
        'decisions_used',v_decisions,
        'max_decisions',v_quota.max_decisions_per_period,
        'resets_at',v_quota.commercial_period_end
      );
    end if;
  end if;
  return v_result||jsonb_build_object(
    'costObjectType',v_type,'costObjectId',v_id
  );
end
$$;

revoke all on function public.check_llm_commercial_quota(
  uuid,text,text,bigint,text,text
) from public,anon,authenticated;
grant execute on function public.check_llm_commercial_quota(
  uuid,text,text,bigint,text,text
) to service_role;

comment on function public.check_llm_commercial_quota(
  uuid,text,text,bigint,text,text
) is 'Atomic pre-spend gate over daily abuse caps and an approved commercial '
  'period boundary. It attaches the canonical decision/case/work subject to '
  'the reservation and refuses unapproved plan models.';

-- ---------------------------------------------------------------------------
-- 6. Settlement snapshots exact model price and cost on the canonical row.
-- ---------------------------------------------------------------------------

create or replace function public.record_llm_usage(
  p_organization_id uuid,p_fn text,p_model text,p_prompt_tokens integer,
  p_completion_tokens integer,p_reservation_id bigint default null
) returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_price private.llm_prices%rowtype;
  v_prompt integer := greatest(coalesce(p_prompt_tokens,0),0);
  v_completion integer := greatest(coalesce(p_completion_tokens,0),0);
  v_cost numeric;
  v_status text;
  v_billing_subscription_id uuid;
begin
  select * into v_price from private.llm_prices
  where model=coalesce(nullif(btrim(p_model),''),'unknown')
    and input_cad_per_mtok is not null and output_cad_per_mtok is not null;
  if found then
    v_cost := (v_prompt::numeric*v_price.input_cad_per_mtok
      + v_completion::numeric*v_price.output_cad_per_mtok)/1000000;
    v_status := 'priced';
  else
    v_cost := null;
    v_status := 'unknown_price';
  end if;

  if p_reservation_id is not null then
    update private.llm_usage set
      fn=coalesce(nullif(btrim(p_fn),''),fn),
      model=coalesce(nullif(btrim(p_model),''),'unknown'),
      prompt_tokens=v_prompt,completion_tokens=v_completion,reserved=false,
      input_cad_per_mtok=v_price.input_cad_per_mtok,
      output_cad_per_mtok=v_price.output_cad_per_mtok,
      price_effective_date=v_price.effective_date,
      inference_cost_cad=v_cost,cost_status=v_status
    where id=p_reservation_id and organization_id=p_organization_id and reserved;
    if found then return; end if;
  end if;

  select billing_subscription_id into v_billing_subscription_id
  from private.llm_org_quotas where organization_id=p_organization_id;
  insert into private.llm_usage (
    organization_id,fn,model,prompt_tokens,completion_tokens,reserved,
    billing_subscription_id,input_cad_per_mtok,output_cad_per_mtok,
    price_effective_date,inference_cost_cad,cost_status
  ) values (
    p_organization_id,coalesce(nullif(btrim(p_fn),''),'unknown'),
    coalesce(nullif(btrim(p_model),''),'unknown'),v_prompt,v_completion,false,
    v_billing_subscription_id,v_price.input_cad_per_mtok,
    v_price.output_cad_per_mtok,v_price.effective_date,v_cost,v_status
  );
end
$$;

revoke all on function public.record_llm_usage(
  uuid,text,text,integer,integer,bigint
) from public,anon,authenticated;
grant execute on function public.record_llm_usage(
  uuid,text,text,integer,integer,bigint
) to service_role;

comment on function public.record_llm_usage(
  uuid,text,text,integer,integer,bigint
) is 'Settles the canonical reservation with actual tokens and an immutable '
  'snapshot of the exact model price and CAD inference cost. Unknown model '
  'price is recorded as unknown_price, never zero cost.';

-- ---------------------------------------------------------------------------
-- 7. Service-only production cost report. Unknown price is never zero cost.
-- ---------------------------------------------------------------------------

create or replace function public.get_ai_unit_economics(
  p_organization_id uuid,p_period_start timestamptz default null,
  p_period_end timestamptz default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_report jsonb;
begin
  select coalesce(p_period_start,q.commercial_period_start,now()-interval '30 days'),
    coalesce(p_period_end,q.commercial_period_end,now())
  into v_start,v_end from (select 1) one
  left join private.llm_org_quotas q on q.organization_id=p_organization_id;
  if v_start>=v_end then raise exception 'Cost report period is invalid'; end if;

  with settled as (
    select * from private.llm_usage
    where organization_id=p_organization_id and not reserved
      and created_at>=v_start and created_at<v_end
  ), decision_rollups as (
    select cost_object_type,cost_object_id,
      sum(inference_cost_cad) filter (where cost_status='priced') cost_cad,
      count(*) filter (where cost_status<>'priced') unpriced_calls
    from settled
    where cost_object_type in ('decision_case','development_case','decision')
      and cost_object_id is not null
    group by cost_object_type,cost_object_id
  ), decision_costs as (
    select cost_object_type,cost_object_id,cost_cad
    from decision_rollups where unpriced_calls=0
  ), totals as (
    select count(*) settled_calls,
      coalesce(sum(prompt_tokens+completion_tokens),0) tokens,
      coalesce(sum(inference_cost_cad) filter (where cost_status='priced'),0) known_cost,
      count(*) filter (where cost_status='unknown_price') unknown_price_calls,
      count(*) filter (where cost_status<>'priced') unpriced_calls,
      count(*) filter (where cost_object_id is null) unattributed_calls,
      count(distinct (cost_object_type,cost_object_id)) filter (
        where cost_object_type in ('decision_case','development_case','decision')
          and cost_object_id is not null
      ) attributed_decisions
    from settled
  ), distribution as (
    select count(*) priced_decision_count,avg(cost_cad) average_cost,
      percentile_cont(0.5) within group (order by cost_cad) p50_cost,
      percentile_cont(0.95) within group (order by cost_cad) p95_cost
    from decision_costs
  )
  select jsonb_build_object(
    'organizationId',p_organization_id,'periodStart',v_start,'periodEnd',v_end,
    'settledCalls',t.settled_calls,'totalTokens',t.tokens,
    'knownInferenceCostCad',t.known_cost,
    'unknownPriceCalls',t.unknown_price_calls,
    'unpricedCalls',t.unpriced_calls,
    'unattributedCalls',t.unattributed_calls,
    'attributedDecisions',t.attributed_decisions,
    'pricedAttributedDecisions',d.priced_decision_count,
    'averageCostPerDecisionCad',d.average_cost,
    'p50CostPerDecisionCad',d.p50_cost,
    'p95CostPerDecisionCad',d.p95_cost,
    'priceComplete',t.unpriced_calls=0,
    'decisionAttributionComplete',t.unattributed_calls=0,
    'complete',t.unpriced_calls=0 and t.unattributed_calls=0
  ) into v_report from totals t cross join distribution d;
  return v_report;
end
$$;

revoke all on function public.get_ai_unit_economics(
  uuid,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function public.get_ai_unit_economics(
  uuid,timestamptz,timestamptz
) to service_role;

comment on function public.get_ai_unit_economics(
  uuid,timestamptz,timestamptz
) is 'Service-only measured inference COGS with explicit unknown-price and '
  'unattributed calls plus average, p50 and p95 cost per decision.';

revoke all on private.llm_usage from public,anon,authenticated,service_role;
revoke all on private.llm_prices from public,anon,authenticated,service_role;
revoke all on private.llm_org_quotas from public,anon,authenticated,service_role;
