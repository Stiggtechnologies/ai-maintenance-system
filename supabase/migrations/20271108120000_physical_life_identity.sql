-- C7.14 physical-life identity at capture.
--
-- The legacy unique key is organization, unit, component, removal hours and
-- event kind. Two different physical lives on the same asset can share that
-- exposure, and the key cannot tell an exact retry from a second life. This
-- migration does not create a second life store. It adds one optional identity
-- on the canonical component_life_events row:
--
--   * a null identity keeps the legacy exposure key and the existing refusal;
--   * an explicit identity is unique inside the tenant;
--   * the same identity with the same source facts is an idempotent retry;
--   * the same identity with different source facts is refused;
--   * an included covariate lifeRef must equal the identity captured here.
--
-- Historical rows stay null. Measured hours, assets and event kinds are not
-- rewritten to make a collision fit.

alter table public.component_life_events
  add column if not exists physical_life_ref text;

alter table public.component_life_events
  drop constraint if exists cle_physical_life_ref_shape;

alter table public.component_life_events
  add constraint cle_physical_life_ref_shape check (
    physical_life_ref is null
    or (
      length(physical_life_ref) between 2 and 160
      and physical_life_ref = btrim(physical_life_ref)
      and physical_life_ref !~ '[[:cntrl:]]'
    )
  );

create unique index if not exists cle_legacy_exposure_identity
  on public.component_life_events (
    organization_id, unit_number, component, hours_at_change_out, event_kind
  )
  where physical_life_ref is null;

create unique index if not exists cle_physical_life_ref_unique
  on public.component_life_events (organization_id, physical_life_ref)
  where physical_life_ref is not null;

do $$
declare
  r record;
  v_dropped integer := 0;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'component_life_events'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) like '%hours_at_change_out%'
      and pg_get_constraintdef(con.oid) not like '%physical_life_ref%'
  loop
    execute 'alter table public.component_life_events drop constraint '
      || quote_ident(r.conname);
    v_dropped := v_dropped + 1;
  end loop;
  if v_dropped <> 1 then
    raise exception
      'Expected exactly one legacy component-life exposure constraint, dropped %',
      v_dropped;
  end if;
end $$;

create or replace function public.guard_survival_life_overlay()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Moves of an ungoverned legacy row must serialize BOTH populations.
  -- Deterministic order prevents cross-tenant service moves inverting locks.
  if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
    perform pg_advisory_xact_lock(hashtextextended(x.org::text || ':survival-life-population', 0))
      from (values (old.organization_id), (new.organization_id)) as x(org)
      order by x.org;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    (case when tg_op = 'DELETE' then old.organization_id else new.organization_id end)::text
      || ':survival-life-population', 0));
  if tg_op = 'DELETE' then
    if old.survival_overlay is not null and pg_trigger_depth() = 1 then
      raise exception 'Governed physical life evidence is retained; do not delete its canonical event';
    end if;
    return old;
  end if;
  if new.physical_life_ref is not null and (
    length(new.physical_life_ref) not between 2 and 160
    or new.physical_life_ref <> btrim(new.physical_life_ref)
    or new.physical_life_ref ~ '[[:cntrl:]]'
  ) then
    raise exception 'Physical life identity must contain 2–160 characters and no control characters';
  end if;
  if tg_op = 'UPDATE' and new.physical_life_ref is distinct from old.physical_life_ref then
    raise exception 'Physical life identity is fixed at capture';
  end if;
  if new.physical_life_ref is not null
     and jsonb_typeof(new.survival_overlay) = 'object'
     and new.survival_overlay->>'mode' = 'include'
     and btrim(coalesce(new.survival_overlay->>'lifeRef', '')) is distinct from new.physical_life_ref then
    raise exception 'Included life reference must equal the physical life identity captured with this event';
  end if;
  if tg_op = 'UPDATE' and old.survival_overlay is not null and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.asset_id is distinct from old.asset_id
    or new.unit_number is distinct from old.unit_number
    or new.component is distinct from old.component
    or new.hours_at_change_out is distinct from old.hours_at_change_out
    or new.event_kind is distinct from old.event_kind
    or new.event_date is distinct from old.event_date
    or new.source_file is distinct from old.source_file
    or new.source_basis is distinct from old.source_basis
  ) then
    raise exception 'Physical life source facts are frozen once covariates are governed; record corrected source evidence separately';
  end if;
  if coalesce(current_setting('app.survival_overlay_writer', true), '') <> 'granted' and (
    (tg_op = 'INSERT' and (
      new.survival_overlay is not null
      or new.survival_version <> 0
      or new.survival_status <> 'unrecorded'
      or new.survival_recorded_by is not null
      or new.survival_recorded_at is not null
      or new.survival_reviewed_by is not null
      or new.survival_reviewed_at is not null
      or new.survival_approval_id is not null
      or new.survival_evidence_snapshot is not null))
    or (tg_op = 'UPDATE' and (
      new.survival_overlay is distinct from old.survival_overlay
      or new.survival_version is distinct from old.survival_version
      or new.survival_status is distinct from old.survival_status
      or new.survival_recorded_by is distinct from old.survival_recorded_by
      or new.survival_recorded_at is distinct from old.survival_recorded_at
      or new.survival_reviewed_by is distinct from old.survival_reviewed_by
      or new.survival_reviewed_at is distinct from old.survival_reviewed_at
      or new.survival_approval_id is distinct from old.survival_approval_id
      or new.survival_evidence_snapshot is distinct from old.survival_evidence_snapshot))
  ) then
    raise exception 'Use the governed covariate capture and independent review RPCs';
  end if;
  return new;
