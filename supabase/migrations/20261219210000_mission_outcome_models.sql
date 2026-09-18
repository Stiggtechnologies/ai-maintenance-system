-- U1.01 — governed mission/outcome models by organization type.
--
-- Templates are reference starting points.  Only an organization-owned,
-- independently approved version becomes its effective mission model.  The
-- model informs consequence and value framing; it never authorizes work or
-- asserts that an outcome was achieved without cited evidence.

create table if not exists public.mission_outcome_model_templates (
  organization_type text primary key,
  title text not null,
  mission_pattern text not null,
  outcomes jsonb not null check (jsonb_typeof(outcomes)='array' and jsonb_array_length(outcomes)>0),
  measures jsonb not null check (jsonb_typeof(measures)='array' and jsonb_array_length(measures)>0),
  consequence_dimensions jsonb not null check (jsonb_typeof(consequence_dimensions)='array' and jsonb_array_length(consequence_dimensions)>0),
  evidence_requirements jsonb not null check (jsonb_typeof(evidence_requirements)='array' and jsonb_array_length(evidence_requirements)>0),
  limitations text not null,
  version int not null default 1 check (version>0),
  active boolean not null default true,
  register_ref text not null default 'U1.01'
);

insert into public.mission_outcome_model_templates
  (organization_type,title,mission_pattern,outcomes,measures,consequence_dimensions,evidence_requirements,limitations)
values
('utility','Utility service outcomes','Deliver safe, reliable and affordable utility service while protecting workers, the public and the environment.',
 '[{"code":"service_continuity","name":"Service continuity"},{"code":"public_safety","name":"Public safety"},{"code":"affordability","name":"Affordability"},{"code":"environmental_stewardship","name":"Environmental stewardship"}]',
 '[{"code":"saidi","name":"Interruption duration"},{"code":"saifi","name":"Interruption frequency"},{"code":"restoration_time","name":"Restoration time"},{"code":"safety_events","name":"Safety events"}]',
 '["worker_safety","public_safety","customer_interruption","environment","regulatory","affordability"]','["outage records","customer interruption records","safety events","regulatory obligations","approved service targets"]',
 'Adapt to the regulated service, jurisdiction and approved utility targets; the template is not a regulatory determination.'),
('water','Water and wastewater outcomes','Provide safe, compliant and resilient water and wastewater services that protect public health and receiving environments.',
 '[{"code":"water_safety","name":"Safe water"},{"code":"service_continuity","name":"Service continuity"},{"code":"environmental_protection","name":"Environmental protection"},{"code":"resilience","name":"Resilience"}]',
 '[{"code":"quality_compliance","name":"Quality compliance"},{"code":"service_interruptions","name":"Service interruptions"},{"code":"overflow_events","name":"Overflow events"},{"code":"water_loss","name":"Water loss"}]',
 '["public_health","vulnerable_populations","customer_interruption","environment","regulatory","community_trust"]','["laboratory results","distribution and treatment alarms","overflow records","public-health requirements","approved service targets"]',
 'Local public-health, environmental and operating approvals remain authoritative.'),
('rail','Rail service outcomes','Move passengers or freight safely, punctually and reliably while preserving network and rolling-stock integrity.',
 '[{"code":"safe_movement","name":"Safe movement"},{"code":"punctuality","name":"Punctuality"},{"code":"network_availability","name":"Network availability"},{"code":"capacity","name":"Capacity"}]',
 '[{"code":"safety_occurrences","name":"Safety occurrences"},{"code":"on_time_performance","name":"On-time performance"},{"code":"delay_minutes","name":"Delay minutes"},{"code":"asset_restrictions","name":"Asset restrictions"}]',
 '["passenger_safety","worker_safety","transportation_disruption","freight_customer","regulatory","community"]','["movement and delay records","inspection records","speed restrictions","safety occurrences","approved timetable or freight commitments"]',
 'Railway rules, engineering standards and operating authority remain jurisdiction- and operator-specific.'),
('airline','Airline service outcomes','Operate air services safely, compliantly and predictably with airworthy aircraft and protected passenger journeys.',
 '[{"code":"airworthiness","name":"Airworthiness"},{"code":"safe_operation","name":"Safe operation"},{"code":"schedule_completion","name":"Schedule completion"},{"code":"passenger_continuity","name":"Passenger continuity"}]',
 '[{"code":"dispatch_reliability","name":"Dispatch reliability"},{"code":"completion_factor","name":"Completion factor"},{"code":"technical_delays","name":"Technical delays"},{"code":"airworthiness_findings","name":"Airworthiness findings"}]',
 '["passenger_safety","crew_safety","airworthiness","customer_disruption","regulatory","reputation"]','["technical logs","airworthiness directives","maintenance programme records","delay and cancellation data","approved operating certificate obligations"]',
 'The approved maintenance programme, type design and aviation authority requirements always govern.'),
