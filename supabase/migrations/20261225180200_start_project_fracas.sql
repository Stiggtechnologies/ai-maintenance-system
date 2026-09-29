create or replace function public.start_project_ca_verification(
  p_lesson_id uuid, p_basis text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_lesson public.learning_events%rowtype;
  v_id uuid;
begin
  select role into v_role from public.user_profiles
   where id = v_actor and organization_id = v_org;
  if v_org is null or v_actor is null or coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','Project closure requires a named authorized human');
  end if;
  if nullif(btrim(p_basis),'') is null or length(p_basis) > 10000 then
    return jsonb_build_object('error','State the closure basis (1–10000 characters)');
  end if;
  select * into v_lesson from public.learning_events
   where id = p_lesson_id and organization_id = v_org for update;
  if not found or v_lesson.development_case_id is null
     or nullif(btrim(v_lesson.cause),'') is null
     or nullif(btrim(v_lesson.corrective_action),'') is null
     or nullif(btrim(v_lesson.failure_mode_key),'') is null then
    return jsonb_build_object('error','A complete same-tenant project lesson is required');
  end if;
  insert into public.ca_verifications (
    organization_id,project_lesson_id,project_started_by,project_start_basis,
    observation_start,observation_days,effectiveness,status
  ) values (
    v_org,p_lesson_id,v_actor,btrim(p_basis),null,null,null,'open'
  ) on conflict (project_lesson_id) where project_lesson_id is not null
    do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('error','Project closure already exists for this lesson');
  end if;
  insert into public.audit_events (
    organization_id,entity_type,actor,event_data,new_state
  ) values (
    v_org,'project_ca_verification',v_role,
    jsonb_build_object('action','started','actorId',v_actor,'basis',btrim(p_basis),
      'lessonId',p_lesson_id,'verificationId',v_id),
    jsonb_build_object('status','open','project_lesson_id',p_lesson_id)
  );
  return jsonb_build_object('id',v_id,'status','open',
    'detail','Closure opened. Implementation, standard adoption and future-project screening remain unverified.');
end $$;
revoke all on function public.start_project_ca_verification(uuid,text)
  from public,anon,service_role;
grant execute on function public.start_project_ca_verification(uuid,text) to authenticated;
notify pgrst, 'reload schema';
