-- ============================================================================
-- C1.08 — governed MRO Materials Specialist execution.
--
-- The specialist reads the canonical material catalogue, stock, lot, demand,
-- event, BOM, supplier, delivery, substitution and installed-component
-- records. It freezes their exact state into an immutable assessment covering
-- critical spares, existing reorder policies, repairables, stockouts and
-- obsolescence. It never creates a purchase order, changes stock, reserves or
-- issues material, approves a supplier/substitution, changes a stocking policy,
-- commits spend or releases work. Every operational response remains a named
-- human decision through the existing control and audit models.
-- ============================================================================

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'analyse_mro_material_position','Analyse MRO material position',
  'Screen exact catalogue, stock, demand, repairable and supplier evidence without changing inventory, procurement, work or engineering authority.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'inventory_management','MRO Materials Specialist','specialist',
       'active','advisory','Waiting for a governed material-position review',
       'Maintenance Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='inventory_management'
);

update public.ai_agents
set name='MRO Materials Specialist',category='specialist',
    autonomy_mode='advisory',supervisor='Maintenance Manager',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact MRO catalogue, stock, demand, supplier and repair-loop evidence into a retained material-position assessment and named-human review hand-off.',
      'modes',jsonb_build_array('critical spares','reorder policies','repairables','stockouts','obsolescence'),
      'triggers',jsonb_build_array('human review request','open shortage','existing minimum breach','sole-source exposure','last-time-buy or obsolescence exposure','repair-loop evidence gap'),
      'inputs',jsonb_build_array('material catalogue','stock position','stock lots and certification','work demand','material event history','BOM usage','installed components','supplier qualification and lifecycle','delivery history','approved alternatives'),
      'outputs',jsonb_build_array('immutable material-position assessment','exact source snapshot','five-mode posture','evidence gaps','review plan','named-human review hand-off'),
      'guardrails',jsonb_build_array(
        'Never treat missing stock records as zero stock or template catalogue rows as operator data',
        'Never invent demand, service level, lead time, safety stock, supplier qualification, remaining asset life or repair turnaround',
        'Never create a purchase order, change stock, reserve or issue material, or release work',
        'Never approve a supplier, substitution, reorder policy, engineering use, spend or risk acceptance',
        'Require named-human review for every operational or commercial response'),
      'routes',jsonb_build_array('/materials'))
