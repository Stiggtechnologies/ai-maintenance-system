-- ============================================================================
-- C1.12 — governed Data Steward Specialist.
--
-- This slice activates the existing canonical governance records instead of
-- creating a second asset, failure-code or quality model.  The specialist
-- reads the ONE asset hierarchy, human-coded failure history, data domains,
-- DQ service levels, sensor rules/calibrations, historian mappings and archive
-- register.  It freezes an exact population fingerprint and proposes a human
-- remediation route.  Only named humans can change master data, and a run can
-- never merge assets, recode a failure, change a tag, confirm a mapping or
-- dispose of a record.
-- ============================================================================

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'assess_data_governance','Assess governed data posture',
  'Fingerprint canonical hierarchy, failure-coding, master-data and data-quality populations and propose evidence-backed remediation without changing source records.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'data_steward','Data Steward Specialist','specialist','active','advisory',
       'Waiting for a governed data-domain assessment','Data Governance Owner'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='data_steward'
);

update public.ai_agents
set name='Data Steward Specialist',category='specialist',status='active',
    autonomy_mode='advisory',supervisor='Data Governance Owner',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact canonical hierarchy, failure-coding, master-data and data-quality evidence into an immutable assessment and named-human remediation hand-off.',
      'modes',jsonb_build_array('asset hierarchy','failure codes','master data','data-quality management'),
      'triggers',jsonb_build_array('human review request','missing stable identity','uncoded corrective history','breached data-quality SLA','overdue calibration','unconfirmed historian mapping'),
      'inputs',jsonb_build_array('assets and components','work-order failure coding','data domains and SLAs','sensor validation and calibration','historian mappings','archive register'),
      'outputs',jsonb_build_array('immutable source fingerprint','governance facts','prioritized findings','explicit remediation routes','independent review receipt'),
      'guardrails',jsonb_build_array(
        'Never invent identity, hierarchy, ownership, code, measurement, calibration, mapping, retention or provenance',
        'Never merge assets or rewrite operating history',
        'Never classify a failure mechanism, confirm a historian mapping, change master data or archive a record',
        'Never approve its own finding or treat a missing measurement as a passing SLA',
        'Never create work, accept risk, commit spend, change operating limits or return equipment to service'),
      'routes',jsonb_build_array('/integrations','/assets','/reliability')
    )
where key='data_steward';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_data_steward_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_data_steward_charter_shape
      check (key <> 'data_steward' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Extend only untouched platform advisory baselines. Tenant-authored control
-- history is never silently overwritten by a migration.
do $$
declare r record; v_profile uuid; v_version integer;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id,a.organization_id,p.id old_profile,p.basis old_basis,
      p.required_human_approver_role,p.proposal_risk_ceiling,
      p.proposal_cost_ceiling_usd,p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    left join public.agent_control_profiles p
      on p.agent_id=a.id and p.organization_id=a.organization_id and p.status='adopted'
    where a.key='data_steward'
  loop
    if r.old_profile is not null and r.old_basis<>v_basis then continue; end if;
    if r.old_profile is null and exists(
      select 1 from public.agent_control_profiles h where h.agent_id=r.agent_id
    ) then continue; end if;
    select coalesce(max(version),0)+1 into v_version
    from public.agent_control_profiles where agent_id=r.agent_id;
    if r.old_profile is not null then
      update public.agent_control_profiles set status='superseded' where id=r.old_profile;
    end if;
    insert into public.agent_control_profiles
      (organization_id,agent_id,authority_mode,required_human_approver_role,
       proposal_risk_ceiling,proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_at)
    values(r.organization_id,r.agent_id,'advisory_only','reliability_engineer',
      coalesce(r.proposal_risk_ceiling,'High'),
      coalesce(r.proposal_cost_ceiling_usd,0),
      coalesce(r.proposal_downtime_ceiling_hours,0),false,
      v_basis,'draft',v_version,null)
    returning id into v_profile;
    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d where d.right_key='clean_classify_wo_data';
    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in ('assess_data_governance','read_work_context','draft_recommendation');
    update public.agent_control_profiles set status='adopted',adopted_at=now()
    where id=v_profile;
  end loop;
end $$;

-- Activate the existing canonical master-data records. Unknown and not yet
-- measured remain NULL; no defaults manufacture compliance.
alter table public.data_domains
  add column if not exists basis text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);
alter table public.data_quality_slas
  add column if not exists source_reference text,
  add column if not exists recorded_by uuid references auth.users(id);
alter table public.instrument_calibrations
  add column if not exists basis text,
  add column if not exists recorded_by uuid references auth.users(id);
alter table public.historian_tag_map
  add column if not exists basis text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();
alter table public.archive_records
  add column if not exists evidence_reference text,
  add column if not exists recorded_by uuid references auth.users(id);

revoke insert,update,delete,truncate on public.data_domains,
  public.data_quality_slas,public.instrument_calibrations,
  public.historian_tag_map,public.archive_records from public,anon,authenticated;
grant select on public.data_domains,public.data_quality_slas,
  public.instrument_calibrations,public.historian_tag_map,
  public.archive_records to authenticated;

create or replace function public.protect_data_governance_master()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.data_governance_master_write',true),'');
begin
  if tg_op='DELETE' then
    raise exception 'governed master-data history is not deleted; supersede or archive it';
  end if;
  if v_marker<>'granted' then
    raise exception 'governed master data is written only by named-human control functions';
  end if;
  return new;
end $$;
revoke all on function public.protect_data_governance_master() from public,anon,authenticated;

drop trigger if exists trg_protect_data_domains on public.data_domains;
create trigger trg_protect_data_domains before insert or update or delete
  on public.data_domains for each row execute function public.protect_data_governance_master();
drop trigger if exists trg_protect_historian_tag_map on public.historian_tag_map;
create trigger trg_protect_historian_tag_map before insert or update or delete
  on public.historian_tag_map for each row execute function public.protect_data_governance_master();

create or replace function public.protect_data_governance_append_only()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.data_governance_master_write',true),'');
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'data-quality, calibration and archive evidence is append-only';
  end if;
  if v_marker<>'granted' then
    raise exception 'governance evidence is written only by named-human control functions';
  end if;
  return new;
end $$;
revoke all on function public.protect_data_governance_append_only() from public,anon,authenticated;

drop trigger if exists trg_protect_data_quality_slas on public.data_quality_slas;
create trigger trg_protect_data_quality_slas before insert or update or delete
  on public.data_quality_slas for each row execute function public.protect_data_governance_append_only();
drop trigger if exists trg_protect_instrument_calibrations on public.instrument_calibrations;
create trigger trg_protect_instrument_calibrations before insert or update or delete
  on public.instrument_calibrations for each row execute function public.protect_data_governance_append_only();
