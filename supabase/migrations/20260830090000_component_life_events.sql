-- ============================================================================
-- Component change-out history: operating hours, censoring, and symptoms
-- (register C7.01 censored life data, C7.07 age-replacement, C8.14 failure mode).
--
-- WHY THIS IS A NEW TABLE AND NOT A WORK ORDER.
--
-- A work order records that somebody did something on a date. A component
-- change-out records that a SPECIFIC COMPONENT reached a specific number of
-- OPERATING HOURS and was then either replaced because it failed or replaced
-- because it hit its interval. Those are different facts and the second one is
-- the one reliability maths needs:
--
--   * hours, not calendar. The platform's Weibull fits currently run on calendar
--     inter-arrivals because that is all work_orders carry. A dozer parked for a
--     month accrues calendar and no wear. These rows carry the meter.
--
--   * CENSORING. 157 of the 198 events in this dataset are scheduled
--     change-outs. Those components did NOT fail — they were removed at an
--     interval while still working, which makes each one a right-censored
--     observation. Treating them as failures would understate life badly;
--     discarding them would throw away 79% of the evidence. Only a censored fit
--     uses them correctly, and weibullMLE already accepts them.
--
--   * SYMPTOMS. The register's actual_failure_mode duplicates system_group in
--     all 8,504 coded rows, so it carries no mechanism information at all. These
--     rows carry free-text symptoms — "LEFT FRONT DRIVE CHAIN BROKEN. FOUND
--     CRACKED DRIVE GEAR", "duo cone seal is leaking", "HARD FAILURE OF TIMING
--     GEAR TRAIN". That is the first real mechanism data in the system.
--
-- WHERE IT LANDS.
--
-- The private operator organization, not the demo one. This is real fleet data
-- with real unit numbers and real failure narratives, and the demo org is the
-- public showcase.
--
-- Canonical reuse: assets, organizations, app_current_org(). Additive.
-- ============================================================================

create table if not exists component_life_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  -- Unit number as recorded in the source, kept even when the asset is unknown
  -- so an unmatched row is visible rather than dropped.
  unit_number text not null,
  component text not null,
  -- OEM functional location, e.g. 7310-POWRTRN-FNLDRV-FI. An ISO 14224-shaped
  -- hierarchy that the asset register does not otherwise hold.
  functional_location text,
  /* Operating hours ON THE COMPONENT at change-out. The quantity the whole
     table exists for. */
  hours_at_change_out numeric not null check (hours_at_change_out >= 0),
  /* The planned replacement interval this component was being run to. Makes
     every row an observation about whether the interval is right. */
  planned_interval_hours numeric,
  event_date date,
  /* failure    — the component was removed BECAUSE it failed.
     scheduled  — removed at interval while still working. RIGHT-CENSORED.
     other      — rebuild, retirement, warranty return. Neither, and must not be
                  silently counted as either. */
  event_kind text not null check (event_kind in ('failure','scheduled','other')),
  symptom text,
  work_order_ref text,
  source_file text not null,
  imported_at timestamptz not null default now(),
  unique(organization_id, unit_number, component, hours_at_change_out, event_kind)
);

create index if not exists idx_cle_component
  on component_life_events(organization_id, component, event_kind);

alter table component_life_events enable row level security;
drop policy if exists cle_read on component_life_events;
create policy cle_read on component_life_events
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Life data shaped for a CENSORED fit.
--
-- Returns failures and suspensions SEPARATELY, because the caller must not be
-- able to accidentally pool them. weibullMLE(failures, censored) is the only
-- correct consumer.
-- ---------------------------------------------------------------------------
drop function if exists get_component_life_data(text);
create or replace function get_component_life_data(p_component text default null)
returns table (
  component text,
  units bigint,
  "failureHours" numeric[],
  "censoredHours" numeric[],
  "otherHours" numeric[],
  "plannedIntervalHours" numeric,
  "censoredShare" numeric,
  basis text
)
language sql stable security definer set search_path = public as $$
  select e.component,
         count(distinct e.unit_number),
         array_agg(e.hours_at_change_out order by e.hours_at_change_out)
           filter (where e.event_kind = 'failure'),
         array_agg(e.hours_at_change_out order by e.hours_at_change_out)
           filter (where e.event_kind = 'scheduled'),
         array_agg(e.hours_at_change_out order by e.hours_at_change_out)
           filter (where e.event_kind = 'other'),
         max(e.planned_interval_hours),
         round(count(*) filter (where e.event_kind = 'scheduled')::numeric
               / nullif(count(*),0), 3),
         format(
           '%s event(s) on %s unit(s): %s failure(s), %s scheduled change-out(s) and '
           || '%s other. The scheduled ones are RIGHT-CENSORED — the component was '
           || 'working when it was removed — so they bound life from below and must '
           || 'be fitted as suspensions. Counting them as failures would understate '
           || 'life; discarding them would throw away %s%% of the evidence.',
           count(*), count(distinct e.unit_number),
           count(*) filter (where e.event_kind='failure'),
           count(*) filter (where e.event_kind='scheduled'),
           count(*) filter (where e.event_kind='other'),
           round(100.0 * count(*) filter (where e.event_kind='scheduled') / nullif(count(*),0)))
  from component_life_events e
  where e.organization_id = app_current_org()
    and (p_component is null or e.component = p_component)
  group by e.component
  order by count(*) desc;
$$;

grant execute on function get_component_life_data(text) to authenticated;

-- Symptoms per component: the mechanism evidence the register lacks. Grouped
-- so a reviewer sees recurring language rather than 198 individual strings.
drop function if exists get_component_symptoms(text);
create or replace function get_component_symptoms(p_component text default null)
returns table (component text, "failureEvents" bigint, symptoms jsonb)
language sql stable security definer set search_path = public as $$
  select e.component, count(*),
    jsonb_agg(jsonb_build_object(
      'unit', e.unit_number, 'hours', e.hours_at_change_out,
      'date', e.event_date, 'symptom', e.symptom
    ) order by e.hours_at_change_out)
  from component_life_events e
  where e.organization_id = app_current_org()
    and e.event_kind = 'failure'
    and coalesce(btrim(e.symptom),'') <> ''
    and (p_component is null or e.component = p_component)
  group by e.component
  order by count(*) desc;
$$;

grant execute on function get_component_symptoms(text) to authenticated;

notify pgrst, 'reload schema';
