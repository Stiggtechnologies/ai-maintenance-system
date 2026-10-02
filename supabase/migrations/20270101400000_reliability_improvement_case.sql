-- ============================================================================
-- C1.03 — Reliability Engineer composite improvement workflow.
--
-- Canonical homes are composed, never copied:
--   * work_orders + assets: tenant bad-actor screening inputs;
--   * fracas_investigation_packs: governed investigation and evidence plan;
--   * development_cases: the ONE improvement/project case;
--   * development_case_assets: the ONE case asset scope;
--   * existing case RAM/FMEA/PM strategy services: engineering analysis.
--
-- The only new persistence is an immutable relationship between a retained
-- FRACAS pack and the canonical Development Case created from it. Starting a
-- case does not verify root cause, approve strategy, authorize work, accept
-- risk, commit spend or sanction the case.
-- ============================================================================

create table if not exists public.fracas_improvement_case_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fracas_pack_id uuid not null unique
    references public.fracas_investigation_packs(id) on delete restrict,
  development_case_id uuid not null unique
    references public.development_cases(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_fracas_improvement_case_links_org_asset
  on public.fracas_improvement_case_links(organization_id,asset_id,created_at desc);

alter table public.fracas_improvement_case_links enable row level security;
drop policy if exists fracas_improvement_case_links_read
  on public.fracas_improvement_case_links;
create policy fracas_improvement_case_links_read
  on public.fracas_improvement_case_links for select to authenticated
  using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.fracas_improvement_case_links
  from public,anon,authenticated;
grant select on public.fracas_improvement_case_links to authenticated;

create or replace function public.enforce_fracas_improvement_case_link()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_marker text:=coalesce(current_setting('app.fracas_improvement_link_write',true),'');
  v_pack_org uuid;
  v_pack_asset uuid;
  v_case_org uuid;
  v_case_lifecycle text;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'reliability improvement links are append-only; retain the original FRACAS-to-case provenance';
  end if;
  if v_marker<>'granted' then
    raise exception 'reliability improvement links are written only by start_reliability_improvement_case()';
  end if;
  select organization_id,asset_id into v_pack_org,v_pack_asset
  from public.fracas_investigation_packs where id=new.fracas_pack_id;
  select organization_id,lifecycle_type into v_case_org,v_case_lifecycle
  from public.development_cases where id=new.development_case_id;
  if v_pack_org is null or v_case_org is null
     or v_pack_org is distinct from new.organization_id
     or v_case_org is distinct from new.organization_id
     or v_pack_asset is distinct from new.asset_id then
    raise exception 'FRACAS pack, asset and development case must share one organization boundary';
  end if;
  if v_case_lifecycle is distinct from 'reliability_improvement' then
    raise exception 'a FRACAS improvement link requires a reliability_improvement development case';
  end if;
  if not exists(select 1 from public.development_case_assets s
    where s.organization_id=new.organization_id
      and s.development_case_id=new.development_case_id
      and s.asset_id=new.asset_id) then
    raise exception 'the FRACAS asset must already be bound to the development case scope';
  end if;
  if not exists(select 1 from public.user_profiles p
    where p.id=new.created_by and p.organization_id=new.organization_id) then
    raise exception 'the improvement-case actor must be a named member of this organization';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_fracas_improvement_case_link()
  from public,anon,authenticated;
drop trigger if exists trg_enforce_fracas_improvement_case_link
  on public.fracas_improvement_case_links;
create trigger trg_enforce_fracas_improvement_case_link
  before insert or update or delete on public.fracas_improvement_case_links
  for each row execute function public.enforce_fracas_improvement_case_link();

-- Tenant-relative bad-actor intake. The window is anchored to the newest
-- completed corrective event in this tenant, not wall-clock time, so a static
-- imported history remains readable without pretending it is current. Rank is
-- recorded downtime first and event count second; it is explicitly not an
-- exposure-normalized failure rate or a criticality determination.
create or replace function public.get_reliability_improvement_workspace(
  p_window_days int default 365
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_days int:=coalesce(p_window_days,365);
  v_data_through timestamptz;
  v_window_start timestamptz;
  v_assets jsonb:='[]'::jsonb;
  v_frameworks jsonb:='[]'::jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  if v_days<30 or v_days>3650 then
    return jsonb_build_object('error','window_days must be between 30 and 3650');
  end if;
  select max(w.completed_at) into v_data_through
  from public.work_orders w
  where w.organization_id=v_org and w.work_type='corrective'
    and w.completed_at is not null;
  if v_data_through is not null then
    v_window_start:=v_data_through-make_interval(days=>v_days);
  end if;

  with screened as (
    select a.id asset_id,coalesce(a.asset_tag,a.tag,a.id::text) asset_tag,
      a.name,a.criticality,count(*)::int corrective_events,
      round(coalesce(sum(greatest(coalesce(w.downtime_hours,0),0)),0)::numeric,2)
        downtime_hours,
      count(*) filter(where w.failure_mechanism_id is not null)::int coded_events,
      count(*) filter(where w.failure_mechanism_id is null)::int uncoded_events,
      max(w.completed_at) latest_failure_at
    from public.work_orders w
    join public.assets a on a.id=w.asset_id and a.organization_id=v_org
    where w.organization_id=v_org and w.work_type='corrective'
      and w.completed_at is not null
      and (v_window_start is null or w.completed_at>v_window_start)
      and w.completed_at<=v_data_through
    group by a.id,a.asset_tag,a.tag,a.name,a.criticality
  ), ranked as (
    select s.*,row_number() over(
      order by s.downtime_hours desc,s.corrective_events desc,
        s.latest_failure_at desc,s.asset_id)::int screening_rank
    from screened s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'rank',r.screening_rank,'assetId',r.asset_id,'assetTag',r.asset_tag,
      'name',r.name,'criticality',r.criticality,
      'correctiveEvents',r.corrective_events,
      'downtimeHours',r.downtime_hours,'codedEvents',r.coded_events,
      'uncodedEvents',r.uncoded_events,'latestFailureAt',r.latest_failure_at,
      'fracasPacks',coalesce((
        select jsonb_agg(jsonb_build_object(
          'packId',q.pack_id,'workOrderId',q.work_order_id,
          'workOrderNumber',q.wo_number,'createdAt',q.created_at,
          'assignedTo',q.assigned_to,'ownerName',q.owner_name,
          'dueDate',q.due_date,'caseId',q.case_id,'caseStatus',q.case_status)
          order by q.created_at desc,q.pack_id)
        from (
          select p.id pack_id,p.work_order_id,w.wo_number,p.created_at,
            assignment.assigned_to,
            coalesce(owner.full_name,owner.email) owner_name,
            assignment.due_date,l.development_case_id case_id,c.status case_status
          from public.fracas_investigation_packs p
          join public.work_orders w on w.id=p.work_order_id
            and w.organization_id=p.organization_id
          left join lateral (
            select x.assigned_to,x.due_date
            from public.fracas_investigation_assignments x
            where x.organization_id=v_org and x.investigation_pack_id=p.id
            order by x.assigned_at desc,x.id desc limit 1
          ) assignment on true
          left join public.user_profiles owner on owner.id=assignment.assigned_to
            and owner.organization_id=v_org
          left join public.fracas_improvement_case_links l
            on l.organization_id=v_org and l.fracas_pack_id=p.id
          left join public.development_cases c on c.id=l.development_case_id
            and c.organization_id=v_org
          where p.organization_id=v_org and p.asset_id=r.asset_id
        ) q
      ),'[]'::jsonb)
    ) order by r.screening_rank),'[]'::jsonb) into v_assets
  from ranked r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'name',f.name,'version',f.version,
    'sourceAuthority',f.source_authority) order by f.name,f.version desc),'[]'::jsonb)
  into v_frameworks
  from public.project_frameworks f
  where f.organization_id=v_org and f.status='adopted';

  return jsonb_build_object(
    'windowDays',v_days,'windowStart',v_window_start,'dataThrough',v_data_through,
    'rankedAssets',v_assets,'frameworks',v_frameworks,
    'rankingBasis','Completed corrective work in the tenant-relative window, ranked by recorded downtime then event count. This is a screening order, not exposure-normalized reliability or a criticality determination.',
    'nextStep','Select a retained FRACAS pack with a named human investigator, then frame the canonical reliability-improvement Development Case.',
    'humanApprovalRequired',true,'mayApproveStrategy',false,
    'mayAuthorizeWork',false,'maySanctionCase',false);
