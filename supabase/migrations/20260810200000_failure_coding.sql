-- ============================================================================
-- Failure coding: separating what the CMMS actually gave us from what
-- reliability analysis needs (capability register C2.03; corrects C6.16,
-- C6.26 labelling).
--
-- The `actual_failure_mode` column on 6,000 real work orders does not contain
-- failure modes. Its 67 distinct values are THREE different kinds of thing
-- mixed into one field:
--
--     44 SYSTEM GROUPS      'Engine Group', 'Hydraulic System', 'Brake System'
--     15 ACTIVITY TYPES     'Planned S1 Service', 'Scheduled Relocate'
--      8 DELAY REASONS      'Out Of Fuel', 'Maint-Wait Lube/Fuel Truck'
--
-- That is not a fault in the source — it is a downtime-coding vocabulary doing
-- its job, and it is genuinely useful for Pareto and bad-actor work. It is
-- simply not a failure mechanism, and calling it one has two consequences the
-- platform was quietly living with:
--
--   * mechanism-level analysis and the technique-to-mechanism matrix (slice 13)
--     cannot run at all, because nothing in the field is a mechanism;
--   * a small amount of metric contamination — 23 corrective work orders and
--     1 of 441 repeat pairs carry an activity or delay label rather than an
--     equipment one. Small, measured, and now excluded rather than assumed away.
--
-- WHAT THIS DOES NOT DO: it does not guess mechanisms. Deriving 'bearing
-- spalling' from 'Engine Group' would fabricate the single most consequential
-- field in reliability analysis. Instead each system group carries CANDIDATE
-- mechanisms — a shortlist for the human coding the record, drawn from the
-- 26 mechanisms shipped in slice 13 — and the coded mechanism stays null until
-- a person puts one there.
--
-- Nothing is destroyed. actual_failure_mode keeps its raw source value; the
-- interpretation is recorded alongside it.
--
-- Canonical reuse: work_orders, damage_mechanisms, mechanism_detectability,
-- app_current_org(). Additive.
-- ============================================================================

create table if not exists failure_code_map (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_label text not null,
  label_kind text not null
    check (label_kind in ('system_group', 'activity_type', 'delay_reason', 'mechanism', 'unclassified')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  note text,
  register_ref text not null default 'C2.03',
  created_at timestamptz not null default now(),
  unique (organization_id, source_label)
);

alter table failure_code_map enable row level security;
drop policy if exists failure_code_map_read on failure_code_map;
create policy failure_code_map_read on failure_code_map
  for select to authenticated using (organization_id = app_current_org());

create table if not exists system_group_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_label text not null,
  mechanism_id uuid not null references damage_mechanisms(id) on delete cascade,
  basis text not null default
    'Candidate only: a shortlist for the person coding the record. The platform never assigns a mechanism from a system group — that would fabricate the most consequential field in reliability analysis.',
  register_ref text not null default 'C2.03',
  unique (organization_id, source_label, mechanism_id)
);

alter table system_group_candidates enable row level security;
drop policy if exists system_group_candidates_read on system_group_candidates;
create policy system_group_candidates_read on system_group_candidates
  for select to authenticated using (organization_id = app_current_org());

alter table work_orders
  -- The interpretation, recorded beside the raw value rather than over it.
  add column if not exists system_group text,
  add column if not exists work_activity text,
  add column if not exists delay_reason text,
  -- The real thing, null until a human codes it.
  add column if not exists failure_mechanism_id uuid references damage_mechanisms(id) on delete set null,
  add column if not exists mechanism_coded_by uuid references auth.users(id),
  add column if not exists mechanism_coded_at timestamptz,
  add column if not exists mechanism_note text;

comment on column work_orders.actual_failure_mode is
  'RAW source label from the CMMS downtime-coding vocabulary. Despite the name it is usually a system group, sometimes an activity type or delay reason — see failure_code_map. Kept verbatim; never overwritten. The coded mechanism lives in failure_mechanism_id.';

create index if not exists idx_work_orders_system_group
  on work_orders(organization_id, system_group);
