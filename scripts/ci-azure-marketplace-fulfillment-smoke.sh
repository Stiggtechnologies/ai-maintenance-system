#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Azure Marketplace Fulfillment smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -q -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.organizations(id,name,industry) values
  ('81111111-1111-4111-8111-111111111111','Marketplace Smoke Tenant','technology'),
  ('82222222-2222-4222-8222-222222222222','Marketplace Foreign Tenant','technology');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
  confirmation_token,recovery_token,email_change,email_change_token_new,
  email_change_token_current,phone_change,phone_change_token,reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '83333333-3333-4333-8333-333333333333','authenticated','authenticated',
  'market-admin@syncai.invalid',extensions.crypt('MarketplaceSmoke123!',extensions.gen_salt('bf')),
  now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',
  '','','','','','','',''
);

insert into public.user_profiles(id,organization_id,email,full_name,role) values
  ('83333333-3333-4333-8333-333333333333','81111111-1111-4111-8111-111111111111','market-admin@syncai.invalid','Marketplace Admin','admin'),
  ('84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','market-engineer@syncai.invalid','Marketplace Engineer','reliability_engineer'),
  ('85555555-5555-4555-8555-555555555555','82222222-2222-4222-8222-222222222222','foreign-admin@syncai.invalid','Foreign Admin','admin')
on conflict(id) do update set
  organization_id=excluded.organization_id,email=excluded.email,
  full_name=excluded.full_name,role=excluded.role;

set local role service_role;

do $test$
declare
  v_resolution jsonb;
  v_claim jsonb;
  v_repeat jsonb;
  v_result jsonb;
  v_resolution_id uuid;
  v_billing_id uuid;
  v_reservation_id bigint;
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

  -- This is an isolated smoke fixture, not an approved production price. The
  -- Marketplace activation must prove that an explicit, margin-safe AI policy
  -- exists before the canonical subscription can become active.
  v_result := public.configure_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise','per_user',
    'hard_stop',10,1000,10,1000,5,1000,0,1.00,0.50,
    array['gpt-4o-mini']::text[],null,null,null,
    'CI-only Marketplace fulfillment fixture'
  );
  if v_result->>'status'<>'draft'
     or coalesce((v_result->'evaluation'->>'allowed')::boolean,false) is not true then
    raise exception 'commercial policy fixture failed margin evaluation: %',v_result;
  end if;

  v_result := public.approve_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise',
    '83333333-3333-4333-8333-333333333333');
  if coalesce((v_result->>'approved')::boolean,false) is not true then
    raise exception 'commercial policy fixture was not approved: %',v_result;
  end if;

  -- A completed call on a non-default pricing tier must be retained with its
  -- actual usage as an unknown-price breach, then freeze later paid spend.
  insert into public.billing_subscriptions (
    id,organization_id,plan,status,current_period_start,current_period_end,
    billing_source,marketplace_subscription_id,marketplace_publisher_id,
    marketplace_offer_id,marketplace_plan_id,marketplace_quantity,
    marketplace_status,marketplace_activated_at
  ) values (
    '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '82222222-2222-4222-8222-222222222222','enterprise','active',now(),
    now()+interval '30 days','azure_marketplace',
    '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','syncai-publisher',
    'syncai-enterprise','enterprise',1,'Subscribed',now()
  );
  v_result := public.check_llm_commercial_quota(
    '82222222-2222-4222-8222-222222222222','marketplace-pricing-mode-smoke',
    'gpt-4o-mini',100,'decision','smoke-nonstandard-tier'
  );
  if v_result->>'allowed'<>'true' then
    raise exception 'pricing-mode reservation failed: %',v_result;
  end if;
  v_reservation_id := (v_result->>'reservation_id')::bigint;
  perform public.record_llm_usage(
    '82222222-2222-4222-8222-222222222222',
    'marketplace-pricing-mode-smoke','gpt-4o-mini-2024-07-18',
    60,20,v_reservation_id,'fast'
  );
  v_result := public.check_llm_commercial_quota(
    '82222222-2222-4222-8222-222222222222','marketplace-pricing-mode-smoke',
    'gpt-4o-mini',100,'decision','smoke-frozen-after-pricing-mode'
  );
  if v_result->>'limit'<>'commercial_pricing_mode_breached' then
    raise exception 'pricing-mode mismatch did not freeze later spend: %',v_result;
  end if;

  v_result := public.record_marketplace_fulfillment_status(
    v_resolution_id,'Subscribed','83333333-3333-4333-8333-333333333333',
    'request-smoke','correlation-smoke');
  if v_result ? 'error' or v_result->>'internalStatus'<>'active' then
    raise exception 'authoritative subscribed state failed: %',v_result;
  end if;

  -- The provider may return a dated concrete deployment ID. It must resolve
  -- to the exact approved canonical model and retain both identifiers.
  v_result := public.check_llm_commercial_quota(
    '81111111-1111-4111-8111-111111111111','marketplace-smoke',
    'gpt-4o-mini',1000,'decision','smoke-approved-model'
  );
  if v_result->>'allowed'<>'true' then
    raise exception 'approved model reservation failed: %',v_result;
  end if;
  v_reservation_id := (v_result->>'reservation_id')::bigint;
  perform public.record_llm_usage(
    '81111111-1111-4111-8111-111111111111','marketplace-smoke',
    'gpt-4o-mini-2024-07-18',500,200,v_reservation_id,'default'
  );

  -- A gateway route outside the reservation's approved-model snapshot has
  -- already incurred cost, so settlement preserves its true cost and model.
  -- Every later call in the period then fails closed for operator review.
  v_result := public.check_llm_commercial_quota(
    '81111111-1111-4111-8111-111111111111','marketplace-smoke',
    'gpt-4o-mini',1000,'decision','smoke-unapproved-model'
  );
  if v_result->>'allowed'<>'true' then
    raise exception 'pre-mismatch reservation failed: %',v_result;
  end if;
  v_reservation_id := (v_result->>'reservation_id')::bigint;
  perform public.record_llm_usage(
    '81111111-1111-4111-8111-111111111111','marketplace-smoke',
    'gpt-5.6-terra',500,200,v_reservation_id,'default'
  );
  v_result := public.check_llm_commercial_quota(
    '81111111-1111-4111-8111-111111111111','marketplace-smoke',
    'gpt-4o-mini',1000,'decision','smoke-frozen-after-mismatch'
  );
  if v_result->>'limit'<>'commercial_model_policy_breached' then
    raise exception 'actual-model mismatch did not freeze later spend: %',v_result;
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