('hospital','Hospital care-support outcomes','Keep facilities and clinical-support assets safe, available and compliant so care can be delivered without avoidable interruption or infection risk.',
 '[{"code":"patient_safety","name":"Patient safety"},{"code":"clinical_availability","name":"Clinical availability"},{"code":"infection_prevention","name":"Infection prevention"},{"code":"care_continuity","name":"Care continuity"}]',
 '[{"code":"critical_device_availability","name":"Critical-device availability"},{"code":"care_interruptions","name":"Care interruptions"},{"code":"calibration_compliance","name":"Calibration compliance"},{"code":"infection_control_events","name":"Infection-control events"}]',
 '["patient_safety","public_health","clinical_service","infection_control","regulatory","privacy"]','["clinical criticality basis","device service records","calibration evidence","infection-control requirements","care-continuity plans"]',
 'Clinical judgement, medical-device regulation and hospital policy remain outside automated authority.'),
('municipality','Municipal service outcomes','Sustain safe, equitable and resilient public services and infrastructure with transparent stewardship of public funds.',
 '[{"code":"public_safety","name":"Public safety"},{"code":"service_continuity","name":"Service continuity"},{"code":"equitable_access","name":"Equitable access"},{"code":"public_value","name":"Public value"}]',
 '[{"code":"service_standard","name":"Service-standard attainment"},{"code":"closure_duration","name":"Closure duration"},{"code":"public_complaints","name":"Public complaints"},{"code":"renewal_backlog","name":"Renewal backlog"}]',
 '["public_safety","vulnerable_populations","service_disruption","community_trust","environment","financial_stewardship"]','["council-approved service levels","asset condition records","incident and complaint data","accessibility obligations","capital plans"]',
 'Council policy, statutory duties and public consultation requirements must be configured locally.'),
('data_centre','Data-centre service outcomes','Deliver resilient, secure and energy-efficient digital infrastructure within contracted availability and capacity commitments.',
 '[{"code":"service_availability","name":"Service availability"},{"code":"capacity","name":"Capacity"},{"code":"thermal_resilience","name":"Thermal resilience"},{"code":"energy_efficiency","name":"Energy efficiency"}]',
 '[{"code":"availability","name":"Availability"},{"code":"incident_duration","name":"Incident duration"},{"code":"pue","name":"Power usage effectiveness"},{"code":"capacity_headroom","name":"Capacity headroom"}]',
 '["customer_interruption","data_service","cybersecurity","worker_safety","energy","contractual"]','["service-level commitments","power and cooling telemetry","incident records","capacity models","approved security boundaries"]',
 'Customer contracts, cybersecurity controls and site electrical authority remain governing constraints.'),
('mining','Mining production outcomes','Deliver safe, responsible and predictable mineral production while protecting people, communities, environment and asset integrity.',
 '[{"code":"safe_production","name":"Safe production"},{"code":"throughput","name":"Throughput"},{"code":"recovery","name":"Recovery"},{"code":"environmental_conformance","name":"Environmental conformance"}]',
 '[{"code":"lost_tonnes","name":"Lost tonnes"},{"code":"availability","name":"Availability"},{"code":"recovery_rate","name":"Recovery rate"},{"code":"high_potential_events","name":"High-potential events"}]',
 '["worker_safety","community","environment","production","geotechnical","regulatory"]','["production reconciliation","delay records","safety events","environmental obligations","geotechnical and operating limits"]',
 'Site operating limits, geotechnical authority and environmental approvals remain authoritative.'),
('manufacturing','Manufacturing outcomes','Produce conforming product safely, predictably and efficiently while protecting people, customers and production capability.',
 '[{"code":"safe_operation","name":"Safe operation"},{"code":"quality_output","name":"Conforming output"},{"code":"delivery","name":"Delivery"},{"code":"productive_capacity","name":"Productive capacity"}]',
 '[{"code":"oee","name":"Overall equipment effectiveness"},{"code":"first_pass_yield","name":"First-pass yield"},{"code":"schedule_attainment","name":"Schedule attainment"},{"code":"safety_events","name":"Safety events"}]',
 '["worker_safety","product_quality","customer_delivery","production","environment","financial"]','["production counts","quality and scrap records","downtime events","customer commitments","approved process limits"]',
 'Product specifications, process validation and safety controls must be supplied by the organization.'),