create index if not exists idx_work_orders_mechanism
  on work_orders(organization_id, failure_mechanism_id)
  where failure_mechanism_id is not null;

insert into failure_code_map (organization_id, source_label, label_kind)
select o.id, v.l, v.k from organizations o cross join (values
  ('Engine Group','system_group'),
  ('Hydraulic System','system_group'),
  ('Steering System','system_group'),
  ('Tires/Rims','system_group'),
  ('Brake System','system_group'),
  ('Dump Body Group','system_group'),
  ('Low Voltage Electrical','system_group'),
  ('Propel Machinery','system_group'),
  ('Wheel Motor Group','system_group'),
  ('Cab Group','system_group'),
  ('Attachments','system_group'),
  ('Control Group-Electrical','system_group'),
  ('Lighting','system_group'),
  ('Lube System','system_group'),
  ('Front Wheel Strut Group','system_group'),
  ('Fuel System','system_group'),
  ('Fire Suppression System','system_group'),
  ('Ground Engaging Tools','system_group'),
  ('High Voltage Electrical','system_group'),
  ('Hoist Machinery','system_group'),
  ('Bucket/Stick Group','system_group'),
  ('24 Volt System','system_group'),
  ('Swing Machinery','system_group'),
  ('Air Conditioning System','system_group'),
  ('Bucket','system_group'),
  ('Rear Wheel Strut Group','system_group'),
  ('Dipper Trip System','system_group'),
  ('Undercarriage','system_group'),
  ('Air System','system_group'),
  ('Transmission Group','system_group'),
  ('Crowd Machinery','system_group'),
  ('Boom Group','system_group'),
  ('Final Drive Group','system_group'),
  ('Retard System','system_group'),
  ('Glass/Windshield','system_group'),
  ('Ahs Ods Radar/Laser','system_group'),
  ('Ahs User Interface','system_group'),
  ('Ahs Communications','system_group'),
  ('Ahs Observer Controller','system_group'),
  ('Ahs Gps','system_group'),
  ('Ahs Gyro System','system_group'),
  ('Ahs Central Control','system_group'),
  ('Ahs E-Stop Button','system_group'),
  ('Ahs System Failure','system_group'),
  ('Planned Excav/Trax Maintenanc','activity_type'),
  ('Planned Steaming','activity_type'),
  ('Planned S1 Service','activity_type'),
  ('Planned Inspection','activity_type'),
  ('Planned S3 Service','activity_type'),
  ('Planned Component Changeout','activity_type'),
  ('Planned S2 Service','activity_type'),
  ('Planned Tires','activity_type'),
  ('Scheduled Relocate','activity_type'),
  ('Unscheduled Steaming','activity_type'),
  ('Unscheduled Relocate','activity_type'),
  ('Offsite Planned','activity_type'),
  ('Midlife','activity_type'),
  ('Welding','activity_type'),
  ('Mem Vendor Training','activity_type'),
  ('Operations Equipment Damage','delay_reason'),
  ('Incident','delay_reason'),
  ('Start Up Issues','delay_reason'),
  ('Maint-Wait Lube/Fuel Truck','delay_reason'),
  ('Found Work','delay_reason'),
  ('Out Of Fuel','delay_reason'),
  ('Down - Not In Ahs','delay_reason'),
  ('Walk To Shovel Pad','delay_reason')
) as v(l,k) where not exists (select 1 from failure_code_map m where m.organization_id=o.id and m.source_label=v.l);

