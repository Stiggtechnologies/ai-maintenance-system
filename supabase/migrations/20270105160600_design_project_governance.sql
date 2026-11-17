-- ============================================================================
-- E8.01 / E8.03 / E8.06 / E8.13 — reliability-by-design activation.
--
-- The ONE project requirement and design-study stores already have governed,
-- customer-reachable writers in Sync Develop. This migration completes the
-- early-life feedback chain without creating another requirement, evidence or
-- approval store. A relationship row connects an observed early-life failure
-- to the canonical design requirement raised to prevent recurrence. The old
-- fed_back_to_design flag becomes a derived summary; only a VERIFIED linked
-- requirement is presented as elimination.
-- ============================================================================

alter table public.early_life_failures
  add column if not exists development_case_id uuid
    references public.development_cases(id) on delete restrict;

comment on column public.early_life_failures.development_case_id is
  'The Sync Develop case that governed capture of the observation. Historical rows may be null; no case is invented for them.';

create table if not exists public.early_life_failure_requirements (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  early_life_failure_id bigint not null
    references public.early_life_failures(id) on delete restrict,
  requirement_id bigint not null
    references public.design_requirements(id) on delete restrict,
  evidence_item_id uuid not null
    references public.evidence_items(id) on delete restrict,
  basis text not null check(length(btrim(basis))>=20),
  linked_by uuid not null references auth.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unique(early_life_failure_id,requirement_id)
);

create index if not exists idx_elfr_case_requirement
  on public.early_life_failure_requirements(organization_id,requirement_id,linked_at desc);

alter table public.early_life_failure_requirements enable row level security;
drop policy if exists elfr_read on public.early_life_failure_requirements;
create policy elfr_read on public.early_life_failure_requirements
  for select to authenticated using(organization_id=public.app_current_org());

-- The legacy demo flag carried no retained relationship or evidence. Do not
-- migrate an assertion into the governed chain when its subject is unknown.
update public.early_life_failures e
set fed_back_to_design=false
where e.fed_back_to_design
  and not exists(select 1 from public.early_life_failure_requirements l
    where l.early_life_failure_id=e.id);

