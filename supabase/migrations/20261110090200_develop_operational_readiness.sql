-- ============================================================================
-- Sync Develop Slice 1 — Operational Readiness toward case scope
-- (D8.08 / D8.11, spec §30 + §48 + §81, overlap-map ruling 17).
--
-- Ruling 17 is binding and total: the onboarding requirement catalog
-- (`onboarding_requirements`, 00000000000011) + `asset_onboarding_items` +
-- the `get_golive_readiness` family ARE the readiness-item machinery. A
-- parallel readiness-item store is forbidden and none is created. This file:
--
--   1. Maps the catalog onto the spec-§30 categories. A new `ori_category`
--      column carries the thirteen §30 values (asset_master, bom, spares,
--      pm, task_list, procedure, training, inspection, condition_monitoring,
--      vendor_support, documentation, cyber, emergency_response). The
--      mapping of EXISTING keys is per-key and honest — only keys whose
--      content IS the §30 category are mapped; everything else stays NULL
--      and rolls up VISIBLY as 'uncategorized (platform)' rather than being
--      force-fitted or silently dropped. (Reliability/availability data,
--      FMEA, AI configuration, work-management integration are platform
--      onboarding sections §30 does not name; pretending they are §30
--      categories would be a dishonest mapping in the other direction.)
--
--   2. Adds catalog entries ONLY for the §30 categories the catalog did not
--      already carry anywhere. Surveyed across BOTH catalog migrations
--      (00000000000011 sections 1–19 AND 00000000000012 sections 20–32):
--      cyber is already s30 'Cybersecurity & Access' (six items — mapped,
--      not duplicated); training is already s31 'Training & Adoption'
--      (mapped, not duplicated); what is genuinely absent is operating
--      procedures/task lists as executable documents, a first-line
--      inspection program, vendor support arrangements, and emergency
--      response. New sections start at 33 — the catalog's own numbering
--      already runs to 32. All new entries are required_for_golive = FALSE — the
--      approve_asset_golive gate keeps exactly its current strictness, so
--      no asset that was approvable yesterday becomes blocked today by this
--      migration (changing a live gate's threshold is not this file's
--      mandate). Safety-relevant items instead carry the new
--      `safety_mission_critical` flag, which the §81 view renders as HARD
--      BLOCKERS by name.
--
--   3. `safety_mission_critical` on the catalog: TRUE only where the item's
--      own content is a safety or mission determination — the safety-
--      critical classification itself, LOTO/isolation points, statutory
--      inspections, and the emergency-response items. Nothing else is
--      promoted to safety by relabeling (the s30 security controls stay
--      security controls; calling them safety would be the same over-claim
--      in a different direction).
--
--   4. Backfills asset_onboarding_items for assets already onboarding, so
--      the new catalog keys exist as OPEN items on them (absence is not a
--      pass); start_asset_onboarding already seeds the full catalog for new
--      assets.
--
--   5. Case scope: `development_case_assets` — the MEMBERSHIP of assets in
--      a development case's operational-readiness scope. This is scope
--      binding (which assets the case delivers), not a readiness store; the
--      readiness items stay asset_onboarding_items. Binding follows the
--      D5.22 idiom (bind_risk_to_development_case, 20261105090200): an
--      audited definer RPC, bind/unbind-with-reason, and NO client write
--      policy on the table — safe by construction, verified so. Binding is
--      not a §70 determination (nothing passes or is accepted by binding),
--      so it carries no provenance trigger — the same weight the risk
--      binding carries.
--
--   6. `get_case_operational_readiness(p_case_id)` EXTENDS the
--      get_golive_readiness family (same satisfied-status set, same
--      SECURITY DEFINER + session-org posture, wider inputs per D8.11):
--      per-§30-category honest counts ("BOM 64%" = satisfied/total, no
--      weighting invented), per-asset go-live summaries, and hard blockers
--      NAMED (open required_for_golive items + open safety_mission_critical
--      items, each with its asset and label). A missing item row counts as
--      OPEN — a catalog requirement nobody seeded is not satisfied by its
--      absence.
--
-- FIRST-CUT BOUNDARY, stated for the register: scope is per-ASSET membership
-- on the case. Per-commissioning-SYSTEM scope (spec §30's system_id) needs
-- the commissioning-system decomposition, which is Slice 8 (D8.06); the §48
-- nine-factor weighted ORI likewise stays open there. D8.08/D8.11 remain 🟡
-- with exactly that caveat.
-- ============================================================================

alter table public.onboarding_requirements
  add column if not exists ori_category text
    check (ori_category is null or ori_category in
      ('asset_master','bom','spares','pm','task_list','procedure','training',
       'inspection','condition_monitoring','vendor_support','documentation',
       'cyber','emergency_response')),
  add column if not exists safety_mission_critical boolean not null default false;

-- Per-key honest mapping of the existing catalog (idempotent by value).
update onboarding_requirements set ori_category = 'asset_master'
  where section_number in (1, 2, 3, 4, 5) and ori_category is distinct from 'asset_master';
update onboarding_requirements set ori_category = 'bom'
  where key = 's14_bom' and ori_category is distinct from 'bom';
update onboarding_requirements set ori_category = 'spares'
  where key in ('s14_critical_spares','s14_reorder_points','s14_storage_requirements')
    and ori_category is distinct from 'spares';
update onboarding_requirements set ori_category = 'pm'
  where key in ('s10_strategy_assigned','s10_pm_tasks_linked') and ori_category is distinct from 'pm';
update onboarding_requirements set ori_category = 'task_list'
  where key = 's10_task_details' and ori_category is distinct from 'task_list';
update onboarding_requirements set ori_category = 'inspection'
  where key = 's10_statutory_inspections' and ori_category is distinct from 'inspection';
update onboarding_requirements set ori_category = 'condition_monitoring'
  where section_number = 11 and ori_category is distinct from 'condition_monitoring';
update onboarding_requirements set ori_category = 'documentation'
  where key in ('s15_core_documents','s15_drawings','s15_certificates')
    and ori_category is distinct from 'documentation';
update onboarding_requirements set ori_category = 'procedure'
  where key = 's15_procedures' and ori_category is distinct from 'procedure';
update onboarding_requirements set ori_category = 'cyber'
  where key = 's16_cybersecurity_class' and ori_category is distinct from 'cyber';
-- Section 30 'Cybersecurity & Access' (00000000000012) IS the cyber
-- readiness section — mapped, never duplicated.
update onboarding_requirements set ori_category = 'cyber'
  where section_number = 30 and ori_category is distinct from 'cyber';
-- Section 31 'Training & Adoption' carries the training readiness item.
update onboarding_requirements set ori_category = 'training'
  where key = 's31_role_training' and ori_category is distinct from 'training';

-- Safety/mission-critical flags on existing keys whose content is safety.
update onboarding_requirements set safety_mission_critical = true
  where key in ('s16_safety_critical','s16_loto_requirements','s10_statutory_inspections')
    and not safety_mission_critical;

-- The missing §30 categories become catalog entries (required_for_golive
-- FALSE — see header; safety items carry the flag instead).
insert into onboarding_requirements
  (key, section_number, section_title, item_label, hint, fill_strategy,
   required_for_golive, sort_order, ori_category, safety_mission_critical)
values
  ('s33_operating_procedures', 33, 'Operating Procedures & Task Lists',
   'Operating procedures approved',
   'Start-up, shutdown, normal and upset operation', 'human', false, 10,
   'procedure', false),
  ('s33_maintenance_job_plans', 33, 'Operating Procedures & Task Lists',
   'Maintenance job plans / task lists approved',
   'Executable task lists with steps, parts, tools, acceptance criteria', 'human', false, 20,
   'task_list', false),
  ('s34_first_line_inspections', 34, 'Inspection Program',
   'First-line inspection rounds defined',
   'Operator / maintainer rounds with frequencies and routes', 'human', false, 10,
   'inspection', false),
  ('s35_vendor_support', 35, 'Vendor Support',
   'Vendor support arrangement in place',
   'OEM / vendor contacts, response commitments, parts supply route', 'human', false, 10,
   'vendor_support', false),
  ('s36_emergency_procedures', 36, 'Emergency Response',
   'Emergency response procedures cover this asset',
   'Spill, fire, release, rescue scenarios as applicable', 'human', false, 10,
   'emergency_response', true),
  ('s36_emergency_drill', 36, 'Emergency Response',
   'Emergency response walkthrough completed',
   'Drill or tabletop exercise covering this asset''s scenarios', 'human', false, 20,
   'emergency_response', true)
on conflict (key) do nothing;

-- Assets already onboarding get the new keys as OPEN items (absence is not
-- a pass; start_asset_onboarding seeds the full catalog for future assets).
insert into asset_onboarding_items (organization_id, asset_id, requirement_key)
select s.organization_id, s.asset_id, r.key
from asset_onboarding_state s
cross join onboarding_requirements r
on conflict (asset_id, requirement_key) do nothing;

-- ---------------------------------------------------------------------------
-- Case scope membership (see header §5).
-- ---------------------------------------------------------------------------
create table if not exists public.development_case_assets (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  note text,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, asset_id)
);

