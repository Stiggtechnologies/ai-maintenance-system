-- C7.14 draft vertical extension. ONE life-event/evidence/approval/calculation
-- architecture. No inferred installation identity, exposure or covariates.
-- Current numerical fits remain advisory, not PH/calibration qualification.

alter table public.component_life_events
  add column if not exists survival_overlay jsonb,
  add column if not exists survival_version integer not null default 0,
  add column if not exists survival_status text not null default 'unrecorded',
  add column if not exists survival_recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists survival_recorded_at timestamptz,
  add column if not exists survival_reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists survival_reviewed_at timestamptz,
  add column if not exists survival_approval_id uuid references public.approvals(id) on delete restrict,
  add column if not exists survival_evidence_snapshot jsonb;

alter table public.component_life_events add constraint cle_survival_overlay_shape check (coalesce((
  (survival_overlay is null and survival_version=0 and survival_status='unrecorded'
    and survival_recorded_by is null and survival_recorded_at is null
    and survival_reviewed_by is null and survival_reviewed_at is null
    and survival_approval_id is null and survival_evidence_snapshot is null)
  or
  (jsonb_typeof(survival_overlay)='object' and survival_version>0
    and survival_overlay->>'mode' in ('include','exclude')
    and survival_recorded_by is not null and survival_recorded_at is not null
    and jsonb_typeof(survival_evidence_snapshot)='object'
    and ((survival_status='pending_review' and survival_reviewed_by is null
      and survival_reviewed_at is null and survival_approval_id is null)
      or (survival_status in ('validated','rejected') and survival_reviewed_by is not null
        and survival_reviewed_by<>survival_recorded_by
        and survival_reviewed_at is not null and survival_approval_id is not null)))
),false));

create unique index cle_survival_physical_life_unique
  on public.component_life_events(organization_id,asset_id,lower(btrim(component)),
    (btrim(survival_overlay->>'lifeRef')))
  where survival_overlay->>'mode'='include';

create or replace function public.guard_survival_life_overlay()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Moves of an ungoverned legacy row must serialize BOTH populations.
  -- Deterministic order prevents cross-tenant service moves inverting locks.
  if tg_op='UPDATE' and old.organization_id is distinct from new.organization_id then
    perform pg_advisory_xact_lock(hashtextextended(x.org::text||':survival-life-population',0))
      from (values(old.organization_id),(new.organization_id)) x(org) order by x.org;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    (case when tg_op='DELETE' then old.organization_id else new.organization_id end)::text
      ||':survival-life-population',0));
  if tg_op='DELETE' then
    if old.survival_overlay is not null and pg_trigger_depth()=1 then
      raise exception 'Governed physical life evidence is retained; do not delete its canonical event';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.survival_overlay is not null and (
    new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.asset_id is distinct from old.asset_id or new.unit_number is distinct from old.unit_number
    or new.component is distinct from old.component or new.hours_at_change_out is distinct from old.hours_at_change_out
    or new.event_kind is distinct from old.event_kind or new.event_date is distinct from old.event_date
    or new.source_file is distinct from old.source_file or new.source_basis is distinct from old.source_basis
  ) then raise exception 'Physical life source facts are frozen once covariates are governed; record corrected source evidence separately'; end if;
  if coalesce(current_setting('app.survival_overlay_writer',true),'')<>'granted' and (
    (tg_op='INSERT' and (new.survival_overlay is not null or new.survival_version<>0
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
      or new.survival_evidence_snapshot is distinct from old.survival_evidence_snapshot))
  ) then raise exception 'Use the governed covariate capture and independent review RPCs'; end if;
  return new;
end $$;
create trigger trg_survival_life_overlay before insert or update or delete
  on public.component_life_events for each row execute function public.guard_survival_life_overlay();
revoke all on function public.guard_survival_life_overlay() from public,anon,authenticated,service_role;

