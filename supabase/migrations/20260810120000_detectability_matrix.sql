-- ============================================================================
-- The detectability matrix: techniques, damage mechanisms, and which detects
-- which (capability register C2.05, C4.03; strengthens C6.24, C3.x).
--
-- WHY THIS SHAPE RATHER THAN A CATALOGUE OF CONDITIONS.
--
-- The obvious approach — ship every monitorable condition for every asset
-- class in every asset-intensive industry — fails three ways. The space is
-- combinatorially unbounded (class × mechanism × technique × duty ×
-- environment); almost every row is irrelevant to any given operator; and
-- every P-F interval shipped would be a vendor-invented number sitting
-- underneath an inspection frequency, which is an invented safety margin.
--
-- So this separates what is genuinely universal from what is irreducibly
-- site-specific:
--
--   UNIVERSAL, shipped complete:
--     * detection techniques — a closed set of condition-monitoring
--       technologies, common to every asset-intensive industry;
--     * damage mechanisms — how material and machinery physically fail;
--     * the detectability matrix — which technique detects which mechanism,
--       whether it is the primary or a secondary indicator, and whether the
--       warning it gives is long, medium or short.
--
--   SITE-SPECIFIC, never shipped as fact:
--     * the P-F interval in days. Declared by the operator's engineer, or —
--       better — DERIVED from their own alert-to-failure history by
--       derive_observed_pf() once that history exists.
--
-- The matrix is what makes the useful question answerable. Not "what could be
-- monitored in general?" but "for THIS asset, which credible failure
-- mechanisms are blind to the instrumentation actually installed?" — which is
-- what get_monitoring_coverage_gaps() returns.
--
-- Canonical reuse: sensors, assets, condition_alerts, work_orders,
-- taxonomy_definitions, app_current_org(). Additive.
-- ============================================================================

create table if not exists detection_techniques (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  technique_key text not null,
  name text not null,
  description text not null,
  register_ref text not null default 'C2.05',
  created_at timestamptz not null default now(),
  unique (organization_id, technique_key)
);

alter table detection_techniques enable row level security;
drop policy if exists detection_techniques_read on detection_techniques;
create policy detection_techniques_read on detection_techniques
  for select to authenticated using (organization_id = app_current_org());

create table if not exists damage_mechanisms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  mechanism_key text not null,
  name text not null,
  description text not null,
  register_ref text not null default 'C2.03',
  created_at timestamptz not null default now(),
  unique (organization_id, mechanism_key)
);

alter table damage_mechanisms enable row level security;
drop policy if exists damage_mechanisms_read on damage_mechanisms;
create policy damage_mechanisms_read on damage_mechanisms
  for select to authenticated using (organization_id = app_current_org());

create table if not exists mechanism_detectability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  mechanism_id uuid not null references damage_mechanisms(id) on delete cascade,
  technique_id uuid not null references detection_techniques(id) on delete cascade,
  detectability text not null check (detectability in ('primary', 'secondary')),
  -- Warning CHARACTER, not a number of days. How much notice a technique
  -- typically gives for a mechanism is general engineering knowledge; how many
  -- days it gives on a particular machine is not, and belongs in pf_intervals.
  typical_warning text not null check (typical_warning in ('long', 'medium', 'short', 'none')),
  basis text not null default
    'General engineering mapping of technique to mechanism. The pairing is reference knowledge; the interval it implies is site-specific and belongs in pf_intervals.',
  register_ref text not null default 'C4.03',
  created_at timestamptz not null default now(),
  unique (mechanism_id, technique_id)
);

alter table mechanism_detectability enable row level security;
drop policy if exists mechanism_detectability_read on mechanism_detectability;
create policy mechanism_detectability_read on mechanism_detectability
  for select to authenticated using (organization_id = app_current_org());

-- Which technique a configured sensor actually delivers. A temperature
-- transmitter is process trending, NOT thermography — conflating the two would
-- credit an asset with coverage it does not have.
alter table sensors
  add column if not exists technique_key text;

