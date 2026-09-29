#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Azure Marketplace Fulfillment smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -q -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.organizations(id,name,industry) values
  ('81111111-1111-4111-8111-111111111111','Marketplace Smoke Tenant','technology'),
  ('82222222-2222-4222-8222-222222222222','Marketplace Foreign Tenant','technology');

insert into public.user_profiles(id,organization_id,email,full_name,role) values
  ('83333333-3333-4333-8333-333333333333','81111111-1111-4111-8111-111111111111','market-admin@syncai.invalid','Marketplace Admin','admin'),
  ('84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','market-engineer@syncai.invalid','Marketplace Engineer','reliability_engineer'),
  ('85555555-5555-4555-8555-555555555555','82222222-2222-4222-8222-222222222222','foreign-admin@syncai.invalid','Foreign Admin','admin');

set local role service_role;

do $test$
declare
  v_resolution jsonb;
  v_claim jsonb;
  v_repeat jsonb;
  v_result jsonb;
  v_resolution_id uuid;
  v_billing_id uuid;
begin
  v_resolution := public.record_marketplace_fulfillment_resolution(
    '86666666-6666-4666-8666-666666666666',
    'syncai-publisher','syncai-enterprise','enterprise','SyncAI Enterprise',25,
    '87777777-7777-4777-8777-777777777777',null,
    '88888888-8888-4888-8888-888888888888',null,
    'PendingFulfillmentStart',repeat('a',64),repeat('b',64),now()+interval '23 hours'
  );
  if v_resolution ? 'error' or v_resolution->>'bound'<>'false'
     or v_resolution->>'secretRotated'<>'true' then
    raise exception 'initial resolution failed: %',v_resolution;
  end if;
  v_resolution_id := (v_resolution->>'resolutionId')::uuid;

  v_result := public.claim_marketplace_fulfillment_activation(
    v_resolution_id,repeat('b',64),'84444444-4444-4444-8444-444444444444',
    '87777777-7777-4777-8777-777777777777');
  if v_result->>'error' not like '%administrator%' then
    raise exception 'non-admin activation was not refused: %',v_result;
  end if;

  v_result := public.claim_marketplace_fulfillment_activation(
    v_resolution_id,repeat('b',64),'83333333-3333-4333-8333-333333333333',
    '89999999-9999-4999-8999-999999999999');
  if v_result->>'error' not like '%does not match%' then
    raise exception 'wrong-tenant activation was not refused: %',v_result;
  end if;

  v_claim := public.claim_marketplace_fulfillment_activation(
    v_resolution_id,repeat('b',64),'83333333-3333-4333-8333-333333333333',
    '87777777-7777-4777-8777-777777777777');
  if v_claim ? 'error' or v_claim->>'internalStatus'<>'activation_pending'
     or v_claim->>'activationRequired'<>'true' then
    raise exception 'valid activation claim failed: %',v_claim;
  end if;
  v_billing_id := (v_claim->>'billingSubscriptionId')::uuid;

  v_repeat := public.claim_marketplace_fulfillment_activation(
    v_resolution_id,repeat('b',64),'83333333-3333-4333-8333-333333333333',
    '87777777-7777-4777-8777-777777777777');
  if v_repeat ? 'error' or (v_repeat->>'billingSubscriptionId')::uuid<>v_billing_id then
    raise exception 'activation claim is not idempotent: first %, repeat %',v_claim,v_repeat;
  end if;

  v_result := public.claim_marketplace_fulfillment_activation(
    v_resolution_id,repeat('b',64),'85555555-5555-4555-8555-555555555555',
    '87777777-7777-4777-8777-777777777777');
  if v_result->>'error' not like '%another organization%' then
    raise exception 'cross-tenant rebinding was not refused: %',v_result;
  end if;

  v_result := public.record_marketplace_fulfillment_status(
    v_resolution_id,'Subscribed','83333333-3333-4333-8333-333333333333',
    'request-smoke','correlation-smoke');
  if v_result ? 'error' or v_result->>'internalStatus'<>'active' then
    raise exception 'authoritative subscribed state failed: %',v_result;
  end if;

  v_resolution := public.record_marketplace_fulfillment_resolution(
    '86666666-6666-4666-8666-666666666666',
    'syncai-publisher','syncai-enterprise','enterprise','SyncAI Enterprise',25,
    '87777777-7777-4777-8777-777777777777',null,
    '88888888-8888-4888-8888-888888888888',null,
    'Subscribed',repeat('c',64),repeat('d',64),now()+interval '23 hours'
  );
  if v_resolution ? 'error' or v_resolution->>'bound'<>'true'
     or v_resolution->>'secretRotated'<>'true' then
    raise exception 'bound re-resolution did not rotate proof: %',v_resolution;
  end if;
  v_result := public.authorize_marketplace_fulfillment_status(
    v_resolution_id,repeat('b',64),'83333333-3333-4333-8333-333333333333',
    '87777777-7777-4777-8777-777777777777');
  if v_result->>'error' not like '%proof is invalid%' then
    raise exception 'rotated activation proof left the old proof valid: %',v_result;
  end if;
  v_result := public.authorize_marketplace_fulfillment_status(
    v_resolution_id,repeat('d',64),'83333333-3333-4333-8333-333333333333',
    '87777777-7777-4777-8777-777777777777');
  if v_result ? 'error' then
    raise exception 'rotated activation proof was not accepted: %',v_result;
  end if;