-- The runtime above deliberately executes as service_role, which must not
-- receive direct SELECT access to the private ledger. Verify the persisted
-- settlement evidence only after returning to the privileged CI fixture role.
do $usage_evidence$
begin
  if not exists (
    select 1 from private.llm_usage
    where organization_id='81111111-1111-4111-8111-111111111111'
      and fn='marketplace-smoke' and requested_model='gpt-4o-mini'
      and model='gpt-4o-mini-2024-07-18' and priced_model='gpt-4o-mini'
      and model_policy_status='approved' and cost_status='priced'
      and inference_cost_cad>0
  ) then
    raise exception 'dated provider model was not priced and approved canonically';
  end if;
  if not exists (
    select 1 from private.llm_usage
    where organization_id='81111111-1111-4111-8111-111111111111'
      and fn='marketplace-smoke' and requested_model='gpt-4o-mini'
      and model='gpt-5.6-terra' and priced_model='gpt-5.6-terra'
      and model_policy_status='unapproved_model' and cost_status='priced'
      and inference_cost_cad>0
  ) then
    raise exception 'unapproved actual model was not retained as a priced policy violation';
  end if;
  if not exists (
    select 1 from private.llm_usage
    where organization_id='82222222-2222-4222-8222-222222222222'
      and fn='marketplace-pricing-mode-smoke'
      and model='gpt-4o-mini-2024-07-18'
      and prompt_tokens=60 and completion_tokens=20
      and service_tier='fast' and pricing_mode_status='nonstandard_tier'
      and cost_status='unknown_price' and inference_cost_cad is null
  ) then
    raise exception 'non-default tier was not retained as an unknown-price breach';
  end if;
end
$usage_evidence$;

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
  if not exists (
    select 1 from private.llm_org_quotas
    where organization_id='81111111-1111-4111-8111-111111111111'
      and commercial_billing_source='azure_marketplace'
      and commercial_offer_id='syncai-enterprise'
      and commercial_plan_id='enterprise'
      and commercial_allowance_mode='hard_stop'
      and commercial_quantity=25
      and included_calls_per_period=250 and max_calls_per_period=250
      and included_tokens_per_period=25000 and max_tokens_per_period=25000
      and max_decisions_per_period=125
  ) then
    raise exception 'approved AI commercial allowance was not bound to the tenant';
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
