-- ============================================================================
-- Unit-numbering rules as per-organization master data
-- (register E12.02 equipment naming standards, U20 layered packs).
--
-- WHY THIS IS CONFIGURATION AND NOT CODE.
--
-- Every asset-intensive operator encodes meaning in its unit numbers, and the
-- encoding is different at every one of them. At this operator the leading
-- digits mean:
--
--   53xx  Caterpillar D8          55xx  Caterpillar D10
--   56xx  Caterpillar D11         72xx  Caterpillar 16H/M grader
--   73xx  Caterpillar 24H/M grader
--   6xxx  backhoes, excavators and shovels — Komatsu, Hitachi AND Caterpillar
--
-- At the next customer those same digits will mean something else entirely.
-- So the rules live in a table, scoped to an organization, with the source of
-- the rule recorded — not in a function somebody has to edit per tenant.
--
-- WHAT THE RULES DELIBERATELY CANNOT DO.
--
-- The 6-series covers three manufacturers. A rule may therefore carry a class
-- and no manufacturer, and the derivation leaves make and model NULL rather
-- than picking one. Deriving "Komatsu" for a machine that is a Hitachi would
-- be worse than leaving it blank, because a blank is visibly missing and a
-- wrong make quietly poisons the shared-design common-cause analysis in U3 and
-- the sole-source analysis in E7.
--
-- NOTHING IS OVERWRITTEN. The derivation only fills columns that are NULL, and
-- every derived value records where it came from, so a connector or a person
-- can supersede it later and the provenance survives.
--
-- Canonical reuse: assets, asset_class_assignments from U3,
-- duplicate_asset_candidates from E12, app_current_org(). Additive.
-- ============================================================================