end
$test$;

reset role;

do $privileges$
begin
  if has_function_privilege(
    'authenticated',
    'public.record_marketplace_fulfillment_resolution(text,text,text,text,text,integer,text,text,text,text,text,text,text,timestamptz)',
    'execute'
  ) then
    raise exception 'authenticated clients can record Marketplace resolutions';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.claim_marketplace_fulfillment_activation(uuid,text,uuid,text)',
    'execute'
  ) then
    raise exception 'authenticated clients can directly claim Marketplace activation';
  end if;
  if has_table_privilege('authenticated','public.marketplace_fulfillment_resolutions','select') then
    raise exception 'authenticated clients can read Marketplace server evidence';
  end if;
  if not exists (
    select 1 from public.billing_subscriptions
    where organization_id='81111111-1111-4111-8111-111111111111'
      and billing_source='azure_marketplace'
      and marketplace_subscription_id='86666666-6666-4666-8666-666666666666'
      and marketplace_status='Subscribed' and status='active'
  ) then
    raise exception 'canonical billing record did not become active';
  end if;
  if (select count(*) from public.billing_subscriptions
      where marketplace_subscription_id='86666666-6666-4666-8666-666666666666')<>1 then
    raise exception 'Marketplace subscription produced more than one billing record';
  end if;
  if not exists (
    select 1 from public.audit_events
    where entity_type='azure_marketplace_subscription'
      and event_data->>'event'='status_verified'
      and organization_id='81111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'canonical Marketplace status audit evidence is missing';
  end if;
  if exists (
    select 1 from public.marketplace_fulfillment_resolutions
    where marketplace_subscription_id='86666666-6666-4666-8666-666666666666'
      and row_to_json(marketplace_fulfillment_resolutions)::text
        like '%raw-purchase-token-must-never-persist%'
  ) or exists (
    select 1 from public.audit_events
    where entity_type='azure_marketplace_subscription'
      and event_data::text like '%raw-purchase-token-must-never-persist%'
  ) then
    raise exception 'raw purchase token material was persisted';
  end if;
end
$privileges$;

rollback;
SQL

echo 'Azure Marketplace Fulfillment smoke passed: server-only resolution=true raw-token-retention=false existing-admin=true tenant-match=true one-org-binding=true idempotent=true canonical-billing=true canonical-audit=true status-authoritative=true'
