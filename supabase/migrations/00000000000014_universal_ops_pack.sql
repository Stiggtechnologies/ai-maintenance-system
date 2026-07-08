-- ============================================================================
-- Universal operations pack — all functions, all industries, all asset bases.
--
--   1. FMEA/strategy library expanded from 7 to 25+ asset-class patterns so
--      autonomous onboarding produces credible engineering content for any
--      industry's register (power, utilities, chemicals, data centers,
--      marine, aviation, manufacturing, rail, water, buildings…).
--   2. Two new proactive operations functions on the 5-minute loop:
--        - HSE pass: safety-flagged work aging without action is an
--          escalating exposure — raised to the compliance agent.
--        - Production pass: multiple degraded monitoring points on one
--          asset signal derate/throughput risk before a trip.
--   3. run_operating_loop() now chains all passes (condition, schedule,
--      material, capacity, HSE, production).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Asset-class FMEA library expansion
-- ----------------------------------------------------------------------------
insert into onboarding_fmea_library (class_pattern, component, failure_mode, effect, cause, detection_method, recommended_action, severity) values
-- Rotating: turbines / generators / fans / gearboxes
('turbine','Blading','Blade fouling / erosion','Output derate, efficiency loss, vibration','Deposits, particle erosion, moisture carryover','Performance heat-rate trend, vibration signature','Wash/inspection cycle tied to performance loss threshold','high'),
('turbine','Bearing system','Journal bearing wear','Vibration, orbit change, rub risk','Oil contamination, load change, misalignment','Vibration + orbit analysis, oil analysis, temperature','Oil condition program, alignment verification','high'),
('generator','Stator winding','Insulation degradation','Trip, rewind, extended outage','Thermal aging, partial discharge, contamination','PD monitoring, IR/PI testing, winding RTDs','Electrical test program, cooling system verification','high'),
('generator','Rotor','Rotor winding shorted turns','Vibration change, excitation increase','Thermal cycling, insulation migration','Flux probe analysis, excitation trending','Flux monitoring, planned rotor inspection','medium'),
('fan|blower','Impeller','Imbalance / buildup','Vibration, bearing life reduction, flow loss','Material buildup, erosion, blade damage','Vibration route, visual inspection','Cleaning schedule, balance on condition','medium'),
('gearbox','Gearing','Tooth wear / pitting','Noise, vibration, torque loss, failure','Lubrication breakdown, overload, misalignment','Oil analysis (wear metals), vibration GMF bands','Oil program, load review, on-condition replacement','high'),
-- Electrical: transformers / switchgear / UPS / batteries
('transformer','Winding & insulation','Insulation breakdown','Trip, fire risk, long lead-time replacement','Thermal aging, moisture, through-faults','DGA oil analysis, thermography, load trending','DGA program, load management, moisture control','high'),
('transformer','OLTC','Tap changer contact wear','Regulation failure, gassing','Contact erosion, mechanism wear','DGA on OLTC compartment, operation counts','OLTC service by operations count, DGA screening','medium'),
('switchgear','Breaker mechanism','Failure to operate','Protection failure, arc-flash exposure','Mechanism lubrication, coil aging, corrosion','Trip-time testing, thermography, partial discharge','Breaker exercise program, protection testing','high'),
('ups|battery','Battery string','Cell degradation','Runtime loss, load drop on outage','Aging, temperature, charge regime','Impedance testing, discharge tests, temperature','Impedance route, cell replacement policy','high'),
-- Static: valves / vessels / boilers / pipelines / tanks
('valve','Trim/seat','Passing / seat leakage','Process loss, control degradation, safety exposure','Erosion, cavitation, debris','Acoustic/ultrasonic leak detection, DP check','Lap or replace trim per leak class','medium'),
('valve','Actuator','Actuator failure','Loss of control/isolation function','Air supply, seal wear, torque drift','Stroke testing, signature analysis','Partial-stroke test program, actuator service','high'),
('vessel|tank','Shell/heads','Wall thinning / corrosion','Loss of containment risk, statutory exposure','Corrosion mechanisms, erosion, CUI','UT thickness surveys, RBI program, visual','Risk-based inspection intervals, coating repair','high'),
('boiler','Tubes','Tube leak / rupture','Forced outage, safety exposure','Overheating, corrosion fatigue, water chemistry','Chemistry monitoring, acoustic leak detection','Chemistry regime, targeted NDT at outages','high'),
('pipeline','Line pipe','Corrosion / leak','Containment loss, environmental exposure','Internal/external corrosion, coating failure','ILI pigging, CP monitoring, leak detection','CP program, ILI schedule, dig verification','high'),
-- HVAC / refrigeration / chillers
('hvac|chiller|refrigeration','Compressor','Compressor failure','Cooling loss, load shed, product/comfort risk','Refrigerant issues, lubrication, cycling','Approach temperature trend, current, oil analysis','Refrigerant/oil program, approach monitoring','medium'),
('hvac|chiller|refrigeration','Heat rejection','Condenser fouling','Efficiency loss, high head trip','Scaling, biological growth, airflow restriction','Approach temperature, differential pressure','Cleaning at approach threshold, water treatment','medium'),
-- Instrumentation & control
('plc|instrument|control','I/O + logic','Controller/module failure','Loss of control/visibility, spurious trip','Component aging, power quality, environment','Diagnostics, redundancy alarms, watchdog','Spares strategy, firmware/lifecycle plan, redundancy test','high'),
('instrument|sensor','Sensing element','Drift / frozen signal','Bad data to operations and AI models','Fouling, aging, process coating','Flatline/deviation analytics, calibration checks','Calibration schedule, deviation alerting','medium'),
-- Material handling / lifting / robotics
('crane|hoist|lifting','Wire rope & brake','Rope wear / brake slip','Dropped-load risk, statutory non-compliance','Fatigue, corrosion, brake wear','Statutory inspection, NDT, brake testing','Statutory program, discard-criteria inspections','high'),
('robot|packaging','Servo/drive train','Repeatability loss / servo fault','Quality defects, line stoppage','Backlash, encoder drift, cable fatigue','Cycle-time and fault-code analytics','Preventive cable/gear service, calibration','medium'),
-- Data centers / IT infrastructure
('server|rack|data.?center','Cooling & power path','Thermal event / power path failure','Service outage, hardware loss','Cooling failure, PDU/UPS issues, airflow','Inlet temperature telemetry, power monitoring','Redundancy test schedule, airflow management','high'),
-- Marine / rail / aviation support
('marine|engine','Main engine','Cylinder/liner wear','Power loss, fuel penalty, breakdown risk','Fuel quality, lubrication, load profile','Lube oil analysis, performance monitoring','Condition-based overhaul, fuel/lube management','high'),
('rail|locomotive','Traction system','Traction motor failure','Service loss, schedule disruption','Insulation aging, bearing wear, contamination','Current signature, temperature, vibration','On-condition motor service, ventilation cleaning','medium'),
('aircraft|aviation','Hydraulic system','Hydraulic degradation','Dispatch reliability impact','Fluid contamination, seal wear','Fluid sampling, pressure decay checks','Fluid program per OEM/regulatory schedule','high')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2. HSE + production proactive passes
-- ----------------------------------------------------------------------------
create or replace function public.run_ops_expansion_passes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  w record;
  d record;
  v_title text;
  v_hse int := 0;
  v_production int := 0;
