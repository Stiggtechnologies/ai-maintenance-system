-- ============================================================================
-- U23.01 — governed implementation and adoption management.
--
-- This is the execution layer after the evidence-backed maturity assessment.
-- It does not create another evidence, approval, value, identity or audit
-- model.  The canonical contracts remain:
--   * evidence_items for completion proof;
--   * approvals for activation and independent closeout decisions;
--   * value_metrics for adoption and benefit measurements;
--   * user_profiles for named accountable humans;
--   * audit_events for the immutable activity trail.
--
-- A program cannot activate until all thirteen U23.01 disciplines are owned
-- and planned.  It cannot be submitted until every non-cancelled item is
-- complete with independently verified evidence.  Adoption and benefits
-- items additionally require baseline, target and observed value points in
-- the canonical value store.  A different executive or administrator closes
-- the program and verifies the observed points.  Nothing in this migration
-- creates work, changes a procedure, spends money, alters an operating limit,
-- or claims that benefits were realized without a recorded human review.
-- ============================================================================

create or replace function public.adoption_management_categories()
returns text[] language sql immutable set search_path=public as $$
  select array[
    'stakeholder_mapping','role_design','process_ownership','training',
    'field_trials','change_impact','feedback','adoption_metrics',
    'procedure_updates','incentives','communications','champions',
    'benefits_tracking'
  ]::text[];
$$;

revoke all on function public.adoption_management_categories() from public,anon;
grant execute on function public.adoption_management_categories() to authenticated,service_role;

create table if not exists public.adoption_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maturity_assessment_id uuid,
  title text not null check (length(btrim(title)) between 3 and 160),
  objective text not null check (length(btrim(objective)) between 20 and 2000),
  scope text not null check (length(btrim(scope)) between 20 and 2000),
  sponsor_id uuid not null references public.user_profiles(id) on delete restrict,
  process_owner_id uuid not null references public.user_profiles(id) on delete restrict,
  starts_on date not null,
  target_on date not null,
  status text not null default 'draft'
    check (status in ('draft','active','review_pending','completed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_by uuid references auth.users(id) on delete restrict,
  activated_at timestamptz,
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  check (target_on >= starts_on),
  check ((status='draft' and activated_by is null and activated_at is null)
    or (status<>'draft' and activated_by is not null and activated_at is not null)),
  check ((status<>'review_pending') or (submitted_by is not null and submitted_at is not null)),
  check ((status<>'completed') or
    (reviewed_by is not null and reviewed_at is not null
     and length(btrim(coalesce(review_note,''))) >= 20)),
  unique (organization_id,id),
  foreign key (organization_id,maturity_assessment_id)
    references public.organizational_maturity_assessments(organization_id,id)
);

create table if not exists public.adoption_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null,
  category text not null check (category=any(public.adoption_management_categories())),
  title text not null check (length(btrim(title)) between 3 and 160),
  affected_group text,
  owner_id uuid not null references public.user_profiles(id) on delete restrict,
  owner_role_snapshot text not null check (length(btrim(owner_role_snapshot)) between 2 and 80),
  plan text not null check (length(btrim(plan)) between 20 and 4000),
  success_measure text not null check (length(btrim(success_measure)) between 10 and 1000),
  source_reference text,
  impact_level text check (impact_level in ('low','medium','high','critical')),
  safety_guardrail text,
  due_on date not null,
  status text not null default 'planned'
    check (status in ('planned','in_progress','blocked','complete','cancelled')),
  evidence_item_id uuid,
  evidence_basis text,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (program_id,category,title),
  foreign key (organization_id,program_id)
    references public.adoption_programs(organization_id,id) on delete cascade,
  foreign key (organization_id,evidence_item_id)
    references public.evidence_items(organization_id,id),
  check (category not in ('stakeholder_mapping','training','field_trials','feedback','communications','champions')
    or length(btrim(coalesce(affected_group,''))) >= 3),
  check (category<>'procedure_updates'
    or length(btrim(coalesce(source_reference,''))) >= 3),
  check (category<>'change_impact' or impact_level is not null),
  check (category<>'incentives'
    or length(btrim(coalesce(safety_guardrail,''))) >= 20),
  check (status<>'complete' or
    (evidence_item_id is not null and length(btrim(coalesce(evidence_basis,''))) >= 20))
);

