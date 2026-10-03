-- Administrative completion of I.37, explicitly not measured effectiveness.
alter table public.ca_verifications drop constraint if exists ca_verifications_status_check;
alter table public.ca_verifications add constraint ca_verifications_status_check
  check (status in ('open','observing','closed_effective','reopened_ineffective','closed_project_workflow'));

create or replace function public.guard_project_workflow_completion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='closed_project_workflow' then
    if jsonb_typeof(new.project_screening_receipt->'population') is distinct from 'array'
       or jsonb_typeof(new.project_screening_receipt->'matches') is distinct from 'array' then
      raise exception 'Project workflow completion requires a consistent screening population receipt';
    end if;
    if (new.project_screening_receipt->>'populationCount')::integer is distinct from
         jsonb_array_length(new.project_screening_receipt->'population')
       or (new.project_screening_receipt->>'matchCount')::integer is distinct from
         jsonb_array_length(new.project_screening_receipt->'matches')
       or not ((new.project_screening_receipt->'matches') <@ (new.project_screening_receipt->'population'))
       or (new.project_screening_receipt->>'screenedAt')::timestamptz is distinct from new.project_screened_at
       or nullif(btrim(new.project_screening_receipt->>'basis'),'') is null then
      raise exception 'Project workflow completion requires a consistent screening population receipt';
    end if;
    if new.project_lesson_id is null or new.effectiveness is not null
       or new.physical_verified_at is null or new.physical_verified_by is null
       or new.project_implementation_evidence_id is null
       or new.causal_addressed_at is null or new.causal_addressed_by is null
       or new.project_causal_evidence_id is null
       or new.project_screened_at is null or new.project_screened_by is null
       or new.project_screening_receipt is null
       or (new.project_screening_receipt->>'standardRevisionId')::bigint is distinct from new.project_adopted_standard_id
       or (new.project_screening_receipt->>'lessonId')::uuid is distinct from new.project_lesson_id
       or (new.project_screening_receipt->>'actorId')::uuid is distinct from new.project_screened_by
       or not exists(select 1 from public.standard_work s join public.approvals a
         on a.id=s.revision_approval_id and a.standard_work_revision_id=s.id
           and a.organization_id=new.organization_id and a.status='approved'
         where s.id=new.project_adopted_standard_id and s.organization_id=new.organization_id
           and s.source_project_ca_id=new.id and a.approver_user_id is not null
           and a.decided_at is not null) then
      raise exception 'Project workflow completion requires evidenced stages, adopted standard and attributed screening';
    end if;
  end if;
  return new;
end $$;
create trigger project_workflow_completion_guard before insert or update on public.ca_verifications
  for each row execute function public.guard_project_workflow_completion();
revoke all on function public.guard_project_workflow_completion() from public,anon,authenticated;
notify pgrst, 'reload schema';