update sensors set technique_key = case signal_type
  when 'vibration' then 'vibration_analysis'
  when 'temperature' then 'process_trending'
  when 'pressure' then 'process_trending'
  when 'flow' then 'process_trending'
  when 'speed' then 'process_trending'
  when 'current' then 'mcsa'
  when 'oil' then 'oil_condition'
  else null end
where technique_key is null;

-- techniques
insert into detection_techniques (organization_id, technique_key, name, description)
select o.id, v.k, v.n, v.d from organizations o cross join (values
  ('vibration_analysis','Vibration analysis','Rotating machinery: spectral and time-waveform analysis'),
  ('oil_condition','Oil and lubricant analysis (condition)','Viscosity, oxidation, additive depletion, water and contamination'),
  ('wear_particle','Wear-particle analysis / ferrography','Debris morphology and concentration identifying the wearing surface'),
  ('thermography','Infrared thermography','Surface temperature anomaly under load'),
  ('ultrasound','Airborne and structure-borne ultrasound','High-frequency emission from leaks, arcing and early bearing distress'),
  ('mcsa','Motor current signature analysis','Electrical signature of rotor, bearing and load faults'),
  ('insulation_test','Electrical insulation testing','Insulation resistance, polarisation index, partial discharge'),
  ('ndt','Non-destructive testing','Ultrasonic thickness, magnetic particle, dye penetrant, radiography'),
  ('visual','Visual and borescope inspection','Direct or remote visual examination'),
  ('process_deviation','Performance and process-parameter deviation','Efficiency, differential pressure, flow or power drift from baseline'),
  ('acoustic_emission','Acoustic emission','Stress-wave emission from active crack growth and leakage'),
  ('alignment','Laser shaft alignment check','Static and dynamic shaft alignment measurement'),
  ('balancing','Dynamic balance check','Residual unbalance measurement'),
  ('corrosion_monitoring','Corrosion monitoring','Coupons, electrical-resistance and linear-polarisation probes'),
  ('leak_detection','Leak detection','Tracer gas, pressure decay and bubble testing'),
  ('process_trending','Temperature, pressure and flow trending','Standard process instrumentation trended against limits'),
  ('strain_torque','Strain and torque measurement','Load-path measurement on structures and drivetrains'),
  ('dimensional','Wear measurement and dimensional gauging','Direct measurement against a wear limit')
) as v(k,n,d) where not exists (select 1 from detection_techniques t where t.organization_id=o.id and t.technique_key=v.k);

-- mechanisms
insert into damage_mechanisms (organization_id, mechanism_key, name, description)
select o.id, v.k, v.n, v.d from organizations o cross join (values
  ('fatigue_crack','Fatigue cracking','Progressive cracking under cyclic load'),
  ('overload_fracture','Overload fracture','Single-event fracture beyond material capability'),
  ('abrasive_wear','Abrasive wear','Hard particles cutting a softer surface'),
  ('adhesive_wear','Adhesive wear and scuffing','Surface welding and tearing under inadequate film'),
  ('erosion','Erosion','Material loss from impinging fluid or particles'),
  ('cavitation','Cavitation damage','Bubble collapse eroding the surface'),
  ('general_corrosion','General corrosion','Uniform electrochemical material loss'),
  ('localized_corrosion','Localised corrosion and pitting','Concentrated attack, often under deposits'),
  ('scc','Stress-corrosion cracking','Cracking under combined tensile stress and corrosive environment'),
  ('creep','Creep','Time-dependent deformation at elevated temperature'),
  ('thermal_fatigue','Thermal fatigue','Cracking from repeated thermal cycling'),
  ('lube_degradation','Lubricant degradation','Oxidation and additive depletion of the fluid'),
  ('lube_contamination','Lubricant contamination','Ingress of water, dirt or coolant'),
  ('lube_starvation','Lubrication starvation','Insufficient film at the contact'),
  ('misalignment','Shaft misalignment','Angular or parallel offset between coupled shafts'),
  ('imbalance','Rotating imbalance','Mass distribution offset from the axis of rotation'),
  ('looseness','Mechanical looseness','Lost clamping force or excessive clearance'),
  ('bearing_spalling','Bearing raceway spalling','Subsurface fatigue breaking through the raceway'),
  ('gear_wear','Gear tooth wear and pitting','Progressive loss of tooth profile'),
  ('seal_degradation','Seal degradation','Loss of sealing function through wear, hardening or damage'),
  ('insulation_degradation','Electrical insulation degradation','Loss of dielectric strength'),
  ('winding_fault','Winding short or earth fault','Turn-to-turn or turn-to-earth breakdown'),
  ('fouling','Fouling and deposition','Accumulation restricting flow or heat transfer'),
  ('blockage','Blockage and restriction','Partial or total obstruction of a flow path'),
  ('loose_connection','Loose electrical connection','Increased resistance at a joint or termination'),
  ('structural_deformation','Structural deformation','Permanent distortion of a load-bearing member')
) as v(k,n,d) where not exists (select 1 from damage_mechanisms m where m.organization_id=o.id and m.mechanism_key=v.k);

