-- E3.04 — production-plan-level constraint and bottleneck analysis.
--
-- Restoration blockers, material/permit/isolation gates and the critical path
-- remain the recovery constraint model. This study is the missing plan-level
-- question: given one site horizon and one required quantity, which declared
-- limit binds, and which statements cannot be ranked.
--
-- Canonical reuse: sites, assets, production_records (coverage only),
-- operational_constraint_signals (optional provenance only), audit_events,
-- app_current_org() and app_current_role(). No second production ledger and
-- no production_plans table — that document belongs to the open production-plan
-- forecast work and is not on this chain. Demonstrated output is stored beside
-- the result and is never an input to the minimum. A binary signal state is
-- never converted into a rate. The study does not release work, change an
-- operating limit, adopt a plan, or forecast loss.
--
-- Ranking rule, also locked in src/lib/production-constraints/bottleneck.ts:
--   * no declared limit -> no_limits_declared (silence is not spare capacity)
--   * any unit other than the study unit -> mixed_units, and nothing is ranked
--   * any blank quantity -> unquantified_limit, and nothing is ranked
--   * otherwise the lowest limit is the bottleneck, ties included, ordered by
--     kind then key; binding means that minimum is below the required quantity
--   * limits are alternative ceilings and are not added together

create table if not exists public.production_constraint_studies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  title text not null check (length(btrim(title)) between 3 and 160),
  horizon_start timestamptz not null,
  horizon_end timestamptz not null,
  required_quantity numeric not null check (required_quantity > 0),
  unit_of_measure text not null check (length(btrim(unit_of_measure)) between 1 and 32),
  basis text not null check (length(btrim(basis)) between 20 and 2000),
  assessable boolean not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_study_id uuid references public.production_constraint_studies(id) on delete restrict,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (horizon_end > horizon_start),
  constraint production_constraint_studies_content_unique unique (organization_id, content_sha256)
);

create index if not exists idx_production_constraint_studies_recent
  on public.production_constraint_studies(organization_id, recorded_at desc);

create table if not exists public.production_constraint_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  study_id uuid not null references public.production_constraint_studies(id) on delete restrict,
  constraint_key text not null check (length(btrim(constraint_key)) between 1 and 80),
  constraint_kind text not null check (constraint_kind in (
    'equipment','upstream','downstream','utility','material',
    'workforce','quality','changeover','isolation','other'
  )),
  asset_id uuid references public.assets(id) on delete restrict,
  constraint_signal_id uuid references public.operational_constraint_signals(id) on delete restrict,
  available_quantity numeric check (available_quantity is null or available_quantity >= 0),
  unit_of_measure text not null check (length(btrim(unit_of_measure)) between 1 and 32),
  basis text not null check (length(btrim(basis)) between 20 and 2000),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  unique (study_id, constraint_key)
);

create index if not exists idx_production_constraint_limits_study
  on public.production_constraint_limits(organization_id, study_id);

alter table public.production_constraint_studies enable row level security;
alter table public.production_constraint_limits enable row level security;

drop policy if exists production_constraint_studies_org_read
  on public.production_constraint_studies;
create policy production_constraint_studies_org_read
  on public.production_constraint_studies
  for select to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists production_constraint_limits_org_read
  on public.production_constraint_limits;
create policy production_constraint_limits_org_read
  on public.production_constraint_limits
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke all on table public.production_constraint_studies
  from public, anon, authenticated, service_role;
revoke all on table public.production_constraint_limits
  from public, anon, authenticated, service_role;
grant select on table public.production_constraint_studies to authenticated;
grant select on table public.production_constraint_limits to authenticated;

create or replace function public.protect_production_constraint_studies()
returns trigger
language plpgsql
set search_path = public
as $body$
begin
  raise exception 'production constraint studies are append-only';
end
$body$;

revoke all on function public.protect_production_constraint_studies()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_production_constraint_studies
  on public.production_constraint_studies;
create trigger trg_protect_production_constraint_studies
  before update or delete on public.production_constraint_studies
  for each row execute function public.protect_production_constraint_studies();

