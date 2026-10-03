-- ============================================================================
-- U3.04 — governed distributed-network populations and unit-time exposure.
--
-- Canonical reuse: asset_populations is the population identity;
-- population_failure_events is the event store; evidence_items and
-- audit_events remain the ONE evidence and audit models. The new observation
-- period is the missing denominator noun: it records zero-failure exposure as
-- well as exposure surrounding events, so rates are not fabricated from the
-- current unit count.
-- ============================================================================

alter table public.asset_populations
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid,
  add column if not exists recorded_by uuid references auth.users(id);

create unique index if not exists asset_populations_org_identity
  on public.asset_populations(organization_id, id);

create table if not exists public.population_observation_periods (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  population_id bigint not null,
  observed_from timestamptz not null,
  observed_to timestamptz not null,
  units_exposed numeric not null check (
    units_exposed > 0 and units_exposed < 'Infinity'::numeric
  ),
  basis text not null check (length(btrim(basis)) >= 20),
  evidence_item_id uuid not null,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (observed_to > observed_from),
  unique (organization_id, id),
  foreign key (organization_id, population_id)
    references public.asset_populations(organization_id, id) on delete cascade,
  foreign key (organization_id, evidence_item_id)
    references public.evidence_items(organization_id, id) on delete restrict
);

create index if not exists idx_population_observation_periods_lookup
  on public.population_observation_periods(
    organization_id, population_id, observed_from, observed_to
  );

alter table public.population_failure_events
  add column if not exists observation_period_id bigint,
  add column if not exists evidence_item_id uuid,
  add column if not exists recorded_by uuid references auth.users(id);

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_populations_evidence_tenant_fk'
      and conrelid = 'public.asset_populations'::regclass
  ) then
    alter table public.asset_populations
      add constraint asset_populations_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'population_failure_population_tenant_fk'
      and conrelid = 'public.population_failure_events'::regclass
  ) then
    alter table public.population_failure_events
      add constraint population_failure_population_tenant_fk
      foreign key (organization_id, population_id)
      references public.asset_populations(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'population_failure_period_tenant_fk'
      and conrelid = 'public.population_failure_events'::regclass
  ) then
    alter table public.population_failure_events
      add constraint population_failure_period_tenant_fk
      foreign key (organization_id, observation_period_id)
      references public.population_observation_periods(organization_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'population_failure_evidence_tenant_fk'
      and conrelid = 'public.population_failure_events'::regclass
  ) then
    alter table public.population_failure_events
      add constraint population_failure_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;
end
$migration$;

alter table public.population_observation_periods enable row level security;
drop policy if exists population_observation_periods_read
  on public.population_observation_periods;
create policy population_observation_periods_read
  on public.population_observation_periods
  for select to authenticated
  using (organization_id = public.app_current_org());

comment on table public.population_observation_periods is
  'U3.04 canonical population denominator periods. Non-overlapping windows retain unit-time exposure, including windows with zero failures; they grant no condition, reliability, work or approval authority.';
comment on column public.asset_populations.evidence_item_id is
  'Verified canonical non-asset-specific evidence supporting the population definition. Legacy rows remain nullable; governed customer writes require it.';
comment on column public.population_failure_events.observation_period_id is
  'Canonical exposure window containing the aggregate failure occurrence. Legacy events remain nullable; governed writes require it.';

create or replace function public.enforce_asset_population_tenant_links()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.site_id is not null and not exists (
    select 1 from public.sites s
    where s.id = new.site_id and s.organization_id = new.organization_id
  ) then
    raise exception 'asset population site crosses the tenant boundary'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_asset_population_tenant_links()
  from public, anon, authenticated;
drop trigger if exists trg_asset_population_tenant_links
  on public.asset_populations;
create trigger trg_asset_population_tenant_links
  before insert or update of organization_id, site_id
  on public.asset_populations
  for each row execute function public.enforce_asset_population_tenant_links();

