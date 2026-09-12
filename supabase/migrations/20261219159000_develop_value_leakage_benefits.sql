-- D9.07 / D9.15 / D13.12 — six-point value trajectory, seven-bucket
-- leakage attribution, and the case Benefits screen.
--
-- Canonical reuse:
--   * value_metrics remains the ONE value / benefit / checkpoint store;
--   * development_baselines supplies the approved BENEFITS value;
--   * evidence_items remains the ONE evidence model;
--   * verify_value_metric remains the ONE human verification loop;
--   * audit_events remains the ONE audit ledger.
--
-- No value is inferred. Sanction comes only from an approved BENEFITS
-- baseline; realized comes only from independently verified checkpoints.
-- Missing points, mixed units, value gain, over-attribution and the
-- unattributed residual are returned by name.

create or replace function public.sync_value_trajectory_points()
returns text[] language sql immutable
as $$ select array['original','design','sanction','execution_forecast','startup','realized']::text[] $$;

create or replace function public.sync_recordable_value_trajectory_points()
returns text[] language sql immutable
as $$ select array['original','design','execution_forecast','startup']::text[] $$;

create or replace function public.sync_value_leakage_buckets()
returns text[] language sql immutable
as $$ select array['scope','cost','schedule','reliability','ramp_up','operating_cost','market_assumption']::text[] $$;

revoke all on function public.sync_value_trajectory_points() from public,anon;
revoke all on function public.sync_recordable_value_trajectory_points() from public,anon;
revoke all on function public.sync_value_leakage_buckets() from public,anon;
grant execute on function public.sync_value_trajectory_points() to authenticated,service_role;
grant execute on function public.sync_recordable_value_trajectory_points() to authenticated,service_role;
grant execute on function public.sync_value_leakage_buckets() to authenticated,service_role;

alter table public.value_metrics
  add column if not exists value_lifecycle_point text,
  add column if not exists leakage_bucket text,
  add column if not exists attribution_kind text,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id) on delete restrict;

alter table public.value_metrics drop constraint if exists value_metrics_case_benefit_owner;
alter table public.value_metrics add constraint value_metrics_case_benefit_owner check (
  development_case_id is null
  or metric_type in ('project_value_trajectory','project_value_leakage_attribution')
  or (owner_id is not null and expected_date is not null
      and basis is not null and btrim(basis)<>'')
);

alter table public.value_metrics drop constraint if exists value_metrics_value_trajectory_shape;
alter table public.value_metrics add constraint value_metrics_value_trajectory_shape check (
  metric_type<>'project_value_trajectory'
  or (value_lifecycle_point=any(public.sync_recordable_value_trajectory_points())
      and leakage_bucket is null and attribution_kind is null
      and evidence_item_id is not null and recorded_by is not null
      and coalesce(length(btrim(basis)),0)>=10
      and coalesce(length(btrim(unit)),0)>0
      and value>'-Infinity'::numeric and value<'Infinity'::numeric
      and status in ('projected','verified','rejected'))
);

alter table public.value_metrics drop constraint if exists value_metrics_leakage_attribution_shape;
alter table public.value_metrics add constraint value_metrics_leakage_attribution_shape check (
  metric_type<>'project_value_leakage_attribution'
  or (value_lifecycle_point is null
      and leakage_bucket=any(public.sync_value_leakage_buckets())
      and attribution_kind in ('causal','contributing')
      and evidence_item_id is not null and recorded_by is not null
      and coalesce(length(btrim(basis)),0)>=20
      and coalesce(length(btrim(unit)),0)>0
      and value>=0 and value<'Infinity'::numeric
      and status in ('projected','verified','rejected'))
);

create index if not exists idx_value_metrics_trajectory_current
  on public.value_metrics(organization_id,development_case_id,value_lifecycle_point,created_at desc)
  where metric_type='project_value_trajectory';
create index if not exists idx_value_metrics_leakage_current
  on public.value_metrics(organization_id,development_case_id,leakage_bucket,created_at desc)
  where metric_type='project_value_leakage_attribution';

