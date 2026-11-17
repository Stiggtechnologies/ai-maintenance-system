-- Native read-predicate regressions over CI's canonical migrated schema.
-- The preceding HTTP smoke creates/independently verifies the happy-path
-- features. Here database-owner mutations model corrupt/historical negatives
-- inside a rolled-back transaction. SQL JWT settings are NOT GoTrue login proof.
\set ON_ERROR_STOP on
begin;
create temporary table context_read_probe_guard(n integer) on commit drop;
create function pg_temp.context_read(p_site uuid,p_actor uuid) returns jsonb language plpgsql as $$
declare saved text:=current_setting('request.jwt.claims',true); result jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
  result:=public.get_sync_context_operating_picture(p_site,500,500);
  perform set_config('request.jwt.claims',coalesce(saved,''),true);
  return result;
end $$;
do $tests$
declare
  v_org uuid:='11111111-1111-1111-1111-111111111111';
  v_site uuid:='ee020000-0000-4000-8000-000000000101';
  v_other_site uuid:='ee020000-0000-4000-8000-000000000102';
  v_actor uuid; f public.geospatial_features%rowtype; c public.connectors%rowtype;
  e public.evidence_items%rowtype; v_result jsonb; v_state text;
  v_risk uuid:='ee020000-0000-4000-8000-000000000201';
  v_rec uuid:='ee020000-0000-4000-8000-000000000202';
  v_work uuid:='ee020000-0000-4000-8000-000000000203';
  v_history uuid:='ee020000-0000-4000-8000-000000000204';
  v_audit uuid:='ee020000-0000-4000-8000-000000000205';
  v_copy uuid; v_i integer;
