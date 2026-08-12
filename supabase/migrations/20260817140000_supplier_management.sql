-- ============================================================================
-- Contractor and supplier management (capability register E7.01–E7.14).
--
-- The platform can already say a final drive has a 120-day lead time. It
-- cannot say who supplies it, whether that is the only company that does,
-- whether the last three arrived late, whether the part is still in
-- production, or whether the failure that consumed one was inside warranty and
-- nobody claimed.
--
-- THE FINDING THIS SLICE COMPLETES A SET WITH.
--
--   U2 found the ASSETS whose loss stops other assets.
--   E6 found the PEOPLE whose absence stops work.
--   This finds the SUPPLIERS who are the only source of something critical.
--
-- Sole-source exposure is the same shape of problem three times over, and it
-- is the one most often discovered on the day it matters. A critical part with
-- one approved supplier and a 120-day lead time is a four-month outage waiting
-- for a phone call to go unanswered.
--
-- WHAT IS NOT ASSUMED.
--
-- A material with one recorded supplier is NOT necessarily sole-source; it may
-- be a material nobody has finished sourcing. The analysis separates
-- "one approved supplier" from "one recorded supplier" and says which it
-- found, because acting on the second as though it were the first wastes the
-- qualification effort the first actually needs.
--
-- Obsolescence is compared against the REMAINING LIFE OF THE ASSET, not
-- against a calendar. A part going end-of-life in 2030 is irrelevant for a
-- machine being replaced in 2028 and urgent for one expected to run to 2045.
--
-- Canonical reuse: materials and bom_lines from the MRO slice,
-- approved_substitutions from the configuration slice, asset_tenure and
-- asset_class_assignments from the ontology slice, work_orders, assets,
-- asset_economics, app_current_org(). Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Suppliers and contractors are the same kind of counterparty with different
-- things bought from them, so they share a table and differ by capability.
-- ---------------------------------------------------------------------------
create table if not exists suppliers (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_code text not null,
  name text not null,
  supplier_kind text not null check (supplier_kind in
    ('oem', 'distributor', 'repair_vendor', 'service_contractor',
     'labour_contractor', 'engineering', 'other')),
  -- E7.05. A qualification with no expiry is one nobody will revisit.
  safety_qualification_status text not null default 'not_assessed'
    check (safety_qualification_status in
      ('not_assessed', 'qualified', 'conditional', 'suspended', 'disqualified')),
  safety_qualification_expires date,
  approved_vendor boolean not null default false,
  approval_reference text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_sup_code
  on suppliers(organization_id, supplier_code);

alter table suppliers enable row level security;
drop policy if exists sup_read on suppliers;
create policy sup_read on suppliers
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E7.09 / E7.10 / E7.13 / E7.14 — who supplies what, and on what terms
-- ---------------------------------------------------------------------------
create table if not exists material_suppliers (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  supplier_id bigint not null references suppliers(id) on delete cascade,
  -- Approved means qualified to supply THIS part, which is not the same as
  -- being an approved vendor in general.
  approved_for_this_material boolean not null default false,
  supplier_part_number text,
  quoted_lead_time_days int,
  unit_price numeric,
  -- E7.14. The vendor's own lifecycle position for the part.
  lifecycle_status text not null default 'unknown' check (lifecycle_status in
    ('unknown', 'active', 'mature', 'last_time_buy', 'end_of_life', 'obsolete')),
  last_time_buy_date date,
  end_of_support_date date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ms_pair
  on material_suppliers(material_id, supplier_id);
create index if not exists idx_ms_org
  on material_suppliers(organization_id, lifecycle_status);

alter table material_suppliers enable row level security;
drop policy if exists ms_read on material_suppliers;
create policy ms_read on material_suppliers
  for select to authenticated using (organization_id = app_current_org());

-- E7.09 — delivery performance, recorded per event rather than as a score.
create table if not exists supplier_deliveries (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id bigint not null references suppliers(id) on delete cascade,
  material_id uuid references materials(id) on delete set null,
  ordered_on date not null,
  promised_on date,
  received_on date,
  quantity numeric,
  -- E7.06. A late delivery and a wrong delivery are different failures.
  quality_outcome text check (quality_outcome in
    ('accepted', 'accepted_with_deviation', 'rejected_wrong_item',
     'rejected_quality', 'rejected_documentation')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sd_supplier
  on supplier_deliveries(organization_id, supplier_id, ordered_on desc);

alter table supplier_deliveries enable row level security;
drop policy if exists sd_read on supplier_deliveries;
create policy sd_read on supplier_deliveries
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E7.11 — counterfeit and unapproved parts.
--
-- Kept as its own table rather than a delivery outcome, because a suspect part
-- has a life after receipt: it gets quarantined, investigated, and sometimes
-- found in service on other assets. That trail is the whole value.
-- ---------------------------------------------------------------------------
create table if not exists suspect_parts (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  material_id uuid references materials(id) on delete set null,
  supplier_id bigint references suppliers(id) on delete set null,
  detected_on date not null default current_date,
  detection_method text,
  concern text not null check (concern in
    ('counterfeit_suspected', 'unapproved_source', 'documentation_missing',
     'documentation_falsified', 'specification_mismatch')),
  quantity_affected numeric,
  -- The question that matters after detection.
  units_already_installed int,
  affected_assets_identified boolean not null default false,
  quarantined boolean not null default false,
  reported_externally boolean not null default false,
  outcome text,
  created_at timestamptz not null default now()
);

create index if not exists idx_susp_org
  on suspect_parts(organization_id, detected_on desc);

alter table suspect_parts enable row level security;
drop policy if exists susp_read on suspect_parts;
create policy susp_read on suspect_parts
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E7.12 — vendor technical advisories. The bulletin that arrives by email and
-- is never connected to the assets it applies to.
-- ---------------------------------------------------------------------------
create table if not exists vendor_advisories (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  supplier_id bigint references suppliers(id) on delete set null,
  advisory_reference text not null,
  issued_on date not null,
  title text not null,
  advisory_kind text not null check (advisory_kind in
    ('safety_bulletin', 'service_bulletin', 'recall', 'product_change_notice',
     'obsolescence_notice', 'cybersecurity_advisory')),
  applies_to_manufacturer text,
  applies_to_model text,
  mandatory boolean not null default false,
  required_by date,
  -- Assessment is a decision, and an unassessed advisory is an open one.
  assessment_status text not null default 'unassessed' check (assessment_status in
    ('unassessed', 'not_applicable', 'planned', 'complete')),
  assessed_by uuid references auth.users(id) on delete set null,
  assessed_at timestamptz,
  disposition text,
  created_at timestamptz not null default now(),
  check (assessment_status = 'unassessed' or assessed_at is not null)
);

create unique index if not exists idx_adv_ref
  on vendor_advisories(organization_id, advisory_reference);
create index if not exists idx_adv_open
  on vendor_advisories(organization_id, assessment_status)
  where assessment_status = 'unassessed';

alter table vendor_advisories enable row level security;
drop policy if exists adv_read on vendor_advisories;
create policy adv_read on vendor_advisories
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E7.07 — warranty. The money most sites leave on the table.
-- ---------------------------------------------------------------------------
create table if not exists warranty_terms (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  material_id uuid references materials(id) on delete cascade,
  supplier_id bigint references suppliers(id) on delete set null,
  starts_on date not null,
  ends_on date,
  -- Some warranties expire on hours or distance rather than on a date.
  usage_limit numeric,
  usage_unit text,
  covers text,
  exclusions text,
  claim_window_days int,
  created_at timestamptz not null default now(),
  -- A warranty must attach to something.
  check (asset_id is not null or material_id is not null)
);

create index if not exists idx_wt_asset
  on warranty_terms(organization_id, asset_id);

create table if not exists warranty_claims (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  warranty_id bigint references warranty_terms(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  raised_on date not null default current_date,
  claim_value numeric,
  recovered_value numeric,
  status text not null default 'raised' check (status in
    ('raised', 'submitted', 'accepted', 'rejected', 'withdrawn', 'time_barred')),
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_wc_org
  on warranty_claims(organization_id, status);

alter table warranty_terms enable row level security;
alter table warranty_claims enable row level security;
drop policy if exists wt_read on warranty_terms;
create policy wt_read on warranty_terms
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists wc_read on warranty_claims;
create policy wc_read on warranty_claims
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E7.01–E7.04 — contracted work: scope, bids, productivity, performance
-- ---------------------------------------------------------------------------
create table if not exists contract_packages (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_code text not null,
  title text not null,
  -- E7.02. Scope clarity is not a feeling; these are the questions a claim
  -- gets made against later.
  scope_of_work text,
  exclusions text,
  interfaces text,
  acceptance_criteria text,
  site_conditions_stated boolean not null default false,
  awarded_supplier_id bigint references suppliers(id) on delete set null,
  awarded_value numeric,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_cp_code
  on contract_packages(organization_id, package_code);

create table if not exists contract_bids (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint not null references contract_packages(id) on delete cascade,
  supplier_id bigint not null references suppliers(id) on delete cascade,
  price numeric not null check (price >= 0),
  -- E7.04. Two bids are not comparable until you know what each assumed about
  -- how much work gets done per hour. Most comparisons skip this.
  labour_hours numeric,
  assumed_productivity_factor numeric check (assumed_productivity_factor > 0),
  duration_days int,
  inclusions text,
  qualifications text,
  submitted_on date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_cb_pair
  on contract_bids(package_id, supplier_id);

create table if not exists contract_performance (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint references contract_packages(id) on delete set null,
  supplier_id bigint not null references suppliers(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  planned_hours numeric,
  actual_hours numeric,
  planned_cost numeric,
  actual_cost numeric,
  rework_events int not null default 0 check (rework_events >= 0),
  safety_incidents int not null default 0 check (safety_incidents >= 0),
  -- E7.06 / E7.08. A quality escape is work accepted that should not have been.
  quality_escapes int not null default 0 check (quality_escapes >= 0),
  note text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists idx_cperf_supplier
  on contract_performance(organization_id, supplier_id, period_end desc);

alter table contract_packages enable row level security;
alter table contract_bids enable row level security;
alter table contract_performance enable row level security;
drop policy if exists cp_read on contract_packages;
create policy cp_read on contract_packages
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists cb_read on contract_bids;
create policy cb_read on contract_bids
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists cperf_read on contract_performance;
create policy cperf_read on contract_performance
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop function if exists get_supply_posture();
create or replace function get_supply_posture()
returns table (
  suppliers_total bigint,
  approved_vendors bigint,
  safety_qual_expired bigint,
  safety_qual_not_assessed bigint,
  materials_with_supplier bigint,
  materials_total bigint,
  sole_approved_source bigint,
  single_recorded_source bigint,
  obsolete_or_eol bigint,
  unassessed_advisories bigint,
  mandatory_overdue_advisories bigint,
  open_suspect_parts bigint,
  unclaimed_warranty_candidates bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  s as (
    select count(*)::bigint n,
           count(*) filter (where approved_vendor)::bigint approved,
           count(*) filter (where safety_qualification_expires is not null
                              and safety_qualification_expires < current_date)::bigint expired,
           count(*) filter (where safety_qualification_status = 'not_assessed')::bigint unassessed
    from suppliers where organization_id = (select id from org)
  ),
  m as (select count(*)::bigint n from materials where organization_id = (select id from org)),
  ms as (
    select count(distinct material_id)::bigint covered from material_suppliers
    where organization_id = (select id from org)
  ),
  -- One APPROVED supplier is sole-source. One RECORDED supplier may just be
  -- unfinished sourcing, and the two need different responses.
  sole as (
    select
      count(*) filter (where approved_n = 1)::bigint sole_approved,
      count(*) filter (where approved_n = 0 and total_n = 1)::bigint single_recorded
    from (
      select material_id,
             count(*) filter (where approved_for_this_material) approved_n,
             count(*) total_n
      from material_suppliers where organization_id = (select id from org)
      group by material_id
    ) x
  ),
  eol as (
    select count(distinct material_id)::bigint n from material_suppliers
    where organization_id = (select id from org)
      and lifecycle_status in ('end_of_life', 'obsolete', 'last_time_buy')
  ),
  adv as (
    select count(*) filter (where assessment_status = 'unassessed')::bigint unassessed,
           count(*) filter (where mandatory and assessment_status <> 'complete'
                              and required_by is not null and required_by < current_date)::bigint overdue
    from vendor_advisories where organization_id = (select id from org)
  ),
  sp as (
    select count(*) filter (where outcome is null)::bigint n
    from suspect_parts where organization_id = (select id from org)
  ),
  wc as (
    -- Work orders on an asset that was under warranty at the time, with no
    -- claim raised against them. The money left on the table.
    select count(*)::bigint n
    from work_orders w
    join warranty_terms t on t.asset_id = w.asset_id
      and t.organization_id = w.organization_id
      and w.created_at::date between t.starts_on and coalesce(t.ends_on, current_date)
    where w.organization_id = (select id from org)
      and not exists (select 1 from warranty_claims c where c.work_order_id = w.id)
  )
  select s.n, s.approved, s.expired, s.unassessed, ms.covered, m.n,
         sole.sole_approved, sole.single_recorded, eol.n,
         adv.unassessed, adv.overdue, sp.n, wc.n,
    case
      when s.n = 0 then
        'No suppliers are recorded. The platform knows lead times with nobody behind them: it can '
        || 'say a part takes 120 days and cannot say who is expected to deliver it, whether anyone '
        || 'else could, or whether the part is still made.'
      else
        s.n || ' supplier(s), ' || s.approved || ' on the approved vendor list. '
        || ms.covered || ' of ' || m.n || ' catalogued materials have a supplier recorded'
        || case when ms.covered < m.n
                then '; the other ' || (m.n - ms.covered) || ' have a lead time and no named source, '
                     || 'which is a lead time nobody can hold anyone to.'
                else '.' end
    end
    || case when sole.sole_approved > 0 then ' ' || sole.sole_approved
            || ' material(s) have exactly ONE approved supplier — the supply-chain form of a single '
            || 'point of failure.' else '' end
    || case when sole.single_recorded > 0 then ' A further ' || sole.single_recorded
            || ' have one recorded supplier but none approved, which is unfinished sourcing rather '
            || 'than sole source and needs a different response.' else '' end
    || case when adv.overdue > 0 then ' ' || adv.overdue
            || ' MANDATORY vendor advisory/advisories are past their required-by date.' else '' end
    || case when s.expired > 0 then ' ' || s.expired
            || ' supplier(s) have an expired safety qualification.' else '' end
  from s, m, ms, sole, eol, adv, sp, wc;
$$;

grant execute on function get_supply_posture() to authenticated;

-- Sole-source and obsolescence, ranked by what it would actually cost.
create or replace function get_supply_exposure(p_limit int default 25)
returns table (
  material_code text,
  description text,
  criticality text,
  lead_time_days int,
  approved_suppliers bigint,
  recorded_suppliers bigint,
  worst_lifecycle text,
  last_time_buy_date date,
  assets_using bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.material_code, m.description, m.criticality, m.lead_time_days,
         count(*) filter (where ms.approved_for_this_material)::bigint,
         count(ms.id)::bigint,
         min(case ms.lifecycle_status
               when 'obsolete' then '1_obsolete'
               when 'end_of_life' then '2_end_of_life'
               when 'last_time_buy' then '3_last_time_buy'
               when 'mature' then '4_mature'
               when 'active' then '5_active'
               else '6_unknown' end),
         min(ms.last_time_buy_date),
         (select count(distinct b.asset_id) from bom_lines b
           where b.material_id = m.id and b.asset_id is not null)::bigint
  from materials m
  left join material_suppliers ms
    on ms.material_id = m.id and ms.organization_id = m.organization_id
  where m.organization_id = app_current_org()
  group by m.id, m.material_code, m.description, m.criticality, m.lead_time_days
  having count(*) filter (where ms.approved_for_this_material) <= 1
      or min(case ms.lifecycle_status
               when 'obsolete' then 1 when 'end_of_life' then 2
               when 'last_time_buy' then 3 else 9 end) <= 3
  order by case m.criticality when 'critical' then 1 when 'essential' then 2 else 3 end,
           coalesce(m.lead_time_days, 0) desc
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function get_supply_exposure(int) to authenticated;

-- Bids for one package, shaped for the comparison engine.
create or replace function get_package_bids(p_package_code text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'packageCode', p.package_code,
    'title', p.title,
    'scopeStated', (p.scope_of_work is not null and btrim(p.scope_of_work) <> ''),
    'exclusionsStated', (p.exclusions is not null and btrim(p.exclusions) <> ''),
    'acceptanceStated', (p.acceptance_criteria is not null and btrim(p.acceptance_criteria) <> ''),
    'siteConditionsStated', p.site_conditions_stated,
    'bids', coalesce((
      select jsonb_agg(jsonb_build_object(
        'supplier', s.name,
        'price', b.price,
        'labourHours', b.labour_hours,
        'assumedProductivityFactor', b.assumed_productivity_factor,
        'durationDays', b.duration_days,
        'qualifications', b.qualifications) order by b.price)
      from contract_bids b
      join suppliers s on s.id = b.supplier_id
      where b.package_id = p.id
    ), '[]'::jsonb))
  from contract_packages p
  where p.organization_id = app_current_org() and p.package_code = p_package_code;
$$;

grant execute on function get_package_bids(text) to authenticated;

notify pgrst, 'reload schema';