create index if not exists adoption_programs_recent_idx
  on public.adoption_programs(organization_id,created_at desc);
create index if not exists adoption_items_program_idx
  on public.adoption_items(organization_id,program_id,category,status);

-- Value measurements stay in the one canonical value store.  Baseline and
-- target are single pinned points; observations are append-only so the user
-- can see adoption or benefit movement over time.
alter table public.value_metrics
  add column if not exists adoption_item_id uuid
    references public.adoption_items(id) on delete restrict,
  add column if not exists adoption_point text;

alter table public.value_metrics
  drop constraint if exists value_metrics_adoption_point_shape;
alter table public.value_metrics
  add constraint value_metrics_adoption_point_shape check (
    (adoption_item_id is null and adoption_point is null)
    or (adoption_item_id is not null
      and adoption_point in ('baseline','target','actual')
      and metric_type in ('adoption_progress','adoption_benefit')
      and owner_id is not null and expected_date is not null
      and evidence_item_id is not null and recorded_by is not null
      and length(btrim(coalesce(basis,''))) >= 20
      and length(btrim(coalesce(unit,''))) >= 1
      and value > '-Infinity'::numeric and value < 'Infinity'::numeric
      and status in ('projected','baseline_pending_validation','verified','rejected'))
  );

create unique index if not exists value_metrics_adoption_anchor_uq
  on public.value_metrics(adoption_item_id,adoption_point)
  where adoption_item_id is not null and adoption_point in ('baseline','target');
create index if not exists value_metrics_adoption_observation_idx
  on public.value_metrics(organization_id,adoption_item_id,created_at desc)
  where adoption_item_id is not null;

alter table public.approvals
  add column if not exists adoption_program_id uuid
    references public.adoption_programs(id) on delete set null;
create index if not exists approvals_adoption_program_idx
  on public.approvals(organization_id,adoption_program_id,created_at desc)
  where adoption_program_id is not null;

alter table public.adoption_programs enable row level security;
alter table public.adoption_items enable row level security;
drop policy if exists adoption_programs_org_read on public.adoption_programs;
create policy adoption_programs_org_read on public.adoption_programs
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists adoption_items_org_read on public.adoption_items;
create policy adoption_items_org_read on public.adoption_items
  for select to authenticated using (organization_id=public.app_current_org());

revoke all on table public.adoption_programs,public.adoption_items from public,anon,authenticated;
grant select on table public.adoption_programs,public.adoption_items to authenticated;

create or replace function public.adoption_management_author_role(p_role text)
returns boolean language sql immutable security invoker set search_path=public as $$
  select lower(coalesce(p_role,'')) in
    ('admin','executive','maintenance_manager','reliability_engineer');
$$;

revoke all on function public.adoption_management_author_role(text) from public,anon;
grant execute on function public.adoption_management_author_role(text) to authenticated,service_role;

create or replace function public.enforce_adoption_management_wall()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(current_setting('app.adoption_management_write',true),'')<>'granted' then
    raise exception 'adoption management records move only through governed functions';
  end if;
  if tg_op='DELETE' then
    raise exception 'adoption management records are retained; cancel an item or supersede with a new program';
  end if;
  if tg_op='UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'adoption records cannot change organization';
  end if;
  return new;
end $$;

drop trigger if exists trg_adoption_program_wall on public.adoption_programs;
create trigger trg_adoption_program_wall before insert or update or delete
  on public.adoption_programs for each row execute function public.enforce_adoption_management_wall();
drop trigger if exists trg_adoption_item_wall on public.adoption_items;
create trigger trg_adoption_item_wall before insert or update or delete
  on public.adoption_items for each row execute function public.enforce_adoption_management_wall();

