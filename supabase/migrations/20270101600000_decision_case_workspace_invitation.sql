-- Brad walkthrough closeout: governed workspace invitations for a persisted
-- Decision Case. This extends the canonical identity (auth.users /
-- user_profiles), Decision Case (cowork_workspaces), and audit_events models.
-- It intentionally creates no parallel membership, approval, queue, or audit
-- table. Workspace membership does not grant decision authority.

create or replace function public.register_decision_case_invitation(
  p_actor_id uuid,
  p_organization_id uuid,
  p_case_id uuid,
  p_invited_user_id uuid,
  p_email text,
  p_name text,
  p_delivery_status text,
  p_detail text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor public.user_profiles%rowtype;
  v_existing public.user_profiles%rowtype;
  v_case public.cowork_workspaces%rowtype;
  v_now timestamptz := clock_timestamp();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_actor_label text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('error', 'decision-case invitation registration is service-only');
  end if;
  if p_actor_id is null or p_organization_id is null then
    return jsonb_build_object('error', 'a named tenant actor is required');
  end if;
  select * into v_actor from public.user_profiles
   where id = p_actor_id and organization_id = p_organization_id;
  if not found or lower(coalesce(v_actor.role, '')) not in ('admin', 'executive') then
    return jsonb_build_object('error', 'workspace invitation requires a same-tenant administrator or executive');
  end if;
  if lower(coalesce(v_actor.role, '')) = 'ai_admin' then
    return jsonb_build_object('error', 'an AI identity cannot invite a tenant member');
  end if;

  select * into v_case from public.cowork_workspaces
   where id = p_case_id
     and organization_id = p_organization_id
     and case_number is not null;
  if not found then
    return jsonb_build_object('error', 'saved Decision Case not found in the active tenant');
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return jsonb_build_object('error', 'a valid work email is required');
  end if;
  if p_delivery_status not in ('submitted', 'already_member', 'failed') then
    return jsonb_build_object('error', 'delivery status must be submitted, already_member, or failed');
  end if;
  if length(trim(coalesce(p_detail, ''))) < 8 then
    return jsonb_build_object('error', 'invitation delivery detail is required');
  end if;

  if exists (
    select 1 from public.user_profiles
     where lower(email) = v_email
       and organization_id is distinct from p_organization_id
  ) then
    return jsonb_build_object('error', 'that identity already belongs to another tenant');
  end if;

  select * into v_existing from public.user_profiles
   where lower(email) = v_email
     and organization_id = p_organization_id
   order by created_at
   limit 1;

  if p_delivery_status = 'submitted' then
    if p_invited_user_id is null then
      return jsonb_build_object('error', 'submitted invitation requires the invited auth identity');
    end if;
    if not exists (
      select 1 from auth.users u
       where u.id = p_invited_user_id and lower(u.email) = v_email
    ) then
      return jsonb_build_object('error', 'invited auth identity does not match the work email');
    end if;
    if exists (
      select 1 from public.user_profiles p
       where p.id = p_invited_user_id
         and p.organization_id is distinct from p_organization_id
    ) then
      return jsonb_build_object('error', 'invited identity already belongs to another tenant');
    end if;
    if v_existing.id is not null and v_existing.id is distinct from p_invited_user_id then
      return jsonb_build_object('error', 'work email is already assigned to another tenant identity');
    end if;
    insert into public.user_profiles (
      id, organization_id, email, full_name, role
    ) values (
      p_invited_user_id,
      p_organization_id,
      v_email,
      coalesce(nullif(v_name, ''), split_part(v_email, '@', 1)),
      'viewer'
    )
    on conflict (id) do update
      set email = excluded.email,
          full_name = coalesce(nullif(public.user_profiles.full_name, ''), excluded.full_name)
      where public.user_profiles.organization_id = excluded.organization_id;
  elsif p_delivery_status = 'already_member' then
    if v_existing.id is null then
      return jsonb_build_object('error', 'already_member requires an existing same-tenant profile');
    end if;
    p_invited_user_id := v_existing.id;
  end if;

  v_actor_label := coalesce(nullif(v_actor.full_name, ''), v_actor.email, p_actor_id::text);
  insert into public.audit_events (
    organization_id, entity_type, actor, event_time, event_data
  ) values (
    p_organization_id,
    'decision_case_invitation',
    v_actor_label,
    v_now,
    jsonb_build_object(
      'action', 'workspace_invitation',
      'case_id', p_case_id,
      'case_number', v_case.case_number,
      'actor_id', p_actor_id,
      'invited_user_id', p_invited_user_id,
      'email', v_email,
      'name', v_name,
      'delivery_status', p_delivery_status,
      'member_role', 'viewer',
      'decision_authority_granted', false,
      'detail', trim(p_detail)
    )
  );

  return jsonb_build_object(
    'status', p_delivery_status,
    'name', v_name,
    'email', v_email,
    'detail', trim(p_detail),
    'invitedUserId', p_invited_user_id,
    'submittedAt', case when p_delivery_status = 'submitted' then v_now else null end,
    'lastCheckedAt', v_now
  );
end
$$;

revoke all on function public.register_decision_case_invitation(
  uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_decision_case_invitation(
  uuid, uuid, uuid, uuid, text, text, text, text
) to service_role;

comment on function public.register_decision_case_invitation(
  uuid, uuid, uuid, uuid, text, text, text, text
) is
  'Service-only Decision Case membership invitation receipt. Reuses auth.users, user_profiles, cowork_workspaces and audit_events. Invited users receive viewer membership only; decision authority remains separately verified.';

create or replace function public.get_decision_case_invitation_status(
  p_case_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_event public.audit_events%rowtype;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authenticated tenant membership is required');
  end if;
  if not exists (
    select 1 from public.cowork_workspaces w
     where w.id = p_case_id
       and w.organization_id = v_org
       and w.case_number is not null
  ) then
    return jsonb_build_object('error', 'saved Decision Case not found in the active tenant');
  end if;
  select * into v_event from public.audit_events e
   where e.organization_id = v_org
     and e.entity_type = 'decision_case_invitation'
     and e.event_data ->> 'case_id' = p_case_id::text
   order by coalesce(e.event_time, e.created_at) desc, e.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('error', 'no workspace invitation is recorded for this Decision Case');
  end if;
  return jsonb_build_object(
    'status', v_event.event_data ->> 'delivery_status',
    'name', coalesce(v_event.event_data ->> 'name', ''),
    'email', v_event.event_data ->> 'email',
    'detail', v_event.event_data ->> 'detail',
    'invitedUserId', nullif(v_event.event_data ->> 'invited_user_id', ''),
    'submittedAt', case
      when v_event.event_data ->> 'delivery_status' = 'submitted'
        then coalesce(v_event.event_time, v_event.created_at)
      else null
    end,
    'lastCheckedAt', clock_timestamp()
  );
end
$$;

revoke all on function public.get_decision_case_invitation_status(uuid)
  from public, anon;
grant execute on function public.get_decision_case_invitation_status(uuid)
  to authenticated;

comment on function public.get_decision_case_invitation_status(uuid) is
  'Returns the latest same-tenant workspace-invitation receipt for a canonical Decision Case. A submitted email is not reported as accepted or active without Auth evidence.';

notify pgrst, 'reload schema';