create or replace function public.enforce_early_life_feedback_governance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    if coalesce(current_setting('app.early_life_observation_write',true),'')<>'granted'
       or auth.uid() is null then
      raise exception 'early-life observations are written only by the governed named-human case workflow';
    end if;
    if new.recorded_by is distinct from auth.uid()
       or new.organization_id is distinct from public.app_current_org() then
      raise exception 'the early-life observation must name its human recorder and current organization';
    end if;
    if new.development_case_id is null or not exists(
      select 1
      from public.development_cases c
      join public.development_case_assets ca
        on ca.development_case_id=c.id and ca.organization_id=c.organization_id
      where c.id=new.development_case_id
        and c.organization_id=new.organization_id
        and ca.asset_id=new.asset_id
        and new.project_id is not distinct from c.capital_project_id
    ) then
      raise exception 'the early-life observation requires a same-tenant case, bound asset and matching capital project';
    end if;
    if new.occurred_at is null or new.occurred_at>now()
       or (new.months_since_handover is not null and
         (new.months_since_handover<0 or lower(new.months_since_handover::text) in ('nan','infinity','-infinity')))
       or length(btrim(coalesce(new.failure_mode,'')))<3
       or new.attributed_to is null
       or new.evidence_class is null
       or length(btrim(coalesce(new.source_reference,'')))<3
       or length(btrim(coalesce(new.assessment_basis,'')))<20 then
      raise exception 'the early-life observation requires bounded timing, failure, attribution and evidence provenance';
    end if;
    if new.fed_back_to_design then
      raise exception 'an observation is born open; only a retained requirement link may close its feedback summary';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then
      return old;
    end if;
    raise exception 'early-life failure observations are retained and cannot be deleted';
  end if;
  if coalesce(current_setting('app.early_life_feedback_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'early-life feedback state is changed only by the governed named-human requirement link';
  end if;
  if (to_jsonb(new)-'fed_back_to_design') is distinct from
        (to_jsonb(old)-'fed_back_to_design') then
    raise exception 'the early-life observation is immutable; only its derived feedback summary may close';
  end if;
  if new.fed_back_to_design is distinct from exists(
    select 1
    from public.early_life_failure_requirements l
    join public.design_requirements r on r.id=l.requirement_id
    where l.early_life_failure_id=new.id
      and l.organization_id=new.organization_id
      and r.organization_id=new.organization_id
      and r.verification_status='verified'
  ) then
    raise exception 'the feedback summary is derived from verified linked requirements and cannot be asserted';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_early_life_feedback_governance()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_early_life_feedback_governance on public.early_life_failures;
create trigger trg_early_life_feedback_governance
  before insert or update or delete on public.early_life_failures
  for each row execute function public.enforce_early_life_feedback_governance();

create or replace function public.enforce_early_life_requirement_link()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then
      return old;
    end if;
    raise exception 'early-life feedback links are retained and cannot be deleted';
  end if;
  if tg_op='UPDATE' then
    raise exception 'early-life feedback links are immutable; add a later requirement link when learning changes';
  end if;
  if coalesce(current_setting('app.early_life_feedback_write',true),'')<>'granted'
     or auth.uid() is null then
    raise exception 'early-life feedback links are written only by the governed named-human workflow';
  end if;
  if new.linked_by<>auth.uid() then
    raise exception 'the feedback link must name the human recording it';
  end if;
  if not exists(select 1 from public.early_life_failures e
    where e.id=new.early_life_failure_id and e.organization_id=new.organization_id) then
    raise exception 'early-life failure must belong to the same organization';
  end if;
  if not exists(select 1 from public.design_requirements r
    where r.id=new.requirement_id and r.organization_id=new.organization_id) then
    raise exception 'design requirement must belong to the same organization';
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified') then
    raise exception 'feedback linkage requires same-tenant independently verified canonical evidence';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_early_life_requirement_link()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_early_life_requirement_link on public.early_life_failure_requirements;
create trigger trg_early_life_requirement_link
  before insert or update or delete on public.early_life_failure_requirements
  for each row execute function public.enforce_early_life_requirement_link();

create or replace function public.refresh_early_life_feedback_summary()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.verification_status is distinct from old.verification_status then
    perform set_config('app.early_life_feedback_write','granted',true);
    update public.early_life_failures f
    set fed_back_to_design=exists(
      select 1
      from public.early_life_failure_requirements l
      join public.design_requirements r on r.id=l.requirement_id
      where l.early_life_failure_id=f.id
        and l.organization_id=f.organization_id
        and r.organization_id=f.organization_id
        and r.verification_status='verified'
    )
    where f.organization_id=new.organization_id
      and exists(select 1 from public.early_life_failure_requirements l
        where l.early_life_failure_id=f.id and l.requirement_id=new.id)
      and f.fed_back_to_design is distinct from exists(
        select 1
        from public.early_life_failure_requirements l
        join public.design_requirements r on r.id=l.requirement_id
        where l.early_life_failure_id=f.id
          and l.organization_id=f.organization_id
          and r.organization_id=f.organization_id
          and r.verification_status='verified'
      );
    perform set_config('app.early_life_feedback_write','',true);
  end if;
  return new;
exception when others then
  perform set_config('app.early_life_feedback_write','',true);
  raise;
end
$$;
revoke all on function public.refresh_early_life_feedback_summary()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_refresh_early_life_feedback_summary on public.design_requirements;
create trigger trg_refresh_early_life_feedback_summary
  after update of verification_status on public.design_requirements
  for each row execute function public.refresh_early_life_feedback_summary();

-- Preserve the established signature used by Sync Transition, adding only the
-- canonical case provenance that later makes the feedback link unambiguous.
create or replace function public.record_case_early_life_failure(
  p_case_id uuid,
  p_asset_id uuid,
  p_occurred_at timestamptz,
  p_months_since_handover numeric,
  p_failure_mode text,
  p_attributed_to text,
  p_preventable_by text,
  p_source_reference text,
  p_evidence_class text,
  p_assessment_basis text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  c public.development_cases%rowtype; v_id bigint;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_uid is null or coalesce(v_role,'')='ai_admin' or coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner','supervisor','technician') then
    raise exception 'early-life failure evidence requires an authorized named human operations, maintenance, engineering or planning role';
  end if;
  select * into c from public.development_cases
  where id=p_case_id and organization_id=v_org;
  if not found then raise exception 'development case not found in this organization'; end if;
  if not exists(select 1 from public.development_case_assets ca
    where ca.organization_id=v_org and ca.development_case_id=c.id
      and ca.asset_id=p_asset_id) then
    raise exception 'asset is not bound to this development case';
  end if;
  if p_occurred_at is null or p_occurred_at>now() then
    raise exception 'occurrence time is required and cannot be in the future';
  end if;
  if p_months_since_handover is not null and
     (p_months_since_handover<0 or lower(p_months_since_handover::text) in ('nan','infinity','-infinity')) then
    raise exception 'months since handover must be finite and non-negative when known';
  end if;
  if length(btrim(coalesce(p_failure_mode,'')))<3 then
    raise exception 'failure mode requires at least three characters';
  end if;
  if p_attributed_to not in ('design','manufacture','installation','commissioning',
      'operation_outside_envelope','random','not_determined') then
    raise exception 'select a governed early-life attribution';
  end if;
  if p_evidence_class not in ('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED',
      'HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE') then
    raise exception 'evidence class must use the governed eight-class provenance vocabulary';
  end if;
  if length(btrim(coalesce(p_source_reference,'')))<3 then
    raise exception 'source or evidence reference is required';
  end if;
  if length(btrim(coalesce(p_assessment_basis,'')))<20 then
    raise exception 'assessment basis requires at least 20 characters';
  end if;
  perform set_config('app.early_life_observation_write','granted',true);
  insert into public.early_life_failures(organization_id,asset_id,project_id,
    development_case_id,occurred_at,months_since_handover,failure_mode,
    attributed_to,preventable_by,source_reference,evidence_class,assessment_basis,recorded_by)
  values(v_org,p_asset_id,c.capital_project_id,c.id,p_occurred_at,p_months_since_handover,
    btrim(p_failure_mode),p_attributed_to,nullif(btrim(coalesce(p_preventable_by,'')),''),
    btrim(p_source_reference),p_evidence_class,btrim(p_assessment_basis),v_uid)
  returning id into v_id;
  perform set_config('app.early_life_observation_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'early_life_failure',v_role,jsonb_build_object(
    'action','recorded','case_id',c.id,'asset_id',p_asset_id,'failure_id',v_id),
    jsonb_build_object('attributed_to',p_attributed_to,'evidence_class',p_evidence_class,
      'source_reference',btrim(p_source_reference),'months_since_handover',p_months_since_handover));
  return jsonb_build_object('id',v_id,'caseId',c.id,'assetId',p_asset_id,'status','recorded');
exception when others then
  perform set_config('app.early_life_observation_write','',true);
  raise;
end
$$;
revoke all on function public.record_case_early_life_failure(uuid,uuid,timestamptz,numeric,text,text,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.record_case_early_life_failure(uuid,uuid,timestamptz,numeric,text,text,text,text,text,text)
  to authenticated;

create or replace function public.link_case_early_life_failure(
  p_case_id uuid,p_failure_id bigint,p_requirement_id bigint,
  p_evidence_item_id uuid,p_basis text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  c public.development_cases%rowtype; f public.early_life_failures%rowtype;
  r public.design_requirements%rowtype; v_link_id bigint;
begin
  select role into v_role from public.user_profiles
  where id=v_uid and organization_id=v_org;
  if v_uid is null or coalesce(v_role,'')='ai_admin' or coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('answered',false,'refusal',
      'feeding an early-life failure into design requires an authorized named human planning, engineering or governance role');
  end if;
  if length(btrim(coalesce(p_basis,'')))<20 then
    return jsonb_build_object('answered',false,'refusal','state the evidence-based reason this requirement addresses the observed failure');
  end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('answered',false,'refusal','development case not found'); end if;
  select * into f from public.early_life_failures
  where id=p_failure_id and organization_id=v_org for update;
  if not found or not (
      f.development_case_id=c.id
      or (f.development_case_id is null and c.capital_project_id is not null and f.project_id=c.capital_project_id)
      or exists(select 1 from public.development_case_assets ca
        where ca.organization_id=v_org and ca.development_case_id=c.id and ca.asset_id=f.asset_id)
    ) then
    return jsonb_build_object('answered',false,'refusal','early-life failure is outside this case scope');
  end if;
  select * into r from public.design_requirements
  where id=p_requirement_id and organization_id=v_org and development_case_id=c.id;
  if not found then
    return jsonb_build_object('answered',false,'refusal','design requirement is outside this case');
  end if;
  if p_evidence_item_id is null or not exists(select 1 from public.evidence_items e
    where e.id=p_evidence_item_id and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('answered',false,'refusal',
      'feedback linkage requires same-tenant independently verified canonical evidence');
  end if;
  if exists(select 1 from public.early_life_failure_requirements l
    where l.early_life_failure_id=f.id and l.requirement_id=r.id) then
    return jsonb_build_object('answered',false,'refusal','that retained feedback link already exists');
  end if;
  perform set_config('app.early_life_feedback_write','granted',true);
  insert into public.early_life_failure_requirements(organization_id,
    early_life_failure_id,requirement_id,evidence_item_id,basis,linked_by)
  values(v_org,f.id,r.id,p_evidence_item_id,btrim(p_basis),v_uid)
  returning id into v_link_id;
  update public.early_life_failures e
  set fed_back_to_design=exists(
    select 1
    from public.early_life_failure_requirements l
    join public.design_requirements linked on linked.id=l.requirement_id
    where l.early_life_failure_id=e.id
      and l.organization_id=e.organization_id
      and linked.organization_id=e.organization_id
      and linked.verification_status='verified'
  )
  where e.id=f.id
    and e.fed_back_to_design is distinct from exists(
      select 1
      from public.early_life_failure_requirements l
      join public.design_requirements linked on linked.id=l.requirement_id
      where l.early_life_failure_id=e.id
        and l.organization_id=e.organization_id
        and linked.organization_id=e.organization_id
        and linked.verification_status='verified'
    );
  perform set_config('app.early_life_feedback_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'early_life_failure_feedback',v_role,jsonb_build_object(
    'link_id',v_link_id,'case_id',c.id,'failure_id',f.id,'requirement_id',r.id,
    'evidence_item_id',p_evidence_item_id,'human_recorded',true),
    jsonb_build_object('fedBackToDesign',f.fed_back_to_design),
    jsonb_build_object('fedBackToDesign',r.verification_status='verified','requirementRef',r.requirement_ref,
      'requirementVerificationStatus',r.verification_status));
  return jsonb_build_object('answered',true,'linkId',v_link_id,'failureId',f.id,
    'requirementId',r.id,'requirementRef',r.requirement_ref,
    'eliminationStatus',case when r.verification_status='verified' then 'verified_eliminated'
      when r.verification_status in ('failed','waived') then 'ineffective'
      else 'feedback_linked' end,
    'note','The observed failure is retained and linked to a canonical design requirement. Only verified requirement evidence counts as elimination; SyncAI did not eliminate the failure.');
exception when unique_violation then
  perform set_config('app.early_life_feedback_write','',true);
  return jsonb_build_object('answered',false,'refusal','that retained feedback link already exists');
when others then
  perform set_config('app.early_life_feedback_write','',true); raise;
end
$$;
revoke all on function public.link_case_early_life_failure(uuid,bigint,bigint,uuid,text)
  from public,anon,service_role;
grant execute on function public.link_case_early_life_failure(uuid,bigint,bigint,uuid,text)
  to authenticated;

create or replace function public.get_case_early_life_feedback_workspace(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); c public.development_cases%rowtype;
begin
  if v_org is null then return jsonb_build_object('answered',false,'refusal','an authenticated organization is required'); end if;
  select * into c from public.development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('answered',false,'refusal','development case not found'); end if;
  return jsonb_build_object(
    'answered',true,
    'boundary','A retained link proves the observation reached design. Only a linked requirement whose verification status is verified is counted as eliminated; open, failed and waived requirements are not elimination.',
    'requirements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'requirementRef',r.requirement_ref,'requirement',r.requirement,
      'verificationStatus',r.verification_status) order by r.requirement_ref)
      from public.design_requirements r where r.organization_id=v_org
        and r.development_case_id=c.id),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',coalesce(e.description,e.evidence_type,e.id::text))
      order by e.created_at desc) from (select * from public.evidence_items
        where organization_id=v_org and verification_status='verified'
        order by created_at desc limit 150) e),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'failureId',l.early_life_failure_id,'requirementId',l.requirement_id,
      'requirementRef',r.requirement_ref,'verificationStatus',r.verification_status,
      'eliminationStatus',case when r.verification_status='verified' then 'verified_eliminated'
        when r.verification_status in ('failed','waived') then 'ineffective'
        else 'feedback_linked' end,
      'basis',l.basis,'evidenceItemId',l.evidence_item_id,'linkedBy',l.linked_by,
      'linkedAt',l.linked_at) order by l.linked_at,l.id)
      from public.early_life_failure_requirements l
      join public.early_life_failures f on f.id=l.early_life_failure_id
      join public.design_requirements r on r.id=l.requirement_id
      where l.organization_id=v_org and (
        f.development_case_id=c.id
        or (f.development_case_id is null and c.capital_project_id is not null and f.project_id=c.capital_project_id)
        or exists(select 1 from public.development_case_assets ca
          where ca.organization_id=v_org and ca.development_case_id=c.id and ca.asset_id=f.asset_id)
      )),'[]'::jsonb));
end
$$;
revoke all on function public.get_case_early_life_feedback_workspace(uuid) from public,anon;
grant execute on function public.get_case_early_life_feedback_workspace(uuid) to authenticated;

comment on function public.get_case_early_life_feedback_workspace(uuid) is
  'E8.13 governed early-life feedback view. Relationship evidence is retained; verified design-requirement evidence alone counts as elimination.';

notify pgrst,'reload schema';