where key='inventory_management';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_mro_materials_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_mro_materials_charter_shape
      check (key <> 'inventory_management' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Only untouched platform baselines are extended. A tenant-authored control
-- history is not replaced by a migration and therefore continues to fail
-- closed until its administrator explicitly grants the new analysis tool.
do $$
declare
  r record;
  v_profile uuid;
  v_version integer;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id,a.organization_id,p.id old_profile,p.basis old_basis,
           p.required_human_approver_role,p.proposal_risk_ceiling,
           p.proposal_cost_ceiling_usd,p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    left join public.agent_control_profiles p
      on p.agent_id=a.id and p.organization_id=a.organization_id
     and p.status='adopted'
    where a.key='inventory_management'
  loop
    if r.old_profile is not null and r.old_basis <> v_basis then continue; end if;
    if r.old_profile is null and exists (
      select 1 from public.agent_control_profiles history
      where history.agent_id=r.agent_id
    ) then continue; end if;
    select coalesce(max(version),0)+1 into v_version
    from public.agent_control_profiles where agent_id=r.agent_id;
    if r.old_profile is not null then
      update public.agent_control_profiles set status='superseded'
      where id=r.old_profile;
    end if;
    insert into public.agent_control_profiles
      (organization_id,agent_id,authority_mode,required_human_approver_role,
       proposal_risk_ceiling,proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_at)
    values
      (r.organization_id,r.agent_id,'advisory_only',
       coalesce(r.required_human_approver_role,'maintenance_manager'),
       coalesce(r.proposal_risk_ceiling,'Critical'),
       coalesce(r.proposal_cost_ceiling_usd,0),
       coalesce(r.proposal_downtime_ceiling_hours,0),false,
       v_basis,'draft',v_version,null)
    returning id into v_profile;

    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d
    where d.right_key='identify_missing_materials_docs';

    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in
      ('analyse_mro_material_position','read_work_context','draft_recommendation');

    update public.agent_control_profiles
    set status='adopted',adopted_at=now() where id=v_profile;
  end loop;
end
$$;

-- Material scope is canonical for this specialist. Extend the shared retained
-- run guard while preserving every existing planner, site, reliability,
-- FRACAS and condition-monitoring path.
alter table public.agent_runs
  add column if not exists material_id uuid references public.materials(id) on delete set null;
create index if not exists idx_agent_runs_retained_material
  on public.agent_runs(organization_id,material_id,created_at desc)
  where retained_for_governance;

create or replace function public.enforce_retained_agent_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_planner_marker text := coalesce(current_setting('app.planner_agent_run_write',true),'');
  v_site_marker text := coalesce(current_setting('app.site_manager_agent_run_write',true),'');
  v_reliability_marker text := coalesce(current_setting('app.reliability_agent_run_write',true),'');
  v_fracas_marker text := coalesce(current_setting('app.fracas_agent_run_write',true),'');
  v_condition_marker text := coalesce(current_setting('app.condition_agent_run_write',true),'');
  v_mro_marker text := coalesce(current_setting('app.mro_materials_agent_run_write',true),'');
  v_allowed boolean := v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted'
    or v_condition_marker='granted' or v_mro_marker='granted';
begin
  if tg_op='DELETE' and old.retained_for_governance then return null; end if;
  if tg_op='UPDATE' and old.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op='INSERT' and new.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are written only by a governed agent execution path';
  end if;
  if tg_op <> 'DELETE' and new.retained_for_governance then
    if new.requested_by is null
       or (new.work_order_id is null and new.site_id is null
           and nullif(btrim(new.component_scope),'') is null
           and new.asset_id is null and new.material_id is null)
       or new.agent_control_profile_id is null
       or coalesce(btrim(new.agent_tool_key),'')=''
       or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component/asset/material scope, control profile, tool and decision-right provenance';
    end if;
    if not exists (select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists (select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.asset_id is not null and not exists (select 1 from public.assets a
      where a.id=new.asset_id and a.organization_id=new.organization_id) then
      raise exception 'agent run names an asset outside its organization';
    end if;
    if new.material_id is not null and not exists (select 1 from public.materials m
      where m.id=new.material_id and m.organization_id=new.organization_id) then
      raise exception 'agent run names a material outside its organization';
    end if;
    if new.work_order_id is not null and not exists (select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.site_id is not null and not exists (select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id) then
      raise exception 'agent run names a site outside its organization';
    end if;
    if nullif(btrim(new.component_scope),'') is not null and not exists (
      select 1 from public.component_life_events e
      where e.organization_id=new.organization_id
        and lower(e.component)=lower(btrim(new.component_scope))) then
      raise exception 'agent run names a component population outside its organization';
    end if;
    if new.job_plan_id is not null and not exists (select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists (select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id
        and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted') then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create table if not exists public.mro_material_agent_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  window_days integer not null check (window_days between 30 and 1095),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  assessment jsonb not null check (jsonb_typeof(assessment)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_mro_material_agent_packs_material
  on public.mro_material_agent_packs
  (organization_id,material_id,created_at desc);

create table if not exists public.mro_material_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_id uuid not null references public.mro_material_agent_packs(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check (length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now()
);
create index if not exists idx_mro_material_review_assignments
  on public.mro_material_review_assignments
  (organization_id,pack_id,assigned_at desc);

alter table public.mro_material_agent_packs enable row level security;
alter table public.mro_material_review_assignments enable row level security;
drop policy if exists mro_material_agent_packs_read on public.mro_material_agent_packs;
create policy mro_material_agent_packs_read on public.mro_material_agent_packs
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists mro_material_review_assignments_read on public.mro_material_review_assignments;
create policy mro_material_review_assignments_read on public.mro_material_review_assignments
  for select to authenticated using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.mro_material_agent_packs,
  public.mro_material_review_assignments from public,anon,authenticated;
grant select on public.mro_material_agent_packs,
  public.mro_material_review_assignments to authenticated;

create or replace function public.protect_mro_material_agent_records()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.mro_material_record_write',true),'');
begin
  if v_marker<>'granted' then
    raise exception 'MRO-material agent records are written only by the governed assessment workflow';
  end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'MRO-material assessments and review assignments are append-only';
  end if;
  return new;
end $$;
revoke all on function public.protect_mro_material_agent_records()
  from public,anon,authenticated;
drop trigger if exists trg_protect_mro_material_agent_packs on public.mro_material_agent_packs;
create trigger trg_protect_mro_material_agent_packs before insert or update or delete
  on public.mro_material_agent_packs for each row
  execute function public.protect_mro_material_agent_records();
drop trigger if exists trg_protect_mro_material_review_assignments on public.mro_material_review_assignments;
create trigger trg_protect_mro_material_review_assignments before insert or update or delete
  on public.mro_material_review_assignments for each row
  execute function public.protect_mro_material_agent_records();

create or replace function public.run_mro_materials_agent(
  p_material_id uuid,p_window_days int default 365,p_limit int default 200
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  m public.materials%rowtype;
  ag public.ai_agents%rowtype;
  v_control jsonb;
  v_window int:=least(greatest(coalesce(p_window_days,365),30),1095);
  v_limit int:=least(greatest(coalesce(p_limit,200),10),500);
  v_inventory_connector text;
  v_stock jsonb:='[]'::jsonb;
  v_stock_rows int:=0;
  v_on_hand numeric:=0;
  v_reserved numeric:=0;
  v_on_order numeric:=0;
  v_available numeric:=0;
  v_lots jsonb:='[]'::jsonb;
  v_lot_rows int:=0;
  v_serviceable_qty numeric:=0;
  v_lot_cert_gaps int:=0;
  v_demand jsonb:='[]'::jsonb;
  v_open_demand_rows int:=0;
  v_short_lines int:=0;
  v_required numeric:=0;
  v_demand_reserved numeric:=0;
  v_events jsonb:='[]'::jsonb;
  v_event_rows int:=0;
  v_issue_events int:=0;
  v_issued_qty numeric:=0;
  v_return_events int:=0;
  v_shortage_events int:=0;
  v_first_event timestamptz;
  v_last_event timestamptz;
  v_suppliers jsonb:='[]'::jsonb;
  v_supplier_count int:=0;
  v_approved_suppliers int:=0;
  v_unknown_lifecycle int:=0;
  v_eol_suppliers int:=0;
  v_last_time_buy date;
  v_bom jsonb:='[]'::jsonb;
  v_bom_rows int:=0;
  v_assets_using int:=0;
  v_component_instances jsonb:='[]'::jsonb;
  v_installed_components int:=0;
  v_deliveries jsonb:='[]'::jsonb;
  v_substitutions jsonb:='[]'::jsonb;
  v_approved_substitutions int:=0;
  v_lead_time_demand numeric;
  v_reorder_state text;
  v_critical_state text;
  v_repairable_state text;
  v_stockout_state text;
  v_obsolescence_state text;
  v_gaps jsonb:='[]'::jsonb;
  v_plan jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_run uuid;
  v_pack uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','running the MRO Materials Specialist requires a named planner, reliability engineer, maintenance manager or administrator');
  end if;
  select * into m from public.materials
  where id=p_material_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','material not found'); end if;
  if m.is_template then
    return jsonb_build_object('error','template material classes are not operator inventory evidence; create or ingest the customer catalogue identity before assessment');
  end if;
  select * into ag from public.ai_agents
  where organization_id=v_org and key='inventory_management'
  order by created_at limit 1;
  if not found then return jsonb_build_object('error','no MRO Materials Specialist is configured in this organization'); end if;
  v_control:=public.evaluate_agent_control_internal(
    v_org,ag.id,'identify_missing_materials_docs','analyse_mro_material_position',
    case m.criticality when 'critical' then 'Critical'
         when 'essential' then 'High' else 'Medium' end,
    null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','MRO Materials Specialist refused: '||(v_control->>'reason'));
  end if;

  select c.connector_key into v_inventory_connector
  from public.connectors c
  where c.organization_id=v_org and c.enabled
    and coalesce(c.system_kind,c.connector_type) in ('inventory','erp')
  order by c.last_success_at desc nulls last,c.created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'stockId',s.id,'siteId',s.site_id,'siteName',st.name,
      'onHand',s.qty_on_hand,'reserved',s.qty_reserved,
      'available',s.qty_on_hand-s.qty_reserved,'onOrder',s.qty_on_order,
      'expectedReceiptDate',s.expected_receipt_date,
      'lastCountedAt',s.last_counted_at,'sourceSystem',s.source_system,
      'sourcePosture',case when v_inventory_connector is not null
        and s.source_system=v_inventory_connector then 'connector_backed'
        when s.source_system is null then 'source_unknown' else 'manual_or_imported' end)
      order by st.name nulls last,s.id),'[]'::jsonb),
    count(*)::int,coalesce(sum(s.qty_on_hand),0),
    coalesce(sum(s.qty_reserved),0),coalesce(sum(s.qty_on_order),0)
  into v_stock,v_stock_rows,v_on_hand,v_reserved,v_on_order
  from public.material_stock s
  left join public.sites st on st.id=s.site_id and st.organization_id=s.organization_id
  where s.organization_id=v_org and s.material_id=m.id;
  v_available:=v_on_hand-v_reserved;

  select coalesce(jsonb_agg(jsonb_build_object(
      'lotId',l.id,'siteId',l.site_id,'lotRef',l.lot_ref,'quantity',l.qty,
      'condition',l.condition,'certificationStatus',l.certification_status,
      'certificationRef',l.certification_ref,'location',l.location,
      'expiresAt',l.expires_at,'sourceSystem',l.source_system,'basis',l.basis)
      order by l.updated_at desc,l.id),'[]'::jsonb),
    count(*)::int,
    coalesce(sum(l.qty) filter(where l.condition='serviceable'),0),
    count(*) filter(where l.certification_status in ('missing','expired','unknown'))::int
  into v_lots,v_lot_rows,v_serviceable_qty,v_lot_cert_gaps
  from public.material_stock_lots l
  where l.organization_id=v_org and l.material_id=m.id;

  select count(*)::int,
    count(*) filter(where d.status='short')::int,
    coalesce(sum(d.qty_required),0),coalesce(sum(d.qty_reserved),0)
  into v_open_demand_rows,v_short_lines,v_required,v_demand_reserved
  from public.work_order_materials d
  where d.organization_id=v_org and d.material_id=m.id
    and d.status not in ('issued','cancelled');

  select coalesce(jsonb_agg(jsonb_build_object(
      'lineId',d.id,'workOrderId',d.work_order_id,
      'workOrderNumber',w.wo_number,'workOrderTitle',w.title,
      'required',d.qty_required,'reserved',d.qty_reserved,
      'issued',d.qty_issued,'status',d.status,'neededBy',d.needed_by,
      'createdAt',d.created_at)
      order by d.needed_by nulls last,d.created_at,d.id),'[]'::jsonb)
  into v_demand
  from (
    select x.* from public.work_order_materials x
    where x.organization_id=v_org and x.material_id=m.id
      and x.status not in ('issued','cancelled')
    order by x.needed_by nulls last,x.created_at,x.id limit v_limit
  ) d join public.work_orders w on w.id=d.work_order_id
    and w.organization_id=d.organization_id;

  select count(*)::int,
    count(*) filter(where e.event_type='issued')::int,
    coalesce(sum(e.qty) filter(where e.event_type='issued'),0),
    count(*) filter(where e.event_type='returned')::int,
    count(*) filter(where e.event_type='shortage_declared')::int,
    min(e.occurred_at),max(e.occurred_at)
  into v_event_rows,v_issue_events,v_issued_qty,v_return_events,
       v_shortage_events,v_first_event,v_last_event
  from public.material_events e
  where e.organization_id=v_org and e.material_id=m.id
    and e.occurred_at>=now()-make_interval(days=>v_window);

  select coalesce(jsonb_agg(jsonb_build_object(
      'eventId',e.id,'workOrderMaterialId',e.work_order_material_id,
      'eventType',e.event_type,'quantity',e.qty,'note',e.note,
      'sourceSystem',e.source_system,'occurredAt',e.occurred_at)
      order by e.occurred_at desc,e.id desc),'[]'::jsonb)
  into v_events
  from (
    select x.* from public.material_events x
    where x.organization_id=v_org and x.material_id=m.id
      and x.occurred_at>=now()-make_interval(days=>v_window)
    order by x.occurred_at desc,x.id desc limit v_limit
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object(
      'relationshipId',ms.id,'supplierId',s.id,'supplierCode',s.supplier_code,
      'supplierName',s.name,'supplierKind',s.supplier_kind,
      'approvedVendor',s.approved_vendor,
      'approvedForMaterial',ms.approved_for_this_material,
      'supplierPartNumber',ms.supplier_part_number,
      'quotedLeadTimeDays',ms.quoted_lead_time_days,
      'lifecycleStatus',ms.lifecycle_status,
      'lastTimeBuyDate',ms.last_time_buy_date,
      'endOfSupportDate',ms.end_of_support_date,
      'safetyQualification',s.safety_qualification_status,
      'safetyQualificationExpires',s.safety_qualification_expires,
      'deliveryEvents',(select count(*) from public.supplier_deliveries sd
        where sd.organization_id=v_org and sd.material_id=m.id
          and sd.supplier_id=s.id))
      order by ms.approved_for_this_material desc,s.name),'[]'::jsonb),
    count(*)::int,
    count(*) filter(where ms.approved_for_this_material and s.approved_vendor)::int,
    count(*) filter(where ms.lifecycle_status='unknown')::int,
    count(*) filter(where ms.lifecycle_status in ('last_time_buy','end_of_life','obsolete'))::int,
    min(ms.last_time_buy_date)
  into v_suppliers,v_supplier_count,v_approved_suppliers,
       v_unknown_lifecycle,v_eol_suppliers,v_last_time_buy
  from public.material_suppliers ms
  join public.suppliers s on s.id=ms.supplier_id
    and s.organization_id=ms.organization_id
  where ms.organization_id=v_org and ms.material_id=m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'deliveryId',d.id,'supplierId',d.supplier_id,
      'supplierName',s.name,'orderedOn',d.ordered_on,
      'promisedOn',d.promised_on,'receivedOn',d.received_on,
      'quantity',d.quantity,'qualityOutcome',d.quality_outcome,
      'note',d.note)
      order by d.ordered_on desc,d.id desc),'[]'::jsonb)
  into v_deliveries
  from (
    select x.* from public.supplier_deliveries x
    where x.organization_id=v_org and x.material_id=m.id
    order by x.ordered_on desc,x.id desc limit v_limit
  ) d join public.suppliers s on s.id=d.supplier_id
    and s.organization_id=d.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'bomLineId',b.id,'assetId',b.asset_id,'assetTag',coalesce(a.asset_tag,a.tag),
      'assetName',a.name,'assetClass',coalesce(b.asset_class,a.asset_class),
      'componentId',b.component_id,'quantityPer',b.qty_per,
      'positionNote',b.position_note,'sourceSystem',b.source_system)
      order by coalesce(a.asset_tag,a.tag,a.name,b.asset_class),b.id),'[]'::jsonb),
    count(*)::int,count(distinct b.asset_id)::int
  into v_bom,v_bom_rows,v_assets_using
  from public.bom_lines b
  left join public.assets a on a.id=b.asset_id and a.organization_id=b.organization_id
  where b.organization_id=v_org and b.material_id=m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'componentInstanceId',ci.id,'assetId',ci.asset_id,
      'assetTag',coalesce(a.asset_tag,a.tag),'assetName',a.name,
      'component',ci.component,'position',ci.position,
      'serialNumber',ci.serial_number,'installedAt',ci.installed_at,
      'installedMeterHours',ci.installed_meter_hours,
      'sourceSystem',ci.source_system,'sourceRef',ci.source_ref,
      'basis',ci.basis)
      order by ci.installed_at desc,ci.id),'[]'::jsonb),count(*)::int
  into v_component_instances,v_installed_components
  from public.component_instances ci
  join public.assets a on a.id=ci.asset_id and a.organization_id=ci.organization_id
  where ci.organization_id=v_org and ci.material_id=m.id and ci.state='installed';

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceModel',s.source_model,'substitutionId',s.record_id,
      'substituteMaterialId',s.substitute_material_id,
      'substituteCode',sm.material_code,'substitutionType',s.substitution_type,
      'approvalStatus',s.approval_status,'basis',s.basis,
      'validFrom',s.valid_from,'validUntil',s.valid_until)
      order by s.approval_status,s.valid_from desc),'[]'::jsonb),
    count(*) filter(where s.approval_status='approved'
      and (s.valid_from is null or s.valid_from<=now())
      and (s.valid_until is null or s.valid_until>=now()))::int
  into v_substitutions,v_approved_substitutions
  from (
    select 'material_substitutions'::text source_model,id::text record_id,
      substitute_material_id,substitution_type,approval_status,basis,
      valid_from,valid_until
    from public.material_substitutions
    where organization_id=v_org and material_id=m.id
    union all
    select 'approved_substitutions'::text,id::text,
      case when specified_material_id=m.id then substitute_material_id
        else specified_material_id end,
      'approved_alternate'::text,
      case when approved_at is null then 'pending'
        when expires_at is not null and expires_at<now() then 'expired'
        else 'approved' end,
      coalesce(nullif(btrim(conditions),''),
        'No conditions recorded on legacy approved-substitution row.'),
      approved_at,expires_at
    from public.approved_substitutions
    where organization_id=v_org
      and (specified_material_id=m.id
        or (is_bidirectional and substitute_material_id=m.id))
  ) s
  join public.materials sm on sm.id=s.substitute_material_id
    and sm.organization_id=v_org;

  if m.lead_time_days is not null and v_window>0 and v_issue_events>=3 then
    v_lead_time_demand:=round((v_issued_qty/v_window::numeric)*m.lead_time_days,4);
  end if;

  v_reorder_state:=case
    when v_stock_rows=0 then 'unassessable_no_stock_record'
    when m.min_qty is null then 'policy_missing_minimum'
    when m.max_qty is not null and m.max_qty<m.min_qty then 'invalid_min_max_policy'
    when v_available<=m.min_qty then 'existing_minimum_reached_or_breached'
    else 'above_existing_minimum' end;
  v_critical_state:=case
    when m.criticality is null then 'criticality_unclassified'
    when v_short_lines>0 or v_shortage_events>0 then 'shortage_evidence_present'
    when v_stock_rows=0 then 'stock_position_unassessable'
    when v_open_demand_rows>0 and v_available<(v_required-v_demand_reserved) then 'visible_demand_exceeds_available'
    when m.criticality='critical' and v_approved_suppliers=1 then 'critical_sole_approved_source'
    else 'no_configured_critical_spare_trigger' end;
  v_repairable_state:=case
    when not m.repairable then 'not_applicable_consumable'
    when v_return_events=0 then 'repair_loop_unproven'
    when v_installed_components=0 then 'installed_population_unlinked'
    else 'repairable_history_present_turnaround_unproven' end;
  v_stockout_state:=case
    when v_short_lines>0 then 'open_short_line'
    when v_shortage_events>0 then 'historical_shortage_in_window'
    when v_stock_rows=0 then 'unassessable_no_stock_record'
    else 'no_recorded_stockout_in_selected_evidence' end;
  v_obsolescence_state:=case
    when v_eol_suppliers>0 then 'supplier_lifecycle_exposure'
    when v_supplier_count=0 then 'unassessable_no_supplier_record'
    when v_unknown_lifecycle=v_supplier_count then 'unassessable_lifecycle_unknown'
    when v_assets_using+v_installed_components=0 then 'usage_population_unlinked'
    else 'no_recorded_eol_exposure' end;

  if nullif(btrim(m.basis),'') is null or nullif(btrim(m.source_system),'') is null then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
      'code','catalogue_provenance','severity','attention',
      'detail','The customer catalogue identity lacks a source system or stated basis; the material exists but its master-data provenance is incomplete.'));
  end if;
  if v_stock_rows=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','stock_position','severity','blocker',
    'detail','No stock record exists. Missing inventory is not represented as zero stock, and readiness or reorder conclusions are withheld.'));
  elsif v_inventory_connector is null then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','inventory_source','severity','disclosure',
    'detail','No enabled inventory or ERP connector is recorded; stock rows are labelled manual, imported or source-unknown.'));
  end if;
  if m.min_qty is null or m.max_qty is null then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','reorder_policy','severity','attention',
    'detail','The existing minimum or maximum is missing. The agent does not invent safety stock, service level or a replacement threshold.'));
  end if;
  if m.lead_time_days is null then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','lead_time','severity','blocker',
    'detail','No catalogue lead time is recorded; lead-time demand and replenishment exposure are withheld.'));
  end if;
  if v_issue_events<3 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','demand_history','severity','attention',
    'detail',format('Only %s issued event(s) are recorded in the selected window; demand evidence is too thin for a stocking-policy change.',v_issue_events)));
  end if;
  if v_supplier_count=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','supplier_coverage','severity','blocker',
    'detail','No supplier relationship is recorded. A lead time without a named source is not a supply commitment.'));
  elsif v_approved_suppliers=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','supplier_qualification','severity','blocker',
    'detail','No supplier is both approved for this material and on the approved vendor list. Recorded sourcing is not procurement approval.'));
  elsif v_approved_suppliers=1 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','sole_approved_source','severity','attention',
    'detail','Exactly one approved material source is recorded. Confirm true sole-source status and contingency before treating it as a sourcing conclusion.'));
  end if;
  if m.repairable and v_return_events=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','repairable_loop','severity','blocker',
    'detail','The material is marked repairable but no return event is recorded in the selected window; repair turnaround, yield and pool size are not inferable.'));
  end if;
  if v_lot_rows>0 and v_lot_cert_gaps>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','lot_certification','severity','blocker',
    'detail',format('%s retained lot(s) have missing, expired or unknown certification; total on-hand cannot be treated as serviceable supply.',v_lot_cert_gaps)));
  end if;
  if v_unknown_lifecycle>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','supplier_lifecycle','severity','attention',
    'detail',format('%s supplier relationship(s) have unknown lifecycle status.',v_unknown_lifecycle)));
  end if;
  if v_eol_suppliers>0 and v_assets_using+v_installed_components=0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
      'code','remaining_life_context','severity','blocker',
      'detail','Supplier lifecycle exposure is recorded but the material is not linked to an asset/BOM population; last-time-buy quantity cannot be assessed against remaining asset life.'));
  end if;

  v_plan:=jsonb_build_array(
    jsonb_build_object('sequence',1,'question','Is this the correct customer material identity and installed/BOM population?','owner','data steward and reliability engineer','completion','Verify catalogue provenance, unit, repairable flag, criticality and every asset/component relationship.'),
    jsonb_build_object('sequence',2,'question','What quantity is physically available and serviceable?','owner','stores or inventory custodian','completion','Reconcile stock, reservations, lots, location, certification and last count to the authoritative inventory source.'),
    jsonb_build_object('sequence',3,'question','What recorded demand and stockout history is decision-grade?','owner','planner and MRO analyst','completion','Validate issue/return/shortage events, open work demand and the observation window; do not infer missing transactions.'),
    jsonb_build_object('sequence',4,'question','What sourcing, lead-time and lifecycle exposure is real?','owner','supply-chain owner','completion','Confirm approved sources, quoted lead time, delivery history, lifecycle status, last-time-buy dates and governed alternatives.'),
    jsonb_build_object('sequence',5,'question','What human action, if any, is justified?','owner','accountable maintenance and supply-chain authority','completion','Separately approve any policy change, purchase, supplier/substitution decision, reservation, issue, engineering use or work release.'));

  v_snapshot:=jsonb_build_object(
    'asOf',now(),'material',jsonb_build_object(
      'materialId',m.id,'materialCode',m.material_code,'description',m.description,
      'category',m.category,'unitOfMeasure',m.unit_of_measure,
      'unitCostUsd',m.unit_cost_usd,'leadTimeDays',m.lead_time_days,
      'minimumQuantity',m.min_qty,'maximumQuantity',m.max_qty,
      'repairable',m.repairable,'criticality',m.criticality,
      'isTemplate',m.is_template,'basis',m.basis,
      'sourceSystem',m.source_system,'externalId',m.external_id),
    'windowDays',v_window,'retainedRowLimit',v_limit,
    'inventoryConnectorKey',v_inventory_connector,
    'stock',v_stock,'stockLots',v_lots,'openDemand',v_demand,
    'materialEvents',v_events,'suppliers',v_suppliers,
    'supplierDeliveries',v_deliveries,'bom',v_bom,
    'installedComponents',v_component_instances,'substitutions',v_substitutions,
    'sourceTables',jsonb_build_array(
      'materials','material_stock','material_stock_lots','work_order_materials',
      'material_events','bom_lines','component_instances','material_suppliers',
      'suppliers','supplier_deliveries','material_substitutions',
      'approved_substitutions','connectors'));

  perform set_config('app.mro_materials_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,material_id,status,summary,confidence,started_at,
     requested_by,agent_control_profile_id,agent_tool_key,
     agent_decision_right_key,input_snapshot,retained_for_governance)
  values
    (v_org,ag.id,m.id,'running','MRO Materials Specialist is screening exact tenant evidence.',
     greatest(25,least(85,35+(case when v_stock_rows>0 then 10 else 0 end)
       +(case when v_issue_events>=3 then 10 else 0 end)
       +(case when v_supplier_count>0 then 10 else 0 end)
       +(case when v_bom_rows+v_installed_components>0 then 10 else 0 end))),
     now(),auth.uid(),(v_control->>'profile_id')::uuid,
     'analyse_mro_material_position','identify_missing_materials_docs',
     v_snapshot,true)
  returning id into v_run;

  v_result:=jsonb_build_object(
    'runId',v_run,'agentId',ag.id,'agentKey',ag.key,
    'materialId',m.id,'materialCode',m.material_code,
    'criticalSpares',jsonb_build_object(
      'state',v_critical_state,'criticality',m.criticality,
      'bomRows',v_bom_rows,'assetsUsing',v_assets_using,
      'installedComponents',v_installed_components,
      'approvedSources',v_approved_suppliers,
      'approvedAlternatives',v_approved_substitutions),
    'reorderPolicy',jsonb_build_object(
      'state',v_reorder_state,'configuredMinimum',m.min_qty,
      'configuredMaximum',m.max_qty,'leadTimeDays',m.lead_time_days,
      'observedLeadTimeDemand',v_lead_time_demand,
      'basis','Observed issued quantity divided by the selected window and multiplied by recorded lead time; this is not safety stock or a recommended reorder point.'),
    'repairables',jsonb_build_object(
      'state',v_repairable_state,'repairable',m.repairable,
      'returnEventsInWindow',v_return_events,
      'installedComponents',v_installed_components,
      'turnaroundDays',null,'repairYield',null),
    'stockouts',jsonb_build_object(
      'state',v_stockout_state,'openDemandLines',v_open_demand_rows,
      'openShortLines',v_short_lines,'shortageEventsInWindow',v_shortage_events,
      'requiredQuantity',v_required,'reservedForDemand',v_demand_reserved),
    'obsolescence',jsonb_build_object(
      'state',v_obsolescence_state,'recordedSuppliers',v_supplier_count,
      'approvedSuppliers',v_approved_suppliers,'lifecycleUnknown',v_unknown_lifecycle,
      'eolOrLastTimeBuySuppliers',v_eol_suppliers,
      'earliestLastTimeBuyDate',v_last_time_buy,
      'remainingAssetLife',null),
    'inventoryPosition',jsonb_build_object(
      'stockRecords',v_stock_rows,'onHand',v_on_hand,'reserved',v_reserved,
      'available',v_available,'onOrder',v_on_order,
      'lotRecords',v_lot_rows,'serviceableLotQuantity',v_serviceable_qty,
      'lotCertificationGaps',v_lot_cert_gaps),
    'demandEvidence',jsonb_build_object(
      'windowDays',v_window,'eventRows',v_event_rows,'issueEvents',v_issue_events,
      'issuedQuantity',v_issued_qty,'firstEventAt',v_first_event,
      'lastEventAt',v_last_event),
    'evidenceGaps',v_gaps,'evidencePlan',v_plan,
    'interpretation',case
      when v_stock_rows=0 then 'The material position is not decision-grade because no stock record exists. Missing inventory has not been converted to zero.'
      when v_short_lines>0 then 'One or more open work-demand lines are explicitly short. This is a recorded stockout signal, not authority to buy, substitute, reserve, issue or release work.'
      when v_eol_suppliers>0 then 'Supplier lifecycle evidence identifies last-time-buy, end-of-life or obsolete exposure. Quantity and action require asset-life, demand and approved-source review.'
      else 'No configured shortage or supplier-lifecycle trigger was found in the retained evidence. This does not prove adequacy, availability, serviceability or future supply.' end,
    'limitations',jsonb_build_array(
      'Missing stock is unknown, never zero; template material classes cannot be assessed.',
      'Observed demand and lead-time demand do not establish safety stock, service level, reorder point or future demand.',
      'Supplier records do not themselves authorize procurement, engineering substitution or installation.',
      'Repair turnaround, repair yield and remaining asset life stay unknown unless separately recorded.',
      'The agent did not create a purchase order, change stock, reserve or issue material, approve a supplier or substitution, change a stocking policy, commit spend or release work.'),
    'humanReviewRequired',true,
    'mayCreatePurchaseOrder',false,'mayChangeStock',false,
    'mayReserveOrIssueMaterial',false,'mayApproveSupplier',false,
    'mayChangeReorderPolicy',false,'mayApproveSubstitution',false,
    'mayCommitSpend',false,'mayReleaseWork',false);

  perform set_config('app.mro_material_record_write','granted',true);
  insert into public.mro_material_agent_packs
    (organization_id,material_id,agent_run_id,window_days,
     source_snapshot,assessment,created_by)
  values(v_org,m.id,v_run,v_window,v_snapshot,v_result,auth.uid())
  returning id into v_pack;
  v_result:=v_result||jsonb_build_object('packId',v_pack);
  update public.agent_runs set status='completed',completed_at=now(),result=v_result,
    summary=format('Created an immutable MRO material assessment for %s with %s evidence gap(s).',m.material_code,jsonb_array_length(v_gaps))
  where id=v_run;
  perform set_config('app.mro_material_record_write','',true);
  perform set_config('app.mro_materials_agent_run_write','',true);

  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Assessed '||m.material_code,
    last_action='Created a governed MRO material-position assessment',
    recommendations_generated=coalesce(recommendations_generated,0)+1
  where id=ag.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'mro_materials_agent_run',v_role,jsonb_build_object(
    'action','material_position_assessment_created','material_id',m.id,
    'pack_id',v_pack,'agent_run_id',v_run,'requested_by',auth.uid(),
    'control_profile_id',v_control->>'profile_id',
    'inventory_changed',false,'procurement_committed',false,
    'work_released',false,'policy_changed',false));
  return v_result;