end
$$;

revoke all on function public.guard_survival_life_overlay()
  from public, anon, authenticated, service_role;

drop function if exists public.record_component_life_event(
  uuid, text, numeric, text, date, numeric, text, text, text, text
);

create function public.record_component_life_event(
  p_asset_id uuid,
  p_component text,
  p_hours_at_change_out numeric,
  p_event_kind text,
  p_event_date date,
  p_planned_interval_hours numeric default null,
  p_symptom text default null,
  p_work_order_ref text default null,
  p_source_file text default 'manual entry',
  p_source_basis text default null,
  p_physical_life_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_asset public.assets%rowtype;
  v_existing public.component_life_events%rowtype;
  v_ref text;
  v_component text;
  v_symptom text;
  v_work_order text;
  v_source_file text;
  v_source_basis text;
  v_id bigint;
  v_classification text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('reliability_engineer', 'admin') then
    return jsonb_build_object(
      'error',
      'recording governed component life data requires a named reliability engineer or administrator'
    );
  end if;
  select * into v_asset
  from public.assets
  where id = p_asset_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'asset not found');
  end if;
  v_component := btrim(p_component);
  if coalesce(length(v_component), 0) not between 2 and 160 then
    return jsonb_build_object('error', 'component must contain 2–160 characters');
  end if;
  if p_hours_at_change_out is null or p_hours_at_change_out <= 0 then
    return jsonb_build_object('error', 'operating hours at removal must be positive');
  end if;
  if p_event_kind not in ('failure', 'scheduled', 'other') then
    return jsonb_build_object('error', 'event kind must be failure, scheduled or other');
  end if;
  if p_event_date is null or p_event_date > current_date then
    return jsonb_build_object('error', 'event date is required and cannot be in the future');
  end if;
  if p_planned_interval_hours is not null and p_planned_interval_hours <= 0 then
    return jsonb_build_object('error', 'planned interval must be positive when recorded');
  end if;
  v_source_file := btrim(p_source_file);
  v_source_basis := btrim(p_source_basis);
  if coalesce(length(v_source_file), 0) < 2 or coalesce(length(v_source_basis), 0) < 10 then
    return jsonb_build_object(
      'error',
      'record a source reference and evidence basis of at least 10 characters'
    );
  end if;
  v_symptom := nullif(btrim(coalesce(p_symptom, '')), '');
  v_work_order := nullif(btrim(coalesce(p_work_order_ref, '')), '');
  if p_physical_life_ref is null then
    v_ref := null;
  else
    v_ref := btrim(p_physical_life_ref);
    if length(v_ref) not between 2 and 160 or v_ref ~ '[[:cntrl:]]' then
      return jsonb_build_object(
        'error',
        'physical life identity must contain 2–160 characters and no control characters'
      );
    end if;
  end if;
  v_classification := case
    when p_event_kind = 'scheduled' then 'right_censored'
    when p_event_kind = 'failure' then 'failure'
    else 'excluded_from_fit'
  end;

  -- Same lock the life-event trigger takes. Hold it before reading a row so
  -- the identity check and the insert cannot interleave with another writer.
  perform pg_advisory_xact_lock(
    hashtextextended(v_org::text || ':survival-life-population', 0)
  );

  if v_ref is not null then
    select * into v_existing
    from public.component_life_events
    where organization_id = v_org and physical_life_ref = v_ref;
    if found then
      if v_existing.asset_id is not distinct from v_asset.id
         and v_existing.component = v_component
         and v_existing.hours_at_change_out = p_hours_at_change_out
         and v_existing.event_kind = p_event_kind
         and v_existing.event_date is not distinct from p_event_date
         and v_existing.planned_interval_hours is not distinct from p_planned_interval_hours
         and v_existing.symptom is not distinct from v_symptom
         and v_existing.work_order_ref is not distinct from v_work_order
         and v_existing.source_file = v_source_file
         and v_existing.source_basis = v_source_basis then
        insert into public.audit_events(organization_id, entity_type, actor, event_data)
        values (
          v_org,
          'component_life_event',
          v_role,
          jsonb_build_object(
            'action', 'replayed',
            'event_id', v_existing.id,
            'asset_id', v_asset.id,
            'component', v_component,
            'event_kind', p_event_kind,
            'physical_life_ref', v_ref,
            'classification', v_classification,
            'idempotent', true,
            'recorded_by', auth.uid(),
            'operationalAuthorization', false
          )
        );
        return jsonb_build_object(
          'event_id', v_existing.id,
          'component', v_component,
          'event_kind', p_event_kind,
          'classification', v_classification,
          'idempotent', true,
          'physical_life_ref', v_ref
        );
      end if;
      return jsonb_build_object(
        'error',
        'this physical life is already recorded with different source facts'
      );
    end if;
  end if;

  insert into public.component_life_events (
    organization_id, asset_id, unit_number, component, functional_location,
    hours_at_change_out, planned_interval_hours, event_date, event_kind, symptom,
    work_order_ref, source_file, recorded_by, source_basis, physical_life_ref
  )
  values (
    v_org,
    v_asset.id,
    coalesce(nullif(v_asset.asset_tag, ''), nullif(v_asset.tag, ''), v_asset.id::text),
    v_component,
    null,
    p_hours_at_change_out,
    p_planned_interval_hours,
    p_event_date,
    p_event_kind,
    v_symptom,
    v_work_order,
    v_source_file,
    auth.uid(),
    v_source_basis,
    v_ref
  )
  returning id into v_id;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'component_life_event',
    v_role,
    jsonb_build_object(
      'action', 'recorded',
      'event_id', v_id,
      'asset_id', v_asset.id,
      'component', v_component,
      'event_kind', p_event_kind,
      'physical_life_ref', v_ref,
      'classification', v_classification,
      'idempotent', false,
      'recorded_by', auth.uid(),
      'operationalAuthorization', false
    )
  );
  return jsonb_build_object(
    'event_id', v_id,
    'component', v_component,
    'event_kind', p_event_kind,
    'classification', v_classification,
    'idempotent', false,
    'physical_life_ref', v_ref
  );
