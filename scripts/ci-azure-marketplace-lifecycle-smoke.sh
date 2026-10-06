#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Azure Marketplace lifecycle smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

PGPASSWORD="${PGPASSWORD:-postgres}" psql \
  -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" \
  -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" \
  -q -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.organizations(id,name,industry) values
  ('91111111-1111-4111-8111-111111111111','Marketplace Lifecycle Tenant','technology');
insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
  confirmation_token,recovery_token,email_change,email_change_token_new,
  email_change_token_current,phone_change,phone_change_token,reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '92222222-2222-4222-8222-222222222222','authenticated','authenticated',
  'lifecycle-admin@syncai.invalid',extensions.crypt('MarketplaceLifecycle123!',extensions.gen_salt('bf')),
  now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',
  '','','','','','','',''
);
insert into public.user_profiles(id,organization_id,email,full_name,role) values
  ('92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','lifecycle-admin@syncai.invalid','Lifecycle Admin','admin')
on conflict(id) do update set
  organization_id=excluded.organization_id,email=excluded.email,
  full_name=excluded.full_name,role=excluded.role;

set local role service_role;

do $test$
declare
  v_resolution jsonb;
  v_claimed jsonb;
  v_result jsonb;
  v_resolution_id uuid;
begin
  v_resolution := public.record_marketplace_fulfillment_resolution(
    '93333333-3333-4333-8333-333333333333',
    'syncai-publisher','syncai-enterprise','enterprise','SyncAI Enterprise',25,
    '94444444-4444-4444-8444-444444444444',null,
    '95555555-5555-4555-8555-555555555555',null,
    'PendingFulfillmentStart',repeat('a',64),repeat('b',64),now()+interval '23 hours'
  );
  v_resolution_id := (v_resolution->>'resolutionId')::uuid;
  v_result := public.claim_marketplace_fulfillment_activation(
    v_resolution_id,repeat('b',64),'92222222-2222-4222-8222-222222222222',
    '94444444-4444-4444-8444-444444444444'
  );
  if v_result ? 'error' then raise exception 'binding failed: %',v_result; end if;

  -- CI-only commercial fixtures prove that initial activation and an
  -- authoritative plan change both fail closed unless their exact plans have
  -- an approved, margin-safe AI allowance. These are not production prices.
  v_result := public.configure_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise','per_user',
    'hard_stop',10,1000,10,1000,5,1000,0,0.50,
    array['gpt-4o-mini']::text[],null,null,null,
    'CI-only Marketplace lifecycle fixture'
  );
  if v_result->>'status'<>'draft'
     or coalesce((v_result->'evaluation'->>'allowed')::boolean,false) is not true then
    raise exception 'enterprise commercial fixture failed margin evaluation: %',v_result;
  end if;
  v_result := public.approve_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise',
    '92222222-2222-4222-8222-222222222222');
  if coalesce((v_result->>'approved')::boolean,false) is not true then
    raise exception 'enterprise commercial fixture was not approved: %',v_result;
  end if;

  v_result := public.configure_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise-plus','per_user',
    'hard_stop',20,2000,20,2000,10,2000,0,0.50,
    array['gpt-4o-mini']::text[],null,null,null,
    'CI-only Marketplace lifecycle upgrade fixture'
  );
  if v_result->>'status'<>'draft'
     or coalesce((v_result->'evaluation'->>'allowed')::boolean,false) is not true then
    raise exception 'enterprise-plus commercial fixture failed margin evaluation: %',v_result;
  end if;
  v_result := public.approve_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise-plus',
    '92222222-2222-4222-8222-222222222222');
  if coalesce((v_result->>'approved')::boolean,false) is not true then
    raise exception 'enterprise-plus commercial fixture was not approved: %',v_result;
  end if;

  v_result := public.record_marketplace_fulfillment_status(
    v_resolution_id,'Subscribed','92222222-2222-4222-8222-222222222222',
    'activation-request','activation-correlation'
  );
  if v_result ? 'error' then raise exception 'activation failed: %',v_result; end if;

  v_claimed := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '96666666-6666-4666-8666-666666666666','ChangePlan','InProgress',
    'syncai-publisher','syncai-enterprise','enterprise-plus',25,repeat('c',64),
    'plan-request','plan-correlation'
  );
  if v_claimed ? 'error' or v_claimed->>'processingState'<>'received'
     or v_claimed->>'duplicate'<>'false' then
    raise exception 'operation claim failed: %',v_claimed;
  end if;
  v_result := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '96666666-6666-4666-8666-666666666666','ChangePlan','InProgress',
    'syncai-publisher','syncai-enterprise','enterprise-plus',25,repeat('c',64),
    'retry-request','retry-correlation'
  );
  if v_result->>'duplicate'<>'true' then
    raise exception 'identical operation retry was not idempotent: %',v_result;
  end if;
  v_result := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '96666666-6666-4666-8666-666666666666','ChangePlan','InProgress',
    'syncai-publisher','syncai-enterprise','enterprise-plus',25,repeat('d',64),
    'conflict-request','conflict-correlation'
  );
  if v_result->>'error' not like '%conflicts%' then
    raise exception 'conflicting retry was not refused: %',v_result;
  end if;
  v_result := public.apply_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '96666666-6666-4666-8666-666666666666','Subscribed','enterprise',25,
    now(),now()+interval '1 month','apply-request','apply-correlation'
  );
  if v_result->>'processingState'<>'applied_pending_ack' then
    raise exception 'plan transition was not held for Microsoft acknowledgement: %',v_result;
  end if;
  if (select plan from public.billing_subscriptions
      where marketplace_subscription_id='93333333-3333-4333-8333-333333333333')<>'enterprise' then
    raise exception 'plan changed optimistically before Microsoft acknowledgement';
  end if;
  v_result := public.complete_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '96666666-6666-4666-8666-666666666666','Succeeded','Subscribed',
    'enterprise-plus',25,now(),now()+interval '1 month',
    'complete-request','complete-correlation'
  );
  if v_result->>'processingState'<>'completed' then
    raise exception 'plan transition did not complete: %',v_result;
  end if;
  if (select plan from public.billing_subscriptions
      where marketplace_subscription_id='93333333-3333-4333-8333-333333333333')<>'enterprise-plus' then
    raise exception 'authoritative completed plan did not reach canonical billing';
  end if;
  v_result := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '97777777-7777-4777-8777-777777777777','Suspend','Succeeded',
    'syncai-publisher','syncai-enterprise','enterprise-plus',25,repeat('e',64),
    'suspend-request','suspend-correlation'
  );
  v_result := public.complete_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '97777777-7777-4777-8777-777777777777','Succeeded','Suspended',
    'enterprise-plus',25,now(),now()+interval '1 month',
    'suspend-request','suspend-correlation'
  );
  if v_result->>'processingState'<>'completed' then
    raise exception 'suspension did not complete: %',v_result;
  end if;
