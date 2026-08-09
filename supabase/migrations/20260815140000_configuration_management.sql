-- ============================================================================
-- Configuration management: what was designed, what was built, what is
-- actually out there now (capability register U7.01, U7.03–U7.04, U7.06–U7.11).
--
-- Maintenance history tells you what was done to an asset. It does not tell you
-- what the asset currently IS. Those diverge quietly: a pump gets an impeller
-- one size down during a night shift, a controller takes a firmware update
-- nobody logged, a temporary jumper goes in for a week and is still there four
-- years later. Every one of those is invisible to a work-order system and
-- every one of them changes how the equipment fails.
--
-- THREE BASELINES, DELIBERATELY SEPARATE.
--
--   as_designed   what engineering specified
--   as_built      what was actually installed at handover
--   as_maintained what is in it right now
--
-- Collapsing them into one record is the mistake this table set exists to
-- prevent, because the whole value is in the DIFFERENCE. An as-maintained
-- configuration that matches as-designed is worth recording precisely so that
-- the day it stops matching, somebody can tell.
--
-- THE ONE WITH TEETH: TEMPORARY MODIFICATIONS.
--
-- A temporary modification carries a required_removal_by date and the platform
-- reports on how far past it we are. "Temporary" is the most dangerous word in
-- a plant, and a temporary change with no removal date is refused at the
-- constraint level rather than accepted and quietly forgotten.
--
-- WHAT IS NOT ASSUMED.
--
-- An asset with no as-designed baseline is NOT treated as compliant. Drift is
-- undefined without something to drift from, and the analysis says "no
-- baseline" rather than "no drift" — those are opposite findings that look
-- identical in a dashboard. The same applies to a reconciliation that has
-- never been run: the answer is the date of the last one, or the fact that
-- there has not been one.
--
-- Canonical reuse: assets, materials and bom_lines from the MRO slice,
-- work_orders, organizations, app_current_org(). bom_lines models what an
-- asset CONSUMES; these tables model what it IS, which is why the BOM was not
-- extended in place. Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- U7.01 — the three baselines
-- ---------------------------------------------------------------------------
create table if not exists configuration_baselines (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  baseline_kind text not null check (baseline_kind in
    ('as_designed', 'as_built', 'as_maintained')),
  revision int not null default 1 check (revision >= 1),
  is_current boolean not null default true,
  effective_from timestamptz not null default now(),
  -- Where it came from: a drawing, a handover dossier, a field walkdown.
  source_reference text,
  established_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- One current baseline per asset per kind. A second "current" as-maintained is
-- not a version history, it is two answers to the same question.
create unique index if not exists idx_cfg_baseline_current
  on configuration_baselines(organization_id, asset_id, baseline_kind)
  where is_current;
create index if not exists idx_cfg_baseline_asset
  on configuration_baselines(organization_id, asset_id);

alter table configuration_baselines enable row level security;
drop policy if exists cfg_baseline_read on configuration_baselines;
create policy cfg_baseline_read on configuration_baselines
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The contents of a baseline (U7.01, U7.03 firmware, U7.10 safety-critical)
-- ---------------------------------------------------------------------------
create table if not exists configuration_items (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  baseline_id bigint not null references configuration_baselines(id) on delete cascade,
  -- Position within the asset: "drive end bearing", "PLC slot 3", "impeller".
  position_ref text not null,
  material_id uuid references materials(id) on delete set null,
  part_number text,
  description text,
  quantity numeric not null default 1 check (quantity > 0),
  serial_number text,
  -- U7.03. Firmware drifts without a work order and is invisible to a CMMS.
  firmware_version text,
  software_version text,
  -- U7.10. Marked HERE rather than on the asset, because criticality is a
  -- property of the item in its position: the same relay is safety-critical in
  -- a trip circuit and not in a lighting panel.
  safety_critical boolean not null default false,
  safety_basis text,
  created_at timestamptz not null default now(),
  -- A safety-critical item without a stated basis is an opinion.
  check (not safety_critical or (safety_basis is not null and btrim(safety_basis) <> ''))
);

create unique index if not exists idx_cfg_item_position
  on configuration_items(baseline_id, position_ref);
create index if not exists idx_cfg_item_org on configuration_items(organization_id);

alter table configuration_items enable row level security;
drop policy if exists cfg_item_read on configuration_items;
create policy cfg_item_read on configuration_items
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U7.04 — approved substitutions
-- ---------------------------------------------------------------------------
create table if not exists approved_substitutions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  specified_material_id uuid not null references materials(id) on delete cascade,
  substitute_material_id uuid not null references materials(id) on delete cascade,
  -- Conditions under which the substitution holds. "Equivalent" without
  -- conditions is how a lower-rated part ends up in a higher-rated duty.
  conditions text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  -- An approval with no expiry is an approval nobody will ever revisit.
  expires_at timestamptz,
  is_bidirectional boolean not null default false,
  created_at timestamptz not null default now(),
  check (specified_material_id <> substitute_material_id)
);