end
$$;
revoke all on function public.run_mro_materials_agent(uuid,int,int)
  from public,anon;
grant execute on function public.run_mro_materials_agent(uuid,int,int)
  to authenticated;

create or replace function public.assign_mro_material_review(
  p_pack_id uuid,p_assigned_to uuid,p_due_date date,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_assignment uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','assigning MRO material review requires a named planner, reliability engineer, maintenance manager or administrator');
  end if;
  if not exists(select 1 from public.mro_material_agent_packs
    where id=p_pack_id and organization_id=v_org) then
    return jsonb_build_object('error','MRO material assessment pack not found');
  end if;
  if not exists(select 1 from public.user_profiles
    where id=p_assigned_to and organization_id=v_org
      and coalesce(role,'')<>'ai_admin') then
    return jsonb_build_object('error','review owner must be a named human member of this organization');
  end if;
  if p_due_date is null or p_due_date<current_date then
    return jsonb_build_object('error','review due date cannot be in the past');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','assignment note must contain at least 10 characters');
  end if;
  perform set_config('app.mro_material_record_write','granted',true);
  insert into public.mro_material_review_assignments
    (organization_id,pack_id,assigned_to,due_date,assignment_note,assigned_by)
  values(v_org,p_pack_id,p_assigned_to,p_due_date,btrim(p_note),auth.uid())
  returning id into v_assignment;
  perform set_config('app.mro_material_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'mro_material_review',v_role,jsonb_build_object(
    'action','review_assigned','pack_id',p_pack_id,'assignment_id',v_assignment,
    'assigned_to',p_assigned_to,'due_date',p_due_date,'assigned_by',auth.uid(),
    'inventory_changed',false,'procurement_committed',false));
  return jsonb_build_object('assignmentId',v_assignment,'packId',p_pack_id,
    'assignedTo',p_assigned_to,'dueDate',p_due_date,
    'note','Named-human review assigned. No inventory, procurement or work action was taken.');
