-- C8.10 — continuously refresh asset strategies from verified field experience.
--
-- Canonical reuse:
--   * ca_verifications owns independently attested corrective-action outcomes;
--   * learning_events remains the single organizational learning store;
--   * asset_strategy_assessments remains the immutable strategy proposal;
--   * asset_lifecycle_plans remains the named-human adoption record.
--
-- This migration adds one source relationship. A concluded field outcome may
-- trigger a new retained assessment, but it never changes the maintenance
-- programme, creates work, accepts risk, commits spend, changes operating
-- limits or authorizes return to service.

create unique index if not exists ca_verifications_org_identity
  on public.ca_verifications(organization_id,id);

alter table public.learning_events
  add column if not exists ca_verification_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.learning_events'::regclass
      and conname='learning_events_ca_verification_tenant_fk'
  ) then
    alter table public.learning_events
      add constraint learning_events_ca_verification_tenant_fk
      foreign key(organization_id,ca_verification_id)
      references public.ca_verifications(organization_id,id) on delete restrict;
  end if;
end $$;

create unique index if not exists learning_events_one_ca_field_outcome
  on public.learning_events(organization_id,ca_verification_id)
  where ca_verification_id is not null;

create or replace function public.protect_ca_field_learning_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_governed boolean;
begin
  v_governed:=case when tg_op='DELETE' then old.ca_verification_id is not null
    else new.ca_verification_id is not null end
    or (tg_op='UPDATE' and old.ca_verification_id is not null);
  if v_governed and coalesce(current_setting('app.ca_field_learning_write',true),'')<>'granted' then
    raise exception 'corrective-action field-learning events are written only by the measured effectiveness workflow';
  end if;
  if v_governed and tg_op in ('UPDATE','DELETE') then
    raise exception 'corrective-action field-learning events are immutable';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.protect_ca_field_learning_event()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_protect_ca_field_learning_event on public.learning_events;
create trigger trg_protect_ca_field_learning_event
  before insert or update or delete on public.learning_events
  for each row execute function public.protect_ca_field_learning_event();

create or replace function public.capture_ca_field_learning_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan public.asset_lifecycle_plans%rowtype;
begin
  if old.effectiveness is distinct from new.effectiveness
     and new.effectiveness in ('effective','ineffective')
     and new.effectiveness_evaluated_at is not null
     and new.asset_id is not null
     and new.strategy_lifecycle_plan_id is not null
     and new.project_lesson_id is null then
    select * into v_plan from public.asset_lifecycle_plans
    where id=new.strategy_lifecycle_plan_id
      and organization_id=new.organization_id
      and asset_id=new.asset_id;
    if not found then
      raise exception 'concluded field experience has no same-tenant adopted lifecycle-plan source';
    end if;
    perform set_config('app.ca_field_learning_write','granted',true);
    insert into public.learning_events(
      organization_id,asset_id,event_type,title,detail,verified_value,
      model_confidence,ca_verification_id
    ) values (
      new.organization_id,new.asset_id,'strategy_field_experience',
      case when new.effectiveness='effective'
        then 'Strategy field outcome — no recurrence in observation window'
        else 'Strategy field outcome — failure mode recurred' end,
      format(
        'Corrective-action verification %s concluded %s after a %s-day observation window for failure mode %s. Source lifecycle-plan version %s; recurrence work order %s. This measured outcome may trigger a new governed assessment but changes no programme state.',
        new.id,new.effectiveness,new.observation_days,
        coalesce(new.failure_mode,'uncoded'),v_plan.version,
        coalesce(new.recurrence_wo_id::text,'none')
      ),
      case when new.effectiveness='effective' then 1 else 0 end,
      100,new.id
    ) on conflict(organization_id,ca_verification_id)
      where ca_verification_id is not null do nothing;
    perform set_config('app.ca_field_learning_write','',true);
  end if;
  return new;
end $$;
revoke all on function public.capture_ca_field_learning_event()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_capture_ca_field_learning_event on public.ca_verifications;
create trigger trg_capture_ca_field_learning_event
  after update of effectiveness,effectiveness_evaluated_at on public.ca_verifications
  for each row execute function public.capture_ca_field_learning_event();

