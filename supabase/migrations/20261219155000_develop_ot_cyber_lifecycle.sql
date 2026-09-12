-- Sync Develop D4.13 / spec II.13 — OT cybersecurity by design.
--
-- Canonical-home rulings:
--   * every artifact is a classified row on design_requirements;
--   * proof is verification_obligations -> evidence_items;
--   * the cyber acceptance test is acceptance_tests;
--   * gate impact rides case_gate_outstanding_obligations and its existing
--     persistence wall. No cyber requirement, evidence, test, or workflow
--     store is introduced here.

create or replace function public.sync_ot_cyber_artifact_types()
returns text[] language sql immutable set search_path=public as $$
  select array[
    'cyber_requirement','architecture_review','segmentation','remote_access',
    'vendor_access','firmware','patchability','backup','recovery',
    'cyber_acceptance_test']::text[];
$$;
revoke all on function public.sync_ot_cyber_artifact_types() from public,anon;
grant execute on function public.sync_ot_cyber_artifact_types() to authenticated,service_role;
comment on function public.sync_ot_cyber_artifact_types() is
  'D4.13 / II.13: the exact ten OT-cyber lifecycle artifacts, named once for the write door, persistence wall, read model and UI.';

alter table public.development_cases
  add column if not exists ot_cyber_applicability text,
  add column if not exists ot_cyber_applicability_basis text,
  add column if not exists ot_cyber_assessed_by uuid references auth.users(id) on delete set null,
  add column if not exists ot_cyber_assessed_at timestamptz;