-- detectability matrix (88 pairs)
insert into mechanism_detectability (organization_id, mechanism_id, technique_id, detectability, typical_warning)
select o.id, m.id, t.id, v.det, v.warn from organizations o
cross join (values
  ('fatigue_crack','ndt','primary','long'),
  ('fatigue_crack','acoustic_emission','primary','medium'),
  ('fatigue_crack','visual','secondary','short'),
  ('fatigue_crack','vibration_analysis','secondary','short'),
  ('fatigue_crack','strain_torque','secondary','medium'),
  ('overload_fracture','visual','primary','none'),
  ('overload_fracture','ndt','secondary','none'),
  ('overload_fracture','strain_torque','secondary','short'),
  ('abrasive_wear','wear_particle','primary','long'),
  ('abrasive_wear','dimensional','primary','long'),
  ('abrasive_wear','oil_condition','secondary','medium'),
  ('abrasive_wear','vibration_analysis','secondary','short'),
  ('adhesive_wear','wear_particle','primary','medium'),
  ('adhesive_wear','oil_condition','secondary','medium'),
  ('adhesive_wear','vibration_analysis','secondary','short'),
  ('adhesive_wear','thermography','secondary','short'),
  ('erosion','ndt','primary','long'),
  ('erosion','dimensional','primary','long'),
  ('erosion','process_deviation','secondary','medium'),
  ('erosion','visual','secondary','medium'),
  ('cavitation','ultrasound','primary','medium'),
  ('cavitation','vibration_analysis','primary','medium'),
  ('cavitation','process_deviation','secondary','medium'),
  ('cavitation','visual','secondary','short'),
  ('general_corrosion','ndt','primary','long'),
  ('general_corrosion','corrosion_monitoring','primary','long'),
  ('general_corrosion','visual','secondary','medium'),
  ('localized_corrosion','ndt','primary','medium'),
  ('localized_corrosion','corrosion_monitoring','primary','medium'),
  ('localized_corrosion','visual','secondary','short'),
  ('scc','ndt','primary','short'),
  ('scc','acoustic_emission','primary','short'),
  ('scc','visual','secondary','short'),
  ('creep','dimensional','primary','long'),
  ('creep','ndt','primary','long'),
  ('creep','process_trending','secondary','long'),
  ('thermal_fatigue','ndt','primary','medium'),
  ('thermal_fatigue','thermography','secondary','medium'),
  ('thermal_fatigue','visual','secondary','short'),
  ('lube_degradation','oil_condition','primary','long'),
  ('lube_degradation','process_trending','secondary','medium'),
  ('lube_contamination','oil_condition','primary','long'),
  ('lube_contamination','wear_particle','secondary','medium'),
  ('lube_starvation','thermography','primary','short'),
  ('lube_starvation','ultrasound','primary','short'),
  ('lube_starvation','process_trending','secondary','short'),
  ('lube_starvation','vibration_analysis','secondary','short'),
  ('misalignment','vibration_analysis','primary','long'),
  ('misalignment','alignment','primary','long'),
  ('misalignment','thermography','secondary','medium'),
  ('imbalance','vibration_analysis','primary','long'),
  ('imbalance','balancing','primary','long'),
  ('looseness','vibration_analysis','primary','medium'),
  ('looseness','ultrasound','secondary','medium'),
  ('looseness','visual','secondary','medium'),
  ('bearing_spalling','vibration_analysis','primary','long'),
  ('bearing_spalling','ultrasound','primary','long'),
  ('bearing_spalling','wear_particle','primary','medium'),
  ('bearing_spalling','thermography','secondary','short'),
  ('bearing_spalling','mcsa','secondary','medium'),
  ('gear_wear','wear_particle','primary','long'),
  ('gear_wear','vibration_analysis','primary','medium'),
  ('gear_wear','oil_condition','secondary','medium'),
  ('gear_wear','visual','secondary','medium'),
  ('seal_degradation','visual','primary','short'),
  ('seal_degradation','leak_detection','primary','short'),
  ('seal_degradation','oil_condition','secondary','medium'),
  ('seal_degradation','process_trending','secondary','short'),
  ('insulation_degradation','insulation_test','primary','long'),
  ('insulation_degradation','thermography','secondary','medium'),
  ('insulation_degradation','ultrasound','secondary','medium'),
  ('winding_fault','insulation_test','primary','medium'),
  ('winding_fault','mcsa','primary','medium'),
  ('winding_fault','thermography','secondary','short'),
  ('fouling','process_deviation','primary','long'),
  ('fouling','process_trending','primary','long'),
  ('fouling','thermography','secondary','medium'),
  ('fouling','visual','secondary','medium'),
  ('blockage','process_deviation','primary','medium'),
  ('blockage','process_trending','primary','medium'),
  ('blockage','ultrasound','secondary','short'),
  ('loose_connection','thermography','primary','medium'),
  ('loose_connection','ultrasound','primary','medium'),
  ('loose_connection','insulation_test','secondary','short'),
  ('structural_deformation','dimensional','primary','medium'),
  ('structural_deformation','visual','primary','medium'),
  ('structural_deformation','strain_torque','secondary','medium'),
  ('structural_deformation','ndt','secondary','medium')
) as v(mk,tk,det,warn)
join damage_mechanisms m on m.organization_id=o.id and m.mechanism_key=v.mk
join detection_techniques t on t.organization_id=o.id and t.technique_key=v.tk
where not exists (select 1 from mechanism_detectability d where d.mechanism_id=m.id and d.technique_id=t.id);