-- Preserve already concluded production outcomes when this migration lands.
do $$
begin
  perform set_config('app.ca_field_learning_write','granted',true);
  insert into public.learning_events(
    organization_id,asset_id,event_type,title,detail,verified_value,
    model_confidence,ca_verification_id
  )
  select c.organization_id,c.asset_id,'strategy_field_experience',
    case when c.effectiveness='effective'
      then 'Strategy field outcome — no recurrence in observation window'
      else 'Strategy field outcome — failure mode recurred' end,
    format(
      'Corrective-action verification %s concluded %s after a %s-day observation window for failure mode %s. Source lifecycle-plan version %s; recurrence work order %s. This measured outcome may trigger a new governed assessment but changes no programme state.',
      c.id,c.effectiveness,c.observation_days,coalesce(c.failure_mode,'uncoded'),
      l.version,coalesce(c.recurrence_wo_id::text,'none')
    ),case when c.effectiveness='effective' then 1 else 0 end,100,c.id
  from public.ca_verifications c
  join public.asset_lifecycle_plans l
    on l.id=c.strategy_lifecycle_plan_id
   and l.organization_id=c.organization_id and l.asset_id=c.asset_id
  where c.project_lesson_id is null and c.asset_id is not null
    and c.effectiveness in ('effective','ineffective')
    and c.effectiveness_evaluated_at is not null
  on conflict(organization_id,ca_verification_id)
    where ca_verification_id is not null do nothing;
  perform set_config('app.ca_field_learning_write','',true);
end $$;

create table if not exists public.asset_strategy_assessment_learning_sources(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.asset_strategy_assessments(id) on delete restrict,
  learning_event_id uuid not null references public.learning_events(id) on delete restrict,
  ca_verification_id uuid not null references public.ca_verifications(id) on delete restrict,
  lifecycle_plan_id uuid not null references public.asset_lifecycle_plans(id) on delete restrict,
  effectiveness text not null check(effectiveness in ('effective','ineffective')),
  applied_plan_version integer not null check(applied_plan_version>0),
  effectiveness_evaluated_at timestamptz not null,
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  linked_at timestamptz not null default now(),
  unique(assessment_id,learning_event_id)
);
create index if not exists idx_strategy_learning_sources_org_assessment
  on public.asset_strategy_assessment_learning_sources(organization_id,assessment_id);
alter table public.asset_strategy_assessment_learning_sources enable row level security;
drop policy if exists asset_strategy_assessment_learning_sources_read
  on public.asset_strategy_assessment_learning_sources;
create policy asset_strategy_assessment_learning_sources_read
  on public.asset_strategy_assessment_learning_sources for select to authenticated
  using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.asset_strategy_assessment_learning_sources
  from public,anon,authenticated;
grant select on public.asset_strategy_assessment_learning_sources to authenticated;

create or replace function public.protect_asset_strategy_learning_source()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'asset-strategy field-learning provenance is immutable';
  end if;
  if coalesce(current_setting('app.asset_strategy_learning_write',true),'')<>'granted' then
    raise exception 'asset-strategy field-learning provenance is written only by the controlled calculation receipt';
  end if;
  if not exists(select 1 from public.asset_strategy_assessments a
    where a.id=new.assessment_id and a.organization_id=new.organization_id) then
    raise exception 'strategy assessment source crosses its organization boundary';
  end if;
  if not exists(select 1 from public.learning_events e
    where e.id=new.learning_event_id and e.organization_id=new.organization_id
      and e.ca_verification_id=new.ca_verification_id) then
    raise exception 'strategy learning source is not the canonical corrective-action outcome';
  end if;
  if not exists(select 1 from public.ca_verifications c
    where c.id=new.ca_verification_id and c.organization_id=new.organization_id
      and c.strategy_lifecycle_plan_id=new.lifecycle_plan_id
      and c.effectiveness=new.effectiveness
      and c.effectiveness_evaluated_at=new.effectiveness_evaluated_at) then
    raise exception 'strategy learning source does not match the concluded field verification';
  end if;
  return new;
end $$;
revoke all on function public.protect_asset_strategy_learning_source()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_protect_asset_strategy_learning_source
  on public.asset_strategy_assessment_learning_sources;