create unique index if not exists idx_subst_pair
  on approved_substitutions(organization_id, specified_material_id, substitute_material_id);

alter table approved_substitutions enable row level security;
drop policy if exists subst_read on approved_substitutions;
create policy subst_read on approved_substitutions
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U7.06 — temporary modifications. The table with teeth.
-- ---------------------------------------------------------------------------
create table if not exists temporary_modifications (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  position_ref text,
  modification_kind text not null check (modification_kind in
    ('jumper', 'bypass', 'defeat', 'temporary_repair', 'software_override',
     'alternative_part', 'temporary_support', 'other')),
  description text not null,
  reason text not null,
  -- A temporary change with no removal date is not temporary. Enforced, not
  -- advised: NOT NULL is the whole point of this table.
  required_removal_by date not null,
  installed_at timestamptz not null default now(),
  installed_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  risk_assessment_ref text,
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  affects_safety_function boolean not null default false,
  created_at timestamptz not null default now(),
  check (removed_at is null or removed_at >= installed_at)
);

create index if not exists idx_tempmod_open
  on temporary_modifications(organization_id, required_removal_by)
  where removed_at is null;

alter table temporary_modifications enable row level security;
drop policy if exists tempmod_read on temporary_modifications;
create policy tempmod_read on temporary_modifications
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U7.07 — red-line drawing control
-- ---------------------------------------------------------------------------
create table if not exists red_line_markups (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  drawing_reference text not null,
  drawing_revision text,
  change_description text not null,
  raised_by uuid references auth.users(id) on delete set null,
  raised_at timestamptz not null default now(),
  status text not null default 'open' check (status in
    ('open', 'in_review', 'incorporated', 'rejected')),
  incorporated_at timestamptz,
  incorporated_revision text,
  created_at timestamptz not null default now(),
  check (status <> 'incorporated' or incorporated_at is not null)
);

create index if not exists idx_redline_open
  on red_line_markups(organization_id, raised_at)
  where status in ('open', 'in_review');