exception
  when unique_violation then
    if v_ref is not null then
      return jsonb_build_object(
        'error',
        'this physical life is already recorded with different source facts'
      );
    end if;
    return jsonb_build_object('error', 'this component life event is already recorded');
end
$$;

revoke all on function public.record_component_life_event(
  uuid, text, numeric, text, date, numeric, text, text, text, text, text
) from public, anon;

grant execute on function public.record_component_life_event(
  uuid, text, numeric, text, date, numeric, text, text, text, text, text
) to authenticated;

comment on function public.record_component_life_event(
  uuid, text, numeric, text, date, numeric, text, text, text, text, text
) is
  'Named-human component life capture. A null physical-life identity keeps the legacy exposure refusal. An explicit identity is tenant-unique, exact retries are idempotent, and differing facts are refused. Advisory only.';

-- Annotate the existing survival source with the captured identity. A missing
-- join refuses the whole population; it does not return a smaller cohort.
alter function public.get_survival_source_internal(uuid, uuid, text)
  rename to get_survival_source_before_physical_life_internal;

revoke all on function public.get_survival_source_before_physical_life_internal(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function public.get_survival_source_internal(
  p_organization_id uuid,
  p_actor_id uuid,
  p_component text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_events jsonb;
  v_expected integer;
  v_joined integer;
begin
  v := public.get_survival_source_before_physical_life_internal(
    p_organization_id, p_actor_id, p_component
  );
  if v ? 'error' then
    return v;
  end if;
  if jsonb_typeof(v->'events') is distinct from 'array' then
    return jsonb_build_object(
      'error',
      'Complete life-event population is missing; no partial source is returned'
    );
  end if;
  v_expected := jsonb_array_length(v->'events');
  select coalesce(
      jsonb_agg(
        e || jsonb_build_object('physicalLifeRef', cle.physical_life_ref)
        order by (e->>'id')::bigint
      ),
      '[]'::jsonb
    ),
    count(*)::integer
    into v_events, v_joined
  from jsonb_array_elements(v->'events') as e
  join public.component_life_events cle
    on cle.organization_id = p_organization_id
   and cle.id = (e->>'id')::bigint;
  if v_joined is distinct from v_expected
     or jsonb_array_length(v_events) is distinct from v_expected then
    return jsonb_build_object(
      'error',
      'Physical-life identity could not be joined to every canonical life event; no partial population is returned'
    );
  end if;
  return jsonb_set(v, '{events}', v_events);
end
$$;

revoke all on function public.get_survival_source_internal(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_survival_source_internal(uuid, uuid, text)
  to service_role;

comment on column public.component_life_events.physical_life_ref is
  'Explicit physical-life identity captured with the event. Null preserves the legacy exposure key. It is not an OEM serial, a life limit, or authority to act.';

notify pgrst, 'reload schema';
