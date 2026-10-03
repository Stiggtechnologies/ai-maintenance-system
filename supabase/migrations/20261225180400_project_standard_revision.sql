-- Versioned internal standard work, not a published-standard licence holding.
-- Adoption is derived from the canonical typed approval; no second queue.
alter table public.standard_work
  add column source_project_ca_id uuid references public.ca_verifications(id) on delete restrict,
  add column previous_standard_work_id bigint references public.standard_work(id) on delete restrict,
  add column change_summary text,
  add column revision_requested_by uuid references auth.users(id) on delete restrict,
  add column revision_approval_id uuid references public.approvals(id) on delete restrict;
alter table public.approvals
  add column standard_work_revision_id bigint references public.standard_work(id) on delete restrict;
create unique index standard_work_revision_one_approval
  on public.approvals(standard_work_revision_id) where standard_work_revision_id is not null;
create unique index standard_work_revision_approval_backref
  on public.standard_work(revision_approval_id) where revision_approval_id is not null;

alter table public.standard_work add constraint project_standard_revision_complete check (
  (source_project_ca_id is null and previous_standard_work_id is null
    and change_summary is null and revision_requested_by is null and revision_approval_id is null)
  or
  (source_project_ca_id is not null and previous_standard_work_id is not null
    and nullif(btrim(change_summary),'') is not null and revision_requested_by is not null)
);

-- Generic approval forms must not approve this object around its revision,
-- evidence and stale-version checks. The dedicated decision RPC is added next.
drop policy if exists approvals_standard_revision_sensitive on public.approvals;
create policy approvals_standard_revision_sensitive on public.approvals as restrictive
  for all to authenticated using (true)
  with check (standard_work_revision_id is null);

create or replace function public.guard_project_standard_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare prior public.standard_work%rowtype;
begin
  if tg_op='UPDATE' and old.source_project_ca_id is not null and
     (new.source_project_ca_id is distinct from old.source_project_ca_id
      or new.previous_standard_work_id is distinct from old.previous_standard_work_id
      or new.organization_id is distinct from old.organization_id
      or new.work_key is distinct from old.work_key
      or new.version is distinct from old.version
      or new.change_summary is distinct from old.change_summary
      or new.revision_requested_by is distinct from old.revision_requested_by
      or new.title is distinct from old.title
      or new.craft is distinct from old.craft
      or new.standard_minutes is distinct from old.standard_minutes
      or new.crew_template_id is distinct from old.crew_template_id
      or (old.revision_approval_id is not null and
          new.revision_approval_id is distinct from old.revision_approval_id)
      or new.basis is distinct from old.basis) then
    raise exception 'Project standard revision content and source identity are immutable';
  end if;
  if new.source_project_ca_id is null then return new; end if;
  select * into prior from public.standard_work
    where id=new.previous_standard_work_id and organization_id=new.organization_id for share;
  if not found or prior.work_key is distinct from new.work_key
     or new.version <= prior.version or exists (
       select 1 from public.standard_work s where s.organization_id=new.organization_id
         and s.work_key=new.work_key and s.version>prior.version and s.version<new.version
         and not exists(select 1 from public.approvals a where a.id=s.revision_approval_id
           and a.organization_id=new.organization_id and a.standard_work_revision_id=s.id
           and a.status='rejected')
     ) then
    raise exception 'Revision must retain the same-tenant standard identity and next version';
  end if;
  if tg_op='INSERT' and new.version <> (
    select coalesce(max(s.version),prior.version)+1 from public.standard_work s
      where s.organization_id=new.organization_id and s.work_key=new.work_key
  ) then
    raise exception 'Revision must retain the same-tenant standard identity and next version';
  end if;
  perform 1 from public.ca_verifications c
    where c.id=new.source_project_ca_id and c.organization_id=new.organization_id
      and c.project_lesson_id is not null and c.causal_addressed_at is not null
      and c.project_causal_evidence_id is not null for share;
  if not found then raise exception 'Revision requires evidenced project causal attestation'; end if;
  -- Authorization is checked at creation, not retroactively after a human's
  -- role changes. The recorded actor is immutable historical provenance.
  if tg_op='INSERT' and not exists(select 1 from public.user_profiles p
    where p.id=new.revision_requested_by and p.organization_id=new.organization_id
      and p.role in ('admin','executive','maintenance_manager','reliability_engineer','planner')) then
    raise exception 'Revision requires a named same-tenant human';
  end if;
  if new.revision_approval_id is not null and not exists (
    select 1 from public.approvals a where a.id=new.revision_approval_id
      and a.organization_id=new.organization_id and a.standard_work_revision_id=new.id
  ) then raise exception 'Revision requires its canonical same-tenant approval'; end if;
  return new;
end $$;
create trigger project_standard_revision_guard before insert or update
  on public.standard_work for each row execute function public.guard_project_standard_revision();
revoke all on function public.guard_project_standard_revision() from public,anon,authenticated;
notify pgrst, 'reload schema';