do $$ begin
  alter table public.development_cases add constraint development_case_ot_cyber_applicability_valid
    check (ot_cyber_applicability is null or ot_cyber_applicability in ('applicable','not_applicable'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.development_cases add constraint development_case_ot_cyber_assessment_complete
    check ((ot_cyber_applicability is null and ot_cyber_applicability_basis is null
            and ot_cyber_assessed_by is null and ot_cyber_assessed_at is null)
        or (ot_cyber_applicability is not null
            and coalesce(length(btrim(ot_cyber_applicability_basis)),0)>=20
            and ot_cyber_assessed_by is not null and ot_cyber_assessed_at is not null));
exception when duplicate_object then null; end $$;

comment on column public.development_cases.ot_cyber_applicability is
  'D4.13: explicit human scope decision. NULL means not assessed, never not applicable.';

alter table public.design_requirements
  add column if not exists ot_cyber_artifact_type text,
  add column if not exists ot_cyber_basis text;

do $$ begin
  alter table public.design_requirements add constraint design_requirement_ot_cyber_artifact_valid
    check (ot_cyber_artifact_type is null or
      (ot_cyber_artifact_type=any(sync_ot_cyber_artifact_types())
       and category='cyber'
       and owner_id is not null
       and verification_method is not null
       and coalesce(length(btrim(acceptance_criteria)),0)>=10
       and coalesce(length(btrim(ot_cyber_basis)),0)>=20));
exception when duplicate_object then null; end $$;

create unique index if not exists idx_design_requirement_ot_cyber_case_artifact
  on public.design_requirements(development_case_id,ot_cyber_artifact_type)
  where ot_cyber_artifact_type is not null;

comment on column public.design_requirements.ot_cyber_artifact_type is
  'D4.13: classifies the ONE design-requirement row as one of II.13''s ten OT-cyber artifacts. It is not a second requirement object.';

create or replace function public.enforce_ot_cyber_persistence()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  if tg_table_name='development_cases' then
    if (new.ot_cyber_applicability,new.ot_cyber_applicability_basis,new.ot_cyber_assessed_by,new.ot_cyber_assessed_at)
       is distinct from
       (old.ot_cyber_applicability,old.ot_cyber_applicability_basis,old.ot_cyber_assessed_by,old.ot_cyber_assessed_at)
       and current_setting('app.ot_cyber_write',true)<>'granted' then
      raise exception 'OT-cyber applicability is a governed human assessment; use set_case_ot_cyber_applicability';
    end if;
    return new;
  end if;
  if new.ot_cyber_artifact_type is not null then
    if tg_op='UPDATE' and
       (new.ot_cyber_artifact_type,new.ot_cyber_basis) is distinct from
       (old.ot_cyber_artifact_type,old.ot_cyber_basis)
       and current_setting('app.ot_cyber_write',true)<>'granted' then
      raise exception 'an OT-cyber artifact classification and basis are immutable; record a new requirement rather than rewriting provenance';
    end if;
    select role into v_role from user_profiles
      where id=new.created_by and organization_id=new.organization_id;
    if coalesce(v_role,'')='ai_admin' then
      raise exception 'the AI-operator identity may identify an OT-cyber gap but may not author or classify the requirement that closes it';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_ot_cyber_persistence() from public,anon;

drop trigger if exists trg_development_case_ot_cyber_persistence on public.development_cases;
create trigger trg_development_case_ot_cyber_persistence before update on public.development_cases
for each row execute function public.enforce_ot_cyber_persistence();
drop trigger if exists trg_design_requirement_ot_cyber_persistence on public.design_requirements;
create trigger trg_design_requirement_ot_cyber_persistence before insert or update on public.design_requirements
for each row execute function public.enforce_ot_cyber_persistence();

create or replace function public.set_case_ot_cyber_applicability(
  p_case_id uuid,p_applicability text,p_basis text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); c development_cases%rowtype; v_role text;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','OT-cyber applicability is a human scope decision; the AI-operator identity may report it as unassessed but may not decide it');
  end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','OT-cyber applicability requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id=p_case_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if p_applicability not in ('applicable','not_applicable') then
    return jsonb_build_object('error','applicability must be applicable or not_applicable');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','state the OT-cyber scope basis (20 characters minimum)');
  end if;
  if p_applicability='not_applicable' and exists(
    select 1 from design_requirements where development_case_id=c.id and ot_cyber_artifact_type is not null) then
    return jsonb_build_object('error','this case already carries OT-cyber requirements; they cannot be erased by changing applicability to not applicable');
  end if;
  perform set_config('app.ot_cyber_write','granted',true);
  update development_cases set ot_cyber_applicability=p_applicability,
    ot_cyber_applicability_basis=btrim(p_basis),ot_cyber_assessed_by=auth.uid(),ot_cyber_assessed_at=now()
    where id=c.id;
  perform set_config('app.ot_cyber_write','',true);
  insert into audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'ot_cyber_applicability',v_role,jsonb_build_object('case_id',c.id),
    jsonb_build_object('applicability',c.ot_cyber_applicability,'basis',c.ot_cyber_applicability_basis),
    jsonb_build_object('applicability',p_applicability,'basis',btrim(p_basis),'assessed_by',auth.uid()));
  return jsonb_build_object('caseId',c.id,'applicability',p_applicability);
end $$;
revoke all on function public.set_case_ot_cyber_applicability(uuid,text,text) from public,anon;
grant execute on function public.set_case_ot_cyber_applicability(uuid,text,text) to authenticated;

create or replace function public.record_case_ot_cyber_artifact(
  p_case_id uuid,p_artifact jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); c development_cases%rowtype; v_role text;
  v_kind text:=nullif(btrim(p_artifact->>'artifact_type'),'');
  v_owner uuid:=sync_text_as_uuid(p_artifact->>'owner_id');
  v_test bigint:=sync_text_as_int(p_artifact->>'commissioning_test_id');
  v_result jsonb; v_id bigint;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','the AI-operator identity may identify an OT-cyber gap but may not author the requirement, verification method or acceptance criterion that closes it');
  end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording an OT-cyber artifact requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if c.ot_cyber_applicability is distinct from 'applicable' then
    return jsonb_build_object('error','record whether OT cyber is applicable to this case before authoring its lifecycle');
  end if;
  if v_kind is null or not(v_kind=any(sync_ot_cyber_artifact_types())) then
    return jsonb_build_object('error','artifact_type must be one of the ten II.13 OT-cyber artifacts');
  end if;
  if exists(select 1 from design_requirements where development_case_id=c.id and ot_cyber_artifact_type=v_kind) then
    return jsonb_build_object('error',format('%s is already represented by a requirement on this case',v_kind));
  end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','a named owner from this organization is required');
  end if;
  if coalesce(length(btrim(p_artifact->>'basis')),0)<20 then
    return jsonb_build_object('error','state why this requirement is the case-specific OT-cyber control (20 characters minimum)');
  end if;
  if v_test is not null and not exists(select 1 from acceptance_tests where id=v_test and organization_id=v_org
      and (project_id is null or project_id=c.capital_project_id)) then
    return jsonb_build_object('error','the acceptance test must belong to this organization and this case project');
  end if;
  if v_kind<>'cyber_acceptance_test' and v_test is not null then
    return jsonb_build_object('error','only the cyber acceptance-test artifact may bind the commissioning test');
  end if;
  v_result:=record_case_requirement(c.id,jsonb_build_object(
    'requirement_ref',p_artifact->>'requirement_ref','category','cyber',
    'requirement',p_artifact->>'requirement','source',coalesce(p_artifact->>'source','engineering'),
    'verification_method',p_artifact->>'verification_method','owner_id',v_owner,
    'acceptance_criteria',p_artifact->>'acceptance_criteria'));
  if v_result ? 'error' then return v_result; end if;
  v_id:=(v_result->>'requirement_id')::bigint;
  perform set_config('app.ot_cyber_write','granted',true);
  update design_requirements set ot_cyber_artifact_type=v_kind,
    ot_cyber_basis=btrim(p_artifact->>'basis'),commissioning_test_id=v_test where id=v_id;
  perform set_config('app.ot_cyber_write','',true);
  insert into audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'ot_cyber_artifact',v_role,
    jsonb_build_object('case_id',c.id,'requirement_id',v_id,'artifact_type',v_kind),null,
    jsonb_build_object('requirement_ref',p_artifact->>'requirement_ref','artifact_type',v_kind,
      'commissioning_test_id',v_test,'basis',btrim(p_artifact->>'basis')));
  return jsonb_build_object('caseId',c.id,'requirementId',v_id,'artifactType',v_kind);
