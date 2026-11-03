-- C4.08: an authenticated client must not insert an already actioned
-- recommendation, including case and surrounding-whitespace variants of the
-- actioned statuses. The earlier restrictive policy compared the raw status
-- text, so 'Approved' and ' completed ' skipped it and also skipped the
-- update-only verification-plan trigger.
--
-- Privileged producers stay on their existing contracts: the trigger consults
-- current_user, which remains the function owner inside SECURITY DEFINER
-- writers and the migration role for historical imports. Ordinary pending
-- drafts remain insertable. A refused insert raises SQLSTATE 42501 and leaves
-- no row; it is not rewritten into an audit event, because the statement
-- rolls back. Successful plans and results continue to append audit_events
-- through record_recommendation_verification_plan and record_verification_result.
-- Neither this gate nor those writers authorizes plant execution or a
-- source-system write.

create or replace function public.enforce_recommendation_client_insert_not_actioned()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_user in ('authenticated','anon')
     and lower(btrim(coalesce(new.status,''))) in
       ('approved','released','scheduled','completed') then
    raise exception
      'an authenticated client cannot insert an already actioned recommendation'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_recommendation_client_insert_not_actioned()
  from public, anon, authenticated;
grant execute on function public.enforce_recommendation_client_insert_not_actioned()
  to authenticated, anon, service_role;

drop trigger if exists trg_recommendation_client_insert_not_actioned
  on public.recommendations;
create trigger trg_recommendation_client_insert_not_actioned
  before insert on public.recommendations
  for each row
  execute function public.enforce_recommendation_client_insert_not_actioned();

drop policy if exists recommendations_no_actioned_client_insert
  on public.recommendations;
create policy recommendations_no_actioned_client_insert
  on public.recommendations
  as restrictive for insert to authenticated
  with check (
    organization_id=public.app_current_org()
    and lower(btrim(coalesce(status,''))) not in
      ('approved','released','scheduled','completed')
  );

create or replace function public.enforce_recommendation_verification_plan_on_release()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status is distinct from old.status
     and lower(btrim(coalesce(new.status,''))) in ('approved','released','scheduled')
     and not public.recommendation_verification_plan_valid(new.organization_id,new.id) then
    raise exception
      'Approval requires an explicit verification method, acceptance criteria, outcome date at or after the action due date, and a named same-tenant human owner. SyncAI will not invent a +30-day verification date.';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_recommendation_verification_plan_on_release()
  from public, anon, authenticated;

drop trigger if exists trg_recommendation_verification_plan_on_release
  on public.recommendations;
create trigger trg_recommendation_verification_plan_on_release
  before update of status on public.recommendations
  for each row execute function public.enforce_recommendation_verification_plan_on_release();
