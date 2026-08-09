-- ============================================================================
-- Demo suppliers for the Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA. Every supplier code is prefixed DEMO- and every company
-- name is invented. The private operator organization gets nothing and
-- correctly reports that no suppliers are recorded.
--
-- The shape demonstrates the findings the analysis exists to produce, mapped
-- onto the demo material catalogue that already exists:
--
--   * the 120-day critical final drive with exactly ONE approved supplier —
--     the supply-chain form of a single point of failure
--   * a part the vendor has put on last-time buy, against assets with far
--     more remaining life than the buy window covers
--   * a material with a supplier recorded and none approved, which is
--     unfinished sourcing and needs a different response
--   * an unassessed MANDATORY safety bulletin past its required-by date
--   * two bids where the cheaper one assumed half the productivity
-- ============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_oem bigint; v_dist bigint; v_alt bigint; v_contractor_a bigint; v_contractor_b bigint;
  v_fd uuid; v_seal uuid; v_brake uuid; v_filter uuid;
  v_pkg bigint;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from suppliers where organization_id = v_org) then return; end if;

  insert into suppliers (organization_id, supplier_code, name, supplier_kind,
                         safety_qualification_status, safety_qualification_expires,
                         approved_vendor, approval_reference)
  values
    (v_org, 'DEMO-OEM1',  'DEMO Heavy Equipment OEM',   'oem',
     'qualified', current_date + 400, true,  'DEMO — AVL-001'),
    (v_org, 'DEMO-DIST1', 'DEMO Northern Parts Supply', 'distributor',
     'qualified', current_date + 200, true,  'DEMO — AVL-002'),
    (v_org, 'DEMO-ALT1',  'DEMO Alternate Rebuilders',  'repair_vendor',
     'conditional', current_date - 20, false, null),
    (v_org, 'DEMO-CON-A', 'DEMO Mechanical Services A', 'service_contractor',
     'qualified', current_date + 300, true,  'DEMO — AVL-010'),
    (v_org, 'DEMO-CON-B', 'DEMO Mechanical Services B', 'service_contractor',
     'qualified', current_date + 150, true,  'DEMO — AVL-011');

  select id into v_oem  from suppliers where organization_id = v_org and supplier_code = 'DEMO-OEM1';
  select id into v_dist from suppliers where organization_id = v_org and supplier_code = 'DEMO-DIST1';
  select id into v_alt  from suppliers where organization_id = v_org and supplier_code = 'DEMO-ALT1';
  select id into v_contractor_a from suppliers where organization_id = v_org and supplier_code = 'DEMO-CON-A';
  select id into v_contractor_b from suppliers where organization_id = v_org and supplier_code = 'DEMO-CON-B';

  select id into v_fd     from materials where organization_id = v_org and material_code = 'TMPL-FINAL-DRIVE';
  select id into v_seal   from materials where organization_id = v_org and material_code = 'TMPL-SUSP-SEAL';
  select id into v_brake  from materials where organization_id = v_org and material_code = 'TMPL-BRAKE-PACK';
  select id into v_filter from materials where organization_id = v_org and material_code = 'TMPL-HYD-FILTER';

  -- The single point of failure: 120-day critical part, one approved source.
  if v_fd is not null then
    insert into material_suppliers (organization_id, material_id, supplier_id,
      approved_for_this_material, quoted_lead_time_days, lifecycle_status)
    values (v_org, v_fd, v_oem, true, 120, 'mature');
  end if;

  -- Last-time buy against assets with much longer life ahead of them.
  if v_brake is not null then
    insert into material_suppliers (organization_id, material_id, supplier_id,
      approved_for_this_material, quoted_lead_time_days, lifecycle_status,
      last_time_buy_date, end_of_support_date)
    values (v_org, v_brake, v_oem, true, 60, 'last_time_buy',
            current_date + 400, current_date + 900);
  end if;

  -- Properly dual-sourced: the case that should NOT appear as exposure.
  if v_seal is not null then
    insert into material_suppliers (organization_id, material_id, supplier_id,
      approved_for_this_material, quoted_lead_time_days, lifecycle_status)
    values (v_org, v_seal, v_oem,  true, 45, 'active'),
           (v_org, v_seal, v_dist, true, 52, 'active');
  end if;

  -- Unfinished sourcing: a supplier recorded, none approved for the part.
  if v_filter is not null then
    insert into material_suppliers (organization_id, material_id, supplier_id,
      approved_for_this_material, quoted_lead_time_days, lifecycle_status)
    values (v_org, v_filter, v_alt, false, 14, 'active');
  end if;

  -- An unassessed MANDATORY bulletin, already past its required-by date.
  insert into vendor_advisories (organization_id, supplier_id, advisory_reference,
    issued_on, title, advisory_kind, applies_to_manufacturer, applies_to_model,
    mandatory, required_by, assessment_status)
  values
    (v_org, v_oem, 'DEMO-SB-2025-114', current_date - 300,
     'DEMO — Brake accumulator pre-charge inspection', 'safety_bulletin',
     'Komatsu', '930-4', true, current_date - 60, 'unassessed'),
    (v_org, v_oem, 'DEMO-PCN-2026-007', current_date - 40,
     'DEMO — Final drive seal material change', 'product_change_notice',
     'Komatsu', '930-4', false, null, 'unassessed');

  -- Two bids: the cheaper one assumed half the productivity.
  insert into contract_packages (organization_id, package_code, title, scope_of_work,
    exclusions, acceptance_criteria, site_conditions_stated)
  values (v_org, 'DEMO-PKG-01', 'DEMO — Conveyor CV-01 idler replacement campaign',
          'DEMO — replace 120 idlers across the 10 km overland conveyor.',
          'DEMO — excludes structural repair and electrical work.',
          null, false)
  returning id into v_pkg;

  insert into contract_bids (organization_id, package_id, supplier_id, price,
    labour_hours, assumed_productivity_factor, duration_days, qualifications, submitted_on)
  values
    (v_org, v_pkg, v_contractor_a, 240000, 2000, 1.0, 25,
     'DEMO — assumes conveyor available 10 h/day.', current_date - 30),
    (v_org, v_pkg, v_contractor_b, 205000, 3200, 0.5, 40,
     'DEMO — assumes restricted access on the incline section.', current_date - 28);

  -- Delivery history, including a rejection.
  if v_fd is not null then
    insert into supplier_deliveries (organization_id, supplier_id, material_id,
      ordered_on, promised_on, received_on, quantity, quality_outcome)
    values
      (v_org, v_oem, v_fd, current_date - 400, current_date - 280, current_date - 275, 1, 'accepted'),
      (v_org, v_oem, v_fd, current_date - 200, current_date - 80,  current_date - 55,  1, 'accepted'),
      (v_org, v_oem, v_fd, current_date - 120, current_date - 5,   null,               1, null);
  end if;

  insert into contract_performance (organization_id, package_id, supplier_id,
    period_start, period_end, planned_hours, actual_hours, planned_cost, actual_cost,
    rework_events, safety_incidents, quality_escapes, note)
  values (v_org, null, v_contractor_a, current_date - 365, current_date - 1,
          4000, 4620, 480000, 551000, 3, 0, 1,
          'DEMO — previous campaign; 15.5% over on hours.');
end $$;
