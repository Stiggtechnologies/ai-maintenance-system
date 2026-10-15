-- U14.01 — governed degradation library.
--
-- Canonical reuse:
--   * damage_mechanisms remains the one mechanism taxonomy;
--   * model_register + engineering_model_mechanisms remain the model registry;
--   * evidence_items, approvals and audit_events remain the provenance and
--     human-authority systems.
--
-- A profile is a bounded evidence/model requirement for one canonical
-- mechanism family. It carries no engineering limit, rate, remaining life,
-- inspection interval or operational authorization. Platform reference rows
-- are deliberately draft. A tenant may propose a sourced revision, but only a
-- different named reliability engineer or administrator may approve it.

alter table public.damage_mechanisms
  add column if not exists degradation_family_key text;

alter table public.damage_mechanisms
  drop constraint if exists damage_mechanisms_degradation_family_key_check;
alter table public.damage_mechanisms
  add constraint damage_mechanisms_degradation_family_key_check check (
    degradation_family_key is null or degradation_family_key in (
      'corrosion','fatigue','creep','erosion','wear','embrittlement',
      'chemical','concrete','timber','insulation_ageing','battery','cable',
      'semiconductor','lubricant','coating','soil_foundation'
    )
  );

create unique index if not exists idx_damage_mechanisms_degradation_family
  on public.damage_mechanisms(organization_id,degradation_family_key)
  where degradation_family_key is not null;

insert into public.damage_mechanisms(
  organization_id,mechanism_key,name,description,register_ref,degradation_family_key
)
select o.id,v.mechanism_key,v.name,v.description,'U14.01',v.family_key
from public.organizations o
cross join (values
  ('embrittlement','Embrittlement','Loss of ductility or fracture resistance caused by an evidenced material/environment interaction.','embrittlement'),
  ('chemical_degradation','Chemical degradation','Material-property loss caused by a chemically evidenced exposure or reaction.','chemical'),
  ('concrete_deterioration','Concrete deterioration','Evidence-backed loss of concrete or reinforcing-system condition.','concrete'),
  ('timber_decay','Timber deterioration','Evidence-backed biological, moisture, mechanical or chemical deterioration of timber.','timber'),
  ('battery_degradation','Battery degradation','Measured loss of electrochemical capacity, power capability or safety margin.','battery'),
  ('cable_degradation','Cable degradation','Measured deterioration of conductor, insulation, shield, sheath or termination condition.','cable'),
  ('semiconductor_ageing','Semiconductor ageing','Measured deterioration of electronic-device electrical or thermal performance.','semiconductor'),
  ('coating_degradation','Coating degradation','Measured loss of coating integrity, adhesion or protective function.','coating'),
  ('soil_foundation_degradation','Soil and foundation degradation','Measured change in soil, support or foundation condition affecting the load path.','soil_foundation')
) as v(mechanism_key,name,description,family_key)
where not exists (
  select 1 from public.damage_mechanisms m
  where m.organization_id=o.id and m.mechanism_key=v.mechanism_key
);

update public.damage_mechanisms m
set degradation_family_key=v.family_key,
    register_ref=case when m.register_ref='C2.03' then 'C2.03,U14.01' else m.register_ref end
from (values
  ('general_corrosion','corrosion'),
  ('fatigue_crack','fatigue'),
  ('creep','creep'),
  ('erosion','erosion'),
  ('abrasive_wear','wear'),
  ('embrittlement','embrittlement'),
  ('chemical_degradation','chemical'),
  ('concrete_deterioration','concrete'),
  ('timber_decay','timber'),
  ('insulation_degradation','insulation_ageing'),
  ('battery_degradation','battery'),
  ('cable_degradation','cable'),
  ('semiconductor_ageing','semiconductor'),
  ('lube_degradation','lubricant'),
  ('coating_degradation','coating'),
  ('soil_foundation_degradation','soil_foundation')
) as v(mechanism_key,family_key)
where m.mechanism_key=v.mechanism_key
  and m.degradation_family_key is distinct from v.family_key;

