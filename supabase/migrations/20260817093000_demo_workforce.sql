-- ============================================================================
-- Demo workforce for the Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA WITH FICTIONAL PEOPLE. Every employee reference is
-- prefixed DEMO- and every name is invented. No real person's roster,
-- qualification or retirement date appears here, and the private operator
-- organization gets nothing at all — its workforce posture correctly reports
-- that no workforce is recorded.
--
-- The shape demonstrates the four findings the analysis exists to produce:
--
--   * a worker on eleven consecutive twelve-hour days, breaching a statutory
--     limit that cannot be waived on site
--   * an EXPIRED statutory confined-space authorisation
--   * a critical knowledge area with exactly one holder, who has a departure
--     date recorded — the workforce equivalent of a single point of failure
--   * a craft whose declared hours and itemised deductions do not reconcile
-- ============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_site uuid;
  v_conf bigint; v_ahs bigint; v_rig bigint; v_hv bigint;
  v_m1 bigint; v_m2 bigint; v_m3 bigint; v_m4 bigint; v_m5 bigint;
  v_area bigint;
  d int;
  v_start timestamptz;
begin
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;
  if exists (select 1 from workforce_members where organization_id = v_org) then
    return;  -- idempotent
  end if;

  select id into v_site from sites where organization_id = v_org limit 1;

  -- Competencies
  insert into competencies (organization_id, competency_key, title, kind, issuing_body,
                            validity_months, is_statutory, description)
  values
    (v_org, 'conf_space', 'Confined space entry', 'statutory_authorisation',
     'DEMO — provincial regulator', 24, true,
     'Statutory. Cannot be waived by a supervisor on site.'),
    (v_org, 'hv_switching', 'High-voltage switching authorisation', 'statutory_authorisation',
     'DEMO — site electrical authority', 12, true, 'Statutory.'),
    (v_org, 'ahs_commissioning', 'AHS commissioning and calibration', 'skill',
     'DEMO — OEM', null, false, 'Vendor-specific. Few people hold it.'),
    (v_org, 'rigging_2', 'Rigging level 2', 'certification',
     'DEMO — training provider', 36, false, null);
  select id into v_conf from competencies where organization_id = v_org and competency_key = 'conf_space';
  select id into v_hv   from competencies where organization_id = v_org and competency_key = 'hv_switching';
  select id into v_ahs  from competencies where organization_id = v_org and competency_key = 'ahs_commissioning';
  select id into v_rig  from competencies where organization_id = v_org and competency_key = 'rigging_2';

  -- People. Fictional.
  insert into workforce_members (organization_id, site_id, employee_ref, display_name,
                                 craft, employment_type, employer, fte, hired_on, expected_departure)
  values
    (v_org, v_site, 'DEMO-001', 'A. Rivera (demo)',  'Millwright',  'employee',   null, 1.0, date '2009-04-01', date '2027-06-30'),
    (v_org, v_site, 'DEMO-002', 'B. Okafor (demo)',  'Millwright',  'employee',   null, 1.0, date '2018-09-01', null),
    (v_org, v_site, 'DEMO-003', 'C. Lindqvist (demo)','Electrician', 'employee',  null, 1.0, date '2015-02-01', null),
    (v_org, v_site, 'DEMO-004', 'D. Nakamura (demo)','Electrician',  'contractor', 'DEMO Contracting Ltd', 1.0, date '2024-01-15', null),
    -- Sole holder of AHS commissioning, on a contract with an end date. That
    -- combination is what turns a knowledge risk into a dated one.
    (v_org, v_site, 'DEMO-005', 'E. Haddad (demo)',  'Technician',   'oem_specialist', 'DEMO OEM Services', 0.5, date '2023-06-01', current_date + 240)
  ;
  select id into v_m1 from workforce_members where organization_id = v_org and employee_ref = 'DEMO-001';
  select id into v_m2 from workforce_members where organization_id = v_org and employee_ref = 'DEMO-002';
  select id into v_m3 from workforce_members where organization_id = v_org and employee_ref = 'DEMO-003';
  select id into v_m4 from workforce_members where organization_id = v_org and employee_ref = 'DEMO-004';
  select id into v_m5 from workforce_members where organization_id = v_org and employee_ref = 'DEMO-005';

  -- Grants, including one EXPIRED statutory authorisation.
  insert into member_competencies (organization_id, member_id, competency_id, granted_on, expires_on)
  values
    (v_org, v_m1, v_conf, current_date - 700, current_date - 30),   -- expired, statutory
    (v_org, v_m1, v_rig,  current_date - 400, current_date + 500),
    (v_org, v_m2, v_conf, current_date - 200, current_date + 500),
    (v_org, v_m3, v_hv,   current_date - 300, current_date + 60),   -- expiring soon, statutory
    (v_org, v_m4, v_rig,  current_date - 100, current_date + 900),
    (v_org, v_m5, v_ahs,  current_date - 500, null);

  -- The single point of knowledge: only E. Haddad holds AHS commissioning.
  insert into knowledge_areas (organization_id, area_key, title, consequence_if_lost,
                               criticality, documented_where)
  values
    (v_org, 'ahs_commissioning', 'AHS commissioning and fault diagnosis',
     'DEMO — no one on site can recommission the autonomous haul fleet after a controller '
     || 'replacement; the OEM callout is 5 days.', 'critical', null),
    (v_org, 'legacy_scada', 'Legacy SCADA point mapping',
     'DEMO — historian tags cannot be traced back to field devices.', 'high',
     'DEMO — partially, in a spreadsheet');
  select id into v_area from knowledge_areas where organization_id = v_org and area_key = 'ahs_commissioning';
  insert into knowledge_holders (area_id, member_id, organization_id, depth)
  values (v_area, v_m5, v_org, 'expert');
  -- The legacy SCADA area has NO holder at all, which is worse and is reported.

  -- Labour rules
  insert into labour_rules (organization_id, rule_key, title, source, limit_kind, limit_value, reference)
  values
    (v_org, 'stat_max_days', 'Maximum consecutive days worked', 'statutory',
     'max_consecutive_days', 7, 'DEMO — provincial employment standards'),
    (v_org, 'stat_rest', 'Minimum rest between shifts', 'statutory',
     'min_rest_hours_between_shifts', 10, 'DEMO — provincial employment standards'),
    (v_org, 'agreement_shift', 'Maximum shift length', 'labour_agreement',
     'max_hours_per_shift', 12, 'DEMO — collective agreement art. 14'),
    (v_org, 'company_7day', 'Maximum hours in 7 days', 'company_standard',
     'max_hours_per_7_days', 60, 'DEMO — site fatigue standard');

  -- Rosters. A. Rivera works eleven straight twelve-hour days.
  for d in 1..11 loop
    v_start := date_trunc('day', now()) - make_interval(days => d) + interval '6 hours';
    insert into shift_assignments (organization_id, member_id, starts_at, ends_at, shift_kind)
    values (v_org, v_m1, v_start, v_start + interval '12 hours', 'day');
  end loop;
  -- B. Okafor works a sane five-on two-off pattern.
  foreach d in array array[14,13,12,11,10,7,6,5,4,3] loop
    v_start := date_trunc('day', now()) - make_interval(days => d) + interval '7 hours';
    insert into shift_assignments (organization_id, member_id, starts_at, ends_at, shift_kind)
    values (v_org, v_m2, v_start, v_start + interval '8 hours', 'day');
  end loop;

  -- Crew composition and a specialised tool nobody but one person can use.
  insert into crew_templates (organization_id, template_key, title, description)
  values (v_org, 'confined_entry', 'DEMO — Confined space entry crew',
          'Entrant, attendant and supervisor. The attendant is not optional.');
  insert into crew_template_roles (organization_id, template_id, role_label, craft,
                                   headcount, required_competency_id, is_mandatory)
  select v_org, ct.id, r.label, r.craft, r.hc, v_conf, r.mand
  from crew_templates ct,
       (values ('Entrant','Millwright',1,true),
               ('Attendant','Millwright',1,true),
               ('Supervisor',null,1,true)) as r(label, craft, hc, mand)
  where ct.organization_id = v_org and ct.template_key = 'confined_entry';

  insert into specialised_tools (organization_id, tool_key, title, quantity_available,
                                 required_competency_id, lead_time_days, owned_by)
  values (v_org, 'ahs_diag_kit', 'DEMO — AHS diagnostic kit', 1, v_ahs, 21, 'DEMO OEM Services');

  -- Capacity: declared hours that do NOT reconcile with the deductions.
  insert into capacity_deductions (organization_id, site_id, craft, deduction_kind, weekly_hours, basis)
  values
    (v_org, v_site, 'Millwright', 'leave', 8, 'DEMO — average annual leave spread weekly'),
    (v_org, v_site, 'Millwright', 'training', 4, 'DEMO — mandatory refreshers'),
    (v_org, v_site, 'Millwright', 'toolbox_and_permits', 6, 'DEMO — 1.2 h/day pre-job');

  -- A declared craft capacity that does NOT reconcile with the deductions
  -- above: 80 theoretical less 18 itemised leaves 62, and 48 is declared.
  -- The gap is real and the panel is expected to say the declared figure wins.
  insert into craft_capacity (organization_id, site_id, craft, weekly_hours, basis)
  values (v_org, v_site, 'Millwright', 48,
          'DEMO — planner''s delivered-hours figure, carried over from the previous system.')
  on conflict do nothing;

  insert into standard_work (organization_id, work_key, title, craft, standard_minutes, basis)
  values (v_org, 'conveyor_idler_change', 'DEMO — Change a conveyor idler', 'Millwright', 45,
          'DEMO — timed over 12 observations, median.');
end $$;