-- 114 candidate pairs across 35 system groups
insert into system_group_candidates (organization_id, source_label, mechanism_id)
select o.id, v.l, dm.id from organizations o cross join (values
  ('Engine Group','lube_degradation'),
  ('Engine Group','lube_contamination'),
  ('Engine Group','adhesive_wear'),
  ('Engine Group','fouling'),
  ('Engine Group','thermal_fatigue'),
  ('Hydraulic System','seal_degradation'),
  ('Hydraulic System','lube_contamination'),
  ('Hydraulic System','cavitation'),
  ('Hydraulic System','erosion'),
  ('Hydraulic System','blockage'),
  ('Steering System','seal_degradation'),
  ('Steering System','adhesive_wear'),
  ('Steering System','misalignment'),
  ('Steering System','fatigue_crack'),
  ('Tires/Rims','abrasive_wear'),
  ('Tires/Rims','fatigue_crack'),
  ('Tires/Rims','overload_fracture'),
  ('Brake System','abrasive_wear'),
  ('Brake System','seal_degradation'),
  ('Brake System','thermal_fatigue'),
  ('Brake System','lube_contamination'),
  ('Dump Body Group','abrasive_wear'),
  ('Dump Body Group','fatigue_crack'),
  ('Dump Body Group','structural_deformation'),
  ('Low Voltage Electrical','loose_connection'),
  ('Low Voltage Electrical','insulation_degradation'),
  ('Low Voltage Electrical','localized_corrosion'),
  ('High Voltage Electrical','insulation_degradation'),
  ('High Voltage Electrical','winding_fault'),
  ('High Voltage Electrical','loose_connection'),
  ('24 Volt System','loose_connection'),
  ('24 Volt System','insulation_degradation'),
  ('24 Volt System','localized_corrosion'),
  ('Control Group-Electrical','loose_connection'),
  ('Control Group-Electrical','insulation_degradation'),
  ('Propel Machinery','bearing_spalling'),
  ('Propel Machinery','gear_wear'),
  ('Propel Machinery','lube_degradation'),
  ('Propel Machinery','misalignment'),
  ('Wheel Motor Group','winding_fault'),
  ('Wheel Motor Group','insulation_degradation'),
  ('Wheel Motor Group','bearing_spalling'),
  ('Wheel Motor Group','gear_wear'),
  ('Final Drive Group','gear_wear'),
  ('Final Drive Group','bearing_spalling'),
  ('Final Drive Group','lube_contamination'),
  ('Final Drive Group','seal_degradation'),
  ('Transmission Group','gear_wear'),
  ('Transmission Group','bearing_spalling'),
  ('Transmission Group','lube_degradation'),
  ('Lube System','blockage'),
  ('Lube System','lube_contamination'),
  ('Lube System','seal_degradation'),
  ('Lube System','lube_starvation'),
  ('Fuel System','blockage'),
  ('Fuel System','fouling'),
  ('Fuel System','seal_degradation'),
  ('Fuel System','localized_corrosion'),
  ('Air System','blockage'),
  ('Air System','seal_degradation'),
  ('Air System','general_corrosion'),
  ('Air Conditioning System','seal_degradation'),
  ('Air Conditioning System','fouling'),
  ('Air Conditioning System','blockage'),
  ('Hoist Machinery','bearing_spalling'),
  ('Hoist Machinery','gear_wear'),
  ('Hoist Machinery','fatigue_crack'),
  ('Hoist Machinery','misalignment'),
  ('Swing Machinery','bearing_spalling'),
  ('Swing Machinery','gear_wear'),
  ('Swing Machinery','misalignment'),
  ('Swing Machinery','looseness'),
  ('Crowd Machinery','bearing_spalling'),
  ('Crowd Machinery','gear_wear'),
  ('Crowd Machinery','abrasive_wear'),
  ('Boom Group','fatigue_crack'),
  ('Boom Group','structural_deformation'),
  ('Boom Group','overload_fracture'),
  ('Bucket','abrasive_wear'),
  ('Bucket','fatigue_crack'),
  ('Bucket','structural_deformation'),
  ('Bucket/Stick Group','abrasive_wear'),
  ('Bucket/Stick Group','fatigue_crack'),
  ('Bucket/Stick Group','structural_deformation'),
  ('Ground Engaging Tools','abrasive_wear'),
  ('Ground Engaging Tools','overload_fracture'),
  ('Ground Engaging Tools','erosion'),
  ('Undercarriage','abrasive_wear'),
  ('Undercarriage','fatigue_crack'),
  ('Undercarriage','looseness'),
  ('Front Wheel Strut Group','seal_degradation'),
  ('Front Wheel Strut Group','fatigue_crack'),
  ('Front Wheel Strut Group','adhesive_wear'),
  ('Rear Wheel Strut Group','seal_degradation'),
  ('Rear Wheel Strut Group','fatigue_crack'),
  ('Rear Wheel Strut Group','adhesive_wear'),
  ('Dipper Trip System','abrasive_wear'),
  ('Dipper Trip System','fatigue_crack'),
  ('Dipper Trip System','looseness'),
  ('Retard System','abrasive_wear'),
  ('Retard System','thermal_fatigue'),
  ('Retard System','seal_degradation'),
  ('Attachments','fatigue_crack'),
  ('Attachments','abrasive_wear'),
  ('Attachments','looseness'),
  ('Cab Group','structural_deformation'),
  ('Cab Group','loose_connection'),
  ('Lighting','loose_connection'),
  ('Lighting','insulation_degradation'),
  ('Glass/Windshield','overload_fracture'),
  ('Glass/Windshield','fatigue_crack'),
  ('Fire Suppression System','blockage'),
  ('Fire Suppression System','seal_degradation'),
  ('Fire Suppression System','general_corrosion')
) as v(l,mk)
join damage_mechanisms dm on dm.organization_id=o.id and dm.mechanism_key=v.mk
where not exists (select 1 from system_group_candidates c where c.organization_id=o.id and c.source_label=v.l and c.mechanism_id=dm.id);

