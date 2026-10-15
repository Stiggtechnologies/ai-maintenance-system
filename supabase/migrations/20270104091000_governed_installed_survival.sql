-- C7.14: canonical installed-life evidence, independent review and census.
-- No lifecycle writer, operational authority or parallel persistence store.
alter table public.component_instances
  add column survival_overlay jsonb,
  add column survival_version integer not null default 0,
  add column survival_status text not null default 'unrecorded',
  add column survival_recorded_by uuid references auth.users(id) on delete restrict,
  add column survival_recorded_at timestamptz,
  add column survival_reviewed_by uuid references auth.users(id) on delete restrict,
  add column survival_reviewed_at timestamptz,
  add column survival_approval_id uuid references public.approvals(id) on delete restrict,
  add column survival_evidence_snapshot jsonb;
alter table public.component_instances add constraint ci_survival_overlay_shape check (coalesce((
  (survival_overlay is null and survival_version=0 and survival_status='unrecorded'
    and survival_recorded_by is null and survival_recorded_at is null
    and survival_reviewed_by is null and survival_reviewed_at is null
    and survival_approval_id is null and survival_evidence_snapshot is null)
  or (jsonb_typeof(survival_overlay)='object' and survival_version>0
    and survival_overlay->>'mode' in ('include','exclude')
    and survival_recorded_by is not null and survival_recorded_at is not null
    and jsonb_typeof(survival_evidence_snapshot)='object'
    and ((survival_status='pending_review' and survival_reviewed_by is null
      and survival_reviewed_at is null and survival_approval_id is null)
      or (survival_status in ('validated','rejected') and survival_reviewed_by is not null
        and survival_reviewed_by<>survival_recorded_by and survival_reviewed_at is not null
        and survival_approval_id is not null)))
),false));

-- Keep canonical facts and governed metadata distinct. Lifecycle removal is
-- permitted and makes the old installed snapshot stale, not a fabricated failure.
create function public.guard_survival_installed_overlay()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.organization_id is distinct from new.organization_id then
    perform pg_advisory_xact_lock(hashtextextended(x.org::text||':survival-life-population',0))
      from (values(old.organization_id),(new.organization_id)) x(org) order by x.org;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    (case when tg_op='DELETE' then old.organization_id else new.organization_id end)::text
      ||':survival-life-population',0));
  if tg_op='DELETE' then
    if old.survival_overlay is not null and pg_trigger_depth()=1 then
      raise exception 'Governed installation evidence is retained; do not delete its canonical instance';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.survival_overlay is not null and (
    new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.asset_id is distinct from old.asset_id or new.component is distinct from old.component
    or new.position is distinct from old.position or new.installed_at is distinct from old.installed_at
    or new.installed_meter_hours is distinct from old.installed_meter_hours
    or new.serial_number is distinct from old.serial_number or new.material_id is distinct from old.material_id
    or new.source_system is distinct from old.source_system or new.source_ref is distinct from old.source_ref
  ) then raise exception 'Governed installation identity and source facts are frozen; retain an evidenced correction'; end if;
  if coalesce(current_setting('app.survival_installed_writer',true),'')<>'granted'
    and ((tg_op='INSERT' and (new.survival_overlay is not null or new.survival_version<>0
      or new.survival_status<>'unrecorded' or new.survival_recorded_by is not null
      or new.survival_recorded_at is not null or new.survival_reviewed_by is not null
      or new.survival_reviewed_at is not null or new.survival_approval_id is not null
      or new.survival_evidence_snapshot is not null))
      or (tg_op='UPDATE' and (
        new.survival_overlay is distinct from old.survival_overlay
        or new.survival_version is distinct from old.survival_version
        or new.survival_status is distinct from old.survival_status
        or new.survival_recorded_by is distinct from old.survival_recorded_by
        or new.survival_recorded_at is distinct from old.survival_recorded_at
        or new.survival_reviewed_by is distinct from old.survival_reviewed_by
        or new.survival_reviewed_at is distinct from old.survival_reviewed_at
        or new.survival_approval_id is distinct from old.survival_approval_id
        or new.survival_evidence_snapshot is distinct from old.survival_evidence_snapshot))) then
    raise exception 'Use governed installed covariate capture and independent review';
  end if;
  return new;