('defence','Defence mission outcomes','Sustain safe, secure and supportable mission capability with controlled configuration, readiness and supply assurance.',
 '[{"code":"mission_readiness","name":"Mission readiness"},{"code":"configuration_assurance","name":"Configuration assurance"},{"code":"supportability","name":"Supportability"},{"code":"force_protection","name":"Force protection"}]',
 '[{"code":"mission_capable_rate","name":"Mission-capable rate"},{"code":"configuration_conformance","name":"Configuration conformance"},{"code":"supply_readiness","name":"Supply readiness"},{"code":"maintenance_backlog","name":"Maintenance backlog"}]',
 '["personnel_safety","mission_failure","security","configuration","supply_chain","public_interest"]','["approved mission requirements","configuration status","maintenance records","qualification records","supply-readiness evidence"]',
 'Classification, national-security policy and designated engineering authority boundaries must be enforced outside the template.'),
('property','Property and facilities outcomes','Provide safe, compliant, accessible and efficient places that support occupants and preserve portfolio value.',
 '[{"code":"life_safety","name":"Life safety"},{"code":"occupant_service","name":"Occupant service"},{"code":"code_compliance","name":"Code compliance"},{"code":"portfolio_value","name":"Portfolio value"}]',
 '[{"code":"critical_system_availability","name":"Critical-system availability"},{"code":"comfort_compliance","name":"Comfort compliance"},{"code":"energy_intensity","name":"Energy intensity"},{"code":"deferred_renewal","name":"Deferred renewal"}]',
 '["occupant_safety","fire_life_safety","accessibility","service_interruption","regulatory","asset_value"]','["occupancy and code requirements","fire/life-safety inspections","BAS evidence","accessibility assessments","capital plans"]',
 'Authority-having-jurisdiction decisions and professional certifications cannot be inferred by SyncAI.'),
('telecom','Telecommunications outcomes','Provide resilient, secure and accessible communications services within coverage, capacity and restoration commitments.',
 '[{"code":"network_availability","name":"Network availability"},{"code":"coverage","name":"Coverage"},{"code":"capacity","name":"Capacity"},{"code":"emergency_connectivity","name":"Emergency connectivity"}]',
 '[{"code":"service_availability","name":"Service availability"},{"code":"dropped_service","name":"Dropped service"},{"code":"restoration_time","name":"Restoration time"},{"code":"capacity_utilization","name":"Capacity utilization"}]',
 '["customer_interruption","emergency_services","public_safety","cybersecurity","regulatory","community"]','["network alarms","outage and restoration records","coverage and capacity models","service commitments","emergency-service obligations"]',
 'Spectrum, lawful-access, cybersecurity and emergency-service obligations must be configured by accountable authorities.')
on conflict (organization_type) do update set
  title=excluded.title,mission_pattern=excluded.mission_pattern,outcomes=excluded.outcomes,
  measures=excluded.measures,consequence_dimensions=excluded.consequence_dimensions,
  evidence_requirements=excluded.evidence_requirements,limitations=excluded.limitations,
  version=excluded.version,active=true;

create table if not exists public.organization_mission_outcome_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organization_type text not null references public.mission_outcome_model_templates(organization_type) on delete restrict,
  template_version int not null check (template_version>0),
  title text not null check (length(btrim(title)) between 5 and 160),
  mission_statement text not null check (length(btrim(mission_statement)) between 20 and 2000),
  outcomes jsonb not null check (jsonb_typeof(outcomes)='array' and jsonb_array_length(outcomes)>0),
  measures jsonb not null check (jsonb_typeof(measures)='array' and jsonb_array_length(measures)>0),
  consequence_dimensions jsonb not null check (jsonb_typeof(consequence_dimensions)='array' and jsonb_array_length(consequence_dimensions)>0),
  evidence_requirements jsonb not null check (jsonb_typeof(evidence_requirements)='array' and jsonb_array_length(evidence_requirements)>0),
  evidence_basis text not null check (length(btrim(evidence_basis)) between 20 and 4000),
  applicability_notes text not null check (length(btrim(applicability_notes)) between 20 and 4000),
  status text not null default 'draft' check (status in ('draft','adopted','rejected','superseded')),
  version int not null check (version>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approval_id uuid references public.approvals(id) on delete restrict,
  adopted_by uuid references auth.users(id) on delete restrict,
  adopted_at timestamptz,
  decision_note text,
  register_ref text not null default 'U1.01',
  unique(organization_id,version),
  check ((status='draft' and adopted_by is null and adopted_at is null)
      or (status in ('adopted','superseded') and adopted_by is not null and adopted_at is not null)
      or status='rejected')
);
create unique index if not exists idx_one_adopted_mission_outcome_model
  on public.organization_mission_outcome_models(organization_id) where status='adopted';
