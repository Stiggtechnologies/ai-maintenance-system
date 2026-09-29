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
begin
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
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger project_procedure_history_guard before update or delete on public.procedure_translations
  for each row execute function public.guard_project_procedure_history();
revoke all on function public.guard_referenced_standard_history() from public,anon,authenticated;
revoke all on function public.guard_project_procedure_history() from public,anon,authenticated;