end
$test$;

reset role;
select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $entitlement$
declare v_entitlement jsonb;
begin
  v_entitlement := public.get_current_workspace_entitlement();
  if v_entitlement->>'authorized'<>'false'
     or public.app_current_org() is not null then
    raise exception 'suspended tenant retained canonical workspace access: %',v_entitlement;
  end if;
end
$entitlement$;

reset role;
set local role service_role;
do $reinstate$
declare v_result jsonb;
begin
  v_result := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '98888888-8888-4888-8888-888888888888','Reinstate','InProgress',
    'syncai-publisher','syncai-enterprise','enterprise-plus',25,repeat('f',64),
    'reinstate-request','reinstate-correlation'
  );
  v_result := public.apply_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '98888888-8888-4888-8888-888888888888','Suspended','enterprise-plus',25,
    now(),now()+interval '1 month','reinstate-apply','reinstate-correlation'
  );
  if v_result->>'processingState'<>'applied_pending_ack' then
    raise exception 'reinstate was not held for acknowledgement: %',v_result;
  end if;
  v_result := public.complete_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '98888888-8888-4888-8888-888888888888','Succeeded','Subscribed',
    'enterprise-plus',25,now(),now()+interval '1 month',
    'reinstate-complete','reinstate-correlation'
  );
  if v_result->>'processingState'<>'completed' then
    raise exception 'reinstate did not complete: %',v_result;
  end if;

  v_result := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '98999999-9999-4999-8999-999999999999','ChangeQuantity','InProgress',
    'syncai-publisher','syncai-enterprise','enterprise-plus',10,repeat('0',64),
    'quantity-request','quantity-correlation'
  );
  if v_result->>'processingState'<>'received' then
    raise exception 'quantity change was not claimed: %',v_result;
  end if;
  v_result := public.apply_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '98999999-9999-4999-8999-999999999999','Subscribed','enterprise-plus',25,
    now(),now()+interval '1 month','quantity-apply','quantity-correlation'
  );
  if v_result->>'processingState'<>'applied_pending_ack' then
    raise exception 'quantity change was not held for acknowledgement: %',v_result;
  end if;
  v_result := public.complete_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '98999999-9999-4999-8999-999999999999','Succeeded','Subscribed',
    'enterprise-plus',10,now(),now()+interval '1 month',
    'quantity-complete','quantity-correlation'
  );
  if v_result->>'processingState'<>'completed' then
    raise exception 'quantity change did not complete: %',v_result;
  end if;
end
$reinstate$;