create index if not exists idx_mission_outcome_model_history
  on public.organization_mission_outcome_models(organization_id,version desc);

alter table public.approvals add column if not exists mission_outcome_model_id uuid
  references public.organization_mission_outcome_models(id) on delete restrict;
create unique index if not exists idx_mission_outcome_model_approval
  on public.approvals(mission_outcome_model_id) where mission_outcome_model_id is not null;
create unique index if not exists idx_mission_outcome_approval_backref
  on public.organization_mission_outcome_models(approval_id) where approval_id is not null;

alter table public.mission_outcome_model_templates enable row level security;
alter table public.organization_mission_outcome_models enable row level security;
revoke all on table public.mission_outcome_model_templates,public.organization_mission_outcome_models from public,anon,authenticated;
grant select on table public.mission_outcome_model_templates,public.organization_mission_outcome_models to authenticated;
drop policy if exists mission_outcome_templates_read on public.mission_outcome_model_templates;
create policy mission_outcome_templates_read on public.mission_outcome_model_templates for select to authenticated using (active);
drop policy if exists organization_mission_outcomes_read on public.organization_mission_outcome_models;
create policy organization_mission_outcomes_read on public.organization_mission_outcome_models
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists approvals_mission_outcome_sensitive on public.approvals;
create policy approvals_mission_outcome_sensitive on public.approvals as restrictive
  for all to authenticated using (true) with check (mission_outcome_model_id is null);

create or replace function public.guard_mission_outcome_model_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('syncai.mission_outcome_workflow',true) is distinct from '1' then
    raise exception 'mission/outcome models change only through the governed workflow' using errcode='insufficient_privilege';
  end if;
  if new.approval_id is not null and not exists(select 1 from public.approvals a
    where a.id=new.approval_id and a.organization_id=new.organization_id and a.mission_outcome_model_id=new.id) then
    raise exception 'mission/outcome approval must be the canonical same-tenant back-reference' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function public.guard_mission_outcome_model_write() from public,anon,authenticated;
create trigger trg_guard_mission_outcome_model before insert or update or delete
  on public.organization_mission_outcome_models for each row execute function public.guard_mission_outcome_model_write();