end $$;
create trigger trg_survival_installed_overlay before insert or update or delete
  on public.component_instances for each row execute function public.guard_survival_installed_overlay();
revoke all on function public.guard_survival_installed_overlay() from public,anon,authenticated,service_role;

create function public.lock_survival_meter_population()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.organization_id is distinct from new.organization_id then
    perform pg_advisory_xact_lock(hashtextextended(x.org::text||':survival-life-population',0))
      from (values(old.organization_id),(new.organization_id)) x(org) order by x.org;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    (case when tg_op='DELETE' then old.organization_id else new.organization_id end)::text
      ||':survival-life-population',0));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_survival_meter_population before insert or update or delete
  on public.asset_meter_readings for each row execute function public.lock_survival_meter_population();
revoke all on function public.lock_survival_meter_population() from public,anon,authenticated,service_role;

create function public.survival_instance_facts_internal(p_instance public.component_instances)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select to_jsonb(p_instance)-array['survival_overlay','survival_version','survival_status',
    'survival_recorded_by','survival_recorded_at','survival_reviewed_by','survival_reviewed_at',
    'survival_approval_id','survival_evidence_snapshot'];
$$;
revoke all on function public.survival_instance_facts_internal(public.component_instances)
  from public,anon,authenticated,service_role;

-- Extend the ONE source-standing helper; legacy non-linked snapshots remain
-- byte-compatible. An explicit physical link is independently reviewed, never
-- guessed from component labels, serial numbers, dates or nearest meter values.
alter function public.survival_evidence_snapshot_internal(uuid,uuid,uuid,jsonb)
  rename to survival_evidence_snapshot_before_installed_internal;
