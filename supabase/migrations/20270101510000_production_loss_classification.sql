-- C2.06: governed production-loss, downtime-classification and constraint data.
--
-- The operating event remains public.operating_states. Production remains in
-- public.production_records. Constraints remain in
-- public.operational_constraint_signals. This migration adds only an
-- append-only human interpretation of a canonical down-state record and a
-- tenant-bound reconciliation reader across those three sources. It never
-- writes a second downtime event or production-loss ledger, and it never uses
-- nameplate output to fill a missing demonstrated rate.

create table if not exists public.downtime_classification_reviews (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operating_state_id bigint not null references public.operating_states(id) on delete restrict,
  classification text not null check (classification in (
    'equipment_failure','planned_maintenance','process_upset',
    'upstream_constraint','downstream_constraint','utility_constraint',
    'material_constraint','workforce_constraint','quality_hold','weather',
    'regulatory','other','unknown'
  )),
  work_order_id uuid references public.work_orders(id) on delete restrict,
  constraint_signal_id uuid references public.operational_constraint_signals(id) on delete restrict,
  basis text not null check (length(btrim(basis)) >= 20),
  supersedes_id bigint references public.downtime_classification_reviews(id) on delete restrict,
  classified_by uuid not null references auth.users(id),
  classified_at timestamptz not null default now(),
  check (
    classification not in (
      'upstream_constraint','downstream_constraint','utility_constraint',
      'material_constraint','workforce_constraint','quality_hold','weather',
      'regulatory'
    ) or constraint_signal_id is not null
  )
);

create index if not exists idx_downtime_classification_reviews_event
  on public.downtime_classification_reviews(
    organization_id,operating_state_id,classified_at desc,id desc
  );
create unique index if not exists idx_downtime_classification_reviews_supersession
  on public.downtime_classification_reviews(supersedes_id)
  where supersedes_id is not null;

alter table public.downtime_classification_reviews enable row level security;
drop policy if exists downtime_classification_reviews_org_read
  on public.downtime_classification_reviews;
create policy downtime_classification_reviews_org_read
  on public.downtime_classification_reviews for select to authenticated
  using (organization_id=public.app_current_org());

revoke insert,update,delete,truncate
  on public.downtime_classification_reviews from public,anon,authenticated;
grant select on public.downtime_classification_reviews to authenticated;

create or replace function public.protect_downtime_classification_reviews()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'downtime classifications are append-only; supersede with classify_downtime_event';
end $$;

drop trigger if exists trg_protect_downtime_classification_reviews
  on public.downtime_classification_reviews;
create trigger trg_protect_downtime_classification_reviews
  before update or delete on public.downtime_classification_reviews
  for each row execute function public.protect_downtime_classification_reviews();

create or replace function public.production_loss_human_role_allowed()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.user_profiles up
    where up.id=auth.uid()
      and up.organization_id=public.app_current_org()
      and coalesce(up.role,'')<>'ai_admin'
      and up.role in (
        'operator','planner','supervisor','maintenance_manager',
        'reliability_engineer','admin'
      )
  )
$$;
revoke all on function public.production_loss_human_role_allowed()
  from public,anon;
grant execute on function public.production_loss_human_role_allowed()
  to authenticated;