drop trigger if exists trg_protect_production_constraint_limits
  on public.production_constraint_limits;
create trigger trg_protect_production_constraint_limits
  before update or delete on public.production_constraint_limits
  for each row execute function public.protect_production_constraint_studies();

create or replace function public.production_constraint_study_json(p_study_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $body$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'siteId', s.site_id,
    'siteName', site.name,
    'horizonStart', s.horizon_start,
    'horizonEnd', s.horizon_end,
    'requiredQuantity', s.required_quantity::text,
    'unitOfMeasure', s.unit_of_measure,
    'basis', s.basis,
    'assessable', s.assessable,
    'result', s.result,
    'supersedesStudyId', s.supersedes_study_id,
    'recordedBy', s.recorded_by,
    'recordedAt', s.recorded_at,
    'constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'key', l.constraint_key,
        'kind', l.constraint_kind,
        'assetId', l.asset_id,
        'assetTag', coalesce(nullif(a.asset_tag, ''), a.tag),
        'constraintSignalId', l.constraint_signal_id,
        'availableQuantity', l.available_quantity::text,
        'unitOfMeasure', l.unit_of_measure,
        'basis', l.basis,
        'provenance', l.provenance
      ) order by l.constraint_kind, l.constraint_key)
      from public.production_constraint_limits l
      left join public.assets a
        on a.id = l.asset_id
       and a.organization_id = s.organization_id
      where l.study_id = s.id
        and l.organization_id = s.organization_id
    ), '[]'::jsonb)
  )
  from public.production_constraint_studies s
  join public.sites site
    on site.id = s.site_id
   and site.organization_id = s.organization_id
  where s.id = p_study_id
    and s.organization_id = public.app_current_org()
$body$;

revoke all on function public.production_constraint_study_json(uuid)
  from public, anon;
grant execute on function public.production_constraint_study_json(uuid)
  to authenticated;

