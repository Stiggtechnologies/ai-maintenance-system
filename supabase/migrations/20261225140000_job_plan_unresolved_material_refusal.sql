-- ============================================================================
-- C8.07: upsert_job_plan must not silently drop unresolved material lines.
--
-- 20260811090000 inserted a material line only when material_code resolved
-- and otherwise continued. The draft was saved, the planner's line was gone,
-- and the success payload did not say so. This replaces that function.
--
-- A non-blank code that is not in this organization's materials catalogue
-- refuses the call before any write. The database does not invent a catalogue
-- row. Blank lines carry no code and are skipped. adopt_job_plan and
-- apply_job_plan are unchanged: adoption stays a named-human act, and only
-- an adopted plan may be applied to a work order.
-- ============================================================================

create or replace function public.upsert_job_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
  v_key text := p_plan->>'plan_key';
  v_status text := null;
  it jsonb;
  v_mat uuid;
  v_code text;
  v_unresolved text[] := array[]::text[];
  v_n int := 0;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'authoring a job plan requires a planning or engineering role');
  end if;
  if v_key is null or p_plan->>'title' is null or p_plan->>'scope' is null then
    return jsonb_build_object('error', 'plan_key, title and scope are required');
  end if;

  -- The insert below conflicts on (organization_id, plan_key, version) and
  -- does not set version, so it always hits version 1. Refuse an adopted
  -- row before that write. Revising an adopted plan as a new version is
  -- still not a product act.
  select status into v_status
  from job_plans
  where organization_id = v_org and plan_key = v_key and version = 1;
  if v_status is not null and v_status <> 'draft' then
    return jsonb_build_object('error',
      'this plan is adopted — revise it as a new version rather than editing an adopted plan');
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb)) loop
    v_code := it->>'material_code';
    if v_code is null or btrim(v_code) = '' then
      continue;
    end if;
    if not exists (
      select 1 from materials
      where organization_id = v_org and material_code = v_code
    ) then
      if v_code <> all (v_unresolved) then
        v_unresolved := array_append(v_unresolved, v_code);
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_unresolved, 1), 0) > 0 then
    return jsonb_build_object('error', format(
      'unresolved material code(s) refused; nothing was saved: %s. Add each code to the material catalogue first. This call does not create catalogue rows.',
      array_to_string(v_unresolved, ', ')));
  end if;

  insert into job_plans (organization_id, plan_key, title, scope,
    applies_to_asset_class, applies_to_system_group, basis, created_by)
  values (v_org, v_key, p_plan->>'title', p_plan->>'scope',
    p_plan->>'applies_to_asset_class', p_plan->>'applies_to_system_group',
    p_plan->>'basis', auth.uid())
  on conflict (organization_id, plan_key, version) do update
    set title = excluded.title, scope = excluded.scope,
        applies_to_asset_class = excluded.applies_to_asset_class,
        applies_to_system_group = excluded.applies_to_system_group,
        basis = excluded.basis
  returning id into v_id;

  -- Backstop if the row stopped being a draft between the pre-check and
  -- the write. Raising rolls the header change back; returning jsonb would
  -- commit it.
  if (select status from job_plans where id = v_id) <> 'draft' then
    raise exception
      'this plan is adopted — revise it as a new version rather than editing an adopted plan';
  end if;

  delete from job_plan_steps where job_plan_id = v_id;
  delete from job_plan_materials where job_plan_id = v_id;
  delete from job_plan_tools where job_plan_id = v_id;
  delete from job_plan_permits where job_plan_id = v_id;
  delete from job_plan_checks where job_plan_id = v_id;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'steps', '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into job_plan_steps (organization_id, job_plan_id, step_number,
      description, craft, crew_size, estimated_hours)
    values (v_org, v_id, coalesce((it->>'step_number')::int, v_n),
      it->>'description', it->>'craft',
      coalesce((it->>'crew_size')::int, 1), (it->>'estimated_hours')::numeric);
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb)) loop
    v_code := it->>'material_code';
    if v_code is null or btrim(v_code) = '' then
      continue;
    end if;
    -- Clear first so a miss cannot reuse the previous material id.
    v_mat := null;
    select id into v_mat from materials
    where organization_id = v_org and material_code = v_code;
    if v_mat is null then
      raise exception
        'unresolved material code(s) refused; nothing was saved: %. Add each code to the material catalogue first. This call does not create catalogue rows.',
        v_code;
    end if;
    insert into job_plan_materials (organization_id, job_plan_id, material_id, qty)
    values (v_org, v_id, v_mat, coalesce((it->>'qty')::numeric, 1))
    on conflict (job_plan_id, material_id) do update set qty = excluded.qty;
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'tools', '[]'::jsonb)) loop
    insert into job_plan_tools (organization_id, job_plan_id, tool, note)
    values (v_org, v_id, it->>'tool', it->>'note');
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'permits', '[]'::jsonb)) loop
    insert into job_plan_permits (organization_id, job_plan_id, permit_type,
      isolation_required, verification_note)
    values (v_org, v_id, it->>'permit_type', it->>'isolation_required', it->>'verification_note');
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'checks', '[]'::jsonb)) loop
    insert into job_plan_checks (organization_id, job_plan_id, check_description,
      acceptance_criterion, is_hold_point)
    values (v_org, v_id, it->>'check_description', it->>'acceptance_criterion',
      coalesce((it->>'is_hold_point')::boolean, false));
  end loop;

  return jsonb_build_object('job_plan_id', v_id, 'plan_key', v_key,
    'steps', (select count(*) from job_plan_steps where job_plan_id = v_id),
    'status', 'draft');
end
$$;

revoke all on function public.upsert_job_plan(jsonb) from public, anon;
grant execute on function public.upsert_job_plan(jsonb) to authenticated;