end
$$;
revoke all on function public.get_reliability_improvement_workspace(int)
  from public,anon;
grant execute on function public.get_reliability_improvement_workspace(int)
  to authenticated,service_role;

create or replace function public.start_reliability_improvement_case(
  p_fracas_pack_id uuid,
  p_title text,
  p_problem_statement text,
  p_opportunity_statement text default null,
  p_framework_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_pack public.fracas_investigation_packs%rowtype;
  v_assignment uuid;
  v_owner uuid;
  v_case_result jsonb;
  v_bind_result jsonb;
  v_case_id uuid;
  v_link_id uuid;
  v_existing public.fracas_improvement_case_links%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','starting a reliability improvement case requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into v_pack from public.fracas_investigation_packs
  where id=p_fracas_pack_id and organization_id=v_org;
  if not found then
    return jsonb_build_object('error','FRACAS investigation pack not found in this organization');
  end if;
  select * into v_existing from public.fracas_improvement_case_links
  where organization_id=v_org and fracas_pack_id=v_pack.id;
  if found then
    return jsonb_build_object(
      'linkId',v_existing.id,'caseId',v_existing.development_case_id,
      'assetId',v_existing.asset_id,'existing',true,
      'route','/develop/cases/'||v_existing.development_case_id::text||'#case-ram',
      'humanApprovalRequired',true,'mayApproveStrategy',false,
      'mayAuthorizeWork',false,'maySanctionCase',false);
  end if;
  select a.id,a.assigned_to into v_assignment,v_owner
  from public.fracas_investigation_assignments a
  join public.user_profiles owner on owner.id=a.assigned_to
    and owner.organization_id=v_org
  where a.organization_id=v_org and a.investigation_pack_id=v_pack.id
  order by a.assigned_at desc,a.id desc limit 1;
  if v_assignment is null or v_owner is null then
    return jsonb_build_object('error','assign a named human investigator to the FRACAS pack before starting an improvement case');
  end if;

  v_case_result:=public.create_development_case(
    p_title,p_problem_statement,'reliability_improvement',
    p_opportunity_statement,p_framework_id,null,null,null,null,null,v_owner);
  if v_case_result ? 'error' then
    return v_case_result;
  end if;
  v_case_id:=(v_case_result->>'case_id')::uuid;
  v_bind_result:=public.bind_asset_to_development_case(
    v_pack.asset_id,v_case_id,
    'Bound from retained FRACAS pack '||v_pack.id::text||
      ' for governed reliability-improvement follow-through.',false);
  if v_bind_result ? 'error' then
    raise exception 'reliability improvement case binding failed: %',
      v_bind_result->>'error';
  end if;

  perform set_config('app.fracas_improvement_link_write','granted',true);
  insert into public.fracas_improvement_case_links(
    organization_id,fracas_pack_id,development_case_id,asset_id,created_by)
  values(v_org,v_pack.id,v_case_id,v_pack.asset_id,auth.uid())
  returning id into v_link_id;
  perform set_config('app.fracas_improvement_link_write','',true);

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'fracas_improvement_case',v_role,jsonb_build_object(
      'action','canonical_case_started','link_id',v_link_id,
      'fracas_pack_id',v_pack.id,'development_case_id',v_case_id,
      'asset_id',v_pack.asset_id,'named_investigator',v_owner,
      'created_by',auth.uid()),null,jsonb_build_object(
      'case_status','active','lifecycle_type','reliability_improvement',
      'asset_bound',true,'strategy_approved',false,'work_authorized',false,
      'case_sanctioned',false));

  return jsonb_build_object(
    'linkId',v_link_id,'caseId',v_case_id,'assetId',v_pack.asset_id,
    'existing',false,'route','/develop/cases/'||v_case_id::text||'#case-ram',
    'nextStep','Review the case-scoped RAM/FMEA/PM strategy evidence and frame value; consequential acts remain with the named human authority.',
    'humanApprovalRequired',true,'mayApproveStrategy',false,
    'mayAuthorizeWork',false,'maySanctionCase',false);
end
$$;
revoke all on function public.start_reliability_improvement_case(uuid,text,text,text,uuid)
  from public,anon;
grant execute on function public.start_reliability_improvement_case(uuid,text,text,text,uuid)
  to authenticated,service_role;

notify pgrst,'reload schema';
