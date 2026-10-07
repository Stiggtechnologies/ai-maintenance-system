#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Azure Marketplace metering smoke FAILED at line $LINENO: $BASH_COMMAND"' ERR

PGPASSWORD="${PGPASSWORD:-postgres}" psql \
  -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" \
  -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" \
  -q -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.organizations(id,name,industry) values
  ('a1111111-1111-4111-8111-111111111111','Marketplace Metering Tenant','technology');

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,
  confirmation_token,recovery_token,email_change,email_change_token_new,
  email_change_token_current,phone_change,phone_change_token,reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'a7777777-7777-4777-8777-777777777777','authenticated','authenticated',
  'metering-admin@syncai.invalid',extensions.crypt('MarketplaceMetering123!',extensions.gen_salt('bf')),
  now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',
  '','','','','','','',''
);
insert into public.user_profiles(id,organization_id,email,full_name,role) values
  ('a7777777-7777-4777-8777-777777777777','a1111111-1111-4111-8111-111111111111','metering-admin@syncai.invalid','Metering Admin','admin')
on conflict(id) do update set
  organization_id=excluded.organization_id,email=excluded.email,
  full_name=excluded.full_name,role=excluded.role;

-- CI-only commercial fixture: the metering smoke must enter through the same
-- approved, margin-safe boundary as a real flat-rate Marketplace plan. The
-- values below are test data, not production pricing or allowance decisions.
set local role service_role;
do $commercial$
declare v_result jsonb;
begin
  v_result := public.configure_marketplace_meter_dimension(
    'enterprise-metered','tokens_1k',1000,1,2,true
  );
  if v_result->>'active'<>'true' then
    raise exception 'CI meter definition was not activated: %',v_result;
  end if;
  v_result := public.configure_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise-metered','flat_rate',
    'metered_overage',10,1000,100,100000,50,1000,0,2.00,0.50,
    array['gpt-4o-mini']::text[],'tokens_1k',1000,2,
    'CI-only Marketplace metering fixture'
  );
  if v_result->>'status'<>'draft'
     or coalesce((v_result->'evaluation'->>'allowed')::boolean,false) is not true then
    raise exception 'CI metered policy failed margin evaluation: %',v_result;
  end if;
  if (v_result->'evaluation'->>'providerCostMultiplier')::numeric<>2
     or (v_result->'evaluation'->>'modeledWorstCaseCadPerMillionTokens')::numeric
       <>1.70712
     or (v_result->'evaluation'->>'includedInferenceCostCad')::numeric
       <>0.00170712
     or (v_result->'evaluation'->>'overageUnitCostCad')::numeric
       <>0.00170712 then
    raise exception 'provider pricing multiplier was not applied to both base and overage cost: %',v_result;
  end if;
  v_result := public.approve_ai_commercial_plan_policy(
    'azure_marketplace','syncai-enterprise','enterprise-metered',
    'a7777777-7777-4777-8777-777777777777'
  );
  if coalesce((v_result->>'approved')::boolean,false) is not true then
    raise exception 'CI metered policy was not approved: %',v_result;
  end if;
end
$commercial$;
reset role;

insert into public.billing_subscriptions(
  id,organization_id,plan,status,current_period_start,current_period_end,
  billing_source,marketplace_subscription_id,marketplace_publisher_id,
  marketplace_offer_id,marketplace_plan_id,marketplace_quantity,
  marketplace_status,marketplace_activated_at,updated_at
) values (
  'a2222222-2222-4222-8222-222222222222',
  'a1111111-1111-4111-8111-111111111111','enterprise','active',
  '2026-09-29 12:00:00+00','2026-10-29 12:00:00+00',
  'azure_marketplace','a3333333-3333-4333-8333-333333333333',
  'syncai-publisher','syncai-enterprise','enterprise-metered',10,
  'Subscribed','2026-09-29 12:00:00+00',now()
);

do $flat_rate_allowance$
begin
  if not exists (
    select 1 from private.llm_org_quotas
    where organization_id='a1111111-1111-4111-8111-111111111111'
      and commercial_plan_id='enterprise-metered'
      and commercial_allowance_mode='metered_overage'
      and commercial_quantity=1
      and included_calls_per_period=10
      and included_tokens_per_period=1000
      and max_calls_per_period=100
      and max_tokens_per_period=100000
      and max_decisions_per_period=50
  ) then
    raise exception 'flat-rate allowance incorrectly scaled by Marketplace quantity';
  end if;