create or replace function public.record_asset_population(
  p_site_id uuid,
  p_population_code text,
  p_description text,
  p_unit_count integer,
  p_members_individually_tracked boolean,
  p_install_period_start date,
  p_install_period_end date,
  p_basis text,
  p_evidence_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_uid uuid := auth.uid();
  v_population_id bigint;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error',
      'recording an asset population requires a named same-tenant reliability engineering, maintenance management, or administrator role; AI identities cannot establish population truth');
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'site not found in this organization');
  end if;
  if coalesce(length(btrim(p_population_code)), 0) < 3
     or length(btrim(p_population_code)) > 80 then
    return jsonb_build_object('error', 'population code must contain 3 to 80 characters');
  end if;
  if coalesce(length(btrim(p_description)), 0) < 10 then
    return jsonb_build_object('error', 'population description must identify the distributed asset group');
  end if;
  if p_unit_count is null or p_unit_count <= 0 then
    return jsonb_build_object('error', 'population unit count must be positive');
  end if;
  if p_install_period_start is not null and p_install_period_end is not null
     and p_install_period_end < p_install_period_start then
    return jsonb_build_object('error', 'installation period end cannot precede its start');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'population basis must state the source and limitations (20 characters minimum)');
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id and e.organization_id = v_org
      and e.asset_id is null
      and e.verification_status = 'verified'
      and e.evidence_class in ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
  ) then
    return jsonb_build_object('error',
      'population creation requires verified same-tenant non-asset-specific measured, inspected, documented, or expert-judgement evidence');
  end if;

  begin
    insert into public.asset_populations (
      organization_id, site_id, population_code, description, unit_count,
      members_individually_tracked, install_period_start, install_period_end,
      basis, evidence_item_id, recorded_by
    ) values (
      v_org, p_site_id, btrim(p_population_code), btrim(p_description), p_unit_count,
      coalesce(p_members_individually_tracked, false), p_install_period_start,
      p_install_period_end, btrim(p_basis), p_evidence_item_id, v_uid
    ) returning id into v_population_id;
  exception when unique_violation then
    return jsonb_build_object('error', 'population code already exists in this organization');
  end;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'asset_population', v_role, jsonb_build_object(
    'population_id', v_population_id, 'site_id', p_site_id,
    'population_code', btrim(p_population_code), 'unit_count', p_unit_count,
    'members_individually_tracked', coalesce(p_members_individually_tracked, false),
    'evidence_item_id', p_evidence_item_id, 'recorded_by', v_uid,
    'boundary', 'Population identity and count do not establish exposure, condition, a failure rate, work, a recommendation or approval.'));

  return jsonb_build_object(
    'population_id', v_population_id, 'population_code', btrim(p_population_code),
    'status', 'recorded',
    'note', 'Population identity recorded from verified evidence. Unit-time exposure remains a separate governed record.');
end
$$;

create or replace function public.record_population_observation_period(
  p_population_id bigint,
  p_observed_from timestamptz,
  p_observed_to timestamptz,
  p_units_exposed numeric,
  p_basis text,
  p_evidence_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_uid uuid := auth.uid();
  v_population public.asset_populations%rowtype;
  v_period_id bigint;
  v_unit_years numeric;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'recording population exposure requires a named authorized human role');
  end if;

  select * into v_population from public.asset_populations
  where id = p_population_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'asset population not found in this organization');
  end if;
  if p_observed_from is null or p_observed_to is null
     or p_observed_to <= p_observed_from or p_observed_to > now() then
    return jsonb_build_object('error', 'observation period must be a completed positive interval');
  end if;
  if p_units_exposed is null or p_units_exposed <= 0
     or p_units_exposed >= 'Infinity'::numeric then
    return jsonb_build_object('error', 'units exposed must be positive and finite');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'exposure basis must state the source and limitations (20 characters minimum)');
  end if;
  if exists (
    select 1 from public.population_observation_periods p
    where p.organization_id = v_org and p.population_id = v_population.id
      and p.observed_from < p_observed_to
      and p.observed_to > p_observed_from
  ) then
    return jsonb_build_object('error',
      'observation period overlaps existing exposure; correct the canonical period instead of double-counting unit-time');
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id and e.organization_id = v_org
      and e.asset_id is null and e.verification_status = 'verified'
      and e.evidence_class in ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
  ) then
    return jsonb_build_object('error', 'exposure requires applicable verified same-tenant non-AI evidence');
  end if;

  insert into public.population_observation_periods (
    organization_id, population_id, observed_from, observed_to,
    units_exposed, basis, evidence_item_id, recorded_by
  ) values (
    v_org, v_population.id, p_observed_from, p_observed_to,
    p_units_exposed, btrim(p_basis), p_evidence_item_id, v_uid
  ) returning id into v_period_id;

  v_unit_years := p_units_exposed
    * extract(epoch from (p_observed_to - p_observed_from))
    / (365.25 * 24 * 60 * 60);

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'population_observation_period', v_role, jsonb_build_object(
    'observation_period_id', v_period_id, 'population_id', v_population.id,
    'observed_from', p_observed_from, 'observed_to', p_observed_to,
    'units_exposed', p_units_exposed, 'unit_years', v_unit_years,
    'evidence_item_id', p_evidence_item_id, 'recorded_by', v_uid,
    'boundary', 'Exposure is a denominator, including zero-failure time; it does not itself establish reliability, condition, work, a recommendation or approval.'));

  return jsonb_build_object(
    'observation_period_id', v_period_id, 'population_id', v_population.id,
    'unit_years', v_unit_years, 'status', 'recorded',
    'note', 'Unit-time exposure recorded; failure count remains a separate evidence-backed observation.');
