-- Marketplace commercial entitlements make the buyer-visible site and member
-- boundaries executable. They extend the canonical billing_subscriptions,
-- sites and user_profiles records; they do not create a second tenant, user or
-- subscription model.
--
-- Capacity belongs to the existing AI commercial policy. This avoids a second
-- plan registry, a second approval state, or the possibility that inference
-- economics and buyer-visible capacity are approved independently.
--
-- No plan row is seeded. A service operator first configures the canonical AI
-- policy, then adds site/member capacity while it is still draft, and finally
-- uses the existing named-owner approval door. Marketplace activation fails
-- closed unless one approved row contains both cost and capacity boundaries.

alter table private.ai_commercial_plan_policies
  add column if not exists max_sites integer,
  add column if not exists max_named_users integer;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.ai_commercial_plan_policies'::regclass
      and conname = 'ai_commercial_plan_policies_max_sites_ck'
  ) then
    alter table private.ai_commercial_plan_policies
      add constraint ai_commercial_plan_policies_max_sites_ck
      check (max_sites is null or max_sites > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.ai_commercial_plan_policies'::regclass
      and conname = 'ai_commercial_plan_policies_max_named_users_ck'
  ) then
    alter table private.ai_commercial_plan_policies
      add constraint ai_commercial_plan_policies_max_named_users_ck
      check (max_named_users is null or max_named_users > 0);
  end if;
end
$constraints$;

comment on column private.ai_commercial_plan_policies.max_sites is
  'Maximum sites for this approved commercial policy. Required before an Azure Marketplace policy can be approved.';
comment on column private.ai_commercial_plan_policies.max_named_users is
  'Maximum named workspace members for this approved commercial policy. Required before an Azure Marketplace policy can be approved.';

