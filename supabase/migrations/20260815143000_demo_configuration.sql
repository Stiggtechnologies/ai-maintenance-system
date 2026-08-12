-- ============================================================================
-- Demo configuration baselines for the Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA. Every baseline is stamped in its source_reference as a
-- demo record and every temporary modification says so in its description, so
-- nothing here can be read as a statement about real equipment. Seeded into
-- the demo org only; the private operator fleet keeps no configuration
-- baselines and its posture line correctly reports "no baseline" rather than
-- "no drift".
--
-- The shape is the set of findings the analysis exists to produce:
--
--   * a smaller impeller than specified, covered by an approval that EXPIRED
--   * a trip relay in the as-designed baseline and absent from as-maintained
--   * controller firmware that moved on without a work order
--   * a vibration-trip jumper installed in 2022 for one week, still fitted
--   * an open red-line markup older than the drawing revision it amends
-- ============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_p101 uuid;
  v_k201 uuid;
  v_designed bigint;
  v_maintained bigint;
  v_spec uuid;
  v_sub uuid;
begin
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;

  select id into v_p101 from assets where organization_id = v_org and tag = 'P-101';
  select id into v_k201 from assets where organization_id = v_org and tag = 'K-201';
  if v_p101 is null then
    return;
  end if;

  -- Idempotent: a re-run must not create a second "current" baseline.
  if exists (select 1 from configuration_baselines
              where organization_id = v_org and asset_id = v_p101) then
    return;
  end if;

  insert into configuration_baselines
    (organization_id, asset_id, baseline_kind, revision, source_reference, notes)
  values (v_org, v_p101, 'as_designed', 3,
          'DEMO — illustrative P-101 general arrangement, rev C',
          'Demonstration baseline. Not a real drawing set.')
  returning id into v_designed;

  insert into configuration_baselines
    (organization_id, asset_id, baseline_kind, revision, source_reference, notes)
  values (v_org, v_p101, 'as_maintained', 1,
          'DEMO — illustrative walkdown record',
          'Demonstration baseline. Not a real walkdown.')
  returning id into v_maintained;

  insert into configuration_items
    (organization_id, baseline_id, position_ref, part_number, quantity,
     firmware_version, safety_critical, safety_basis)
  values
    (v_org, v_designed, 'impeller',    'IMP-250', 1, null, false, null),
    (v_org, v_designed, 'trip relay',  'RLY-9',   1, null, true,
     'High-vibration trip. Loss of this relay defeats the protection that stops the pump running dry.'),
    (v_org, v_designed, 'controller',  'PLC-A',   1, '4.2.1', false, null),
    (v_org, v_designed, 'mech seal',   'SEAL-77', 2, null, false, null),
    -- As-maintained: smaller impeller, relay gone, firmware moved, one seal.
    (v_org, v_maintained, 'impeller',   'IMP-230', 1, null, false, null),
    (v_org, v_maintained, 'controller', 'PLC-A',   1, '4.4.0', false, null),
    (v_org, v_maintained, 'mech seal',  'SEAL-77', 1, null, false, null),
    (v_org, v_maintained, 'aux filter', 'FLT-2',   1, null, false, null);

  -- An approval that has lapsed. The difference it used to cover comes back.
  select id into v_spec from materials
   where organization_id = v_org and material_code = 'IMP-250' limit 1;
  select id into v_sub from materials
   where organization_id = v_org and material_code = 'IMP-230' limit 1;
  if v_spec is null then
    insert into materials (organization_id, material_code, description, lead_time_days)
    values (v_org, 'IMP-250', 'DEMO — impeller, 250 mm', 60) returning id into v_spec;
  end if;
  if v_sub is null then
    insert into materials (organization_id, material_code, description, lead_time_days)
    values (v_org, 'IMP-230', 'DEMO — impeller, 230 mm', 45) returning id into v_sub;
  end if;

  insert into approved_substitutions
    (organization_id, specified_material_id, substitute_material_id,
     conditions, approved_at, expires_at)
  values (v_org, v_spec, v_sub,
          'DEMO — permitted below 1450 rpm only, and not in series duty.',
          now() - interval '3 years', now() - interval '7 months')
  on conflict do nothing;

  -- The jumper. Installed for a week in 2022.
  insert into temporary_modifications
    (organization_id, asset_id, position_ref, modification_kind, description,
     reason, required_removal_by, installed_at, risk_assessment_ref,
     affects_safety_function)
  values
    (v_org, v_p101, 'trip relay', 'jumper',
     'DEMO — high-vibration trip jumpered out',
     'Spurious trips during commissioning of the adjacent line',
     date '2022-06-01', timestamptz '2022-05-25 00:00+00', 'RA-4471', true);

  if v_k201 is not null then
    insert into temporary_modifications
      (organization_id, asset_id, position_ref, modification_kind, description,
       reason, required_removal_by, installed_at, affects_safety_function)
    values
      (v_org, v_k201, 'lube header', 'bypass',
       'DEMO — lube pressure switch bypassed',
       'Awaiting replacement switch',
       current_date + 45, now() - interval '20 days', false);
  end if;

  insert into red_line_markups
    (organization_id, asset_id, drawing_reference, drawing_revision,
     change_description, raised_at, status)
  values
    (v_org, v_p101, 'DEMO — P-101-GA', 'C',
     'Aux filter FLT-2 added in the discharge line; not on the GA drawing.',
     now() - interval '14 months', 'open');
end $$;