end $$;
revoke all on function public.record_case_ot_cyber_artifact(uuid,jsonb) from public,anon;
grant execute on function public.record_case_ot_cyber_artifact(uuid,jsonb) to authenticated;

create or replace function public.get_case_ot_cyber_lifecycle(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); c development_cases%rowtype; v_items jsonb; v_blockers jsonb; v_done int;
begin
  if auth.uid() is not null and v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into c from development_cases where id=p_case_id and (v_org is null or organization_id=v_org);
  if not found then return jsonb_build_object('error','development case not found'); end if;
  with kinds as(select kind,ord from unnest(sync_ot_cyber_artifact_types()) with ordinality k(kind,ord)),
  rows as(select k.kind,k.ord,d.id,d.requirement_ref,d.requirement,d.owner_id,d.acceptance_criteria,
      d.verification_method,d.verification_status,d.commissioning_test_id,d.ot_cyber_basis,
      exists(select 1 from verification_obligations o where o.requirement_id=d.id and o.status='completed'
        and o.result='achieved' and o.evidence_id is not null) evidence_verified,
      coalesce((select jsonb_agg(jsonb_build_object('obligationId',o.id,'status',o.status,'result',o.result,
        'evidenceId',o.evidence_id,'verifiedBy',o.verified_by,'verifiedAt',o.verified_at) order by o.created_at)
        from verification_obligations o where o.requirement_id=d.id),'[]'::jsonb) verifications,
      t.test_ref,t.outcome test_outcome,t.release_status test_release_status,t.evidence_item_id test_evidence_id
    from kinds k left join design_requirements d on d.development_case_id=c.id and d.ot_cyber_artifact_type=k.kind
    left join acceptance_tests t on t.id=d.commissioning_test_id)
  select coalesce(jsonb_agg(jsonb_build_object('artifactType',kind,'requirementId',id,
      'requirementRef',requirement_ref,'requirement',requirement,'ownerId',owner_id,
      'acceptanceCriteria',acceptance_criteria,'verificationMethod',verification_method,
      'verificationStatus',verification_status,'evidenceVerified',evidence_verified,
      'basis',ot_cyber_basis,'commissioningTestId',commissioning_test_id,'testRef',test_ref,
      'testOutcome',test_outcome,'testReleaseStatus',test_release_status,
      'testEvidenceId',test_evidence_id,'verifications',verifications,
      'state',case when id is null then 'MISSING' when verification_status='failed' then 'FAILED'
        when not evidence_verified then 'AWAITING_EVIDENCE'
        when kind='cyber_acceptance_test' and (test_release_status is distinct from 'released'
          or test_outcome is distinct from 'pass' or test_evidence_id is null) then 'TEST_NOT_ACCEPTED'
        else 'SATISFIED' end) order by ord),'[]'::jsonb),
    count(*) filter(where id is not null and evidence_verified and (kind<>'cyber_acceptance_test' or
      (test_release_status='released' and test_outcome='pass' and test_evidence_id is not null)))::int
  into v_items,v_done from rows;
  select coalesce(jsonb_agg(jsonb_build_object('type','ot_cyber_lifecycle','id',x->>'artifactType',
    'name',case x->>'state' when 'MISSING' then replace(x->>'artifactType','_',' ')||' is missing'
      when 'FAILED' then coalesce(x->>'requirementRef',x->>'artifactType')||' has failed verification'
      when 'TEST_NOT_ACCEPTED' then coalesce(x->>'requirementRef',x->>'artifactType')||' has no evidence-backed released passing cyber acceptance test'
      else coalesce(x->>'requirementRef',x->>'artifactType')||' has no achieved evidence-backed verification' end,
    'artifactType',x->>'artifactType','state',x->>'state')),'[]'::jsonb)
  into v_blockers from jsonb_array_elements(v_items)x where x->>'state'<>'SATISFIED';
  return jsonb_build_object('caseId',c.id,'applicability',c.ot_cyber_applicability,
    'applicabilityBasis',c.ot_cyber_applicability_basis,'assessedBy',c.ot_cyber_assessed_by,
    'assessedAt',c.ot_cyber_assessed_at,'artifactTypes',to_jsonb(sync_ot_cyber_artifact_types()),
    'satisfiedCount',case when c.ot_cyber_applicability='applicable' then v_done else null end,
    'requiredCount',case when c.ot_cyber_applicability='applicable' then 10 else null end,
    'status',case when c.ot_cyber_applicability is null then 'NOT_ASSESSED'
      when c.ot_cyber_applicability='not_applicable' then 'NOT_APPLICABLE'
      when v_done=10 then 'READY' else 'BLOCKED' end,
    'refusal',case when c.ot_cyber_applicability is null then
      'OT-cyber applicability has not been assessed. NULL does not mean not applicable, and no readiness percentage is reported.' end,
    'items',v_items,'blockers',case when c.ot_cyber_applicability='applicable' then v_blockers else '[]'::jsonb end,
    'decisionBoundary','This lifecycle reports evidence readiness and gate blockers. It cannot accept a test, waive a requirement, approve a gate, authorize remote access, energize equipment or accept handover.');
