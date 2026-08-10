-- ============================================================================
-- Demo environmental data, Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA, DEMO-prefixed. The private operator organization gets
-- nothing and its posture line says so.
--
-- Built to make the maintenance-to-environment link concrete: the heat
-- exchanger HX-08 fouls at a measurable rate, and the panel computes both the
-- degradation rate and the day the clean pays for itself in fuel alone. That
-- is a work order nobody would otherwise raise, because the machine is still
-- running.
--
-- One activity record is deliberately left with NO factor so the posture can
-- be seen saying it is activity data and not emissions.
-- ============================================================================
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_site uuid; v_hx uuid; v_k201 uuid;
  v_base bigint;
  d int;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from emission_factors where organization_id = v_org) then return; end if;

  select id into v_site from sites where organization_id = v_org limit 1;
  select id into v_hx   from assets where organization_id = v_org and tag = 'HX-08';
  select id into v_k201 from assets where organization_id = v_org and tag = 'K-201';

  insert into emission_factors (organization_id, factor_key, label, activity_unit,
    factor, factor_unit, source, gwp)
  values
    (v_org, 'diesel', 'DEMO — Diesel combustion', 'L', 2.68, 'kgCO2e/L',
     'DEMO — national inventory factor set 2026', null),
    (v_org, 'grid_power', 'DEMO — Grid electricity', 'kWh', 0.62, 'kgCO2e/kWh',
     'DEMO — provincial grid intensity 2026', null),
    (v_org, 'methane', 'DEMO — Vented methane', 'kg', 1, 'kgCH4/kg',
     'DEMO — direct mass measurement', 28);

  insert into environmental_activities (organization_id, site_id, asset_id,
    activity_kind, period_start, period_end, quantity, unit, factor_key, scope,
    maintenance_attributable, note)
  values
    (v_org, v_site, null, 'fuel_burn', current_date - 30, current_date - 1,
     412000, 'L', 'diesel', 'scope_1', false, 'DEMO — haul fleet monthly burn.'),
    (v_org, v_site, null, 'electricity', current_date - 30, current_date - 1,
     2850000, 'kWh', 'grid_power', 'scope_2', false, 'DEMO — plant monthly draw.'),
    (v_org, v_site, v_k201, 'fugitive_methane', current_date - 30, current_date - 1,
     620, 'kg', 'methane', 'scope_1', true,
     'DEMO — compressor seal leakage identified on survey; seal replacement outstanding.'),
    -- No factor, deliberately: the posture must be seen calling this out.
    (v_org, v_site, null, 'water_withdrawal', current_date - 30, current_date - 1,
     185000, 'm3', null, null, false, 'DEMO — raw water intake, no factor applicable.'),
    (v_org, v_site, null, 'lubricant_loss', current_date - 90, current_date - 1,
     1850, 'L', null, null, true,
     'DEMO — hydraulic losses across the fleet; largely hose and fitting failures.');

  -- The fouling exchanger. Specific energy rises ~0.02 units/day from a design
  -- of 100, which is the fixture the engine tests are pinned against.
  if v_hx is not null then
    insert into efficiency_baselines (organization_id, asset_id, metric, unit,
      design_value, basis, established_on, intervention_cost, energy_cost_per_day)
    values (v_org, v_hx, 'Specific energy', 'kWh/t', 100,
            'DEMO — post-clean performance test, established at last turnaround.',
            current_date - 200, 30000, 5000)
    returning id into v_base;

    foreach d in array array[0, 40, 80, 120, 160, 200] loop
      insert into efficiency_readings (organization_id, baseline_id, measured_on, value)
      values (v_org, v_base, current_date - 200 + d, 100 + 0.02 * d);
    end loop;
  end if;

  insert into hazardous_inventory (organization_id, asset_id, substance, category,
    quantity, unit, location, disposal_route_required, end_of_life_planned)
  values
    (v_org, null, 'DEMO — Lead-acid traction batteries', 'battery', 48, 'each',
     'DEMO — heavy vehicle shop', 'DEMO — licensed recycler', true),
    (v_org, null, 'DEMO — R-134a refrigerant', 'refrigerant', 340, 'kg',
     'DEMO — HVAC plant', 'DEMO — recovery and reclaim', false),
    (v_org, null, 'DEMO — Density gauge sealed source', 'radioactive_source', 2, 'each',
     'DEMO — process line', 'DEMO — return to manufacturer under licence', false);
end $$;
