#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Azure Marketplace preview certification smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

PGPASSWORD="${PGPASSWORD:-postgres}" psql \
  -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" \
  -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" \
  -q -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.organizations(id,name,industry) values
  ('c1111111-1111-4111-8111-111111111111','Marketplace Certification Tenant','technology');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
  confirmation_token,recovery_token,email_change,email_change_token_new,
  email_change_token_current,phone_change,phone_change_token,reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'c7777777-7777-4777-8777-777777777777','authenticated','authenticated',
  'preview-admin@syncai.invalid',extensions.crypt('MarketplacePreview123!',extensions.gen_salt('bf')),
  now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',
  '','','','','','','',''
);
insert into public.user_profiles(id,organization_id,email,full_name,role) values
  ('c7777777-7777-4777-8777-777777777777','c1111111-1111-4111-8111-111111111111','preview-admin@syncai.invalid','Preview Admin','admin')
on conflict(id) do update set
  organization_id=excluded.organization_id,email=excluded.email,
  full_name=excluded.full_name,role=excluded.role;

-- CI-only preview fixture. Certification must start from a commercially
-- bounded active plan, but these figures are not production prices.
set local role service_role;
do $commercial$
declare v_result jsonb;
begin
  v_result := public.configure_ai_commercial_plan_policy(
    'azure_marketplace','syncai-preview','enterprise-metered','flat_rate',
    'hard_stop',10,1000,10,1000,5,1000,0,1.00,0.50,
    array['gpt-4o-mini']::text[],null,null,null,
    'CI-only Marketplace preview certification fixture'
  );
  if v_result->>'status'<>'draft'
     or coalesce((v_result->'evaluation'->>'allowed')::boolean,false) is not true then
    raise exception 'CI preview policy failed margin evaluation: %',v_result;
  end if;
  v_result := public.approve_ai_commercial_plan_policy(
    'azure_marketplace','syncai-preview','enterprise-metered',
    'c7777777-7777-4777-8777-777777777777'
  );
  if coalesce((v_result->>'approved')::boolean,false) is not true then
    raise exception 'CI preview policy was not approved: %',v_result;
  end if;
end
$commercial$;
reset role;

insert into public.billing_subscriptions(
  id,organization_id,plan,status,current_period_start,current_period_end,
  billing_source,marketplace_subscription_id,marketplace_publisher_id,
  marketplace_offer_id,marketplace_plan_id,marketplace_quantity,
  marketplace_status,marketplace_activated_at,updated_at
) values
  ('c2222222-2222-4222-8222-222222222222','c1111111-1111-4111-8111-111111111111','enterprise','active',now()-interval '1 day',now()+interval '29 days','azure_marketplace','c3333333-3333-4333-8333-333333333333','syncai-publisher','syncai-preview','enterprise-metered',10,'Subscribed',now()-interval '1 day',now()),
  ('c2222222-2222-4222-8222-222222222223','c1111111-1111-4111-8111-111111111111','enterprise','cancelled',now()-interval '2 days',now()+interval '28 days','azure_marketplace','c3333333-3333-4333-8333-333333333334','syncai-publisher','syncai-preview','enterprise-metered',10,'Unsubscribed',now()-interval '2 days',now());

