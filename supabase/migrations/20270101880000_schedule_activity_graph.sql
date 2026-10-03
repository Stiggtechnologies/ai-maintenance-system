-- D5.28 — expose both sides of P6 schedule logic without a second graph.
--
-- shutdown_task_dependencies already is the canonical relationship store used
-- by schedule quality and simulation. This read derives successors by walking
-- that same edge in reverse; it does not persist a second successor list that
-- could drift from the predecessor set P6 supplied.

create or replace function public.get_case_schedule_activity_graph(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_case_title text;
  v_activities jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select c.title into v_case_title
  from public.development_cases c
  where c.id = p_case_id
    and c.organization_id = v_org;

  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'activityId', t.id,
        'activityKey', t.task_key,
        'schedule', e.title,
        'predecessors', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'activityKey', d.predecessor_key,
              'linkType', d.link_type,
              'lagHours', d.lag_hours
            ) order by d.predecessor_key
          )
          from public.shutdown_task_dependencies d
          where d.event_id = t.event_id
            and d.task_key = t.task_key
        ), '[]'::jsonb),
        'successors', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'activityKey', d.task_key,
              'linkType', d.link_type,
              'lagHours', d.lag_hours
            ) order by d.task_key
          )
          from public.shutdown_task_dependencies d
          where d.event_id = t.event_id
            and d.predecessor_key = t.task_key
        ), '[]'::jsonb)
      ) order by e.title, t.task_key
    ),
    '[]'::jsonb
  ) into v_activities
  from public.shutdown_tasks t
  join public.shutdown_events e on e.id = t.event_id
  where e.organization_id = v_org
    and e.development_case_id = p_case_id;

  return jsonb_build_object(
    'answered', true,
    'caseId', p_case_id,
    'caseTitle', v_case_title,
    'activityCount', jsonb_array_length(v_activities),
    'activities', v_activities,
    'basis', 'Successors are the reverse view of shutdown_task_dependencies, the same canonical P6 relationship edges used by schedule quality and simulation. No successor copy is stored.'
  );
end
$$;

revoke all on function public.get_case_schedule_activity_graph(uuid)
  from public, anon, service_role;
grant execute on function public.get_case_schedule_activity_graph(uuid)
  to authenticated;

comment on function public.get_case_schedule_activity_graph(uuid) is
  'D5.28 (spec III.§22): returns each case schedule activity with predecessors and successors derived from the one canonical shutdown_task_dependencies edge set. Tenant-scoped by the case organization; never writes to P6 and never stores a second successor graph.';

notify pgrst, 'reload schema';