-- Backfill the interpretation from the map. The raw label is untouched.
update work_orders w
set system_group = case when m.label_kind = 'system_group' then w.actual_failure_mode end,
    work_activity = case when m.label_kind = 'activity_type' then w.actual_failure_mode end,
    delay_reason  = case when m.label_kind = 'delay_reason'  then w.actual_failure_mode end
from failure_code_map m
where m.organization_id = w.organization_id
  and m.source_label = w.actual_failure_mode
  and w.system_group is null and w.work_activity is null and w.delay_reason is null;

-- Anything the map does not cover is recorded as unclassified rather than
-- silently treated as an equipment group.
insert into failure_code_map (organization_id, source_label, label_kind, note)
select distinct w.organization_id, w.actual_failure_mode, 'unclassified',
  'Present in work-order history but absent from the reviewed vocabulary. Classify before it is used in analysis.'
from work_orders w
where w.actual_failure_mode is not null
  and not exists (
    select 1 from failure_code_map m
    where m.organization_id = w.organization_id and m.source_label = w.actual_failure_mode)
on conflict (organization_id, source_label) do nothing;

-- ----------------------------------------------------------------------------
-- Coding: a human assigns the mechanism, from the candidate shortlist
-- ----------------------------------------------------------------------------
create or replace function public.get_mechanism_candidates(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  w work_orders%rowtype;
begin
  select * into w from work_orders where id = p_work_order_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work order not found');
  end if;

  return jsonb_build_object(
    'work_order_id', w.id,
    'source_label', w.actual_failure_mode,
    'system_group', w.system_group,
    'already_coded', w.failure_mechanism_id is not null,
    'candidates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'mechanism_key', dm.mechanism_key, 'name', dm.name,
        'description', dm.description,
        -- What could have caught it, so coding and detectability stay joined up.
        'primary_techniques', (
          select coalesce(jsonb_agg(dt.name order by dt.name), '[]'::jsonb)
          from mechanism_detectability md
          join detection_techniques dt on dt.id = md.technique_id
          where md.mechanism_id = dm.id and md.detectability = 'primary')
      ) order by dm.name), '[]'::jsonb)
      from system_group_candidates c
      join damage_mechanisms dm on dm.id = c.mechanism_id
      where c.organization_id = v_org and c.source_label = w.system_group),
    'all_mechanisms', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'mechanism_key', mechanism_key, 'name', name) order by name), '[]'::jsonb)
      from damage_mechanisms where organization_id = v_org),
    'note', 'Candidates are a shortlist, never an assignment. If the true mechanism is not among them, choose from the full list and the shortlist will be worth revisiting.');
end
$$;

grant execute on function public.get_mechanism_candidates(uuid) to authenticated;