insert into public.marketplace_fulfillment_resolutions(
  id,marketplace_subscription_id,publisher_id,offer_id,plan_id,subscription_name,
  quantity,beneficiary_tenant_id,purchaser_tenant_id,marketplace_status,
  internal_status,token_fingerprint,activation_secret_hash,organization_id,
  billing_subscription_id,activated_by,resolved_at,expires_at,activated_at,
  term_start,term_end
) values
  ('c4444444-4444-4444-8444-444444444444','c3333333-3333-4333-8333-333333333333','syncai-publisher','syncai-preview','enterprise-metered','Primary Preview',10,'c5555555-5555-4555-8555-555555555555','c6666666-6666-4666-8666-666666666666','Subscribed','active',repeat('a',64),repeat('b',64),'c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222','c7777777-7777-4777-8777-777777777777',now()-interval '1 day',now()+interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days'),
  ('c4444444-4444-4444-8444-444444444445','c3333333-3333-4333-8333-333333333334','syncai-publisher','syncai-preview','enterprise-metered','Terminal Preview',10,'c5555555-5555-4555-8555-555555555555','c6666666-6666-4666-8666-666666666666','Unsubscribed','unsubscribed',repeat('c',64),repeat('d',64),'c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222223','c7777777-7777-4777-8777-777777777777',now()-interval '2 days',now()+interval '1 day',now()-interval '2 days',now()-interval '2 days',now()+interval '28 days');

insert into public.marketplace_fulfillment_operations(
  marketplace_subscription_id,microsoft_operation_id,organization_id,
  billing_subscription_id,action,microsoft_status,payload_fingerprint,
  processing_state,received_at,completed_at
)
select 'c3333333-3333-4333-8333-333333333333',gen_random_uuid(),
  'c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222',
  action,'Succeeded',encode(extensions.digest(action,'sha256'),'hex'),'completed',now()-interval '1 hour',now()-interval '1 hour'
from unnest(array['ChangePlan','ChangeQuantity','Renew','Suspend','Reinstate']) action;

insert into public.marketplace_fulfillment_operations(
  marketplace_subscription_id,microsoft_operation_id,organization_id,
  billing_subscription_id,action,microsoft_status,payload_fingerprint,
  processing_state,received_at,completed_at
) values ('c3333333-3333-4333-8333-333333333334',gen_random_uuid(),
  'c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222223',
  'Unsubscribe','Succeeded',repeat('e',64),'completed',now()-interval '30 minutes',now()-interval '30 minutes');

insert into public.marketplace_hourly_metering_events(
  id,organization_id,billing_subscription_id,marketplace_subscription_id,plan_id,
  dimension,source_metric,term_start,usage_hour,source_window_end,
  source_event_count,source_max_id,source_units,included_quantity,
  prior_unreportable_quantity,prior_allocated_quantity,quantity,
  request_fingerprint,status,attempt_count,request_id,correlation_id,
  microsoft_usage_event_id,microsoft_status,submitted_at
) values ('c8888888-8888-4888-8888-888888888888','c1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222',
  'c3333333-3333-4333-8333-333333333333','enterprise-metered','tokens_1k',
  'llm_total_tokens',now()-interval '1 day',date_trunc('hour',now()-interval '1 hour'),
  date_trunc('hour',now()),10,100,12000,2,1,3,6,repeat('f',64),'accepted',1,
  gen_random_uuid(),gen_random_uuid(),'microsoft-usage-1','Accepted',now()-interval '50 minutes');

insert into public.audit_events(organization_id,entity_type,actor,event_data) values
  ('c1111111-1111-4111-8111-111111111111','azure_marketplace_subscription','c7777777-7777-4777-8777-777777777777',jsonb_build_object(
    'event','activation_requested','marketplaceSubscriptionId','c3333333-3333-4333-8333-333333333333'
  )),
  ('c1111111-1111-4111-8111-111111111111','azure_marketplace_metering','marketplace_metering_service',jsonb_build_object(
    'event','usage_emission_completed','meteringRecordId','c8888888-8888-4888-8888-888888888888',
    'marketplaceSubscriptionId','c3333333-3333-4333-8333-333333333333',
    'status','accepted','microsoftStatus','Accepted'
  ));

set local role service_role;

do $test$
declare
  v_checks jsonb;
  v_first jsonb;
  v_repeat jsonb;
begin
  select jsonb_agg(jsonb_build_object('id',id,'passed',true,'evidence','verified'))
    into v_checks from unnest(array[
      'distinct-preview-subscriptions','primary-canonical-entitlement',
      'primary-governed-activation','primary-live-lifecycle',
      'terminal-unsubscribe','microsoft-authoritative-primary',
      'accepted-canonical-meter','included-quantity-reconciliation',
      'exact-duplicate-witness','deliberate-rejection-witness',
      'canonical-audit-lineage','partner-center-usage-view'
    ]) id;
  v_first:=public.record_marketplace_preview_certification(
    'c3333333-3333-4333-8333-333333333333','c3333333-3333-4333-8333-333333333334',
    repeat('1',64),repeat('2',64),repeat('3',64),repeat('4',64),repeat('5',64),
    repeat('6',40),'123456789',now()-interval '5 minutes',v_checks
  );
  if v_first->>'recorded'<>'true' then raise exception 'certification receipt not recorded: %',v_first; end if;
  v_repeat:=public.record_marketplace_preview_certification(
    'c3333333-3333-4333-8333-333333333333','c3333333-3333-4333-8333-333333333334',
    repeat('1',64),repeat('2',64),repeat('3',64),repeat('4',64),repeat('5',64),
    repeat('6',40),'123456789',now()-interval '5 minutes',v_checks
  );
  if v_repeat->>'idempotent'<>'true' or v_repeat->>'auditEventId'<>v_first->>'auditEventId' then
    raise exception 'certification receipt is not idempotent: %',v_repeat;
  end if;
  if (select count(*) from public.audit_events where entity_type='azure_marketplace_certification')<>1 then
    raise exception 'certification created duplicate audit history';
  end if;
  if exists (
    select 1 from public.audit_events where entity_type='azure_marketplace_certification'
      and (event_data::text like '%c3333333-3333-4333-8333-333333333333%'
        or event_data::text like '%syncai-preview%')
  ) then raise exception 'raw subscription or offer identity leaked into the audit receipt'; end if;
  begin
    perform public.record_marketplace_preview_certification(
      'c3333333-3333-4333-8333-333333333333','c3333333-3333-4333-8333-333333333334',
      repeat('7',64),repeat('2',64),repeat('3',64),repeat('4',64),repeat('5',64),
      repeat('6',40),'123456790',now(),
      (select jsonb_agg(jsonb_build_object('id','fake-'||i,'passed',true,'evidence','fabricated'))
       from generate_series(1,12) i)
    );
    raise exception 'fabricated check identities were accepted';
  exception when others then
    if sqlerrm='fabricated check identities were accepted' then raise; end if;
  end;
  begin
    perform public.record_marketplace_preview_certification(
      'c3333333-3333-4333-8333-333333333333','c3333333-3333-4333-8333-333333333334',
      repeat('7',64),repeat('2',64),repeat('3',64),repeat('4',64),repeat('4',64),
      repeat('6',40),'123456790',now(),v_checks
    );
    raise exception 'self-review was accepted';
  exception when others then
    if sqlerrm='self-review was accepted' then raise; end if;
  end;
end $test$;

reset role;

do $privilege$
begin
  if has_function_privilege('authenticated','public.record_marketplace_preview_certification(text,text,text,text,text,text,text,text,text,timestamptz,jsonb)','execute') then
    raise exception 'authenticated can record Marketplace certification';
  end if;
end $privilege$;

rollback;
SQL

echo "Azure Marketplace preview certification smoke passed: canonical=true lifecycle=true unsubscribe=true accepted-meter=true two-person=true idempotent=true no-raw-ids=true audit=true"
