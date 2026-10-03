-- Azure Marketplace Gate A4: governed SaaS Fulfillment v2 resolve/activation.
--
-- The purchase token is never stored. Resolution establishes no tenant,
-- membership or entitlement. Only a server-verified Azure identity that is an
-- administrator of an existing SyncAI organization may bind the resolved
-- purchase, and Microsoft remains authoritative for subscription status.

alter table public.billing_subscriptions
  add column if not exists billing_source text not null default 'direct',
  add column if not exists marketplace_subscription_id text,
  add column if not exists marketplace_publisher_id text,
  add column if not exists marketplace_offer_id text,
  add column if not exists marketplace_plan_id text,
  add column if not exists marketplace_quantity integer,
  add column if not exists marketplace_status text,
  add column if not exists marketplace_activated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists billing_subscriptions_marketplace_id_uq
  on public.billing_subscriptions (marketplace_subscription_id)
  where marketplace_subscription_id is not null;

create table if not exists public.marketplace_fulfillment_resolutions (
  id uuid primary key default gen_random_uuid(),
  marketplace_subscription_id text not null unique,
  publisher_id text not null,
  offer_id text not null,
  plan_id text not null,
  subscription_name text not null,
  quantity integer,
  beneficiary_tenant_id text not null,
  beneficiary_object_id text,
  purchaser_tenant_id text not null,
  purchaser_object_id text,
  marketplace_status text not null,
  internal_status text not null default 'resolved',
  token_fingerprint text not null,
  activation_secret_hash text not null,
  organization_id uuid references public.organizations(id) on delete restrict,
  billing_subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
  activated_by uuid,
  resolved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  activation_requested_at timestamptz,
  activated_at timestamptz,
  last_status_checked_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_fulfillment_subscription_id_nonblank
    check (btrim(marketplace_subscription_id) <> ''),
  constraint marketplace_fulfillment_quantity_positive
    check (quantity is null or quantity > 0),
  constraint marketplace_fulfillment_tenant_ids
    check (
      beneficiary_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and purchaser_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
  constraint marketplace_fulfillment_status_values
    check (marketplace_status in ('PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed')),
  constraint marketplace_fulfillment_internal_status_values
    check (internal_status in ('resolved','activation_pending','activation_failed','active','suspended','unsubscribed')),
  constraint marketplace_fulfillment_hashes
    check (
      token_fingerprint ~ '^[0-9a-f]{64}$'
      and activation_secret_hash ~ '^[0-9a-f]{64}$'
    ),
  constraint marketplace_fulfillment_binding_complete
    check (
      (organization_id is null and billing_subscription_id is null and activated_by is null)
      or (organization_id is not null and billing_subscription_id is not null and activated_by is not null)
    )
);

create index if not exists marketplace_fulfillment_resolution_org_idx
  on public.marketplace_fulfillment_resolutions (organization_id, updated_at desc)
  where organization_id is not null;

alter table public.marketplace_fulfillment_resolutions enable row level security;
alter table public.marketplace_fulfillment_resolutions force row level security;
revoke all on table public.marketplace_fulfillment_resolutions from public, anon, authenticated;
revoke delete, truncate on table public.marketplace_fulfillment_resolutions from service_role;
grant select, insert, update on table public.marketplace_fulfillment_resolutions to service_role;

create or replace function public.record_marketplace_fulfillment_resolution(
  p_marketplace_subscription_id text,
  p_publisher_id text,
  p_offer_id text,
  p_plan_id text,
  p_subscription_name text,
  p_quantity integer,
  p_beneficiary_tenant_id text,
  p_beneficiary_object_id text,
  p_purchaser_tenant_id text,
  p_purchaser_object_id text,
  p_marketplace_status text,
  p_token_fingerprint text,
  p_activation_secret_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_existing public.marketplace_fulfillment_resolutions%rowtype;
  v_bound boolean := false;
begin
  if btrim(coalesce(p_marketplace_subscription_id,'')) = ''
    or btrim(coalesce(p_publisher_id,'')) = ''
    or btrim(coalesce(p_offer_id,'')) = ''
    or btrim(coalesce(p_plan_id,'')) = ''
    or btrim(coalesce(p_subscription_name,'')) = '' then
    return jsonb_build_object('error','resolved Marketplace identity is incomplete');
  end if;
  if p_quantity is not null and p_quantity <= 0 then
    return jsonb_build_object('error','resolved Marketplace quantity must be positive');
  end if;
  if lower(coalesce(p_beneficiary_tenant_id,'')) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or lower(coalesce(p_purchaser_tenant_id,'')) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('error','resolved Marketplace tenant identity is invalid');
  end if;
  if p_marketplace_status not in ('PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed') then
    return jsonb_build_object('error','unsupported Marketplace subscription status');
  end if;
  if coalesce(p_token_fingerprint,'') !~ '^[0-9a-f]{64}$'
    or coalesce(p_activation_secret_hash,'') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','Marketplace resolution proof is invalid');
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours 5 minutes' then
    return jsonb_build_object('error','Marketplace resolution expiry is invalid');
  end if;

  select * into v_existing
  from public.marketplace_fulfillment_resolutions
  where marketplace_subscription_id = btrim(p_marketplace_subscription_id)
  for update;

  if found then
    if v_existing.publisher_id <> btrim(p_publisher_id)
      or v_existing.offer_id <> btrim(p_offer_id)
      or lower(v_existing.beneficiary_tenant_id) <> lower(p_beneficiary_tenant_id)
      or lower(v_existing.purchaser_tenant_id) <> lower(p_purchaser_tenant_id) then
      return jsonb_build_object('error','resolved Marketplace identity conflicts with retained evidence');
    end if;
    v_bound := v_existing.organization_id is not null;

    update public.marketplace_fulfillment_resolutions
    set plan_id = btrim(p_plan_id),
        subscription_name = left(btrim(p_subscription_name),500),
        quantity = p_quantity,
        beneficiary_object_id = nullif(btrim(coalesce(p_beneficiary_object_id,'')),''),
        purchaser_object_id = nullif(btrim(coalesce(p_purchaser_object_id,'')),''),
        marketplace_status = p_marketplace_status,
        internal_status = case p_marketplace_status
          when 'Subscribed' then 'active'
          when 'Suspended' then 'suspended'
          when 'Unsubscribed' then 'unsubscribed'
          else 'resolved' end,
        token_fingerprint = p_token_fingerprint,
        activation_secret_hash = p_activation_secret_hash,
        resolved_at = now(),
        expires_at = p_expires_at,
        last_error_code = null,
        updated_at = now()
    where id = v_existing.id
    returning * into v_resolution;
  else
    insert into public.marketplace_fulfillment_resolutions (
      marketplace_subscription_id,publisher_id,offer_id,plan_id,subscription_name,
      quantity,beneficiary_tenant_id,beneficiary_object_id,purchaser_tenant_id,
      purchaser_object_id,marketplace_status,internal_status,token_fingerprint,
      activation_secret_hash,expires_at
    ) values (
      btrim(p_marketplace_subscription_id),btrim(p_publisher_id),btrim(p_offer_id),
      btrim(p_plan_id),left(btrim(p_subscription_name),500),p_quantity,
      lower(p_beneficiary_tenant_id),nullif(btrim(coalesce(p_beneficiary_object_id,'')),''),
      lower(p_purchaser_tenant_id),nullif(btrim(coalesce(p_purchaser_object_id,'')),''),
      p_marketplace_status,
      case p_marketplace_status
        when 'Subscribed' then 'active'
        when 'Suspended' then 'suspended'
        when 'Unsubscribed' then 'unsubscribed'
        else 'resolved' end,
      p_token_fingerprint,p_activation_secret_hash,p_expires_at
    ) returning * into v_resolution;
  end if;

  insert into public.audit_events (organization_id,entity_type,actor,event_data)
  values (
    v_resolution.organization_id,'azure_marketplace_subscription','marketplace_fulfillment_service',
    jsonb_build_object(
      'event','purchase_resolved','resolutionId',v_resolution.id,
      'marketplaceSubscriptionId',v_resolution.marketplace_subscription_id,
      'publisherId',v_resolution.publisher_id,'offerId',v_resolution.offer_id,
      'planId',v_resolution.plan_id,'marketplaceStatus',v_resolution.marketplace_status,
      'tokenFingerprint',v_resolution.token_fingerprint
    )
  );

  return jsonb_build_object(
    'resolutionId',v_resolution.id,'internalStatus',v_resolution.internal_status,
    'marketplaceStatus',v_resolution.marketplace_status,'bound',v_bound,
    'secretRotated',true
  );
end;
$$;

create or replace function public.claim_marketplace_fulfillment_activation(
  p_resolution_id uuid,
  p_activation_secret_hash text,
  p_actor_id uuid,
  p_identity_tenant_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_org uuid;
  v_role text;
  v_billing_id uuid;
  v_first_request boolean;
begin
  select organization_id, role into v_org, v_role
  from public.user_profiles where id = p_actor_id;
  if v_org is null or v_role not in ('admin','ai_admin') then
    return jsonb_build_object('error','Marketplace activation requires an existing organization administrator');
  end if;

  select * into v_resolution
  from public.marketplace_fulfillment_resolutions
  where id = p_resolution_id for update;
  if not found then return jsonb_build_object('error','Marketplace resolution not found'); end if;
  if v_resolution.activation_secret_hash <> coalesce(p_activation_secret_hash,'') then
    return jsonb_build_object('error','Marketplace activation proof is invalid');
  end if;
  if v_resolution.expires_at <= now() and v_resolution.organization_id is null then
    return jsonb_build_object('error','Marketplace resolution has expired');
  end if;
  if lower(coalesce(p_identity_tenant_id,'')) not in (
    lower(v_resolution.beneficiary_tenant_id), lower(v_resolution.purchaser_tenant_id)
  ) then
    return jsonb_build_object('error','verified Microsoft tenant does not match the purchase');
  end if;
  if v_resolution.organization_id is not null and v_resolution.organization_id <> v_org then
    return jsonb_build_object('error','Marketplace purchase is already bound to another organization');
  end if;
  if v_resolution.internal_status in ('suspended','unsubscribed') then
    return jsonb_build_object('error','Marketplace subscription is not eligible for activation');
  end if;

  insert into public.billing_subscriptions (
    organization_id,plan,status,billing_source,marketplace_subscription_id,
    marketplace_publisher_id,marketplace_offer_id,marketplace_plan_id,
    marketplace_quantity,marketplace_status,marketplace_activated_at,updated_at
  ) values (
    v_org,v_resolution.plan_id,
    case when v_resolution.marketplace_status='Subscribed' then 'active' else 'pending_activation' end,
    'azure_marketplace',v_resolution.marketplace_subscription_id,
    v_resolution.publisher_id,v_resolution.offer_id,v_resolution.plan_id,
    v_resolution.quantity,v_resolution.marketplace_status,
    case when v_resolution.marketplace_status='Subscribed' then now() else null end,now()
  )
  on conflict (marketplace_subscription_id) where marketplace_subscription_id is not null
  do update set
    plan=excluded.plan,
    marketplace_plan_id=excluded.marketplace_plan_id,
    marketplace_quantity=excluded.marketplace_quantity,
    marketplace_status=excluded.marketplace_status,
    updated_at=now()
  where public.billing_subscriptions.organization_id=excluded.organization_id
  returning id into v_billing_id;
  if v_billing_id is null then
    return jsonb_build_object('error','Marketplace purchase conflicts with another organization billing record');
  end if;

  v_first_request := v_resolution.activation_requested_at is null;
  update public.marketplace_fulfillment_resolutions
  set organization_id=v_org,billing_subscription_id=v_billing_id,activated_by=p_actor_id,
      activation_requested_at=coalesce(activation_requested_at,now()),
      internal_status=case when marketplace_status='Subscribed' then 'active' else 'activation_pending' end,
      activated_at=case when marketplace_status='Subscribed' then coalesce(activated_at,now()) else activated_at end,
      last_error_code=null,updated_at=now()
  where id=p_resolution_id;

  if v_first_request then
    insert into public.audit_events (organization_id,entity_type,actor,event_data)
    values (v_org,'azure_marketplace_subscription',p_actor_id::text,jsonb_build_object(
      'event','activation_requested','resolutionId',p_resolution_id,
      'marketplaceSubscriptionId',v_resolution.marketplace_subscription_id,
      'planId',v_resolution.plan_id,'quantity',v_resolution.quantity,
      'verifiedIdentityTenantId',lower(p_identity_tenant_id)
    ));
  end if;

  return jsonb_build_object(
    'resolutionId',p_resolution_id,'billingSubscriptionId',v_billing_id,
    'marketplaceSubscriptionId',v_resolution.marketplace_subscription_id,
    'marketplaceStatus',v_resolution.marketplace_status,
    'internalStatus',case when v_resolution.marketplace_status='Subscribed' then 'active' else 'activation_pending' end,
    'activationRequired',v_resolution.marketplace_status='PendingFulfillmentStart'
  );
end;
$$;

create or replace function public.authorize_marketplace_fulfillment_status(
  p_resolution_id uuid,
  p_activation_secret_hash text,
  p_actor_id uuid,
  p_identity_tenant_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_org uuid;
  v_role text;
begin
  select organization_id,role into v_org,v_role from public.user_profiles where id=p_actor_id;
  select * into v_resolution from public.marketplace_fulfillment_resolutions where id=p_resolution_id;
  if not found or v_resolution.organization_id is null then
    return jsonb_build_object('error','Marketplace activation has not been claimed');
  end if;
  if v_org is null or v_org<>v_resolution.organization_id or v_role not in ('admin','ai_admin') then
    return jsonb_build_object('error','Marketplace status requires the bound organization administrator');
  end if;
  if v_resolution.activation_secret_hash<>coalesce(p_activation_secret_hash,'') then
    return jsonb_build_object('error','Marketplace activation proof is invalid');
  end if;
  if lower(coalesce(p_identity_tenant_id,'')) not in (
    lower(v_resolution.beneficiary_tenant_id),lower(v_resolution.purchaser_tenant_id)
  ) then
    return jsonb_build_object('error','verified Microsoft tenant does not match the purchase');
  end if;
  return jsonb_build_object(
    'resolutionId',v_resolution.id,
    'marketplaceSubscriptionId',v_resolution.marketplace_subscription_id,
    'marketplaceStatus',v_resolution.marketplace_status,
    'internalStatus',v_resolution.internal_status
  );
end;
$$;

create or replace function public.record_marketplace_fulfillment_status(
  p_resolution_id uuid,
  p_marketplace_status text,
  p_actor_id uuid,
  p_request_id text,
  p_correlation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_internal text;
  v_billing text;
  v_changed boolean;
begin
  if p_marketplace_status not in ('PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed') then
    return jsonb_build_object('error','unsupported Marketplace subscription status');
  end if;
  select * into v_resolution from public.marketplace_fulfillment_resolutions
  where id=p_resolution_id for update;
  if not found or v_resolution.organization_id is null or v_resolution.billing_subscription_id is null then
    return jsonb_build_object('error','Marketplace activation binding not found');
  end if;
  v_internal := case p_marketplace_status
    when 'Subscribed' then 'active' when 'Suspended' then 'suspended'
    when 'Unsubscribed' then 'unsubscribed' else 'activation_pending' end;
  v_billing := case p_marketplace_status
    when 'Subscribed' then 'active' when 'Suspended' then 'suspended'
    when 'Unsubscribed' then 'cancelled' else 'pending_activation' end;
  v_changed := v_resolution.marketplace_status is distinct from p_marketplace_status
    or v_resolution.internal_status is distinct from v_internal;

  update public.marketplace_fulfillment_resolutions
  set marketplace_status=p_marketplace_status,internal_status=v_internal,
      activated_at=case when p_marketplace_status='Subscribed' then coalesce(activated_at,now()) else activated_at end,
      last_status_checked_at=now(),last_error_code=null,updated_at=now()
  where id=p_resolution_id;
  update public.billing_subscriptions
  set marketplace_status=p_marketplace_status,status=v_billing,
      marketplace_activated_at=case when p_marketplace_status='Subscribed' then coalesce(marketplace_activated_at,now()) else marketplace_activated_at end,
      updated_at=now()
  where id=v_resolution.billing_subscription_id and organization_id=v_resolution.organization_id;

  if v_changed then
    insert into public.audit_events (organization_id,entity_type,actor,event_data)
    values (v_resolution.organization_id,'azure_marketplace_subscription',p_actor_id::text,jsonb_build_object(
      'event','status_verified','resolutionId',p_resolution_id,
      'marketplaceSubscriptionId',v_resolution.marketplace_subscription_id,
      'previousMarketplaceStatus',v_resolution.marketplace_status,
      'marketplaceStatus',p_marketplace_status,'requestId',p_request_id,
      'correlationId',p_correlation_id
    ));
  end if;
  return jsonb_build_object('resolutionId',p_resolution_id,'marketplaceStatus',p_marketplace_status,'internalStatus',v_internal);
end;
$$;

create or replace function public.record_marketplace_fulfillment_failure(
  p_resolution_id uuid,
  p_actor_id uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_resolution public.marketplace_fulfillment_resolutions%rowtype;
begin
  if btrim(coalesce(p_error_code,''))='' or length(p_error_code)>100
    or p_error_code !~ '^[a-z0-9_:-]+$' then
    return jsonb_build_object('error','Marketplace failure code is invalid');
  end if;
  select * into v_resolution from public.marketplace_fulfillment_resolutions
  where id=p_resolution_id for update;
  if not found then return jsonb_build_object('error','Marketplace resolution not found'); end if;
  update public.marketplace_fulfillment_resolutions
  set internal_status=case when internal_status='active' then 'active' else 'activation_failed' end,
      last_error_code=p_error_code,updated_at=now()
  where id=p_resolution_id;
  insert into public.audit_events (organization_id,entity_type,actor,event_data)
  values (v_resolution.organization_id,'azure_marketplace_subscription',coalesce(p_actor_id::text,'marketplace_fulfillment_service'),jsonb_build_object(
    'event','fulfillment_failed','resolutionId',p_resolution_id,
    'marketplaceSubscriptionId',v_resolution.marketplace_subscription_id,
    'errorCode',p_error_code
  ));
  return jsonb_build_object('resolutionId',p_resolution_id,'recorded',true);
end;
$$;

revoke all on function public.record_marketplace_fulfillment_resolution(text,text,text,text,text,integer,text,text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_marketplace_fulfillment_activation(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.authorize_marketplace_fulfillment_status(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.record_marketplace_fulfillment_status(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.record_marketplace_fulfillment_failure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_marketplace_fulfillment_resolution(text,text,text,text,text,integer,text,text,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.claim_marketplace_fulfillment_activation(uuid,text,uuid,text) to service_role;
grant execute on function public.authorize_marketplace_fulfillment_status(uuid,text,uuid,text) to service_role;
grant execute on function public.record_marketplace_fulfillment_status(uuid,text,uuid,text,text) to service_role;
grant execute on function public.record_marketplace_fulfillment_failure(uuid,uuid,text) to service_role;

comment on table public.marketplace_fulfillment_resolutions is
  'Server-only Azure Marketplace purchase evidence. Raw purchase tokens are never persisted; tenant binding requires verified Entra identity and existing admin membership.';
