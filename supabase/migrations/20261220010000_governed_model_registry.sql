-- D11.30 / spec III.71-78 — one governed registry for AI and calculation models.
-- Extends canonical model_register. A version is immutable and cannot become
-- current for decisions until a different named human reviews verified evidence.

alter table public.model_register
  add column if not exists training_data jsonb,
  add column if not exists validation_summary jsonb,
  add column if not exists applicability_summary jsonb,
  add column if not exists approval_status text not null default 'unapproved',
  add column if not exists decision_relevant boolean not null default true,
  add column if not exists current_for_decisions boolean not null default false,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_basis text,
  add column if not exists approval_evidence_item_id uuid references public.evidence_items(id) on delete restrict;

alter table public.model_register drop constraint if exists model_register_approval_status_check;
alter table public.model_register add constraint model_register_approval_status_check
  check (approval_status in ('unapproved','pending_review','approved','rejected','revalidation_required','retired'));

create unique index if not exists idx_model_register_current_decision_version
  on public.model_register(organization_id,model_key)
  where current_for_decisions;

-- Existing calculation rows gain honest, explicit profiles. Statistical/ML/LLM
-- training provenance remains unrecorded and therefore blocks future approval;
-- deterministic and rule-based engines truthfully state that training is N/A.
update public.model_register set
  training_data=coalesce(training_data,
    case when model_kind in ('rule_based','deterministic_physics','standards_method')
      then jsonb_build_object('status','not_applicable','basis','This version is deterministic or rule-based and was not trained on a population.')
      else jsonb_build_object('status','unrecorded','basis','Training-data provenance has not yet been supplied for this legacy version; approval is blocked.') end),
  validation_summary=coalesce(validation_summary,jsonb_build_object(
    'status',case when nullif(btrim(coalesce(verification_reference,'')),'') is null then 'unrecorded' else 'recorded' end,
    'reference',verification_reference)),
  applicability_summary=coalesce(applicability_summary,jsonb_build_object(
    'approvedFor',to_jsonb(approved_for),'envelope',applicability_envelope)),
  approval_status=case when lifecycle_state='revalidation_required' then 'revalidation_required'
    when lifecycle_state='retired' then 'retired'
    when approved_on is not null then 'approved' else approval_status end,
  current_for_decisions=case when approved_on is not null and lifecycle_state not in ('revalidation_required','retired') then true else false end,
  reviewed_at=coalesce(reviewed_at,approved_on::timestamptz),
  submitted_at=coalesce(submitted_at,created_at);

create or replace function public.enforce_model_register_version_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('app.model_registry_governed_write',true)='granted' then return new; end if;
  if old.model_key is distinct from new.model_key
     or old.version is distinct from new.version
     or old.model_kind is distinct from new.model_kind
     or old.purpose is distinct from new.purpose
     or old.training_data is distinct from new.training_data
     or old.validation_summary is distinct from new.validation_summary
     or old.applicability_summary is distinct from new.applicability_summary
     or old.limitations is distinct from new.limitations
     or old.approval_status is distinct from new.approval_status
     or old.current_for_decisions is distinct from new.current_for_decisions
     or old.approved_on is distinct from new.approved_on
     or old.approved_by is distinct from new.approved_by then
    raise exception 'model versions and approval state are immutable outside governed registry functions; register a new version';
  end if;
  return new;
end $$;

drop trigger if exists trg_model_register_version_immutability on public.model_register;
create trigger trg_model_register_version_immutability
  before update on public.model_register for each row
  execute function public.enforce_model_register_version_immutability();

