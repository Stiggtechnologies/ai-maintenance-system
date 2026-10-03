-- Human registration of an existing controlled procedure, not AI adoption.
-- Existing standard headings may receive their first verified language content.
create or replace function public.register_standard_work_baseline(
  p_work_key text,p_title text,p_language text,p_content text,p_basis text,p_evidence_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  s public.standard_work%rowtype; v_id bigint;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if v_org is null or v_actor is null or v_role is null or v_role='ai_admin'
     or not coalesce(public.app_has_approval_authority(),false) then
    return jsonb_build_object('error','A named human with approval authority must verify the existing procedure');
  end if;
  if nullif(btrim(p_work_key),'') is null or nullif(btrim(p_title),'') is null
     or nullif(btrim(p_language),'') is null or nullif(btrim(p_content),'') is null
     or nullif(btrim(p_basis),'') is null or length(p_work_key)>200 or length(p_title)>1000
     or length(p_language)>30 or length(p_content)>100000 or length(p_basis)>10000 then
    return jsonb_build_object('error','Standard identity, title, language, existing content and source basis are required within their size limits');
  end if;
  perform 1 from public.evidence_items where id=p_evidence_id and organization_id=v_org for share;
  if not found then return jsonb_build_object('error','Same-tenant evidence of the existing controlled procedure is required'); end if;
  -- Serialize first registration, including the no-existing-row case.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || btrim(p_work_key),0));
  select * into s from public.standard_work where organization_id=v_org
    and work_key=btrim(p_work_key) order by version desc limit 1 for update;
  if found then
    if s.version<>1 or s.source_project_ca_id is not null then
      return jsonb_build_object('error','A revision already exists; do not replace baseline history');
    end if;
    if s.title is distinct from btrim(p_title) then
      return jsonb_build_object('error','Existing standard title differs; use its canonical identity');
    end if;
    v_id:=s.id;
  else
    insert into public.standard_work(organization_id,work_key,title,basis,version)
      values(v_org,btrim(p_work_key),btrim(p_title),btrim(p_basis),1) returning id into v_id;
  end if;
  if exists(select 1 from public.procedure_translations where standard_work_id=v_id
    and language_code=btrim(p_language)) then
    return jsonb_build_object('error','Procedure content already exists; baseline registration cannot overwrite it');
  end if;
  insert into public.procedure_translations(organization_id,standard_work_id,language_code,
    content,translation_status,verified_by,verified_at)
    values(v_org,v_id,btrim(p_language),btrim(p_content),'human_verified',v_actor,now());
  insert into public.audit_events(organization_id,entity_type,actor,event_data,new_state)
    values(v_org,'standard_work_baseline',v_role,
      jsonb_build_object('actorId',v_actor,'evidenceId',p_evidence_id,'basis',btrim(p_basis)),
      jsonb_build_object('standardWorkId',v_id,'language',btrim(p_language),'verification','named human registration of existing procedure'));
  return jsonb_build_object('standardWorkId',v_id,'status','human_verified');
end $$;
revoke all on function public.register_standard_work_baseline(text,text,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.register_standard_work_baseline(text,text,text,text,text,uuid) to authenticated;
notify pgrst, 'reload schema';
