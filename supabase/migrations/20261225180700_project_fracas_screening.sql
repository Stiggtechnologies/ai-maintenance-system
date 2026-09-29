alter table public.ca_verifications
  add column project_screened_at timestamptz,
  add column project_screened_by uuid references auth.users(id) on delete restrict,
  add column project_screening_receipt jsonb;

create or replace function public.screen_project_ca_exposure(p_verification_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  c public.ca_verifications%rowtype; l public.learning_events%rowtype;
  src public.development_cases%rowtype; v_population jsonb; v_matches jsonb;
  v_receipt jsonb; v_at timestamptz:=statement_timestamp();
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_actor is null or v_org is null or coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','A named authorized human must record project screening');
  end if;
  if nullif(btrim(p_basis),'') is null or length(p_basis)>10000 then
    return jsonb_build_object('error','Record the screening basis (1–10000 characters)');
  end if;
  select * into c from public.ca_verifications where id=p_verification_id
    and organization_id=v_org and project_lesson_id is not null for update;
  if not found then return jsonb_build_object('error','Project closure not found'); end if;
  if not exists(select 1 from public.standard_work s join public.approvals a
    on a.id=s.revision_approval_id and a.organization_id=v_org
      and a.standard_work_revision_id=s.id and a.status='approved'
    where s.id=c.project_adopted_standard_id and s.organization_id=v_org
      and s.source_project_ca_id=c.id) then
    return jsonb_build_object('error','Adopt the evidenced standard revision before screening');
  end if;
  select * into l from public.learning_events where id=c.project_lesson_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','Source lesson not found'); end if;
  select * into src from public.development_cases where id=l.development_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','Source project not found'); end if;
  -- One statement snapshot: population and matches cannot refer to different
  -- sets of projects. Reuse the canonical matcher, never a second score/model.
  select coalesce(jsonb_agg(d.id order by d.id),'[]'::jsonb),
    coalesce(jsonb_agg(d.id order by d.id) filter(where public.sync_lesson_applies_to_case(
      l.development_case_id,src.lifecycle_type,l.applicability,
      d.id,d.lifecycle_type,d.title,d.problem_statement)),'[]'::jsonb)
    into v_population,v_matches
    from public.development_cases d where d.organization_id=v_org and d.id<>src.id;
  v_receipt:=jsonb_build_object('screenedAt',v_at,'actorId',v_actor,'basis',btrim(p_basis),
    'lessonId',l.id,'standardRevisionId',c.project_adopted_standard_id,
    'sourceLifecycleType',src.lifecycle_type,'applicability',l.applicability,
    'population',v_population,'matches',v_matches,
    'populationCount',jsonb_array_length(v_population),'matchCount',jsonb_array_length(v_matches),
    'scope','All other current cases in this organization at the screening snapshot',
    'limitation','Applicability screening is not proof of adoption by matched projects or verified failure prevention. Later projects require creation-time screening.');
  update public.ca_verifications set project_screened_at=v_at,
    project_screened_by=v_actor,project_screening_receipt=v_receipt where id=c.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
    values(v_org,'project_ca_screening',v_role,
      jsonb_build_object('verificationId',c.id,'actorId',v_actor),v_receipt);
  return v_receipt;
end $$;
revoke all on function public.screen_project_ca_exposure(uuid,text) from public,anon,service_role;
grant execute on function public.screen_project_ca_exposure(uuid,text) to authenticated;
notify pgrst, 'reload schema';