create or replace function public.record_production_constraint_study(
  p_title text,
  p_site_id uuid,
  p_horizon_start timestamptz,
  p_horizon_end timestamptz,
  p_required_quantity text,
  p_unit_of_measure text,
  p_basis text,
  p_constraints jsonb,
  p_supersedes_study_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_title text := btrim(coalesce(p_title, ''));
  v_unit text := btrim(coalesce(p_unit_of_measure, ''));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_required numeric;
  v_row record;
  v_element jsonb;
  v_key text;
  v_kind text;
  v_limit_unit text;
  v_limit_basis text;
  v_available_text text;
  v_asset uuid;
  v_signal uuid;
  v_asset_text text;
  v_signal_text text;
  v_signal_site uuid;
  v_signal_asset uuid;
  v_signal_asset_site uuid;
  v_signal_state text;
  v_signal_kind text;
  v_signal_key text;
  v_signal_basis text;
  v_seen jsonb := '{}'::jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_provenance jsonb;
  v_assessable boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_min numeric;
  v_primary text;
  v_keys jsonb := '[]'::jsonb;
  v_demo_count integer := 0;
  v_demo_sum numeric;
  v_result jsonb;
  v_hash text;
  v_existing uuid;
  v_id uuid;
  v_quantity_pattern constant text := '^((0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?)$';
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object('error', 'ai_admin cannot record a production constraint study');
  end if;
  if v_role not in (
    'operator','planner','supervisor','maintenance_manager',
    'plant_manager','operations_manager','admin'
  ) then
    return jsonb_build_object('error', 'a named operations or maintenance role is required');
  end if;
  if v_title = '' or char_length(v_title) > 160
     or char_length(v_basis) < 20 or char_length(v_basis) > 2000
     or char_length(v_unit) < 1 or char_length(v_unit) > 32
     or p_required_quantity is null
     or btrim(p_required_quantity) !~ v_quantity_pattern then
    return jsonb_build_object(
      'error',
      'title, evidence basis, unit and a positive required quantity are required'
    );
  end if;
  v_required := btrim(p_required_quantity)::numeric;
  if v_required <= 0 then
    return jsonb_build_object(
      'error',
      'title, evidence basis, unit and a positive required quantity are required'
    );
  end if;
  if p_horizon_start is null or p_horizon_end is null or p_horizon_end <= p_horizon_start then
    return jsonb_build_object('error', 'the horizon end must be after the horizon start');
  end if;
  if not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'site is outside the active tenant or does not exist');
  end if;
  if p_supersedes_study_id is not null and not exists (
    select 1 from public.production_constraint_studies prior
    where prior.id = p_supersedes_study_id and prior.organization_id = v_org
  ) then
    return jsonb_build_object(
      'error',
      'the study being superseded is outside the active tenant or does not exist'
    );
  end if;
  if jsonb_typeof(p_constraints) is distinct from 'array' then
    return jsonb_build_object('error', 'constraints must be a list');
  end if;
  if jsonb_array_length(p_constraints) > 40 then
    return jsonb_build_object('error', 'a study can record at most 40 limits');
  end if;

  for v_row in select value as item from jsonb_array_elements(p_constraints)
  loop
    v_element := v_row.item;
    if jsonb_typeof(v_element) is distinct from 'object' then
      return jsonb_build_object('error', 'each constraint must be an object');
    end if;
    v_key := btrim(coalesce(v_element->>'key', ''));
    v_kind := btrim(coalesce(v_element->>'kind', ''));
    v_limit_unit := btrim(coalesce(v_element->>'unitOfMeasure', ''));
    v_limit_basis := btrim(coalesce(v_element->>'basis', ''));
    v_available_text := nullif(btrim(coalesce(v_element->>'availableQuantity', '')), '');
    v_asset_text := nullif(btrim(coalesce(v_element->>'assetId', '')), '');
    v_signal_text := nullif(btrim(coalesce(v_element->>'constraintSignalId', '')), '');
    if char_length(v_key) < 1 or char_length(v_key) > 80 then
      return jsonb_build_object('error', 'each limit needs a key of 1 to 80 characters');
    end if;
    if v_seen ? v_key then
      return jsonb_build_object('error', 'constraint keys must be unique within the study');
    end if;
    v_seen := v_seen || jsonb_build_object(v_key, true);
    if v_kind not in (
      'equipment','upstream','downstream','utility','material',
      'workforce','quality','changeover','isolation','other'
    ) then
      return jsonb_build_object('error', 'unsupported constraint kind');
    end if;
    if char_length(v_limit_basis) < 20 or char_length(v_limit_basis) > 2000
       or char_length(v_limit_unit) < 1 or char_length(v_limit_unit) > 32 then
      return jsonb_build_object('error', 'each limit needs its own unit and a 20-character basis');
    end if;
    if v_available_text is not null and v_available_text !~ v_quantity_pattern then
      return jsonb_build_object(
        'error',
        'a stated quantity must be zero or positive, with at most 6 decimal places'
      );
    end if;
    if v_asset_text is not null and v_asset_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('error', 'asset id is not a uuid');
    end if;
    if v_signal_text is not null and v_signal_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('error', 'constraint signal id is not a uuid');
    end if;
    v_asset := v_asset_text::uuid;
    v_signal := v_signal_text::uuid;
    if v_asset is not null and not exists (
      select 1 from public.assets a
      where a.id = v_asset and a.organization_id = v_org and a.site_id = p_site_id
    ) then
      return jsonb_build_object(
        'error',
        'asset is outside the active tenant or does not belong to this site'
      );
    end if;
    v_signal_state := null;
    v_signal_kind := null;
    v_signal_key := null;
    v_signal_basis := null;
    if v_signal is not null then
      select s.site_id, s.asset_id, s.state, s.signal_kind, s.signal_key, s.basis
        into v_signal_site, v_signal_asset, v_signal_state, v_signal_kind, v_signal_key, v_signal_basis
      from public.operational_constraint_signals s
      where s.id = v_signal and s.organization_id = v_org;
      if not found then
        return jsonb_build_object(
          'error',
          'constraint signal is outside the active tenant or does not apply to this site'
        );
      end if;
      v_signal_asset_site := null;
      if v_signal_asset is not null then
        select a.site_id into v_signal_asset_site
        from public.assets a
        where a.id = v_signal_asset and a.organization_id = v_org;
      end if;
      if (v_signal_site is not null and v_signal_site is distinct from p_site_id)
         or (v_signal_asset is not null and v_signal_asset_site is distinct from p_site_id)
         or (v_asset is not null and v_signal_asset is not null and v_signal_asset is distinct from v_asset) then
        return jsonb_build_object(
          'error',
          'constraint signal is outside the active tenant or does not apply to this site'
        );
      end if;
    end if;
    v_provenance := jsonb_build_object(
      'signalState', v_signal_state,
      'signalKind', v_signal_kind,
      'signalKey', v_signal_key,
      'signalBasis', v_signal_basis,
      'stateConvertedToQuantity', false
    );
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'kind', v_kind,
      'unit', v_limit_unit,
      'available', v_available_text,
      'assetId', v_asset,
      'signalId', v_signal,
      'basis', v_limit_basis,
      'provenance', v_provenance
    ));
  end loop;

  select coalesce(jsonb_agg(item order by item->>'key'), '[]'::jsonb)
    into v_sorted
  from jsonb_array_elements(v_clean) item;

  if jsonb_array_length(v_sorted) = 0 then
    v_assessable := false;
    v_reasons := jsonb_build_array('no_limits_declared');
  else
    if exists (
      select 1 from jsonb_array_elements(v_sorted) item
      where item->>'unit' is distinct from v_unit
    ) then
      v_assessable := false;
      v_reasons := v_reasons || jsonb_build_array('mixed_units');
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_sorted) item
      where item->>'available' is null
    ) then
      v_assessable := false;
      v_reasons := v_reasons || jsonb_build_array('unquantified_limit');
    end if;
  end if;

  if v_assessable then
    select min((item->>'available')::numeric) into v_min
    from jsonb_array_elements(v_sorted) item;
    select item->>'key' into v_primary
    from jsonb_array_elements(v_sorted) item
    where (item->>'available')::numeric = v_min
    order by item->>'kind', item->>'key'
    limit 1;
    select coalesce(jsonb_agg(item->>'key' order by item->>'kind', item->>'key'), '[]'::jsonb)
      into v_keys
    from jsonb_array_elements(v_sorted) item
    where (item->>'available')::numeric = v_min;
  end if;

  select count(*)::integer, sum(p.units_produced)
    into v_demo_count, v_demo_sum
  from public.production_records p
  left join public.assets a
    on a.id = p.asset_id
   and a.organization_id = v_org
  where p.organization_id = v_org
    and p.unit_of_measure = v_unit
    and p.period_start < p_horizon_end
    and p.period_end > p_horizon_start
    and (
      p.site_id = p_site_id
      or (p.site_id is null and a.site_id = p_site_id)
    );

  v_result := jsonb_build_object(
    'assessable', v_assessable,
    'reasons', v_reasons,
    'method', 'tightest_declared_limit',
    'limitsAreAdditive', false,
    'bottleneckKeys', case when v_assessable then v_keys else '[]'::jsonb end,
    'primaryKey', case when v_assessable then to_jsonb(v_primary) else 'null'::jsonb end,
    'availableQuantity', case when v_assessable then to_jsonb(v_min::text) else 'null'::jsonb end,
    'headroom', case when v_assessable then to_jsonb((v_min - v_required)::text) else 'null'::jsonb end,
    'binding', case when v_assessable then to_jsonb(v_min < v_required) else 'null'::jsonb end,
    'demonstratedOutput', case when v_demo_count > 0 then to_jsonb(v_demo_sum::text) else 'null'::jsonb end,
    'demonstratedRecordCount', v_demo_count,
    'demonstratedOutputUsedAsCapacity', false,
    'releasesWork', false,
    'changesOperatingLimit', false,
    'forecastsLoss', false
  );

  v_hash := encode(extensions.digest(convert_to(concat_ws(E'\n',
    p_site_id::text,
    to_char(p_horizon_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(p_horizon_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    v_required::text,
    v_unit,
    v_title,
    v_basis,
    coalesce(p_supersedes_study_id::text, ''),
    v_sorted::text
  ), 'UTF8'), 'sha256'), 'hex');

  select id into v_existing
  from public.production_constraint_studies
  where organization_id = v_org and content_sha256 = v_hash;
  if v_existing is not null then
    return jsonb_build_object(
      'recorded', true,
      'idempotent', true,
      'study', public.production_constraint_study_json(v_existing)
    );
  end if;

  begin
    insert into public.production_constraint_studies(
      organization_id, site_id, title, horizon_start, horizon_end,
      required_quantity, unit_of_measure, basis, assessable, result,
      content_sha256, supersedes_study_id, recorded_by
    ) values (
      v_org, p_site_id, v_title, p_horizon_start, p_horizon_end,
      v_required, v_unit, v_basis, v_assessable, v_result,
      v_hash, p_supersedes_study_id, auth.uid()
    ) returning id into v_id;

    insert into public.production_constraint_limits(
      organization_id, study_id, constraint_key, constraint_kind, asset_id,
      constraint_signal_id, available_quantity, unit_of_measure, basis, provenance
    )
    select
      v_org,
      v_id,
      item->>'key',
      item->>'kind',
      nullif(item->>'assetId', '')::uuid,
      nullif(item->>'signalId', '')::uuid,
      (item->>'available')::numeric,
      item->>'unit',
      item->>'basis',
      item->'provenance'
    from jsonb_array_elements(v_sorted) item;

    insert into public.audit_events(organization_id, entity_type, actor, event_data)
    values (
      v_org,
      'production_constraint_study',
      v_role,
      jsonb_build_object(
        'action', 'recorded',
        'study_id', v_id,
        'site_id', p_site_id,
        'assessable', v_assessable,
        'reasons', v_reasons,
        'primary_key', v_primary,
        'supersedes_study_id', p_supersedes_study_id,
        'actor_id', auth.uid(),
        'releases_work', false,
        'changes_operating_limit', false,
        'forecasts_loss', false
      )
    );

    return jsonb_build_object(
      'recorded', true,
      'idempotent', false,
      'study', public.production_constraint_study_json(v_id)
    );
  exception
    when unique_violation then
      if sqlerrm not like '%production_constraint_studies_content_unique%' then
        raise;
      end if;
      select id into v_existing
      from public.production_constraint_studies
      where organization_id = v_org and content_sha256 = v_hash;
      if v_existing is null then
        return jsonb_build_object('error', 'could not record the constraint study');
      end if;
      return jsonb_build_object(
        'recorded', true,
        'idempotent', true,
        'study', public.production_constraint_study_json(v_existing)
      );
  end;
end
$body$;

revoke all on function public.record_production_constraint_study(
  text, uuid, timestamptz, timestamptz, text, text, text, jsonb, uuid
) from public, anon, service_role;
grant execute on function public.record_production_constraint_study(
  text, uuid, timestamptz, timestamptz, text, text, text, jsonb, uuid
) to authenticated;

create or replace function public.get_production_constraint_studies()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_studies jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(q.item order by q.recorded_at desc), '[]'::jsonb)
    into v_studies
  from (
    select
      s.recorded_at,
      public.production_constraint_study_json(s.id) as item
    from public.production_constraint_studies s
    where s.organization_id = v_org
    order by s.recorded_at desc
    limit 25
  ) q
  where q.item is not null;

  return jsonb_build_object(
    'studies', coalesce(v_studies, '[]'::jsonb),
    'method', 'The bottleneck is the lowest declared limit in the study unit. Declared limits are alternative ceilings and are not added together.',
    'authority', 'Recording a bottleneck does not release work, change an operating limit, adopt a production plan, or forecast loss.'
  );
end
$body$;

revoke all on function public.get_production_constraint_studies()
  from public, anon, service_role;
grant execute on function public.get_production_constraint_studies()
  to authenticated;