create trigger trg_protect_asset_strategy_learning_source
  before insert or update or delete on public.asset_strategy_assessment_learning_sources
  for each row execute function public.protect_asset_strategy_learning_source();

create or replace function public.get_asset_strategy_field_experience(
  p_organization_id uuid,p_plan_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.maintenance_plans%rowtype; v_events jsonb; v_ids uuid[];
  v_effective integer; v_ineffective integer; v_current_effective integer;
  v_current_ineffective integer; v_unconsumed integer; v_latest timestamptz;
begin
  select * into p from public.maintenance_plans
  where id=p_plan_id and organization_id=p_organization_id;
  if not found then return jsonb_build_object('error','maintenance plan not found'); end if;
  with experience as (
    select e.id learning_event_id,c.id ca_verification_id,l.id lifecycle_plan_id,
      l.version lifecycle_plan_version,
      coalesce((l.adopted_strategy->>'resultingPlanVersion')::integer,0) applied_plan_version,
      c.effectiveness,c.effectiveness_evaluated_at,c.observation_days,
      c.failure_mode,c.recurrence_wo_id,
      coalesce((l.adopted_strategy->>'resultingPlanVersion')::integer,0)=p.version applies_current,
      not exists(select 1 from public.asset_strategy_assessment_learning_sources x
        join public.asset_strategy_assessments a on a.id=x.assessment_id
          and a.organization_id=x.organization_id
        where x.organization_id=p_organization_id and x.learning_event_id=e.id
          and a.maintenance_plan_id=p.id and a.plan_version=p.version) unconsumed
    from public.learning_events e
    join public.ca_verifications c on c.id=e.ca_verification_id
      and c.organization_id=e.organization_id
    join public.asset_lifecycle_plans l on l.id=c.strategy_lifecycle_plan_id
      and l.organization_id=c.organization_id and l.asset_id=c.asset_id
    where e.organization_id=p_organization_id
      and l.maintenance_plan_id=p.id
      and e.event_type='strategy_field_experience'
      and c.effectiveness in ('effective','ineffective')
      and c.effectiveness_evaluated_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'learningEventId',learning_event_id,'caVerificationId',ca_verification_id,
      'lifecyclePlanId',lifecycle_plan_id,'lifecyclePlanVersion',lifecycle_plan_version,
      'appliedPlanVersion',applied_plan_version,'effectiveness',effectiveness,
      'evaluatedAt',effectiveness_evaluated_at,'observationDays',observation_days,
      'failureMode',failure_mode,'recurrenceWorkOrderId',recurrence_wo_id,
      'appliesToCurrentPlanVersion',applies_current,'unconsumed',unconsumed)
      order by effectiveness_evaluated_at,learning_event_id),'[]'::jsonb),
    coalesce(array_agg(learning_event_id order by learning_event_id),'{}'::uuid[]),
    count(*) filter(where effectiveness='effective')::integer,
    count(*) filter(where effectiveness='ineffective')::integer,
    count(*) filter(where applies_current and effectiveness='effective')::integer,
    count(*) filter(where applies_current and effectiveness='ineffective')::integer,
    count(*) filter(where applies_current and unconsumed)::integer,
    max(effectiveness_evaluated_at)
  into v_events,v_ids,v_effective,v_ineffective,v_current_effective,
    v_current_ineffective,v_unconsumed,v_latest
  from experience;
  return jsonb_build_object(
    'events',v_events,'eventIds',to_jsonb(v_ids),
    'effectiveCount',coalesce(v_effective,0),
    'ineffectiveCount',coalesce(v_ineffective,0),
    'currentEffectiveCount',coalesce(v_current_effective,0),
    'currentIneffectiveCount',coalesce(v_current_ineffective,0),
    'refreshRequired',coalesce(v_unconsumed,0)>0,
    'revisionRequired',coalesce(v_current_ineffective,0)>0,
    'latestEvaluatedAt',v_latest,
    'currentPlanVersion',p.version,
    'basis','Only concluded corrective-action outcomes tied to the exact adopted lifecycle-plan and maintenance task are included. Older plan-version outcomes remain historical; only unconsumed current-version outcomes trigger refresh.'
  );