create or replace function public.enforce_adoption_value_wall()
returns trigger language plpgsql set search_path=public as $$
declare v_item public.adoption_items%rowtype; v_evidence_org uuid;
begin
  if tg_op='DELETE' then
    if old.adoption_item_id is null then return old; end if;
    raise exception 'adoption value evidence is append-only';
  end if;
  if tg_op='UPDATE' and old.adoption_item_id is not null
     and new.adoption_item_id is null then
    raise exception 'adoption value evidence cannot be detached from its governed item';
  end if;
  if new.adoption_item_id is null then return new; end if;
  if coalesce(current_setting('app.adoption_value_write',true),'')<>'granted' then
    raise exception 'adoption value points require the governed adoption recorder';
  end if;
  select * into v_item from public.adoption_items where id=new.adoption_item_id;
  if not found or v_item.organization_id<>new.organization_id
     or v_item.category not in ('adoption_metrics','benefits_tracking') then
    raise exception 'adoption value point is outside its same-tenant measurement item';
  end if;
  if new.metric_type<>(case when v_item.category='adoption_metrics'
      then 'adoption_progress' else 'adoption_benefit' end) then
    raise exception 'adoption value point type does not match its item category';
  end if;
  if new.owner_id<>v_item.owner_id then
    raise exception 'adoption value point owner must remain the accountable item owner';
  end if;
  select organization_id into v_evidence_org from public.evidence_items
    where id=new.evidence_item_id and verification_status='verified';
  if v_evidence_org is distinct from new.organization_id then
    raise exception 'adoption value points require same-tenant verified canonical evidence';
  end if;
  if tg_op='UPDATE' and
     (to_jsonb(new)-array['status','verified_by','verified_at','verification_note'])
       is distinct from
     (to_jsonb(old)-array['status','verified_by','verified_at','verification_note']) then
    raise exception 'adoption value evidence is immutable except for independent verification';
  end if;
  return new;
end $$;

drop trigger if exists trg_adoption_value_wall on public.value_metrics;
create trigger trg_adoption_value_wall before insert or update or delete
  on public.value_metrics for each row execute function public.enforce_adoption_value_wall();