create or replace function public.code_failure_mechanism(
  p_work_order_id uuid,
  p_mechanism_key text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_mech uuid;
  w work_orders%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('reliability_engineer', 'maintenance_manager', 'technician', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'coding a failure mechanism requires a maintenance or engineering role');
  end if;

  select * into w from work_orders where id = p_work_order_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work order not found');
  end if;
  if w.work_type <> 'corrective' then
    return jsonb_build_object('error',
      format('this is %s work — a failure mechanism describes a failure, and coding one here would put a fabricated failure into the reliability history', w.work_type));
  end if;

  select id into v_mech from damage_mechanisms
  where organization_id = v_org and mechanism_key = p_mechanism_key;
  if v_mech is null then
    return jsonb_build_object('error', 'unknown mechanism ' || p_mechanism_key);
  end if;

  update work_orders
  set failure_mechanism_id = v_mech, mechanism_coded_by = auth.uid(),
      mechanism_coded_at = now(), mechanism_note = p_note
  where id = p_work_order_id;

  return jsonb_build_object('coded', p_work_order_id, 'mechanism', p_mechanism_key);
end
$$;

grant execute on function public.code_failure_mechanism(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Where the coding actually stands, stated plainly
-- ----------------------------------------------------------------------------
create or replace function public.get_failure_coding_position()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_corrective int;
  v_coded int;
  v_mislabelled int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*), count(*) filter (where failure_mechanism_id is not null)
  into v_corrective, v_coded
  from work_orders
  where organization_id = v_org and work_type = 'corrective';

  select count(*) into v_mislabelled
  from work_orders w
  join failure_code_map m on m.organization_id = v_org and m.source_label = w.actual_failure_mode
  where w.organization_id = v_org and w.work_type = 'corrective'
    and m.label_kind in ('activity_type', 'delay_reason');

  return jsonb_build_object(
    'vocabulary', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label_kind', label_kind, 'labels', n, 'work_orders', wo) order by wo desc), '[]'::jsonb)
      from (
        select m.label_kind, count(distinct m.source_label) as n,
               count(w.id) as wo
        from failure_code_map m
        left join work_orders w
          on w.organization_id = v_org and w.actual_failure_mode = m.source_label
        where m.organization_id = v_org
        group by m.label_kind) t),
    'corrective_work_orders', v_corrective,
    'mechanism_coded', v_coded,
    'mechanism_coded_pct', case when v_corrective > 0
      then round(100.0 * v_coded / v_corrective, 1) end,
    -- Named rather than quietly filtered, so the size of the problem is visible.
    'corrective_with_non_equipment_label', v_mislabelled,
    'top_uncoded_system_groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'system_group', sg, 'work_orders', n,
        'candidate_mechanisms', c) order by n desc), '[]'::jsonb)
      from (
        select w.system_group as sg, count(*) as n,
               (select count(*) from system_group_candidates sc
                where sc.organization_id = v_org and sc.source_label = w.system_group) as c
        from work_orders w
        where w.organization_id = v_org and w.work_type = 'corrective'
          and w.system_group is not null and w.failure_mechanism_id is null
        group by w.system_group
        order by count(*) desc limit 10) t),
    'unclassified_labels', (
      select coalesce(jsonb_agg(source_label order by source_label), '[]'::jsonb)
      from failure_code_map
      where organization_id = v_org and label_kind = 'unclassified'),
    'note', 'The source field is a downtime-coding vocabulary, not a failure-mode vocabulary. It is kept verbatim and interpreted alongside. No mechanism is ever inferred from a system group — the coded percentage is what has actually been determined by a person.');
end
$$;

grant execute on function public.get_failure_coding_position() to authenticated;