end $$;
revoke all on function public.get_case_ot_cyber_lifecycle(uuid) from public,anon;
grant execute on function public.get_case_ot_cyber_lifecycle(uuid) to authenticated,service_role;

create or replace function public.case_ot_cyber_gate_obligations(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb;
begin
  v:=get_case_ot_cyber_lifecycle(p_case_id);
  if v->>'applicability' is distinct from 'applicable' then return '[]'::jsonb; end if;
  return coalesce(v->'blockers','[]'::jsonb);
end $$;
revoke all on function public.case_ot_cyber_gate_obligations(uuid) from public,anon;
grant execute on function public.case_ot_cyber_gate_obligations(uuid) to authenticated,service_role;

-- Append the new family to the ONE displayed/enforced gate-obligation predicate.
do $wire$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='case_gate_outstanding_obligations';
  if v_def is null then raise exception 'case_gate_outstanding_obligations is missing; refusing to create a second gate evaluator'; end if;
  if position('case_ot_cyber_gate_obligations' in v_def)=0 then
    v_new:=replace(v_def,E'\n  return v_out;\nend',E'\n  -- D4.13: applicable OT-cyber lifecycle gaps are hard gate obligations.\n  v_out := v_out || case_ot_cyber_gate_obligations(c.id);\n\n  return v_out;\nend');
    if v_new=v_def then raise exception 'case_gate_outstanding_obligations tail changed; refusing a blind OT-cyber insertion'; end if;
    execute v_new;
  end if;
end $wire$;

-- Widen the EXISTING persistence wall. The last current family is the
-- procurement-contract-late obligation added by 20261208090000.
do $wall$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enforce_gate_review_outstanding_obligations';
  if v_def is null then raise exception 'gate obligation persistence wall is missing'; end if;
  if position('ot_cyber_lifecycle' in v_def)=0 then
    v_new:=replace(v_def,$old$'procurement_package_contract_late');$old$,
      $new$'procurement_package_contract_late', 'ot_cyber_lifecycle');$new$);
    if v_new=v_def then raise exception 'gate wall type list changed; refusing a blind OT-cyber insertion'; end if;
    v_new:=replace(v_new,
      $old$or a mandatory long-lead procurement package that cannot arrive when the project needs it '
    '(spec I.18, I.19, I.25, III.§25, III.§71-78). '$old$,
      $new$or a mandatory long-lead procurement package that cannot arrive when the project needs it, '
    'or an applicable II.13 OT-cyber artifact without achieved evidence-backed verification '
    '(spec I.18, I.19, I.25, II.13, III.§25, III.§71-78). '$new$);
    v_new:=replace(v_new,$old$answer_develop_event_consequence / award_contract), or record an outcome $old$,
      $new$answer_develop_event_consequence / award_contract / record_case_ot_cyber_artifact and its verification), or record an outcome $new$);
    if position('II.13 OT-cyber artifact' in v_new)=0 then
      raise exception 'gate wall refusal text changed; refusing to add a blocker the message cannot explain';
    end if;
    execute v_new;
  end if;
end $wall$;

notify pgrst,'reload schema';