drop trigger if exists trg_protect_archive_records on public.archive_records;
create trigger trg_protect_archive_records before insert or update or delete
  on public.archive_records for each row execute function public.protect_data_governance_append_only();

create or replace function public.data_governance_human_role_allowed()
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.app_current_org() is not null
    and coalesce(public.app_current_role(),'') in
      ('reliability_engineer','maintenance_manager','admin')
$$;
revoke all on function public.data_governance_human_role_allowed() from public,anon;
grant execute on function public.data_governance_human_role_allowed() to authenticated;

create or replace function public.upsert_data_domain(
  p_domain_id bigint,p_domain_key text,p_label text,p_description text,
  p_owner_role text,p_owner_user_id uuid,p_steward_role text,p_basis text,
  p_expected_version integer default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id bigint; v_version integer;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human data-governance authority is required');
  end if;
  if coalesce(length(btrim(p_domain_key)),0)<2 or coalesce(length(btrim(p_label)),0)<2
     or coalesce(length(btrim(p_owner_role)),0)<2 or coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','domain key, label, owner role and an evidence basis of at least 10 characters are required');
  end if;
  if p_owner_user_id is not null and not exists(select 1 from public.user_profiles u
    where u.id=p_owner_user_id and u.organization_id=v_org) then
    return jsonb_build_object('error','the named owner is not a member of this organization');
  end if;
  perform set_config('app.data_governance_master_write','granted',true);
  if p_domain_id is null then
    insert into public.data_domains(organization_id,domain_key,label,description,
      owner_role,owner_user_id,steward_role,basis,updated_by)
    values(v_org,lower(btrim(p_domain_key)),btrim(p_label),nullif(btrim(p_description),''),
      btrim(p_owner_role),p_owner_user_id,nullif(btrim(p_steward_role),''),btrim(p_basis),auth.uid())
    returning id,version into v_id,v_version;
  else
    update public.data_domains set label=btrim(p_label),description=nullif(btrim(p_description),''),
      owner_role=btrim(p_owner_role),owner_user_id=p_owner_user_id,
      steward_role=nullif(btrim(p_steward_role),''),basis=btrim(p_basis),
      version=version+1,updated_at=now(),updated_by=auth.uid()
    where id=p_domain_id and organization_id=v_org
      and version=coalesce(p_expected_version,version)
    returning id,version into v_id,v_version;
    if v_id is null then
      perform set_config('app.data_governance_master_write','',true);
      return jsonb_build_object('error','data domain changed after it was loaded or is outside this organization');
    end if;
  end if;
  perform set_config('app.data_governance_master_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_domain',public.app_current_role(),jsonb_build_object(
    'action',case when p_domain_id is null then 'created' else 'updated' end,
    'domain_id',v_id,'version',v_version,'actor_id',auth.uid(),'basis',btrim(p_basis)));
  return jsonb_build_object('domainId',v_id,'version',v_version,'status','recorded');
exception when unique_violation then
  perform set_config('app.data_governance_master_write','',true);
  return jsonb_build_object('error','this organization already has that data-domain key');
end $$;
revoke all on function public.upsert_data_domain(bigint,text,text,text,text,uuid,text,text,integer)
  from public,anon;
grant execute on function public.upsert_data_domain(bigint,text,text,text,text,uuid,text,text,integer)
  to authenticated;

create or replace function public.record_data_quality_sla(
  p_domain_id bigint,p_metric text,p_target_pct numeric,p_target_lag_hours numeric,
  p_measured_pct numeric,p_measured_lag_hours numeric,p_measured_on date,
  p_basis text,p_source_reference text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id bigint;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human data-governance authority is required');
  end if;
  if not exists(select 1 from public.data_domains where id=p_domain_id and organization_id=v_org) then
    return jsonb_build_object('error','data domain is outside this organization');
  end if;
  if p_metric not in ('completeness','timeliness','validity','uniqueness','consistency') then
    return jsonb_build_object('error','unknown data-quality metric');
  end if;
  if (p_metric='timeliness' and (p_target_lag_hours is null or p_target_pct is not null))
     or (p_metric<>'timeliness' and (p_target_pct is null or p_target_lag_hours is not null)) then
    return jsonb_build_object('error','timeliness requires a lag target; all other metrics require a percentage target');
  end if;
  if (p_measured_pct is not null or p_measured_lag_hours is not null) and p_measured_on is null then
    return jsonb_build_object('error','a measured value requires its measurement date');
  end if;
  if coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','an SLA basis of at least 10 characters is required');
  end if;
  perform set_config('app.data_governance_master_write','granted',true);
  insert into public.data_quality_slas(organization_id,domain_id,metric,target_pct,
    target_lag_hours,measured_pct,measured_lag_hours,measured_on,basis,
    source_reference,recorded_by)
  values(v_org,p_domain_id,p_metric,p_target_pct,p_target_lag_hours,
    p_measured_pct,p_measured_lag_hours,p_measured_on,btrim(p_basis),
    nullif(btrim(p_source_reference),''),auth.uid()) returning id into v_id;
  perform set_config('app.data_governance_master_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_quality_sla',public.app_current_role(),jsonb_build_object(
    'action','recorded','sla_id',v_id,'domain_id',p_domain_id,'metric',p_metric,
    'measured',p_measured_pct is not null or p_measured_lag_hours is not null,
    'actor_id',auth.uid(),'basis',btrim(p_basis)));
  return jsonb_build_object('slaId',v_id,'status','recorded');
end $$;
revoke all on function public.record_data_quality_sla(bigint,text,numeric,numeric,numeric,numeric,date,text,text)
  from public,anon;
grant execute on function public.record_data_quality_sla(bigint,text,numeric,numeric,numeric,numeric,date,text,text)
  to authenticated;

create or replace function public.record_instrument_calibration(
  p_sensor_id uuid,p_asset_id uuid,p_instrument_ref text,p_calibrated_on date,
  p_interval_months integer,p_as_found_within_tolerance boolean,
  p_as_left_within_tolerance boolean,p_certificate_reference text,p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id bigint; v_sensor_asset uuid;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human calibration-record authority is required');
  end if;
  if p_sensor_id is not null then
    select asset_id into v_sensor_asset from public.sensors
    where id=p_sensor_id and organization_id=v_org;
    if v_sensor_asset is null then return jsonb_build_object('error','sensor is outside this organization'); end if;
    if p_asset_id is not null and p_asset_id<>v_sensor_asset then
      return jsonb_build_object('error','sensor and asset do not identify the same canonical equipment');
    end if;
  elsif p_asset_id is null or not exists(select 1 from public.assets
    where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','a same-tenant sensor or asset is required');
  end if;
  if p_calibrated_on is null or p_calibrated_on>current_date or p_interval_months is null
     or p_interval_months<1 or p_as_found_within_tolerance is null
     or p_as_left_within_tolerance is null
     or coalesce(length(btrim(p_instrument_ref)),0)<2
     or coalesce(length(btrim(p_certificate_reference)),0)<3
     or coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','date, interval, explicit as-found/as-left results, certificate, instrument and evidence basis are required');
  end if;
  perform set_config('app.data_governance_master_write','granted',true);
  insert into public.instrument_calibrations(organization_id,sensor_id,asset_id,
    instrument_ref,calibrated_on,interval_months,as_found_within_tolerance,
    as_left_within_tolerance,certificate_reference,basis,recorded_by)
  values(v_org,p_sensor_id,coalesce(p_asset_id,v_sensor_asset),btrim(p_instrument_ref),
    p_calibrated_on,p_interval_months,p_as_found_within_tolerance,
    p_as_left_within_tolerance,btrim(p_certificate_reference),btrim(p_basis),auth.uid())
  returning id into v_id;
  perform set_config('app.data_governance_master_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'instrument_calibration',public.app_current_role(),jsonb_build_object(
    'action','recorded','calibration_id',v_id,'sensor_id',p_sensor_id,
    'asset_id',coalesce(p_asset_id,v_sensor_asset),'actor_id',auth.uid(),
    'as_found_within_tolerance',p_as_found_within_tolerance,
    'as_left_within_tolerance',p_as_left_within_tolerance));
  return jsonb_build_object('calibrationId',v_id,'status','recorded');
end $$;
revoke all on function public.record_instrument_calibration(uuid,uuid,text,date,integer,boolean,boolean,text,text)
  from public,anon;
grant execute on function public.record_instrument_calibration(uuid,uuid,text,date,integer,boolean,boolean,text,text)
  to authenticated;

create or replace function public.confirm_historian_tag_mapping(
  p_mapping_id bigint,p_historian_tag text,p_asset_id uuid,p_sensor_id uuid,
  p_measurement text,p_unit text,p_source_system text,p_basis text,
  p_expected_version integer default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id bigint; v_version integer; v_sensor_asset uuid;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human historian-mapping authority is required');
  end if;
  if p_asset_id is null and p_sensor_id is null then
    return jsonb_build_object('error','a mapping must resolve to a canonical asset or sensor');
  end if;
  if p_asset_id is not null and not exists(select 1 from public.assets
    where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','asset is outside this organization');
  end if;
  if p_sensor_id is not null then
    select asset_id into v_sensor_asset from public.sensors
    where id=p_sensor_id and organization_id=v_org;
    if v_sensor_asset is null then return jsonb_build_object('error','sensor is outside this organization'); end if;
    if p_asset_id is not null and p_asset_id<>v_sensor_asset then
      return jsonb_build_object('error','sensor and asset do not identify the same canonical equipment');
    end if;
  end if;
  if coalesce(length(btrim(p_historian_tag)),0)<2
     or coalesce(length(btrim(p_measurement)),0)<2
     or coalesce(length(btrim(p_unit)),0)<1
     or coalesce(length(btrim(p_source_system)),0)<2
     or coalesce(length(btrim(p_basis)),0)<10 then
    return jsonb_build_object('error','tag, measurement, unit, source system and a confirmation basis of at least 10 characters are required');
  end if;
  perform set_config('app.data_governance_master_write','granted',true);
  if p_mapping_id is null then
    insert into public.historian_tag_map(organization_id,historian_tag,asset_id,
      sensor_id,measurement,unit,confirmed_by,confirmed_at,source_system,basis)
    values(v_org,btrim(p_historian_tag),coalesce(p_asset_id,v_sensor_asset),p_sensor_id,
      btrim(p_measurement),btrim(p_unit),auth.uid(),now(),btrim(p_source_system),btrim(p_basis))
    returning id,version into v_id,v_version;
  else
    update public.historian_tag_map set historian_tag=btrim(p_historian_tag),
      asset_id=coalesce(p_asset_id,v_sensor_asset),sensor_id=p_sensor_id,
      measurement=btrim(p_measurement),unit=btrim(p_unit),confirmed_by=auth.uid(),
      confirmed_at=now(),source_system=btrim(p_source_system),basis=btrim(p_basis),
      version=version+1,updated_at=now()
    where id=p_mapping_id and organization_id=v_org
      and version=coalesce(p_expected_version,version)
    returning id,version into v_id,v_version;
    if v_id is null then
      perform set_config('app.data_governance_master_write','',true);
      return jsonb_build_object('error','historian mapping changed after it was loaded or is outside this organization');
    end if;
  end if;
  perform set_config('app.data_governance_master_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'historian_tag_mapping',public.app_current_role(),jsonb_build_object(
    'action','confirmed','mapping_id',v_id,'version',v_version,
    'asset_id',coalesce(p_asset_id,v_sensor_asset),'sensor_id',p_sensor_id,
    'actor_id',auth.uid(),'basis',btrim(p_basis)));
  return jsonb_build_object('mappingId',v_id,'version',v_version,'status','confirmed');
exception when unique_violation then
  perform set_config('app.data_governance_master_write','',true);
  return jsonb_build_object('error','this organization already has that historian tag');
end $$;
revoke all on function public.confirm_historian_tag_mapping(bigint,text,uuid,uuid,text,text,text,text,integer)
  from public,anon;
grant execute on function public.confirm_historian_tag_mapping(bigint,text,uuid,uuid,text,text,text,text,integer)
  to authenticated;

create or replace function public.record_archive_disposition(
  p_record_class text,p_reference text,p_archived_on date,p_disposition text,
  p_superseded_by text,p_retention_until date,p_reason text,p_evidence_reference text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id bigint;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human records-governance authority is required');
  end if;
  if p_disposition not in ('archived','superseded','obsolete','destroyed')
     or coalesce(length(btrim(p_record_class)),0)<2
     or coalesce(length(btrim(p_reference)),0)<2
     or coalesce(length(btrim(p_reason)),0)<10
     or coalesce(length(btrim(p_evidence_reference)),0)<3 then
    return jsonb_build_object('error','record class, reference, valid disposition, evidence reference and reason are required');
  end if;
  if p_archived_on is null or p_archived_on>current_date
     or (p_retention_until is not null and p_retention_until<p_archived_on)
     or (p_disposition='superseded' and coalesce(length(btrim(p_superseded_by)),0)<2) then
    return jsonb_build_object('error','archive date, retention and supersession evidence are inconsistent');
  end if;
  perform set_config('app.data_governance_master_write','granted',true);
  insert into public.archive_records(organization_id,record_class,reference,archived_on,
    disposition,superseded_by,retention_until,reason,evidence_reference,recorded_by)
  values(v_org,btrim(p_record_class),btrim(p_reference),p_archived_on,p_disposition,
    nullif(btrim(p_superseded_by),''),p_retention_until,btrim(p_reason),
    btrim(p_evidence_reference),auth.uid()) returning id into v_id;
  perform set_config('app.data_governance_master_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'archive_record',public.app_current_role(),jsonb_build_object(
    'action','recorded','archive_id',v_id,'record_class',btrim(p_record_class),
    'disposition',p_disposition,'actor_id',auth.uid(),
    'evidence_reference',btrim(p_evidence_reference)));
  return jsonb_build_object('archiveId',v_id,'status','recorded');
end $$;
revoke all on function public.record_archive_disposition(text,text,date,text,text,date,text,text)
  from public,anon;
grant execute on function public.record_archive_disposition(text,text,date,text,text,date,text,text)
  to authenticated;

-- Retained specialist evidence. The data-domain FK gives an organization-wide
-- data assessment a canonical scope without pretending one arbitrary asset or
-- site represents the complete governed population.
alter table public.agent_runs
  add column if not exists data_domain_id bigint
    references public.data_domains(id) on delete set null;
create index if not exists idx_agent_runs_retained_data_domain
  on public.agent_runs(organization_id,data_domain_id,created_at desc)
  where retained_for_governance;

create table if not exists public.data_steward_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_domain_id bigint not null references public.data_domains(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  source_snapshot jsonb not null,
  facts jsonb not null,
  findings jsonb not null,
  limitations jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(source_snapshot)='object'),
  check (jsonb_typeof(facts)='object'),
  check (jsonb_typeof(findings)='array'),
  check (jsonb_typeof(limitations)='array')
);
create index if not exists idx_data_steward_assessments_domain
  on public.data_steward_assessments(organization_id,data_domain_id,created_at desc);

create table if not exists public.data_steward_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.data_steward_assessments(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check (length(btrim(assignment_note))>=10),
  assigned_at timestamptz not null default now(),
  unique(assessment_id,assigned_to)
);

create table if not exists public.data_steward_dispositions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.data_steward_assessments(id) on delete restrict,
  finding_key text not null,
  disposition text not null check (disposition in ('accepted','remediated','deferred','rejected')),
  note text not null check (length(btrim(note))>=20),
  evidence_reference text,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  unique(assessment_id,finding_key),
  check (disposition<>'remediated' or length(btrim(coalesce(evidence_reference,'')))>=3)
);

alter table public.data_steward_assessments enable row level security;
alter table public.data_steward_review_assignments enable row level security;
alter table public.data_steward_dispositions enable row level security;
drop policy if exists data_steward_assessments_read on public.data_steward_assessments;
create policy data_steward_assessments_read on public.data_steward_assessments
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists data_steward_review_assignments_read on public.data_steward_review_assignments;
create policy data_steward_review_assignments_read on public.data_steward_review_assignments
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists data_steward_dispositions_read on public.data_steward_dispositions;
create policy data_steward_dispositions_read on public.data_steward_dispositions
  for select to authenticated using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.data_steward_assessments,
  public.data_steward_review_assignments,public.data_steward_dispositions
  from public,anon,authenticated;
grant select on public.data_steward_assessments,
  public.data_steward_review_assignments,public.data_steward_dispositions
  to authenticated;

create or replace function public.protect_data_steward_records()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'data-steward assessments, assignments and dispositions are append-only';
  end if;
  if coalesce(current_setting('app.data_steward_record_write',true),'')<>'granted' then
    raise exception 'data-steward records are written only by governed workflows';
  end if;
  return new;
end $$;
revoke all on function public.protect_data_steward_records() from public,anon,authenticated;
drop trigger if exists trg_protect_data_steward_assessments on public.data_steward_assessments;
create trigger trg_protect_data_steward_assessments before insert or update or delete
  on public.data_steward_assessments for each row execute function public.protect_data_steward_records();
drop trigger if exists trg_protect_data_steward_assignments on public.data_steward_review_assignments;
create trigger trg_protect_data_steward_assignments before insert or update or delete
  on public.data_steward_review_assignments for each row execute function public.protect_data_steward_records();
drop trigger if exists trg_protect_data_steward_dispositions on public.data_steward_dispositions;
create trigger trg_protect_data_steward_dispositions before insert or update or delete
  on public.data_steward_dispositions for each row execute function public.protect_data_steward_records();

-- Preserve every existing retained-run writer while adding a canonical data
-- domain scope for this specialist.
create or replace function public.enforce_retained_agent_run()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_planner_marker text:=coalesce(current_setting('app.planner_agent_run_write',true),'');
  v_site_marker text:=coalesce(current_setting('app.site_manager_agent_run_write',true),'');
  v_reliability_marker text:=coalesce(current_setting('app.reliability_agent_run_write',true),'');
  v_fracas_marker text:=coalesce(current_setting('app.fracas_agent_run_write',true),'');
  v_condition_marker text:=coalesce(current_setting('app.condition_agent_run_write',true),'');
  v_mro_marker text:=coalesce(current_setting('app.mro_materials_agent_run_write',true),'');
  v_turnaround_marker text:=coalesce(current_setting('app.turnaround_agent_run_write',true),'');
  v_strategy_marker text:=coalesce(current_setting('app.asset_strategy_agent_run_write',true),'');
  v_data_marker text:=coalesce(current_setting('app.data_steward_agent_run_write',true),'');
  v_allowed boolean:=v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted'
    or v_condition_marker='granted' or v_mro_marker='granted'
    or v_turnaround_marker='granted' or v_strategy_marker='granted'
    or v_data_marker='granted';
begin
  if tg_op='DELETE' and old.retained_for_governance then return null; end if;
  if tg_op='UPDATE' and old.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op='INSERT' and new.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are written only by a governed agent execution path';
  end if;
  if tg_op<>'DELETE' and new.retained_for_governance then
    if new.requested_by is null
      or (new.work_order_id is null and new.site_id is null
          and nullif(btrim(new.component_scope),'') is null
          and new.asset_id is null and new.material_id is null
          and new.outage_window_id is null and new.data_domain_id is null)
      or new.agent_control_profile_id is null
      or coalesce(btrim(new.agent_tool_key),'')=''
      or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component/asset/material/outage/data-domain scope, control profile, tool and decision-right provenance';
    end if;
    if not exists(select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists(select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.asset_id is not null and not exists(select 1 from public.assets a
      where a.id=new.asset_id and a.organization_id=new.organization_id) then
      raise exception 'agent run names an asset outside its organization';
    end if;
    if new.material_id is not null and not exists(select 1 from public.materials m
      where m.id=new.material_id and m.organization_id=new.organization_id) then
      raise exception 'agent run names a material outside its organization';
    end if;
    if new.outage_window_id is not null and not exists(select 1 from public.outage_windows w
      where w.id=new.outage_window_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names an outage outside its organization';
    end if;
    if new.data_domain_id is not null and not exists(select 1 from public.data_domains d
      where d.id=new.data_domain_id and d.organization_id=new.organization_id) then
      raise exception 'agent run names a data domain outside its organization';
    end if;
    if new.work_order_id is not null and not exists(select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.site_id is not null and not exists(select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id) then
      raise exception 'agent run names a site outside its organization';
    end if;
    if nullif(btrim(new.component_scope),'') is not null and not exists(
      select 1 from public.component_life_events e
      where e.organization_id=new.organization_id
        and lower(e.component)=lower(btrim(new.component_scope))) then
      raise exception 'agent run names a component population outside its organization';
    end if;
    if new.job_plan_id is not null and not exists(select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists(select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted') then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.sync_data_steward_source_snapshot(p_org uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'capturedAt',now(),
    'assets',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'site',site_id,'tag',tag,'enterpriseId',enterprise_asset_id,
        'functionalLocation',functional_location,'area',area,'system',system,
        'class',asset_class)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.assets where organization_id=p_org),
    'components',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'assetId',asset_id,'name',name,'type',type)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.components where organization_id=p_org),
    'correctiveWork',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'assetId',asset_id,'sourceLabel',actual_failure_mode,
        'systemGroup',system_group,'mechanismId',failure_mechanism_id)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.work_orders where organization_id=p_org and work_type='corrective'),
    'failureCodeMap',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'sourceLabel',source_label,'kind',label_kind,'reviewedAt',reviewed_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.failure_code_map where organization_id=p_org),
    'dataDomains',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'key',domain_key,'ownerRole',owner_role,'owner',owner_user_id,
        'stewardRole',steward_role,'version',version)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.data_domains where organization_id=p_org),
    'dataQualitySlas',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'domainId',domain_id,'metric',metric,'targetPct',target_pct,
        'targetLagHours',target_lag_hours,'measuredPct',measured_pct,
        'measuredLagHours',measured_lag_hours,'measuredOn',measured_on)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.data_quality_slas where organization_id=p_org),
    'sensors',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',s.id,'assetId',s.asset_id,'signal',s.signal_type,'unit',s.unit,
        'validationRule',r.sensor_id is not null)::text,'|' order by s.id),'empty'),'sha256'),'hex'))
      from public.sensors s left join public.sensor_validation_rules r
        on r.sensor_id=s.id and r.organization_id=s.organization_id
      where s.organization_id=p_org),
    'calibrations',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'sensorId',sensor_id,'assetId',asset_id,'instrument',instrument_ref,
        'date',calibrated_on,'intervalMonths',interval_months,
        'asFound',as_found_within_tolerance,'asLeft',as_left_within_tolerance,
        'certificate',certificate_reference)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.instrument_calibrations where organization_id=p_org),
    'historianMappings',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'tag',historian_tag,'assetId',asset_id,'sensorId',sensor_id,
        'measurement',measurement,'unit',unit,'confirmedAt',confirmed_at,
        'source',source_system,'version',version)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.historian_tag_map where organization_id=p_org),
    'archiveRegister',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'class',record_class,'reference',reference,'date',archived_on,
        'disposition',disposition,'retentionUntil',retention_until)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.archive_records where organization_id=p_org)
  )
