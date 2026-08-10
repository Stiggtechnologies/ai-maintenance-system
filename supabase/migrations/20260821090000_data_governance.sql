-- ============================================================================
-- Data governance (register E12.03–E12.06, E12.09, E12.11–E12.13).
--
-- Everything the rest of this platform computes rests on the asset register
-- being able to say what is what. A real finding from this very database makes
-- the point better than any argument:
--
--   All 144 assets in the operator fleet have NO TAG and NO SERIAL NUMBER.
--   Their identity is a free-text name — "Dozer 5390" — which is a label a
--   person reads, not a key a system can join on.
--
-- That single fact bounds what every integration with that register can ever
-- achieve, and no analysis downstream can recover it. get_identity_posture()
-- reports it rather than letting it be discovered during an integration.
--
-- WHY DUPLICATES ARE CANDIDATES AND NEVER MERGES. The same machine entered
-- twice splits its history in half, and half a history fits a Weibull
-- perfectly well while being wrong. But a WRONG merge destroys two histories
-- and is far more expensive to undo than a missed one, so this follows the
-- same pattern as the interdependency slice: propose, never act.
--
-- Canonical reuse: assets, sensors, condition_readings, taxonomy_definitions
-- and failure_code_map from the failure-coding slice, connectors and
-- ingest_watermarks from the ingestion slice, app_current_org(). Additive.
-- ============================================================================

