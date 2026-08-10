-- ============================================================================
-- Demo data-governance records, Fort McMurray demo organization only.
--
-- ILLUSTRATIVE, DEMO-prefixed. The private operator organization gets nothing,
-- and its identity posture already reports the real and more important
-- finding: 144 assets with no tag and no serial number.
--
-- Validation rules are seeded for three real demo sensors so the validator can
-- be seen working, including one rule tight enough that a genuine reading
-- trips it — because a validator that never fires proves nothing.
-- ============================================================================
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  r record;
  n int := 0;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from data_domains where organization_id = v_org) then return; end if;

  insert into data_domains (organization_id, domain_key, label, description,
    owner_role, steward_role)
  values
    (v_org, 'asset_register', 'DEMO — Asset register',
     'Tags, hierarchy, classes and criticality.', 'Reliability engineering', 'Planner'),
    (v_org, 'work_history', 'DEMO — Work history',
     'Work orders, failure coding and labour.', 'Maintenance superintendent', 'Planner'),
    (v_org, 'condition_data', 'DEMO — Condition and process data',
     'Sensors, historian tags and readings.', 'Control systems', 'Instrument technician');

  insert into data_quality_slas (organization_id, domain_id, metric, target_pct,
    measured_pct, measured_on, basis)
  select v_org, d.id, v.metric, v.target, v.measured, current_date - 1, v.basis
  from data_domains d
  join (values
    ('asset_register', 'completeness', 95, 62,
     'DEMO — proportion of assets with class, criticality and site populated.'),
    ('work_history', 'validity', 90, 93,
     'DEMO — proportion of corrective work orders carrying a mapped failure code.'),
    ('condition_data', 'timeliness', 99, 99,
     'DEMO — readings arriving within the expected interval.')
  ) as v(domain_key, metric, target, measured, basis) on v.domain_key = d.domain_key
  where d.organization_id = v_org;

  -- Validation rules on three real demo sensors.
  for r in
    select id, name from sensors where organization_id = v_org order by name limit 3
  loop
    n := n + 1;
    insert into sensor_validation_rules (sensor_id, organization_id, min_value,
      max_value, physical_min, physical_max, max_rate_per_hour, stuck_after_readings)
    values (r.id, v_org,
      case n when 1 then 0 when 2 then 0 else 0 end,
      case n when 1 then 100 when 2 then 80 else 120 end,
      -10, 500, 25, 4)
    on conflict (sensor_id) do nothing;
  end loop;

  insert into instrument_calibrations (organization_id, sensor_id, instrument_ref,
    calibrated_on, interval_months, as_found_within_tolerance,
    as_left_within_tolerance, certificate_reference)
  select v_org, sn.id, 'DEMO-CAL-' || row_number() over (order by sn.name),
         current_date - 500, 12, false, true, 'DEMO — cert on file'
  from sensors sn where sn.organization_id = v_org order by sn.name limit 2;

  insert into historian_tag_map (organization_id, historian_tag, asset_id, sensor_id,
    measurement, unit, source_system, confirmed_at, confirmed_by)
  select v_org, 'DEMO.PI.' || upper(replace(sn.name, ' ', '_')), sn.asset_id, sn.id,
         sn.signal_type, sn.unit, 'DEMO — PI historian',
         case when row_number() over (order by sn.name) = 1 then now() else null end,
         null
  from sensors sn where sn.organization_id = v_org order by sn.name limit 4;

  insert into archive_records (organization_id, record_class, reference,
    disposition, superseded_by, retention_until, reason)
  values
    (v_org, 'procedure', 'DEMO — SOP-114 rev B', 'superseded', 'DEMO — SOP-114 rev C',
     current_date + 2555, 'DEMO — superseded at the last strategy review.'),
    (v_org, 'drawing', 'DEMO — P-101-GA rev B', 'superseded', 'DEMO — P-101-GA rev C',
     current_date + 3650, 'DEMO — replaced after the aux filter red-line.');
end $$;
