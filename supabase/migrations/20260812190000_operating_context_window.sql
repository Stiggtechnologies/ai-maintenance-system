-- ============================================================================
-- Fix: distinguish "no state records" from "no state records IN THIS WINDOW"
-- (capability register C2.04, E3.02).
--
-- get_operating_context asked about a trailing window from now() and, finding
-- nothing, reported "No operating-state record for this asset." Loading the
-- auxiliary fleet — 21,450 real state records spanning 2010 to 2012 — proved
-- that message wrong: the records exist in their hundreds, they simply sit
-- outside a 900-day trailing window.
--
-- Reporting "no records" when the truth is "none in the period you asked
-- about" is precisely the class of plausible-but-wrong statement this platform
-- refuses everywhere else. The two cases now read differently, and the
-- function volunteers the span it does hold so the caller can ask a question
-- the data can answer.
-- ============================================================================

create or replace function public.get_operating_context(
  p_asset_id uuid,
  p_window_days int default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_from timestamptz := now() - make_interval(days => greatest(p_window_days, 1));
  v_window_hours numeric := greatest(p_window_days, 1) * 24.0;
  v_covered numeric;
  v_rows jsonb;
  v_starts int;
  v_total int;
  v_span_from timestamptz;
  v_span_to timestamptz;
begin
  if not exists (select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return jsonb_build_object('error', 'asset not found');
  end if;

  -- What exists at all, independent of the window asked about.
  select count(*), min(started_at), max(coalesce(ended_at, started_at))
  into v_total, v_span_from, v_span_to
  from operating_states
  where organization_id = v_org and asset_id = p_asset_id;

  select coalesce(sum(extract(epoch from
      (least(coalesce(ended_at, now()), now()) - greatest(started_at, v_from))) / 3600.0), 0)
  into v_covered
  from operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and coalesce(ended_at, now()) > v_from;

  select coalesce(jsonb_agg(jsonb_build_object(
    'state', state, 'hours', hrs,
    'pct_of_covered', case when v_covered > 0 then round(100.0 * hrs / v_covered, 1) end)
    order by hrs desc), '[]'::jsonb)
  into v_rows
  from (
    select state,
           round(sum(extract(epoch from
             (least(coalesce(ended_at, now()), now()) - greatest(started_at, v_from))) / 3600.0)::numeric, 1) as hrs
    from operating_states
    where organization_id = v_org and asset_id = p_asset_id
      and coalesce(ended_at, now()) > v_from
    group by state) t;

  select count(*) into v_starts
  from operating_states
  where organization_id = v_org and asset_id = p_asset_id
    and state = 'running' and started_at >= v_from;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'window_days', greatest(p_window_days, 1),
    'states', v_rows,
    'starts_in_window', v_starts,
    'hours_covered', round(v_covered, 1),
    'coverage_pct', round(100.0 * v_covered / v_window_hours, 1),
    -- Volunteered so the caller can ask a question the data can answer.
    'records_total', v_total,
    'data_span_from', v_span_from,
    'data_span_to', v_span_to,
    'basis', case
      when v_total = 0
        then 'No operating-state record exists for this asset. The platform does not assume an asset with no state record was running.'
      when v_covered = 0
        then format('This asset holds %s state records, but none fall inside the %s-day window requested — its history runs %s to %s. That is a different fact from having no history, and the two are not reported the same way.',
             v_total, greatest(p_window_days, 1), v_span_from::date, v_span_to::date)
      when v_covered / v_window_hours < 0.5
        then format('Only %s%% of the window is covered by state records — the percentages below describe the covered portion, not the period.',
             round(100.0 * v_covered / v_window_hours, 1))
      else 'State records cover the window.' end);
end
$$;

grant execute on function public.get_operating_context(uuid, int) to authenticated;

notify pgrst, 'reload schema';
