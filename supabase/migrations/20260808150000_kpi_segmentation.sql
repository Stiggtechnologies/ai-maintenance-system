-- ============================================================================
-- Segmented reliability metrics (capability register C6.26; strengthens
-- C6.17–C6.21).
--
-- Spec §6 closes with a hard requirement: "Metrics must always be segmented by
-- asset class, criticality, site, operating regime and failure mode." Today
-- the KPI service reports organization-scope figures, which hide exactly the
-- variation an engineer needs — a fleet MTBF of 45 h means nothing when one
-- criticality band sits at 31 h and another at 72 h.
--
-- This computes MTBF, MTTR, availability and failure counts per segment,
-- deterministically from coded work-order history, with the same arithmetic
-- the validated reliability engine uses:
--     uptime      = window − downtime
--     MTBF        = uptime / failures
--     MTTR        = downtime / failures
--     availability= uptime / window
--
-- Honesty rules carried from the rest of the platform:
--   * A segment with no corrective history returns no row rather than a
--     flattering default.
--   * `assets_in_segment` and `window_hours` travel with every row so a
--     reader can see the basis and spot thin samples.
--   * Read-only: this function computes, it never writes or recommends.
--
-- Canonical reuse: work_orders, assets, sites, app_current_org(). Additive.
-- ============================================================================

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
  if p_dimension not in ('asset_class', 'criticality', 'site', 'failure_mode') then
    return jsonb_build_object('error',
      'dimension must be one of asset_class, criticality, site, failure_mode');
  end if;

  -- The observation window is DERIVED FROM THE DATA by default. Assuming a
  -- window ending "now" silently returns nothing for any fleet whose history
  -- is not current — an empty result that looks like "no failures" rather
  -- than "you asked about a period this data does not cover". Callers may
  -- still pin a trailing window explicitly with p_window_days.
  if p_window_days is null then
    select min(w.completed_at), max(w.completed_at)
    into v_from, v_to
    from work_orders w
    where w.organization_id = v_org
      and w.work_type = 'corrective'
      and w.completed_at is not null;
    if v_from is null then
      return jsonb_build_object('dimension', p_dimension,
        'segments', '[]'::jsonb,
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
        when 'asset_class'  then coalesce(a.asset_class, 'Unclassified')
        when 'criticality'  then coalesce(a.criticality, 'unrated')
        when 'site'         then coalesce(s.name, 'Unassigned site')
        else                     coalesce(w.actual_failure_mode, 'Uncoded')
      end as segment,
      a.id as asset_id,
      coalesce(w.downtime_hours, 0)::numeric as downtime_hours
    from work_orders w
    join assets a on a.id = w.asset_id
    left join sites s on s.id = a.site_id
    where w.organization_id = v_org
      and w.work_type = 'corrective'
      and w.completed_at is not null
      and w.completed_at between v_from and v_to
  ), agg as (
    select
      segment,
      count(*)::int as failures,
      count(distinct asset_id)::int as assets_in_segment,
      round(sum(downtime_hours)::numeric, 1) as downtime_hours
    from scoped
    group by segment
    having count(*) >= v_min
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.downtime_hours desc), '[]'::jsonb)
  into v_rows
  from (
    select
      segment,
      failures,
      assets_in_segment,
      downtime_hours,
      -- window scales with the number of assets in the segment: each asset
      -- contributes its own calendar exposure.
      round((v_window_hours * assets_in_segment)::numeric, 0) as window_hours,
      round(
        greatest(v_window_hours * assets_in_segment - downtime_hours, 0)
        / failures, 1) as mtbf_hours,
      round(downtime_hours / failures, 1) as mttr_hours,
      round(
        100 * greatest(v_window_hours * assets_in_segment - downtime_hours, 0)
        / (v_window_hours * assets_in_segment), 1) as availability_pct
    from agg
  ) x;

  return jsonb_build_object(
    'dimension', p_dimension,
    'window_days', round(v_window_days, 1),
    'window_from', v_from,
    'window_to', v_to,
    'window_source', case when p_window_days is null then 'derived from data span' else 'caller-specified trailing window' end,
    'min_failures', v_min,
    'basis', 'Corrective work orders with a completion date, coded per the enterprise failure taxonomy. Segments below the minimum-failure threshold are omitted rather than reported on thin evidence.',
    'segments', v_rows);
end
$$;

grant execute on function public.get_segmented_reliability(text, int, int) to authenticated;
