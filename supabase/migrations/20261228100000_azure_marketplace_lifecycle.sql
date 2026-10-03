-- Azure Marketplace Gate A5: authenticated, idempotent lifecycle processing.
--
-- Microsoft webhook input is never authoritative on its own. The Edge boundary
-- validates Microsoft's Entra signature and claims, calls Get Operation, and
-- only then invokes these service-only state transitions. This migration uses
-- the canonical billing subscription for entitlement and canonical audit_events
-- for retained history. The operations table is only an idempotency inbox; it
-- stores no raw webhook payload, bearer token, purchase token, email or object ID.

alter table public.marketplace_fulfillment_resolutions
  add column if not exists term_start timestamptz,
  add column if not exists term_end timestamptz;

create table if not exists public.marketplace_fulfillment_operations (
  id uuid primary key default gen_random_uuid(),
  marketplace_subscription_id text not null,
  microsoft_operation_id uuid not null,
  organization_id uuid references public.organizations(id) on delete restrict,
  billing_subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
  action text not null,
  microsoft_status text not null,
  requested_plan_id text,
  requested_quantity integer,
  payload_fingerprint text not null,
  processing_state text not null default 'received',
  request_id text,
  correlation_id text,
  error_code text,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (marketplace_subscription_id, microsoft_operation_id),
  constraint marketplace_fulfillment_operation_action
    check (action in ('Subscribe','ChangePlan','ChangeQuantity','Renew','Suspend','Unsubscribe','Reinstate')),
  constraint marketplace_fulfillment_operation_status
    check (microsoft_status in ('NotStarted','InProgress','Failed','Succeeded','Conflict')),
  constraint marketplace_fulfillment_operation_state
    check (processing_state in ('received','quarantined','applied_pending_ack','completed','failed','conflict')),
  constraint marketplace_fulfillment_operation_quantity
    check (requested_quantity is null or requested_quantity > 0),
  constraint marketplace_fulfillment_operation_fingerprint
    check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint marketplace_fulfillment_operation_binding
    check (
      (organization_id is null and billing_subscription_id is null and processing_state='quarantined')
      or (organization_id is not null and billing_subscription_id is not null and processing_state<>'quarantined')
    )
);

create index if not exists marketplace_fulfillment_operations_org_idx
  on public.marketplace_fulfillment_operations (organization_id, received_at desc)
  where organization_id is not null;

alter table public.marketplace_fulfillment_operations enable row level security;
alter table public.marketplace_fulfillment_operations force row level security;
revoke all on table public.marketplace_fulfillment_operations from public, anon, authenticated;
revoke delete, truncate on table public.marketplace_fulfillment_operations from service_role;
grant select, insert, update on table public.marketplace_fulfillment_operations to service_role;