end
$flat_rate_allowance$;

insert into public.marketplace_fulfillment_resolutions(
  id,marketplace_subscription_id,publisher_id,offer_id,plan_id,
  subscription_name,quantity,beneficiary_tenant_id,purchaser_tenant_id,
  marketplace_status,internal_status,token_fingerprint,
  activation_secret_hash,organization_id,billing_subscription_id,
  activated_by,resolved_at,expires_at,activated_at,term_start,term_end
) values (
  'a4444444-4444-4444-8444-444444444444',
  'a3333333-3333-4333-8333-333333333333','syncai-publisher',
  'syncai-enterprise','enterprise-metered','Metered Enterprise',10,
  'a5555555-5555-4555-8555-555555555555',
  'a6666666-6666-4666-8666-666666666666','Subscribed','active',
  repeat('a',64),repeat('b',64),
  'a1111111-1111-4111-8111-111111111111',
  'a2222222-2222-4222-8222-222222222222',
  'a7777777-7777-4777-8777-777777777777',
  '2026-09-29 12:00:00+00','2026-09-30 12:00:00+00',
  '2026-09-29 12:00:00+00','2026-09-29 12:00:00+00',
  '2026-10-29 12:00:00+00'
);

insert into private.llm_usage(
  organization_id,fn,model,prompt_tokens,completion_tokens,reserved,created_at
) values
  ('a1111111-1111-4111-8111-111111111111','metering-smoke','test',2000,500,false,'2026-09-29 13:10:00+00'),
  ('a1111111-1111-4111-8111-111111111111','metering-smoke','test',9000,0,true,'2026-09-29 13:20:00+00');

set local role service_role;

do $test$
declare
  v_result jsonb;
  v_claim jsonb;
  v_claim_token uuid;
  v_record_id uuid;
  v_results jsonb;
begin
  v_result := public.configure_marketplace_meter_dimension(
    'enterprise-metered','tokens_1k',1000,1,2,true
  );
  if v_result->>'active'<>'true' then
    raise exception 'meter definition was not activated: %',v_result;
  end if;

  v_result := public.prepare_marketplace_metering('2026-09-29 20:05:00+00');
  if v_result->>'prepared'<>'1' then
    raise exception 'canonical aggregation did not produce one event: %',v_result;
  end if;
  v_result := public.prepare_marketplace_metering('2026-09-29 20:05:00+00');
  if v_result->>'prepared'<>'0' then
    raise exception 'preparation was not idempotent: %',v_result;
  end if;
  if not exists (
    select 1 from public.marketplace_hourly_metering_events
    where marketplace_subscription_id='a3333333-3333-4333-8333-333333333333'
      and usage_hour='2026-09-29 13:00:00+00'
      and source_event_count=1 and source_units=2500
      and included_quantity=1 and prior_unreportable_quantity=0
      and prior_allocated_quantity=0 and quantity=1.5
  ) then raise exception 'settled usage, reservation exclusion, included base or conversion is wrong'; end if;

  v_claim := public.claim_marketplace_metering_batch(99,'2026-09-29 20:05:00+00');
  if jsonb_array_length(v_claim->'events')<>1 then
    raise exception 'bounded claim is wrong: %',v_claim;
  end if;
  v_claim_token := (v_claim->>'claimToken')::uuid;
  v_record_id := (v_claim->'events'->0->>'recordId')::uuid;
  if v_claim_token is null or v_record_id is null then
    raise exception 'claim identity is incomplete: %',v_claim;
  end if;
  v_results := jsonb_build_array(jsonb_build_object(
    'recordId',v_record_id,'status','Accepted','usageEventId','accepted-smoke',
      'messageTime','2026-09-29T20:05:01Z','acceptedQuantity',1.5,
    'exactDuplicate',false,'response',jsonb_build_object('status','Accepted')
  ));
  v_result := public.complete_marketplace_metering_batch(
    v_claim_token,
    'a8888888-8888-4888-8888-888888888888',
    'a9999999-9999-4999-8999-999999999999',
    v_results
  );
  if v_result->>'completed'<>'1' or not exists (
    select 1 from public.marketplace_hourly_metering_events
    where id=v_record_id and status='accepted'
      and microsoft_usage_event_id='accepted-smoke' and microsoft_status='Accepted'
  ) then raise exception 'accepted Microsoft evidence was not retained: %',v_result; end if;
  begin
    perform public.configure_marketplace_meter_dimension(
      'enterprise-metered','tokens_1k',2000,1,2,true
    );
    raise exception 'meter conversion changed after usage existed';
  exception when others then
    if sqlerrm not like '%locked after its first usage event%' then raise; end if;
  end;