reset role;
do $allowance$
begin
  -- Inspect the private commercial binding only as the PostgreSQL test owner,
  -- after reinstate has made the upgraded plan active again. Suspension above
  -- correctly clears this binding; service_role must still not read it.
  if not exists (
    select 1 from private.llm_org_quotas
    where organization_id='91111111-1111-4111-8111-111111111111'
      and commercial_billing_source='azure_marketplace'
      and commercial_offer_id='syncai-enterprise'
      and commercial_plan_id='enterprise-plus'
      and commercial_allowance_mode='hard_stop'
      and commercial_quantity=10
      and included_calls_per_period=200 and max_calls_per_period=200
      and included_tokens_per_period=20000 and max_tokens_per_period=20000
      and max_decisions_per_period=100
  ) then
    raise exception 'authoritative plan, reinstate, and quantity change did not bind the scaled AI allowance';
  end if;
end
$allowance$;

select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $restored$
declare v_entitlement jsonb;
begin
  v_entitlement := public.get_current_workspace_entitlement();
  if v_entitlement->>'authorized'<>'true'
     or public.app_current_org()<>'91111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'authoritative reinstate did not restore access: %',v_entitlement;
  end if;
end
$restored$;

reset role;
set local role service_role;
do $unsubscribe$
declare v_result jsonb;
begin
  v_result := public.claim_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '99999999-9999-4999-8999-999999999999','Unsubscribe','Succeeded',
    'syncai-publisher','syncai-enterprise','enterprise-plus',25,repeat('1',64),
    'unsubscribe-request','unsubscribe-correlation'
  );
  v_result := public.complete_marketplace_lifecycle_operation(
    '93333333-3333-4333-8333-333333333333',
    '99999999-9999-4999-8999-999999999999','Succeeded','Unsubscribed',
    'enterprise-plus',25,now(),now()+interval '1 month',
    'unsubscribe-request','unsubscribe-correlation'
  );
  if v_result->>'processingState'<>'completed' then
    raise exception 'unsubscribe did not complete: %',v_result;
  end if;
  v_result := public.claim_marketplace_lifecycle_operation(
    '90000000-0000-4000-8000-000000000009',
    '90000000-0000-4000-8000-000000000010','Renew','Succeeded',
    'syncai-publisher','syncai-enterprise','enterprise',10,repeat('2',64),
    'unknown-request','unknown-correlation'
  );
  if v_result->>'processingState'<>'quarantined' or v_result->>'bound'<>'false' then
    raise exception 'unbound lifecycle event was not quarantined: %',v_result;
  end if;
end
$unsubscribe$;

reset role;
select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $final$
declare v_entitlement jsonb;
begin
  v_entitlement := public.get_current_workspace_entitlement();
  if v_entitlement->>'authorized'<>'false'
     or public.app_current_org() is not null then
    raise exception 'unsubscribed tenant retained canonical workspace access: %',v_entitlement;
  end if;
end
$final$;

reset role;
do $privileges$
begin
  if has_function_privilege(
    'authenticated',
    'public.claim_marketplace_lifecycle_operation(text,uuid,text,text,text,text,text,integer,text,text,text)',
    'execute'
  ) then raise exception 'authenticated clients can claim lifecycle operations'; end if;
  if has_table_privilege('authenticated','public.marketplace_fulfillment_operations','select') then
    raise exception 'authenticated clients can read the lifecycle inbox';
  end if;
  if has_table_privilege('service_role','public.marketplace_fulfillment_operations','delete') then
    raise exception 'service role can delete lifecycle evidence';
  end if;
  if not exists (
    select 1 from public.billing_subscriptions
    where organization_id='91111111-1111-4111-8111-111111111111'
      and marketplace_subscription_id='93333333-3333-4333-8333-333333333333'
      and status='cancelled' and marketplace_status='Unsubscribed'
  ) then raise exception 'canonical billing record did not preserve unsubscribe state'; end if;
  if (select count(*) from public.marketplace_fulfillment_operations
      where marketplace_subscription_id='93333333-3333-4333-8333-333333333333')<>5 then
    raise exception 'idempotency inbox cardinality is wrong';
  end if;
  if not exists (
    select 1 from public.audit_events
    where organization_id='91111111-1111-4111-8111-111111111111'
      and entity_type='azure_marketplace_subscription'
      and event_data->>'event'='lifecycle_completed'
      and event_data->>'action'='Unsubscribe'
  ) then raise exception 'canonical lifecycle audit evidence is missing'; end if;
end
$privileges$;

rollback;
SQL

echo 'Azure Marketplace lifecycle smoke passed: signed-boundary-contract=true authoritative-operation=true idempotent=true conflict-refusal=true suspend-lockout=true reinstate=true quantity-rebind=true unsubscribe-lockout=true no-delete=true canonical-audit=true'
