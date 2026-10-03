-- ============================================================================
-- E6.05 / E6.08 / E6.09 — governed workforce execution resources.
--
-- Extend the canonical workforce tables. Crew composition, specialised-tool
-- availability and critical knowledge are customer-authored facts with
-- verified evidence and named-human audit receipts. Knowledge transfer reuses
-- the canonical training plan lifecycle; no parallel plan or evidence store is
-- introduced. E6.11/E6.12 continue to use the canonical standard_work and
-- procedure_translations lifecycle through register_standard_work_baseline.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Versioned crew templates. Historical demo rows remain readable but inactive;
-- only evidence-backed active versions may be used in operational assessments.
-- ---------------------------------------------------------------------------
drop index if exists public.idx_ct_key;
alter table public.crew_templates
  add column if not exists version integer not null default 1,
  add column if not exists active boolean not null default false,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists supersedes_template_id bigint references public.crew_templates(id) on delete restrict;

alter table public.crew_templates
  drop constraint if exists crew_templates_version_check;
alter table public.crew_templates
  add constraint crew_templates_version_check check (version >= 1);

create unique index if not exists uq_crew_template_version
  on public.crew_templates(organization_id,template_key,version);
create unique index if not exists uq_crew_template_active
  on public.crew_templates(organization_id,template_key) where active;

create or replace function public.enforce_crew_template_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_marker text:=coalesce(current_setting('app.crew_template_write',true),'');
begin
  if tg_op='DELETE' then
    raise exception 'crew templates are retained workforce evidence and cannot be deleted';
  end if;
  if v_marker<>'granted' or auth.uid() is null then
    raise exception 'crew templates are written only by the governed named-human workflow';
  end if;
  if tg_op='INSERT' then
    if not new.active or length(btrim(coalesce(new.basis,'')))<20
       or new.evidence_item_id is null then
      raise exception 'an active crew template requires a substantive basis and verified evidence';
    end if;
    new.recorded_by:=auth.uid(); new.recorded_at:=now();
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.template_key is distinct from old.template_key
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.version is distinct from old.version
     or new.basis is distinct from old.basis
     or new.evidence_item_id is distinct from old.evidence_item_id
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_at is distinct from old.recorded_at
     or new.supersedes_template_id is distinct from old.supersedes_template_id
     or old.active is not true or new.active is not false then
    raise exception 'crew template versions are immutable; replace the active version';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_crew_template_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_crew_template_governance on public.crew_templates;
create trigger trg_crew_template_governance
  before insert or update or delete on public.crew_templates
  for each row execute function public.enforce_crew_template_governance();

