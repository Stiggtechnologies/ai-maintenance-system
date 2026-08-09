-- ============================================================================
-- Demo process-safety register for the Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA, prefixed DEMO- throughout. The private operator
-- organization gets nothing and its posture line correctly reports that no
-- safety-critical elements are registered.
--
-- The shape demonstrates:
--   * a barrier with NO performance standard, which is not counted as one
--   * two preventive barriers that both depend on instrument air, so they
--     cannot fail independently
--   * an open impairment with no approved deviation, which the extended
--     safety gate refuses to approve work against
--   * a SIF overdue for proof test by enough to cross a SIL band
--   * an unassessed CRITICAL integrity-window exceedance
-- ============================================================================
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_site uuid; v_k201 uuid; v_p101 uuid;
  v_haz bigint; v_trip bigint; v_esd bigint; v_psv bigint; v_proc bigint; v_bund bigint;
  v_iow bigint; v_grp bigint;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from safety_critical_elements where organization_id = v_org) then return; end if;

  select id into v_site from sites where organization_id = v_org limit 1;
  select id into v_k201 from assets where organization_id = v_org and tag = 'K-201';
  select id into v_p101 from assets where organization_id = v_org and tag = 'P-101';

  insert into safety_critical_elements (organization_id, asset_id, sce_ref, label,
    barrier_kind, barrier_role, performance_standard, test_interval_months, last_tested_on)
  values
    (v_org, v_k201, 'DEMO-SCE-01', 'High-pressure trip', 'instrumented', 'preventive',
     'DEMO — trips within 2 s of 1.05x design pressure; proof tested annually.', 12,
     current_date - 400),
    (v_org, v_k201, 'DEMO-SCE-02', 'Emergency shutdown valve', 'instrumented', 'preventive',
     'DEMO — closes within 5 s on ESD signal.', 12, current_date - 100),
    (v_org, v_k201, 'DEMO-SCE-03', 'Pressure safety valve', 'mechanical', 'mitigative',
     'DEMO — relieves at set pressure, tested per API 510.', 60, current_date - 200),
    -- No performance standard: not counted as a barrier.
    (v_org, v_k201, 'DEMO-SCE-04', 'Operator response to alarm', 'human', 'preventive',
     null, null, null),
    (v_org, v_p101, 'DEMO-SCE-05', 'Bunding', 'passive', 'mitigative',
     'DEMO — contains 110% of the largest vessel.', 60, current_date - 300);

  select id into v_trip from safety_critical_elements where organization_id = v_org and sce_ref='DEMO-SCE-01';
  select id into v_esd  from safety_critical_elements where organization_id = v_org and sce_ref='DEMO-SCE-02';
  select id into v_psv  from safety_critical_elements where organization_id = v_org and sce_ref='DEMO-SCE-03';
  select id into v_proc from safety_critical_elements where organization_id = v_org and sce_ref='DEMO-SCE-04';
  select id into v_bund from safety_critical_elements where organization_id = v_org and sce_ref='DEMO-SCE-05';

  insert into major_hazards (organization_id, site_id, hazard_ref, title, top_event,
    worst_credible_consequence, consequence_class)
  values (v_org, v_site, 'DEMO-MAH-01', 'DEMO — Gas recovery overpressure',
          'Loss of containment of hydrocarbon gas',
          'DEMO — vapour cloud ignition affecting the upgrader area', 'multiple_fatality')
  returning id into v_haz;

  insert into hazard_barriers (hazard_id, sce_id, organization_id, threat_or_consequence)
  values (v_haz, v_trip, v_org, 'Blocked outlet'),
         (v_haz, v_esd,  v_org, 'Blocked outlet'),
         (v_haz, v_proc, v_org, 'Blocked outlet'),
         (v_haz, v_psv,  v_org, 'Overpressure relief');

  -- Both instrumented barriers depend on instrument air. Reuses the U2
  -- common-cause model rather than inventing a second one.
  insert into common_cause_groups (organization_id, name, cause_kind, description)
  values (v_org, 'DEMO — Instrument air header', 'shared_supply',
          'DEMO — both instrumented barriers on K-201 are air-actuated from one header.')
  returning id into v_grp;
  insert into common_cause_members (group_id, asset_id, organization_id)
  values (v_grp, v_k201, v_org) on conflict do nothing;

  -- An impairment with NO approved deviation.
  insert into barrier_impairments (organization_id, sce_id, started_at,
    expected_restoration, reason, compensating_measures)
  values (v_org, v_trip, now() - interval '35 days', current_date - 5,
          'DEMO — transmitter awaiting replacement.',
          'DEMO — hourly manual pressure rounds.');

  -- A SIF overdue by enough to cross a band: 36 months against a 12-month
  -- interval takes PFD from 4.38e-3 (SIL 2) to 1.31e-2 (SIL 1).
  insert into safety_instrumented_functions (organization_id, sce_id, sif_ref, description,
    target_sil, architecture, lambda_du_per_hour, beta_factor,
    proof_test_interval_months, last_proof_test_on)
  values
    (v_org, v_trip, 'DEMO-SIF-01', 'DEMO — K-201 high-pressure trip', 2, '1oo1',
     0.000001, null, 12, current_date - 1095),
    (v_org, v_esd, 'DEMO-SIF-02', 'DEMO — K-201 emergency shutdown', 3, '1oo2',
     0.000001, 0.10, 12, current_date - 180);

  insert into relief_devices (organization_id, asset_id, device_ref, device_kind,
    set_pressure, set_pressure_unit, governing_case, test_interval_months,
    last_tested_on, last_test_result)
  values (v_org, v_k201, 'DEMO-PSV-201', 'psv', 1200, 'kPag',
          'DEMO — blocked outlet', 60, current_date - 2200, 'pass_after_adjustment');

  insert into integrity_windows (organization_id, asset_id, parameter, unit,
    standard_low, standard_high, critical_low, critical_high,
    damage_mechanism, consequence_of_exceedance)
  values (v_org, v_k201, 'Discharge temperature', 'degC', 40, 95, 20, 110,
          'DEMO — high-temperature hydrogen attack above 110 degC',
          'DEMO — accelerated material degradation not detectable on the current inspection interval.')
  returning id into v_iow;

  insert into integrity_exceedances (organization_id, window_id, occurred_at, ended_at,
    peak_value, severity, engineering_assessed)
  values
    (v_org, v_iow, now() - interval '60 days', now() - interval '60 days' + interval '4 hours',
     118, 'critical', false),
    (v_org, v_iow, now() - interval '20 days', now() - interval '20 days' + interval '1 hour',
     99, 'standard', true);

  insert into alarm_performance (organization_id, site_id, console_label,
    period_start, period_end, operator_hours, total_alarms, peak_ten_minute_count,
    standing_alarms, high_priority, medium_priority, low_priority)
  values (v_org, v_site, 'DEMO — Upgrader console',
          current_date - 30, current_date - 1, 720, 12960, 46, 31, 3200, 4100, 5660);
end $$;