-- E12.03 — who owns each domain of data. Ownership with no named person is
-- how a data-quality problem becomes everybody's and therefore nobody's.
create table if not exists data_domains (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_key text not null,
  label text not null,
  description text,
  owner_role text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  steward_role text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ddom_key
  on data_domains(organization_id, domain_key);

-- E12.04 — data-quality service levels, and whether they are being met.
create table if not exists data_quality_slas (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_id bigint references data_domains(id) on delete set null,
  metric text not null check (metric in
    ('completeness', 'timeliness', 'validity', 'uniqueness', 'consistency')),
  target_pct numeric check (target_pct > 0 and target_pct <= 100),
  target_lag_hours numeric check (target_lag_hours >= 0),
  measured_pct numeric check (measured_pct >= 0 and measured_pct <= 100),
  measured_lag_hours numeric,
  measured_on date,
  basis text,
  created_at timestamptz not null default now(),
  -- A target for a percentage metric and a target for a lag are different
  -- things; requiring at least one stops a row that promises nothing.
  check (target_pct is not null or target_lag_hours is not null)
);

create index if not exists idx_dqsla on data_quality_slas(organization_id, metric);

-- E12.05 / E12.06 — sensor validation rules and instrument calibration.
create table if not exists sensor_validation_rules (
  sensor_id uuid primary key references sensors(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  min_value numeric,
  max_value numeric,
  -- Beyond these the reading is not unusual, it is impossible: the instrument.
  physical_min numeric,
  physical_max numeric,
  max_rate_per_hour numeric check (max_rate_per_hour > 0),
  stuck_after_readings int check (stuck_after_readings > 1),
  created_at timestamptz not null default now()
);

create table if not exists instrument_calibrations (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  sensor_id uuid references sensors(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  instrument_ref text not null,
  calibrated_on date,
  interval_months int check (interval_months > 0),
  -- As-found matters more than as-left: it says what the instrument was
  -- telling you for the whole interval before somebody adjusted it.
  as_found_within_tolerance boolean,
  as_left_within_tolerance boolean,
  certificate_reference text,
  created_at timestamptz not null default now()
);

create index if not exists idx_instcal
  on instrument_calibrations(organization_id, sensor_id, calibrated_on desc);

-- E12.11 — historian tags to platform context. The mapping that is usually
-- in one person's spreadsheet.
create table if not exists historian_tag_map (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  historian_tag text not null,
  asset_id uuid references assets(id) on delete set null,
  sensor_id uuid references sensors(id) on delete set null,
  measurement text,
  unit text,
  -- Whether a person has confirmed this mapping or it was inferred.
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  source_system text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_histmap
  on historian_tag_map(organization_id, historian_tag);

-- E12.12 — duplicate candidates. Proposed, never merged.
create table if not exists duplicate_asset_candidates (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_a uuid not null references assets(id) on delete cascade,
  asset_b uuid not null references assets(id) on delete cascade,
  confidence text not null check (confidence in ('certain', 'probable', 'possible')),
  basis text not null,
  status text not null default 'open' check (status in
    ('open', 'confirmed_duplicate', 'confirmed_distinct')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (asset_a <> asset_b)
);

create unique index if not exists idx_dupcand
  on duplicate_asset_candidates(organization_id, asset_a, asset_b);

-- E12.13 — archived and obsolete information.
create table if not exists archive_records (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  record_class text not null,
  reference text not null,
  archived_on date not null default current_date,
  -- Superseded is not the same as wrong, and neither is the same as deleted.
  disposition text not null check (disposition in
    ('archived', 'superseded', 'obsolete', 'destroyed')),
  superseded_by text,
  retention_until date,
  reason text,
  created_at timestamptz not null default now(),
  check (disposition <> 'superseded' or superseded_by is not null)
);

create index if not exists idx_archrec on archive_records(organization_id, disposition);

alter table data_domains enable row level security;
alter table data_quality_slas enable row level security;
alter table sensor_validation_rules enable row level security;
alter table instrument_calibrations enable row level security;
alter table historian_tag_map enable row level security;
alter table duplicate_asset_candidates enable row level security;
alter table archive_records enable row level security;
drop policy if exists ddom_read on data_domains;
create policy ddom_read on data_domains for select to authenticated
  using (organization_id = app_current_org());
drop policy if exists dqsla_read on data_quality_slas;
create policy dqsla_read on data_quality_slas for select to authenticated
  using (organization_id = app_current_org());
drop policy if exists svr_read on sensor_validation_rules;
create policy svr_read on sensor_validation_rules for select to authenticated
  using (organization_id = app_current_org());
drop policy if exists instcal_read on instrument_calibrations;
create policy instcal_read on instrument_calibrations for select to authenticated
  using (organization_id = app_current_org());
drop policy if exists histmap_read on historian_tag_map;
create policy histmap_read on historian_tag_map for select to authenticated
  using (organization_id = app_current_org());
drop policy if exists dupcand_read on duplicate_asset_candidates;
create policy dupcand_read on duplicate_asset_candidates for select to authenticated
  using (organization_id = app_current_org());
drop policy if exists archrec_read on archive_records;
create policy archrec_read on archive_records for select to authenticated
  using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The identity finding. This is the headline.
-- ---------------------------------------------------------------------------
drop function if exists get_identity_posture();
create or replace function get_identity_posture()
returns table (
  assets_total bigint,
  with_tag bigint,
  with_serial bigint,
  with_stable_id bigint,
  name_only bigint,
  domains_defined bigint,
  slas_defined bigint,
  slas_breaching bigint,
  sensors_total bigint,
  sensors_with_rules bigint,
  calibrations_overdue bigint,
  historian_tags_mapped bigint,
  historian_tags_unconfirmed bigint,
  open_duplicate_candidates bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  a as (
    select count(*)::bigint n,
           count(*) filter (where tag is not null and btrim(tag) <> '')::bigint tags,
           count(*) filter (where serial_number is not null
                              and btrim(serial_number) <> '')::bigint serials,
           count(*) filter (where (tag is not null and btrim(tag) <> '')
                              or (serial_number is not null
                                  and btrim(serial_number) <> ''))::bigint stable
    from assets where organization_id = (select id from org)
  ),
  d as (select count(*)::bigint n from data_domains where organization_id = (select id from org)),
  q as (
    select count(*)::bigint n,
           count(*) filter (where (target_pct is not null and measured_pct is not null
                                   and measured_pct < target_pct)
                              or (target_lag_hours is not null and measured_lag_hours is not null
                                  and measured_lag_hours > target_lag_hours))::bigint breach
    from data_quality_slas where organization_id = (select id from org)
  ),
  s as (
    select count(*)::bigint n,
           count(*) filter (where exists (select 1 from sensor_validation_rules r
                                          where r.sensor_id = sn.id))::bigint ruled
    from sensors sn where sn.organization_id = (select id from org)
  ),
  c as (
    select count(*) filter (where interval_months is not null
                              and (calibrated_on is null
                                   or calibrated_on < current_date
                                      - (interval_months || ' months')::interval))::bigint n
    from instrument_calibrations where organization_id = (select id from org)
  ),
  h as (
    select count(*)::bigint n,
           count(*) filter (where confirmed_at is null)::bigint unconfirmed
    from historian_tag_map where organization_id = (select id from org)
  ),
  dup as (
    select count(*) filter (where status = 'open')::bigint n
    from duplicate_asset_candidates where organization_id = (select id from org)
  )
  select a.n, a.tags, a.serials, a.stable, (a.n - a.stable), d.n, q.n, q.breach,
         s.n, s.ruled, c.n, h.n, h.unconfirmed, dup.n,
    btrim(
    case
      when a.n = 0 then 'No assets are recorded.'
      when a.stable = 0 then
        'NONE of the ' || a.n || ' assets carries a tag or a serial number. Their identity is a '
        || 'free-text name, which is a label a person reads and not a key a system can join on — '
        || 'rename one and every downstream reference breaks silently. This bounds what any '
        || 'integration with this register can ever achieve, and no analysis downstream can '
        || 'recover it.'
      when a.stable < a.n then
        (a.n - a.stable) || ' of ' || a.n || ' assets have no tag and no serial number and can only '
        || 'be matched on a free-text name.'
      else
        'All ' || a.n || ' assets carry a tag or serial number, so every one can be joined on a '
        || 'stable key.'
    end
    || case when s.n > s.ruled then ' ' || (s.n - s.ruled) || ' of ' || s.n
            || ' sensor(s) have no validation rule, so a stuck or impossible reading from them '
            || 'reaches the health score unchallenged.' else '' end
    || case when c.n > 0 then ' ' || c.n
            || ' instrument calibration(s) are overdue.' else '' end
    || case when h.unconfirmed > 0 then ' ' || h.unconfirmed || ' of ' || h.n
            || ' historian tag mapping(s) have never been confirmed by a person.' else '' end
    || case when d.n = 0 then ' No data domain has a named owner, which is how a data-quality '
            || 'problem becomes everybody''s and therefore nobody''s.' else '' end
    || case when q.breach > 0 then ' ' || q.breach || ' of ' || q.n
            || ' data-quality service level(s) are being missed.' else '' end)
  from a, d, q, s, c, h, dup;
$$;

grant execute on function get_identity_posture() to authenticated;

-- Assets shaped for the duplicate detector and identity assessor.
create or replace function get_asset_identities(p_limit int default 500)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(x.row), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', id, 'name', name, 'tag', tag, 'serialNumber', serial_number,
      'assetClass', asset_class, 'siteId', site_id) row
    from assets
    where organization_id = app_current_org()
    order by name
    limit greatest(1, least(p_limit, 2000))
  ) x;
$$;

grant execute on function get_asset_identities(int) to authenticated;

-- Sensor readings with their rules, for the validator.
create or replace function get_sensor_validation()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sensorName', sn.name, 'assetName', ast.name, 'unit', sn.unit,
    'rule', jsonb_build_object(
      'minValue', r.min_value, 'maxValue', r.max_value,
      'physicalMin', r.physical_min, 'physicalMax', r.physical_max,
      'maxRatePerHour', r.max_rate_per_hour,
      'stuckAfterReadings', r.stuck_after_readings),
    -- condition_readings uses taken_at, and only 'good'/'suspect' rows are
    -- worth validating: 'bad' has already been judged upstream.
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.taken_at, 'value', h.value)
                       order by h.taken_at)
      from (
        select cr.taken_at, cr.value
        from condition_readings cr
        where cr.sensor_id = sn.id and cr.quality in ('good', 'suspect')
        order by cr.taken_at desc
        limit 20
      ) h
    ), '[]'::jsonb)) order by ast.name, sn.name), '[]'::jsonb)
  from sensors sn
  join sensor_validation_rules r on r.sensor_id = sn.id
  left join assets ast on ast.id = sn.asset_id
  where sn.organization_id = app_current_org();
$$;

grant execute on function get_sensor_validation() to authenticated;

notify pgrst, 'reload schema';