create or replace function public.enforce_crew_role_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='DELETE' then
    raise exception 'crew roles are retained workforce evidence and cannot be deleted';
  end if;
  if coalesce(current_setting('app.crew_template_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'crew roles are written only with a governed crew template';
  end if;
  if tg_op='UPDATE' then
    raise exception 'crew roles are immutable; replace the crew template version';
  end if;
  if not exists(select 1 from public.crew_templates t
    where t.id=new.template_id and t.organization_id=new.organization_id) then
    raise exception 'crew role and template must belong to the same organization';
  end if;
  if new.required_competency_id is not null and not exists(
    select 1 from public.competencies c where c.id=new.required_competency_id
      and c.organization_id=new.organization_id) then
    raise exception 'crew-role competency must belong to the same organization';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_crew_role_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_crew_role_governance on public.crew_template_roles;
create trigger trg_crew_role_governance
  before insert or update or delete on public.crew_template_roles
  for each row execute function public.enforce_crew_role_governance();

create or replace function public.record_crew_template(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_key text:=lower(btrim(coalesce(p_payload->>'templateKey','')));
  v_title text:=btrim(coalesce(p_payload->>'title',''));
  v_basis text:=btrim(coalesce(p_payload->>'basis',''));
  v_evidence uuid:=public.sync_text_as_uuid(p_payload->>'evidenceItemId');
  v_roles jsonb:=coalesce(p_payload->'roles','[]'::jsonb);
  v_previous public.crew_templates%rowtype; v_id bigint; v_version integer;
  v_item jsonb; v_competency bigint; v_count integer:=0; v_mandatory integer:=0;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'')='ai_admin'
     or not coalesce(public.app_has_approval_authority(),false) then
    return jsonb_build_object('answered',false,
      'refusal','recording an operational crew composition requires a named human with approval authority');
  end if;
  if length(v_key)<2 or length(v_title)<5 or length(v_basis)<20 then
    return jsonb_build_object('answered',false,
      'refusal','crew template requires a stable key, title and substantive basis');
  end if;
  if v_evidence is null or not exists(select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,
      'refusal','crew composition requires same-tenant independently verified evidence');
  end if;
  if jsonb_typeof(v_roles)<>'array' or jsonb_array_length(v_roles)<1
     or jsonb_array_length(v_roles)>20 then
    return jsonb_build_object('answered',false,
      'refusal','crew composition requires between one and twenty role definitions');
  end if;
  for v_item in select value from jsonb_array_elements(v_roles) loop
    v_count:=v_count+1;
    if length(btrim(coalesce(v_item->>'roleLabel','')))<2
       or public.sync_text_as_bigint(v_item->>'headcount') is null
       or public.sync_text_as_bigint(v_item->>'headcount')<1
       or public.sync_text_as_bigint(v_item->>'headcount')>100 then
      return jsonb_build_object('answered',false,
        'refusal','each crew role requires a label and headcount from one to one hundred');
    end if;
    if coalesce(public.sync_text_as_boolean(v_item->>'isMandatory'),true) then
      v_mandatory:=v_mandatory+1;
    end if;
    v_competency:=public.sync_text_as_bigint(v_item->>'requiredCompetencyId');
    if v_competency is not null and not exists(select 1 from public.competencies c
      where c.id=v_competency and c.organization_id=v_org) then
      return jsonb_build_object('answered',false,
        'refusal','every crew-role competency must belong to this organization');
    end if;
  end loop;
  if v_mandatory=0 then
    return jsonb_build_object('answered',false,
      'refusal','crew composition requires at least one mandatory role');
  end if;

  perform 1 from public.organizations where id=v_org for update;
  select * into v_previous from public.crew_templates
    where organization_id=v_org and template_key=v_key and active for update;
  select coalesce(max(version),0)+1 into v_version from public.crew_templates
    where organization_id=v_org and template_key=v_key;
  perform set_config('app.crew_template_write','granted',true);
  if v_previous.id is not null then
    update public.crew_templates set active=false where id=v_previous.id;
  end if;
  insert into public.crew_templates(organization_id,template_key,title,description,
    version,active,basis,evidence_item_id,supersedes_template_id)
  values(v_org,v_key,v_title,nullif(btrim(p_payload->>'description'),''),v_version,
    true,v_basis,v_evidence,v_previous.id) returning id into v_id;
  for v_item in select value from jsonb_array_elements(v_roles) loop
    insert into public.crew_template_roles(organization_id,template_id,role_label,
      craft,headcount,required_competency_id,is_mandatory)
    values(v_org,v_id,btrim(v_item->>'roleLabel'),nullif(btrim(v_item->>'craft'),''),
      public.sync_text_as_bigint(v_item->>'headcount'),
      public.sync_text_as_bigint(v_item->>'requiredCompetencyId'),
      coalesce(public.sync_text_as_boolean(v_item->>'isMandatory'),true));
  end loop;
  perform set_config('app.crew_template_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'crew_template',v_role,jsonb_build_object(
    'crewTemplateId',v_id,'templateKey',v_key,'version',v_version,
    'roleCount',v_count,'evidenceItemId',v_evidence,'humanRecorded',true),
    case when v_previous.id is null then null else jsonb_build_object(
      'crewTemplateId',v_previous.id,'version',v_previous.version,'active',true) end,
    jsonb_build_object('crewTemplateId',v_id,'version',v_version,'active',true));
  return jsonb_build_object('answered',true,'crewTemplateId',v_id,
    'version',v_version,'roleCount',v_count,'status','active',
    'note','Evidence-backed crew composition recorded. It does not dispatch a crew or release work.');
exception when unique_violation then
  perform set_config('app.crew_template_write','',true);
  return jsonb_build_object('answered',false,
    'refusal','crew composition changed concurrently; refresh before recording another version');
when others then
  perform set_config('app.crew_template_write','',true); raise;
end
$$;
revoke all on function public.record_crew_template(jsonb) from public,anon;
grant execute on function public.record_crew_template(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Versioned specialised-tool availability.
-- ---------------------------------------------------------------------------
drop index if exists public.idx_st_key;
alter table public.specialised_tools
  add column if not exists version integer not null default 1,
  add column if not exists active boolean not null default false,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists supersedes_tool_id bigint references public.specialised_tools(id) on delete restrict;
alter table public.specialised_tools
  drop constraint if exists specialised_tools_version_check;
alter table public.specialised_tools
  add constraint specialised_tools_version_check check (version>=1);
create unique index if not exists uq_specialised_tool_version
  on public.specialised_tools(organization_id,tool_key,version);
create unique index if not exists uq_specialised_tool_active
  on public.specialised_tools(organization_id,tool_key) where active;

create or replace function public.enforce_specialised_tool_governance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.specialised_tool_write',true),'');
begin
  if tg_op='DELETE' then raise exception 'specialised-tool records are retained evidence and cannot be deleted'; end if;
  if v_marker<>'granted' or auth.uid() is null then
    raise exception 'specialised-tool records are written only by the governed named-human workflow';
  end if;
  if tg_op='INSERT' then
    if not new.active or length(btrim(coalesce(new.basis,'')))<20 or new.evidence_item_id is null then
      raise exception 'active specialised-tool availability requires a basis and verified evidence';
    end if;
    new.recorded_by:=auth.uid(); new.recorded_at:=now(); return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.tool_key is distinct from old.tool_key or new.title is distinct from old.title
     or new.quantity_available is distinct from old.quantity_available
     or new.required_competency_id is distinct from old.required_competency_id
     or new.lead_time_days is distinct from old.lead_time_days
     or new.owned_by is distinct from old.owned_by or new.version is distinct from old.version
     or new.basis is distinct from old.basis or new.evidence_item_id is distinct from old.evidence_item_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at
     or new.supersedes_tool_id is distinct from old.supersedes_tool_id
     or old.active is not true or new.active is not false then
    raise exception 'specialised-tool versions are immutable; replace the active version';
  end if;
  return new;
end $$;
revoke all on function public.enforce_specialised_tool_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_specialised_tool_governance on public.specialised_tools;
create trigger trg_specialised_tool_governance before insert or update or delete
  on public.specialised_tools for each row execute function public.enforce_specialised_tool_governance();

create or replace function public.record_specialised_tool(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_key text:=lower(btrim(coalesce(p_payload->>'toolKey','')));
  v_title text:=btrim(coalesce(p_payload->>'title',''));
  v_quantity bigint:=public.sync_text_as_bigint(p_payload->>'quantityAvailable');
  v_lead bigint:=public.sync_text_as_bigint(p_payload->>'leadTimeDays');
  v_competency bigint:=public.sync_text_as_bigint(p_payload->>'requiredCompetencyId');
  v_evidence uuid:=public.sync_text_as_uuid(p_payload->>'evidenceItemId');
  v_basis text:=btrim(coalesce(p_payload->>'basis',''));
  v_previous public.specialised_tools%rowtype; v_id bigint; v_version integer;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('answered',false,
      'refusal','recording specialised-tool availability requires a named human planning or management role');
  end if;
  if length(v_key)<2 or length(v_title)<5 or length(v_basis)<20
     or v_quantity is null or v_quantity<0 or v_quantity>100000
     or (v_lead is not null and (v_lead<0 or v_lead>3650)) then
    return jsonb_build_object('answered',false,
      'refusal','tool record requires a stable identity, non-negative bounded availability, optional bounded lead time and substantive basis');
  end if;
  if v_evidence is null or not exists(select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,
      'refusal','tool availability requires same-tenant independently verified evidence');
  end if;
  if v_competency is not null and not exists(select 1 from public.competencies c
    where c.id=v_competency and c.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','required operator competency not found');
  end if;
  perform 1 from public.organizations where id=v_org for update;
  select * into v_previous from public.specialised_tools
    where organization_id=v_org and tool_key=v_key and active for update;
  select coalesce(max(version),0)+1 into v_version from public.specialised_tools
    where organization_id=v_org and tool_key=v_key;
  perform set_config('app.specialised_tool_write','granted',true);
  if v_previous.id is not null then update public.specialised_tools set active=false where id=v_previous.id; end if;
  insert into public.specialised_tools(organization_id,tool_key,title,quantity_available,
    required_competency_id,lead_time_days,owned_by,version,active,basis,evidence_item_id,
    supersedes_tool_id)
  values(v_org,v_key,v_title,v_quantity,v_competency,v_lead,
    nullif(btrim(p_payload->>'ownedBy'),''),v_version,true,v_basis,v_evidence,v_previous.id)
  returning id into v_id;
  perform set_config('app.specialised_tool_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'specialised_tool',v_role,jsonb_build_object(
    'toolId',v_id,'toolKey',v_key,'version',v_version,'evidenceItemId',v_evidence,
    'humanRecorded',true),
    case when v_previous.id is null then null else jsonb_build_object(
      'toolId',v_previous.id,'version',v_previous.version,
      'quantityAvailable',v_previous.quantity_available,'active',true) end,
    jsonb_build_object('toolId',v_id,'version',v_version,
      'quantityAvailable',v_quantity,'active',true));
  return jsonb_build_object('answered',true,'toolId',v_id,'version',v_version,
    'status','active','note','Evidence-backed tool availability recorded. Availability does not authorize work or prove operator competency.');
exception when unique_violation then
  perform set_config('app.specialised_tool_write','',true);
  return jsonb_build_object('answered',false,'refusal','tool availability changed concurrently; refresh and record again');
when others then perform set_config('app.specialised_tool_write','',true); raise;
end $$;
revoke all on function public.record_specialised_tool(jsonb) from public,anon;
grant execute on function public.record_specialised_tool(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Critical-knowledge definitions, holders and canonical transfer plans.
-- ---------------------------------------------------------------------------
alter table public.knowledge_areas
  add column if not exists row_version integer not null default 1,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();
alter table public.knowledge_areas drop constraint if exists knowledge_areas_row_version_check;
alter table public.knowledge_areas add constraint knowledge_areas_row_version_check check(row_version>=1);

alter table public.knowledge_holders
  add column if not exists active boolean not null default true,
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz,
  add column if not exists ended_by uuid references auth.users(id),
  add column if not exists ended_at timestamptz;

create or replace function public.enforce_knowledge_governance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.knowledge_write',true),'');
begin
  if tg_op='DELETE' then raise exception 'knowledge records are retained workforce evidence and cannot be deleted'; end if;
  if v_marker<>'granted' or auth.uid() is null then
    raise exception 'knowledge records are written only by the governed named-human workflow';
  end if;
  if tg_table_name='knowledge_areas' then
    if length(btrim(coalesce(new.basis,'')))<20 or new.evidence_item_id is null then
      raise exception 'knowledge definition requires a substantive basis and verified evidence';
    end if;
    if tg_op='INSERT' then
      if new.row_version<>1 then raise exception 'new knowledge definition begins at version one'; end if;
      new.recorded_by:=auth.uid(); new.updated_by:=auth.uid(); new.updated_at:=now(); return new;
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.area_key is distinct from old.area_key or new.created_at is distinct from old.created_at
       or new.recorded_by is distinct from old.recorded_by
       or new.row_version<>old.row_version+1 then
      raise exception 'knowledge identity is immutable and version must advance exactly once';
    end if;
    new.updated_by:=auth.uid(); new.updated_at:=now(); return new;
  end if;
  if tg_op='INSERT' then
    if not new.active or length(btrim(coalesce(new.basis,'')))<20 or new.evidence_item_id is null then
      raise exception 'knowledge holding requires a substantive basis and verified evidence';
    end if;
    new.recorded_by:=auth.uid(); new.recorded_at:=now(); return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.area_id is distinct from old.area_id or new.member_id is distinct from old.member_id
     or new.depth is distinct from old.depth or new.basis is distinct from old.basis
     or new.evidence_item_id is distinct from old.evidence_item_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at
     or old.active is not true or new.active is not false
     or new.ended_by is distinct from auth.uid() or new.ended_at is null then
    raise exception 'knowledge-holder identity is immutable; only a named-human ending act is allowed';
  end if;
  return new;
end $$;
revoke all on function public.enforce_knowledge_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_knowledge_area_governance on public.knowledge_areas;
create trigger trg_knowledge_area_governance before insert or update or delete
  on public.knowledge_areas for each row execute function public.enforce_knowledge_governance();
drop trigger if exists trg_knowledge_holder_governance on public.knowledge_holders;
create trigger trg_knowledge_holder_governance before insert or update or delete
  on public.knowledge_holders for each row execute function public.enforce_knowledge_governance();

create or replace function public.record_knowledge_area(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_key text:=lower(btrim(coalesce(p_payload->>'areaKey','')));
  v_title text:=btrim(coalesce(p_payload->>'title',''));
  v_consequence text:=btrim(coalesce(p_payload->>'consequenceIfLost',''));
  v_criticality text:=btrim(coalesce(p_payload->>'criticality',''));
  v_basis text:=btrim(coalesce(p_payload->>'basis',''));
  v_evidence uuid:=public.sync_text_as_uuid(p_payload->>'evidenceItemId');
  v_expected bigint:=public.sync_text_as_bigint(p_payload->>'expectedVersion');
  v_area public.knowledge_areas%rowtype; v_id bigint; v_version integer;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('answered',false,'refusal','critical knowledge requires a named human planning or management role');
  end if;
  if length(v_key)<2 or length(v_title)<5 or length(v_consequence)<20
     or v_criticality not in ('critical','high','medium','low') or length(v_basis)<20 then
    return jsonb_build_object('answered',false,
      'refusal','knowledge definition requires identity, title, consequence, criticality and substantive basis');
  end if;
  if v_evidence is null or not exists(select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal','knowledge definition requires same-tenant independently verified evidence');
  end if;
  perform 1 from public.organizations where id=v_org for update;
  select * into v_area from public.knowledge_areas
    where organization_id=v_org and area_key=v_key for update;
  if v_area.id is not null and v_area.recorded_by is null then
    return jsonb_build_object('answered',false,
      'refusal','an ungoverned legacy knowledge key already exists; record a new governed identity instead of adopting fixture content');
  end if;
  perform set_config('app.knowledge_write','granted',true);
  if v_area.id is null then
    if v_expected is not null then
      perform set_config('app.knowledge_write','',true);
      return jsonb_build_object('answered',false,'refusal','knowledge area does not exist; remove the expected version and refresh');
    end if;
    insert into public.knowledge_areas(organization_id,area_key,title,consequence_if_lost,
      criticality,documented_where,row_version,basis,evidence_item_id)
    values(v_org,v_key,v_title,v_consequence,v_criticality,
      nullif(btrim(p_payload->>'documentedWhere'),''),1,v_basis,v_evidence)
    returning id,row_version into v_id,v_version;
  else
    if v_expected is null or v_expected<>v_area.row_version then
      perform set_config('app.knowledge_write','',true);
      return jsonb_build_object('answered',false,'refusal','knowledge definition changed after review; refresh before recording the update',
        'currentVersion',v_area.row_version);
    end if;
    update public.knowledge_areas set title=v_title,consequence_if_lost=v_consequence,
      criticality=v_criticality,documented_where=nullif(btrim(p_payload->>'documentedWhere'),''),
      basis=v_basis,evidence_item_id=v_evidence,row_version=row_version+1
    where id=v_area.id returning id,row_version into v_id,v_version;
  end if;
  perform set_config('app.knowledge_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'knowledge_area',v_role,jsonb_build_object(
    'knowledgeAreaId',v_id,'areaKey',v_key,'evidenceItemId',v_evidence,'humanRecorded',true),
    case when v_area.id is null then null else jsonb_build_object('version',v_area.row_version,'criticality',v_area.criticality) end,
    jsonb_build_object('version',v_version,'criticality',v_criticality));
  return jsonb_build_object('answered',true,'knowledgeAreaId',v_id,'version',v_version,
    'note','Critical-knowledge definition recorded. Holder depth and transfer remain separate evidence-backed acts.');
exception when others then perform set_config('app.knowledge_write','',true); raise;
end $$;
revoke all on function public.record_knowledge_area(jsonb) from public,anon;
grant execute on function public.record_knowledge_area(jsonb) to authenticated;

create or replace function public.record_knowledge_holder(
  p_area_id bigint,p_member_id bigint,p_action text,p_depth text,p_basis text,p_evidence_item_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_existing public.knowledge_holders%rowtype;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('answered',false,'refusal','knowledge-holder changes require a named human planning or management role');
  end if;
  if p_action not in ('assign','end') or p_depth not in ('aware','competent','expert')
     or length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('answered',false,'refusal','record assign or end with a valid depth and substantive basis');
  end if;
  if not exists(select 1 from public.knowledge_areas a where a.id=p_area_id
    and a.organization_id=v_org and a.recorded_by is not null) then
    return jsonb_build_object('answered',false,'refusal','knowledge area not found');
  end if;
  if not exists(select 1 from public.workforce_members m where m.id=p_member_id
    and m.organization_id=v_org and m.active) then
    return jsonb_build_object('answered',false,'refusal','active workforce member not found');
  end if;
  if p_evidence_item_id is null or not exists(select 1 from public.evidence_items e
    where e.id=p_evidence_item_id and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal','knowledge holding requires same-tenant independently verified evidence');
  end if;
  select * into v_existing from public.knowledge_holders where area_id=p_area_id
    and member_id=p_member_id and organization_id=v_org for update;
  perform set_config('app.knowledge_write','granted',true);
  if p_action='assign' then
    if v_existing.area_id is not null then
      perform set_config('app.knowledge_write','',true);
      return jsonb_build_object('answered',false,'refusal','knowledge holding already exists; retained history cannot be overwritten');
    end if;
    insert into public.knowledge_holders(area_id,member_id,organization_id,depth,active,
      basis,evidence_item_id) values(p_area_id,p_member_id,v_org,p_depth,true,btrim(p_basis),p_evidence_item_id);
  else
    if v_existing.area_id is null or not v_existing.active then
      perform set_config('app.knowledge_write','',true);
      return jsonb_build_object('answered',false,'refusal','active knowledge holding not found');
    end if;
    update public.knowledge_holders set active=false,ended_by=auth.uid(),ended_at=now()
      where area_id=p_area_id and member_id=p_member_id;
  end if;
  perform set_config('app.knowledge_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'knowledge_holder',v_role,jsonb_build_object(
    'knowledgeAreaId',p_area_id,'memberId',p_member_id,'action',p_action,
    'basis',btrim(p_basis),'evidenceItemId',p_evidence_item_id,'humanRecorded',true),
    case when v_existing.area_id is null then null else jsonb_build_object('active',v_existing.active,'depth',v_existing.depth) end,
    jsonb_build_object('active',p_action='assign','depth',case when p_action='assign' then p_depth else v_existing.depth end));
  return jsonb_build_object('answered',true,'knowledgeAreaId',p_area_id,
    'memberId',p_member_id,'status',case when p_action='assign' then 'active' else 'ended' end,
    'note','Knowledge-holder evidence recorded. This is not a competency grant.');
exception when others then perform set_config('app.knowledge_write','',true); raise;
end $$;
revoke all on function public.record_knowledge_holder(bigint,bigint,text,text,text,uuid)
  from public,anon;
grant execute on function public.record_knowledge_holder(bigint,bigint,text,text,text,uuid)
  to authenticated;

alter table public.training_plans
  add column if not exists knowledge_area_id bigint references public.knowledge_areas(id) on delete restrict;

create or replace function public.enforce_training_plan_knowledge_identity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.knowledge_area_id is not null and not exists(select 1 from public.knowledge_areas a
    where a.id=new.knowledge_area_id and a.organization_id=new.organization_id) then
    raise exception 'training plan knowledge area must belong to the same organization';
  end if;
  if tg_op='UPDATE' and new.knowledge_area_id is distinct from old.knowledge_area_id then
    raise exception 'training plan knowledge-area identity is immutable';
  end if;
  return new;
end $$;
revoke all on function public.enforce_training_plan_knowledge_identity()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_training_plan_knowledge_identity on public.training_plans;
create trigger trg_training_plan_knowledge_identity before insert or update
  on public.training_plans for each row execute function public.enforce_training_plan_knowledge_identity();

create or replace function public.record_knowledge_transfer_plan(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_area bigint:=public.sync_text_as_bigint(p_payload->>'knowledgeAreaId');
  v_member bigint:=public.sync_text_as_bigint(p_payload->>'memberId');
  v_competency bigint:=public.sync_text_as_bigint(p_payload->>'competencyId');
  v_target date:=public.sync_text_as_date(p_payload->>'targetDate');
  v_kind text:=btrim(coalesce(p_payload->>'planKind',''));
  v_driver text:=btrim(coalesce(p_payload->>'driver','')); v_id bigint;
begin
  if v_org is null or auth.uid() is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('answered',false,'refusal','knowledge-transfer planning requires a named human planning or management role');
  end if;
  if v_kind not in ('succession','cross_training') or v_target is null or v_target<current_date
     or length(v_driver)<20 then
    return jsonb_build_object('answered',false,'refusal','knowledge transfer requires succession or cross-training, a current target and substantive driver');
  end if;
  if not exists(select 1 from public.knowledge_areas a where a.id=v_area
    and a.organization_id=v_org and a.recorded_by is not null) then
    return jsonb_build_object('answered',false,'refusal','knowledge area not found');
  end if;
  if not exists(select 1 from public.workforce_members m where m.id=v_member and m.organization_id=v_org and m.active) then
    return jsonb_build_object('answered',false,'refusal','active workforce member not found');
  end if;
  if not exists(select 1 from public.competencies c where c.id=v_competency and c.organization_id=v_org) then
    return jsonb_build_object('answered',false,'refusal','transfer competency not found');
  end if;
  perform set_config('app.training_plan_write','granted',true);
  insert into public.training_plans(organization_id,member_id,competency_id,plan_kind,
    target_date,status,driver,knowledge_area_id)
  values(v_org,v_member,v_competency,v_kind,v_target,'planned',v_driver,v_area)
  returning id into v_id;
  perform set_config('app.training_plan_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'knowledge_transfer_plan',v_role,jsonb_build_object(
    'trainingPlanId',v_id,'knowledgeAreaId',v_area,'memberId',v_member,
    'competencyId',v_competency,'humanRecorded',true,
    'boundary','planned knowledge transfer does not grant competency'));
  return jsonb_build_object('answered',true,'trainingPlanId',v_id,'status','planned',
    'competencyGranted',false,'note','Canonical knowledge-transfer plan recorded. Completion and competency verification remain separate governed acts.');
exception when others then perform set_config('app.training_plan_write','',true); raise;
end $$;
revoke all on function public.record_knowledge_transfer_plan(jsonb) from public,anon;
grant execute on function public.record_knowledge_transfer_plan(jsonb) to authenticated;

-- Correlate succession coverage to the exact knowledge area instead of any
-- open succession plan in the tenant.
drop function if exists public.get_knowledge_risk();
create or replace function public.get_knowledge_risk()
returns table (
  area_id bigint, area_key text, area_title text, criticality text,
  consequence_if_lost text, holder_count bigint, holders text,
  earliest_departure date, documented_where text, has_succession_plan boolean,
  row_version integer
)
language sql stable security invoker set search_path=public as $$
  select ka.id,ka.area_key,ka.title,ka.criticality,ka.consequence_if_lost,
    count(wm.id) filter(where kh.active)::bigint,
    coalesce(string_agg(wm.display_name,', ' order by wm.display_name)
      filter(where kh.active),'(nobody)'),
    min(wm.expected_departure) filter(where kh.active),ka.documented_where,
    exists(select 1 from public.training_plans tp
      where tp.organization_id=ka.organization_id and tp.knowledge_area_id=ka.id
        and tp.plan_kind in ('succession','cross_training')
        and tp.status in ('planned','in_progress')),
    ka.row_version
  from public.knowledge_areas ka
  left join public.knowledge_holders kh on kh.area_id=ka.id and kh.organization_id=ka.organization_id
  left join public.workforce_members wm on wm.id=kh.member_id and wm.organization_id=ka.organization_id and wm.active
  where ka.organization_id=public.app_current_org()
  group by ka.id,ka.area_key,ka.title,ka.criticality,ka.consequence_if_lost,
    ka.documented_where,ka.organization_id,ka.row_version
  having count(wm.id) filter(where kh.active)<=2
  order by count(wm.id) filter(where kh.active),
    case ka.criticality when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end;
$$;
grant execute on function public.get_knowledge_risk() to authenticated;

-- Operational assessments may reference only an evidence-backed active crew
-- template. This closes the downstream use path, not just the authoring path.
create or replace function public.enforce_governed_geospatial_crew()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.crew_template_id is not null and not exists(
    select 1 from public.crew_templates t join public.evidence_items e
      on e.id=t.evidence_item_id and e.organization_id=t.organization_id
    where t.id=new.crew_template_id and t.organization_id=new.organization_id
      and t.active and t.recorded_by is not null and e.verification_status='verified') then
    raise exception 'operational assessment requires an active evidence-backed governed crew template';
  end if;
  return new;
end $$;
revoke all on function public.enforce_governed_geospatial_crew()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_governed_geospatial_crew on public.geospatial_operational_assessments;
create trigger trg_governed_geospatial_crew before insert or update
  on public.geospatial_operational_assessments for each row execute function public.enforce_governed_geospatial_crew();

-- ---------------------------------------------------------------------------
-- One customer workspace for the execution-resource family. Standard work and
-- translations are read from their existing canonical stores.
-- ---------------------------------------------------------------------------
create or replace function public.get_workforce_execution_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('answered',false,'refusal','authentication required');
  end if;
  return jsonb_build_object('answered',true,
    'competencies',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'title',c.title) order by c.title) from public.competencies c
      where c.organization_id=v_org),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'displayName',m.display_name,'craft',m.craft) order by m.display_name)
      from public.workforce_members m where m.organization_id=v_org and m.active),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description) order by e.created_at desc)
      from (select * from public.evidence_items where organization_id=v_org
        and verification_status='verified' order by created_at desc limit 200) e),'[]'::jsonb),
    'crewTemplates',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'templateKey',t.template_key,'title',t.title,'description',t.description,
      'version',t.version,'active',t.active,'basis',t.basis,'evidenceItemId',t.evidence_item_id,
      'recordedBy',t.recorded_by,'supersedesTemplateId',t.supersedes_template_id,
      'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,
        'roleLabel',r.role_label,'craft',r.craft,'headcount',r.headcount,
        'requiredCompetencyId',r.required_competency_id,'isMandatory',r.is_mandatory)
        order by r.id) from public.crew_template_roles r where r.template_id=t.id),'[]'::jsonb))
      order by t.template_key,t.version desc) from public.crew_templates t
      where t.organization_id=v_org and t.recorded_by is not null),'[]'::jsonb),
    'tools',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'toolKey',s.tool_key,'title',s.title,'quantityAvailable',s.quantity_available,
      'requiredCompetencyId',s.required_competency_id,'leadTimeDays',s.lead_time_days,
      'ownedBy',s.owned_by,'version',s.version,'active',s.active,'basis',s.basis,
      'evidenceItemId',s.evidence_item_id,'recordedBy',s.recorded_by,
      'supersedesToolId',s.supersedes_tool_id) order by s.tool_key,s.version desc)
      from public.specialised_tools s where s.organization_id=v_org and s.recorded_by is not null),'[]'::jsonb),
    'knowledgeAreas',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'areaKey',a.area_key,'title',a.title,'consequenceIfLost',a.consequence_if_lost,
      'criticality',a.criticality,'documentedWhere',a.documented_where,'version',a.row_version,
      'basis',a.basis,'evidenceItemId',a.evidence_item_id,
      'holders',coalesce((select jsonb_agg(jsonb_build_object('memberId',h.member_id,
        'memberName',m.display_name,'depth',h.depth,'active',h.active,
        'basis',h.basis,'evidenceItemId',h.evidence_item_id) order by m.display_name)
        from public.knowledge_holders h join public.workforce_members m
          on m.id=h.member_id and m.organization_id=h.organization_id
        where h.area_id=a.id),'[]'::jsonb)) order by a.title)
      from public.knowledge_areas a where a.organization_id=v_org and a.recorded_by is not null),'[]'::jsonb),
    'standards',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'workKey',s.work_key,'title',s.title,'version',s.version,'basis',s.basis,
      'procedures',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,
        'languageCode',p.language_code,'translationStatus',p.translation_status,
        'verifiedBy',p.verified_by,'verifiedAt',p.verified_at) order by p.language_code)
        from public.procedure_translations p where p.standard_work_id=s.id),'[]'::jsonb))
      order by s.work_key,s.version desc) from public.standard_work s
      where s.organization_id=v_org),'[]'::jsonb),
    'boundary','Crew and tool records are evidence-backed planning inputs, not dispatch or work release. Knowledge holding is not a competency grant. Standard content is existing human-verified procedure content; SyncAI does not certify translations or invent standard times.');
end $$;
revoke all on function public.get_workforce_execution_workspace() from public,anon;
grant execute on function public.get_workforce_execution_workspace() to authenticated;

comment on function public.record_crew_template(jsonb) is
  'E6.05 evidence-backed versioned crew composition; does not dispatch or release work.';
comment on function public.record_specialised_tool(jsonb) is
  'E6.08 evidence-backed versioned specialised-tool availability; does not prove operator competency.';
comment on function public.record_knowledge_transfer_plan(jsonb) is
  'E6.09 canonical succession/cross-training plan linked to an exact knowledge area; completion never grants competency.';

notify pgrst,'reload schema';
