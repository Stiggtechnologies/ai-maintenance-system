-- Named-human capture; no execution authorization or verified-effect claim.
create unique index if not exists work_orders_org_identity
  on public.work_orders(organization_id,id);
create unique index if not exists procedure_translations_org_identity
  on public.procedure_translations(organization_id,id);
alter table public.learning_events
  add constraint standard_observation_procedure_tenant foreign key (organization_id,standard_procedure_id)
    references public.procedure_translations(organization_id,id) on delete restrict,
  add constraint standard_observation_work_tenant foreign key (organization_id,standard_execution_work_order_id)
    references public.work_orders(organization_id,id) on delete restrict,
  add constraint standard_observation_execution_evidence_tenant foreign key (organization_id,standard_execution_evidence_id)
    references public.evidence_items(organization_id,id) on delete restrict,
  add constraint standard_observation_outcome_evidence_tenant foreign key (organization_id,standard_outcome_evidence_id)
    references public.evidence_items(organization_id,id) on delete restrict;

create or replace function public.guard_standard_work_observation()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.procedure_translations%rowtype; s public.standard_work%rowtype;
begin
  if tg_op in ('UPDATE','DELETE') and old.event_type='standard_work_observation' then
    raise exception 'standard-work observations are immutable; retain corrections as new evidence';
  end if;
  if tg_op<>'DELETE' and new.event_type='standard_work_observation' then
    if tg_op<>'INSERT' or coalesce(current_setting('syncai.standard_observation_write',true),'')<>'on'
      or auth.uid() is null or new.standard_execution_recorded_by is distinct from auth.uid()
      or new.organization_id is distinct from public.app_current_org()
      or not exists(select 1 from public.user_profiles where id=auth.uid()
        and organization_id=new.organization_id and role in
        ('admin','executive','maintenance_manager','reliability_engineer','planner')) then
      raise exception 'standard-work observations require the named-human recorder';
    end if;
    -- Match the revision/adoption parent-before-procedure lock order.
    select * into p from public.procedure_translations where id=new.standard_procedure_id;
    select * into s from public.standard_work where id=p.standard_work_id for share;
    select * into p from public.procedure_translations where id=new.standard_procedure_id for share;
    if p.id is null or s.id is null or p.standard_work_id is distinct from s.id
      or p.organization_id is distinct from new.organization_id
      or s.organization_id is distinct from new.organization_id
      or p.translation_status is distinct from 'human_verified'
      or p.verified_by is null or p.verified_at is null
      or (s.source_project_ca_id is not null and not exists(select 1 from public.approvals a
        where a.id=s.revision_approval_id and a.standard_work_revision_id=s.id
          and a.organization_id=new.organization_id and a.status='approved')) then
      raise exception 'Observation requires the exact same-tenant human-verified adopted procedure';
    end if;
    perform 1 from public.work_orders where id=new.standard_execution_work_order_id
      and organization_id=new.organization_id for share;
    if not found then raise exception 'Observation requires same-tenant actual work'; end if;
    if new.development_case_id is null or not exists(select 1 from public.work_package_work m
      join public.work_packages w on w.id=m.work_package_id
      where m.organization_id=new.organization_id and w.organization_id=new.organization_id
        and w.development_case_id=new.development_case_id
        and m.work_order_id=new.standard_execution_work_order_id) then
      raise exception 'Observed work must belong to the selected project through its work package';
    end if;
    perform 1 from public.evidence_items where id=new.standard_execution_evidence_id
      and organization_id=new.organization_id for share;
    if not found then raise exception 'Same-tenant execution evidence is required'; end if;
    perform 1 from public.evidence_items where id=new.standard_outcome_evidence_id
      and organization_id=new.organization_id for share;
    if not found then raise exception 'Same-tenant outcome evidence is required'; end if;
    if not isfinite(new.standard_execution_observed_at)
      or new.standard_execution_observed_at>now() then
      raise exception 'Observation time must be finite and not in the future';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_standard_work_observation() from public,anon,authenticated;

create or replace function public.record_standard_work_observation(
  p_case_id uuid,p_procedure_id bigint,p_work_order_id uuid,
  p_execution_evidence_id uuid,p_outcome_evidence_id uuid,p_observed_at timestamptz,
  p_observation jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','A named authorized human must record the observation');
  end if;
  if jsonb_typeof(p_observation) is distinct from 'object' then
    return jsonb_build_object('error','Observation fields must be an object');
  end if;
  perform set_config('syncai.standard_observation_write','on',true);
  insert into public.learning_events(organization_id,development_case_id,event_type,title,detail,applicability,
    standard_procedure_id,standard_execution_work_order_id,standard_execution_evidence_id,
    standard_outcome_evidence_id,standard_execution_observed_at,standard_execution_recorded_by,
    standard_execution_description,standard_variation_kind,standard_variation_basis,standard_outcome_description)
  values(v_org,p_case_id,'standard_work_observation',btrim(p_observation->>'title'),
    btrim(p_observation->>'learning'),btrim(p_observation->>'applicability'),p_procedure_id,p_work_order_id,
    p_execution_evidence_id,p_outcome_evidence_id,p_observed_at,v_actor,
    btrim(p_observation->>'execution'),p_observation->>'variationKind',
    btrim(p_observation->>'variationBasis'),btrim(p_observation->>'outcome')) returning id into v_id;
  perform set_config('syncai.standard_observation_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'standard_work_observation',v_role,
    jsonb_build_object('actorId',v_actor,'learningEventId',v_id,'procedureId',p_procedure_id,
      'workOrderId',p_work_order_id,'caseId',p_case_id),
    jsonb_build_object('status','observed','improvementEstablished',false));
  return jsonb_build_object('id',v_id,'status','observed',
    'detail','Observation recorded. Improvement and standard adoption are not established.');
exception when check_violation or foreign_key_violation or raise_exception then
  return jsonb_build_object('error',sqlerrm);
end $$;
revoke all on function public.record_standard_work_observation(uuid,bigint,uuid,uuid,uuid,timestamptz,jsonb)
  from public,anon,service_role;
grant execute on function public.record_standard_work_observation(uuid,bigint,uuid,uuid,uuid,timestamptz,jsonb)
  to authenticated;
notify pgrst,'reload schema';