create table if not exists public.degradation_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mechanism_id uuid not null references public.damage_mechanisms(id) on delete restrict,
  family_key text not null check (family_key in (
    'corrosion','fatigue','creep','erosion','wear','embrittlement',
    'chemical','concrete','timber','insulation_ageing','battery','cable',
    'semiconductor','lubricant','coating','soil_foundation'
  )),
  version integer not null check (version > 0),
  title text not null check (length(btrim(title)) >= 5),
  description text not null check (length(btrim(description)) >= 20),
  stressor_requirements text[] not null check (cardinality(stressor_requirements) > 0),
  damage_state_requirements text[] not null check (cardinality(damage_state_requirements) > 0),
  observation_requirements text[] not null check (cardinality(observation_requirements) > 0),
  candidate_model_kinds text[] not null check (cardinality(candidate_model_kinds) > 0),
  applicability_questions text[] not null check (cardinality(applicability_questions) > 0),
  limitations text not null check (length(btrim(limitations)) >= 20),
  source_evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  status text not null default 'reference_draft' check (
    status in ('reference_draft','pending_review','approved','rejected','superseded')
  ),
  supersedes_profile_id uuid references public.degradation_profiles(id) on delete restrict,
  author_id uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  approval_id uuid references public.approvals(id) on delete restrict,
  operational_authorization boolean not null default false
    check (not operational_authorization),
  created_at timestamptz not null default now(),
  unique(organization_id,family_key,version),
  check ((status='reference_draft' and author_id is null and source_evidence_item_id is null)
      or (status<>'reference_draft' and author_id is not null and source_evidence_item_id is not null)),
  check ((status in ('approved','rejected','superseded')) = (reviewed_at is not null)),
  check (status not in ('approved','rejected','superseded') or reviewed_by is not null),
  check (status not in ('approved','rejected','superseded') or length(btrim(coalesce(review_note,''))) >= 20)
);

create unique index if not exists idx_degradation_profiles_one_approved
  on public.degradation_profiles(organization_id,family_key)
  where status='approved';
create index if not exists idx_degradation_profiles_workspace
  on public.degradation_profiles(organization_id,family_key,version desc);

alter table public.degradation_profiles enable row level security;
drop policy if exists degradation_profiles_read on public.degradation_profiles;
create policy degradation_profiles_read on public.degradation_profiles
  for select to authenticated
  using (organization_id=public.app_current_org());

revoke insert,update,delete,truncate on table public.degradation_profiles
  from public,anon,authenticated,service_role;

create or replace function public.enforce_degradation_profile_tenant()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (
    select 1 from public.damage_mechanisms m
    where m.id=new.mechanism_id
      and m.organization_id=new.organization_id
      and m.degradation_family_key=new.family_key
  ) then
    raise exception 'degradation profile must reference its same-tenant canonical family mechanism';
  end if;
  if new.source_evidence_item_id is not null and not exists (
    select 1 from public.evidence_items e
    where e.id=new.source_evidence_item_id and e.organization_id=new.organization_id
  ) then
    raise exception 'degradation profile evidence must belong to the same tenant';
  end if;
  if new.supersedes_profile_id is not null and not exists (
    select 1 from public.degradation_profiles p
    where p.id=new.supersedes_profile_id
      and p.organization_id=new.organization_id
      and p.family_key=new.family_key
      and p.version<new.version
  ) then
    raise exception 'superseded degradation profile must be an earlier same-tenant family version';
  end if;
  return new;
end $$;

drop trigger if exists trg_degradation_profile_tenant on public.degradation_profiles;
create trigger trg_degradation_profile_tenant
  before insert or update on public.degradation_profiles
  for each row execute function public.enforce_degradation_profile_tenant();