end
$test$;

reset role;
insert into private.llm_usage(
  organization_id,fn,model,prompt_tokens,completion_tokens,reserved,created_at
) values ('a1111111-1111-4111-8111-111111111111','metering-late','test',500,0,false,'2026-09-29 13:40:00+00');
set local role service_role;

do $late$
declare v_result jsonb; v_claim jsonb; v_record uuid; v_token uuid;
begin
  v_result:=public.prepare_marketplace_metering('2026-09-29 21:05:00+00');
  if v_result->>'prepared'<>'1' then raise exception 'late settled usage was lost: %',v_result; end if;
  if not exists (
    select 1 from public.marketplace_hourly_metering_events
    where usage_hour='2026-09-29 14:00:00+00' and quantity=.5
      and prior_allocated_quantity=1.5 and source_units=3000
  ) then raise exception 'late usage delta was not allocated once'; end if;
  v_claim:=public.claim_marketplace_metering_batch(25,'2026-09-29 21:05:00+00');
  v_token:=(v_claim->>'claimToken')::uuid;
  v_record:=(v_claim->'events'->0->>'recordId')::uuid;
  v_result:=public.complete_marketplace_metering_batch(
    v_token,'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','accccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'recordId',v_record,'status','Duplicate','usageEventId','duplicate-smoke',
      'messageTime','2026-09-29T21:05:01Z','acceptedQuantity',.5,
      'exactDuplicate',true,'response',jsonb_build_object('status','Duplicate')
    ))
  );
  if not exists (select 1 from public.marketplace_hourly_metering_events where id=v_record and status='duplicate') then
    raise exception 'exact duplicate was not treated as terminal success';
  end if;
end
$late$;

reset role;
insert into private.llm_usage(
  organization_id,fn,model,prompt_tokens,completion_tokens,reserved,created_at
) values ('a1111111-1111-4111-8111-111111111111','metering-conflict','test',500,0,false,'2026-09-29 14:10:00+00');
set local role service_role;

do $conflict$
declare v_result jsonb; v_claim jsonb; v_record uuid; v_token uuid;
begin
  perform public.prepare_marketplace_metering('2026-09-29 22:05:00+00');
  v_claim:=public.claim_marketplace_metering_batch(25,'2026-09-29 22:05:00+00');
  v_token:=(v_claim->>'claimToken')::uuid;
  v_record:=(v_claim->'events'->0->>'recordId')::uuid;
  v_result:=public.complete_marketplace_metering_batch(
    v_token,'addddddd-dddd-4ddd-8ddd-dddddddddddd','aeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    jsonb_build_array(jsonb_build_object(
      'recordId',v_record,'status','Duplicate','usageEventId','conflict-smoke',
      'messageTime','2026-09-29T22:05:01Z','acceptedQuantity',.5,
      'exactDuplicate',false,'response',jsonb_build_object('status','Duplicate')
    ))
  );
  if not exists (select 1 from public.marketplace_hourly_metering_events where id=v_record and status='conflict') then
    raise exception 'non-exact duplicate did not fail closed';
  end if;
end
$conflict$;

reset role;
insert into private.llm_usage(
  organization_id,fn,model,prompt_tokens,completion_tokens,reserved,created_at
) values ('a1111111-1111-4111-8111-111111111111','metering-suspend','test',500,0,false,'2026-09-29 15:10:00+00');
set local role service_role;

do $suspend$
declare v_claim jsonb;
begin
  perform public.prepare_marketplace_metering('2026-09-29 23:05:00+00');
  update public.billing_subscriptions set status='suspended',marketplace_status='Suspended'
  where id='a2222222-2222-4222-8222-222222222222';
  v_claim:=public.claim_marketplace_metering_batch(25,'2026-09-29 23:05:00+00');
  if v_claim->>'empty'<>'true' then raise exception 'suspended subscription usage was claimable: %',v_claim; end if;
end
$suspend$;

reset role;
insert into public.organizations(id,name,industry) values
  ('b1111111-1111-4111-8111-111111111111','Marketplace Baseline Tenant','technology');