create or replace function public.author_mission_outcome_model(p_model jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); t public.mission_outcome_model_templates%rowtype;
  v_id uuid; v_approval uuid; v_version int; v_type text:=btrim(coalesce(p_model->>'organization_type',''));
  v_outcomes jsonb; v_measures jsonb; v_consequences jsonb; v_evidence_req jsonb;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  if v_role not in ('reliability_engineer','maintenance_manager','executive','admin','ai_admin') then
    return jsonb_build_object('error','role may not prepare an organization mission/outcome model'); end if;
  select * into t from public.mission_outcome_model_templates where organization_type=v_type and active;
  if t.organization_type is null then return jsonb_build_object('error','choose one of the governed organization types'); end if;
  v_outcomes:=coalesce(p_model->'outcomes',t.outcomes); v_measures:=coalesce(p_model->'measures',t.measures);
  v_consequences:=coalesce(p_model->'consequence_dimensions',t.consequence_dimensions);
  v_evidence_req:=coalesce(p_model->'evidence_requirements',t.evidence_requirements);
  if coalesce(length(btrim(coalesce(p_model->>'title',t.title))),0)<5 then return jsonb_build_object('error','state a model title'); end if;
  if coalesce(length(btrim(coalesce(p_model->>'mission_statement',t.mission_pattern))),0)<20 then return jsonb_build_object('error','state the organization mission in at least 20 characters'); end if;
  if jsonb_typeof(v_outcomes)<>'array' or jsonb_array_length(v_outcomes)=0 then return jsonb_build_object('error','state at least one mission outcome'); end if;
  if jsonb_typeof(v_measures)<>'array' or jsonb_array_length(v_measures)=0 then return jsonb_build_object('error','state at least one outcome measure'); end if;
  if jsonb_typeof(v_consequences)<>'array' or jsonb_array_length(v_consequences)=0 then return jsonb_build_object('error','state consequence dimensions'); end if;
  if jsonb_typeof(v_evidence_req)<>'array' or jsonb_array_length(v_evidence_req)=0 then return jsonb_build_object('error','state evidence requirements'); end if;
  if coalesce(length(btrim(p_model->>'evidence_basis')),0)<20 then return jsonb_build_object('error','state the organization evidence basis in at least 20 characters'); end if;
  if coalesce(length(btrim(p_model->>'applicability_notes')),0)<20 then return jsonb_build_object('error','state applicability and limitations in at least 20 characters'); end if;
  select coalesce(max(version),0)+1 into v_version from public.organization_mission_outcome_models where organization_id=v_org;
  perform set_config('syncai.mission_outcome_workflow','1',true);
  insert into public.organization_mission_outcome_models(organization_id,organization_type,template_version,title,
    mission_statement,outcomes,measures,consequence_dimensions,evidence_requirements,evidence_basis,
    applicability_notes,version,created_by)
  values(v_org,v_type,t.version,btrim(coalesce(p_model->>'title',t.title)),btrim(coalesce(p_model->>'mission_statement',t.mission_pattern)),
    v_outcomes,v_measures,v_consequences,v_evidence_req,btrim(p_model->>'evidence_basis'),btrim(p_model->>'applicability_notes'),v_version,auth.uid())
  returning id into v_id;
  insert into public.approvals(organization_id,status,owner_role,reason,consequence_of_wrong,required_validation,mission_outcome_model_id)
  values(v_org,'required','executive or delegated approval authority',format('Adopt organization mission/outcome model v%s — %s',v_version,v_type),
    'A wrong mission model systematically misranks reliability, risk, value and portfolio decisions.',
    'Independent named human confirms the organization mission, outcomes, measures, consequences, evidence and applicability.',v_id)
  returning id into v_approval;
  update public.organization_mission_outcome_models set approval_id=v_approval where id=v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'mission_outcome_model',v_role,jsonb_build_object('action','drafted','id',v_id,'approval_id',v_approval),
    jsonb_build_object('status','draft','organization_type',v_type,'version',v_version,'template_version',t.version,'created_by',auth.uid()));
  return jsonb_build_object('model_id',v_id,'approval_id',v_approval,'status','draft','version',v_version,
    'authority','Draft only. No outcome is adopted or claimed achieved until an independent authorized human approves it.');
end $$;
revoke all on function public.author_mission_outcome_model(jsonb) from public,anon,service_role;
grant execute on function public.author_mission_outcome_model(jsonb) to authenticated;

create or replace function public.decide_mission_outcome_model(p_id uuid,p_outcome text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); m public.organization_mission_outcome_models%rowtype;
  a public.approvals%rowtype; v_email text;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  if v_role='ai_admin' then return jsonb_build_object('error','AI may prepare a mission model but may not adopt or reject the organization mission.'); end if;
  if p_outcome not in ('approved','rejected') then return jsonb_build_object('error','outcome must be approved or rejected'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','record the decision basis in at least 20 characters'); end if;
  select * into m from public.organization_mission_outcome_models where id=p_id and organization_id=v_org for update;
  if m.id is null then return jsonb_build_object('error','draft mission/outcome model not found in this tenant'); end if;
  if m.status<>'draft' then return jsonb_build_object('error',format('model is already %s',m.status)); end if;
  if m.created_by=auth.uid() then return jsonb_build_object('error','the author may not approve or reject their own mission/outcome model'); end if;
  if not public.app_has_approval_authority() then return jsonb_build_object('error','role lacks approval authority'); end if;
  select * into a from public.approvals where id=m.approval_id and organization_id=v_org and mission_outcome_model_id=m.id for update;
  if a.id is null or a.status not in ('required','pending') then return jsonb_build_object('error','canonical pending approval is missing or already decided'); end if;
  select email into v_email from public.user_profiles where id=auth.uid();
  perform set_config('syncai.mission_outcome_workflow','1',true);
  if p_outcome='approved' then
    update public.organization_mission_outcome_models set status='superseded'
      where organization_id=v_org and status='adopted';
  end if;
  update public.approvals set status=p_outcome,approver=coalesce(v_email,auth.uid()::text),approver_user_id=auth.uid(),
    decided_at=now(),approval_scope=jsonb_build_object('model_id',m.id,'organization_type',m.organization_type,
      'version',m.version,'template_version',m.template_version,'decision_note',btrim(p_note)) where id=a.id;
  update public.organization_mission_outcome_models set status=case when p_outcome='approved' then 'adopted' else 'rejected' end,
    adopted_by=case when p_outcome='approved' then auth.uid() else null end,
    adopted_at=case when p_outcome='approved' then now() else null end,decision_note=btrim(p_note) where id=m.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'mission_outcome_model',v_role,jsonb_build_object('action',p_outcome,'id',m.id,'approval_id',a.id),
    jsonb_build_object('status','draft'),jsonb_build_object('status',case when p_outcome='approved' then 'adopted' else 'rejected' end,
      'organization_type',m.organization_type,'version',m.version,'decided_by',auth.uid(),'decision_note',btrim(p_note)));
  return jsonb_build_object('model_id',m.id,'approval_id',a.id,'status',case when p_outcome='approved' then 'adopted' else 'rejected' end,
    'authority','This adoption governs decision framing only; it does not authorize work or prove an outcome was achieved.');