-- ----------------------------------------------------------------------------
-- The question worth answering: what is BLIND on this asset?
-- ----------------------------------------------------------------------------
create or replace function public.get_monitoring_coverage_gaps(
  p_criticality text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_assets jsonb;
  v_mech_total int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*) into v_mech_total from damage_mechanisms where organization_id = v_org;

  select coalesce(jsonb_agg(x order by x->>'blind_primary' desc, x->>'name'), '[]'::jsonb)
  into v_assets
  from (
    select jsonb_build_object(
      'asset_id', a.id, 'name', a.name, 'criticality', a.criticality,
      'techniques_installed', coalesce(inst.techniques, '[]'::jsonb),
      'mechanisms_covered', coalesce(cov.n, 0),
      'mechanisms_total', v_mech_total,
      'coverage_pct', case when v_mech_total > 0
        then round(100.0 * coalesce(cov.n, 0) / v_mech_total, 1) end,
      -- The list that drives action: mechanisms with NO primary technique
      -- installed. A secondary indicator is better than nothing, but planning
      -- a condition-based strategy on one is how late detection happens.
      'blind_primary', coalesce(blind.modes, '[]'::jsonb)
    ) as x
    from assets a
    left join lateral (
      select jsonb_agg(distinct t.name) as techniques
      from sensors s
      join detection_techniques t
        on t.organization_id = v_org and t.technique_key = s.technique_key
      where s.asset_id = a.id) inst on true
    left join lateral (
      select count(distinct d.mechanism_id) as n
      from sensors s
      join detection_techniques t
        on t.organization_id = v_org and t.technique_key = s.technique_key
      join mechanism_detectability d
        on d.technique_id = t.id and d.detectability = 'primary'
      where s.asset_id = a.id) cov on true
    left join lateral (
      select jsonb_agg(m.name order by m.name) as modes
      from damage_mechanisms m
      where m.organization_id = v_org
        and exists (
          select 1 from mechanism_detectability d
          where d.mechanism_id = m.id and d.detectability = 'primary')
        and not exists (
          select 1 from sensors s
          join detection_techniques t
            on t.organization_id = v_org and t.technique_key = s.technique_key
          join mechanism_detectability d2
            on d2.technique_id = t.id and d2.mechanism_id = m.id
               and d2.detectability = 'primary'
          where s.asset_id = a.id)) blind on true
    where a.organization_id = v_org
      and (p_criticality is null or a.criticality = p_criticality)
  ) q;

  return jsonb_build_object(
    'techniques', (select count(*) from detection_techniques where organization_id = v_org),
    'mechanisms', v_mech_total,
    'detectability_pairs', (select count(*) from mechanism_detectability where organization_id = v_org),
    'assets', v_assets,
    'method', 'Coverage counts a mechanism as covered only where a PRIMARY detection technique is installed. Secondary indicators are recorded in the matrix but do not count as coverage — planning a condition-based strategy on a secondary indicator is how late detection happens.',
    'caveat', 'The matrix is a general engineering mapping. Which mechanisms are CREDIBLE for a given asset is an FMEA question the operator answers; until an asset-level FMEA exists, every mechanism is treated as candidate, which overstates the blind list for simple assets.');