-- ----------------------------------------------------------------------------
-- Correcting the two metrics that were reading the field as a failure mode
-- ----------------------------------------------------------------------------
create or replace function public.get_segmented_reliability(
  p_dimension text default 'criticality',
  p_window_days int default null,
  p_min_failures int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_min int := greatest(coalesce(p_min_failures, 3), 1);
  v_from timestamptz;
  v_to timestamptz;
  v_window_days numeric;
  v_window_hours numeric;
  v_rows jsonb;
begin
  -- 'failure_mode' is retained as an alias for 'system_group' so existing
  -- callers keep working, but it now reports what the data actually is.
  -- 'mechanism' is the true axis and reads only human-coded rows.
  if p_dimension not in ('asset_class', 'criticality', 'site', 'failure_mode',
                         'system_group', 'mechanism') then
    return jsonb_build_object('error',
      'dimension must be one of asset_class, criticality, site, system_group, mechanism');
  end if;

  if p_window_days is null then
    select min(w.completed_at), max(w.completed_at) into v_from, v_to
    from work_orders w
    where w.organization_id = v_org and w.work_type = 'corrective'
      and w.completed_at is not null;
    if v_from is null then
      return jsonb_build_object('dimension', p_dimension, 'segments', '[]'::jsonb,
        'basis', 'No completed corrective work orders are recorded for this organization.');
    end if;
    v_window_days := greatest(extract(epoch from (v_to - v_from)) / 86400.0, 1);
  else
    v_window_days := greatest(p_window_days, 1);
    v_from := now() - make_interval(days => v_window_days::int);
    v_to := now();
  end if;
  v_window_hours := v_window_days * 24.0;

  with scoped as (
    select
      case p_dimension
        when 'asset_class' then coalesce(a.asset_class, 'Unclassified')
        when 'criticality' then coalesce(a.criticality, 'unrated')
        when 'site'        then coalesce(s.name, 'Unassigned site')
        when 'mechanism'   then dm.name
        else                    coalesce(w.system_group, 'Not an equipment group')
      end as segment,
      a.id as asset_id,
      coalesce(w.downtime_hours, 0)::numeric as downtime_hours
    from work_orders w
    join assets a on a.id = w.asset_id
    left join sites s on s.id = a.site_id
    left join damage_mechanisms dm on dm.id = w.failure_mechanism_id
    where w.organization_id = v_org
      and w.work_type = 'corrective'
      and w.completed_at is not null
      and w.completed_at between v_from and v_to
      -- The mechanism axis reads coded rows only; anything else would be
      -- reporting an analysis nobody performed.
      and (p_dimension <> 'mechanism' or w.failure_mechanism_id is not null)
  ), agg as (
    select segment, count(*)::int as failures,
           count(distinct asset_id)::int as assets_in_segment,
           round(sum(downtime_hours)::numeric, 1) as downtime_hours
    from scoped group by segment having count(*) >= v_min
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.downtime_hours desc), '[]'::jsonb)
  into v_rows
  from (
    select segment, failures, assets_in_segment, downtime_hours,
      round((v_window_hours * assets_in_segment)::numeric, 0) as window_hours,
      round(greatest(v_window_hours * assets_in_segment - downtime_hours, 0) / failures, 1) as mtbf_hours,
      round(downtime_hours / failures, 1) as mttr_hours,
      round(100 * greatest(v_window_hours * assets_in_segment - downtime_hours, 0)
        / (v_window_hours * assets_in_segment), 1) as availability_pct
    from agg) x;

  return jsonb_build_object(
    'dimension', case when p_dimension = 'failure_mode' then 'system_group' else p_dimension end,
    'requested_dimension', p_dimension,
    'window_days', round(v_window_days, 1),
    'window_from', v_from, 'window_to', v_to,
    'window_source', case when p_window_days is null then 'derived from data span' else 'caller-specified trailing window' end,
    'min_failures', v_min,
    'basis', case
      when p_dimension = 'mechanism' then
        'Human-coded failure mechanisms only. Uncoded corrective work is EXCLUDED rather than bucketed, because a mechanism nobody determined is not a finding.'
      when p_dimension in ('failure_mode', 'system_group') then
        'Segmented by SYSTEM GROUP, which is what the source downtime-coding vocabulary provides. This is not a failure-mode segmentation: use dimension=mechanism for that, once coding exists (C2.03).'
      else
        'Corrective work orders with a completion date. Segments below the minimum-failure threshold are omitted rather than reported on thin evidence.' end,
    'segments', v_rows);
end
$$;

grant execute on function public.get_segmented_reliability(text, int, int) to authenticated;

notify pgrst, 'reload schema';
