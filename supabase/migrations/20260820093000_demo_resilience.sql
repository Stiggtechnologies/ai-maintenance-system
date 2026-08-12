-- ============================================================================
-- Demo threat scenarios and operating modes, Fort McMurray demo org only.
--
-- ILLUSTRATIVE DATA, DEMO-prefixed. Only FOUR of the twelve threat kinds are
-- seeded, deliberately: those are the ones that can be mapped honestly onto
-- the demo asset base and its dependency graph. Seeding all twelve with
-- invented exposure would make the coverage line read 12 of 12 and mean
-- nothing. The posture correctly reports 4 of 12.
--
-- One scenario is built to demonstrate the FLOOR case: it names an asset that
-- has no recorded dependencies, so nothing downstream of it can be counted and
-- the analysis says the impact figure is a lower bound.
--
-- Three of the four operating modes are fully specified and one is left
-- deliberately incomplete, because that is the common real state and the
-- readiness check should be seen finding it.
-- ============================================================================
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_site uuid;
  v_hx uuid; v_p101 uuid; v_p201 uuid; v_k201 uuid; v_c22 uuid;
  v_grid bigint; v_fire bigint; v_cold bigint; v_supply bigint;
  v_oem bigint;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from threat_scenarios where organization_id = v_org) then return; end if;

  select id into v_site from sites where organization_id = v_org limit 1;
  select id into v_hx   from assets where organization_id = v_org and tag = 'HX-08';
  select id into v_p101 from assets where organization_id = v_org and tag = 'P-101';
  select id into v_p201 from assets where organization_id = v_org and tag = 'P-201';
  select id into v_k201 from assets where organization_id = v_org and tag = 'K-201';
  select id into v_c22  from assets where organization_id = v_org and tag = 'C-22';
  select id into v_oem  from suppliers where organization_id = v_org and supplier_code = 'DEMO-OEM1';

  insert into threat_scenarios (organization_id, site_id, scenario_key, title,
    threat_kind, description, annual_likelihood, plan_reference,
    last_exercised_on, exercise_outcome, linked_supplier)
  values
    (v_org, v_site, 'DEMO-GRID-01', 'DEMO — Loss of the Utility Block MCC',
     'utility_failure',
     'DEMO — the shared motor control centre feeding both cooling pumps is lost. '
     || 'This is the common-cause group the interdependency slice already identified.',
     0.05, 'DEMO — EP-014', current_date - 200, 'partial', null),
    (v_org, v_site, 'DEMO-FIRE-01', 'DEMO — Wildfire smoke and site evacuation',
     'wildfire',
     'DEMO — regional wildfire forces evacuation and shuts the plant in.',
     0.08, 'DEMO — EP-002', null, null, null),
    (v_org, v_site, 'DEMO-COLD-01', 'DEMO — Extreme cold snap below −40 degC',
     'extreme_cold',
     'DEMO — instrument lines and hydraulics freeze; outdoor conveyors are worst affected.',
     0.20, null, null, null, null),
    (v_org, v_site, 'DEMO-SUPPLY-01', 'DEMO — Sole-source final-drive supplier fails',
     'supply_chain',
     'DEMO — the only approved supplier for the 120-day final drive becomes unavailable. '
     || 'This is the E7 sole-source finding, realised.',
     0.03, null, null, null, v_oem)
  ;
  select id into v_grid   from threat_scenarios where organization_id=v_org and scenario_key='DEMO-GRID-01';
  select id into v_fire   from threat_scenarios where organization_id=v_org and scenario_key='DEMO-FIRE-01';
  select id into v_cold   from threat_scenarios where organization_id=v_org and scenario_key='DEMO-COLD-01';
  select id into v_supply from threat_scenarios where organization_id=v_org and scenario_key='DEMO-SUPPLY-01';

  -- Grid: both pumps. The graph carries this to the exchanger and the
  -- compressors, which is exactly the defeated-redundancy finding.
  if v_p101 is not null then
    insert into scenario_exposure (scenario_id, asset_id, organization_id, basis)
    values (v_grid, v_p101, v_org, 'DEMO — fed from the Utility Block MCC.');
  end if;
  if v_p201 is not null then
    insert into scenario_exposure (scenario_id, asset_id, organization_id, basis)
    values (v_grid, v_p201, v_org, 'DEMO — fed from the same MCC. Not independent.');
  end if;

  -- Cold: the conveyor, which sits OUTSIDE the mapped dependency graph, so the
  -- impact figure for this scenario is a floor and the panel will say so.
  if v_c22 is not null then
    insert into scenario_exposure (scenario_id, asset_id, organization_id, basis)
    values (v_cold, v_c22, v_org, 'DEMO — outdoor conveyor, no heat tracing on the tail end.');
  end if;

  -- Wildfire: evacuation stops everything with a declared service level.
  if v_k201 is not null then
    insert into scenario_exposure (scenario_id, asset_id, organization_id, basis)
    values (v_fire, v_k201, v_org, 'DEMO — gas recovery shut in on evacuation.');
  end if;

  -- DEMO-SUPPLY-01 is deliberately left with NO exposure mapped, so the
  -- posture line can be seen reporting a scenario that is only a title.

  insert into operating_mode_definitions (organization_id, mode, entry_criteria,
    exit_criteria, declared_by_role, authority_changes)
  values
    (v_org, 'normal',
     'DEMO — all safety-critical barriers available and no active emergency.',
     'DEMO — any emergency or degraded entry criterion is met.',
     'Site manager',
     'DEMO — standard delegation of authority applies.'),
    (v_org, 'degraded',
     'DEMO — a safety-critical barrier is impaired, or production is below 70% of plan.',
     'DEMO — the impairment is restored and production recovers for 24 h.',
     'Operations superintendent',
     'DEMO — work scheduling moves to the control room; discretionary work is suspended.'),
    (v_org, 'emergency',
     'DEMO — loss of containment, fire, or an evacuation order.',
     'DEMO — incident commander stands the event down.',
     'Incident commander',
     'DEMO — incident commander holds all operational authority; normal approval limits are suspended.'),
    -- Recovery is deliberately incomplete: no exit criteria, no authority
    -- change. This is the common real state and the readiness check finds it.
    (v_org, 'recovery',
     'DEMO — the emergency has been stood down and re-entry is authorised.',
     null, 'Site manager', null);
end $$;