create or replace function public.configure_commercial_plan_capacity(
  p_billing_source text,
  p_offer_id text,
  p_plan_id text,
  p_max_sites integer,
  p_max_named_users integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := btrim(coalesce(p_billing_source, ''));
  v_offer text := btrim(coalesce(p_offer_id, ''));
  v_plan text := btrim(coalesce(p_plan_id, ''));
begin
  if v_source = '' or v_plan = ''
    or (v_source = 'azure_marketplace' and v_offer = '')
    or coalesce(p_max_sites, 0) <= 0
    or coalesce(p_max_named_users, 0) <= 0 then
    raise exception 'Commercial plan entitlement inputs are invalid';
  end if;

  update private.ai_commercial_plan_policies
  set max_sites = p_max_sites,
      max_named_users = p_max_named_users,
      updated_at = now()
  where billing_source = v_source
    and offer_id = v_offer
    and plan_id = v_plan
    and status = 'draft';

  if not found then
    raise exception 'Draft AI commercial policy must exist before capacity is configured';
  end if;

  return jsonb_build_object(
    'billingSource', v_source,
    'offerId', v_offer,
    'planId', v_plan,
    'maxSites', p_max_sites,
    'maxNamedUsers', p_max_named_users,
    'status', 'draft'
  );
end;
$$;

revoke all on function public.configure_commercial_plan_capacity(
  text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.configure_commercial_plan_capacity(
  text, text, text, integer, integer
) to service_role;

create or replace function private.invalidate_marketplace_capacity_on_policy_reconfiguration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.billing_source = 'azure_marketplace'
    and row(
      new.pricing_model, new.allowance_mode,
      new.included_calls_per_period, new.included_tokens_per_period,
      new.max_calls_per_period, new.max_tokens_per_period,
      new.max_decisions_per_period, new.minimum_period_revenue_cad,
      new.non_inference_variable_cost_cad, new.provider_cost_multiplier,
      new.minimum_gross_margin_ratio, new.allowed_models,
      new.meter_dimension, new.meter_unit_tokens,
      new.overage_revenue_cad_per_unit
    ) is distinct from row(
      old.pricing_model, old.allowance_mode,
      old.included_calls_per_period, old.included_tokens_per_period,
      old.max_calls_per_period, old.max_tokens_per_period,
      old.max_decisions_per_period, old.minimum_period_revenue_cad,
      old.non_inference_variable_cost_cad, old.provider_cost_multiplier,
      old.minimum_gross_margin_ratio, old.allowed_models,
      old.meter_dimension, old.meter_unit_tokens,
      old.overage_revenue_cad_per_unit
    ) then
    new.max_sites := null;
    new.max_named_users := null;
  end if;
  return new;
end;
$$;

revoke all on function private.invalidate_marketplace_capacity_on_policy_reconfiguration()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_marketplace_capacity_on_policy_reconfiguration
  on private.ai_commercial_plan_policies;
create trigger invalidate_marketplace_capacity_on_policy_reconfiguration
before update of pricing_model, allowance_mode, included_calls_per_period,
  included_tokens_per_period, max_calls_per_period, max_tokens_per_period,
  max_decisions_per_period, minimum_period_revenue_cad,
  non_inference_variable_cost_cad, provider_cost_multiplier,
  minimum_gross_margin_ratio, allowed_models, meter_dimension,
  meter_unit_tokens, overage_revenue_cad_per_unit
on private.ai_commercial_plan_policies
for each row execute function private.invalidate_marketplace_capacity_on_policy_reconfiguration();

create or replace function private.require_marketplace_capacity_before_policy_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.billing_source = 'azure_marketplace'
    and new.status = 'approved'
    and (coalesce(new.max_sites, 0) <= 0
      or coalesce(new.max_named_users, 0) <= 0) then
    raise exception 'Marketplace AI commercial policy approval blocked: site and named-user capacity are required';
  end if;
  return new;
end;
$$;

revoke all on function private.require_marketplace_capacity_before_policy_approval()
  from public, anon, authenticated, service_role;

drop trigger if exists require_marketplace_capacity_before_policy_approval
  on private.ai_commercial_plan_policies;
create trigger require_marketplace_capacity_before_policy_approval
before insert or update of status, max_sites, max_named_users
on private.ai_commercial_plan_policies
for each row execute function private.require_marketplace_capacity_before_policy_approval();

create or replace function private.active_marketplace_commercial_policy(
  p_organization_id uuid
) returns setof private.ai_commercial_plan_policies
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscriptions integer;
  v_policies integer;
begin
  select count(*) into v_subscriptions
  from public.billing_subscriptions s
  where s.organization_id = p_organization_id
    and s.billing_source = 'azure_marketplace'
    and s.status = 'active'
    and s.marketplace_status = 'Subscribed';

  if v_subscriptions = 0 then
    return;
  end if;
  if v_subscriptions <> 1 then
    raise exception 'Marketplace commercial entitlement is ambiguous';
  end if;

  select count(*) into v_policies
  from public.billing_subscriptions s
  join private.ai_commercial_plan_policies p
    on p.billing_source = s.billing_source
   and p.offer_id = s.marketplace_offer_id
   and p.plan_id = coalesce(s.marketplace_plan_id, s.plan)
    and p.status = 'approved'
    and p.max_sites is not null
    and p.max_named_users is not null
  where s.organization_id = p_organization_id
    and s.billing_source = 'azure_marketplace'
    and s.status = 'active'
    and s.marketplace_status = 'Subscribed';

  if v_policies <> 1 then
    raise exception 'Approved commercial plan entitlement is absent';
  end if;

  return query
  select p.*
  from public.billing_subscriptions s
  join private.ai_commercial_plan_policies p
    on p.billing_source = s.billing_source
   and p.offer_id = s.marketplace_offer_id
   and p.plan_id = coalesce(s.marketplace_plan_id, s.plan)
   and p.status = 'approved'
   and p.max_sites is not null
   and p.max_named_users is not null
  where s.organization_id = p_organization_id
    and s.billing_source = 'azure_marketplace'
    and s.status = 'active'
    and s.marketplace_status = 'Subscribed';
end;
$$;

revoke all on function private.active_marketplace_commercial_policy(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.enforce_marketplace_subscription_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_other_active_subscriptions integer;
  v_sites integer;
  v_users integer;
begin
  if new.billing_source <> 'azure_marketplace'
    or new.status <> 'active'
    or new.marketplace_status <> 'Subscribed' then
    return new;
  end if;
  if new.organization_id is null then
    raise exception 'Marketplace activation blocked: organization binding is absent';
  end if;

  select count(*) into v_other_active_subscriptions
  from public.billing_subscriptions s
  where s.organization_id = new.organization_id
    and s.billing_source = 'azure_marketplace'
    and s.status = 'active'
    and s.marketplace_status = 'Subscribed'
    and s.id <> new.id;
  if v_other_active_subscriptions > 0 then
    raise exception 'Marketplace activation blocked: commercial entitlement is ambiguous';
  end if;

  select * into v_policy
  from private.ai_commercial_plan_policies p
  where p.billing_source = 'azure_marketplace'
    and p.offer_id = btrim(coalesce(new.marketplace_offer_id, ''))
    and p.plan_id = btrim(coalesce(new.marketplace_plan_id, new.plan, ''))
    and p.status = 'approved'
    and p.max_sites is not null
    and p.max_named_users is not null;

  if not found then
    raise exception 'Marketplace activation blocked: approved commercial plan entitlement is absent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
  select count(*) into v_sites from public.sites
    where organization_id = new.organization_id;
  select count(*) into v_users from public.user_profiles
    where organization_id = new.organization_id;

  if v_sites > v_policy.max_sites then
    raise exception 'Marketplace activation blocked: current site count exceeds the approved plan limit';
  end if;
  if v_users > v_policy.max_named_users then
    raise exception 'Marketplace activation blocked: current named-user count exceeds the approved plan limit';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_marketplace_subscription_capacity()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_marketplace_subscription_capacity
  on public.billing_subscriptions;
create trigger enforce_marketplace_subscription_capacity
before insert or update of organization_id, billing_source,
  marketplace_offer_id, marketplace_plan_id, plan, status, marketplace_status
on public.billing_subscriptions
for each row execute function private.enforce_marketplace_subscription_capacity();

create or replace function private.enforce_marketplace_site_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_count integer;
begin
  if tg_op = 'UPDATE'
    and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  select * into v_policy
  from private.active_marketplace_commercial_policy(new.organization_id);
  if not found then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
  select count(*) into v_count
  from public.sites
  where organization_id = new.organization_id
    and (tg_op = 'INSERT' or id <> new.id);

  if v_count >= v_policy.max_sites then
    raise exception 'Approved Marketplace site limit reached';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_marketplace_site_capacity()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_marketplace_site_capacity on public.sites;
create trigger enforce_marketplace_site_capacity
before insert or update of organization_id on public.sites
for each row execute function private.enforce_marketplace_site_capacity();

create or replace function private.enforce_marketplace_named_user_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_count integer;
begin
  if new.organization_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  select * into v_policy
  from private.active_marketplace_commercial_policy(new.organization_id);
  if not found then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
  select count(*) into v_count
  from public.user_profiles
  where organization_id = new.organization_id
    and (tg_op = 'INSERT' or id <> new.id);

  if v_count >= v_policy.max_named_users then
    raise exception 'Approved Marketplace named-user limit reached';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_marketplace_named_user_capacity()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_marketplace_named_user_capacity
  on public.user_profiles;
create trigger enforce_marketplace_named_user_capacity
before insert or update of organization_id on public.user_profiles
for each row execute function private.enforce_marketplace_named_user_capacity();

create or replace function public.get_current_commercial_plan_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_subscription public.billing_subscriptions%rowtype;
  v_policy private.ai_commercial_plan_policies%rowtype;
  v_sites integer;
  v_users integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select organization_id into v_org
  from public.user_profiles where id = auth.uid();
  if v_org is null then
    return jsonb_build_object('enforced', false, 'reason', 'workspace_membership_required');
  end if;

  select * into v_subscription
  from public.billing_subscriptions
  where organization_id = v_org
    and billing_source = 'azure_marketplace'
    and status = 'active'
    and marketplace_status = 'Subscribed'
  order by updated_at desc, created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('enforced', false, 'source', 'direct_or_evaluation');
  end if;

  select * into v_policy
  from private.ai_commercial_plan_policies
  where billing_source = v_subscription.billing_source
    and offer_id = v_subscription.marketplace_offer_id
    and plan_id = coalesce(v_subscription.marketplace_plan_id, v_subscription.plan)
    and status = 'approved'
    and max_sites is not null
    and max_named_users is not null;
  if not found then
    return jsonb_build_object(
      'enforced', true,
      'configured', false,
      'reason', 'approved_commercial_plan_entitlement_absent'
    );
  end if;

  select count(*) into v_sites from public.sites where organization_id = v_org;
  select count(*) into v_users from public.user_profiles where organization_id = v_org;
  return jsonb_build_object(
    'enforced', true,
    'configured', true,
    'billingSource', v_policy.billing_source,
    'offerId', v_policy.offer_id,
    'planId', v_policy.plan_id,
    'sitesUsed', v_sites,
    'maxSites', v_policy.max_sites,
    'namedUsersUsed', v_users,
    'maxNamedUsers', v_policy.max_named_users
  );
end;
$$;

revoke all on function public.get_current_commercial_plan_limits()
  from public, anon;
grant execute on function public.get_current_commercial_plan_limits()
  to authenticated;

comment on function public.get_current_commercial_plan_limits() is
  'Authenticated, tenant-scoped view of the exact Marketplace site and '
  'named-user boundary and current usage. It grants no mutation authority.';