end $$;
revoke all on function public.decide_mission_outcome_model(uuid,text,text) from public,anon,service_role;
grant execute on function public.decide_mission_outcome_model(uuid,text,text) to authenticated;

create or replace function public.get_mission_outcome_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_templates jsonb; v_models jsonb;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('organizationType',organization_type,'title',title,'missionPattern',mission_pattern,
    'outcomes',outcomes,'measures',measures,'consequenceDimensions',consequence_dimensions,
    'evidenceRequirements',evidence_requirements,'limitations',limitations,'version',version) order by title),'[]'::jsonb)
  into v_templates from public.mission_outcome_model_templates where active;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'organizationType',m.organization_type,'templateVersion',m.template_version,
    'title',m.title,'missionStatement',m.mission_statement,'outcomes',m.outcomes,'measures',m.measures,
    'consequenceDimensions',m.consequence_dimensions,'evidenceRequirements',m.evidence_requirements,
    'evidenceBasis',m.evidence_basis,'applicabilityNotes',m.applicability_notes,'status',m.status,'version',m.version,
    'createdBy',cp.email,'createdAt',m.created_at,'approvalId',m.approval_id,'approvalStatus',a.status,
    'adoptedBy',ap.email,'adoptedAt',m.adopted_at,'decisionNote',m.decision_note,'isOwnDraft',m.created_by=auth.uid()) order by m.version desc),'[]'::jsonb)
  into v_models from public.organization_mission_outcome_models m
  left join public.approvals a on a.id=m.approval_id
  left join public.user_profiles cp on cp.id=m.created_by
  left join public.user_profiles ap on ap.id=m.adopted_by where m.organization_id=v_org;
  return jsonb_build_object('templates',v_templates,'models',v_models,'callerRole',public.app_current_role(),
    'canApprove',public.app_has_approval_authority() and public.app_current_role()<>'ai_admin',
    'control','Only the latest independently adopted tenant model is effective. Templates are starting points; SyncAI does not authorize work or claim outcomes from this model.');
end $$;
revoke all on function public.get_mission_outcome_workspace() from public,anon,service_role;
grant execute on function public.get_mission_outcome_workspace() to authenticated;

create or replace function public.resolve_mission_outcome_model()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); m public.organization_mission_outcome_models%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select * into m from public.organization_mission_outcome_models where organization_id=v_org and status='adopted'
    order by version desc limit 1;
  if m.id is null then return jsonb_build_object('error','No organization-owned mission/outcome model has been adopted. Template defaults are not authority.'); end if;
  return jsonb_build_object('modelId',m.id,'organizationType',m.organization_type,'version',m.version,
    'missionStatement',m.mission_statement,'outcomes',m.outcomes,'measures',m.measures,
    'consequenceDimensions',m.consequence_dimensions,'evidenceRequirements',m.evidence_requirements,
    'evidenceBasis',m.evidence_basis,'applicabilityNotes',m.applicability_notes,'adoptedBy',m.adopted_by,'adoptedAt',m.adopted_at,
    'authority','Use for consequence and value framing. Separate governed evidence is required to claim performance or achieved outcomes.');
end $$;
revoke all on function public.resolve_mission_outcome_model() from public,anon,service_role;
grant execute on function public.resolve_mission_outcome_model() to authenticated;

comment on table public.organization_mission_outcome_models is
  'U1.01: tenant-owned, independently adopted mission/outcome model selected from twelve organization-type references; decision framing only, never execution authority.';
