-- ============================================================================
-- Governed Sync rollout control.
--
-- Phase 0 intentionally made feature_flags SELECT-only for authenticated users
-- and said the eventual mutation path must be a gated SECURITY DEFINER function
-- that records who changed what. This is that path. It is deliberately an RPC,
-- not a writable table policy: a client can request a rollout change only if
-- the database independently confirms the caller is an admin/ai_admin in the
-- current organization.
--
-- Every flag remains default OFF. This function enables tenant-level canary
-- rollout; it does not opt any organization in by migration.
-- ============================================================================

create or replace function public.set_sync_feature_flag(
  p_flag_key text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_previous boolean;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;

  if coalesce(v_role, '') not in ('admin', 'ai_admin') then
    return jsonb_build_object(
      'error',
      'changing Sync rollout flags requires an administrator role'
    );
  end if;

  if p_flag_key not in (
    'sync_global_shell',
    'sync_voice_input',
    'sync_voice_output',
    'sync_agent_routing',
    'sync_tools',
    'sync_meeting_mode',
    'sync_field_mode'
  ) then
    return jsonb_build_object('error', 'unknown Sync feature flag');
  end if;

  select enabled into v_previous
  from public.feature_flags
  where organization_id = v_org and flag_key = p_flag_key;

  insert into public.feature_flags (
    organization_id,
    flag_key,
    enabled,
    updated_by,
    updated_at
  )
  values (
    v_org,
    p_flag_key,
    p_enabled,
    auth.uid(),
    now()
  )
  on conflict (organization_id, flag_key)
  do update set
    enabled = excluded.enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_events (
    organization_id,
    entity_type,
    actor,
    event_data
  )
  values (
    v_org,
    'sync_feature_flag',
    auth.uid()::text,
    jsonb_build_object(
      'flag_key', p_flag_key,
      'previous_enabled', v_previous,
      'enabled', p_enabled,
      'changed_by', auth.uid(),
      'changed_at', now()
    )
  );

  return jsonb_build_object(
    'flag_key', p_flag_key,
    'enabled', p_enabled,
    'previous_enabled', v_previous
  );
end $$;

revoke all on function public.set_sync_feature_flag(text, boolean) from public, anon;
grant execute on function public.set_sync_feature_flag(text, boolean) to authenticated;