$$;
revoke all on function public.sync_data_steward_source_snapshot(uuid)
  from public,anon,authenticated;

create or replace function public.run_data_steward_agent(p_data_domain_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_domain public.data_domains%rowtype; v_agent public.ai_agents%rowtype;
  v_control jsonb; v_run uuid; v_assessment uuid; v_snapshot jsonb;
  v_assets bigint; v_stable bigint; v_hierarchy bigint; v_components bigint;
  v_corrective bigint; v_coded bigint; v_raw_labels bigint; v_mapped_labels bigint;
  v_slas bigint; v_unmeasured bigint; v_breaches bigint;
  v_sensors bigint; v_ruled bigint; v_calibrations bigint; v_overdue bigint;
  v_mappings bigint; v_unconfirmed bigint; v_archives bigint;
  v_facts jsonb; v_findings jsonb:='[]'::jsonb; v_key text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','running the Data Steward Specialist requires a named maintenance, reliability or administrator role');
  end if;
  select * into v_domain from public.data_domains
  where id=p_data_domain_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','data domain not found in this organization'); end if;
  if v_domain.owner_user_id is null then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','domain_owner_missing','category','master_data','severity','high',
      'observed','The selected domain has an owner role but no named accountable owner.',
      'expected','A same-tenant named owner is assigned through the governed domain record.',
      'route','/integrations','humanActionRequired',true));
  end if;

  select * into v_agent from public.ai_agents
  where organization_id=v_org and key='data_steward' order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Data Steward Specialist is configured'); end if;
  v_control:=public.evaluate_agent_control_internal(v_org,v_agent.id,
    'clean_classify_wo_data','assess_data_governance','High',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Data Steward Specialist refused: '||(v_control->>'reason'));
  end if;

  select count(*),count(*) filter(where coalesce(nullif(btrim(tag),''),
    nullif(btrim(serial_number),''),nullif(btrim(enterprise_asset_id),'')) is not null),
    count(*) filter(where site_id is not null and nullif(btrim(area),'') is not null
      and nullif(btrim(system),'') is not null and nullif(btrim(functional_location),'') is not null)
    into v_assets,v_stable,v_hierarchy from public.assets where organization_id=v_org;
  select count(*) into v_components from public.components where organization_id=v_org;
  select count(*),count(*) filter(where failure_mechanism_id is not null),
    count(distinct actual_failure_mode) filter(where nullif(btrim(actual_failure_mode),'') is not null)
    into v_corrective,v_coded,v_raw_labels from public.work_orders
    where organization_id=v_org and work_type='corrective';
  select count(*) into v_mapped_labels from public.failure_code_map
    where organization_id=v_org and source_label in (
      select distinct actual_failure_mode from public.work_orders
      where organization_id=v_org and work_type='corrective'
        and nullif(btrim(actual_failure_mode),'') is not null);
  with latest as (
    select distinct on(domain_id,metric) * from public.data_quality_slas
    where organization_id=v_org and domain_id=p_data_domain_id
    order by domain_id,metric,created_at desc,id desc
  ) select count(*),count(*) filter(where measured_on is null or
      (measured_pct is null and measured_lag_hours is null)),
    count(*) filter(where (target_pct is not null and measured_pct is not null and measured_pct<target_pct)
      or (target_lag_hours is not null and measured_lag_hours is not null and measured_lag_hours>target_lag_hours))
    into v_slas,v_unmeasured,v_breaches from latest;
  select count(*),count(*) filter(where r.sensor_id is not null)
    into v_sensors,v_ruled from public.sensors s
    left join public.sensor_validation_rules r on r.sensor_id=s.id and r.organization_id=s.organization_id
    where s.organization_id=v_org;
  select count(*),count(*) filter(where interval_months is not null and
      (calibrated_on is null or calibrated_on < current_date-(interval_months||' months')::interval))
    into v_calibrations,v_overdue from public.instrument_calibrations where organization_id=v_org;
  select count(*),count(*) filter(where confirmed_at is null)
    into v_mappings,v_unconfirmed from public.historian_tag_map where organization_id=v_org;
  select count(*) into v_archives from public.archive_records where organization_id=v_org;

  if v_assets=0 then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','asset_register_empty','category','asset_hierarchy','severity','critical',
      'observed','No canonical assets are recorded.','expected','Customer assets are loaded through the governed import contract.',
      'route','/pm-programme','humanActionRequired',true));
  elsif v_stable<v_assets then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','asset_identity_incomplete','category','asset_hierarchy','severity','high',
      'observed',format('%s of %s assets carry a stable tag, serial or enterprise identifier.',v_stable,v_assets),
      'expected','Every governed asset carries at least one stable source identifier.',
      'route','/assets','humanActionRequired',true));
  end if;
  if v_assets>0 and v_hierarchy<v_assets then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','asset_hierarchy_incomplete','category','asset_hierarchy','severity','high',
      'observed',format('%s of %s assets carry site, area, system and functional-location context.',v_hierarchy,v_assets),
      'expected','Every asset resolves through the canonical site → asset → component structure with stated area, system and functional location.',
      'route','/assets','humanActionRequired',true));
  end if;
  if v_corrective>v_coded then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','failure_mechanism_coding_incomplete','category','failure_codes','severity','high',
      'observed',format('%s of %s corrective work orders carry a human-coded failure mechanism.',v_coded,v_corrective),
      'expected','Applicable corrective history is coded by a named human from the governed mechanism library.',
      'route','/reliability','humanActionRequired',true));
  end if;
  if v_raw_labels>v_mapped_labels then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','source_failure_vocabulary_unclassified','category','failure_codes','severity','medium',
      'observed',format('%s of %s distinct corrective source labels have a governed vocabulary classification.',v_mapped_labels,v_raw_labels),
      'expected','Every distinct source label is explicitly classified without pretending a system group is a failure mechanism.',
      'route','/reliability','humanActionRequired',true));
  end if;
  if v_slas=0 then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','data_quality_sla_missing','category','data_quality','severity','high',
      'observed','The selected domain has no recorded data-quality service level.',
      'expected','At least one governed quality target and measurement basis is recorded.',
      'route','/integrations','humanActionRequired',true));
  elsif v_unmeasured>0 then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','data_quality_sla_unmeasured','category','data_quality','severity','medium',
      'observed',format('%s of %s latest SLA metrics have no measurement.',v_unmeasured,v_slas),
      'expected','A missing measurement remains unknown and is resolved with source evidence; it is never treated as passing.',
      'route','/integrations','humanActionRequired',true));
  end if;
  if v_breaches>0 then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','data_quality_sla_breached','category','data_quality','severity','high',
      'observed',format('%s of %s latest measured SLA metrics breach their target.',v_breaches,v_slas),
      'expected','The named domain owner records a corrective evidence plan and a later measurement.',
      'route','/integrations','humanActionRequired',true));
  end if;
  if v_sensors>v_ruled then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','sensor_validation_rules_incomplete','category','data_quality','severity','high',
      'observed',format('%s of %s sensors have a validation rule.',v_ruled,v_sensors),
      'expected','Every sensor used for a governed decision has reviewed physical/rate/stuck-signal checks.',
      'route','/integrations','humanActionRequired',true));
  end if;
  if v_overdue>0 then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','instrument_calibration_overdue','category','calibration','severity','high',
      'observed',format('%s of %s calibration records are overdue by their stated interval.',v_overdue,v_calibrations),
      'expected','A named human records current as-found/as-left evidence and the certificate reference.',
      'route','/integrations','humanActionRequired',true));
  end if;
  if v_unconfirmed>0 then
    v_findings:=v_findings||jsonb_build_array(jsonb_build_object(
      'findingKey','historian_mapping_unconfirmed','category','master_data','severity','high',
      'observed',format('%s of %s historian mappings have no named-human confirmation.',v_unconfirmed,v_mappings),
      'expected','Every operational tag mapping is confirmed against a same-tenant asset or sensor.',
      'route','/integrations','humanActionRequired',true));
  end if;

  if jsonb_array_length(v_findings)=0 then
    v_findings:=jsonb_build_array(jsonb_build_object(
      'findingKey','no_current_exception','category','data_quality','severity','information',
      'observed','No exception is visible in the currently recorded governance evidence.',
      'expected','Continue periodic independent review; absence of a recorded exception is not certification.',
      'route','/integrations','humanActionRequired',true));
  end if;
  v_snapshot:=public.sync_data_steward_source_snapshot(v_org);
  v_facts:=jsonb_build_object(
    'domain',jsonb_build_object('id',v_domain.id,'key',v_domain.domain_key,'label',v_domain.label,
      'ownerRole',v_domain.owner_role,'ownerUserId',v_domain.owner_user_id,'version',v_domain.version),
    'assetHierarchy',jsonb_build_object('assets',v_assets,'stableIdentity',v_stable,
      'completeHierarchy',v_hierarchy,'components',v_components),
    'failureCoding',jsonb_build_object('correctiveWork',v_corrective,'codedMechanisms',v_coded,
      'distinctSourceLabels',v_raw_labels,'classifiedSourceLabels',v_mapped_labels),
    'dataQuality',jsonb_build_object('latestSlas',v_slas,'unmeasured',v_unmeasured,
      'breaches',v_breaches,'sensors',v_sensors,'sensorsWithRules',v_ruled),
    'calibration',jsonb_build_object('records',v_calibrations,'overdue',v_overdue),
    'historianMappings',jsonb_build_object('records',v_mappings,'unconfirmed',v_unconfirmed),
    'archiveRegister',jsonb_build_object('records',v_archives));

  perform set_config('app.data_steward_agent_run_write','granted',true);
  insert into public.agent_runs(organization_id,agent_id,status,summary,confidence,
    started_at,completed_at,requested_by,data_domain_id,agent_control_profile_id,
    agent_tool_key,agent_decision_right_key,input_snapshot,result,retained_for_governance)
  values(v_org,v_agent.id,'completed',
    'Assessed canonical hierarchy, failure coding, master data and data-quality evidence without changing source records.',
    case when jsonb_array_length(v_findings)>0 then 80 else 0 end,now(),now(),auth.uid(),
    v_domain.id,(v_control->>'profile_id')::uuid,'assess_data_governance',
    'clean_classify_wo_data',v_snapshot,jsonb_build_object('facts',v_facts,'findings',v_findings,
      'advisory',true,'mayChangeMasterData',false,'mayMergeAssets',false,
      'mayCodeFailure',false,'mayConfirmMapping',false,'mayArchiveRecord',false,
      'mayCreateWork',false,'mayAcceptRisk',false,'mayCommitSpend',false,
      'mayReturnToService',false),true) returning id into v_run;
  perform set_config('app.data_steward_record_write','granted',true);
  insert into public.data_steward_assessments(organization_id,data_domain_id,
    agent_run_id,source_snapshot,facts,findings,limitations,created_by)
  values(v_org,v_domain.id,v_run,v_snapshot,v_facts,v_findings,jsonb_build_array(
    'The assessment describes only records present at the captured fingerprints; absent external records remain absent.',
    'A source-population digest detects change but does not prove the upstream record was correct.',
    'A missing measurement is unknown, never passing; a source label is not promoted to a failure mechanism.',
    'The specialist cannot change hierarchy, master data, codes, mappings, calibration evidence or archive disposition.',
    'Findings are advisory and require independent named-human review.'),auth.uid())
  returning id into v_assessment;
  perform set_config('app.data_steward_record_write','',true);
  perform set_config('app.data_steward_agent_run_write','',true);
  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Data-governance assessment for '||v_domain.label,
    last_action='Generated an immutable governed data-steward assessment',
    recommendations_generated=coalesce(recommendations_generated,0)+jsonb_array_length(v_findings)
  where id=v_agent.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_steward_assessment',v_role,jsonb_build_object(
    'action','generated','assessment_id',v_assessment,'agent_run_id',v_run,
    'data_domain_id',v_domain.id,'requested_by',auth.uid(),
    'finding_count',jsonb_array_length(v_findings),'source_snapshot',v_snapshot,
    'advisory',true));
  return jsonb_build_object('assessmentId',v_assessment,'runId',v_run,
    'facts',v_facts,'findings',v_findings,'advisory',true,
    'mayChangeMasterData',false,'mayMergeAssets',false,'mayCodeFailure',false,
    'mayConfirmMapping',false,'mayArchiveRecord',false,'mayCreateWork',false,
    'mayAcceptRisk',false,'mayCommitSpend',false,'mayReturnToService',false);