create or replace function public.submit_model_registry_version(
  p_model_key text,p_version text,p_model_kind text,p_purpose text,
  p_training_data jsonb,p_validation jsonb,p_applicability jsonb,
  p_limitations text,p_decision_relevant boolean default true,
  p_supersedes_model_id bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_id bigint; prior public.model_register%rowtype;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authenticated organization member required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','ai_admin','executive','reliability_engineer') then
    return jsonb_build_object('error','model registry submission authority denied');
  end if;
  if length(btrim(coalesce(p_model_key,'')))<3 or length(btrim(coalesce(p_version,'')))<1 then
    return jsonb_build_object('error','a stable model key and exact version are required');
  end if;
  if p_model_kind not in ('statistical','rule_based','machine_learning','llm','hybrid','deterministic_physics','empirical_reliability','oem_curve','standards_method') then
    return jsonb_build_object('error','model kind is not controlled');
  end if;
  if length(btrim(coalesce(p_purpose,'')))<20 or length(btrim(coalesce(p_limitations,'')))<20 then
    return jsonb_build_object('error','purpose and limitations each require at least 20 characters');
  end if;
  if jsonb_typeof(p_training_data)<>'object' or p_training_data='{}'::jsonb
     or jsonb_typeof(p_validation)<>'object' or p_validation='{}'::jsonb
     or jsonb_typeof(p_applicability)<>'object' or p_applicability='{}'::jsonb then
    return jsonb_build_object('error','training data, validation and applicability must be non-empty structured records');
  end if;
  if coalesce(p_training_data->>'status','') not in ('recorded','not_applicable') then
    return jsonb_build_object('error','training-data provenance must be recorded or explicitly not applicable before review');
  end if;
  if exists(select 1 from public.model_register where organization_id=v_org and model_key=btrim(p_model_key) and version=btrim(p_version)) then
    return jsonb_build_object('error','this exact model version is already registered and cannot be overwritten');
  end if;
  if p_supersedes_model_id is not null then
    select * into prior from public.model_register where id=p_supersedes_model_id and organization_id=v_org;
    if not found or prior.model_key<>btrim(p_model_key) then
      return jsonb_build_object('error','superseded version must be a same-tenant version of the same model key');
    end if;
  elsif exists(select 1 from public.model_register where organization_id=v_org and model_key=btrim(p_model_key)) then
    return jsonb_build_object('error','a new version of an existing model must identify the version it supersedes');
  end if;

  perform set_config('app.model_registry_governed_write','granted',true);
  insert into public.model_register(
    organization_id,model_key,version,model_kind,purpose,approved_for,
    human_in_loop,limitations,training_data,validation_summary,applicability_summary,
    approval_status,decision_relevant,current_for_decisions,submitted_by,submitted_at,
    supersedes_model_id,lifecycle_state,production_eligible
  ) values(
    v_org,btrim(p_model_key),btrim(p_version),p_model_kind,btrim(p_purpose),'{}'::text[],
    true,btrim(p_limitations),p_training_data,p_validation,p_applicability,
    'pending_review',coalesce(p_decision_relevant,true),false,auth.uid(),now(),
    p_supersedes_model_id,'draft',false
  ) returning id into v_id;
  perform set_config('app.model_registry_governed_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'model_registry_version_submitted',v_role,jsonb_build_object(
    'model_register_id',v_id,'model_key',btrim(p_model_key),'version',btrim(p_version),
    'supersedes_model_id',p_supersedes_model_id,'decision_relevant',coalesce(p_decision_relevant,true)));
  return jsonb_build_object('modelRegisterId',v_id,'status','pending_review','currentForDecisions',false);
exception when others then
  perform set_config('app.model_registry_governed_write','',true); raise;
end $$;