-- §70 table wall. Existing value_metrics policies are intentionally retained
-- for legacy value instrumentation; specialized rows can move only through
-- their governed recorder and the canonical verification function.
create or replace function public.enforce_value_leakage_metric_wall()
returns trigger language plpgsql set search_path=public
as $$
declare v_special boolean;
begin
  v_special := case when tg_op='DELETE'
    then old.metric_type in ('project_value_trajectory','project_value_leakage_attribution')
    else new.metric_type in ('project_value_trajectory','project_value_leakage_attribution') end;
  if not v_special then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'value trajectory and leakage evidence is append-only; reject or supersede with a new verified record';
  end if;
  if tg_op='INSERT' then
    if coalesce(current_setting('app.value_leakage_record_write',true),'')<>'granted' then
      raise exception 'value trajectory and leakage rows require the governed recorder';
    end if;
  else
    if coalesce(current_setting('app.value_leakage_verify_write',true),'')<>'granted' then
      raise exception 'value trajectory and leakage rows move only through verify_value_metric';
    end if;
    if (to_jsonb(new)-array['status','verified_by','verified_at','verification_note'])
       is distinct from
       (to_jsonb(old)-array['status','verified_by','verified_at','verification_note']) then
      raise exception 'verified value evidence is immutable; verification may change only its verification fields';
    end if;
  end if;
  if not exists(select 1 from development_cases c
    where c.id=new.development_case_id and c.organization_id=new.organization_id) then
    raise exception 'value evidence and development case must belong to the same organization';
  end if;
  if not exists(select 1 from evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id) then
    raise exception 'value evidence and evidence item must belong to the same organization';
  end if;
  return new;
end $$;

drop trigger if exists trg_value_leakage_metric_wall on public.value_metrics;
create trigger trg_value_leakage_metric_wall
before insert or update or delete on public.value_metrics
for each row execute function public.enforce_value_leakage_metric_wall();
revoke all on function public.enforce_value_leakage_metric_wall() from public,anon,authenticated;

create or replace function public.record_case_value_trajectory_point(
  p_case_id uuid,p_point text,p_value numeric,p_unit text,p_basis text,p_evidence_item_id uuid
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_id uuid;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording value trajectory evidence requires a planning, engineering or governance role');
  end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    return jsonb_build_object('error','development case not found in this organization');
  end if;
  if p_point is null or not(p_point=any(sync_recordable_value_trajectory_points())) then
    return jsonb_build_object('error','record original, design, execution_forecast or startup only; sanction and realized are derived from canonical approved/verified records');
  end if;
  if p_value is null or p_value<='-Infinity'::numeric or p_value>='Infinity'::numeric then
    return jsonb_build_object('error','trajectory value must be finite');
  end if;
  if coalesce(length(btrim(p_unit)),0)=0 or coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','trajectory evidence requires a unit and basis of at least 10 characters');
  end if;
  if p_evidence_item_id is null or not exists(select 1 from evidence_items
    where id=p_evidence_item_id and organization_id=v_org) then
    return jsonb_build_object('error','trajectory evidence is required and must belong to this organization');
  end if;
  perform set_config('app.value_leakage_record_write','granted',true);
  insert into value_metrics(organization_id,development_case_id,metric_type,label,value,unit,status,
    period,basis,value_lifecycle_point,evidence_item_id,recorded_by)
  values(v_org,p_case_id,'project_value_trajectory','Value trajectory · '||p_point,p_value,btrim(p_unit),
    'projected','lifecycle',btrim(p_basis),p_point,p_evidence_item_id,v_actor)
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'project_value_trajectory',coalesce(v_role,'unknown'),jsonb_build_object(
    'metric_id',v_id,'case_id',p_case_id,'point',p_point,'evidence_item_id',p_evidence_item_id,
    'status','projected','recommend_is_not_authorize',true));
  return jsonb_build_object('metricId',v_id,'point',p_point,'status','projected',
    'next','A different authorized human verifies or rejects this record through verify_value_metric.');