-- An organization that has never entered the Marketplace commercial rail keeps
-- its existing direct/evaluation access. Once it has a Marketplace billing row,
-- it needs at least one canonical active entitlement (direct or Marketplace).
-- A Marketplace row is active only when BOTH internal and Microsoft state agree.
create or replace function public.app_org_has_commercial_entitlement(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_organization_id is null then false
    when not exists (
      select 1 from public.billing_subscriptions s
      where s.organization_id=p_organization_id
        and s.billing_source='azure_marketplace'
    ) then true
    else exists (
      select 1 from public.billing_subscriptions s
      where s.organization_id=p_organization_id
        and s.status='active'
        and (
          s.billing_source<>'azure_marketplace'
          or s.marketplace_status='Subscribed'
        )
    )
  end;
$$;

-- app_current_org is the canonical RLS and SECURITY DEFINER tenancy resolver.
-- Applying the commercial gate here means a suspended Marketplace-only tenant
-- cannot bypass the UI and continue through PostgREST or governed RPCs. No row
-- is deleted; restoring an authoritative active entitlement restores access.
create or replace function public.app_current_org()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.organization_id
  from public.user_profiles p
  where p.id=auth.uid()
    and public.app_org_has_commercial_entitlement(p.organization_id)
$$;

create or replace function public.get_current_workspace_entitlement()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_marketplace_exists boolean;
  v_authorized boolean;
  v_active_marketplace boolean;
  v_marketplace_status text;
begin
  select organization_id into v_org from public.user_profiles where id=auth.uid();
  if v_org is null then
    return jsonb_build_object('authorized',false,'source','none','reason','workspace_membership_required');
  end if;
  select exists(
    select 1 from public.billing_subscriptions
    where organization_id=v_org and billing_source='azure_marketplace'
  ), exists(
    select 1 from public.billing_subscriptions
    where organization_id=v_org and billing_source='azure_marketplace'
      and status='active' and marketplace_status='Subscribed'
  ) into v_marketplace_exists,v_active_marketplace;
  v_authorized := public.app_org_has_commercial_entitlement(v_org);
  select marketplace_status into v_marketplace_status
  from public.billing_subscriptions
  where organization_id=v_org and billing_source='azure_marketplace'
  order by updated_at desc,created_at desc limit 1;
  return jsonb_build_object(
    'authorized',v_authorized,
    'source',case
      when v_active_marketplace then 'azure_marketplace'
      when v_authorized then 'direct_or_evaluation'
      when v_marketplace_exists then 'azure_marketplace'
      else 'none' end,
    'reason',case when v_authorized then null else 'commercial_entitlement_inactive' end,
    'marketplaceStatus',v_marketplace_status
  );
end;
$$;

create or replace function public.claim_marketplace_lifecycle_operation(
  p_marketplace_subscription_id text,
  p_microsoft_operation_id uuid,
  p_action text,
  p_microsoft_status text,
  p_publisher_id text,
  p_offer_id text,
  p_plan_id text,
  p_quantity integer,
  p_payload_fingerprint text,
  p_request_id text,
  p_correlation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_existing public.marketplace_fulfillment_operations%rowtype;
  v_resolution_found boolean;
  v_state text;
begin
  if btrim(coalesce(p_marketplace_subscription_id,''))=''
    or btrim(coalesce(p_publisher_id,''))=''
    or btrim(coalesce(p_offer_id,''))=''
    or btrim(coalesce(p_plan_id,''))='' then
    return jsonb_build_object('error','Marketplace operation identity is incomplete');
  end if;
  if p_action not in ('Subscribe','ChangePlan','ChangeQuantity','Renew','Suspend','Unsubscribe','Reinstate')
    or p_microsoft_status not in ('NotStarted','InProgress','Failed','Succeeded','Conflict') then
    return jsonb_build_object('error','Marketplace operation action or status is unsupported');
  end if;
  if p_quantity is not null and p_quantity<=0 then
    return jsonb_build_object('error','Marketplace operation quantity must be positive');
  end if;
  if coalesce(p_payload_fingerprint,'') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','Marketplace operation fingerprint is invalid');
  end if;

  -- Serialize the first delivery and concurrent Microsoft retries before the
  -- uniqueness check. A collision can delay an unrelated claim but cannot mix
  -- evidence because the exact subscription/operation identity is still
  -- checked below.
  perform pg_advisory_xact_lock(hashtextextended(
    btrim(p_marketplace_subscription_id)||':'||p_microsoft_operation_id::text,0
  ));

  select * into v_existing from public.marketplace_fulfillment_operations
  where marketplace_subscription_id=btrim(p_marketplace_subscription_id)
    and microsoft_operation_id=p_microsoft_operation_id for update;
  if found then
    if v_existing.payload_fingerprint<>p_payload_fingerprint
      or v_existing.action<>p_action then
      return jsonb_build_object('error','Marketplace operation retry conflicts with retained evidence');
    end if;
    return jsonb_build_object(
      'operationRecordId',v_existing.id,'processingState',v_existing.processing_state,
      'bound',v_existing.organization_id is not null,'duplicate',true
    );
  end if;

  select * into v_resolution from public.marketplace_fulfillment_resolutions
  where marketplace_subscription_id=btrim(p_marketplace_subscription_id) for update;
  v_resolution_found := found;
  if v_resolution_found and (v_resolution.publisher_id<>btrim(p_publisher_id)
    or v_resolution.offer_id<>btrim(p_offer_id)) then
    return jsonb_build_object('error','Marketplace operation conflicts with the bound offer');
  end if;
  v_state := case
    when not v_resolution_found or v_resolution.organization_id is null
      or v_resolution.billing_subscription_id is null then 'quarantined'
    else 'received' end;

  insert into public.marketplace_fulfillment_operations (
    marketplace_subscription_id,microsoft_operation_id,organization_id,
    billing_subscription_id,action,microsoft_status,requested_plan_id,
    requested_quantity,payload_fingerprint,processing_state,request_id,correlation_id
  ) values (
    btrim(p_marketplace_subscription_id),p_microsoft_operation_id,
    case when v_state='received' then v_resolution.organization_id else null end,
    case when v_state='received' then v_resolution.billing_subscription_id else null end,
    p_action,p_microsoft_status,btrim(p_plan_id),p_quantity,p_payload_fingerprint,
    v_state,nullif(btrim(coalesce(p_request_id,'')),''),
    nullif(btrim(coalesce(p_correlation_id,'')),'')
  ) returning * into v_existing;

  insert into public.audit_events (organization_id,entity_type,actor,event_data)
  values (
    v_existing.organization_id,'azure_marketplace_subscription','marketplace_webhook_service',
    jsonb_build_object(
      'event',case when v_state='quarantined' then 'lifecycle_quarantined' else 'lifecycle_received' end,
      'marketplaceSubscriptionId',v_existing.marketplace_subscription_id,
      'microsoftOperationId',v_existing.microsoft_operation_id,
      'action',v_existing.action,'microsoftStatus',v_existing.microsoft_status,
      'requestId',v_existing.request_id,'correlationId',v_existing.correlation_id
    )
  );
  return jsonb_build_object(
    'operationRecordId',v_existing.id,'processingState',v_existing.processing_state,
    'bound',v_existing.organization_id is not null,'duplicate',false
  );
end;
$$;

create or replace function public.apply_marketplace_lifecycle_operation(
  p_marketplace_subscription_id text,
  p_microsoft_operation_id uuid,
  p_marketplace_status text,
  p_authoritative_plan_id text,
  p_authoritative_quantity integer,
  p_term_start timestamptz,
  p_term_end timestamptz,
  p_request_id text,
  p_correlation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.marketplace_fulfillment_operations%rowtype;
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_plan text;
  v_quantity integer;
  v_internal text;
  v_billing text;
  v_ack boolean;
begin
  if p_marketplace_status not in ('PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed')
    or btrim(coalesce(p_authoritative_plan_id,''))='' then
    return jsonb_build_object('error','authoritative Marketplace subscription is invalid');
  end if;
  if p_authoritative_quantity is not null and p_authoritative_quantity<=0 then
    return jsonb_build_object('error','authoritative Marketplace quantity must be positive');
  end if;
  if p_term_start is not null and p_term_end is not null and p_term_end<=p_term_start then
    return jsonb_build_object('error','authoritative Marketplace term is invalid');
  end if;

  select * into v_operation from public.marketplace_fulfillment_operations
  where marketplace_subscription_id=btrim(p_marketplace_subscription_id)
    and microsoft_operation_id=p_microsoft_operation_id for update;
  if not found then return jsonb_build_object('error','Marketplace lifecycle operation not claimed'); end if;
  if v_operation.processing_state='quarantined' then
    return jsonb_build_object('processingState','quarantined','bound',false);
  end if;
  if v_operation.processing_state in ('completed','failed','conflict') then
    return jsonb_build_object('processingState',v_operation.processing_state,'duplicate',true,'bound',true);
  end if;

  select * into v_resolution from public.marketplace_fulfillment_resolutions
  where marketplace_subscription_id=v_operation.marketplace_subscription_id
    and organization_id=v_operation.organization_id
    and billing_subscription_id=v_operation.billing_subscription_id for update;
  if not found then return jsonb_build_object('error','Marketplace lifecycle binding is missing'); end if;

  if v_operation.action='Subscribe' and p_marketplace_status<>'Subscribed'
    or v_operation.action='Suspend' and p_marketplace_status<>'Suspended'
    or v_operation.action='Unsubscribe' and p_marketplace_status<>'Unsubscribed'
    or v_operation.action in ('ChangePlan','ChangeQuantity') and p_marketplace_status<>'Subscribed'
    or v_operation.action='Reinstate' and p_marketplace_status<>'Suspended' then
    return jsonb_build_object('error','authoritative Marketplace state does not match the lifecycle event');
  end if;

  v_ack := v_operation.action in ('ChangePlan','ChangeQuantity','Reinstate');
  v_plan := case when v_operation.action='ChangePlan'
    then v_operation.requested_plan_id else btrim(p_authoritative_plan_id) end;
  v_quantity := case when v_operation.action='ChangeQuantity'
    then v_operation.requested_quantity else p_authoritative_quantity end;
  v_internal := case p_marketplace_status
    when 'Subscribed' then 'active' when 'Suspended' then 'suspended'
    when 'Unsubscribed' then 'unsubscribed' else 'activation_pending' end;
  v_billing := case p_marketplace_status
    when 'Subscribed' then 'active' when 'Suspended' then 'suspended'
    when 'Unsubscribed' then 'cancelled' else 'pending_activation' end;

  if not v_ack then
    update public.billing_subscriptions
    set plan=v_plan,marketplace_plan_id=v_plan,marketplace_quantity=v_quantity,
        marketplace_status=p_marketplace_status,status=v_billing,
        current_period_start=coalesce(p_term_start,current_period_start),
        current_period_end=coalesce(p_term_end,current_period_end),updated_at=now()
    where id=v_operation.billing_subscription_id and organization_id=v_operation.organization_id;
    if not found then return jsonb_build_object('error','canonical billing subscription is missing'); end if;

    update public.marketplace_fulfillment_resolutions
    set plan_id=v_plan,quantity=v_quantity,marketplace_status=p_marketplace_status,
        internal_status=v_internal,term_start=p_term_start,term_end=p_term_end,
        last_status_checked_at=now(),last_error_code=null,updated_at=now()
    where id=v_resolution.id;
  end if;

  update public.marketplace_fulfillment_operations
  set processing_state=case when v_ack then 'applied_pending_ack' else 'completed' end,
      microsoft_status=case when v_ack then microsoft_status else 'Succeeded' end,
      applied_at=coalesce(applied_at,now()),
      completed_at=case when v_ack then completed_at else coalesce(completed_at,now()) end,
      request_id=coalesce(nullif(btrim(coalesce(p_request_id,'')),''),request_id),
      correlation_id=coalesce(nullif(btrim(coalesce(p_correlation_id,'')),''),correlation_id),
      error_code=null,updated_at=now()
  where id=v_operation.id;

  if v_operation.applied_at is null then
    insert into public.audit_events (organization_id,entity_type,actor,event_data)
    values (v_operation.organization_id,'azure_marketplace_subscription','marketplace_webhook_service',jsonb_build_object(
      'event','lifecycle_applied','marketplaceSubscriptionId',v_operation.marketplace_subscription_id,
      'microsoftOperationId',v_operation.microsoft_operation_id,'action',v_operation.action,
      'planId',v_plan,'quantity',v_quantity,'marketplaceStatus',p_marketplace_status,
      'requiresAcknowledgement',v_ack,'canonicalStateChanged',not v_ack
    ));
  end if;
  return jsonb_build_object(
    'processingState',case when v_ack then 'applied_pending_ack' else 'completed' end,
    'requiresAcknowledgement',v_ack,'bound',true
  );
end;
$$;

create or replace function public.complete_marketplace_lifecycle_operation(
  p_marketplace_subscription_id text,
  p_microsoft_operation_id uuid,
  p_microsoft_operation_status text,
  p_marketplace_status text,
  p_authoritative_plan_id text,
  p_authoritative_quantity integer,
  p_term_start timestamptz,
  p_term_end timestamptz,
  p_request_id text,
  p_correlation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.marketplace_fulfillment_operations%rowtype;
  v_resolution public.marketplace_fulfillment_resolutions%rowtype;
  v_state text;
  v_internal text;
  v_billing text;
begin
  if p_microsoft_operation_status not in ('Succeeded','Failed','Conflict')
    or p_marketplace_status not in ('PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed')
    or btrim(coalesce(p_authoritative_plan_id,''))='' then
    return jsonb_build_object('error','terminal Marketplace lifecycle evidence is invalid');
  end if;
  if p_authoritative_quantity is not null and p_authoritative_quantity<=0 then
    return jsonb_build_object('error','authoritative Marketplace quantity must be positive');
  end if;
  select * into v_operation from public.marketplace_fulfillment_operations
  where marketplace_subscription_id=btrim(p_marketplace_subscription_id)
    and microsoft_operation_id=p_microsoft_operation_id for update;
  if not found or v_operation.organization_id is null then
    return jsonb_build_object('error','bound Marketplace lifecycle operation not found');
  end if;
  if v_operation.processing_state in ('completed','failed','conflict') then
    return jsonb_build_object('processingState',v_operation.processing_state,'duplicate',true);
  end if;
  select * into v_resolution from public.marketplace_fulfillment_resolutions
  where marketplace_subscription_id=v_operation.marketplace_subscription_id
    and organization_id=v_operation.organization_id
    and billing_subscription_id=v_operation.billing_subscription_id for update;
  if not found then return jsonb_build_object('error','Marketplace lifecycle binding is missing'); end if;

  v_state := case p_microsoft_operation_status when 'Succeeded' then 'completed'
    when 'Failed' then 'failed' else 'conflict' end;
  v_internal := case p_marketplace_status
    when 'Subscribed' then 'active' when 'Suspended' then 'suspended'
    when 'Unsubscribed' then 'unsubscribed' else 'activation_pending' end;
  v_billing := case p_marketplace_status
    when 'Subscribed' then 'active' when 'Suspended' then 'suspended'
    when 'Unsubscribed' then 'cancelled' else 'pending_activation' end;

  -- Final reconciliation always uses Get Subscription, including Failure and
  -- Conflict, so an optimistic local plan/quantity never survives a refusal.
  update public.billing_subscriptions
  set plan=btrim(p_authoritative_plan_id),marketplace_plan_id=btrim(p_authoritative_plan_id),
      marketplace_quantity=p_authoritative_quantity,marketplace_status=p_marketplace_status,
      status=v_billing,current_period_start=coalesce(p_term_start,current_period_start),
      current_period_end=coalesce(p_term_end,current_period_end),updated_at=now()
  where id=v_operation.billing_subscription_id and organization_id=v_operation.organization_id;
  update public.marketplace_fulfillment_resolutions
  set plan_id=btrim(p_authoritative_plan_id),quantity=p_authoritative_quantity,
      marketplace_status=p_marketplace_status,internal_status=v_internal,
      term_start=p_term_start,term_end=p_term_end,last_status_checked_at=now(),
      last_error_code=case when v_state='completed' then null else 'operation_'||v_state end,
      updated_at=now()
  where id=v_resolution.id;
  update public.marketplace_fulfillment_operations
  set processing_state=v_state,microsoft_status=p_microsoft_operation_status,
      completed_at=coalesce(completed_at,now()),
      request_id=coalesce(nullif(btrim(coalesce(p_request_id,'')),''),request_id),
      correlation_id=coalesce(nullif(btrim(coalesce(p_correlation_id,'')),''),correlation_id),
      error_code=case when v_state='completed' then null else 'operation_'||v_state end,
      updated_at=now()
  where id=v_operation.id;
  insert into public.audit_events (organization_id,entity_type,actor,event_data)
  values (v_operation.organization_id,'azure_marketplace_subscription','marketplace_webhook_service',jsonb_build_object(
    'event','lifecycle_completed','marketplaceSubscriptionId',v_operation.marketplace_subscription_id,
    'microsoftOperationId',v_operation.microsoft_operation_id,'action',v_operation.action,
    'microsoftOperationStatus',p_microsoft_operation_status,'processingState',v_state,
    'marketplaceStatus',p_marketplace_status,'requestId',p_request_id,'correlationId',p_correlation_id
  ));
  return jsonb_build_object('processingState',v_state,'duplicate',false);
end;
$$;

revoke all on function public.app_org_has_commercial_entitlement(uuid) from public,anon,authenticated;
revoke all on function public.get_current_workspace_entitlement() from public,anon;
grant execute on function public.app_org_has_commercial_entitlement(uuid) to service_role;
grant execute on function public.get_current_workspace_entitlement() to authenticated;

revoke all on function public.claim_marketplace_lifecycle_operation(text,uuid,text,text,text,text,text,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.apply_marketplace_lifecycle_operation(text,uuid,text,text,integer,timestamptz,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.complete_marketplace_lifecycle_operation(text,uuid,text,text,text,integer,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.claim_marketplace_lifecycle_operation(text,uuid,text,text,text,text,text,integer,text,text,text) to service_role;
grant execute on function public.apply_marketplace_lifecycle_operation(text,uuid,text,text,integer,timestamptz,timestamptz,text,text) to service_role;
grant execute on function public.complete_marketplace_lifecycle_operation(text,uuid,text,text,text,integer,timestamptz,timestamptz,text,text) to service_role;

comment on table public.marketplace_fulfillment_operations is
  'Service-only Azure Marketplace lifecycle idempotency inbox. Canonical commercial state remains billing_subscriptions and retained audit history remains audit_events.';