begin
  if has_function_privilege('anon','public.get_sync_context_operating_picture(uuid,integer,integer)','EXECUTE')
    or has_function_privilege('service_role','public.get_sync_context_operating_picture(uuid,integer,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_sync_context_operating_picture(uuid,integer,integer)','EXECUTE') then
    raise exception 'operating read privileges widened or missing'; end if;
  select id into strict v_actor from public.user_profiles where email='demo@syncai.ca' and organization_id=v_org;
  select * into strict f from public.geospatial_features where organization_id=v_org and feature_key='sc02-api-a' and status='verified';
  select * into strict c from public.connectors where id=f.source_connector_id and organization_id=v_org;
  select * into strict e from public.evidence_items where id=f.evidence_item_ids[1] and organization_id=v_org;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,eligible}' is distinct from '2' or jsonb_array_length(v_result->'objects')<>2 then
    raise exception 'native baseline disagrees with independently verified HTTP fixture: %',v_result; end if;

  -- All normalized real-source states: health and rights are distinct gates.
  foreach v_state in array array['connected','live','not_connected','stale','unavailable','malformed',
      'throttled','delayed','conflicting','partial_coverage','clock_skew'] loop
    update public.connectors set context_health_state=v_state,context_checked_at=now()-interval '1 second',
      context_observed_at=now()-interval '2 seconds' where id=c.id;
    v_result:=pg_temp.context_read(v_site,v_actor);
    if v_state in ('not_connected','unavailable','malformed') then
      if v_result#>>'{coverage,objects,healthBlocked}' is distinct from '2' or jsonb_array_length(v_result->'objects')<>0
        or v_result#>>'{layers,0,availability}' is distinct from 'unavailable' or v_result#>>'{layers,0,empty}' is distinct from 'false' then
        raise exception 'unavailable health masqueraded as an empty layer: %',v_state; end if;
    elsif v_result#>>'{coverage,objects,eligible}' is distinct from '2' then
      raise exception 'eligible degraded/connected source refused: %',v_state; end if;
  end loop;
  update public.connectors set context_health_state='live',context_checked_at=now()-interval '1 second',
    context_observed_at=now()-interval '1 hour' where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{sources,0,state}' is distinct from 'stale' or v_result#>>'{sources,0,displayAsLive}' is distinct from 'false'
    or v_result#>>'{coverage,objects,eligible}' is distinct from '2' then raise exception 'read-time stale transition failed'; end if;
  update public.connectors set enabled=false where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,healthBlocked}' is distinct from '2' or v_result#>>'{sources,0,displayAsLive}' is distinct from 'false' then
    raise exception 'disabled connector emitted'; end if;
  update public.connectors set enabled=true,status='inactive' where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,healthBlocked}' is distinct from '2' or v_result#>>'{sources,0,displayAsLive}' is distinct from 'false' then
    raise exception 'inactive connector emitted'; end if;
  update public.connectors set status=c.status,context_health_state='connected',context_checked_at=now()+interval '1 hour' where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,healthBlocked}' is distinct from '2' then raise exception 'future checked time emitted'; end if;
  update public.connectors set context_checked_at=now()-interval '1 second',context_observed_at=now()+interval '1 hour' where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,healthBlocked}' is distinct from '2' then raise exception 'future observed time emitted'; end if;
  update public.connectors set context_checked_at=now()-interval '1 second',context_observed_at=now()-interval '2 seconds',
    context_rights_state='blocked',context_health_state='unavailable' where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,rightsBlocked}' is distinct from '2' or v_result#>>'{coverage,objects,healthBlocked}' is distinct from '0' then
    raise exception 'rights/health buckets overlap or rights revoked data emitted'; end if;
  update public.connectors set context_rights_state=c.context_rights_state,context_health_state=c.context_health_state,
    context_checked_at=c.context_checked_at,context_observed_at=c.context_observed_at where id=c.id;
  update public.connectors set context_rights_decided_at=now()+interval '1 hour' where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,rightsBlocked}' is distinct from '2' then raise exception 'future rights approval emitted'; end if;
  update public.connectors set context_rights_decided_at=c.context_rights_decided_at where id=c.id;

  -- The whole link, not each independently flattened subject, has one scope.
  update public.geospatial_subject_links set site_id=v_other_site where feature_id=f.id and organization_id=v_org;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,scopeConflict}' is distinct from '1' or v_result#>>'{coverage,objects,eligible}' is distinct from '1' then
    raise exception 'same-link asset/site contradiction accepted'; end if;
  v_result:=pg_temp.context_read(v_other_site,v_actor);
  if v_result#>>'{coverage,objects,scopeConflict}' is distinct from '1' or v_result#>>'{coverage,objects,eligible}' is distinct from '1' then
    raise exception 'contradictory site established membership'; end if;
  update public.geospatial_subject_links set site_id=null where feature_id=f.id and organization_id=v_org;
  -- Separate consistent relationships deliberately represent multi-site context.
  insert into public.geospatial_subject_links(organization_id,feature_id,relationship_type,site_id,basis,recorded_by)
    values(v_org,f.id,'served_by',v_other_site,'Synthetic separate consistent multi-site relationship.',f.recorded_by);
  v_result:=pg_temp.context_read(v_other_site,v_actor);
  if v_result#>>'{coverage,objects,eligible}' is distinct from '2' then raise exception 'legitimate multi-site links lost'; end if;
  delete from public.geospatial_subject_links where feature_id=f.id and organization_id=v_org and relationship_type='served_by';

  update public.geospatial_features set observed_at=verified_at+interval '1 microsecond' where id=f.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,timeBlocked}' is distinct from '1' then raise exception 'observation after verification emitted'; end if;
  update public.geospatial_features set observed_at=f.observed_at,verified_at=now()+interval '1 hour' where id=f.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,timeBlocked}' is distinct from '1' then raise exception 'future feature verification emitted'; end if;
  update public.geospatial_features set verified_at=f.verified_at where id=f.id;
  update public.evidence_items set verified_at=now()+interval '1 hour' where id=e.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,evidenceBlocked}' is distinct from '2' then raise exception 'future evidence verification emitted'; end if;
  update public.evidence_items set verified_at=e.verified_at where id=e.id;
  foreach v_state in array array['infinity','-infinity'] loop
    update public.evidence_items set ts=v_state::timestamptz where id=e.id;
    v_result:=pg_temp.context_read(v_site,v_actor);
    if v_result#>>'{coverage,objects,evidenceBlocked}' is distinct from '2' then raise exception 'nonfinite evidence observation emitted'; end if;
  end loop;
  update public.evidence_items set ts=e.verified_at+interval '1 microsecond' where id=e.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,evidenceBlocked}' is distinct from '2' then raise exception 'evidence observation after verification emitted'; end if;
  update public.evidence_items set ts=e.ts where id=e.id;
  update public.geospatial_features set missing_evidence=array_fill(repeat('x',4000),array[256]) where id=f.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,payloadBlocked}' is distinct from '1' then raise exception 'cumulative feature payload emitted'; end if;
  update public.geospatial_features set missing_evidence=f.missing_evidence where id=f.id;
  update public.geospatial_features set geometry=geometry||jsonb_build_object('extra',repeat('x',66000)) where id=f.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,payloadBlocked}' is distinct from '1' then raise exception 'oversized geometry silently emitted'; end if;
  update public.geospatial_features set geometry=f.geometry,status='superseded' where id=f.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,eligible}' is distinct from '1' or v_result#>>'{coverage,events,eligible}' is distinct from '1' then
    raise exception 'superseded geometry/event retained'; end if;
  update public.geospatial_features set status=f.status where id=f.id;

  insert into public.risks(id,organization_id,asset_id,title,information_sensitivity)
    values(v_risk,v_org,'ee020000-0000-4000-8000-000000000111','Synthetic restricted SC-02 risk','restricted');
  -- Asset and unreadable risk in ONE link must hide the entire relationship.
  update public.geospatial_subject_links set risk_id=v_risk where feature_id=f.id and organization_id=v_org;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,eligible}' is distinct from '1' or v_result::text like '%'||v_risk::text||'%' then
    raise exception 'hidden-risk multi-subject link escaped'; end if;
  update public.geospatial_subject_links set risk_id=null where feature_id=f.id and organization_id=v_org;
  -- Restricted audit sensitivity applies to the whole mixed asset/audit link.
  -- Canonical audit is append-only: insert a fresh probe per protected type.
  foreach v_state in array array['risk_analysis','risk_value_of_information','risk_treatment',
      'risk_treatment_readiness_correction'] loop
    v_audit:=gen_random_uuid();
    insert into public.audit_events(id,organization_id,entity_type,event_data)
      values(v_audit,v_org,v_state,jsonb_build_object('risk_id',v_risk));
    update public.geospatial_subject_links set audit_event_id=v_audit where feature_id=f.id and organization_id=v_org;
    v_result:=pg_temp.context_read(v_site,v_actor);
    if v_result#>>'{coverage,objects,eligible}' is distinct from '1' or v_result::text like '%'||v_audit::text||'%' then
      raise exception 'restricted risk audit escaped whole-link privacy: %',v_state; end if;
  end loop;
  v_audit:=gen_random_uuid();
  insert into public.audit_events(id,organization_id,entity_type,event_data)
    values(v_audit,v_org,'risk_analysis','{"risk_id":"malformed"}'::jsonb);
  update public.geospatial_subject_links set audit_event_id=v_audit where feature_id=f.id and organization_id=v_org;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,objects,eligible}' is distinct from '1' then raise exception 'malformed risk audit identity emitted'; end if;
  update public.geospatial_subject_links set audit_event_id=null where feature_id=f.id and organization_id=v_org;
  insert into public.recommendations(id,organization_id,asset_id,title,risk_id)
    values(v_rec,v_org,'ee020000-0000-4000-8000-000000000111','Synthetic restricted recommendation',v_risk);
  insert into public.work_orders(id,organization_id,asset_id,site_id,title,recommendation_id,source_system)
    values(v_work,v_org,'ee020000-0000-4000-8000-000000000111',v_site,'Synthetic inherited-risk work',v_rec,c.connector_key);
  insert into public.work_order_status_history(id,work_order_id,status_to,changed_at)
    values(v_history,v_work,'scheduled',now()-interval '1 second');
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,events,eligible}' is distinct from '2' or v_result::text like '%'||v_work::text||'%' then
    raise exception 'work inherited recommendation risk leaked'; end if;
  update public.work_orders set recommendation_id=null,title=repeat('x',4001) where id=v_work;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,events,eligible}' is distinct from '2' then raise exception 'oversized work title emitted'; end if;
  update public.work_orders set title='Synthetic bounded work' where id=v_work;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if v_result#>>'{coverage,events,eligible}' is distinct from '3' then raise exception 'bounded canonical work event lost'; end if;
  -- Zero/one limits preserve full eligible count but construct only returned
  -- event projections. Statement/source assertions also enforce CTE ordering.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  v_result:=public.get_sync_context_operating_picture(v_site,1,0);
  if jsonb_array_length(v_result->'events')<>0 or v_result#>>'{coverage,events,eligible}' is distinct from '3' then
    raise exception 'zero event limit changed eligibility or emitted'; end if;
  v_result:=public.get_sync_context_operating_picture(v_site,1,1);
  if jsonb_array_length(v_result->'events')<>1 or v_result#>>'{coverage,events,eligible}' is distinct from '3' then
    raise exception 'one event limit changed eligibility or overreturned'; end if;
  perform set_config('request.jwt.claims','',true);
  -- Nested rollback restores ALL synthetic copies without touching real rows.
  begin
    for v_i in 1..64 loop
      v_copy:=gen_random_uuid();
      insert into public.geospatial_features select (jsonb_populate_record(null::public.geospatial_features,
        to_jsonb(f)||jsonb_build_object('id',v_copy,'feature_key','sc02-budget-'||v_i,
          'name',repeat('x',4000),'source_reference',repeat('y',4000),'coordinate_basis',repeat('z',4000)))).*;
      insert into public.geospatial_subject_links(organization_id,feature_id,relationship_type,asset_id,basis,recorded_by)
        values(v_org,v_copy,'located_at','ee020000-0000-4000-8000-000000000111',
          'Synthetic payload budget regression, not customer or independent review proof.',f.recorded_by);
    end loop;
    v_result:=pg_temp.context_read(v_site,v_actor);
    if coalesce(v_result->>'error','') not like '%response budget%' then raise exception 'pre-allocation response budget missing'; end if;
    raise exception using errcode='ZX002',message='rollback synthetic budget fixture';
  exception when sqlstate 'ZX002' then null;
  end;
  update public.connectors set context_health_detail=repeat('x',4001) where id=c.id;
  v_result:=pg_temp.context_read(v_site,v_actor);
  if coalesce(v_result->>'error','') not like '%budget%' then raise exception 'unbounded source metadata accepted'; end if;
  raise notice 'SC-02 native operating projection probes passed: strict_clocks=true evidence_chronology=true whole_link_scope=true audit_sensitivity=true multi_site=true inherited_risk=true disjoint_exclusions=true preallocation_budget=true payload_refusals=true supersession=true';
end $tests$;
rollback;