end $$;
revoke all on function public.run_data_steward_agent(bigint) from public,anon;
grant execute on function public.run_data_steward_agent(bigint) to authenticated;

create or replace function public.assign_data_steward_review(
  p_assessment_id uuid,p_assigned_to uuid,p_due_date date,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); a public.data_steward_assessments%rowtype; v_id uuid;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human data-governance authority is required');
  end if;
  select * into a from public.data_steward_assessments
  where id=p_assessment_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','assessment not found'); end if;
  if p_assigned_to=a.created_by then
    return jsonb_build_object('error','segregation of duties requires a reviewer other than the assessment requester');
  end if;
  if not exists(select 1 from public.user_profiles u where u.id=p_assigned_to
    and u.organization_id=v_org and u.role in ('reliability_engineer','maintenance_manager','admin')) then
    return jsonb_build_object('error','reviewer must be a same-tenant named maintenance, reliability or administrator');
  end if;
  if p_due_date<current_date or coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','a current due date and review basis of at least 10 characters are required');
  end if;
  perform set_config('app.data_steward_record_write','granted',true);
  insert into public.data_steward_review_assignments(organization_id,assessment_id,
    assigned_to,assigned_by,due_date,assignment_note)
  values(v_org,a.id,p_assigned_to,auth.uid(),p_due_date,btrim(p_note)) returning id into v_id;
  perform set_config('app.data_steward_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_steward_review',public.app_current_role(),jsonb_build_object(
    'action','assigned','assignment_id',v_id,'assessment_id',a.id,
    'assigned_to',p_assigned_to,'assigned_by',auth.uid(),'due_date',p_due_date));
  return jsonb_build_object('assignmentId',v_id,'status','assigned');
