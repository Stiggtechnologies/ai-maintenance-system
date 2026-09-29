-- Extend the canonical CA record. No project write RPC is exposed yet.
alter table public.ca_verifications
  alter column work_order_id drop not null,
  alter column asset_id drop not null,
  alter column observation_start drop not null,
  alter column observation_days drop not null,
  alter column effectiveness drop not null,
  add column project_lesson_id uuid,
  add column project_started_by uuid references auth.users(id) on delete restrict,
  add column project_start_basis text;

create unique index if not exists learning_events_org_identity
  on public.learning_events(organization_id, id);
alter table public.ca_verifications
  add constraint ca_project_lesson_tenant_fk
    foreign key (organization_id, project_lesson_id)
    references public.learning_events(organization_id, id) on delete restrict,
  add constraint ca_subject_exclusive check (
    (project_lesson_id is null and work_order_id is not null and asset_id is not null
     and observation_start is not null and observation_days is not null
     and effectiveness is not null
     and project_started_by is null and project_start_basis is null)
    or
    (project_lesson_id is not null and work_order_id is null and asset_id is null
     and observation_start is null and observation_days is null
     and effectiveness is null and effectiveness_evaluated_at is null
     and recurrence_wo_id is null and similar_assets_screened_at is null
     and similar_exposure is null and status = 'open'
     and project_started_by is not null
     and nullif(btrim(project_start_basis), '') is not null)
  );
create unique index ca_one_project_lesson
  on public.ca_verifications(project_lesson_id)
  where project_lesson_id is not null;

-- A project closure must point to an actual complete project lesson, not an
-- arbitrary learning event. Parent mutation cannot erase that meaning later.
create or replace function public.guard_project_ca_subject()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (old.project_lesson_id is not null or new.project_lesson_id is not null) and
     (new.organization_id is distinct from old.organization_id
      or new.project_lesson_id is distinct from old.project_lesson_id
      or new.work_order_id is distinct from old.work_order_id
      or new.asset_id is distinct from old.asset_id
      or new.project_started_by is distinct from old.project_started_by
      or new.project_start_basis is distinct from old.project_start_basis) then
    raise exception 'Corrective-action subject identity is immutable';
  end if;
  if new.project_lesson_id is not null then
    perform 1 from public.learning_events l
    where l.id = new.project_lesson_id and l.organization_id = new.organization_id
      and l.development_case_id is not null
      and nullif(btrim(l.cause), '') is not null
      and nullif(btrim(l.corrective_action), '') is not null
      and nullif(btrim(l.failure_mode_key), '') is not null
    for share;
    if not found then raise exception 'A complete same-tenant project lesson is required'; end if;
    if tg_op = 'INSERT' and not exists (select 1 from public.user_profiles p
      where p.id = new.project_started_by and p.organization_id = new.organization_id
        and p.role in ('admin','executive','maintenance_manager','reliability_engineer','planner')) then
      raise exception 'Project closure requires a named authorized human';
    end if;
  end if;
  return new;
end $$;
create trigger project_ca_subject_guard before insert or update
  on public.ca_verifications for each row execute function public.guard_project_ca_subject();

create or replace function public.guard_project_ca_source_lesson()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.ca_verifications c where c.project_lesson_id = old.id)
     and (new.organization_id is distinct from old.organization_id
       or new.development_case_id is distinct from old.development_case_id
       or new.failure_mode_key is distinct from old.failure_mode_key
       or new.cause is distinct from old.cause
       or new.corrective_action is distinct from old.corrective_action) then
    raise exception 'A lesson used by corrective-action closure retains its source facts';
  end if;
  return new;
end $$;
create trigger project_ca_source_lesson_guard before update on public.learning_events
  for each row execute function public.guard_project_ca_source_lesson();

revoke all on function public.guard_project_ca_subject() from public, anon, authenticated;
revoke all on function public.guard_project_ca_source_lesson() from public, anon, authenticated;

create or replace function public.attest_ca_stage(
  p_verification_id uuid,
  p_stage text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v ca_verifications%rowtype;
begin
  select * into v from ca_verifications
  where id = p_verification_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'verification not found');
  end if;

  if v.project_lesson_id is not null then
    return jsonb_build_object('error', 'Use the governed project closure stages');
  end if;

  if p_stage = 'physical' then
    update ca_verifications set physical_verified_at = now(),
      physical_verified_by = auth.uid(), physical_note = left(p_note, 1000)
    where id = v.id;
  elsif p_stage = 'causal' then
    update ca_verifications set causal_addressed_at = now(),
      causal_addressed_by = auth.uid(), causal_note = left(p_note, 1000)
    where id = v.id;
  elsif p_stage = 'strategy' then
    update ca_verifications set strategy_updated_at = now(),
      strategy_updated_by = auth.uid(), strategy_note = left(p_note, 1000)
    where id = v.id;
  else
    return jsonb_build_object('error', 'unknown stage; expected physical|causal|strategy');
  end if;

  -- all three attested -> observation phase
  update ca_verifications set status = 'observing'
  where id = v.id and status = 'open'
    and physical_verified_at is not null
    and causal_addressed_at is not null
    and strategy_updated_at is not null;

  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.screen_similar_assets(p_verification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v ca_verifications%rowtype;
  v_class text;
  v_exposure jsonb;
begin
  select * into v from ca_verifications
  where id = p_verification_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'verification not found');
  end if;

  if v.project_lesson_id is not null then
    return jsonb_build_object('error', 'Project closure requires future-project screening, not similar assets');
  end if;

  select asset_class into v_class from assets where id = v.asset_id;

  select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb) into v_exposure
  from (
    select a.tag,
           count(w.id) as same_mode_events,
           round(sum(w.downtime_hours)::numeric, 1) as downtime_hours
    from assets a
    join work_orders w on w.asset_id = a.id
      and w.work_type = 'corrective'
      and w.actual_failure_mode is not distinct from v.failure_mode
    where a.organization_id = v.organization_id
      and a.asset_class is not distinct from v_class
      and a.id <> v.asset_id
    group by a.tag
    order by count(w.id) desc
    limit 10
  ) e;

  update ca_verifications
  set similar_assets_screened_at = now(), similar_exposure = v_exposure
  where id = v.id;

  return jsonb_build_object('exposed_assets', v_exposure);
end
$$;

notify pgrst, 'reload schema';