end $$;
revoke all on function public.record_case_value_trajectory_point(uuid,text,numeric,text,text,uuid) from public,anon;
grant execute on function public.record_case_value_trajectory_point(uuid,text,numeric,text,text,uuid) to authenticated;

create or replace function public.record_case_value_leakage_attribution(
  p_case_id uuid,p_bucket text,p_value numeric,p_attribution_kind text,p_basis text,p_evidence_item_id uuid
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_id uuid;
  v_unit text;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording leakage attribution requires a planning, engineering or governance role');
  end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    return jsonb_build_object('error','development case not found in this organization');
  end if;
  if p_bucket is null or not(p_bucket=any(sync_value_leakage_buckets())) then
    return jsonb_build_object('error','bucket must be scope, cost, schedule, reliability, ramp_up, operating_cost or market_assumption');
  end if;
  if p_attribution_kind not in ('causal','contributing') then
    return jsonb_build_object('error','attribution kind must be causal or contributing; unattributed is the calculated residual, never an invented allocation');
  end if;
  if p_value is null or p_value<0 or p_value>='Infinity'::numeric then
    return jsonb_build_object('error','attributed leakage must be a finite non-negative amount');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','leakage attribution requires a causal basis of at least 20 characters');
  end if;
  if p_evidence_item_id is null or not exists(select 1 from evidence_items
    where id=p_evidence_item_id and organization_id=v_org) then
    return jsonb_build_object('error','leakage attribution evidence is required and must belong to this organization');
  end if;
  select content->>'approvedExpectedUnit' into v_unit from development_baselines
   where organization_id=v_org and development_case_id=p_case_id
     and baseline_type='BENEFITS' and status='approved';
  if coalesce(length(btrim(v_unit)),0)=0 then
    return jsonb_build_object('error','an approved BENEFITS baseline with one stated unit is required before attribution');
  end if;
  perform set_config('app.value_leakage_record_write','granted',true);
  insert into value_metrics(organization_id,development_case_id,metric_type,label,value,unit,status,
    period,basis,leakage_bucket,attribution_kind,evidence_item_id,recorded_by)
  values(v_org,p_case_id,'project_value_leakage_attribution','Value leakage · '||p_bucket,p_value,v_unit,
    'projected','lifecycle',btrim(p_basis),p_bucket,p_attribution_kind,p_evidence_item_id,v_actor)
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'project_value_leakage_attribution',coalesce(v_role,'unknown'),jsonb_build_object(
    'metric_id',v_id,'case_id',p_case_id,'bucket',p_bucket,'attribution_kind',p_attribution_kind,
    'evidence_item_id',p_evidence_item_id,'status','projected'));
  return jsonb_build_object('metricId',v_id,'bucket',p_bucket,'status','projected',
    'next','A different authorized human verifies or rejects this record through verify_value_metric.');
end $$;
revoke all on function public.record_case_value_leakage_attribution(uuid,text,numeric,text,text,uuid) from public,anon;
grant execute on function public.record_case_value_leakage_attribution(uuid,text,numeric,text,text,uuid) to authenticated;