end
$$;
revoke all on function public.assign_mro_material_review(uuid,uuid,date,text)
  from public,anon;
grant execute on function public.assign_mro_material_review(uuid,uuid,date,text)
  to authenticated;

create or replace function public.get_mro_materials_agent_workspace(
  p_limit int default 50
)
returns jsonb language sql stable security definer set search_path=public as $$
  with caller as (select public.app_current_org() organization_id),
  material_rows as (
    select m.id,m.material_code,m.description,m.criticality,m.repairable,
      m.lead_time_days,m.min_qty,m.max_qty,m.source_system,
      (select count(*) from public.material_stock s
       where s.organization_id=m.organization_id and s.material_id=m.id) stock_records,
      (select coalesce(sum(s.qty_on_hand-s.qty_reserved),0) from public.material_stock s
       where s.organization_id=m.organization_id and s.material_id=m.id) available,
      (select count(*) from public.work_order_materials d
       where d.organization_id=m.organization_id and d.material_id=m.id
         and d.status='short') open_short_lines,
      (select count(*) from public.material_suppliers ms
       join public.suppliers s on s.id=ms.supplier_id and s.organization_id=ms.organization_id
       where ms.organization_id=m.organization_id and ms.material_id=m.id
         and ms.approved_for_this_material and s.approved_vendor) approved_suppliers,
      (select max(p.created_at) from public.mro_material_agent_packs p
       where p.organization_id=m.organization_id and p.material_id=m.id) last_assessed_at
    from public.materials m join caller c on c.organization_id=m.organization_id
    where not m.is_template
    order by case m.criticality when 'critical' then 1 when 'essential' then 2 else 3 end,
      open_short_lines desc,m.material_code
    limit least(greatest(coalesce(p_limit,50),1),100)
  ), pack_rows as (
    select p.*,m.material_code,m.description,m.criticality,
      latest.id assignment_id,latest.assigned_to,latest.due_date,
      latest.assignment_note,up.full_name owner_name
    from public.mro_material_agent_packs p
    join caller c on c.organization_id=p.organization_id
    join public.materials m on m.id=p.material_id and m.organization_id=p.organization_id
    left join lateral (
      select x.* from public.mro_material_review_assignments x
      where x.pack_id=p.id and x.organization_id=p.organization_id
      order by x.assigned_at desc,x.id desc limit 1
    ) latest on true
    left join public.user_profiles up on up.id=latest.assigned_to
      and up.organization_id=p.organization_id
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit,50),1),100)
  )
  select case when (select organization_id from caller) is null
    then jsonb_build_object('error','forbidden') else jsonb_build_object(
    'materials',coalesce((select jsonb_agg(jsonb_build_object(
      'materialId',id,'materialCode',material_code,'description',description,
      'criticality',criticality,'repairable',repairable,
      'leadTimeDays',lead_time_days,'minimumQuantity',min_qty,
      'maximumQuantity',max_qty,'sourceSystem',source_system,
      'stockRecords',stock_records,'available',available,
      'openShortLines',open_short_lines,'approvedSuppliers',approved_suppliers,
      'lastAssessedAt',last_assessed_at)
      order by case criticality when 'critical' then 1 when 'essential' then 2 else 3 end,
        open_short_lines desc,material_code) from material_rows),'[]'::jsonb),
    'packs',coalesce((select jsonb_agg(jsonb_build_object(
      'packId',id,'materialId',material_id,'materialCode',material_code,
      'description',description,'criticality',criticality,
      'agentRunId',agent_run_id,'windowDays',window_days,
      'assessment',assessment,'createdAt',created_at,
      'assignment',case when assignment_id is null then null else jsonb_build_object(
        'assignmentId',assignment_id,'assignedTo',assigned_to,
        'ownerName',coalesce(owner_name,assigned_to::text),
        'dueDate',due_date,'note',assignment_note) end)
      order by created_at desc) from pack_rows),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',up.id,'name',coalesce(up.full_name,up.id::text),'role',up.role)
      order by coalesce(up.full_name,up.id::text)) from public.user_profiles up
      join caller c on c.organization_id=up.organization_id
      where coalesce(up.role,'')<>'ai_admin'),'[]'::jsonb),
    'basis','Each execution freezes the selected customer material, stock, lot, demand, event, BOM, supplier, lifecycle and alternative evidence. Missing stock remains unknown, every output is advisory and a named human owns any inventory, procurement, engineering or work decision.') end;
$$;
revoke all on function public.get_mro_materials_agent_workspace(int)
  from public,anon;
grant execute on function public.get_mro_materials_agent_workspace(int)
  to authenticated;

comment on function public.run_mro_materials_agent(uuid,int,int) is
  'C1.08: creates an immutable advisory MRO material-position pack covering critical spares, existing reorder policies, repairables, stockouts and obsolescence from exact canonical source rows, with no inventory, procurement, engineering or work authority.';

notify pgrst,'reload schema';