create index if not exists idx_dca_case
  on development_case_assets(organization_id, development_case_id);

alter table public.development_case_assets enable row level security;
drop policy if exists development_case_assets_read on public.development_case_assets;
create policy development_case_assets_read on public.development_case_assets
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy exists: binding goes through the audited RPC below.

-- Membership is many-to-many (two concurrent cases can legitimately touch
-- one asset), so unbinding NAMES the case it leaves — p_unbind with both ids
-- — rather than the single-column unbind the risk idiom uses.
create or replace function public.bind_asset_to_development_case(
  p_asset_id uuid,
  p_case_id uuid,
  p_reason text default null,
  p_unbind boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  a assets%rowtype;
  c development_cases%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'binding an asset to a case scope requires a planning, engineering or governance role');
  end if;
  select * into a from assets where id = p_asset_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'asset not found in this organization');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  if coalesce(p_unbind, false) then
    if not exists (select 1 from development_case_assets
                   where development_case_id = c.id and asset_id = a.id) then
      return jsonb_build_object('error', 'this asset is not in that case''s scope');
    end if;
    if coalesce(length(btrim(p_reason)), 0) < 10 then
      return jsonb_build_object('error',
        'removing an asset from a case scope records why (10 characters minimum) — the scope is what the case''s operational readiness was judged against');
    end if;
    delete from development_case_assets
    where asset_id = a.id and development_case_id = c.id and organization_id = v_org;
    insert into audit_events (organization_id, entity_type, actor, event_data)
    values (v_org, 'case_asset_scope', coalesce(v_role, 'unknown'),
      jsonb_build_object('asset_id', a.id, 'action', 'unbound',
        'case_id', c.id, 'reason', btrim(p_reason)));
    return jsonb_build_object('asset_id', a.id, 'development_case_id', null);
  end if;

  if c.status in ('cancelled','completed') then
    return jsonb_build_object('error', 'assets are not bindable to a ' || c.status || ' case');
  end if;
  if exists (select 1 from development_case_assets
             where development_case_id = c.id and asset_id = a.id) then
    return jsonb_build_object('error', 'this asset is already in that case''s scope');
  end if;

  insert into development_case_assets
    (organization_id, development_case_id, asset_id, note, added_by)
  values
    (v_org, c.id, a.id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());

  -- The asset's readiness checklist must exist for the case view to count
  -- honestly; the family's own seeder is idempotent.
  perform start_asset_onboarding(a.id);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_asset_scope', coalesce(v_role, 'unknown'),
    jsonb_build_object('asset_id', a.id, 'action', 'bound', 'case_id', c.id,
      'asset_name', a.name, 'asset_tag', a.tag));

  return jsonb_build_object('asset_id', a.id, 'development_case_id', c.id);