-- Grow the ONE verifier. Legacy value metrics retain their established
-- behaviour; the two evidence-sensitive types additionally require evidence,
-- a substantive note, an authorized reviewer and author/reviewer separation.
create or replace function public.verify_value_metric(
  p_metric_id uuid,p_verified boolean,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare m record; v_new_status text; v_role text; v_special boolean;
  v_approved numeric; v_realized numeric; v_unit text; v_other_attributed numeric;
begin
  select * into m from value_metrics
  where id=p_metric_id and organization_id=app_current_org();
  if m.id is null then raise exception 'Value metric not found in your organization'; end if;
  if m.status not in ('projected','baseline_pending_validation') then
    raise exception 'Only projected/baseline metrics can be verified (current: %)',m.status;
  end if;
  if m.checkpoint_horizon_days is not null and m.observed_at is null then
    raise exception 'A realization checkpoint cannot be verified until a named human records the observed actual — the design target is not the actual (recommend ≠ authorize)';
  end if;
  v_special:=m.metric_type in ('project_value_trajectory','project_value_leakage_attribution');
  if v_special then
    select role into v_role from user_profiles where id=auth.uid() and organization_id=m.organization_id;
    if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then
      raise exception 'Value trajectory and leakage verification requires an engineering or governance reviewer';
    end if;
    if m.recorded_by=auth.uid() then
      raise exception 'The value-evidence author cannot perform its independent verification';
    end if;
    if m.evidence_item_id is null or coalesce(length(btrim(p_note)),0)<20 then
      raise exception 'Value trajectory and leakage verification requires cited evidence and a note of at least 20 characters';
    end if;
    if p_verified and m.metric_type='project_value_leakage_attribution' then
      select (content->>'approvedExpectedBenefit')::numeric,content->>'approvedExpectedUnit'
        into v_approved,v_unit from development_baselines where organization_id=m.organization_id
        and development_case_id=m.development_case_id and baseline_type='BENEFITS' and status='approved';
      if v_approved is null or coalesce(length(btrim(v_unit)),0)=0 then
        raise exception 'Leakage attribution cannot be verified without an approved single-unit BENEFITS baseline';
      end if;
      with benefits as (
        select id from value_metrics where organization_id=m.organization_id
          and development_case_id=m.development_case_id and owner_id is not null
          and checkpoint_horizon_days is null and metric_type='projected_annualized_value'
      ), actuals as (
        select distinct on (x.parent_metric_id) x.parent_metric_id,x.observed_value
        from value_metrics x join benefits b on b.id=x.parent_metric_id
        where x.status='verified' and x.observed_value is not null and btrim(x.unit)=btrim(v_unit)
        order by x.parent_metric_id,x.checkpoint_horizon_days desc,x.verified_at desc
      ) select coalesce(sum(observed_value),0) into v_realized from actuals;
      with latest as (
        select distinct on (leakage_bucket) leakage_bucket,value
        from value_metrics where organization_id=m.organization_id
          and development_case_id=m.development_case_id
          and metric_type='project_value_leakage_attribution' and status='verified'
          and leakage_bucket<>m.leakage_bucket
        order by leakage_bucket,verified_at desc,created_at desc
      ) select coalesce(sum(value),0) into v_other_attributed from latest;
      if v_approved-v_realized<0 or v_other_attributed+m.value>v_approved-v_realized then
        raise exception 'Verified bucket allocations cannot exceed positive approved-to-realized leakage; leave the remainder explicitly unattributed';
      end if;
    end if;
  end if;
  v_new_status:=case when p_verified then 'verified' else 'rejected' end;
  if v_special then perform set_config('app.value_leakage_verify_write','granted',true); end if;
  update value_metrics set status=v_new_status,verified_by=auth.uid(),verified_at=now(),verification_note=p_note
  where id=m.id;
  insert into learning_events(organization_id,recommendation_id,asset_id,event_type,title,detail,
    expected_value,verified_value,model_confidence,development_case_id)
  values(m.organization_id,m.recommendation_id,m.asset_id,
    case when p_verified then 'work_completed' else 'false_positive' end,
    case when p_verified then 'Value verified — '||coalesce(m.label,m.metric_type)
      else 'Value rejected — '||coalesce(m.label,m.metric_type) end,
    coalesce(p_note,case when p_verified then 'Projected value confirmed by operator review.'
      else 'Projected value rejected by operator review — model feedback captured.' end),
    m.value,case when not p_verified then 0 when m.checkpoint_horizon_days is not null
      then m.observed_value else m.value end,null,m.development_case_id);
  insert into audit_events(organization_id,entity_type,actor,event_data)
  select m.organization_id,'value_metric_verification',coalesce(v_role,'member'),jsonb_build_object(
    'metric_id',m.id,'metric_type',m.metric_type,'status',v_new_status,
    'independent',case when v_special then true else null end)
  where v_special;
  return jsonb_build_object('metric_id',m.id,'status',v_new_status,
    'value',case when m.checkpoint_horizon_days is not null then m.observed_value else m.value end,
    'verified_at',now());
end $$;
revoke execute on function public.verify_value_metric(uuid,boolean,text) from public,anon;
grant execute on function public.verify_value_metric(uuid,boolean,text) to authenticated;

create or replace function public.get_case_value_leakage(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare v_org uuid:=app_current_org(); c development_cases%rowtype; b development_baselines%rowtype;
  v_unit text; v_approved numeric; v_realized numeric; v_leakage numeric;
  v_original numeric; v_attributed numeric; v_pending int; v_missing_actual int;
  v_points jsonb; v_missing jsonb; v_attr jsonb; v_pending_rows jsonb;
  v_residual numeric; v_valid boolean;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into c from development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  select * into b from development_baselines where organization_id=v_org
    and development_case_id=c.id and baseline_type='BENEFITS' and status='approved';
  if not found or not(b.content?'approvedExpectedBenefit')
     or b.content->>'approvedExpectedBenefit' is null then
    return jsonb_build_object('caseId',c.id,'leakageEvaluable',false,
      'reason','No approved BENEFITS baseline with a frozen expected value — value leakage is not calculable');
  end if;
  if coalesce((b.content->>'mixedUnits')::boolean,false) then
    return jsonb_build_object('caseId',c.id,'leakageEvaluable',false,
      'reason','Approved benefits use mixed units; SyncAI will not add unlike values or invent a common currency');
  end if;
  v_unit:=b.content->>'approvedExpectedUnit'; v_approved:=(b.content->>'approvedExpectedBenefit')::numeric;
  with benefits as (
    select id from value_metrics where organization_id=v_org and development_case_id=c.id
      and owner_id is not null and checkpoint_horizon_days is null
      and metric_type='projected_annualized_value'
  ), actuals as (
    select distinct on (v.parent_metric_id) v.parent_metric_id,v.observed_value
    from value_metrics v join benefits x on x.id=v.parent_metric_id
    where v.status='verified' and v.observed_value is not null and btrim(v.unit)=btrim(v_unit)
    order by v.parent_metric_id,v.checkpoint_horizon_days desc,v.verified_at desc
  )
  select coalesce(sum(observed_value),0),(select count(*) from benefits)-count(*)
    into v_realized,v_missing_actual from actuals;
  v_leakage:=v_approved-v_realized;
  with latest as (
    select distinct on (value_lifecycle_point) value_lifecycle_point,value,unit
    from value_metrics where organization_id=v_org and development_case_id=c.id
      and metric_type='project_value_trajectory' and status='verified'
    order by value_lifecycle_point,verified_at desc,created_at desc
  ), all_points as (
    select p.point,p.ordinality,case p.point when 'sanction' then v_approved when 'realized' then v_realized else l.value end value,
      case p.point when 'sanction' then v_unit when 'realized' then v_unit else l.unit end unit,
      case when p.point in ('sanction','realized') then 'derived' when l.value is null then 'missing'
        when btrim(l.unit)<>btrim(v_unit) then 'unit_mismatch' else 'verified' end status
    from unnest(sync_value_trajectory_points()) with ordinality p(point,ordinality)
    left join latest l on l.value_lifecycle_point=p.point
  )
  select jsonb_agg(jsonb_build_object('point',point,'value',value,'unit',unit,'status',status) order by ordinality),
    coalesce(jsonb_agg(point order by ordinality) filter(where status in ('missing','unit_mismatch')),'[]'::jsonb),
    max(value) filter(where point='original') into v_points,v_missing,v_original from all_points;
  with latest as (
    select distinct on (leakage_bucket) id,leakage_bucket,attribution_kind,value,basis,evidence_item_id,verified_at
    from value_metrics where organization_id=v_org and development_case_id=c.id
      and metric_type='project_value_leakage_attribution' and status='verified'
    order by leakage_bucket,verified_at desc,created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',leakage_bucket,
    'kind',attribution_kind,'value',value,'basis',basis,'evidenceItemId',evidence_item_id)
    order by array_position(sync_value_leakage_buckets(),leakage_bucket)),'[]'::jsonb),coalesce(sum(value),0)
    into v_attr,v_attributed from latest;
  v_residual:=v_leakage-v_attributed;
  v_valid:=v_leakage>=0 and v_attributed<=v_leakage;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',id,'metricType',metric_type,
    'label',label,'value',value,'unit',unit,'basis',basis,'point',value_lifecycle_point,
    'bucket',leakage_bucket,'kind',attribution_kind,'evidenceItemId',evidence_item_id,
    'recordedBy',recorded_by,'createdAt',created_at) order by created_at),'[]'::jsonb)
    into v_pending,v_pending_rows from value_metrics where organization_id=v_org
    and development_case_id=c.id and metric_type in ('project_value_trajectory','project_value_leakage_attribution')
    and status='projected';
  return jsonb_build_object('caseId',c.id,'leakageEvaluable',true,'unit',v_unit,
    'approvedValue',v_approved,'realizedValue',v_realized,'approvedToRealizedLeakage',v_leakage,
    'originalToRealizedChange',case when v_original is null then null else v_original-v_realized end,
    'trajectory',v_points,'trajectoryComplete',jsonb_array_length(v_missing)=0,'missingPoints',v_missing,
    'attributions',v_attr,'attributedValue',v_attributed,'unattributedResidual',v_residual,
    'attributionValid',v_valid,'missingActualBenefits',v_missing_actual,'pendingVerificationCount',v_pending,
    'pendingVerification',v_pending_rows,
    'formula','Value Leakage = Approved BENEFITS baseline − verified realized checkpoint value',
    'decisionBoundary','Attribution is an independently verified evidence statement, not proof of causation, investment approval or an automated intervention.');