create or replace function public.review_model_registry_version(
  p_model_register_id bigint,p_decision text,p_evidence_item_id uuid,p_review_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; m public.model_register%rowtype; v_approval uuid; old_id bigint;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authenticated organization member required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','ai_admin','executive') then return jsonb_build_object('error','model registry review authority denied'); end if;
  if p_decision not in ('approved','rejected') then return jsonb_build_object('error','decision must be approved or rejected'); end if;
  if length(btrim(coalesce(p_review_basis,'')))<30 then return jsonb_build_object('error','independent review basis requires at least 30 characters'); end if;
  select * into m from public.model_register where id=p_model_register_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','model version not found in this organization'); end if;
  if m.approval_status not in ('pending_review','revalidation_required') then return jsonb_build_object('error','model version is not awaiting review'); end if;
  if m.submitted_by=auth.uid() then return jsonb_build_object('error','model version submitter cannot independently review it'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id and e.organization_id=v_org and e.verification_status='verified') then
    return jsonb_build_object('error','same-tenant verified review evidence is required');
  end if;
  if m.training_data is null or m.validation_summary is null or m.applicability_summary is null
     or length(btrim(coalesce(m.purpose,'')))<20 or length(btrim(coalesce(m.limitations,'')))<20 then
    return jsonb_build_object('error','all seven model registry attributes must be complete');
  end if;

  select id into old_id from public.model_register
   where organization_id=v_org and model_key=m.model_key and current_for_decisions and id<>m.id
   order by created_at desc limit 1;
  perform set_config('app.model_registry_governed_write','granted',true);
  if p_decision='approved' then
    update public.model_register set current_for_decisions=false,
      approval_status=case when lifecycle_state='retired' then 'retired' else approval_status end
    where organization_id=v_org and model_key=m.model_key and id<>m.id and current_for_decisions;
  end if;
  update public.model_register set
    approval_status=p_decision,
    current_for_decisions=(p_decision='approved'),
    approved_on=case when p_decision='approved' then current_date else null end,
    approved_by=case when p_decision='approved' then auth.uid() else null end,
    reviewed_at=now(),review_basis=btrim(p_review_basis),approval_evidence_item_id=p_evidence_item_id,
    review_due=case when p_decision='approved' then current_date+365 else null end
  where id=m.id;
  perform set_config('app.model_registry_governed_write','',true);

  insert into public.approvals(organization_id,status,owner_role,approver,reason,
    consequence_of_wrong,required_validation,decided_at,model_register_id,approver_user_id,approval_scope)
  values(v_org,p_decision,v_role,v_role,btrim(p_review_basis),
    'An unreviewed model version can silently alter decision-relevant outputs.',
    'Seven-attribute registry review with same-tenant verified evidence.',now(),m.id,auth.uid(),
    jsonb_build_object('modelKey',m.model_key,'version',m.version,'evidenceItemId',p_evidence_item_id,
      'decisionRelevant',m.decision_relevant,'operationalAuthorization',false)) returning id into v_approval;

  if p_decision='approved' and old_id is not null and m.decision_relevant then
    insert into public.engineering_model_impacts(
      organization_id,model_register_id,calculation_run_id,recommendation_id,impact_reason,status
    ) select distinct v_org,m.id,r.id,r.recommendation_id,
      'A newly approved decision-relevant version supersedes model_register '||old_id||'; prior outputs require explicit review.',
      'open'
    from public.calculation_runs r
    where r.organization_id=v_org and r.model_register_id=old_id
      and r.recommendation_id is not null
    on conflict do nothing;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'model_registry_version_reviewed',v_role,jsonb_build_object(
    'model_register_id',m.id,'model_key',m.model_key,'version',m.version,'decision',p_decision,
    'approval_id',v_approval,'evidence_item_id',p_evidence_item_id,'prior_current_model_id',old_id));
  return jsonb_build_object('modelRegisterId',m.id,'status',p_decision,
    'currentForDecisions',(p_decision='approved'),'approvalId',v_approval,'priorCurrentModelId',old_id);
exception when others then
  perform set_config('app.model_registry_governed_write','',true); raise;
end $$;

create or replace function public.require_current_model_version(p_model_key text,p_version text)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when exists(select 1 from public.model_register m
    where m.organization_id=public.app_current_org() and m.model_key=p_model_key and m.version=p_version
      and m.approval_status='approved' and m.current_for_decisions and m.approved_on is not null)
    then jsonb_build_object('allowed',true,'modelKey',p_model_key,'version',p_version)
    else jsonb_build_object('allowed',false,'refusal','the exact model version is not the approved current version for this organization') end
$$;

create or replace function public.get_model_register()
returns jsonb language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'modelKey',model_key,'version',version,'modelKind',model_kind,
    'purpose',purpose,'trainingData',training_data,'validation',validation_summary,
    'applicability',applicability_summary,'limitations',limitations,
    'approvalStatus',approval_status,'approvedFor',approved_for,'approvedOn',approved_on,
    'reviewDue',review_due,'humanInLoop',human_in_loop,'verificationReference',verification_reference,
    'decisionRelevant',decision_relevant,'currentForDecisions',current_for_decisions,
    'submittedBy',submitted_by,'submittedAt',submitted_at,'reviewedAt',reviewed_at,
    'reviewBasis',review_basis,'approvalEvidenceItemId',approval_evidence_item_id,
    'supersedesModelId',supersedes_model_id
  ) order by model_key,created_at desc), '[]'::jsonb)
  from public.model_register where organization_id=public.app_current_org()
$$;

revoke all on function public.enforce_model_register_version_immutability() from public,anon,authenticated;
revoke all on function public.submit_model_registry_version(text,text,text,text,jsonb,jsonb,jsonb,text,boolean,bigint) from public,anon;
revoke all on function public.review_model_registry_version(bigint,text,uuid,text) from public,anon;
revoke all on function public.require_current_model_version(text,text) from public,anon;
grant execute on function public.submit_model_registry_version(text,text,text,text,jsonb,jsonb,jsonb,text,boolean,bigint) to authenticated;
grant execute on function public.review_model_registry_version(bigint,text,uuid,text) to authenticated;
grant execute on function public.require_current_model_version(text,text) to authenticated;

comment on function public.require_current_model_version(text,text) is
  'D11.30 runtime gate: decision-relevant callers must name an exact, independently approved current version. Version aliases are refused.';
notify pgrst,'reload schema';