create or replace function public.create_adoption_program(p_program jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_id uuid; v_sponsor uuid; v_owner uuid; v_maturity uuid;
  v_start date:=public.sync_text_as_date(nullif(btrim(coalesce(p_program->>'startsOn','')),''));
  v_target date:=public.sync_text_as_date(nullif(btrim(coalesce(p_program->>'targetOn','')),''));
begin
  if v_org is null or not public.adoption_management_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if length(btrim(coalesce(p_program->>'title','')))<3
     or length(btrim(coalesce(p_program->>'objective','')))<20
     or length(btrim(coalesce(p_program->>'scope','')))<20 then
    return jsonb_build_object('error','title, objective and scope are required');
  end if;
  if v_start is null or v_target is null or v_target<v_start then
    return jsonb_build_object('error','valid start and target dates are required');
  end if;
  begin v_sponsor:=(p_program->>'sponsorId')::uuid; exception when others then
    return jsonb_build_object('error','a valid named sponsor is required'); end;
  begin v_owner:=(p_program->>'processOwnerId')::uuid; exception when others then
    return jsonb_build_object('error','a valid named process owner is required'); end;
  if not exists(select 1 from public.user_profiles p where p.id=v_sponsor and p.organization_id=v_org)
     or not exists(select 1 from public.user_profiles p where p.id=v_owner and p.organization_id=v_org) then
    return jsonb_build_object('error','sponsor and process owner must belong to this organization');
  end if;
  if nullif(btrim(coalesce(p_program->>'maturityAssessmentId','')),'') is not null then
    begin v_maturity:=(p_program->>'maturityAssessmentId')::uuid; exception when others then
      return jsonb_build_object('error','maturity assessment id is invalid'); end;
    if not exists(select 1 from public.organizational_maturity_assessments a
      where a.id=v_maturity and a.organization_id=v_org and a.status='approved') then
      return jsonb_build_object('error','linked maturity assessment must be approved and same-tenant');
    end if;
  end if;
  perform set_config('app.adoption_management_write','granted',true);
  insert into public.adoption_programs(
    organization_id,maturity_assessment_id,title,objective,scope,sponsor_id,
    process_owner_id,starts_on,target_on,created_by)
  values(v_org,v_maturity,btrim(p_program->>'title'),btrim(p_program->>'objective'),
    btrim(p_program->>'scope'),v_sponsor,v_owner,v_start,v_target,auth.uid())
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_program_created',v_role,jsonb_build_object(
    'program_id',v_id,'sponsor_id',v_sponsor,'process_owner_id',v_owner,
    'operational_authority',false));
  return jsonb_build_object('programId',v_id,'status','draft');
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.upsert_adoption_item(p_program_id uuid,p_item jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_program public.adoption_programs%rowtype; v_id uuid; v_owner uuid; v_owner_role text;
  v_due date:=public.sync_text_as_date(nullif(btrim(coalesce(p_item->>'dueOn','')),''));
  v_category text:=p_item->>'category'; v_impact text:=nullif(p_item->>'impactLevel','');
begin
  if v_org is null or not public.adoption_management_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  select * into v_program from public.adoption_programs
    where id=p_program_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','adoption program not found'); end if;
  if v_program.status not in ('draft','active') then
    return jsonb_build_object('error','items cannot change while the program is under review or completed');
  end if;
  if not (v_category=any(public.adoption_management_categories())) then
    return jsonb_build_object('error','unknown adoption category');
  end if;
  if length(btrim(coalesce(p_item->>'title','')))<3
     or length(btrim(coalesce(p_item->>'plan','')))<20
     or length(btrim(coalesce(p_item->>'successMeasure','')))<10
     or v_due is null then
    return jsonb_build_object('error','title, substantive plan, success measure and due date are required');
  end if;
  begin v_owner:=(p_item->>'ownerId')::uuid; exception when others then
    return jsonb_build_object('error','a valid named owner is required'); end;
  select role into v_owner_role from public.user_profiles
    where id=v_owner and organization_id=v_org;
  if v_owner_role is null then return jsonb_build_object('error','item owner must belong to this organization'); end if;
  if v_category in ('stakeholder_mapping','training','field_trials','feedback','communications','champions')
     and length(btrim(coalesce(p_item->>'affectedGroup','')))<3 then
    return jsonb_build_object('error','this category requires an affected group or audience');
  end if;
  if v_category='procedure_updates' and length(btrim(coalesce(p_item->>'sourceReference','')))<3 then
    return jsonb_build_object('error','procedure updates require a controlled source or revision reference');
  end if;
  if v_category='change_impact' and v_impact not in ('low','medium','high','critical') then
    return jsonb_build_object('error','change impact requires a governed impact level');
  end if;
  if v_category='incentives' and length(btrim(coalesce(p_item->>'safetyGuardrail','')))<20 then
    return jsonb_build_object('error','incentives require a substantive safety and anti-gaming guardrail');
  end if;
  perform set_config('app.adoption_management_write','granted',true);
  insert into public.adoption_items(
    organization_id,program_id,category,title,affected_group,owner_id,
    owner_role_snapshot,plan,success_measure,source_reference,impact_level,
    safety_guardrail,due_on,created_by,updated_by)
  values(v_org,p_program_id,v_category,btrim(p_item->>'title'),
    nullif(btrim(coalesce(p_item->>'affectedGroup','')),''),v_owner,v_owner_role,
    btrim(p_item->>'plan'),btrim(p_item->>'successMeasure'),
    nullif(btrim(coalesce(p_item->>'sourceReference','')),''),v_impact,
    nullif(btrim(coalesce(p_item->>'safetyGuardrail','')),''),v_due,auth.uid(),auth.uid())
  on conflict(program_id,category,title) do update set
    affected_group=excluded.affected_group,owner_id=excluded.owner_id,
    owner_role_snapshot=excluded.owner_role_snapshot,plan=excluded.plan,
    success_measure=excluded.success_measure,source_reference=excluded.source_reference,
    impact_level=excluded.impact_level,safety_guardrail=excluded.safety_guardrail,
    due_on=excluded.due_on,status='planned',evidence_item_id=null,
    evidence_basis=null,updated_by=auth.uid(),updated_at=now()
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_item_planned',v_role,jsonb_build_object(
    'program_id',p_program_id,'item_id',v_id,'category',v_category,'owner_id',v_owner));
  return jsonb_build_object('itemId',v_id,'category',v_category,'status','planned');
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.activate_adoption_program(p_program_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_program public.adoption_programs%rowtype; v_missing text[];
begin
  if v_org is null or not public.adoption_management_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('error','activation requires a substantive authority and readiness basis');
  end if;
  select * into v_program from public.adoption_programs
    where id=p_program_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','adoption program not found'); end if;
  if v_program.status<>'draft' then return jsonb_build_object('error','only a draft program can activate'); end if;
  select array_agg(category order by category) into v_missing
  from unnest(public.adoption_management_categories()) category
  where not exists(select 1 from public.adoption_items i
    where i.program_id=p_program_id and i.organization_id=v_org and i.category=category
      and i.status<>'cancelled');
  if v_missing is not null then
    return jsonb_build_object('error','all thirteen adoption disciplines require an owned plan','missing',to_jsonb(v_missing));
  end if;
  perform set_config('app.adoption_management_write','granted',true);
  update public.adoption_programs set status='active',activated_by=auth.uid(),
    activated_at=now(),updated_at=now() where id=p_program_id;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,adoption_program_id)
  values(v_org,'approved',v_role,auth.uid()::text,btrim(p_basis),
    'A rollout without owned change controls can create unsafe workarounds, false adoption, or stranded benefits.',
    'All thirteen U23.01 disciplines are planned with named owners and dates.',now(),p_program_id);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_program_activated',v_role,jsonb_build_object(
    'program_id',p_program_id,'category_count',13,'operational_authority',false));
  return jsonb_build_object('programId',p_program_id,'status','active','categoryCount',13,
    'operationalAuthority',false);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.set_adoption_item_status(
  p_item_id uuid,p_status text,p_note text,p_evidence_item_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_item public.adoption_items%rowtype; v_program_status text;
begin
  if v_org is null or not public.adoption_management_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if p_status not in ('planned','in_progress','blocked','complete','cancelled') then
    return jsonb_build_object('error','invalid item status');
  end if;
  select i.* into v_item
  from public.adoption_items i
  where i.id=p_item_id and i.organization_id=v_org;
  if not found then return jsonb_build_object('error','adoption item not found'); end if;
  select p.status into v_program_status from public.adoption_programs p
    where p.id=v_item.program_id and p.organization_id=v_org;
  if v_program_status<>'active' then
    return jsonb_build_object('error','item execution is available only while the program is active');
  end if;
  if p_status in ('blocked','complete','cancelled') and length(btrim(coalesce(p_note,'')))<20 then
    return jsonb_build_object('error','blocked, completed and cancelled items require a substantive basis');
  end if;
  if p_status='complete' and not exists(select 1 from public.evidence_items e
    where e.id=p_evidence_item_id and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('error','completion requires same-tenant independently verified canonical evidence');
  end if;
  if p_status='complete' and v_item.category in ('adoption_metrics','benefits_tracking')
     and not (
       exists(select 1 from public.value_metrics v where v.organization_id=v_org
         and v.adoption_item_id=p_item_id and v.adoption_point='baseline')
       and exists(select 1 from public.value_metrics v where v.organization_id=v_org
         and v.adoption_item_id=p_item_id and v.adoption_point='target')
       and exists(select 1 from public.value_metrics v where v.organization_id=v_org
         and v.adoption_item_id=p_item_id and v.adoption_point='actual')
     ) then
    return jsonb_build_object('error','measurement items require baseline, target and actual canonical value points before completion');
  end if;
  perform set_config('app.adoption_management_write','granted',true);
  update public.adoption_items set status=p_status,
    evidence_item_id=case when p_status='complete' then p_evidence_item_id else null end,
    evidence_basis=case when p_status in ('blocked','complete','cancelled') then btrim(p_note) else null end,
    updated_by=auth.uid(),updated_at=now() where id=p_item_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_item_status_changed',v_role,jsonb_build_object(
    'program_id',v_item.program_id,'item_id',p_item_id,'category',v_item.category,
    'from_status',v_item.status,'to_status',p_status,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('itemId',p_item_id,'status',p_status);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.record_adoption_value_point(
  p_item_id uuid,p_point text,p_value numeric,p_unit text,p_basis text,p_evidence_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_item public.adoption_items%rowtype; v_program_status text; v_id uuid; v_metric_type text;
begin
  if v_org is null or not public.adoption_management_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if p_point not in ('baseline','target','actual') or p_value is null
     or p_value in ('Infinity'::numeric,'-Infinity'::numeric)
     or length(btrim(coalesce(p_unit,'')))<1 or length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('error','point, finite value, unit and substantive basis are required');
  end if;
  select i.* into v_item
  from public.adoption_items i
  where i.id=p_item_id and i.organization_id=v_org;
  if not found or v_item.category not in ('adoption_metrics','benefits_tracking') then
    return jsonb_build_object('error','adoption measurement item not found');
  end if;
  select p.status into v_program_status from public.adoption_programs p
    where p.id=v_item.program_id and p.organization_id=v_org;
  if v_program_status<>'active' then
    return jsonb_build_object('error','measurements can be recorded only while the program is active');
  end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id
    and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('error','value point requires same-tenant verified canonical evidence');
  end if;
  v_metric_type:=case when v_item.category='adoption_metrics'
    then 'adoption_progress' else 'adoption_benefit' end;
  perform set_config('app.adoption_value_write','granted',true);
  insert into public.value_metrics(
    organization_id,metric_type,label,value,unit,status,period,owner_id,expected_date,
    basis,evidence_item_id,recorded_by,adoption_item_id,adoption_point)
  values(v_org,v_metric_type,v_item.title||' — '||p_point,p_value,btrim(p_unit),
    case when p_point='actual' then 'baseline_pending_validation' else 'projected' end,
    current_date::text,v_item.owner_id,v_item.due_on,btrim(p_basis),p_evidence_item_id,
    auth.uid(),p_item_id,p_point) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_value_point_recorded',v_role,jsonb_build_object(
    'program_id',v_item.program_id,'item_id',p_item_id,'metric_id',v_id,
    'point',p_point,'status',case when p_point='actual' then 'baseline_pending_validation' else 'projected' end));
  return jsonb_build_object('metricId',v_id,'itemId',p_item_id,'point',p_point,
    'status',case when p_point='actual' then 'baseline_pending_validation' else 'projected' end);
exception when unique_violation then
  return jsonb_build_object('error',p_point||' is already pinned for this item; record observations as actual points');
when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.submit_adoption_program(p_program_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_program public.adoption_programs%rowtype; v_missing text[]; v_open int; v_bad_metrics int;
begin
  if v_org is null or not public.adoption_management_author_role(v_role) then
    return jsonb_build_object('error','forbidden');
  end if;
  if length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('error','submission requires a substantive completion basis');
  end if;
  select * into v_program from public.adoption_programs
    where id=p_program_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','adoption program not found'); end if;
  if v_program.status<>'active' then return jsonb_build_object('error','only an active program can be submitted'); end if;
  select array_agg(category order by category) into v_missing
  from unnest(public.adoption_management_categories()) category
  where not exists(select 1 from public.adoption_items i where i.program_id=p_program_id
    and i.organization_id=v_org and i.category=category and i.status='complete');
  if v_missing is not null then
    return jsonb_build_object('error','every adoption discipline requires completed evidence','missing',to_jsonb(v_missing));
  end if;
  select count(*) into v_open from public.adoption_items
    where program_id=p_program_id and organization_id=v_org
      and status not in ('complete','cancelled');
  if v_open>0 then return jsonb_build_object('error','all non-cancelled adoption items must be complete'); end if;
  select count(*) into v_bad_metrics from public.adoption_items i
  where i.program_id=p_program_id and i.organization_id=v_org
    and i.status='complete' and i.category in ('adoption_metrics','benefits_tracking')
    and not (
      exists(select 1 from public.value_metrics v where v.adoption_item_id=i.id and v.organization_id=v_org and v.adoption_point='baseline')
      and exists(select 1 from public.value_metrics v where v.adoption_item_id=i.id and v.organization_id=v_org and v.adoption_point='target')
      and exists(select 1 from public.value_metrics v where v.adoption_item_id=i.id and v.organization_id=v_org and v.adoption_point='actual')
      and (select count(distinct v.unit) from public.value_metrics v where v.adoption_item_id=i.id and v.organization_id=v_org) = 1
    );
  if v_bad_metrics>0 then
    return jsonb_build_object('error','adoption and benefit measures require comparable baseline, target and actual points in one unit');
  end if;
  perform set_config('app.adoption_management_write','granted',true);
  update public.adoption_programs set status='review_pending',submitted_by=auth.uid(),
    submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null,updated_at=now()
  where id=p_program_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_program_submitted',v_role,jsonb_build_object(
    'program_id',p_program_id,'basis',btrim(p_basis),'independent_review_required',true));
  return jsonb_build_object('programId',p_program_id,'status','review_pending');
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.review_adoption_program(
  p_program_id uuid,p_decision text,p_review_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_program public.adoption_programs%rowtype; v_new_status text;
begin
  if v_org is null or v_role not in ('admin','executive') then
    return jsonb_build_object('error','independent program review requires an administrator or executive');
  end if;
  if p_decision not in ('approved','rejected') or length(btrim(coalesce(p_review_note,'')))<20 then
    return jsonb_build_object('error','approved/rejected decision and substantive review note are required');
  end if;
  select * into v_program from public.adoption_programs
    where id=p_program_id and organization_id=v_org;
  if not found or v_program.status<>'review_pending' then
    return jsonb_build_object('error','review-pending adoption program not found');
  end if;
  if auth.uid()=v_program.created_by or auth.uid()=v_program.submitted_by then
    return jsonb_build_object('error','the program author or submitter cannot perform its independent closeout review');
  end if;
  v_new_status:=case when p_decision='approved' then 'completed' else 'active' end;
  perform set_config('app.adoption_management_write','granted',true);
  update public.adoption_programs set status=v_new_status,reviewed_by=auth.uid(),
    reviewed_at=now(),review_note=btrim(p_review_note),updated_at=now()
  where id=p_program_id;
  if p_decision='approved' then
    perform set_config('app.adoption_value_write','granted',true);
    update public.value_metrics v set status='verified',verified_by=auth.uid(),
      verified_at=now(),verification_note=btrim(p_review_note)
    where v.organization_id=v_org and v.adoption_point='actual'
      and v.status='baseline_pending_validation'
      and exists(select 1 from public.adoption_items i
        where i.id=v.adoption_item_id and i.program_id=p_program_id and i.organization_id=v_org);
  end if;
  insert into public.approvals(organization_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,adoption_program_id)
  values(v_org,p_decision,v_role,auth.uid()::text,btrim(p_review_note),
    'False completion can conceal low uptake, unsafe workarounds, unchanged procedures, or unrealized benefits.',
    'Independent review of all thirteen evidenced disciplines and the recorded adoption/benefit observations.',
    now(),p_program_id);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'adoption_program_reviewed',v_role,jsonb_build_object(
    'program_id',p_program_id,'decision',p_decision,'status',v_new_status,
    'operational_authority',false));
  return jsonb_build_object('programId',p_program_id,'decision',p_decision,
    'status',v_new_status,'operationalAuthority',false);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.get_adoption_management_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'categories',to_jsonb(public.adoption_management_categories()),
    'people',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',coalesce(nullif(p.full_name,''),p.email,p.id::text),'role',p.role)
      order by coalesce(nullif(p.full_name,''),p.email,p.id::text))
      from public.user_profiles p where p.organization_id=v_org),'[]'::jsonb),
    'maturityAssessments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'title',a.title,'overallLevel',a.overall_level,'approvedAt',a.reviewed_at)
      order by a.reviewed_at desc)
      from public.organizational_maturity_assessments a
      where a.organization_id=v_org and a.status='approved'),'[]'::jsonb),
    'programs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'title',p.title,'objective',p.objective,'scope',p.scope,
      'maturityAssessmentId',p.maturity_assessment_id,'sponsorId',p.sponsor_id,
      'sponsor',coalesce(sp.full_name,sp.email,p.sponsor_id::text),
      'processOwnerId',p.process_owner_id,
      'processOwner',coalesce(po.full_name,po.email,p.process_owner_id::text),
      'startsOn',p.starts_on,'targetOn',p.target_on,'status',p.status,
      'createdBy',p.created_by,'submittedBy',p.submitted_by,
      'reviewedBy',p.reviewed_by,'reviewedAt',p.reviewed_at,'reviewNote',p.review_note,
      'progress',jsonb_build_object(
        'plannedCategories',(select count(distinct i.category) from public.adoption_items i where i.program_id=p.id and i.status<>'cancelled'),
        'completedCategories',(select count(distinct i.category) from public.adoption_items i where i.program_id=p.id and i.status='complete'),
        'openItems',(select count(*) from public.adoption_items i where i.program_id=p.id and i.status not in ('complete','cancelled'))),
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'category',i.category,'title',i.title,'affectedGroup',i.affected_group,
        'ownerId',i.owner_id,'owner',coalesce(op.full_name,op.email,i.owner_id::text),
        'ownerRole',i.owner_role_snapshot,'plan',i.plan,'successMeasure',i.success_measure,
        'sourceReference',i.source_reference,'impactLevel',i.impact_level,
        'safetyGuardrail',i.safety_guardrail,'dueOn',i.due_on,'status',i.status,
        'evidenceItemId',i.evidence_item_id,'evidenceBasis',i.evidence_basis,
        'valuePoints',coalesce((select jsonb_agg(jsonb_build_object(
          'id',v.id,'point',v.adoption_point,'value',v.value,'unit',v.unit,
          'status',v.status,'basis',v.basis,'recordedAt',v.created_at)
          order by v.created_at)
          from public.value_metrics v where v.organization_id=v_org
            and v.adoption_item_id=i.id),'[]'::jsonb)) order by i.category,i.created_at)
        from public.adoption_items i left join public.user_profiles op on op.id=i.owner_id
        where i.program_id=p.id),'[]'::jsonb)) order by p.created_at desc)
      from public.adoption_programs p
      left join public.user_profiles sp on sp.id=p.sponsor_id
      left join public.user_profiles po on po.id=p.process_owner_id
      where p.organization_id=v_org),'[]'::jsonb),
    'basis','All thirteen adoption disciplines are explicit. Completion requires verified evidence; adoption and benefit observations are independently reviewed. No plant, work-release, procedure-change, spending or risk-acceptance authority is granted.'
  );
