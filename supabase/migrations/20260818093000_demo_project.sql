-- ============================================================================
-- Demo capital project for the Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA, prefixed DEMO- throughout. The private operator
-- organization gets nothing and correctly reports that no capital projects
-- are recorded.
--
-- The shape demonstrates the findings:
--
--   * a 99% availability target across four SERIES subsystems, requiring
--     99.75% from each — and one subsystem that demonstrably cannot deliver it
--   * a maintainability review that ran without anyone who will maintain it
--   * open punch items following the asset into service
--   * early-life failures attributed to installation and commissioning, none
--     fed back to design
--   * exactly ONE design requirement traced to a real failure mode, so the
--     feedback-loop report shows a loop that can close and mostly has not
-- ============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_site uuid;
  v_proj bigint;
  v_target bigint;
  v_asset uuid;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from capital_projects where organization_id = v_org) then return; end if;

  select id into v_site from sites where organization_id = v_org limit 1;
  select id into v_asset from assets where organization_id = v_org and tag = 'C-22' limit 1;

  insert into capital_projects (organization_id, site_id, project_code, title,
    current_stage, sanctioned_value, target_handover, status)
  values (v_org, v_site, 'DEMO-CP-01',
          'DEMO — Secondary crushing circuit upgrade',
          'design', 42000000, current_date + 400, 'active')
  returning id into v_proj;

  -- A 99% target across four series subsystems needs 99.75% from each.
  insert into ram_targets (organization_id, project_id, system_label,
    target_availability, target_basis, configuration)
  values (v_org, v_proj, 'DEMO — Secondary crushing train', 0.99,
          'DEMO — production plan assumes 8,672 operating hours per year.', 'series')
  returning id into v_target;

  insert into ram_allocations (organization_id, target_id, subsystem_label,
    demonstrated_availability, complexity_weight, evidence)
  values
    (v_org, v_target, 'Feed conveyor',   0.9985, 1.0, 'DEMO — fleet history, 3 years.'),
    (v_org, v_target, 'Crusher',         0.9990, 1.5, 'DEMO — vendor guarantee.'),
    (v_org, v_target, 'Discharge chute', 0.9995, 0.5, 'DEMO — fleet history.'),
    -- The one that cannot make it: allocated ~99.75%, demonstrates 99.2%.
    (v_org, v_target, 'Screen deck',     0.9920, 1.0, 'DEMO — vendor data for the proposed model.');

  -- Requirements. One traced to a real, high-frequency failure mode.
  insert into design_requirements (organization_id, project_id, requirement_ref,
    category, requirement, derived_from_failure_mode, source,
    verification_method, verification_status, waiver_reason)
  values
    (v_org, v_proj, 'DEMO-REQ-001', 'reliability',
     'DEMO — screen deck availability shall be no less than 99.8% demonstrated.',
     null, 'engineering', 'analysis', 'open', null),
    (v_org, v_proj, 'DEMO-REQ-002', 'maintainability',
     'DEMO — all bearings shall be replaceable without removing the drive guard.',
     null, 'maintenance', 'review', 'open', null),
    (v_org, v_proj, 'DEMO-REQ-003', 'access',
     'DEMO — a 20 t crane lay-down area shall be provided within 15 m of the crusher.',
     null, 'maintenance', 'review', 'verified', null),
    -- The loop, closed once. This mode really is the fleet's worst actor.
    (v_org, v_proj, 'DEMO-REQ-004', 'reliability',
     'DEMO — engine and drive package shall be specified against the fleet''s '
     || 'recorded Engine Group failure history, not against catalogue MTBF.',
     'Engine Group', 'operational_lesson', 'analysis', 'open', null),
    (v_org, v_proj, 'DEMO-REQ-005', 'instrumentation',
     'DEMO — vibration monitoring shall be permanently installed on the crusher '
     || 'main bearing, not portable-route only.',
     null, 'maintenance', 'inspection', 'waived',
     'DEMO — deferred to a later phase on cost grounds; portable route '
     || 'monitoring accepted in the interim.');

  -- A maintainability review with nobody who will maintain it in the room.
  insert into design_studies (organization_id, project_id, study_kind, performed_on,
    maintainer_participated, operator_participated, findings_count, findings_closed, summary)
  values
    (v_org, v_proj, 'maintainability_review', current_date - 60,
     false, true, 14, 6, 'DEMO — desktop review by the engineering contractor.'),
    (v_org, v_proj, 'access_and_lifting', current_date - 45,
     true, false, 8, 8, 'DEMO — lifting study, all findings closed.'),
    (v_org, v_proj, 'sparing_review', current_date - 30,
     true, false, 5, 1, 'DEMO — initial spares list reviewed against the BOM.');

  -- Acceptance testing with punch items that follow the asset into service.
  insert into acceptance_tests (organization_id, project_id, test_ref, test_stage,
    scheduled_on, performed_on, outcome, punch_items_raised, punch_items_open,
    witnessed_by_owner)
  values
    (v_org, v_proj, 'DEMO-FAT-01', 'factory_acceptance', current_date - 90,
     current_date - 88, 'pass_with_punch', 12, 3, true),
    (v_org, v_proj, 'DEMO-SAT-01', 'site_acceptance', current_date - 20,
     null, 'not_performed', 0, 0, false);

  -- Early-life failures on an existing asset, none fed back.
  if v_asset is not null then
    insert into early_life_failures (organization_id, asset_id, project_id,
      occurred_at, months_since_handover, failure_mode, attributed_to,
      preventable_by, fed_back_to_design)
    values
      (v_org, v_asset, v_proj, now() - interval '300 days', 2, 'Belt tracking',
       'installation', 'DEMO — alignment check at handover', false),
      (v_org, v_asset, v_proj, now() - interval '240 days', 4, 'Idler seizure',
       'manufacture', 'DEMO — incoming inspection of bearing batch', false),
      (v_org, v_asset, v_proj, now() - interval '180 days', 6, 'Drive trip',
       'commissioning', 'DEMO — full-load reliability run before handover', false),
      (v_org, v_asset, v_proj, now() - interval '120 days', 8, 'Chute blockage',
       'design', 'DEMO — chute geometry review with operations', false),
      (v_org, v_asset, v_proj, now() - interval '60 days', 10, 'Belt tear',
       'not_determined', null, false);
  end if;
end $$;
