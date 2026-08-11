-- ============================================================================
-- Twin coverage, reported so a shell cannot pass as a model.
--
-- The obvious query — count assets with a twin, divide by assets — would say
-- 95% for this operator. It would also be useless, because 117 of those twins
-- are compiled from templates that carry no components: they name the machine
-- and have nothing to reason about. So this returns the component and failure-
-- mode counts alongside the tally and lets the engine decide what counts.
--
-- Canonical reuse: asset_twin_instances/templates, asset_class_twin_map,
-- app_current_org(). Read-only.
-- ============================================================================

drop function if exists get_twin_coverage();
create or replace function get_twin_coverage()
returns table (
  "templateKey" text,
  fit text,
  "componentCount" int,
  "failureModeCount" int,
  "hasOverlay" boolean,
  "assetCount" int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.template_key,
    coalesce(i.compilation_log->0->>'fit', 'direct'),
    coalesce(jsonb_array_length(t.template->'components'), 0)::int,
    coalesce((
      select sum(coalesce(jsonb_array_length(c->'failureModes'), 0))
      from jsonb_array_elements(coalesce(t.template->'components','[]'::jsonb)) c
    ), 0)::int,
    bool_or(i.overlay_id is not null),
    count(*)::int
  from asset_twin_instances i
  join asset_twin_templates t on t.id = i.template_id
  where i.organization_id = app_current_org()
  -- Grouped by fit as well as template: two assets on the same template with
  -- different class fits are two different claims, and collapsing them lets one
  -- fit stand in for both by accident of aggregation.
  group by t.template_key, t.template, i.compilation_log->0->>'fit'
  order by count(*) desc;
$$;

grant execute on function get_twin_coverage() to authenticated;

-- Assets in scope, and the class-mapping decisions that gave some of them no
-- twin at all. A refusal is part of the picture, not an absence from it.
drop function if exists get_twin_class_map();
create or replace function get_twin_class_map()
returns table (
  "localClass" text,
  "templateKey" text,
  fit text,
  rationale text,
  source text,
  "assetCount" int
)
language sql
stable
security definer
set search_path = public
as $$
  select m.local_class, m.template_key, m.fit, m.rationale, m.source,
         (select count(*)::int from assets a
          where a.organization_id = m.organization_id
            and a.asset_class = m.local_class)
  from asset_class_twin_map m
  where m.organization_id = app_current_org()
  order by 6 desc;
$$;

grant execute on function get_twin_class_map() to authenticated;

-- Total assets, so coverage has a denominator that is not itself derived from
-- the twins.
drop function if exists get_twin_asset_total();
create or replace function get_twin_asset_total()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from assets where organization_id = app_current_org();
$$;

grant execute on function get_twin_asset_total() to authenticated;

notify pgrst, 'reload schema';
