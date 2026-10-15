-- Migrated-schema native probes. Pure composite values model corrupt historical
-- clocks without weakening canonical source writers or changing stored records.
\set ON_ERROR_STOP on
begin;
do $parity$
declare c public.connectors%rowtype; s record; k text; h text; r text;
  enabled_value boolean; registry text; clock_vector integer; interval_value integer;
  g timestamptz:=statement_timestamp(); expected_clock boolean; expected_rights boolean;
  expected_health boolean; expected_state text; n integer:=0;
begin
  if has_function_privilege('anon','public.get_sync_context_source_inventory()','EXECUTE')
    or has_function_privilege('service_role','public.get_sync_context_source_inventory()','EXECUTE')
    or (select prosecdef from pg_proc where oid='public.get_sync_context_source_inventory()'::regprocedure) then
    raise exception 'inventory privilege/INVOKER boundary changed'; end if;
  foreach k in array array['customer_operational','live_external','simulated_industrial'] loop
  foreach h in array array['connected','live','simulated','not_connected','stale','unavailable','malformed',
    'throttled','delayed','conflicting','partial_coverage','clock_skew'] loop
  foreach r in array array['unreviewed','not_required','demo_approved','production_approved','customer_authorized','blocked','expired'] loop
  foreach enabled_value in array array[true,false,null::boolean] loop
  foreach registry in array array['active','inactive',null::text] loop
  foreach interval_value in array array[null::integer,0,-1,15] loop
  for clock_vector in 0..9 loop
    c.context_source_class:=k; c.context_health_state:=h; c.context_rights_state:=r;
    c.enabled:=enabled_value; c.status:=registry; c.expected_interval_minutes:=interval_value;
    c.context_checked_at:=g-interval '1 second'; c.context_observed_at:=g-interval '1 minute';
    c.context_rights_decided_at:=g-interval '1 hour';
    case clock_vector
      when 1 then c.context_checked_at:=null;
      when 2 then c.context_checked_at:='infinity'::timestamptz;
      when 3 then c.context_checked_at:=g+interval '1 second';
      when 4 then c.context_observed_at:=null;
      when 5 then c.context_observed_at:='-infinity'::timestamptz;
      when 6 then c.context_observed_at:=g;
      when 7 then c.context_observed_at:=g-interval '30 minutes';
      when 8 then c.context_observed_at:=g-interval '30 minutes 1 microsecond';
      when 9 then c.context_rights_decided_at:='infinity'::timestamptz;
      else null;
    end case;
    -- Independent retained pre-extraction operating predicates.
    expected_clock:=coalesce(isfinite(c.context_checked_at) and c.context_checked_at<=g
      and (c.context_observed_at is null or (isfinite(c.context_observed_at)
        and c.context_observed_at<=c.context_checked_at and c.context_observed_at<=g))
      and (c.context_health_state not in ('live','simulated','delayed','conflicting','partial_coverage','clock_skew')
        or c.context_observed_at is not null),false);
    expected_rights:=coalesce(public.sync_context_source_rights_permit(c)
      and isfinite(c.context_rights_decided_at) and c.context_rights_decided_at<=g,false);
    expected_health:=public.sync_context_source_health_permits_emission(c)
      and coalesce(c.enabled and c.status='active',false);
    expected_state:=case when not coalesce(c.enabled and c.status='active',false) then 'unavailable'
      when not expected_clock then 'malformed'
      when c.context_health_state='live' and (c.expected_interval_minutes is null or c.expected_interval_minutes<1
        or c.context_observed_at<g-c.expected_interval_minutes*interval '2 minutes') then 'stale'
      else c.context_health_state end;
    select * into s from public.sync_context_source_read_state(c,g);
    if s.clock_ok is distinct from expected_clock or s.rights_ok is distinct from expected_rights
      or s.health_ok is distinct from expected_health or s.effective_state is distinct from expected_state then
      raise exception 'shared source classification drift: class %, health %, rights %, enabled %, registry %, interval %, clock %',
        k,h,r,enabled_value,registry,interval_value,clock_vector;
    end if;
    n:=n+1;
  end loop; end loop; end loop; end loop; end loop; end loop; end loop;
  c.enabled:=true; c.status:='active';
  select * into s from public.sync_context_source_read_state(c,'infinity'::timestamptz);
  if s.clock_ok or s.rights_ok or s.effective_state is distinct from 'malformed' then
    raise exception 'nonfinite evaluation time acquired authority'; end if;
  raise notice 'SC-02 shared source read-state parity passed: vectors=% unchanged_operating_semantics=true',n;
end $parity$;
rollback;