end $$;
revoke all on function public.get_asset_strategy_field_experience(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.get_asset_strategy_source_v2(
  p_organization_id uuid,p_actor_id uuid,p_plan_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_base jsonb; v_field jsonb;
begin
  v_base:=public.get_asset_strategy_source(p_organization_id,p_actor_id,p_plan_id);
  if v_base ? 'error' then return v_base; end if;
  v_field:=public.get_asset_strategy_field_experience(p_organization_id,p_plan_id);
  if v_field ? 'error' then return v_field; end if;
  return v_base||jsonb_build_object('fieldExperience',v_field);
end $$;
revoke all on function public.get_asset_strategy_source_v2(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_asset_strategy_source_v2(uuid,uuid,uuid)
  to service_role;

create or replace function public.record_asset_strategy_run_v2(
  p_organization_id uuid,p_actor_id uuid,p_plan_id uuid,p_plan_version integer,
  p_event_ids bigint[],p_learning_event_ids uuid[],p_kernel_version text,p_result jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_field jsonb; v_expected uuid[]; v_claimed uuid[]; v_receipt jsonb;
  v_assessment uuid; v_summary jsonb;
begin
  v_field:=public.get_asset_strategy_field_experience(p_organization_id,p_plan_id);
  if v_field ? 'error' then return v_field; end if;
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into v_expected
  from jsonb_array_elements_text(coalesce(v_field->'eventIds','[]'::jsonb)) j(value)
  cross join lateral (select value::uuid x) q;
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into v_claimed
  from unnest(coalesce(p_learning_event_ids,'{}'::uuid[])) x;
  if v_expected is distinct from v_claimed
     or cardinality(coalesce(p_learning_event_ids,'{}'::uuid[]))<>cardinality(v_expected) then
    return jsonb_build_object('error','field-learning source set changed or does not match the complete canonical outcome population');
  end if;
  v_summary:=p_result->'fieldExperience';
  if jsonb_typeof(coalesce(v_summary,'null'::jsonb))<>'object'
     or coalesce((v_summary->>'effectiveCount')::integer,-1)<>coalesce((v_field->>'effectiveCount')::integer,0)
     or coalesce((v_summary->>'ineffectiveCount')::integer,-1)<>coalesce((v_field->>'ineffectiveCount')::integer,0)
     or coalesce((v_summary->>'currentEffectiveCount')::integer,-1)<>coalesce((v_field->>'currentEffectiveCount')::integer,0)
     or coalesce((v_summary->>'currentIneffectiveCount')::integer,-1)<>coalesce((v_field->>'currentIneffectiveCount')::integer,0)
     or coalesce((v_summary->>'refreshRequired')::boolean,false)<>coalesce((v_field->>'refreshRequired')::boolean,false)
     or coalesce((v_summary->>'revisionRequired')::boolean,false)<>coalesce((v_field->>'revisionRequired')::boolean,false) then
    return jsonb_build_object('error','field-learning summary does not match the server-owned verified outcomes');
  end if;
  v_receipt:=public.record_asset_strategy_run(
    p_organization_id,p_actor_id,p_plan_id,p_plan_version,p_event_ids,
    p_kernel_version,p_result
  );
  if v_receipt ? 'error' then return v_receipt; end if;
  v_assessment:=(v_receipt->>'assessment_id')::uuid;
  perform set_config('app.asset_strategy_learning_write','granted',true);
  insert into public.asset_strategy_assessment_learning_sources(
    organization_id,assessment_id,learning_event_id,ca_verification_id,
    lifecycle_plan_id,effectiveness,applied_plan_version,
    effectiveness_evaluated_at,source_snapshot
  )
  select p_organization_id,v_assessment,e.id,c.id,l.id,c.effectiveness,
    coalesce((l.adopted_strategy->>'resultingPlanVersion')::integer,0),
    c.effectiveness_evaluated_at,jsonb_build_object(
      'learningEventId',e.id,'caVerificationId',c.id,
      'lifecyclePlanId',l.id,'lifecyclePlanVersion',l.version,
      'maintenancePlanId',l.maintenance_plan_id,
      'appliedPlanVersion',coalesce((l.adopted_strategy->>'resultingPlanVersion')::integer,0),
      'effectiveness',c.effectiveness,'evaluatedAt',c.effectiveness_evaluated_at,
      'observationDays',c.observation_days,'failureMode',c.failure_mode,
      'recurrenceWorkOrderId',c.recurrence_wo_id)
  from unnest(v_expected) x(id)
  join public.learning_events e on e.id=x.id and e.organization_id=p_organization_id
  join public.ca_verifications c on c.id=e.ca_verification_id
    and c.organization_id=e.organization_id
  join public.asset_lifecycle_plans l on l.id=c.strategy_lifecycle_plan_id
    and l.organization_id=c.organization_id
  where l.maintenance_plan_id=p_plan_id;
  perform set_config('app.asset_strategy_learning_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(p_organization_id,'asset_strategy_field_learning',
    coalesce((select role from public.user_profiles where id=p_actor_id
      and organization_id=p_organization_id),'unknown'),jsonb_build_object(
      'action','assessment_refreshed','assessment_id',v_assessment,
      'maintenance_plan_id',p_plan_id,'plan_version',p_plan_version,
      'learning_event_ids',to_jsonb(v_expected),
      'effective_count',v_field->'effectiveCount',
      'ineffective_count',v_field->'ineffectiveCount',
      'revision_required',v_field->'revisionRequired',
      'advisory',true,'changesMaintenancePlan',false,'createsWork',false,
      'acceptsRisk',false,'commitsSpend',false,'changesOperatingLimits',false,
      'returnsToService',false));
  return v_receipt||jsonb_build_object(
    'learning_event_ids',to_jsonb(v_expected),'field_experience',v_field,
    'changesMaintenancePlan',false,'createsWork',false,'acceptsRisk',false,
    'commitsSpend',false,'changesOperatingLimits',false,'returnsToService',false);
exception when invalid_text_representation then
  return jsonb_build_object('error','field-learning source contains an invalid identifier');
end $$;
revoke all on function public.record_asset_strategy_run(uuid,uuid,uuid,integer,bigint[],text,jsonb)
  from service_role;
revoke all on function public.record_asset_strategy_run_v2(uuid,uuid,uuid,integer,bigint[],uuid[],text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_asset_strategy_run_v2(uuid,uuid,uuid,integer,bigint[],uuid[],text,jsonb)
  to service_role;

create or replace function public.get_asset_strategy_workspace_v2()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_base jsonb; v_learning jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  v_base:=public.get_asset_strategy_workspace();
  select coalesce(jsonb_agg(jsonb_build_object(
    'planId',p.id,'assetId',p.asset_id,'taskLabel',p.task_label,
    'state',public.get_asset_strategy_field_experience(v_org,p.id))
    order by p.task_label,p.id),'[]'::jsonb)
  into v_learning from public.maintenance_plans p where p.organization_id=v_org;
  return v_base||jsonb_build_object(
    'learning',v_learning,
    'learningBoundary',jsonb_build_object(
      'refreshesAssessment',true,'changesMaintenancePlan',false,
      'createsWork',false,'acceptsRisk',false,'commitsSpend',false,
      'changesOperatingLimits',false,'returnsToService',false,
      'requiresIndependentReviewAndHumanAdoption',true));
end $$;
revoke all on function public.get_asset_strategy_workspace_v2() from public,anon;
grant execute on function public.get_asset_strategy_workspace_v2() to authenticated;

comment on function public.get_asset_strategy_field_experience(uuid,uuid) is
  'C8.10 exact canonical field experience for one maintenance task. Concluded CA outcomes are version-aware; historical outcomes remain visible but cannot repeatedly trigger the current plan.';
comment on function public.record_asset_strategy_run_v2(uuid,uuid,uuid,integer,bigint[],uuid[],text,jsonb) is
  'C8.10 controlled receipt for a versioned assessment refreshed from exact field-learning events. The assessment is advisory and has no operational authority.';
comment on table public.asset_strategy_assessment_learning_sources is
  'C8.10 immutable many-to-many provenance between retained strategy assessments and canonical verified field outcomes.';

notify pgrst,'reload schema';