end
$$;

revoke all on function public.bind_asset_to_development_case(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.bind_asset_to_development_case(uuid, uuid, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The §81 read: per-category honest counts + named hard blockers + per-asset
-- go-live summaries, one query. Same family, same satisfied-status set as
-- get_golive_readiness; a missing item row counts as OPEN.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_operational_readiness(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_asset_count int;
  v_categories jsonb;
  v_assets jsonb;
  v_hard jsonb;
  v_overall jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*) into v_asset_count
  from development_case_assets ca
  where ca.development_case_id = c.id and ca.organization_id = v_org;

  if v_asset_count = 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'assetCount', 0,
      'assets', '[]'::jsonb,
      'categories', '[]'::jsonb,
      'hardBlockers', '[]'::jsonb,
      'overall', null,
      'note', 'no assets are bound to this case''s operational-readiness scope yet — bind the assets the case delivers to see their readiness here');
  end if;

  -- Per-§30-category counts over catalog × member assets. LEFT JOIN to
  -- items: a requirement never seeded for an asset is OPEN, not invisible.
  select coalesce(jsonb_agg(row_obj order by cat_rank, category), '[]'::jsonb)
  into v_categories
  from (
    select
      coalesce(r.ori_category, 'uncategorized') as category,
      case coalesce(r.ori_category, 'uncategorized')
        when 'asset_master' then 1 when 'bom' then 2 when 'spares' then 3
        when 'pm' then 4 when 'task_list' then 5 when 'procedure' then 6
        when 'training' then 7 when 'inspection' then 8
        when 'condition_monitoring' then 9 when 'vendor_support' then 10
        when 'documentation' then 11 when 'cyber' then 12
        when 'emergency_response' then 13 else 99 end as cat_rank,
      jsonb_build_object(
        'category', coalesce(r.ori_category, 'uncategorized'),
        'total', count(*),
        'satisfied', count(*) filter (where i.status in
          ('auto_filled','deduced','human_provided','not_applicable')),
        'pct', round((count(*) filter (where i.status in
          ('auto_filled','deduced','human_provided','not_applicable')))::numeric
          * 100 / count(*), 1),
        'safetyOpen', count(*) filter (where r.safety_mission_critical
          and coalesce(i.status, 'missing') not in
          ('auto_filled','deduced','human_provided','not_applicable')),
        'goliveRequiredOpen', count(*) filter (where r.required_for_golive
          and coalesce(i.status, 'missing') not in
          ('auto_filled','deduced','human_provided','not_applicable'))
      ) as row_obj
    from development_case_assets ca
    join assets a on a.id = ca.asset_id and a.organization_id = v_org
    cross join onboarding_requirements r
    left join asset_onboarding_items i
      on i.asset_id = a.id and i.requirement_key = r.key
    where ca.development_case_id = c.id and ca.organization_id = v_org
    group by coalesce(r.ori_category, 'uncategorized')
  ) grouped;

  -- Named hard blockers: open go-live-required + open safety/mission-critical
  -- items, each carrying its asset and label. Capped at 100 rows with the
  -- true count beside them, so the list stays renderable without hiding the
  -- size of the problem.
  select coalesce(jsonb_agg(blocker order by is_safety desc, asset_name, label), '[]'::jsonb)
  into v_hard
  from (
    select
      r.safety_mission_critical as is_safety,
      a.name as asset_name,
      r.item_label as label,
      jsonb_build_object(
        'assetId', a.id,
        'asset', a.name,
        'assetTag', a.tag,
        'item', r.item_label,
        'section', r.section_title,
        'category', coalesce(r.ori_category, 'uncategorized'),
        'status', coalesce(i.status, 'missing'),
        'kind', case when r.safety_mission_critical then 'safety_mission_critical'
                     else 'golive_required' end) as blocker
    from development_case_assets ca
    join assets a on a.id = ca.asset_id and a.organization_id = v_org
    cross join onboarding_requirements r
    left join asset_onboarding_items i
      on i.asset_id = a.id and i.requirement_key = r.key
    where ca.development_case_id = c.id and ca.organization_id = v_org
      and (r.required_for_golive or r.safety_mission_critical)
      and coalesce(i.status, 'missing') not in
        ('auto_filled','deduced','human_provided','not_applicable')
    limit 100
  ) blockers;

  -- Per-asset go-live summary: the same counting get_golive_readiness does,
  -- widened to the case's members.
  select coalesce(jsonb_agg(jsonb_build_object(
      'assetId', a.id,
      'name', a.name,
      'tag', a.tag,
      'required', stats.required,
      'requiredSatisfied', stats.required_satisfied,
      'ready', stats.required > 0 and stats.required_satisfied = stats.required,
      'total', stats.total,
      'satisfied', stats.satisfied)
      order by a.name), '[]'::jsonb)
  into v_assets
  from development_case_assets ca
  join assets a on a.id = ca.asset_id and a.organization_id = v_org
  cross join lateral (
    select
      count(*) filter (where r.required_for_golive) as required,
      count(*) filter (where r.required_for_golive and i.status in
        ('auto_filled','deduced','human_provided','not_applicable')) as required_satisfied,
      count(*) as total,
      count(*) filter (where i.status in
        ('auto_filled','deduced','human_provided','not_applicable')) as satisfied
    from onboarding_requirements r
    left join asset_onboarding_items i
      on i.asset_id = a.id and i.requirement_key = r.key
  ) stats
  where ca.development_case_id = c.id and ca.organization_id = v_org;

  select jsonb_build_object(
    'total', count(*),
    'satisfied', count(*) filter (where i.status in
      ('auto_filled','deduced','human_provided','not_applicable')),
    'pct', round((count(*) filter (where i.status in
      ('auto_filled','deduced','human_provided','not_applicable')))::numeric
      * 100 / greatest(count(*), 1), 1),
    'hardBlockerCount', count(*) filter (where
      (r.required_for_golive or r.safety_mission_critical)
      and coalesce(i.status, 'missing') not in
        ('auto_filled','deduced','human_provided','not_applicable')),
    'safetyOpenCount', count(*) filter (where r.safety_mission_critical
      and coalesce(i.status, 'missing') not in
        ('auto_filled','deduced','human_provided','not_applicable')))
  into v_overall
  from development_case_assets ca
  join assets a on a.id = ca.asset_id and a.organization_id = v_org
  cross join onboarding_requirements r
  left join asset_onboarding_items i
    on i.asset_id = a.id and i.requirement_key = r.key
  where ca.development_case_id = c.id and ca.organization_id = v_org;

  return jsonb_build_object(
    'caseId', c.id,
    'assetCount', v_asset_count,
    'assets', v_assets,
    'categories', v_categories,
    'hardBlockers', v_hard,
    'overall', v_overall,
    'scopeNote', 'per-asset scope; per-commissioning-system scope completes in Slice 8');
end
$$;

revoke all on function public.get_case_operational_readiness(uuid) from public, anon;
grant execute on function public.get_case_operational_readiness(uuid) to authenticated;

notify pgrst, 'reload schema';