-- Real canonical RLS/identity path over the synthetic source registered by the
-- HTTP smoke. Role changes are isolated and rolled back, not human-auth receipts.
begin;
do $inventory$
declare actor_id uuid; source_id uuid; org_id uuid; role_name text; result jsonb; entry jsonb;
  before_rows text; after_rows text;
begin
  select c.id,c.organization_id into strict source_id,org_id from public.connectors c
    where c.connector_key='sc02-api-unused-source';
  select u.id into strict actor_id from public.user_profiles u
    where u.organization_id=org_id and u.role='admin' order by u.id limit 1;
  foreach role_name in array array['planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin'] loop
    -- Canonical privilege pin exempts only the no-human service setup, not
    -- PostgreSQL table ownership. Preserve its trigger and audit behavior.
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    update public.user_profiles set role=role_name where id=actor_id;
    if (select u.role from public.user_profiles u where u.id=actor_id) is distinct from role_name then
      raise exception 'synthetic persona setup did not persist intended role %',role_name; end if;
    perform set_config('request.jwt.claim.sub',actor_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
    select md5(jsonb_build_object('connectors',(select jsonb_agg(to_jsonb(c) order by c.id) from public.connectors c),
      'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a),
      'securityEvents',(select jsonb_agg(to_jsonb(e) order by e.id) from public.security_events e),
      'evidence',(select jsonb_agg(to_jsonb(e) order by e.id) from public.evidence_items e),
      'approvals',(select jsonb_agg(to_jsonb(a) order by a.id) from public.approvals a),
      'work',(select jsonb_agg(to_jsonb(w) order by w.id) from public.work_orders w))::text) into before_rows;
    set local role authenticated;
    if auth.uid() is distinct from actor_id or public.app_current_role() is distinct from role_name
      or public.app_current_org() is distinct from org_id then
      raise exception 'inventory witness persona identity/role/organization mismatch'; end if;
    result:=public.get_sync_context_source_inventory();
    reset role;
    if result?'error' or result->>'organizationId' is distinct from org_id::text
      or result->>'scope' is distinct from 'organization'
      or result->'complete' is distinct from 'true'::jsonb or result->'operationalAuthority' is distinct from 'false'::jsonb then
      raise exception 'canonical inventory role % refused/misscoped: %',role_name,result; end if;
    select x into strict entry from jsonb_array_elements(result->'sources') x where x->>'id'=source_id::text;
    if entry->>'reportedHealthState' is distinct from 'not_connected' or entry->>'state' is distinct from 'not_connected'
      or entry->'canEmit' is distinct from 'false'::jsonb or entry->'displayAsLive' is distinct from 'false'::jsonb
      or entry->'observedAt' is distinct from 'null'::jsonb or entry->'observationAgeSeconds' is distinct from 'null'::jsonb
      or entry->'lastSuccessfulCheckAt' is distinct from 'null'::jsonb
      or entry->'coverage'->>'state' is distinct from 'unknown' then
      raise exception 'unused disconnected source hidden or overclaimed: %',entry; end if;
    if exists(select 1 from jsonb_array_elements(result->'sources') x where x->>'organizationId' is distinct from org_id::text
      or x ?| array['config','endpoint','endpoint_hint','secrets','token','audit','geometry','actions']) then
      raise exception 'inventory exposed foreign/prohibited payload'; end if;
    if (select array_agg(c.id::text order by c.id::text) from public.connectors c
        where c.organization_id=org_id and c.context_source_class is not null) is distinct from
      (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(result->'sources') x) then
      raise exception 'inventory is not the complete classified canonical population'; end if;
    select md5(jsonb_build_object('connectors',(select jsonb_agg(to_jsonb(c) order by c.id) from public.connectors c),
      'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a),
      'securityEvents',(select jsonb_agg(to_jsonb(e) order by e.id) from public.security_events e),
      'evidence',(select jsonb_agg(to_jsonb(e) order by e.id) from public.evidence_items e),
      'approvals',(select jsonb_agg(to_jsonb(a) order by a.id) from public.approvals a),
      'work',(select jsonb_agg(to_jsonb(w) order by w.id) from public.work_orders w))::text) into after_rows;
    if before_rows is distinct from after_rows then raise exception 'inventory mutated canonical records'; end if;
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  update public.user_profiles set role='technician' where id=actor_id;
  if (select u.role from public.user_profiles u where u.id=actor_id) is distinct from 'technician' then
    raise exception 'synthetic technician persona setup did not persist'; end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.get_sync_context_source_inventory();
  reset role;
  if result is distinct from '{"error":"forbidden"}'::jsonb then raise exception 'technician inventory not refused'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  result:=public.get_sync_context_source_inventory();
  reset role;
  if result is distinct from '{"error":"forbidden"}'::jsonb then raise exception 'missing actor inventory not refused'; end if;
  raise notice 'SC-02 canonical source inventory probes passed: six_roles=true unused_not_connected=true no_foreign_payload=true read_only=true';
end $inventory$;
rollback;

-- Isolated migrated-schema negatives. Owner-only fixture edits model historical
-- telemetry and capacity; no trigger/RLS bypass, production connection, operational
-- mutation or real buyer certification is performed. Identity settings are SQL
-- policy fixtures, not substitutes for the HTTP GoTrue witnesses above.
begin;
create function pg_temp.context_inventory_read(p_actor uuid) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claim.sub',coalesce(p_actor::text,''),true);
  perform set_config('request.jwt.claims',case when p_actor is null then '{}' else
    jsonb_build_object('sub',p_actor,'role','authenticated')::text end,true);
  set local role authenticated;
  if auth.uid() is distinct from p_actor then raise exception 'inventory test identity mismatch'; end if;
  result:=public.get_sync_context_source_inventory();
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  return result;
end $$;
do $negative_inventory$
declare actor_id uuid; org_id uuid; c public.connectors%rowtype; result jsonb; entry jsonb;
  state_name text; source_count integer; bill_id uuid; clone_id uuid; expected_emit boolean;
  budget_refusal jsonb:='{"error":"source inventory exceeds response budget; organization inventory unavailable"}'::jsonb;
begin
  select * into strict c from public.connectors where connector_key='sc02-api-unused-source';
  org_id:=c.organization_id;
  select u.id into strict actor_id from public.user_profiles u
    where u.organization_id=org_id and u.role='admin' order by u.id limit 1;
  if exists(select 1 from public.user_profiles where id='ee020000-0000-4000-8000-000000000999') then
    raise exception 'missing-profile test identity unexpectedly exists'; end if;
  result:=pg_temp.context_inventory_read('ee020000-0000-4000-8000-000000000999');
  if result is distinct from '{"error":"forbidden"}'::jsonb then
    raise exception 'missing_profile_refusal failed'; end if;

  -- All stored real-source states remain visible even when unable to emit.
  foreach state_name in array array['connected','live','not_connected','stale','unavailable','malformed',
    'throttled','delayed','conflicting','partial_coverage','clock_skew'] loop
    update public.connectors set context_health_state=state_name,context_checked_at=now()-interval '1 second',
      context_observed_at=now()-interval '2 seconds' where id=c.id;
    result:=pg_temp.context_inventory_read(actor_id);
    select x into strict entry from jsonb_array_elements(result->'sources') x where x->>'id'=c.id::text;
    expected_emit:=state_name not in ('not_connected','unavailable','malformed');
    if entry->>'reportedHealthState' is distinct from state_name or entry->>'state' is distinct from state_name
      or entry->'canEmit' is distinct from to_jsonb(expected_emit)
      or entry->'lastSuccessfulCheckAt' is distinct from 'null'::jsonb then
      raise exception 'stored_health_states retention/authority failed for %: %',state_name,entry; end if;
  end loop;
  update public.connectors set enabled=false where id=c.id;
  result:=pg_temp.context_inventory_read(actor_id);
  select x into strict entry from jsonb_array_elements(result->'sources') x where x->>'id'=c.id::text;
  if entry->>'state' is distinct from 'unavailable' or entry->'canEmit' is distinct from 'false'::jsonb then
    raise exception 'disabled source disappeared or acquired emission'; end if;
  update public.connectors set enabled=true,context_checked_at='infinity',context_observed_at=null where id=c.id;
  result:=pg_temp.context_inventory_read(actor_id);
  select x into strict entry from jsonb_array_elements(result->'sources') x where x->>'id'=c.id::text;
  if entry->>'state' is distinct from 'malformed' or entry->'checkedAt' is distinct from 'null'::jsonb
    or entry->'checkAgeSeconds' is distinct from 'null'::jsonb or entry->'canEmit' is distinct from 'false'::jsonb then
    raise exception 'invalid clock was hidden or displayed as known zero age'; end if;
  update public.connectors set context_health_state='not_connected',context_checked_at=now()-interval '1 second',
    context_observed_at=null where id=c.id;

  update public.billing_subscriptions set status='inactive' where organization_id=org_id;
  insert into public.billing_subscriptions(organization_id,plan,status,billing_source,marketplace_subscription_id,marketplace_status)
    values(org_id,'enterprise_pilot','inactive','azure_marketplace','sc02-inventory-suspended','Suspended') returning id into bill_id;
  if public.app_org_has_commercial_entitlement(org_id) then
    raise exception 'canonical_commercial_suspension fixture did not revoke entitlement'; end if;
  result:=pg_temp.context_inventory_read(actor_id);
  if result is distinct from '{"error":"forbidden"}'::jsonb then
    raise exception 'canonical_commercial_suspension did not refuse inventory'; end if;
  -- Restore by the canonical entitlement model inside this rollback-only fixture.
  update public.billing_subscriptions set status='active',marketplace_status='Subscribed' where id=bill_id;
  if not public.app_org_has_commercial_entitlement(org_id) then raise exception 'commercial positive fixture failed'; end if;

  select count(*) into source_count from public.connectors where organization_id=org_id and context_source_class is not null;
  if source_count>400 then raise exception 'capacity witness requires at least 100 disposable source slots'; end if;
  insert into public.connectors(organization_id,connector_key,name,connector_type,status,enabled,expected_interval_minutes,
    context_source_class,context_source_authority,context_purpose,context_rights_state,context_rights_reference,
    context_rights_basis,context_rights_decided_by,context_rights_decided_at,context_health_state,context_checked_at)
  select org_id,'sc02-inventory-budget-'||n,'SC-02 inventory capacity fixture '||n,'gis','active',true,15,
    c.context_source_class,c.context_source_authority,c.context_purpose,c.context_rights_state,c.context_rights_reference,
    c.context_rights_basis,c.context_rights_decided_by,c.context_rights_decided_at,'not_connected',now()-interval '1 second'
  from generate_series(1,501-source_count) n;
  select id into strict clone_id from public.connectors where connector_key='sc02-inventory-budget-1';
  result:=pg_temp.context_inventory_read(actor_id);
  if result is distinct from budget_refusal then
    raise exception 'refuse_501_sources failed'; end if;
  -- Remove only this newly inserted, unlinked capacity fixture, never an
  -- existing source. The enclosing transaction rolls all fixture changes back.
  delete from public.connectors where id=clone_id;
  result:=pg_temp.context_inventory_read(actor_id);
  if result->>'organizationId' is distinct from org_id::text
    or result->>'scope' is distinct from 'organization' or result->'complete' is distinct from 'true'::jsonb
    or result->'operationalAuthority' is distinct from 'false'::jsonb
    or (result?'error') is distinct from false or jsonb_typeof(result->'sources') is distinct from 'array' then
    raise exception 'exact_500_sources envelope failed'; end if;
  if jsonb_array_length(result->'sources') is distinct from 500 or
    (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(result->'sources') x) is distinct from
    (select array_agg(s.id::text order by s.id::text) from public.connectors s
      where s.organization_id=org_id and s.context_source_class is not null) then
    raise exception 'exact_500_sources canonical population failed'; end if;
  select id into strict clone_id from public.connectors where connector_key='sc02-inventory-budget-2';
  update public.connectors set name=repeat('x',4001) where id=clone_id;
  result:=pg_temp.context_inventory_read(actor_id);
  if result is distinct from budget_refusal then raise exception 'overlong_metadata_refusal failed'; end if;
  update public.connectors set name=repeat(chr(128512),4000) where id=clone_id;
  result:=pg_temp.context_inventory_read(actor_id);
  if result->>'organizationId' is distinct from org_id::text
    or result->>'scope' is distinct from 'organization' or result->'complete' is distinct from 'true'::jsonb
    or result->'operationalAuthority' is distinct from 'false'::jsonb
    or (result?'error') is distinct from false or jsonb_typeof(result->'sources') is distinct from 'array' then
    raise exception 'Unicode metadata positive envelope failed'; end if;
  if jsonb_array_length(result->'sources') is distinct from 500 or
    (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(result->'sources') x) is distinct from
    (select array_agg(s.id::text order by s.id::text) from public.connectors s
      where s.organization_id=org_id and s.context_source_class is not null) then
    raise exception 'Unicode metadata positive population failed'; end if;
  select x into strict entry from jsonb_array_elements(result->'sources') x where x->>'id'=clone_id::text;
  if entry->>'name' is distinct from repeat(chr(128512),4000) then
    raise exception 'Unicode metadata below aggregate budget omitted or rewritten'; end if;
  update public.connectors set name=repeat('x',4000),context_purpose=repeat('x',4000),context_health_detail=repeat('x',4000)
    where organization_id=org_id and connector_key like 'sc02-inventory-budget-%';
  result:=pg_temp.context_inventory_read(actor_id);
  if result is distinct from budget_refusal then
    raise exception 'preallocation_inventory_budget failed'; end if;
  raise notice 'SC-02 canonical inventory negatives passed: missing_profile_refusal=true canonical_commercial_suspension=true stored_health_states=true exact_500_sources=true refuse_501_sources=true preallocation_inventory_budget=true overlong_metadata_refusal=true';
end $negative_inventory$;
rollback;