end
$$;

create or replace function public.record_population_failure_event(
  p_population_id bigint,
  p_observation_period_id bigint,
  p_occurred_at timestamptz,
  p_failure_count integer,
  p_failure_mode text,
  p_note text,
  p_evidence_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_uid uuid := auth.uid();
  v_period public.population_observation_periods%rowtype;
  v_event_id bigint;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'recording a population failure requires a named authorized human role');
  end if;

  select * into v_period from public.population_observation_periods
  where id = p_observation_period_id and organization_id = v_org
    and population_id = p_population_id;
  if not found then
    return jsonb_build_object('error', 'observation period not found for this population and organization');
  end if;
  -- Observation windows are half-open [from, to). This prevents an event on
  -- an abutting boundary from being counted in both periods.
  if p_occurred_at is null or p_occurred_at < v_period.observed_from
     or p_occurred_at >= v_period.observed_to then
    return jsonb_build_object('error', 'failure occurrence must fall inside its half-open observation period');
  end if;
  if p_failure_count is null or p_failure_count <= 0 then
    return jsonb_build_object('error', 'failure count must be positive');
  end if;
  if coalesce(length(btrim(p_failure_mode)), 0) < 3 then
    return jsonb_build_object('error', 'failure mode must identify the observed loss of function');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'failure note must state the observation and limitations');
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id and e.organization_id = v_org
      and e.asset_id is null and e.verification_status = 'verified'
      and e.evidence_class in ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'HISTORICAL', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
  ) then
    return jsonb_build_object('error', 'failure event requires applicable verified same-tenant non-AI evidence');
  end if;

  insert into public.population_failure_events (
    organization_id, population_id, observation_period_id, occurred_at,
    failure_count, failure_mode, note, evidence_item_id, recorded_by
  ) values (
    v_org, p_population_id, v_period.id, p_occurred_at,
    p_failure_count, btrim(p_failure_mode), btrim(p_note), p_evidence_item_id, v_uid
  ) returning id into v_event_id;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'population_failure_event', v_role, jsonb_build_object(
    'failure_event_id', v_event_id, 'population_id', p_population_id,
    'observation_period_id', v_period.id, 'occurred_at', p_occurred_at,
    'failure_count', p_failure_count, 'failure_mode', btrim(p_failure_mode),
    'evidence_item_id', p_evidence_item_id, 'recorded_by', v_uid,
    'boundary', 'An aggregate event count does not identify individual failed members or establish cause, condition, work, a recommendation or approval.'));

  return jsonb_build_object(
    'failure_event_id', v_event_id, 'population_id', p_population_id,
    'observation_period_id', v_period.id, 'status', 'recorded',
    'note', 'Aggregate failure observation recorded without inventing individual member identity or causal attribution.');
end
$$;

revoke all on function public.record_asset_population(uuid, text, text, integer, boolean, date, date, text, uuid)
  from public, anon;
revoke all on function public.record_population_observation_period(bigint, timestamptz, timestamptz, numeric, text, uuid)
  from public, anon;
revoke all on function public.record_population_failure_event(bigint, bigint, timestamptz, integer, text, text, uuid)
  from public, anon;

grant execute on function public.record_asset_population(uuid, text, text, integer, boolean, date, date, text, uuid)
  to authenticated;
grant execute on function public.record_population_observation_period(bigint, timestamptz, timestamptz, numeric, text, uuid)
  to authenticated;
grant execute on function public.record_population_failure_event(bigint, bigint, timestamptz, integer, text, text, uuid)
  to authenticated;

comment on function public.record_asset_population(uuid, text, text, integer, boolean, date, date, text, uuid) is
  'U3.04 governed distributed-network population identity from verified canonical evidence; no rate or operational authority.';
comment on function public.record_population_observation_period(bigint, timestamptz, timestamptz, numeric, text, uuid) is
  'U3.04 governed non-overlapping unit-time exposure, including zero-failure windows; 365.25-day calendar-year conversion is disclosed.';
comment on function public.record_population_failure_event(bigint, bigint, timestamptz, integer, text, text, uuid) is
  'U3.04 governed aggregate failure observation inside a canonical exposure period; no invented member identity or causal claim.';

notify pgrst, 'reload schema';