end $$;
revoke all on function public.get_case_value_leakage(uuid) from public,anon;
grant execute on function public.get_case_value_leakage(uuid) to authenticated,service_role;

create or replace function public.get_case_benefits_screen(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare v_org uuid:=app_current_org(); v_rows jsonb; v_leakage jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    return jsonb_build_object('error','development case not found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'expected',b.value,
    'unit',b.unit,'expectedDate',b.expected_date,'ownerId',b.owner_id,
    'owner',coalesce(o.full_name,o.email),'basis',b.basis,
    'currentForecast',f.observed_value,'forecastStatus',case when f.id is null then 'missing' else f.status end,
    'actual',a.observed_value,'actualHorizonDays',a.checkpoint_horizon_days,
    'variance',case when a.observed_value is null then null else a.observed_value-b.value end)
    order by b.expected_date,b.label),'[]'::jsonb) into v_rows
  from value_metrics b join user_profiles o on o.id=b.owner_id and o.organization_id=v_org
  left join lateral (select x.id,x.observed_value,x.status from value_metrics x
    where x.parent_metric_id=b.id and x.observed_value is not null
    order by x.checkpoint_horizon_days desc,x.observed_at desc limit 1) f on true
  left join lateral (select x.observed_value,x.checkpoint_horizon_days from value_metrics x
    where x.parent_metric_id=b.id and x.status='verified' and x.observed_value is not null
    order by x.checkpoint_horizon_days desc,x.verified_at desc limit 1) a on true
  where b.organization_id=v_org and b.development_case_id=p_case_id
    and b.metric_type='projected_annualized_value' and b.checkpoint_horizon_days is null;
  v_leakage:=get_case_value_leakage(p_case_id);
  return jsonb_build_object('caseId',p_case_id,'benefits',v_rows,'valueLeakage',v_leakage,
    'basis','Expected is the recorded benefit; forecast is the latest observed checkpoint; actual is the latest human-verified checkpoint. Missing remains missing.');
end $$;
revoke all on function public.get_case_benefits_screen(uuid) from public,anon;
grant execute on function public.get_case_benefits_screen(uuid) to authenticated,service_role;

comment on function public.get_case_value_leakage(uuid) is
  'D9.07/D9.15: six-point trajectory plus seven-bucket attribution on canonical value_metrics. Missing and residual values stay explicit; no score, causal proof or approval.';
comment on function public.get_case_benefits_screen(uuid) is
  'D13.12: per-benefit expected / observed forecast / independently verified actual / variance, composed with value leakage.';