create or replace function public.enforce_degradation_profile_history()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'degradation profile history is immutable';
  end if;
  if old.status='reference_draft' then
    raise exception 'platform degradation reference profiles are immutable';
  end if;
  if old.status in ('rejected','superseded') then
    raise exception 'reviewed degradation profile history is immutable';
  end if;
  if old.status='approved' then
    if auth.uid() is null
       or new.status<>'superseded'
       or (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
      raise exception 'approved degradation profiles may only be superseded intact';
    end if;
    return new;
  end if;
  if old.status='pending_review' then
    if auth.uid() is null
       or new.status not in ('approved','rejected')
       or new.reviewed_by is distinct from auth.uid()
       or new.reviewed_by=old.author_id
       or (to_jsonb(new)-array['status','reviewed_by','reviewed_at','review_note','approval_id']::text[])
          is distinct from
          (to_jsonb(old)-array['status','reviewed_by','reviewed_at','review_note','approval_id']::text[]) then
      raise exception 'pending degradation profiles move only through independent review';
    end if;
    return new;
  end if;
  raise exception 'unsupported degradation profile history transition';
end $$;

drop trigger if exists trg_degradation_profile_history on public.degradation_profiles;
create trigger trg_degradation_profile_history
  before update or delete on public.degradation_profiles
  for each row execute function public.enforce_degradation_profile_history();

create or replace function public.refuse_degradation_profile_truncate()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'degradation profile history is immutable; truncate refused';
end $$;

drop trigger if exists trg_degradation_profile_truncate on public.degradation_profiles;
create trigger trg_degradation_profile_truncate
  before truncate on public.degradation_profiles
  for each statement execute function public.refuse_degradation_profile_truncate();

-- Manufacturer-neutral reference requirements. These are questions and
-- evidence fields, not thresholds or models, and remain reference_draft.
insert into public.degradation_profiles(
  organization_id,mechanism_id,family_key,version,title,description,
  stressor_requirements,damage_state_requirements,observation_requirements,
  candidate_model_kinds,applicability_questions,limitations,status
)
select o.id,m.id,v.family_key,1,v.title,v.description,v.stressors,v.damage_state,
       v.observations,v.model_kinds,v.questions,v.limitations,'reference_draft'
from public.organizations o
join (values
  ('corrosion','Corrosion degradation','Governed evidence requirements for general, localized and cracking corrosion mechanisms.',array['material identity','environment chemistry','temperature and exposure history'],array['wall or section condition','localized damage geometry','uncertainty and measurement basis'],array['inspection method and coverage','measurement locations and dates','baseline or prior comparable inspection'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is the corrosion mechanism evidenced?','Is the material and environment applicable?','Are inspection coverage and uncertainty adequate?'],'No corrosion rate, allowance, retirement thickness or inspection interval is supplied. An approved exact-version model and site evidence are required.'),
  ('fatigue','Fatigue degradation','Governed evidence requirements for cyclic damage and crack-growth assessment.',array['load or stress range history','cycle counting basis','geometry and material state'],array['cycle exposure or crack state','stress concentration basis','uncertainty and censoring'],array['load-history source','inspection or NDT evidence','configuration and repair history'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is the duty history representative?','Is the crack-initiation or growth regime identified?','Are material and geometry inputs controlled?'],'No S-N curve, crack-growth coefficient, allowable flaw, remaining life or inspection interval is supplied.'),
  ('creep','Creep degradation','Governed evidence requirements for time-at-temperature deformation and damage.',array['temperature history','stress or load history','material and weld condition'],array['strain or damage indicator','exposure duration','uncertainty and prior excursions'],array['calibrated temperature source','dimensional or NDT evidence','material and fabrication records'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is operation within the model regime?','Are excursions and repairs included?','Is material condition evidenced?'],'No creep property, rupture curve, damage fraction, allowable time or retirement date is supplied.'),
  ('erosion','Erosion degradation','Governed evidence requirements for flow- or particle-driven material loss.',array['flow and particle exposure','material identity','geometry and impingement context'],array['thickness or profile loss','affected area and distribution','measurement uncertainty'],array['inspection coverage','process history','baseline geometry or thickness'],array['deterministic_physics','empirical_reliability','standards_method'],array['Is the erosion mechanism distinguished from corrosion?','Is exposure representative?','Are geometry and measurement locations comparable?'],'No erosion coefficient, wear rate, minimum thickness, remaining life or inspection interval is supplied.'),
  ('wear','Wear degradation','Governed evidence requirements for abrasive, adhesive and contact wear.',array['load and motion history','lubrication and contamination state','material and surface pairing'],array['clearance, mass or dimensional loss','surface condition','debris or friction evidence'],array['dimensional inspection','wear-particle or lubricant evidence','duty and maintenance history'],array['deterministic_physics','empirical_reliability','oem_curve'],array['Is the wear mechanism identified?','Is the contact and lubrication regime applicable?','Is the measurement basis repeatable?'],'No wear coefficient, condemnation limit, adjustment limit, remaining life or intervention interval is supplied.'),
  ('embrittlement','Embrittlement degradation','Governed evidence requirements for loss of ductility or fracture resistance.',array['material identity and heat treatment','temperature, radiation or chemical exposure','stress and defect context'],array['toughness or ductility evidence','exposure index','defect and fracture context'],array['material certification','qualified test or inspection results','exposure and configuration history'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is the embrittlement mechanism applicable?','Is material pedigree known?','Is fracture assessment evidence current?'],'No transition temperature, toughness value, exposure limit, flaw tolerance or remaining life is supplied.'),
  ('chemical','Chemical degradation','Governed evidence requirements for chemical attack, swelling, dissolution or property loss.',array['material and chemical identity','concentration, temperature and exposure history','stress and geometry context'],array['property, mass or dimension change','surface or microstructural condition','uncertainty and variability'],array['chemical analysis','material certification','inspection or laboratory evidence'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is chemical compatibility evidenced?','Are mixtures and excursions included?','Is the measured property decision-relevant?'],'No compatibility rating, reaction rate, allowable concentration, life or replacement interval is supplied.'),
  ('concrete','Concrete deterioration','Governed evidence requirements for concrete, reinforcement and prestressing-system deterioration.',array['environment and exposure','loading and restraint','material, construction and drainage history'],array['crack, spall and delamination state','reinforcement or tendon condition','strength or stiffness evidence'],array['mapped inspection coverage','test-method and calibration evidence','design and repair records'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is the mechanism identified rather than inferred from appearance?','Is structural significance separately assessed?','Are hidden areas and uncertainty disclosed?'],'No structural capacity, repair criterion, serviceability limit, inspection interval or certification is supplied.'),
  ('timber','Timber deterioration','Governed evidence requirements for biological, moisture, mechanical and chemical timber deterioration.',array['species, grade and treatment','moisture and environmental history','load, connection and fire exposure'],array['section loss or decay extent','connection and fracture condition','moisture or biological evidence'],array['inspection access and coverage','moisture or laboratory evidence','design, treatment and repair history'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is the deterioration mechanism evidenced?','Is concealed condition addressed?','Are grade and treatment known?'],'No residual capacity, decay rate, treatment interval, allowable section loss or life extension is supplied.'),
  ('insulation_ageing','Insulation ageing','Governed evidence requirements for electrical insulation thermal, electrical and environmental ageing.',array['temperature and load history','voltage and transient history','moisture, contamination and mechanical exposure'],array['dielectric and discharge condition','thermal ageing indicator','localized defect evidence'],array['qualified electrical tests','thermal and environmental history','material, winding or insulation-system identity'],array['standards_method','deterministic_physics','empirical_reliability','oem_curve'],array['Is the insulation system identified?','Are test trends comparable?','Are operating and environmental excursions included?'],'No dielectric limit, thermal-life constant, withstand conclusion, remaining life or test interval is supplied.'),
  ('battery','Battery degradation','Governed evidence requirements for electrochemical capacity, resistance, power and safety-margin degradation.',array['chemistry and configuration','temperature and duty history','charge, discharge and storage history'],array['capacity, resistance or power state','imbalance and thermal evidence','uncertainty and cell-to-pack aggregation'],array['controlled test method','BMS or measurement provenance','event, maintenance and configuration history'],array['empirical_reliability','deterministic_physics','oem_curve','standards_method'],array['Is chemistry and firmware/configuration controlled?','Is the measurement method comparable?','Are abnormal events and cell dispersion included?'],'No state-of-health threshold, degradation rate, cycle life, safety limit or replacement date is supplied.'),
  ('cable','Cable degradation','Governed evidence requirements for conductor, insulation, shield, sheath, joint and termination deterioration.',array['thermal and electrical loading','environment and installation condition','mechanical and transient exposure'],array['dielectric, thermal or mechanical condition','joint and termination condition','localized defect evidence'],array['qualified cable test results','load and temperature history','cable identity, route and joint history'],array['standards_method','deterministic_physics','empirical_reliability','oem_curve'],array['Is cable construction and route known?','Are joints and terminations included?','Are test methods and baselines comparable?'],'No withstand conclusion, discharge limit, thermal rating, remaining life or test interval is supplied.'),
  ('semiconductor','Semiconductor ageing','Governed evidence requirements for electronic-device thermal, electrical and cycling degradation.',array['junction-temperature and power history','voltage and current stress','thermal-cycle and environment history'],array['electrical parameter drift','thermal resistance or leakage state','intermittent or latent-fault evidence'],array['traceable electrical tests','thermal and mission profile','device, lot and configuration identity'],array['deterministic_physics','empirical_reliability','oem_curve'],array['Is the device and package identified?','Is the mission profile representative?','Are software and configuration effects separated?'],'No acceleration factor, safe-operating limit, failure probability, remaining life or replacement interval is supplied.'),
  ('lubricant','Lubricant degradation','Governed evidence requirements for lubricant oxidation, additive depletion, contamination and property change.',array['lubricant identity and volume','temperature and duty history','contamination and make-up history'],array['viscosity, chemistry and contamination state','additive and oxidation indicators','wear-debris context'],array['laboratory method and sample provenance','service and top-up history','equipment and filtration configuration'],array['empirical_reliability','oem_curve','standards_method'],array['Is the lubricant and sample point controlled?','Are make-up and contamination events included?','Are results trended on comparable methods?'],'No alarm limit, condemnation criterion, degradation rate, drain interval or equipment diagnosis is supplied.'),
  ('coating','Coating degradation','Governed evidence requirements for loss of coating barrier, adhesion or protective function.',array['coating system and preparation','environment and exposure history','mechanical and chemical damage'],array['defect, adhesion and thickness condition','under-film corrosion evidence','coverage and uncertainty'],array['mapped visual or instrument inspection','application and repair records','environment and substrate evidence'],array['standards_method','empirical_reliability','deterministic_physics'],array['Is the coating system and age known?','Is inspection coverage representative?','Is substrate condition separately evidenced?'],'No defect threshold, adhesion limit, remaining life, repair scope or recoating interval is supplied.'),
  ('soil_foundation','Soil and foundation degradation','Governed evidence requirements for settlement, movement, scour, erosion and foundation/load-path deterioration.',array['geotechnical and groundwater context','load and vibration history','drainage, climate and construction history'],array['movement, settlement or tilt','scour, erosion or void condition','foundation and interface condition'],array['survey or instrumentation provenance','inspection and investigation coverage','design, construction and change records'],array['standards_method','deterministic_physics','empirical_reliability'],array['Is the ground model current?','Are movements absolute and differential?','Are load-path and environmental changes included?'],'No bearing capacity, settlement limit, slope stability, structural safety conclusion, remaining life or monitoring interval is supplied.')
) as v(family_key,title,description,stressors,damage_state,observations,model_kinds,questions,limitations)
  on true
join public.damage_mechanisms m
  on m.organization_id=o.id and m.degradation_family_key=v.family_key
where not exists (
  select 1 from public.degradation_profiles p
  where p.organization_id=o.id and p.family_key=v.family_key and p.version=1
);

-- The historical tenant provisioner names the copied mechanism columns
-- explicitly, so a later-added family column would otherwise be lost. Assign
-- the universal family from the canonical mechanism key on every future copy.
create or replace function public.assign_degradation_family_on_mechanism()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.degradation_family_key is null then
    new.degradation_family_key:=case new.mechanism_key
      when 'general_corrosion' then 'corrosion'
      when 'fatigue_crack' then 'fatigue'
      when 'creep' then 'creep'
      when 'erosion' then 'erosion'
      when 'abrasive_wear' then 'wear'
      when 'embrittlement' then 'embrittlement'
      when 'chemical_degradation' then 'chemical'
      when 'concrete_deterioration' then 'concrete'
      when 'timber_decay' then 'timber'
      when 'insulation_degradation' then 'insulation_ageing'
      when 'battery_degradation' then 'battery'
      when 'cable_degradation' then 'cable'
      when 'semiconductor_ageing' then 'semiconductor'
      when 'lube_degradation' then 'lubricant'
      when 'coating_degradation' then 'coating'
      when 'soil_foundation_degradation' then 'soil_foundation'
      else null end;
  end if;
  if new.degradation_family_key is not null
     and position('U14.01' in coalesce(new.register_ref,''))=0 then
    new.register_ref:=concat_ws(',',nullif(new.register_ref,''),'U14.01');
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_degradation_family on public.damage_mechanisms;
create trigger trg_assign_degradation_family
  before insert or update of mechanism_key,degradation_family_key
  on public.damage_mechanisms for each row
  execute function public.assign_degradation_family_on_mechanism();

create or replace function public.seed_degradation_profiles_after_mechanism_copy()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_template uuid;
begin
  if new.degradation_family_key is null then return new; end if;
  if (select count(*) from public.damage_mechanisms m
      where m.organization_id=new.organization_id and m.degradation_family_key is not null)<>16 then
    return new;
  end if;
  if (select count(*) from public.degradation_profiles p
      where p.organization_id=new.organization_id and p.status='reference_draft')>=16 then
    return new;
  end if;
  select p.organization_id into v_template
  from public.degradation_profiles p
  where p.organization_id<>new.organization_id and p.status='reference_draft'
  group by p.organization_id having count(distinct p.family_key)=16
  order by p.organization_id limit 1;
  if v_template is null then return new; end if;
  insert into public.degradation_profiles(
    organization_id,mechanism_id,family_key,version,title,description,
    stressor_requirements,damage_state_requirements,observation_requirements,
    candidate_model_kinds,applicability_questions,limitations,status
  )
  select new.organization_id,nm.id,p.family_key,1,p.title,p.description,
    p.stressor_requirements,p.damage_state_requirements,p.observation_requirements,
    p.candidate_model_kinds,p.applicability_questions,p.limitations,'reference_draft'
  from public.degradation_profiles p
  join public.damage_mechanisms nm
    on nm.organization_id=new.organization_id
   and nm.degradation_family_key=p.family_key
  where p.organization_id=v_template and p.status='reference_draft'
  on conflict(organization_id,family_key,version) do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_degradation_profiles on public.damage_mechanisms;
create trigger trg_seed_degradation_profiles
  after insert or update of degradation_family_key
  on public.damage_mechanisms for each row
  execute function public.seed_degradation_profiles_after_mechanism_copy();

create or replace function public.degradation_profile_array_valid(
  p_values text[],p_allowed text[] default null
) returns boolean language sql immutable set search_path=public as $$
  select coalesce(cardinality(p_values),0)>0
     and not exists(select 1 from unnest(p_values) v where length(btrim(v))<3)
     and (p_allowed is null or not exists(select 1 from unnest(p_values) v where not (v=any(p_allowed))))
$$;

create or replace function public.propose_degradation_profile_revision(
  p_family_key text,
  p_title text,
  p_description text,
  p_stressor_requirements text[],
  p_damage_state_requirements text[],
  p_observation_requirements text[],
  p_candidate_model_kinds text[],
  p_applicability_questions text[],
  p_limitations text,
  p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_mechanism uuid;
  v_prior uuid; v_version integer; v_id uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','degradation profile authoring requires a reliability engineer or administrator');
  end if;
  select id into v_mechanism from public.damage_mechanisms
  where organization_id=v_org and degradation_family_key=p_family_key;
  if v_mechanism is null then return jsonb_build_object('error','canonical degradation family not found in this organization'); end if;
  if length(btrim(coalesce(p_title,'')))<5 or length(btrim(coalesce(p_description,'')))<20
     or length(btrim(coalesce(p_limitations,'')))<20 then
    return jsonb_build_object('error','title, description and limitations are incomplete');
  end if;
  if not public.degradation_profile_array_valid(p_stressor_requirements)
     or not public.degradation_profile_array_valid(p_damage_state_requirements)
     or not public.degradation_profile_array_valid(p_observation_requirements)
     or not public.degradation_profile_array_valid(p_applicability_questions) then
    return jsonb_build_object('error','each profile requirement family needs substantive entries');
  end if;
  if not public.degradation_profile_array_valid(p_candidate_model_kinds,
       array['statistical','rule_based','machine_learning','hybrid','deterministic_physics','empirical_reliability','oem_curve','standards_method']) then
    return jsonb_build_object('error','candidate model kinds must use the governed model-register vocabulary');
  end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id
      and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('error','same-tenant verified source evidence is required');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':degradation:'||p_family_key,0));
  select id into v_prior from public.degradation_profiles
  where organization_id=v_org and family_key=p_family_key
  order by version desc limit 1;
  select coalesce(max(version),0)+1 into v_version from public.degradation_profiles
  where organization_id=v_org and family_key=p_family_key;
  insert into public.degradation_profiles(
    organization_id,mechanism_id,family_key,version,title,description,
    stressor_requirements,damage_state_requirements,observation_requirements,
    candidate_model_kinds,applicability_questions,limitations,
    source_evidence_item_id,status,supersedes_profile_id,author_id,submitted_at
  ) values(
    v_org,v_mechanism,p_family_key,v_version,btrim(p_title),btrim(p_description),
    p_stressor_requirements,p_damage_state_requirements,p_observation_requirements,
    p_candidate_model_kinds,p_applicability_questions,btrim(p_limitations),
    p_evidence_item_id,'pending_review',v_prior,auth.uid(),now()
  ) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'degradation_profile_revision_proposed',v_role,jsonb_build_object(
    'profile_id',v_id,'family_key',p_family_key,'version',v_version,
    'evidence_item_id',p_evidence_item_id,'operational_authorization',false));
  return jsonb_build_object('profileId',v_id,'familyKey',p_family_key,'version',v_version,
    'status','pending_review','operationalAuthorization',false);
end $$;

create or replace function public.review_degradation_profile(
  p_profile_id uuid,p_decision text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; p public.degradation_profiles%rowtype;
  v_approval uuid; v_prior uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','degradation profile review requires a reliability engineer or administrator');
  end if;
  if p_decision not in ('approved','rejected') then
    return jsonb_build_object('error','decision must be approved or rejected');
  end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then
    return jsonb_build_object('error','independent review basis requires at least 20 characters');
  end if;
  select * into p from public.degradation_profiles
  where id=p_profile_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','degradation profile not found in this organization'); end if;
  if p.status<>'pending_review' then return jsonb_build_object('error','degradation profile is not awaiting review'); end if;
  if p.author_id=auth.uid() then return jsonb_build_object('error','profile author cannot independently review their own revision'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p.source_evidence_item_id
      and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('error','current same-tenant verified source evidence is required');
  end if;
  if p_decision='approved' then
    select id into v_prior from public.degradation_profiles
    where organization_id=v_org and family_key=p.family_key and status='approved' and id<>p.id
    order by version desc limit 1;
    update public.degradation_profiles set status='superseded'
    where organization_id=v_org and family_key=p.family_key and status='approved' and id<>p.id;
  end if;
  insert into public.approvals(
    organization_id,status,owner_role,approver,reason,consequence_of_wrong,
    required_validation,decided_at,approver_user_id,approval_scope
  ) values(
    v_org,p_decision,v_role,v_role,btrim(p_review_note),
    'An inapplicable degradation profile can create unsupported life, inspection or intervention conclusions.',
    'Independent review of the exact profile version, canonical mechanism, source evidence, applicability questions and limitations.',
    now(),auth.uid(),jsonb_build_object('kind','degradation_profile','profileId',p.id,
      'familyKey',p.family_key,'version',p.version,'evidenceItemId',p.source_evidence_item_id,
      'operationalAuthorization',false)
  ) returning id into v_approval;
  update public.degradation_profiles set
    status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
    review_note=btrim(p_review_note),approval_id=v_approval
  where id=p.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'degradation_profile_reviewed',v_role,jsonb_build_object(
    'profile_id',p.id,'family_key',p.family_key,'version',p.version,
    'decision',p_decision,'approval_id',v_approval,'prior_approved_profile_id',v_prior,
    'evidence_item_id',p.source_evidence_item_id,'operational_authorization',false));
  return jsonb_build_object('profileId',p.id,'familyKey',p.family_key,'version',p.version,
    'decision',p_decision,'approvalId',v_approval,'priorApprovedProfileId',v_prior,
    'operationalAuthorization',false);
end $$;

create or replace function public.get_degradation_library_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  return jsonb_build_object(
    'families',coalesce((select jsonb_agg(jsonb_build_object(
      'familyKey',m.degradation_family_key,
      'mechanismId',m.id,'mechanismKey',m.mechanism_key,'mechanismName',m.name,
      'mechanismDescription',m.description,
      'profileId',p.id,'version',p.version,'title',p.title,'description',p.description,
      'stressorRequirements',to_jsonb(p.stressor_requirements),
      'damageStateRequirements',to_jsonb(p.damage_state_requirements),
      'observationRequirements',to_jsonb(p.observation_requirements),
      'candidateModelKinds',to_jsonb(p.candidate_model_kinds),
      'applicabilityQuestions',to_jsonb(p.applicability_questions),
      'limitations',p.limitations,'status',p.status,
      'sourceEvidenceItemId',p.source_evidence_item_id,'authorId',p.author_id,
      'reviewedBy',p.reviewed_by,'reviewedAt',p.reviewed_at,'reviewNote',p.review_note,
      'detectability',coalesce((select jsonb_agg(jsonb_build_object(
        'techniqueKey',t.technique_key,'techniqueName',t.name,'detectability',d.detectability,
        'typicalWarning',d.typical_warning,'basis',d.basis) order by t.name)
        from public.mechanism_detectability d
        join public.detection_techniques t on t.id=d.technique_id
        where d.organization_id=v_org and d.mechanism_id=m.id),'[]'::jsonb),
      'linkedModels',coalesce((select jsonb_agg(jsonb_build_object(
        'modelRegisterId',mr.id,'modelKey',mr.model_key,'version',mr.version,
        'lifecycleState',mr.lifecycle_state,'productionEligible',mr.production_eligible,
        'applicabilityReviewStatus',mr.applicability_review_status) order by mr.model_key,mr.version)
        from public.engineering_model_mechanisms em
        join public.model_register mr on mr.id=em.model_register_id
        where em.organization_id=v_org and em.mechanism_id=m.id),'[]'::jsonb),
      'operationalAuthorization',false
    ) order by m.degradation_family_key) from public.damage_mechanisms m
      join lateral (
        select dp.* from public.degradation_profiles dp
        where dp.organization_id=v_org and dp.family_key=m.degradation_family_key
          and dp.status<>'superseded'
        order by case dp.status when 'approved' then 1 when 'pending_review' then 2
          when 'rejected' then 3 else 4 end,dp.version desc limit 1
      ) p on true
      where m.organization_id=v_org and m.degradation_family_key is not null),'[]'::jsonb),
    'coverage',jsonb_build_object(
      'requiredFamilies',16,
      'representedFamilies',(select count(*) from public.damage_mechanisms m where m.organization_id=v_org and m.degradation_family_key is not null),
      'approvedFamilies',(select count(distinct family_key) from public.degradation_profiles p where p.organization_id=v_org and p.status='approved'),
      'familiesWithLinkedModels',(select count(distinct m.degradation_family_key)
        from public.damage_mechanisms m join public.engineering_model_mechanisms em on em.mechanism_id=m.id
        where m.organization_id=v_org and em.organization_id=v_org and m.degradation_family_key is not null)
    ),
    'boundary','The library names evidence, applicability and model requirements only. It supplies no engineering limit, rate, remaining life, interval, diagnosis, work release, risk acceptance or return-to-service authority. Exact-version models and site evidence remain independently governed.'
  );
end $$;

revoke all on function public.enforce_degradation_profile_tenant() from public,anon,authenticated,service_role;
revoke all on function public.enforce_degradation_profile_history() from public,anon,authenticated,service_role;
revoke all on function public.refuse_degradation_profile_truncate() from public,anon,authenticated,service_role;
revoke all on function public.assign_degradation_family_on_mechanism() from public,anon,authenticated,service_role;
revoke all on function public.seed_degradation_profiles_after_mechanism_copy() from public,anon,authenticated,service_role;
revoke all on function public.degradation_profile_array_valid(text[],text[]) from public,anon,authenticated,service_role;
revoke all on function public.propose_degradation_profile_revision(text,text,text,text[],text[],text[],text[],text[],text,uuid) from public,anon,service_role;
revoke all on function public.review_degradation_profile(uuid,text,text) from public,anon,service_role;
revoke all on function public.get_degradation_library_workspace() from public,anon,service_role;
grant execute on function public.propose_degradation_profile_revision(text,text,text,text[],text[],text[],text[],text[],text,uuid) to authenticated;
grant execute on function public.review_degradation_profile(uuid,text,text) to authenticated;
grant execute on function public.get_degradation_library_workspace() to authenticated;

comment on table public.degradation_profiles is
  'Versioned, tenant-scoped evidence and applicability profiles attached to canonical damage mechanisms. Profiles are non-authoritative and never contain default engineering limits, rates or intervals.';
