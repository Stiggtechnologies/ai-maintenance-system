-- Sync attachment lifecycle control. Extends cowork_attachments only; storage
-- object deletion remains protected by the matching creator-scoped bucket rule.
create or replace function public.delete_sync_attachment(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_path text;
begin
  select a.object_path into v_path
  from public.cowork_attachments a
  join public.cowork_workspaces w on w.id = a.workspace_id
  where a.id = p_attachment_id
    and a.organization_id = v_org
    and a.uploaded_by = auth.uid()
    and a.deleted_at is null
    and w.organization_id = v_org
    and w.workspace_kind = 'sync'
    and w.created_by = auth.uid()::text;

  if v_path is null then raise exception 'Sync attachment not found'; end if;

  update public.cowork_attachments
     set deleted_at = now(), extracted_text = null
   where id = p_attachment_id
     and organization_id = v_org
     and uploaded_by = auth.uid();

  return v_path;
end;
$$;
revoke all on function public.delete_sync_attachment(uuid) from public;
grant execute on function public.delete_sync_attachment(uuid) to authenticated;