exception when unique_violation then
  perform set_config('app.data_steward_record_write','',true);
  return jsonb_build_object('error','this reviewer is already assigned to the assessment');
end $$;
revoke all on function public.assign_data_steward_review(uuid,uuid,date,text) from public,anon;
grant execute on function public.assign_data_steward_review(uuid,uuid,date,text) to authenticated;

create or replace function public.record_data_steward_disposition(
  p_assessment_id uuid,p_finding_key text,p_disposition text,p_note text,
  p_evidence_reference text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); a public.data_steward_assessments%rowtype; v_id uuid;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error','named human data-governance review authority is required');
  end if;
  select * into a from public.data_steward_assessments
  where id=p_assessment_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','assessment not found'); end if;
  if a.created_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires disposition by a different named human');
  end if;
  if not exists(select 1 from public.data_steward_review_assignments r
    where r.assessment_id=a.id and r.organization_id=v_org and r.assigned_to=auth.uid()) then
    return jsonb_build_object('error','this named human is not assigned to review the assessment');
  end if;
  if p_disposition not in ('accepted','remediated','deferred','rejected')
     or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','valid disposition and a review note of at least 20 characters are required');
  end if;
  if not exists(select 1 from jsonb_array_elements(a.findings) f
    where f->>'findingKey'=p_finding_key) then
    return jsonb_build_object('error','finding key is not present in the immutable assessment');
  end if;
  if p_disposition='remediated' and coalesce(length(btrim(p_evidence_reference)),0)<3 then
    return jsonb_build_object('error','remediation requires a stable evidence reference');
  end if;
  perform set_config('app.data_steward_record_write','granted',true);
  insert into public.data_steward_dispositions(organization_id,assessment_id,
    finding_key,disposition,note,evidence_reference,reviewed_by)
  values(v_org,a.id,p_finding_key,p_disposition,btrim(p_note),
    nullif(btrim(p_evidence_reference),''),auth.uid()) returning id into v_id;
  perform set_config('app.data_steward_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'data_steward_disposition',public.app_current_role(),jsonb_build_object(
    'action','reviewed','disposition_id',v_id,'assessment_id',a.id,
    'finding_key',p_finding_key,'disposition',p_disposition,
    'reviewed_by',auth.uid(),'evidence_reference',nullif(btrim(p_evidence_reference),''),
    'authority','This receipt does not change master data, merge assets, recode failure history, create work, accept risk or return equipment to service.'));
  return jsonb_build_object('dispositionId',v_id,'status',p_disposition,
    'masterDataChanged',false,'operationalAuthorization',false);