begin
  for v_org in select id from organizations loop

    -- ---- HSE pass: safety-flagged work aging without completion -----------
    for w in
      select wo.id, wo.title, wo.created_at, a.name as asset_name, a.id as aid
      from work_orders wo
      left join assets a on a.id = wo.asset_id
      where wo.organization_id = v_org
        and wo.safety_flag = true
        and wo.status in ('pending','approval','scheduled','blocked')
        and wo.created_at < now() - interval '3 days'
    loop
      v_title := 'HSE exposure: safety work aging — ' || w.title;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale)
        select v_org, w.aid, ag.id, v_title,
          'Safety-flagged work open since ' || to_char(w.created_at, 'YYYY-MM-DD') || ' without completion',
          'Prioritize into the next execution window; verify interim risk controls are in place',
          'Closes an open safety exposure before it normalizes',
          82, 'action', 'pending', 'HSE Manager', 'Maintenance Manager', 'Operations', 'Reliability Engineer',
          'High',
          'Raised by the proactive HSE pass — aging safety work is an escalating exposure. Human approval required.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'compliance_auditing'
        limit 1;
        v_hse := v_hse + 1;
      end if;
    end loop;

    -- ---- Production pass: multi-point degradation signals derate risk ------
    for d in
      select a.id as aid, a.name as asset_name, a.criticality,
             count(*) as degraded_points,
             string_agg(se.name || ' (' || se.status || ')', ', ') as points
      from sensors se
      join assets a on a.id = se.asset_id
      where se.organization_id = v_org
        and se.status in ('warning','alarm')
      group by a.id, a.name, a.criticality
      having count(*) >= 2
    loop
      v_title := 'Production risk: multi-point degradation on ' || d.asset_name;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale)
        select v_org, d.aid, ag.id, v_title,
          d.degraded_points || ' monitoring points degraded simultaneously: ' || d.points,
          'Review operating point with operations; plan intervention before a forced derate or trip',
          'Protects throughput by acting ahead of a forced outage',
          79,
          case when d.criticality in ('critical','high') then 'action' else 'advisory' end,
          'pending', 'Operations Manager', 'Reliability Engineer', 'Planner', 'Maintenance Manager',
          case when d.criticality = 'critical' then 'High' else 'Medium' end,
          'Raised by the proactive production pass — simultaneous multi-point degradation precedes derates and trips. Human approval required.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'reliability_engineering'
        limit 1;
        v_production := v_production + 1;
      end if;
    end loop;

    update ai_agents ag set last_action_at = now(),
      current_task = 'Auditing open safety work and compliance exposure'
    where ag.organization_id = v_org and ag.key = 'compliance_auditing';
  end loop;

  return jsonb_build_object(
    'hse_escalations', v_hse,
    'production_risks', v_production,
    'ran_at', now()
  );
end
$$;

revoke execute on function public.run_ops_expansion_passes() from public, anon, authenticated;
grant execute on function public.run_ops_expansion_passes() to service_role;

-- ----------------------------------------------------------------------------
-- 3. Chain every operations function on the loop
-- ----------------------------------------------------------------------------
create or replace function public.run_operating_loop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return run_agent_loop() || run_proactive_agent_passes() || run_ops_expansion_passes();
end
$$;

revoke execute on function public.run_operating_loop() from public, anon, authenticated;
grant execute on function public.run_operating_loop() to service_role;