create or replace function public.classify_downtime_event(
  p_operating_state_id bigint,
  p_classification text,
  p_basis text,
  p_expected_review_id bigint default null,
  p_work_order_id uuid default null,
  p_constraint_signal_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_state public.operating_states%rowtype;
  v_asset_site uuid;
  v_previous bigint;
  v_id bigint;
  v_constrained constant text[]:=array[
    'upstream_constraint','downstream_constraint','utility_constraint',
    'material_constraint','workforce_constraint','quality_hold','weather',
    'regulatory'
  ];
begin
  if v_org is null or not public.production_loss_human_role_allowed() then
    return jsonb_build_object('error',
      'classifying downtime requires a named human operations, planning, maintenance or reliability role');
  end if;
  if p_classification not in (
    'equipment_failure','planned_maintenance','process_upset',
    'upstream_constraint','downstream_constraint','utility_constraint',
    'material_constraint','workforce_constraint','quality_hold','weather',
    'regulatory','other','unknown'
  ) then
    return jsonb_build_object('error','unsupported downtime classification');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','classification basis must be at least 20 characters');
  end if;

  select * into v_state from public.operating_states
  where id=p_operating_state_id and organization_id=v_org
  for update;
  if not found then
    return jsonb_build_object('error','operating-state event is outside the active tenant');
  end if;
  if v_state.state not in ('down_planned','down_unplanned','offline') then
    return jsonb_build_object('error','only a canonical down or offline state can be classified');
  end if;
  select a.site_id into v_asset_site from public.assets a
  where a.id=v_state.asset_id and a.organization_id=v_org;

  if p_classification=any(v_constrained) and p_constraint_signal_id is null then
    return jsonb_build_object('error','a constraint signal is required for a constrained-loss classification');
  end if;
  if p_constraint_signal_id is not null and not exists(
    select 1 from public.operational_constraint_signals s
    where s.id=p_constraint_signal_id and s.organization_id=v_org
      and (s.asset_id is null or s.asset_id=v_state.asset_id)
      and (s.site_id is null or s.site_id=v_asset_site)
      and s.observed_at<=coalesce(v_state.ended_at,now())
      and s.valid_until>=v_state.started_at
  ) then
    return jsonb_build_object('error','constraint signal is outside the active tenant or does not apply to this asset');
  end if;
  if p_work_order_id is not null and not exists(
    select 1 from public.work_orders w
    where w.id=p_work_order_id and w.organization_id=v_org
      and w.asset_id=v_state.asset_id
      and w.created_at<=coalesce(v_state.ended_at,now())+interval '7 days'
      and coalesce(w.completed_at,now())>=v_state.started_at-interval '7 days'
  ) then
    return jsonb_build_object('error','work order is outside the active tenant or belongs to another asset');
  end if;

  select r.id into v_previous
  from public.downtime_classification_reviews r
  where r.organization_id=v_org and r.operating_state_id=v_state.id
  order by r.classified_at desc,r.id desc limit 1;
  if v_previous is distinct from p_expected_review_id then
    return jsonb_build_object('error',
      'downtime classification changed after it was loaded; refresh before superseding it');
  end if;

  insert into public.downtime_classification_reviews(
    organization_id,operating_state_id,classification,work_order_id,
    constraint_signal_id,basis,supersedes_id,classified_by
  ) values(
    v_org,v_state.id,p_classification,p_work_order_id,
    p_constraint_signal_id,btrim(p_basis),v_previous,auth.uid()
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'downtime_classification',public.app_current_role(),jsonb_build_object(
    'action',case when v_previous is null then 'classified' else 'superseded' end,
    'classification_review_id',v_id,'operating_state_id',v_state.id,
    'classification',p_classification,'supersedes_id',v_previous,
    'work_order_id',p_work_order_id,'constraint_signal_id',p_constraint_signal_id,
    'actor_id',auth.uid(),'production_value_authorized',false));

  return jsonb_build_object(
    'classified',true,'classificationReviewId',v_id,
    'operatingStateId',v_state.id,'classification',p_classification,
    'supersedesId',v_previous,'productionValueAuthorized',false
  );
end $$;
revoke all on function public.classify_downtime_event(bigint,text,text,bigint,uuid,uuid)
  from public,anon,service_role;
grant execute on function public.classify_downtime_event(bigint,text,text,bigint,uuid,uuid)
  to authenticated;

create or replace function public.get_production_loss_reconciliation(
  p_window_days integer default 90
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_days integer:=least(greatest(coalesce(p_window_days,90),1),730);
  v_from timestamptz;
  v_events jsonb;
  v_categories jsonb;
  v_constraints jsonb;
  v_total_events integer;
  v_total_hours numeric;
  v_classified_hours numeric;
  v_measurable integer;
  v_units numeric;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  v_from:=now()-make_interval(days=>v_days);

  with running as (
    select s.asset_id,
      sum(extract(epoch from (
        least(coalesce(s.ended_at,now()),now())-greatest(s.started_at,v_from)
      ))/3600.0) running_hours
    from public.operating_states s
    where s.organization_id=v_org and s.state='running'
      and s.started_at<now() and coalesce(s.ended_at,now())>v_from
    group by s.asset_id
  ), production as (
    select p.asset_id,sum(p.units_produced) units,min(p.unit_of_measure) uom,
      count(distinct p.unit_of_measure) unit_count
    from public.production_records p
    where p.organization_id=v_org and p.asset_id is not null
      and p.period_start>=v_from and p.period_end<=now()
    group by p.asset_id
  ), rate as (
    select p.asset_id,p.units/nullif(r.running_hours,0) demonstrated_rate,
      p.uom,p.unit_count,r.running_hours
    from production p join running r on r.asset_id=p.asset_id
    where r.running_hours>0 and p.unit_count=1
  ), latest_review as (
    select distinct on (d.operating_state_id) d.*
    from public.downtime_classification_reviews d
    where d.organization_id=v_org
    order by d.operating_state_id,d.classified_at desc,d.id desc
  ), down_events as (
    select s.id,s.asset_id,a.tag,a.name asset,s.state,s.reason_code,
      s.started_at,s.ended_at,
      extract(epoch from (
        least(coalesce(s.ended_at,now()),now())-greatest(s.started_at,v_from)
      ))/3600.0 down_hours,
      coalesce(d.classification,'unclassified') classification,d.basis,
      d.id classification_review_id,d.supersedes_id,d.classified_at,
      up.full_name classified_by_name,w.wo_number,
      d.work_order_id,
      cs.id constraint_signal_id,cs.signal_kind,cs.signal_key,
      cs.state constraint_state,cs.valid_until constraint_valid_until,
      cs.basis constraint_basis,
      rt.demonstrated_rate,rt.uom,
      case when rt.demonstrated_rate is null then 'not_measurable'
        else 'demonstrated_rate' end measurement_state,
      row_number() over(order by s.started_at desc,s.id desc) event_rank
    from public.operating_states s
    join public.assets a on a.id=s.asset_id and a.organization_id=v_org
    left join latest_review d on d.operating_state_id=s.id
    left join public.user_profiles up on up.id=d.classified_by
      and up.organization_id=v_org
    left join public.work_orders w on w.id=d.work_order_id
      and w.organization_id=v_org
    left join public.operational_constraint_signals cs
      on cs.id=d.constraint_signal_id and cs.organization_id=v_org
    left join rate rt on rt.asset_id=s.asset_id
    where s.organization_id=v_org
      and s.state in ('down_planned','down_unplanned','offline')
      and s.started_at<now() and coalesce(s.ended_at,now())>v_from
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'operatingStateId',e.id,'assetId',e.asset_id,'assetTag',e.tag,
      'asset',e.asset,'state',e.state,'reasonCode',e.reason_code,
      'startedAt',e.started_at,'endedAt',e.ended_at,
      'downHours',round(e.down_hours::numeric,1),
      'classification',e.classification,'classificationBasis',e.basis,
      'classificationReviewId',e.classification_review_id,
      'supersedesId',e.supersedes_id,'classifiedAt',e.classified_at,
      'classifiedBy',e.classified_by_name,'workOrder',e.wo_number,
      'workOrderId',e.work_order_id,
      'candidateWorkOrders',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'id',candidate.id,'woNumber',candidate.wo_number,
          'title',candidate.title,'status',candidate.status
        ) order by candidate.created_at desc),'[]'::jsonb)
        from (
          select cw.id,cw.wo_number,cw.title,cw.status,cw.created_at
          from public.work_orders cw
          where cw.organization_id=v_org and cw.asset_id=e.asset_id
            and cw.created_at<=coalesce(e.ended_at,now())+interval '7 days'
            and coalesce(cw.completed_at,now())>=e.started_at-interval '7 days'
          order by cw.created_at desc limit 12
        ) candidate
      ),
      'constraintSignalId',e.constraint_signal_id,
      'constraintKind',e.signal_kind,'constraintKey',e.signal_key,
      'constraintState',e.constraint_state,
      'constraintValidUntil',e.constraint_valid_until,
      'constraintBasis',e.constraint_basis,
      'measurementState',e.measurement_state,
      'demonstratedRate',case when e.demonstrated_rate is null then null
        else round(e.demonstrated_rate::numeric,3) end,
      'unitOfMeasure',e.uom,
      'estimatedUnitsLost',case when e.demonstrated_rate is null then null
        else round((e.down_hours*e.demonstrated_rate)::numeric,1) end
    ) order by e.started_at desc) filter(where e.event_rank<=200),'[]'::jsonb),
    count(*)::integer,coalesce(sum(e.down_hours),0),
    coalesce(sum(e.down_hours) filter(where e.classification<>'unclassified'),0),
    count(*) filter(where e.measurement_state='demonstrated_rate')::integer,
    coalesce(sum(e.down_hours*e.demonstrated_rate)
      filter(where e.demonstrated_rate is not null),0)
  into v_events,v_total_events,v_total_hours,v_classified_hours,v_measurable,v_units
  from down_events e;

  with latest_review as (
    select distinct on (d.operating_state_id) d.*
    from public.downtime_classification_reviews d
    where d.organization_id=v_org
    order by d.operating_state_id,d.classified_at desc,d.id desc
  ), classified as (
    select coalesce(d.classification,'unclassified') classification,
      extract(epoch from (
        least(coalesce(s.ended_at,now()),now())-greatest(s.started_at,v_from)
      ))/3600.0 hours
    from public.operating_states s
    left join latest_review d on d.operating_state_id=s.id
    where s.organization_id=v_org
      and s.state in ('down_planned','down_unplanned','offline')
      and s.started_at<now() and coalesce(s.ended_at,now())>v_from
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'classification',classification,'events',events,
    'downHours',round(hours::numeric,1),
    'sharePct',case when v_total_hours>0 then round(100*hours/v_total_hours,1) else 0 end
  ) order by hours desc),'[]'::jsonb)
  into v_categories from (
    select classification,count(*) events,sum(hours) hours
    from classified group by classification
  ) x;

  with latest as (
    select distinct on (
      s.signal_kind,s.signal_key,coalesce(s.asset_id,'00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(s.site_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ) s.*
    from public.operational_constraint_signals s
    where s.organization_id=v_org
      and s.observed_at<=now()
      and s.observed_at>=v_from
    order by s.signal_kind,s.signal_key,
      coalesce(s.asset_id,'00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(s.site_id,'00000000-0000-0000-0000-000000000000'::uuid),
      s.observed_at desc,s.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'kind',s.signal_kind,'key',s.signal_key,'state',s.state,
    'assetId',s.asset_id,'siteId',s.site_id,'observedAt',s.observed_at,
    'validUntil',s.valid_until,'current',s.valid_until>=now(),
    'sourceSystem',s.source_system,'sourceRef',s.source_ref,'basis',s.basis
  ) order by (s.valid_until>=now()) desc,s.observed_at desc),'[]'::jsonb)
  into v_constraints from latest s;

  return jsonb_build_object(
    'windowDays',v_days,
    'summary',jsonb_build_object(
      'downEvents',v_total_events,'downHours',round(v_total_hours,1),
      'classifiedHours',round(v_classified_hours,1),
      'unclassifiedDownHours',round(v_total_hours-v_classified_hours,1),
      'classificationCoveragePct',case when v_total_hours>0
        then round(100*v_classified_hours/v_total_hours,1) else null end,
      'measurableEvents',v_measurable,
      'estimatedUnitsLost',round(v_units,1)
    ),
    'events',v_events,'eventsReturned',least(v_total_events,200),
    'eventsTruncated',v_total_events>200,
    'categories',v_categories,'constraints',v_constraints,
    'basis','Units at risk are down hours multiplied by demonstrated production per running hour in the same window; never nameplate. Missing running or production evidence remains not_measurable. Classification is a named-human interpretation and does not rewrite the source event.',
    'authority','advisory evidence only; this reader and classifier do not change production plans, controls, work, risk or return-to-service state'
  );
end $$;
revoke all on function public.get_production_loss_reconciliation(integer)
  from public,anon,service_role;
grant execute on function public.get_production_loss_reconciliation(integer)
  to authenticated;

comment on table public.downtime_classification_reviews is
  'C2.06 append-only human classifications of canonical operating-state downtime; later records supersede but never overwrite prior interpretations.';
comment on function public.get_production_loss_reconciliation(integer) is
  'C2.06 tenant reconciliation of canonical down states, demonstrated production rates, append-only classifications and constraint signals; no nameplate assumptions.';

notify pgrst,'reload schema';