exception when unique_violation then
  perform set_config('app.data_steward_record_write','',true);
  return jsonb_build_object('error','this finding already has an immutable disposition');
end $$;
revoke all on function public.record_data_steward_disposition(uuid,text,text,text,text)
  from public,anon;
grant execute on function public.record_data_steward_disposition(uuid,text,text,text,text)
  to authenticated;

create or replace function public.get_data_steward_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','authentication required'); end if;
  return jsonb_build_object(
    'domains',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'key',d.domain_key,'label',d.label,'description',d.description,
      'ownerRole',d.owner_role,'ownerUserId',d.owner_user_id,'ownerName',u.full_name,
      'stewardRole',d.steward_role,'basis',d.basis,'version',d.version,
      'updatedAt',d.updated_at) order by d.label)
      from public.data_domains d left join public.user_profiles u on u.id=d.owner_user_id
      where d.organization_id=v_org),'[]'::jsonb),
    'slas',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'domainId',q.domain_id,'metric',q.metric,'targetPct',q.target_pct,
      'targetLagHours',q.target_lag_hours,'measuredPct',q.measured_pct,
      'measuredLagHours',q.measured_lag_hours,'measuredOn',q.measured_on,
      'basis',q.basis,'sourceReference',q.source_reference,'createdAt',q.created_at)
      order by q.created_at desc,q.id desc)
      from (select * from public.data_quality_slas where organization_id=v_org
        order by created_at desc,id desc limit 100) q),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'tag',coalesce(a.tag,a.asset_tag),
      'functionalLocation',a.functional_location,'siteId',a.site_id)
      order by a.name) from (select * from public.assets where organization_id=v_org
        order by name limit 500) a),'[]'::jsonb),
    'sensors',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'assetId',s.asset_id,'assetName',a.name,
      'signalType',s.signal_type,'unit',s.unit) order by a.name,s.name)
      from public.sensors s join public.assets a on a.id=s.asset_id
      where s.organization_id=v_org),'[]'::jsonb),
    'calibrations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'sensorId',c.sensor_id,'assetId',c.asset_id,
      'instrumentRef',c.instrument_ref,'calibratedOn',c.calibrated_on,
      'intervalMonths',c.interval_months,'asFoundWithinTolerance',c.as_found_within_tolerance,
      'asLeftWithinTolerance',c.as_left_within_tolerance,
      'certificateReference',c.certificate_reference,'basis',c.basis,'createdAt',c.created_at)
      order by c.created_at desc,c.id desc)
      from (select * from public.instrument_calibrations where organization_id=v_org
        order by created_at desc,id desc limit 100) c),'[]'::jsonb),
    'historianMappings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'historianTag',h.historian_tag,'assetId',h.asset_id,
      'sensorId',h.sensor_id,'measurement',h.measurement,'unit',h.unit,
      'confirmedBy',h.confirmed_by,'confirmedAt',h.confirmed_at,
      'sourceSystem',h.source_system,'basis',h.basis,'version',h.version,
      'updatedAt',h.updated_at) order by h.historian_tag)
      from public.historian_tag_map h where h.organization_id=v_org),'[]'::jsonb),
    'archiveRecords',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'recordClass',a.record_class,'reference',a.reference,
      'archivedOn',a.archived_on,'disposition',a.disposition,
      'supersededBy',a.superseded_by,'retentionUntil',a.retention_until,
      'reason',a.reason,'evidenceReference',a.evidence_reference,'createdAt',a.created_at)
      order by a.created_at desc,a.id desc)
      from (select * from public.archive_records where organization_id=v_org
        order by created_at desc,id desc limit 100) a),'[]'::jsonb),
    'assessments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'dataDomainId',a.data_domain_id,'domainLabel',d.label,
      'agentRunId',a.agent_run_id,'sourceSnapshot',a.source_snapshot,
      'facts',a.facts,'findings',a.findings,'limitations',a.limitations,
      'createdBy',a.created_by,'createdAt',a.created_at,
      'assignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'assignedTo',r.assigned_to,'reviewerName',u.full_name,
        'reviewerEmail',u.email,'dueDate',r.due_date,'note',r.assignment_note,
        'assignedAt',r.assigned_at) order by r.assigned_at)
        from public.data_steward_review_assignments r
        left join public.user_profiles u on u.id=r.assigned_to
        where r.assessment_id=a.id),'[]'::jsonb),
      'dispositions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',x.id,'findingKey',x.finding_key,'disposition',x.disposition,
        'note',x.note,'evidenceReference',x.evidence_reference,
        'reviewedBy',x.reviewed_by,'reviewedAt',x.reviewed_at) order by x.reviewed_at)
        from public.data_steward_dispositions x where x.assessment_id=a.id),'[]'::jsonb))
      order by a.created_at desc)
      from public.data_steward_assessments a join public.data_domains d
        on d.id=a.data_domain_id and d.organization_id=a.organization_id
      where a.organization_id=v_org),'[]'::jsonb),
    'reviewers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',u.id,'name',u.full_name,'email',u.email,'role',u.role)
      order by coalesce(u.full_name,u.email)) from public.user_profiles u
      where u.organization_id=v_org and u.role in
        ('reliability_engineer','maintenance_manager','admin')),'[]'::jsonb),
    'identityPosture',coalesce((select to_jsonb(p) from public.get_identity_posture() p),'{}'::jsonb),
    'basis','The Data Steward Specialist reads the canonical asset/component hierarchy, human-coded failure history and existing governance records. Named humans own domain, SLA, calibration, mapping and archive evidence through controlled RPCs. Findings and dispositions are immutable; neither changes operational or master-data state.'
  );
end $$;
revoke all on function public.get_data_steward_workspace() from public,anon;
grant execute on function public.get_data_steward_workspace() to authenticated;

comment on table public.data_steward_assessments is
  'C1.12 immutable Data Steward Specialist assessment over exact canonical hierarchy, failure-code, master-data and data-quality fingerprints.';
comment on function public.run_data_steward_agent(bigint) is
  'C1.12 governed advisory execution. It reads and fingerprints canonical evidence but cannot mutate master data or authorize operations.';
comment on function public.record_data_steward_disposition(uuid,text,text,text,text) is
  'C1.12 independent named-human finding disposition. It is a review receipt, never a master-data or operational action.';

notify pgrst,'reload schema';
