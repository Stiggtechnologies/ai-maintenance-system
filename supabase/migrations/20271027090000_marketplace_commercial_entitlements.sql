-- Marketplace commercial entitlements make the buyer-visible site and member
-- boundaries executable. They extend the canonical billing_subscriptions,
-- sites and user_profiles records; they do not create a second tenant, user or
-- subscription model.
--
-- No plan row is seeded. A service operator must configure a draft against the
-- exact Microsoft offer and plan identities, then a named auth user must be
-- recorded when the policy is approved. Marketplace activation fails closed
-- until that approval exists.

create table if not exists private.commercial_plan_entitlements (
  billing_source text not null,
  offer_id text not null default '',
  plan_id text not null,
  max_sites integer not null,
  max_named_users integer not null,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (billing_source, offer_id, plan_id),
  check (btrim(billing_source) <> '' and btrim(plan_id) <> ''),
  check (billing_source <> 'azure_marketplace' or btrim(offer_id) <> ''),
  check (max_sites > 0 and max_named_users > 0),
  check (status in ('draft', 'approved', 'retired')),
  check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or (status <> 'approved' and approved_by is null and approved_at is null)
  )
);

alter table private.commercial_plan_entitlements enable row level security;
revoke all on table private.commercial_plan_entitlements
  from public, anon, authenticated, service_role;

comment on table private.commercial_plan_entitlements is
  'Owner-controlled site and named-user boundaries for one canonical billing '
  'plan. No row is seeded and Marketplace activation fails closed until the '
  'exact offer and plan policy is approved.';

create or replace function public.configure_commercial_plan_entitlement(
  p_billing_source text,
  p_offer_id text,
  p_plan_id text,
  p_max_sites integer,
  p_max_named_users integer,
  p_note text default null
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

  insert into private.commercial_plan_entitlements (
    billing_source, offer_id, plan_id, max_sites, max_named_users,
    status, approved_by, approved_at, note, updated_at
  ) values (
    v_source, v_offer, v_plan, p_max_sites, p_max_named_users,
    'draft', null, null, nullif(btrim(coalesce(p_note, '')), ''), now()
  )
  on conflict (billing_source, offer_id, plan_id) do update set
    max_sites = excluded.max_sites,
    max_named_users = excluded.max_named_users,
    status = 'draft',
    approved_by = null,
    approved_at = null,
    note = excluded.note,
    updated_at = now();

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

revoke all on function public.configure_commercial_plan_entitlement(
  text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.configure_commercial_plan_entitlement(
  text, text, text, integer, integer, text
) to service_role;

create or replace function public.approve_commercial_plan_entitlement(
  p_billing_source text,
  p_offer_id text,
  p_plan_id text,
  p_approved_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy private.commercial_plan_entitlements%rowtype;
begin
  if p_approved_by is null or not exists (
    select 1 from auth.users where id = p_approved_by
  ) then
    raise exception 'A named approval authority is required';
  end if;

  update private.commercial_plan_entitlements
  set status = 'approved',
      approved_by = p_approved_by,
      approved_at = now(),
      updated_at = now()
  where billing_source = btrim(coalesce(p_billing_source, ''))
    and offer_id = btrim(coalesce(p_offer_id, ''))
    and plan_id = btrim(coalesce(p_plan_id, ''))
    and status = 'draft'
  returning * into v_policy;

  if not found then
    raise exception 'Draft commercial plan entitlement not found';
  end if;

  return jsonb_build_object(
    'billingSource', v_policy.billing_source,
    'offerId', v_policy.offer_id,
    'planId', v_policy.plan_id,
    'maxSites', v_policy.max_sites,
    'maxNamedUsers', v_policy.max_named_users,
    'status', v_policy.status,
    'approvedBy', v_policy.approved_by,
    'approvedAt', v_policy.approved_at
  );
end;
$$;

revoke all on function public.approve_commercial_plan_entitlement(
  text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.approve_commercial_plan_entitlement(
  text, text, text, uuid
) to service_role;

create or replace function private.active_marketplace_commercial_policy(
  p_organization_id uuid
) returns setof private.commercial_plan_entitlements
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
  join private.commercial_plan_entitlements p
    on p.billing_source = s.billing_source
   and p.offer_id = s.marketplace_offer_id
   and p.plan_id = coalesce(s.marketplace_plan_id, s.plan)
   and p.status = 'approved'
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
  join private.commercial_plan_entitlements p
    on p.billing_source = s.billing_source
   and p.offer_id = s.marketplace_offer_id
   and p.plan_id = coalesce(s.marketplace_plan_id, s.plan)
   and p.status = 'approved'
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
  v_policy private.commercial_plan_entitlements%rowtype;
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
  from private.commercial_plan_entitlements p
  where p.billing_source = 'azure_marketplace'
    and p.offer_id = btrim(coalesce(new.marketplace_offer_id, ''))
    and p.plan_id = btrim(coalesce(new.marketplace_plan_id, new.plan, ''))
    and p.status = 'approved';

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
  v_policy private.commercial_plan_entitlements%rowtype;
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
  v_policy private.commercial_plan_entitlements%rowtype;
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
  v_policy private.commercial_plan_entitlements%rowtype;
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
  from private.commercial_plan_entitlements
  where billing_source = v_subscription.billing_source
    and offer_id = v_subscription.marketplace_offer_id
    and plan_id = coalesce(v_subscription.marketplace_plan_id, v_subscription.plan)
    and status = 'approved';
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
