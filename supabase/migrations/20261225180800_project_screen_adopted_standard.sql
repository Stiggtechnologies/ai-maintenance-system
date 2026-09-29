-- Existing creation-time matcher preserved; add only the governed revision reference.
create or replace function public.screen_applicable_project_lessons(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_lessons jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_lessons
  from (
    select jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'failureModeKey', e.failure_mode_key,
      'cause', e.cause,
      'correctiveAction', e.corrective_action,
      'applicability', e.applicability,
      'sourceCaseId', e.development_case_id,
      'sourceLifecycleType', src.lifecycle_type,
      'matchReason', case
        when lower(coalesce(src.lifecycle_type, '')) = lower(c.lifecycle_type)
          then 'source case shares this lifecycle type'
        when position(lower(c.lifecycle_type) in lower(e.applicability)) > 0
          or position(replace(lower(c.lifecycle_type), '_', ' ') in lower(e.applicability)) > 0
          then 'applicability names this lifecycle type'
        else 'significant token overlap with the new case title or problem'
      end,
      'adoptedStandard', (
        select jsonb_build_object('id',sw.id,'workKey',sw.work_key,'version',sw.version,
          'title',sw.title,'changeSummary',sw.change_summary,'approvalId',a.id,
          'adoptedAt',a.decided_at,'adoptedBy',a.approver_user_id)
        from public.ca_verifications cv
        join public.standard_work sw on sw.id=cv.project_adopted_standard_id
          and sw.organization_id=v_org and sw.source_project_ca_id=cv.id
        join public.approvals a on a.id=sw.revision_approval_id
          and a.organization_id=v_org and a.standard_work_revision_id=sw.id
          and a.status='approved'
        where cv.project_lesson_id=e.id and cv.organization_id=v_org
      ),
      'createdAt', e.created_at
    ) as row_obj,
    e.created_at
    from learning_events e
    join development_cases src
      on src.id = e.development_case_id and src.organization_id = v_org
    where e.organization_id = v_org
      and e.event_type = 'lesson_learned'
      and e.failure_mode_key = any (sync_delivery_failure_types())
      and public.sync_lesson_applies_to_case(
        e.development_case_id, src.lifecycle_type, e.applicability,
        c.id, c.lifecycle_type, c.title, c.problem_statement)
  ) matched;

  return jsonb_build_object(
    'caseId', c.id,
    'lifecycleType', c.lifecycle_type,
    'count', jsonb_array_length(v_lessons),
    'lessons', v_lessons,
    'emptyReason', case
      when jsonb_array_length(v_lessons) = 0 then
        '0 applicable lessons — none of this organization''s recorded project lessons match this case''s lifecycle type or applicability text'
      else null
    end,
    'basis', 'Deterministic match on learning_events.applicability and source-case lifecycle_type. No score. A case is never screened against its own lessons.');
end
$$;
notify pgrst, 'reload schema';