create table if not exists unit_numbering_rules (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Leading digits of the unit number this rule claims.
  number_prefix text not null,
  -- What the operator says that prefix means.
  expected_class text,
  manufacturer text,
  model text,
  -- Null manufacturer with a note is a legitimate rule: it says the prefix
  -- identifies a family but not a make.
  ambiguity_note text,
  -- Who said so. A numbering rule with no source is folklore.
  source text not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_unrule_prefix
  on unit_numbering_rules(organization_id, number_prefix, effective_from);

alter table unit_numbering_rules enable row level security;
drop policy if exists unrule_read on unit_numbering_rules;
create policy unrule_read on unit_numbering_rules
  for select to authenticated using (organization_id = app_current_org());

-- Provenance for anything this derivation writes.
create table if not exists derived_asset_attributes (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  attribute text not null,
  value text not null,
  derived_from text not null,
  derived_at timestamptz not null default now(),
  -- Set when a person or a connector later supersedes the derived value.
  superseded_at timestamptz,
  superseded_by_source text
);

create index if not exists idx_derattr
  on derived_asset_attributes(organization_id, asset_id, attribute);

alter table derived_asset_attributes enable row level security;
drop policy if exists derattr_read on derived_asset_attributes;
create policy derattr_read on derived_asset_attributes
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Apply the rules. Definer because the caller holds read-only RLS on assets by
-- design; every write is scoped to app_current_org() and only ever fills a
-- NULL column.
-- ---------------------------------------------------------------------------
create or replace function apply_unit_numbering(p_dry_run boolean default true)
returns table (
  outcome text,
  assets_matched bigint,
  tags_set bigint,
  makes_set bigint,
  models_set bigint,
  class_mismatches bigint,
  unmatched bigint,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_matched bigint := 0; v_tags bigint := 0; v_makes bigint := 0;
  v_models bigint := 0; v_mismatch bigint := 0; v_unmatched bigint := 0;
  r record;
  v_mismatch_detail text := '';
  v_unmatched_detail text := '';
begin
  if v_org is null then
    return query select 'error'::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
                        0::bigint, 0::bigint, 'No organization in session.'::text;
    return;
  end if;

  for r in
    select a.id, a.name, a.asset_class, a.tag, a.manufacturer, a.model,
           (regexp_match(a.name, '([0-9]{3,6})'))[1] num,
           ru.expected_class, ru.manufacturer rule_make, ru.model rule_model,
           ru.number_prefix, ru.source, ru.ambiguity_note
    from assets a
    left join lateral (
      select * from unit_numbering_rules u
      where u.organization_id = a.organization_id
        and (regexp_match(a.name, '([0-9]{3,6})'))[1] is not null
        and (regexp_match(a.name, '([0-9]{3,6})'))[1] like u.number_prefix || '%'
      -- Longest prefix wins: 53 beats 5.
      order by length(u.number_prefix) desc, u.effective_from desc
      limit 1
    ) ru on true
    where a.organization_id = v_org
  loop
    if r.num is null or r.number_prefix is null then
      v_unmatched := v_unmatched + 1;
      if length(v_unmatched_detail) < 200 then
        v_unmatched_detail := v_unmatched_detail || r.name || '; ';
      end if;
      continue;
    end if;

    v_matched := v_matched + 1;

    -- The class the rule expects against the class actually recorded. A
    -- disagreement is reported, never silently corrected: the rule may be
    -- incomplete or the class may be wrong, and only a person knows which.
    if r.expected_class is not null and r.asset_class is not null
       and lower(r.expected_class) <> lower(r.asset_class) then
      v_mismatch := v_mismatch + 1;
      if length(v_mismatch_detail) < 300 then
        v_mismatch_detail := v_mismatch_detail
          || r.name || ' is recorded as "' || r.asset_class
          || '" but prefix ' || r.number_prefix || ' means "' || r.expected_class || '"; ';
      end if;
    end if;

    if not p_dry_run then
      -- Tag: only where absent.
      if r.tag is null or btrim(r.tag) = '' then
        update assets set tag = r.num where id = r.id;
        insert into derived_asset_attributes (organization_id, asset_id, attribute,
          value, derived_from)
        values (v_org, r.id, 'tag', r.num,
                'Unit number parsed from the asset name. Source of the numbering scheme: ' || r.source);
        v_tags := v_tags + 1;
      end if;

      -- Make and model: only where the rule is unambiguous AND the column is
      -- empty. A rule with no manufacturer leaves both NULL on purpose.
      if r.rule_make is not null and (r.manufacturer is null or btrim(r.manufacturer) = '') then
        update assets set manufacturer = r.rule_make where id = r.id;
        insert into derived_asset_attributes (organization_id, asset_id, attribute,
          value, derived_from)
        values (v_org, r.id, 'manufacturer', r.rule_make,
                'Unit-numbering rule ' || r.number_prefix || 'xx. Source: ' || r.source);
        v_makes := v_makes + 1;
      end if;
      if r.rule_model is not null and (r.model is null or btrim(r.model) = '') then
        update assets set model = r.rule_model where id = r.id;
        insert into derived_asset_attributes (organization_id, asset_id, attribute,
          value, derived_from)
        values (v_org, r.id, 'model', r.rule_model,
                'Unit-numbering rule ' || r.number_prefix || 'xx. Source: ' || r.source);
        v_models := v_models + 1;
      end if;
    else
      if r.tag is null or btrim(r.tag) = '' then v_tags := v_tags + 1; end if;
      if r.rule_make is not null and (r.manufacturer is null or btrim(r.manufacturer) = '')
        then v_makes := v_makes + 1; end if;
      if r.rule_model is not null and (r.model is null or btrim(r.model) = '')
        then v_models := v_models + 1; end if;
    end if;
  end loop;

  return query select
    case when p_dry_run then 'dry_run' else 'applied' end::text,
    v_matched, v_tags, v_makes, v_models, v_mismatch, v_unmatched,
    (case when p_dry_run then 'DRY RUN — nothing written. ' else 'Applied. ' end
     || v_matched || ' asset(s) matched a numbering rule; ' || v_tags || ' tag(s), '
     || v_makes || ' manufacturer(s) and ' || v_models || ' model(s) '
     || case when p_dry_run then 'would be' else 'were' end || ' filled. '
     || case when v_mismatch > 0 then v_mismatch
             || ' class disagreement(s) reported and NOT corrected: ' || v_mismatch_detail
             else '' end
     || case when v_unmatched > 0 then v_unmatched
             || ' asset(s) matched no rule: ' || v_unmatched_detail else '' end
     || 'Nothing already populated was overwritten.')::text;
end;
$$;

grant execute on function apply_unit_numbering(boolean) to authenticated;

notify pgrst, 'reload schema';