revoke all on function public.survival_evidence_snapshot_before_installed_internal(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
create function public.survival_evidence_snapshot_internal(
  p_organization_id uuid,p_author_id uuid,p_asset_id uuid,p_overlay jsonb
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb; c public.component_instances%rowtype;
begin
  v:=public.survival_evidence_snapshot_before_installed_internal(
    p_organization_id,p_author_id,p_asset_id,p_overlay);
  if not (p_overlay ? 'componentInstanceId') then return v; end if;
  select * into c from public.component_instances where organization_id=p_organization_id
    and id=(p_overlay->>'componentInstanceId')::uuid and asset_id=p_asset_id;
  if not found or c.state<>'removed' or (p_overlay->>'mode'='include' and (
    p_overlay->>'lifeRef' is distinct from 'component_instances:'||c.id::text
    or (p_overlay->>'serviceStartedAt')::timestamptz is distinct from c.installed_at
    or (p_overlay->>'terminalObservedAt')::timestamptz is distinct from c.removed_at
    or c.installed_meter_hours is null or c.removed_meter_hours is null
    or c.removed_meter_hours<=c.installed_meter_hours)) then
    return jsonb_build_object('eligible',false,'error','Exact removed physical installation link required');
  end if;
  return v||jsonb_build_object('componentInstance',public.survival_instance_facts_internal(c));
exception when invalid_text_representation or datetime_field_overflow then
  return jsonb_build_object('eligible',false,'error','Invalid canonical installation link');
end $$;
revoke all on function public.survival_evidence_snapshot_internal(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create unique index cle_survival_instance_link_unique
  on public.component_life_events(organization_id,(survival_overlay->>'componentInstanceId'))
  where survival_overlay ? 'componentInstanceId';
alter function public.record_survival_covariate_overlay(bigint,integer,jsonb)
  rename to record_survival_covariate_before_installed;
revoke all on function public.record_survival_covariate_before_installed(bigint,integer,jsonb)
  from public,anon,authenticated,service_role;
create function public.record_survival_covariate_overlay(p_event_id bigint,p_expected_version integer,p_overlay jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); e public.component_life_events%rowtype;
  c public.component_instances%rowtype;
begin
  if auth.uid() is null or v_org is null or coalesce(public.app_current_role(),'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','Named same-tenant human engineering authority required'); end if;
  if public.app_current_aal() is distinct from 'aal2' or not public.app_actor_has_verified_mfa(auth.uid()) then
    return jsonb_build_object('error','Covariate capture requires verified MFA and AAL2'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':survival-life-population',0));
  if p_overlay ? 'componentInstanceId' then
    select * into e from public.component_life_events where organization_id=v_org and id=p_event_id;
    select * into c from public.component_instances where organization_id=v_org
      and id=(p_overlay->>'componentInstanceId')::uuid and state='removed';
    if e.id is null or c.id is null or e.asset_id is distinct from c.asset_id
      or lower(btrim(e.component))<>lower(btrim(c.component))
      or (p_overlay->>'mode'='include' and (c.installed_meter_hours is null or c.removed_meter_hours is null
        or e.hours_at_change_out is distinct from c.removed_meter_hours-c.installed_meter_hours
        or e.event_date is distinct from (c.removed_at at time zone 'UTC')::date)) then
      return jsonb_build_object('error','Removed installation must match the exact canonical asset, component and terminal exposure');
    end if;
    p_overlay:=jsonb_set(p_overlay,'{componentInstanceId}',to_jsonb(c.id::text));
  end if;
  return public.record_survival_covariate_before_installed(p_event_id,p_expected_version,p_overlay);
exception when invalid_text_representation then
  return jsonb_build_object('error','Invalid canonical installation UUID');
end $$;
revoke all on function public.record_survival_covariate_overlay(bigint,integer,jsonb) from public,anon,service_role;
grant execute on function public.record_survival_covariate_overlay(bigint,integer,jsonb) to authenticated;

create function public.survival_installed_snapshot_internal(
  p_organization_id uuid,p_author_id uuid,p_instance_id uuid,p_overlay jsonb
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.component_instances%rowtype; m public.asset_meter_readings%rowtype;
  v_condition jsonb; v_install jsonb; v_meter jsonb; v_evidence jsonb;
begin
  select * into c from public.component_instances where id=p_instance_id and organization_id=p_organization_id;
  if not found then return jsonb_build_object('eligible',false,'error','Canonical installation missing'); end if;
  if p_overlay->>'mode'='exclude' then
    return public.survival_evidence_snapshot_before_installed_internal(
      p_organization_id,p_author_id,c.asset_id,p_overlay)
      ||jsonb_build_object('componentInstance',public.survival_instance_facts_internal(c));
  end if;
  select * into m from public.asset_meter_readings where organization_id=p_organization_id
    and asset_id=c.asset_id and meter_kind='operating_hours' order by recorded_at desc,id desc limit 1;
  if c.state<>'installed' or m.id is null or m.id is distinct from (p_overlay->>'meterReadingId')::uuid
    or c.installed_meter_hours is null or m.value<=c.installed_meter_hours
    or m.value>9007199254740991 or c.installed_meter_hours>9007199254740991
    or m.recorded_at<=c.installed_at or m.recorded_at>now()
    or m.value-c.installed_meter_hours>extract(epoch from m.recorded_at-c.installed_at)/3600
    or (select count(*) from public.asset_meter_readings r where r.organization_id=p_organization_id
      and r.asset_id=c.asset_id and r.meter_kind='operating_hours' and r.recorded_at=m.recorded_at)<>1
    or (p_overlay->>'validUntil')::timestamptz is null or (p_overlay->>'validUntil')::timestamptz<=now()
    or not exists(select 1 from public.evidence_items e where e.organization_id=p_organization_id
      and e.id=(p_overlay->>'installationEvidenceItemId')::uuid and e.asset_id=c.asset_id and e.ts=c.installed_at)
    or not exists(select 1 from public.evidence_items e where e.organization_id=p_organization_id
      and e.id=(p_overlay->>'meterEvidenceItemId')::uuid and e.asset_id=c.asset_id and e.ts=m.recorded_at) then
    return jsonb_build_object('eligible',false,'error','Exact installation, latest unambiguous operating meter, evidence and explicit freshness required');
  end if;
  v_condition:=public.survival_evidence_snapshot_before_installed_internal(p_organization_id,p_author_id,c.asset_id,p_overlay);
  v_install:=public.survival_evidence_snapshot_before_installed_internal(p_organization_id,p_author_id,c.asset_id,
    jsonb_build_object('mode','exclude','evidenceItemId',p_overlay->>'installationEvidenceItemId'));
  v_meter:=public.survival_evidence_snapshot_before_installed_internal(p_organization_id,p_author_id,c.asset_id,
    jsonb_build_object('mode','exclude','evidenceItemId',p_overlay->>'meterEvidenceItemId'));
  select coalesce(jsonb_agg(x order by x#>>'{evidence,id}'),'[]'::jsonb) into v_evidence from (
    select distinct value x from jsonb_array_elements(coalesce(v_condition->'evidence','[]'::jsonb)
      ||coalesce(v_install->'evidence','[]'::jsonb)||coalesce(v_meter->'evidence','[]'::jsonb))
  ) q;
  return jsonb_build_object('eligible',coalesce((v_condition->>'eligible')::boolean,false)
      and coalesce((v_install->>'eligible')::boolean,false) and coalesce((v_meter->>'eligible')::boolean,false),
    'claimPurpose','failure_behaviour','componentInstance',public.survival_instance_facts_internal(c),
    'meter',to_jsonb(m),'evidence',v_evidence);
exception when invalid_text_representation or datetime_field_overflow or invalid_parameter_value then
  return jsonb_build_object('eligible',false,'error','Invalid bounded installation/meter/condition evidence');
end $$;
revoke all on function public.survival_installed_snapshot_internal(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.record_survival_installed_overlay(p_instance_id uuid,p_expected_version integer,p_overlay jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  c public.component_instances%rowtype; v_snapshot jsonb;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','Named same-tenant human engineering authority required'); end if;
  if public.app_current_aal() is distinct from 'aal2' or not public.app_actor_has_verified_mfa(auth.uid()) then
    return jsonb_build_object('error','Installed covariate capture requires verified MFA and AAL2'); end if;
  -- Match existing lifecycle writers: instance row FIRST, then population.
  -- Retention takes the population lock but NEVER waits for instance row locks.
  select * into c from public.component_instances where id=p_instance_id and organization_id=v_org for update;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':survival-life-population',0));
  if c.id is null or p_expected_version is null or c.survival_version<>p_expected_version then
    return jsonb_build_object('error','Canonical installation is missing or its covariate version changed'); end if;
  if jsonb_typeof(p_overlay) is distinct from 'object' or octet_length(p_overlay::text)>65536
    or length(btrim(coalesce(p_overlay->>'basis',''))) not between 20 and 4000
    or coalesce(p_overlay->>'mode','') not in ('include','exclude')
    or exists(select 1 from jsonb_object_keys(p_overlay) k where k not in (
      'mode','basis','evidenceItemId','meterReadingId','installationEvidenceItemId','meterEvidenceItemId',
      'validUntil','entryHours','stratum','intervals')) then
    return jsonb_build_object('error','Bounded explicit include/exclude basis required; canonical age and identity cannot be supplied'); end if;
  if p_overlay->>'mode'='include' and (
    jsonb_typeof(p_overlay->'entryHours') is distinct from 'number'
    or (p_overlay->>'entryHours')::numeric<0
    or length(btrim(coalesce(p_overlay->>'stratum',''))) not between 1 and 160) then
    return jsonb_build_object('error','Explicit entry exposure and stratum required'); end if;
  if p_overlay->>'mode'='include' then
    p_overlay:=jsonb_set(p_overlay,'{meterReadingId}',to_jsonb(((p_overlay->>'meterReadingId')::uuid)::text));
  end if;
  v_snapshot:=public.survival_installed_snapshot_internal(v_org,auth.uid(),c.id,p_overlay);
  if not coalesce((v_snapshot->>'eligible')::boolean,false) then
    return jsonb_build_object('error','Exact independently verified, current and claim-eligible installation/meter/condition sources required'); end if;
  perform set_config('app.survival_installed_writer','granted',true);
  update public.component_instances set survival_overlay=p_overlay,survival_version=c.survival_version+1,
    survival_status='pending_review',survival_recorded_by=auth.uid(),survival_recorded_at=now(),
    survival_reviewed_by=null,survival_reviewed_at=null,survival_approval_id=null,
    survival_evidence_snapshot=v_snapshot where id=c.id;
  perform set_config('app.survival_installed_writer','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
    values(v_org,'survival_installed_overlay',v_role,
      jsonb_build_object('componentInstanceId',c.id,'version',c.survival_version+1,'operationalAuthorization',false),
      jsonb_build_object('overlay',c.survival_overlay,'version',c.survival_version,
        'sourceEvidence',c.survival_evidence_snapshot,'approvalId',c.survival_approval_id),
      jsonb_build_object('overlay',p_overlay,'version',c.survival_version+1,'sourceEvidence',v_snapshot));
  return jsonb_build_object('componentInstanceId',c.id,'version',c.survival_version+1,
    'status','pending_review','operationalAuthorization',false);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error','Invalid actual installation exposure or evidence');
end $$;
revoke all on function public.record_survival_installed_overlay(uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.record_survival_installed_overlay(uuid,integer,jsonb) to authenticated;

create function public.review_survival_installed_overlay(p_instance_id uuid,p_expected_version integer,p_decision text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  c public.component_instances%rowtype; v_current jsonb; v_approval uuid;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','Independent named same-tenant human engineering reviewer required'); end if;
  if public.app_current_aal() is distinct from 'aal2' or not public.app_actor_has_verified_mfa(auth.uid()) then
    return jsonb_build_object('error','Installed covariate review requires verified MFA and AAL2'); end if;
  if p_decision is null or p_decision not in ('validated','rejected')
    or length(btrim(coalesce(p_basis,''))) not between 20 and 4000 then
    return jsonb_build_object('error','State validated/rejected and an independent review basis'); end if;
  select * into c from public.component_instances where id=p_instance_id and organization_id=v_org for update;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':survival-life-population',0));
  if c.id is null or p_expected_version is null or c.survival_version<>p_expected_version
    or c.survival_status<>'pending_review' or c.survival_recorded_by=auth.uid() then
    return jsonb_build_object('error','Exact pending installed overlay requires a reviewer other than its author'); end if;
  v_current:=public.survival_installed_snapshot_internal(v_org,c.survival_recorded_by,c.id,c.survival_overlay);
  if v_current is distinct from c.survival_evidence_snapshot or not coalesce((v_current->>'eligible')::boolean,false) then
    return jsonb_build_object('error','Installation, latest meter or source evidence changed, expired or lost standing; resubmit the exact basis'); end if;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,consequence_of_wrong,
    required_validation,decided_at,approver_user_id,approval_scope)
  values(v_org,case when p_decision='validated' then 'approved' else 'rejected' end,v_role,v_role,btrim(p_basis),
    'Omitted active exposure or unsupported condition can misstate failure risk.',
    'Verify the exact installation/meter, observed censoring, complete covariate coverage, source timing and explicit validity.',
    now(),auth.uid(),jsonb_build_object('kind','survival_installed_overlay','componentInstanceId',c.id,
      'version',c.survival_version,'overlay',c.survival_overlay,'sourceEvidence',v_current,
      'operationalAuthorization',false)) returning id into v_approval;
  perform set_config('app.survival_installed_writer','granted',true);
  update public.component_instances set survival_status=p_decision,survival_reviewed_by=auth.uid(),
    survival_reviewed_at=now(),survival_approval_id=v_approval where id=c.id;
  perform set_config('app.survival_installed_writer','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'survival_installed_review',v_role,jsonb_build_object('componentInstanceId',c.id,
      'version',c.survival_version,'decision',p_decision,'approvalId',v_approval,'operationalAuthorization',false));
  return jsonb_build_object('componentInstanceId',c.id,'version',c.survival_version,
    'status',p_decision,'approvalId',v_approval,'operationalAuthorization',false);
end $$;
revoke all on function public.review_survival_installed_overlay(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.review_survival_installed_overlay(uuid,integer,text,text) to authenticated;

alter function public.get_survival_source_internal(uuid,uuid,text) rename to get_survival_source_before_installed_internal;
revoke all on function public.get_survival_source_before_installed_internal(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.get_survival_source_internal(p_organization_id uuid,p_actor_id uuid,p_component text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb; v_installed jsonb; v_removed jsonb; v_gaps jsonb;
begin
  v:=public.get_survival_source_before_installed_internal(p_organization_id,p_actor_id,p_component);
  if v ? 'error' then return v; end if;
  if jsonb_array_length(v->'events')+(select count(*) from public.component_instances ci
    where ci.organization_id=p_organization_id and lower(btrim(ci.component))=lower(btrim(p_component)))>2000 then
    return jsonb_build_object('error','Complete physical-life census exceeds bounded ingestion; no sampled subset returned'); end if;
  with census as (
    select ci.*,snap.value,
      coalesce(snap.value=ci.survival_evidence_snapshot and (snap.value->>'eligible')::boolean,false) source_current,
      coalesce(a.organization_id=p_organization_id and a.status='approved'
        and a.approver_user_id=ci.survival_reviewed_by and ci.survival_reviewed_by<>ci.survival_recorded_by
        and author.organization_id=p_organization_id and reviewer.organization_id=p_organization_id
        and author.role in ('admin','reliability_engineer') and reviewer.role in ('admin','reliability_engineer')
        and a.approval_scope->>'kind'='survival_installed_overlay'
        and a.approval_scope->>'componentInstanceId'=ci.id::text
        and a.approval_scope->>'version'=ci.survival_version::text
        and a.approval_scope->'overlay'=ci.survival_overlay
        and a.approval_scope->'sourceEvidence'=ci.survival_evidence_snapshot,false) approval_current,
      (select count(*) from jsonb_array_elements(v->'events') e
        where e#>>'{overlay,componentInstanceId}'=ci.id::text
          and (e->>'sourceCurrent')::boolean and (e->>'approvalCurrent')::boolean
          and e->>'overlayStatus'='validated') linked_count,
      (select to_jsonb(m) from public.asset_meter_readings m where m.organization_id=p_organization_id
        and m.asset_id=ci.asset_id and m.meter_kind='operating_hours' order by m.recorded_at desc,m.id desc limit 1) meter
    from public.component_instances ci
    left join public.approvals a on a.id=ci.survival_approval_id
    left join public.user_profiles author on author.id=ci.survival_recorded_by
    left join public.user_profiles reviewer on reviewer.id=ci.survival_reviewed_by
    cross join lateral (select public.survival_installed_snapshot_internal(
      p_organization_id,ci.survival_recorded_by,ci.id,ci.survival_overlay) value) snap
    where ci.organization_id=p_organization_id and lower(btrim(ci.component))=lower(btrim(p_component))
  ), serialized as (
    select c.*,jsonb_build_object('id',c.id,'assetId',c.asset_id,'component',c.component,'position',c.position,
      'state',c.state,'installedAt',c.installed_at,'installedMeterHours',c.installed_meter_hours,
      'removedAt',c.removed_at,'removedMeterHours',c.removed_meter_hours,
      'currentMeter',case when c.meter is null then null else jsonb_build_object('id',c.meter->>'id',
        'assetId',c.meter->>'asset_id','kind',c.meter->>'meter_kind','value',c.meter->'value',
        'recordedAt',c.meter->>'recorded_at') end,
      'overlayVersion',c.survival_version,'overlayStatus',c.survival_status,'overlayAuthor',c.survival_recorded_by,
      'overlayReviewer',c.survival_reviewed_by,'overlay',c.survival_overlay,
      'sourceCurrent',c.source_current,'approvalCurrent',c.approval_current,
      'sourceEvidence',c.value,'approvalId',c.survival_approval_id,
      'reconciled',c.linked_count=1 or (c.source_current and c.approval_current
        and c.survival_status='validated' and c.survival_overlay->>'mode'='exclude')) row
    from census c
  ) select coalesce(jsonb_agg(ci.row order by ci.id) filter(where ci.state<>'removed'),'[]'::jsonb),
      coalesce(jsonb_agg(ci.row order by ci.id) filter(where ci.state='removed'),'[]'::jsonb),
      coalesce(jsonb_agg(to_jsonb('Removed installation '||ci.id::text||': exact independently reviewed life-event link or exclusion is missing')
        order by ci.id) filter(where ci.state='removed' and not (ci.row->>'reconciled')::boolean),'[]'::jsonb)
    into v_installed,v_removed,v_gaps from serialized ci;
  return v||jsonb_build_object('sourceVersion','survival-census/2/draft','activeInstances',v_installed,
    'removedInstances',v_removed,'populationGaps',v_gaps);
end $$;
revoke all on function public.get_survival_source_internal(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_survival_source_internal(uuid,uuid,text) to service_role;

create or replace function public.get_survival_covariate_workspace(p_component text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or public.app_current_org() is null then
    return jsonb_build_object('error','Authenticated tenant member required'); end if;
  return public.get_survival_source_internal(public.app_current_org(),auth.uid(),p_component);
end $$;
revoke all on function public.get_survival_covariate_workspace(text) from public,anon,service_role;
grant execute on function public.get_survival_covariate_workspace(text) to authenticated;

-- Retention extends the SAME immutable ledger. Do not call the old writer and
-- patch its source_refs afterward: that would violate immutable provenance.
create or replace function public.record_survival_calculation(
  p_organization_id uuid,p_actor_id uuid,p_component text,p_source_snapshot jsonb,
  p_covariates jsonb,p_result jsonb,p_refusals jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_source jsonb; v_all jsonb; v_calculation uuid; v_run uuid; v_refs jsonb; v_control jsonb;
  v_expected_subjects integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','Survival calculations are recorded only by the authenticated calculation service'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':survival-life-population',0));
  v_source:=public.get_survival_source_internal(p_organization_id,p_actor_id,p_component);
  if v_source ? 'error' then return v_source; end if;
  v_all:=(v_source->'events')||(v_source->'activeInstances')||(v_source->'removedInstances');
  -- Component and meter writers serialize on the population lock. NEVER lock
  -- their rows here: existing lifecycle writers lock a row before triggering
  -- the population lock; inverting that order would deadlock legitimate work.
  perform 1 from public.evidence_items ev where ev.organization_id=p_organization_id
    and ev.id in (select (x#>>'{evidence,id}')::uuid from jsonb_array_elements(v_all) e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x)
    order by ev.id for share;
  perform 1 from public.kb_intake_documents d where d.organization_id=p_organization_id
    and d.id in (select (x#>>'{document,id}')::uuid from jsonb_array_elements(v_all) e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x)
    order by d.id for share;
  perform 1 from public.approvals a where a.organization_id=p_organization_id
    and a.id in (select (e->>'approvalId')::uuid from jsonb_array_elements(v_all) e)
    order by a.id for share;
  perform 1 from public.agent_control_profiles p where p.organization_id=p_organization_id
    and p.agent_id=(v_source->>'agentId')::uuid order by p.id for share;
  perform 1 from public.ai_agents a where a.id=(v_source->>'agentId')::uuid for share;
  perform 1 from public.user_profiles p where p.organization_id=p_organization_id
    and (p.id=p_actor_id or p.id in (
      select (x#>>'{evidence,verified_by}')::uuid from jsonb_array_elements(v_all) e
        cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x
      union select (e->>'overlayAuthor')::uuid from jsonb_array_elements(v_all) e
      union select (e->>'overlayReviewer')::uuid from jsonb_array_elements(v_all) e))
    order by p.id for share;
  perform 1 from public.reliability_kb_chunks k where k.organization_id=p_organization_id
    and k.source_id in (select x#>>'{document,sourceId}' from jsonb_array_elements(v_all) e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x)
    order by k.chunk_id for share;
  perform 1 from public.engineering_knowledge_sources s where s.organization_id=p_organization_id
    and s.id in (select k.governed_source_id from public.reliability_kb_chunks k
      where k.organization_id=p_organization_id and k.source_id in (
        select x#>>'{document,sourceId}' from jsonb_array_elements(v_all) e
          cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x))
    order by s.id for share;
  v_source:=public.get_survival_source_internal(p_organization_id,p_actor_id,p_component);
  if v_source ? 'error' then return v_source; end if;
  v_all:=(v_source->'events')||(v_source->'activeInstances')||(v_source->'removedInstances');
  if p_source_snapshot is distinct from v_source or jsonb_array_length(v_source->'populationGaps')>0 then
    p_result:=jsonb_build_object('status','refused','code','source_changed',
      'reason','Complete physical-life census, source evidence, review or adopted controls changed or remain unreconciled; reload before calculating',
      'kernelVersion','cox-efron/1/draft','authority','advisory_only');
    p_refusals:=jsonb_build_array(p_result->>'reason');
  end if;
  select count(*) into v_expected_subjects from jsonb_array_elements(
    (v_source->'events')||(v_source->'activeInstances')) e where e#>>'{overlay,mode}'='include';
  -- Fail closed during rolling deployment: an old Edge still fitting completed
  -- events alone must not retain that subset as a full-population result.
  if p_result->>'status'='fitted' and (
    p_result->>'populationVersion' is distinct from 'survival-census/2/draft'
    or p_result->>'subjects' is distinct from v_expected_subjects::text
    or exists(select 1 from jsonb_array_elements((v_source->'events')||(v_source->'activeInstances')) e
      where e->>'sourceCurrent' is distinct from 'true' or e->>'approvalCurrent' is distinct from 'true'
        or e->>'overlayStatus' is distinct from 'validated'
        or coalesce(e#>>'{overlay,mode}','') not in ('include','exclude'))) then
    p_result:=jsonb_build_object('status','refused','code','incomplete_census',
      'reason','Pinned completed-and-installed execution with every exact reviewed source is required; no subset fit is retained',
      'kernelVersion','cox-efron/1/draft','authority','advisory_only');
    p_refusals:=jsonb_build_array(p_result->>'reason');
  end if;
  if jsonb_typeof(p_covariates) is distinct from 'array' or jsonb_array_length(p_covariates) not between 1 and 8
    or jsonb_typeof(p_refusals) is distinct from 'array' or jsonb_typeof(p_result) is distinct from 'object'
    or p_result->>'kernelVersion' is distinct from 'cox-efron/1/draft'
    or p_result->>'authority' is distinct from 'advisory_only'
    or coalesce(p_result->>'status','') not in ('fitted','refused')
    or (p_result->>'status'='refused' and jsonb_array_length(p_refusals)=0)
    or (p_result->>'status'='fitted' and (jsonb_typeof(p_result->'coefficients') is distinct from 'array'
      or jsonb_array_length(p_result->'coefficients')<>jsonb_array_length(p_covariates)
      or p_result->>'phAssumptionValidated' is distinct from 'false')) then
    return jsonb_build_object('error','Pinned advisory result/refusal shape required; browser outputs are never accepted'); end if;
  select coalesce(jsonb_agg(ref order by ref->>'table',ref->>'id'),'[]'::jsonb) into v_refs from (
    select jsonb_build_object('table','component_life_events','id',e->>'id') ref
      from jsonb_array_elements(v_source->'events') e
    union select jsonb_build_object('table','component_instances','id',e->>'id')
      from jsonb_array_elements((v_source->'activeInstances')||(v_source->'removedInstances')) e
    union select jsonb_build_object('table','asset_meter_readings','id',e#>>'{currentMeter,id}')
      from jsonb_array_elements(v_source->'activeInstances') e where e#>>'{currentMeter,id}' is not null
    union select jsonb_build_object('table','evidence_items','id',x#>>'{evidence,id}')
      from jsonb_array_elements(v_all) e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x
      where x#>>'{evidence,id}' is not null
  ) q;
  v_calculation:=public.record_calculation_run(p_organization_id,p_actor_id,
    'organization',p_organization_id::text,'component_covariate_survival',
    'Cox Efron likelihood over the complete reconciled completed and installed physical-life census; advisory only.',
    jsonb_build_object('source',v_source,'attemptedSource',p_source_snapshot,'covariates',p_covariates),v_refs,
    case when p_result->>'status'='fitted' then p_result else null end,p_refusals);
  v_control:=v_source->'agentControl';
  perform set_config('app.reliability_agent_run_write','granted',true);
  insert into public.agent_runs(organization_id,agent_id,status,summary,confidence,started_at,completed_at,
    requested_by,component_scope,agent_control_profile_id,agent_tool_key,agent_decision_right_key,
    input_snapshot,result,retained_for_governance)
  values(p_organization_id,(v_source->>'agentId')::uuid,'completed',
    'Retained one advisory mixed-life survival fit or explicit refusal; predictive qualification remains unproven.',
    0,now(),now(),p_actor_id,btrim(p_component),(v_control->>'profile_id')::uuid,
    'analyse_censored_life_data','recommend_inspection_review',v_source,
    jsonb_build_object('calculationRunId',v_calculation,'result',p_result,'refusals',p_refusals,
      'may_change_pm_interval',false,'may_create_work',false,'may_accept_risk',false,'may_return_to_service',false),true)
    returning id into v_run;
  perform set_config('app.reliability_agent_run_write','',true);
  return jsonb_build_object('calculationRunId',v_calculation,'agentRunId',v_run,'result',p_result,
    'refusals',p_refusals,'advisory',true,'may_change_pm_interval',false,'may_create_work',false,
    'may_accept_risk',false,'may_return_to_service',false);
end $$;
revoke all on function public.record_survival_calculation(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_survival_calculation(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