insert into public.billing_subscriptions(
  id,organization_id,plan,status,current_period_start,current_period_end,
  billing_source,marketplace_subscription_id,marketplace_publisher_id,
  marketplace_offer_id,marketplace_plan_id,marketplace_quantity,
  marketplace_status,marketplace_activated_at,updated_at
) values (
  'b2222222-2222-4222-8222-222222222222',
  'b1111111-1111-4111-8111-111111111111','enterprise','active',
  '2026-09-01 00:00:00+00','2026-10-01 00:00:00+00',
  'azure_marketplace','b3333333-3333-4333-8333-333333333333',
  'syncai-publisher','syncai-enterprise','enterprise-metered',10,
  'Subscribed','2026-09-01 00:00:00+00',now()
);
insert into public.marketplace_fulfillment_resolutions(
  id,marketplace_subscription_id,publisher_id,offer_id,plan_id,
  subscription_name,quantity,beneficiary_tenant_id,purchaser_tenant_id,
  marketplace_status,internal_status,token_fingerprint,
  activation_secret_hash,organization_id,billing_subscription_id,
  activated_by,resolved_at,expires_at,activated_at,term_start,term_end
) values (
  'b4444444-4444-4444-8444-444444444444',
  'b3333333-3333-4333-8333-333333333333','syncai-publisher',
  'syncai-enterprise','enterprise-metered','Baseline Enterprise',10,
  'b5555555-5555-4555-8555-555555555555',
  'b6666666-6666-4666-8666-666666666666','Subscribed','active',
  repeat('c',64),repeat('d',64),
  'b1111111-1111-4111-8111-111111111111',
  'b2222222-2222-4222-8222-222222222222',
  'b7777777-7777-4777-8777-777777777777',
  '2026-09-01 00:00:00+00','2026-09-30 23:00:00+00',
  '2026-09-01 00:00:00+00','2026-09-01 00:00:00+00',
  '2026-10-01 00:00:00+00'
);
insert into private.llm_usage(
  organization_id,fn,model,prompt_tokens,completion_tokens,reserved,created_at
) values
  ('b1111111-1111-4111-8111-111111111111','metering-old','test',5000,0,false,'2026-09-02 12:00:00+00'),
  ('b1111111-1111-4111-8111-111111111111','metering-recent','test',500,0,false,'2026-09-29 21:10:00+00');
set local role service_role;
do $baseline$
declare v_result jsonb;
begin
  v_result:=public.prepare_marketplace_metering('2026-09-29 23:05:00+00');
  if not exists (
    select 1 from public.marketplace_hourly_metering_events
    where marketplace_subscription_id='b3333333-3333-4333-8333-333333333333'
      and usage_hour='2026-09-29 21:00:00+00'
      and prior_unreportable_quantity=4 and quantity=.5
  ) then raise exception 'usage outside the 24-hour Microsoft window was rebilled: %',v_result; end if;
  if exists (
    select 1 from public.marketplace_hourly_metering_events
    where marketplace_subscription_id='b3333333-3333-4333-8333-333333333333'
      and quantity>0.5
  ) then raise exception 'historical baseline leaked into a current usage event'; end if;
end
$baseline$;

reset role;
do $privileges$
begin
  if has_function_privilege('authenticated','public.prepare_marketplace_metering(timestamptz)','execute') then
    raise exception 'authenticated clients can prepare metering';
  end if;
  if has_table_privilege('authenticated','public.marketplace_hourly_metering_events','select') then
    raise exception 'authenticated clients can read metering evidence';
  end if;
  if has_table_privilege('service_role','public.marketplace_hourly_metering_events','delete') then
    raise exception 'service role can delete metering evidence';
  end if;
  if has_table_privilege('service_role','public.marketplace_hourly_metering_events','insert')
     or has_table_privilege('service_role','public.marketplace_hourly_metering_events','update') then
    raise exception 'service role can bypass governed metering mutation functions';
  end if;
  if (select count(*) from public.audit_events
      where organization_id='a1111111-1111-4111-8111-111111111111'
        and entity_type='azure_marketplace_metering'
        and event_data->>'event'='usage_emission_completed')<>3 then
    raise exception 'terminal metering audit cardinality is wrong';
  end if;
end
$privileges$;

rollback;
SQL

echo 'Azure Marketplace metering smoke passed: canonical-source=true reservation-excluded=true hourly-idempotent=true included-base=true 24h-baseline=true bounded-batch=true accepted=true exact-duplicate=true conflict-refusal=true suspension-lockout=true no-delete=true canonical-audit=true'