end
$$;

grant execute on function public.get_monitoring_coverage_gaps(text) to authenticated;

-- ----------------------------------------------------------------------------
-- The honest long game: derive the interval from the operator's own history
-- ----------------------------------------------------------------------------
create or replace function public.derive_observed_pf(
  p_min_samples int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_rows jsonb;
  v_n int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- Observed P-F: from the first alert on an asset to the corrective work that
  -- alert was linked to. Only LINKED alerts count — an unlinked alert followed
  -- by a coincidental repair would inflate the interval with a coincidence.
  select coalesce(jsonb_agg(jsonb_build_object(
    'technique', t.name,
    'samples', x.n,
    'observed_pf_days_mean', x.mean_days,
    'observed_pf_days_min', x.min_days,
    'implied_inspection_days', round(x.min_days / 2.0, 1)
  ) order by x.n desc), '[]'::jsonb), count(*)
  into v_rows, v_n
  from (
    select s.technique_key,
           count(*)::int as n,
           round(avg(extract(epoch from (w.created_at - al.triggered_at)) / 86400.0)::numeric, 1) as mean_days,
           round(min(extract(epoch from (w.created_at - al.triggered_at)) / 86400.0)::numeric, 1) as min_days
    from condition_alerts al
    join sensors s on s.id = al.sensor_id
    join work_orders w on w.id = al.work_order_id
    where al.organization_id = v_org and w.created_at >= al.triggered_at
      and s.technique_key is not null
    group by s.technique_key
    having count(*) >= greatest(p_min_samples, 1)
  ) x
  join detection_techniques t
    on t.organization_id = v_org and t.technique_key = x.technique_key;

  return jsonb_build_object(
    'observed', v_rows,
    'available', coalesce(v_n, 0) > 0,
    'min_samples', greatest(p_min_samples, 1),
    'basis', case when coalesce(v_n, 0) > 0
      then 'Derived from this organization''s own linked alert-to-work-order history. The MINIMUM observed interval, not the mean, is the safe basis for an inspection frequency — the mean would leave half the population undetected.'
      else 'Not enough linked alert-to-failure history yet. Until there is, P-F intervals remain declared engineering values (pf_intervals), never inferred from a thin sample.' end);
end
$$;

grant execute on function public.derive_observed_pf(int) to authenticated;

notify pgrst, 'reload schema';
