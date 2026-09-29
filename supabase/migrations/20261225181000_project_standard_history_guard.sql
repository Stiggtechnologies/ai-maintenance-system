create or replace function public.guard_referenced_standard_history()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.standard_work s where s.previous_standard_work_id=old.id)
    and (new.organization_id is distinct from old.organization_id
      or new.work_key is distinct from old.work_key or new.version is distinct from old.version
      or new.title is distinct from old.title or new.basis is distinct from old.basis) then
    raise exception 'A referenced prior standard retains its identity and source facts';
  end if;
  return new;
end $$;
create trigger referenced_standard_history_guard before update on public.standard_work
  for each row execute function public.guard_referenced_standard_history();

create or replace function public.guard_project_procedure_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare parent public.standard_work%rowtype;
begin
  if tg_op='INSERT' then
    select * into parent from public.standard_work where id=new.standard_work_id for share;
    if found and parent.source_project_ca_id is not null then
      if new.organization_id is distinct from parent.organization_id
         or parent.revision_approval_id is not null
         or new.translation_status is distinct from 'draft'
         or new.verified_by is not null or new.verified_at is not null
         or exists(select 1 from public.procedure_translations p where p.standard_work_id=parent.id) then
        raise exception 'Project revision accepts one same-tenant unverified draft before approval submission';
      end if;
    end if;
    return new;
  end if;
  if exists(select 1 from public.standard_work s where s.id=old.standard_work_id
    and (s.source_project_ca_id is not null or exists(select 1 from public.standard_work r
      where r.previous_standard_work_id=s.id))) then
    if tg_op='DELETE' then raise exception 'Referenced project procedure content cannot be deleted'; end if;
    if new.organization_id is distinct from old.organization_id
       or new.standard_work_id is distinct from old.standard_work_id
       or new.language_code is distinct from old.language_code
       or new.content is distinct from old.content then
      raise exception 'Referenced project procedure content is immutable; request a new revision';
    end if;
    if old.translation_status='human_verified' and
       (new.translation_status is distinct from old.translation_status
        or new.verified_by is distinct from old.verified_by
        or new.verified_at is distinct from old.verified_at) then
      raise exception 'Recorded procedure verification cannot be overwritten';
    end if;
    if new.translation_status='human_verified' and old.translation_status is distinct from 'human_verified'
       and exists(select 1 from public.standard_work s where s.id=old.standard_work_id
         and s.source_project_ca_id is not null)
       and not exists(select 1 from public.standard_work s join public.approvals a
         on a.id=s.revision_approval_id and a.standard_work_revision_id=s.id
           and a.organization_id=s.organization_id
         where s.id=old.standard_work_id and s.organization_id=new.organization_id
           and a.status='approved' and a.approver_user_id=new.verified_by
           and a.decided_at=new.verified_at and new.verified_by is not null
           and new.verified_at is not null) then
      raise exception 'Project procedure verification requires its recorded adoption decision';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger project_procedure_history_guard before insert or update or delete on public.procedure_translations
  for each row execute function public.guard_project_procedure_history();
revoke all on function public.guard_referenced_standard_history() from public,anon,authenticated;
revoke all on function public.guard_project_procedure_history() from public,anon,authenticated;