end $$;

revoke all on function public.create_adoption_program(jsonb) from public,anon;
revoke all on function public.upsert_adoption_item(uuid,jsonb) from public,anon;
revoke all on function public.activate_adoption_program(uuid,text) from public,anon;
revoke all on function public.set_adoption_item_status(uuid,text,text,uuid) from public,anon;
revoke all on function public.record_adoption_value_point(uuid,text,numeric,text,text,uuid) from public,anon;
revoke all on function public.submit_adoption_program(uuid,text) from public,anon;
revoke all on function public.review_adoption_program(uuid,text,text) from public,anon;
revoke all on function public.get_adoption_management_workspace() from public,anon;

grant execute on function public.create_adoption_program(jsonb) to authenticated;
grant execute on function public.upsert_adoption_item(uuid,jsonb) to authenticated;
grant execute on function public.activate_adoption_program(uuid,text) to authenticated;
grant execute on function public.set_adoption_item_status(uuid,text,text,uuid) to authenticated;
grant execute on function public.record_adoption_value_point(uuid,text,numeric,text,text,uuid) to authenticated;
grant execute on function public.submit_adoption_program(uuid,text) to authenticated;
grant execute on function public.review_adoption_program(uuid,text,text) to authenticated;
grant execute on function public.get_adoption_management_workspace() to authenticated;