-- One exact evidence snapshot, including source eligibility facts. Internal:
-- clients cannot choose another tenant to inspect this helper.
create or replace function public.survival_evidence_snapshot_internal(
  p_organization_id uuid,p_author_id uuid,p_asset_id uuid,p_overlay jsonb
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_ids uuid[]; v_evidence jsonb; v_eligible boolean; v_observation_scope boolean:=true;
begin
  if p_overlay->>'mode'='exclude' then
    v_ids:=array[(p_overlay->>'evidenceItemId')::uuid];
  elsif p_overlay->>'mode'='include' then
    if jsonb_typeof(p_overlay->'intervals') is distinct from 'array'
      or jsonb_array_length(p_overlay->'intervals') not between 1 and 50
      or exists(select 1 from jsonb_array_elements(p_overlay->'intervals') i
        where jsonb_typeof(i->'values') is distinct from 'array'
          or jsonb_array_length(i->'values') not between 1 and 8) then
      return jsonb_build_object('eligible',false,'error','Bounded exposure intervals and quantitative evidence references are required');
    end if;
    select array_agg(distinct (v->>'evidenceItemId')::uuid order by (v->>'evidenceItemId')::uuid)
      into v_ids from jsonb_array_elements(p_overlay->'intervals') i
      cross join lateral jsonb_array_elements(i->'values') v;
    -- A tenant-wide document or another asset's readings cannot silently
    -- become this asset's condition measurement. The exact value, unit,
    -- availability and validity remain independently reviewed overlay facts.
    select coalesce(bool_and(coalesce(e.asset_id=p_asset_id
        and e.ts=(v->>'observedAt')::timestamptz,false)),false)
      into v_observation_scope from jsonb_array_elements(p_overlay->'intervals') i
      cross join lateral jsonb_array_elements(i->'values') v
      left join public.evidence_items e on e.id=(v->>'evidenceItemId')::uuid
        and e.organization_id=p_organization_id;
  else return jsonb_build_object('eligible',false,'error','Choose include or explicitly evidenced exclude'); end if;
  if coalesce(cardinality(v_ids),0)=0 or array_position(v_ids,null) is not null then
    return jsonb_build_object('eligible',false,'error','Every covariate or exclusion requires canonical evidence');
  end if;
  select jsonb_agg(jsonb_build_object(
      'evidence',to_jsonb(e),'verifierRole',verifier.role,
      'document',case when e.document_id is null then null else jsonb_build_object(
        'id',d.id,'sourceId',d.source_id,'documentClass',d.document_class,
        'permittedClaims',c."permittedClaims",
        'securityStatus',d.security_status,'controlStatus',d.control_status,
        'revision',d.revision_label,'reviewDueAt',d.review_due_at,
        'supersededByDocumentId',d.superseded_by_document_id,
        'governedSources',coalesce((select jsonb_agg(jsonb_build_object(
          'id',s.id,'reviewState',s.review_state,'approvedBy',s.approved_by,
          'approvedAt',s.approved_at,'revision',s.revision,
          'supersededBySourceId',s.superseded_by_source_id) order by s.id)
          from public.engineering_knowledge_sources s where s.id in (
            select k.governed_source_id from public.reliability_kb_chunks k
            where k.organization_id=p_organization_id and k.source_id=d.source_id)), '[]'::jsonb)
      ) end) order by e.id),
    coalesce(bool_and(coalesce(e.id is not null and e.organization_id=p_organization_id
      and e.asset_id is not distinct from p_asset_id
      and e.verification_status='verified' and e.verified_at is not null
      and e.verified_by is not null and e.verified_by<>p_author_id
      and verifier.organization_id=p_organization_id
      and verifier.role in ('admin','executive','maintenance_manager','reliability_engineer')
      and e.evidence_class in ('MEASURED','INSPECTED','TESTED','HISTORICAL','DOCUMENTED','CALCULATED')
      and (e.document_id is null or (
        d.organization_id=p_organization_id and d.security_status in ('cleared','released')
        and d.control_status in ('unclassified','effective') and d.superseded_by_document_id is null
        and (d.review_due_at is null or d.review_due_at>now())
        and 'failure_behaviour'=any(c."permittedClaims")
        and not exists(select 1 from public.reliability_kb_chunks k
          left join public.engineering_knowledge_sources s
            on s.id=k.governed_source_id and s.organization_id=k.organization_id
          where k.organization_id=p_organization_id and k.source_id=d.source_id
            and (k.security_status not in ('cleared','released') or
              (k.governed_source_id is not null and not coalesce(
                s.review_state='approved' and s.superseded_by_source_id is null,false))))
      )),false)),false)
    into v_evidence,v_eligible
    from unnest(v_ids) ref
    left join public.evidence_items e on e.id=ref and e.organization_id=p_organization_id
    left join public.user_profiles verifier on verifier.id=e.verified_by
    left join public.kb_intake_documents d on d.id=e.document_id
    -- Consume the existing canonical standing/posture API. Do not add or
    -- redefine a claim matrix or a Reliability Engineer retrieval function.
    left join public.get_kb_corpus_posture() c on c."documentClass"=d.document_class;
  return jsonb_build_object('eligible',v_eligible and v_observation_scope,'claimPurpose','failure_behaviour',
    'evidence',coalesce(v_evidence,'[]'::jsonb));
exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then
  return jsonb_build_object('eligible',false,'error','Invalid canonical evidence reference or exposure array');
end $$;
revoke all on function public.survival_evidence_snapshot_internal(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.record_survival_covariate_overlay(
  p_event_id bigint,p_expected_version integer,p_overlay jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  e public.component_life_events%rowtype; v_snapshot jsonb; v_started timestamptz; v_terminal timestamptz;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','Named same-tenant human engineering authority required'); end if;
  if public.app_current_aal() is distinct from 'aal2' or not public.app_actor_has_verified_mfa(auth.uid()) then
    return jsonb_build_object('error','Covariate capture requires verified MFA and AAL2'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':survival-life-population',0));
  select * into e from public.component_life_events where id=p_event_id and organization_id=v_org for update;
  if not found or e.survival_version<>p_expected_version or p_expected_version is null then
    return jsonb_build_object('error','Canonical event is missing or its covariate version changed'); end if;
  if jsonb_typeof(p_overlay) is distinct from 'object' or octet_length(p_overlay::text)>65536
    or length(btrim(coalesce(p_overlay->>'basis',''))) not between 20 and 4000
    or coalesce(p_overlay->>'mode','') not in ('include','exclude') then
    return jsonb_build_object('error','Bounded explicitly included or excluded evidence and review basis required'); end if;
  if p_overlay->>'mode'='include' then
    v_started:=(p_overlay->>'serviceStartedAt')::timestamptz;
    v_terminal:=(p_overlay->>'terminalObservedAt')::timestamptz;
    if e.asset_id is null or e.hours_at_change_out<=0 or e.event_kind not in ('failure','scheduled')
      or length(btrim(coalesce(p_overlay->>'lifeRef',''))) not between 2 and 160
      or length(btrim(coalesce(p_overlay->>'stratum',''))) not between 1 and 160
      or v_started is null or v_terminal is null or v_started>=v_terminal or v_terminal>now()
      or e.event_date is null or left(p_overlay->>'terminalObservedAt',10)<>e.event_date::text
      or jsonb_typeof(p_overlay->'entryHours') is distinct from 'number'
      or (p_overlay->>'entryHours')::numeric<0
      or (p_overlay->>'entryHours')::numeric>=e.hours_at_change_out then
      return jsonb_build_object('error','Actual asset, component life identity, service dates and exposure classification required'); end if;
  end if;
  v_snapshot:=public.survival_evidence_snapshot_internal(v_org,auth.uid(),e.asset_id,p_overlay);
  if not coalesce((v_snapshot->>'eligible')::boolean,false) then
    return jsonb_build_object('error','Same-tenant independently verified, current and claim-eligible sources required'); end if;
  perform set_config('app.survival_overlay_writer','granted',true);
  update public.component_life_events set survival_overlay=p_overlay,
    survival_version=e.survival_version+1,survival_status='pending_review',
    survival_recorded_by=auth.uid(),survival_recorded_at=now(),
    survival_reviewed_by=null,survival_reviewed_at=null,survival_approval_id=null,
    survival_evidence_snapshot=v_snapshot where id=e.id;
  perform set_config('app.survival_overlay_writer','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
    values(v_org,'survival_covariate_overlay',v_role,
      jsonb_build_object('eventId',e.id,'version',e.survival_version+1,'operationalAuthorization',false),
      jsonb_build_object('overlay',e.survival_overlay,'version',e.survival_version,
        'sourceEvidence',e.survival_evidence_snapshot,'approvalId',e.survival_approval_id),
      jsonb_build_object('overlay',p_overlay,'version',e.survival_version+1,'sourceEvidence',v_snapshot));
  return jsonb_build_object('eventId',e.id,'version',e.survival_version+1,
    'status','pending_review','operationalAuthorization',false);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('error','Invalid actual service date, exposure or evidence reference');
when unique_violation then
  return jsonb_build_object('error','That physical component life already belongs to another canonical event');
end $$;
revoke all on function public.record_survival_covariate_overlay(bigint,integer,jsonb) from public,anon,service_role;
grant execute on function public.record_survival_covariate_overlay(bigint,integer,jsonb) to authenticated;

create or replace function public.review_survival_covariate_overlay(
  p_event_id bigint,p_expected_version integer,p_decision text,p_basis text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  e public.component_life_events%rowtype; v_current jsonb; v_approval uuid;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','Independent named same-tenant human engineering reviewer required'); end if;
  if public.app_current_aal() is distinct from 'aal2' or not public.app_actor_has_verified_mfa(auth.uid()) then
    return jsonb_build_object('error','Covariate review requires verified MFA and AAL2'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':survival-life-population',0));
  if p_decision is null or p_decision not in ('validated','rejected')
    or length(btrim(coalesce(p_basis,''))) not between 20 and 4000 then
    return jsonb_build_object('error','State validated/rejected and an independent review basis'); end if;
  select * into e from public.component_life_events where id=p_event_id and organization_id=v_org for update;
  if not found or e.survival_version<>p_expected_version or p_expected_version is null
    or e.survival_status<>'pending_review' or e.survival_recorded_by=auth.uid() then
    return jsonb_build_object('error','Exact pending overlay requires a reviewer other than its author'); end if;
  v_current:=public.survival_evidence_snapshot_internal(v_org,e.survival_recorded_by,e.asset_id,e.survival_overlay);
  if v_current is distinct from e.survival_evidence_snapshot or not coalesce((v_current->>'eligible')::boolean,false) then
    return jsonb_build_object('error','Source evidence changed, expired, was quarantined or superseded; resubmit the exact basis'); end if;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,approver_user_id,approval_scope)
  values(v_org,case when p_decision='validated' then 'approved' else 'rejected' end,
    v_role,v_role,btrim(p_basis),'Biased exposure or leaked outcomes can misstate failure risk.',
    'Independently verify actual installation identity, censoring, exposure coverage, measurement units, availability and validity against the exact evidence.',
    now(),auth.uid(),jsonb_build_object('kind','survival_covariate_overlay','eventId',e.id,
      'version',e.survival_version,'overlay',e.survival_overlay,'sourceEvidence',v_current,
      'operationalAuthorization',false)) returning id into v_approval;
  perform set_config('app.survival_overlay_writer','granted',true);
  update public.component_life_events set survival_status=p_decision,
    survival_reviewed_by=auth.uid(),survival_reviewed_at=now(),survival_approval_id=v_approval where id=e.id;
  perform set_config('app.survival_overlay_writer','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'survival_covariate_review',v_role,jsonb_build_object('eventId',e.id,
      'version',e.survival_version,'decision',p_decision,'approvalId',v_approval,'operationalAuthorization',false));
  return jsonb_build_object('eventId',e.id,'version',e.survival_version,
    'status',p_decision,'approvalId',v_approval,'operationalAuthorization',false);
end $$;
revoke all on function public.review_survival_covariate_overlay(bigint,integer,text,text) from public,anon,service_role;
grant execute on function public.review_survival_covariate_overlay(bigint,integer,text,text) to authenticated;

-- Retain the whole component population, including unclassified rows and
-- exclusions. No WHERE clause may silently discard missing/invalid inputs.
create or replace function public.get_survival_source_internal(
  p_organization_id uuid,p_actor_id uuid,p_component text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_rows jsonb; v_agent uuid; v_control jsonb;
begin
  if not exists(select 1 from public.user_profiles p where p.id=p_actor_id
    and p.organization_id=p_organization_id and p.role in ('admin','reliability_engineer')) then
    return jsonb_build_object('error','Named same-tenant reliability engineer or administrator required'); end if;
  if length(btrim(coalesce(p_component,''))) not between 2 and 160 then
    return jsonb_build_object('error','Bounded canonical component scope required'); end if;
  select a.id into v_agent from public.ai_agents a where a.organization_id=p_organization_id
    and a.key='reliability_engineering' order by a.created_at limit 1;
  v_control:=public.evaluate_agent_control_internal(p_organization_id,v_agent,
    'recommend_inspection_review','analyse_censored_life_data','High',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Adopted Reliability Engineer controls refuse this analysis'); end if;
  if (select count(*) from public.component_life_events e where e.organization_id=p_organization_id
      and lower(btrim(e.component))=lower(btrim(p_component)))>2000 then
    return jsonb_build_object('error','Complete component population exceeds bounded ingestion; no sampled subset is returned'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'assetId',e.asset_id,'component',e.component,'hoursAtChangeOut',e.hours_at_change_out,
    'eventKind',e.event_kind,'eventDate',e.event_date,'overlayVersion',e.survival_version,
    'overlayStatus',e.survival_status,'overlayAuthor',e.survival_recorded_by,
    'overlayReviewer',e.survival_reviewed_by,'overlay',e.survival_overlay,
    'sourceCurrent',coalesce(current_evidence.value=e.survival_evidence_snapshot
      and (current_evidence.value->>'eligible')::boolean,false),
    'approvalCurrent',coalesce(a.organization_id=p_organization_id and a.status='approved'
      and a.approver_user_id=e.survival_reviewed_by
      and a.approval_scope->>'kind'='survival_covariate_overlay'
      and a.approval_scope->>'eventId'=e.id::text
      and a.approval_scope->>'version'=e.survival_version::text
      and a.approval_scope->'overlay'=e.survival_overlay
      and a.approval_scope->'sourceEvidence'=e.survival_evidence_snapshot,false),
    'sourceEvidence',current_evidence.value,'approvalId',e.survival_approval_id
  ) order by e.id),'[]'::jsonb) into v_rows
  from public.component_life_events e
  left join public.approvals a on a.id=e.survival_approval_id
  cross join lateral (select public.survival_evidence_snapshot_internal(
    p_organization_id,e.survival_recorded_by,e.asset_id,e.survival_overlay) as value) current_evidence
  where e.organization_id=p_organization_id and lower(btrim(e.component))=lower(btrim(p_component));
  return jsonb_build_object('component',btrim(p_component),'events',v_rows,
    'agentId',v_agent,'agentControl',v_control,'kernelVersion','cox-efron/1/draft');
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

-- Preserve every existing pin rather than copying an increasingly stale map.
alter function public.sync_calculation_code_version(text) rename to sync_calculation_code_version_before_survival;
create function public.sync_calculation_code_version(p_key text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case when p_key='component_covariate_survival' then 'cox-efron/1/draft'
    else public.sync_calculation_code_version_before_survival(p_key) end;
$$;
revoke all on function public.sync_calculation_code_version(text) from public,anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated,service_role;

create or replace function public.record_survival_calculation(
  p_organization_id uuid,p_actor_id uuid,p_component text,p_source_snapshot jsonb,
  p_covariates jsonb,p_result jsonb,p_refusals jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_source jsonb; v_calculation uuid; v_run uuid; v_refs jsonb; v_control jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','Survival calculations are recorded only by the authenticated calculation service'); end if;
  -- Serialize population inserts/deletes too, not only existing-row changes.
  -- All canonical life-event writes take this lock in the trigger. Do not
  -- hold life-event row locks before the population lock (lock inversion).
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':survival-life-population',0));
  v_source:=public.get_survival_source_internal(p_organization_id,p_actor_id,p_component);
  if v_source ? 'error' then return v_source; end if;
  perform 1 from public.evidence_items ev where ev.organization_id=p_organization_id
    and ev.id in (select (x#>>'{evidence,id}')::uuid
      from jsonb_array_elements(v_source->'events') e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x)
    order by ev.id for share;
  perform 1 from public.kb_intake_documents d where d.organization_id=p_organization_id
    and d.id in (select ev.document_id from public.evidence_items ev where ev.organization_id=p_organization_id
      and ev.id in (select (x#>>'{evidence,id}')::uuid from jsonb_array_elements(v_source->'events') e
        cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x))
    order by d.id for share;
  perform 1 from public.approvals a where a.organization_id=p_organization_id
    and a.id in (select e.survival_approval_id from public.component_life_events e
      where e.organization_id=p_organization_id and lower(btrim(e.component))=lower(btrim(p_component)))
    order by a.id for share;
  perform 1 from public.agent_control_profiles p where p.organization_id=p_organization_id
    and p.agent_id=(v_source->>'agentId')::uuid order by p.id for share;
  perform 1 from public.ai_agents a where a.id=(v_source->>'agentId')::uuid for share;
  perform 1 from public.user_profiles p where p.organization_id=p_organization_id
    and (p.id=p_actor_id or p.id in (select ev.verified_by from public.evidence_items ev
      where ev.id in (select (x#>>'{evidence,id}')::uuid from jsonb_array_elements(v_source->'events') e
        cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x)))
    order by p.id for share;
  perform 1 from public.reliability_kb_chunks k where k.organization_id=p_organization_id
    and k.source_id in (select x#>>'{document,sourceId}' from jsonb_array_elements(v_source->'events') e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x)
    order by k.chunk_id for share;
  perform 1 from public.engineering_knowledge_sources s where s.organization_id=p_organization_id
    and s.id in (select k.governed_source_id from public.reliability_kb_chunks k
      where k.organization_id=p_organization_id and k.source_id in (
        select x#>>'{document,sourceId}' from jsonb_array_elements(v_source->'events') e
          cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x))
    order by s.id for share;
  v_source:=public.get_survival_source_internal(p_organization_id,p_actor_id,p_component);
  if v_source ? 'error' then return v_source; end if;
  if p_source_snapshot is distinct from v_source then
    p_result:=jsonb_build_object('status','refused','code','source_changed',
      'reason','Complete source evidence, overlay or adopted controls changed; reload before calculating',
      'kernelVersion','cox-efron/1/draft','authority','advisory_only');
    p_refusals:=jsonb_build_array(p_result->>'reason');
  end if;
  if jsonb_typeof(p_covariates) is distinct from 'array' or jsonb_array_length(p_covariates) not between 1 and 8
    or jsonb_typeof(p_refusals) is distinct from 'array'
    or jsonb_typeof(p_result) is distinct from 'object'
    or p_result->>'kernelVersion' is distinct from 'cox-efron/1/draft'
    or p_result->>'authority' is distinct from 'advisory_only'
    or coalesce(p_result->>'status','') not in ('fitted','refused')
    or (p_result->>'status'='refused' and jsonb_array_length(p_refusals)=0)
    or (p_result->>'status'='fitted' and (
      jsonb_typeof(p_result->'coefficients') is distinct from 'array'
      or jsonb_array_length(p_result->'coefficients')<>jsonb_array_length(p_covariates)
      or p_result->>'phAssumptionValidated' is distinct from 'false')) then
    return jsonb_build_object('error','Pinned advisory result/refusal shape required; browser outputs are never accepted'); end if;
  select coalesce(jsonb_agg(ref),'[]'::jsonb) into v_refs from (
    select jsonb_build_object('table','component_life_events','id',e->>'id') ref
      from jsonb_array_elements(v_source->'events') e
    union
    select jsonb_build_object('table','evidence_items','id',x#>>'{evidence,id}')
      from jsonb_array_elements(v_source->'events') e
      cross join lateral jsonb_array_elements(coalesce(e#>'{sourceEvidence,evidence}','[]'::jsonb)) x
      where x#>>'{evidence,id}' is not null
  ) q;
  v_calculation:=public.record_calculation_run(p_organization_id,p_actor_id,
    'organization',p_organization_id::text,'component_covariate_survival',
    'Cox partial likelihood with Efron ties, explicit exposure/censoring and independently reviewed covariate evidence.',
    jsonb_build_object('source',v_source,'attemptedSource',p_source_snapshot,'covariates',p_covariates),v_refs,
    case when p_result->>'status'='fitted' then p_result else null end,p_refusals);
  v_control:=v_source->'agentControl';
  perform set_config('app.reliability_agent_run_write','granted',true);
  insert into public.agent_runs(organization_id,agent_id,status,summary,confidence,started_at,completed_at,
    requested_by,component_scope,agent_control_profile_id,agent_tool_key,agent_decision_right_key,
    input_snapshot,result,retained_for_governance)
  values(p_organization_id,(v_source->>'agentId')::uuid,'completed',
    'Retained one advisory covariate survival fit or explicit refusal; predictive qualification remains unproven.',
    0,now(),now(),p_actor_id,btrim(p_component),(v_control->>'profile_id')::uuid,
    'analyse_censored_life_data','recommend_inspection_review',v_source,
    jsonb_build_object('calculationRunId',v_calculation,'result',p_result,'refusals',p_refusals,
      'may_change_pm_interval',false,'may_create_work',false,'may_accept_risk',false,'may_return_to_service',false),true)
  returning id into v_run;
  perform set_config('app.reliability_agent_run_write','',true);
  return jsonb_build_object('calculationRunId',v_calculation,'agentRunId',v_run,
    'result',p_result,'refusals',p_refusals,'advisory',true,'may_change_pm_interval',false,
    'may_create_work',false,'may_accept_risk',false,'may_return_to_service',false);
end $$;
revoke all on function public.record_survival_calculation(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_survival_calculation(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) to service_role;

notify pgrst,'reload schema';