alter table red_line_markups enable row level security;
drop policy if exists redline_read on red_line_markups;
create policy redline_read on red_line_markups
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U7.08 interchangeability and U7.09 model variants
-- ---------------------------------------------------------------------------
create table if not exists model_variants (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  manufacturer text not null,
  model text not null,
  variant_code text not null,
  -- What actually differs. A variant with no stated difference is a duplicate.
  distinguishing_attributes text not null,
  supersedes_variant_code text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_variant_key
  on model_variants(organization_id, manufacturer, model, variant_code);

create table if not exists asset_variant_assignments (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  variant_id bigint not null references model_variants(id) on delete cascade,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists interchangeability_rules (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  from_variant_id bigint not null references model_variants(id) on delete cascade,
  to_variant_id bigint not null references model_variants(id) on delete cascade,
  -- 'full' both ways, 'one_way' from→to only, 'conditional' needs the caveats.
  interchange_kind text not null check (interchange_kind in
    ('full', 'one_way', 'conditional')),
  conditions text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_variant_id <> to_variant_id),
  -- A conditional interchange without the conditions written down is worse
  -- than no rule: it reads as permission.
  check (interchange_kind <> 'conditional'
         or (conditions is not null and btrim(conditions) <> ''))
);

create unique index if not exists idx_interchange_pair
  on interchangeability_rules(organization_id, from_variant_id, to_variant_id);

alter table model_variants enable row level security;
alter table asset_variant_assignments enable row level security;
alter table interchangeability_rules enable row level security;
drop policy if exists variant_read on model_variants;
create policy variant_read on model_variants
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists variant_assign_read on asset_variant_assignments;
create policy variant_assign_read on asset_variant_assignments
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists interchange_read on interchangeability_rules;
create policy interchange_read on interchangeability_rules
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U7.11 — baseline reconciliation, recorded so "when did we last check?" has
-- an answer that is not a shrug.
-- ---------------------------------------------------------------------------
create table if not exists configuration_reconciliations (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  performed_at timestamptz not null default now(),
  performed_by uuid references auth.users(id) on delete set null,
  trigger text not null check (trigger in
    ('outage', 'project', 'audit', 'incident', 'scheduled', 'onboarding')),
  differences_found int not null default 0 check (differences_found >= 0),
  safety_critical_differences int not null default 0
    check (safety_critical_differences >= 0),
  summary text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cfg_recon_asset
  on configuration_reconciliations(organization_id, asset_id, performed_at desc);

alter table configuration_reconciliations enable row level security;
drop policy if exists cfg_recon_read on configuration_reconciliations;
create policy cfg_recon_read on configuration_reconciliations
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Reads. The maths lives in TypeScript where it is unit-tested; these return
-- facts, and each one distinguishes "nothing wrong" from "nothing recorded".
-- ---------------------------------------------------------------------------
drop function if exists get_configuration_posture();
create or replace function get_configuration_posture()
returns table (
  assets_total bigint,
  assets_with_designed bigint,
  assets_with_maintained bigint,
  assets_comparable bigint,
  open_temporary_mods bigint,
  overdue_temporary_mods bigint,
  overdue_safety_mods bigint,
  oldest_overdue_days int,
  open_red_lines bigint,
  oldest_red_line_days int,
  expired_substitutions bigint,
  assets_never_reconciled bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  a as (select count(*)::bigint n from assets where organization_id = (select id from org)),
  bl as (
    select
      count(distinct asset_id) filter (where baseline_kind = 'as_designed' and is_current)::bigint designed,
      count(distinct asset_id) filter (where baseline_kind = 'as_maintained' and is_current)::bigint maintained
    from configuration_baselines where organization_id = (select id from org)
  ),
  comparable as (
    select count(*)::bigint n from (
      select asset_id from configuration_baselines
       where organization_id = (select id from org) and is_current
         and baseline_kind in ('as_designed', 'as_maintained')
       group by asset_id having count(distinct baseline_kind) = 2
    ) x
  ),
  tm as (
    select
      count(*) filter (where removed_at is null)::bigint open_n,
      count(*) filter (where removed_at is null and required_removal_by < current_date)::bigint overdue_n,
      count(*) filter (where removed_at is null and required_removal_by < current_date
                         and affects_safety_function)::bigint overdue_safety,
      coalesce(max(current_date - required_removal_by)
               filter (where removed_at is null and required_removal_by < current_date), 0)::int oldest
    from temporary_modifications where organization_id = (select id from org)
  ),
  rl as (
    select count(*) filter (where status in ('open', 'in_review'))::bigint open_n,
           coalesce(max(extract(day from now() - raised_at))
                    filter (where status in ('open', 'in_review')), 0)::int oldest
    from red_line_markups where organization_id = (select id from org)
  ),
  sb as (
    select count(*) filter (where expires_at is not null and expires_at < now())::bigint expired
    from approved_substitutions where organization_id = (select id from org)
  ),
  nr as (
    select count(*)::bigint n from assets x
    where x.organization_id = (select id from org)
      and not exists (select 1 from configuration_reconciliations r
                      where r.asset_id = x.id)
  )
  select a.n, bl.designed, bl.maintained, comparable.n,
         tm.open_n, tm.overdue_n, tm.overdue_safety, tm.oldest,
         rl.open_n, rl.oldest, sb.expired, nr.n,
         case
           when bl.designed = 0 then
             'No asset has an as-designed configuration baseline. Configuration drift is '
             || 'undefined without one — the finding is "no baseline", which is not the same '
             || 'as "no drift", though the two look identical on a dashboard.'
           when comparable.n = 0 then
             bl.designed || ' asset(s) have an as-designed baseline but none also has a current '
             || 'as-maintained one, so nothing can be compared yet.'
           else
             comparable.n || ' of ' || a.n || ' assets can be compared (both a current as-designed '
             || 'and as-maintained baseline). The rest are unassessed, not clean.'
         end
         || case when tm.overdue_n > 0 then
              ' ' || tm.overdue_n || ' temporary modification'
              || case when tm.overdue_n = 1
                      then ' is past its removal date, by '
                      else 's are past their removal date, the oldest by ' end
              || tm.oldest || ' days'
              || case when tm.overdue_safety > 0
                      then ', and ' || tm.overdue_safety
                           || case when tm.overdue_safety = 1
                                   then ' of those defeats' else ' of those defeat' end
                           || ' a safety function'
                      else '' end
              || '.' else '' end
  from a, bl, comparable, tm, rl, sb, nr;
$$;

grant execute on function get_configuration_posture() to authenticated;

-- The two current baselines for one asset, shaped for the comparison engine.
create or replace function get_asset_configuration(p_asset_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'assetId', p_asset_id,
    'baselines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', b.baseline_kind,
        'revision', b.revision,
        'effectiveFrom', b.effective_from,
        'sourceReference', b.source_reference,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'positionRef', i.position_ref,
            'partNumber', i.part_number,
            'materialId', i.material_id,
            'description', i.description,
            'quantity', i.quantity,
            'serialNumber', i.serial_number,
            'firmwareVersion', i.firmware_version,
            'softwareVersion', i.software_version,
            'safetyCritical', i.safety_critical,
            'safetyBasis', i.safety_basis
          ) order by i.position_ref)
          from configuration_items i where i.baseline_id = b.id
        ), '[]'::jsonb)
      ))
      from configuration_baselines b
      where b.asset_id = p_asset_id and b.is_current
        and b.organization_id = app_current_org()
    ), '[]'::jsonb),
    'substitutions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'specified', ms.material_code, 'substitute', mu.material_code,
        'conditions', s.conditions, 'expiresAt', s.expires_at,
        'bidirectional', s.is_bidirectional))
      from approved_substitutions s
      join materials ms on ms.id = s.specified_material_id
      join materials mu on mu.id = s.substitute_material_id
      where s.organization_id = app_current_org()
    ), '[]'::jsonb),
    'lastReconciliation', (
      select jsonb_build_object('performedAt', r.performed_at, 'trigger', r.trigger,
                                'differencesFound', r.differences_found)
      from configuration_reconciliations r
      where r.asset_id = p_asset_id and r.organization_id = app_current_org()
      order by r.performed_at desc limit 1
    )
  );
$$;

grant execute on function get_asset_configuration(uuid) to authenticated;

-- Open temporary modifications and red lines, worst first.
drop function if exists get_configuration_exceptions(int);
create or replace function get_configuration_exceptions(p_limit int default 25)
returns table (
  kind text,
  asset_name text,
  detail text,
  days_overdue int,
  safety boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select 'temporary_modification'::text,
         a.name,
         t.modification_kind || ' — ' || t.description
           || coalesce(' (' || t.position_ref || ')', ''),
         (current_date - t.required_removal_by)::int,
         t.affects_safety_function
  from temporary_modifications t
  join assets a on a.id = t.asset_id
  where t.organization_id = app_current_org() and t.removed_at is null
  union all
  select 'red_line'::text,
         coalesce(a.name, '(no asset)'),
         r.drawing_reference || ' — ' || r.change_description,
         extract(day from now() - r.raised_at)::int,
         false
  from red_line_markups r
  left join assets a on a.id = r.asset_id
  where r.organization_id = app_current_org() and r.status in ('open', 'in_review')
  order by 5 desc, 4 desc
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function get_configuration_exceptions(int) to authenticated;

notify pgrst, 'reload schema';
