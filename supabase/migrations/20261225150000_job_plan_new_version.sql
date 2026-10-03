-- ============================================================================
-- C8.07: revising an adopted job plan is a draft, not an in-place edit.
--
-- upsert_job_plan (20260811090000, replaced 20261225140000) always wrote
-- version 1. Once that row was adopted, the function refused with "revise it
-- as a new version" and then offered no way to do so. This replacement does.
--
-- as_new_version inserts the next version as status 'draft'. The adopted row
-- is not updated, not superseded, and not applied. adopt_job_plan remains the
-- named-human act that supersedes the previous adopted version. apply_job_plan
-- is untouched and still refuses a draft. This is not plant execute.
--
-- An open draft for the same plan key is updated instead of spawning a second
-- draft. An ordinary save (no as_new_version) still refuses when the only
-- rows are non-drafts. Unresolved material codes still refuse the call before
-- any write, and this function still does not create catalogue rows.
-- ============================================================================

do $$
declare
  v_dup int;
begin
  select count(*) into v_dup from (
    select organization_id, plan_key
    from job_plans
    where status = 'draft'
    group by organization_id, plan_key
    having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception
      'job_plans already has more than one draft for a plan key; refusing to add job_plans_one_open_draft';
  end if;
end $$;

create unique index if not exists job_plans_one_open_draft
  on public.job_plans (organization_id, plan_key)
  where status = 'draft';

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
  v_revise boolean := coalesce(p_plan->'as_new_version' = 'true'::jsonb, false);
  v_max int;
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

  -- Refuse unresolved codes before any write. Blank lines are empty form
  -- rows, not planner intent. A miss does not create a catalogue row.
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

  -- Serialize revisions of this key. The second caller waits, then sees the
  -- draft the first caller committed, and updates it instead of inserting
  -- another version.
  perform 1 from job_plans
  where organization_id = v_org and plan_key = v_key
  for update;

  select id into v_id
  from job_plans
  where organization_id = v_org and plan_key = v_key and status = 'draft'
  order by version desc
  limit 1;

  if v_id is not null then
    -- One open draft per plan key. Revise and ordinary save both land here
    -- when that draft already exists; the adopted row is not the target.
    update job_plans
    set title = p_plan->>'title',
        scope = p_plan->>'scope',
        applies_to_asset_class = p_plan->>'applies_to_asset_class',
        applies_to_system_group = p_plan->>'applies_to_system_group',
        basis = p_plan->>'basis'
    where id = v_id and organization_id = v_org and status = 'draft';
    if not found then
      raise exception
        'this plan is adopted — revise it as a new version rather than editing an adopted plan';
    end if;
  else
    select coalesce(max(version), 0) into v_max
    from job_plans
    where organization_id = v_org and plan_key = v_key;

    if v_max > 0 and not v_revise then
      return jsonb_build_object('error',
        'this plan is adopted — revise it as a new version rather than editing an adopted plan');
    end if;

    insert into job_plans (
      organization_id, plan_key, title, scope,
      applies_to_asset_class, applies_to_system_group, basis,
      version, status, created_by)
    values (
      v_org, v_key, p_plan->>'title', p_plan->>'scope',
      p_plan->>'applies_to_asset_class', p_plan->>'applies_to_system_group',
      p_plan->>'basis', v_max + 1, 'draft', auth.uid())
    returning id into v_id;
  end if;

  -- Backstop before children are replaced. Raising rolls the header back.
  if (select status from job_plans where id = v_id and organization_id = v_org)
       is distinct from 'draft' then
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

  return jsonb_build_object(
    'job_plan_id', v_id,
    'plan_key', v_key,
    'version', (select version from job_plans where id = v_id),
    'steps', (select count(*) from job_plan_steps where job_plan_id = v_id),
    'status', 'draft');
end
$$;

revoke all on function public.upsert_job_plan(jsonb) from public, anon;
grant execute on function public.upsert_job_plan(jsonb) to authenticated;

notify pgrst, 'reload schema';
