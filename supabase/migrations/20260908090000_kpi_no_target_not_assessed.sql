-- ============================================================================
-- A KPI with no target cannot be "on target" (executive KPI honesty).
--
-- compute_kpi_snapshot decides status by comparing a value to a threshold, and
-- ends with:
--
--   else 'on_target'  -- trend KPIs (Increase/Decrease with no absolute bound)
--
-- So every KPI whose direction is a TREND rather than a bound is stamped green
-- unconditionally — MTTR ('Decrease', target_high null), MTBF ('Increase',
-- target_low null), asset_risk_index and the rest. Not because anything was
-- measured against anything. Because there was nothing to measure against, and
-- green was the default.
--
-- The executive panel therefore reports "MTTR · 0 hours · On target" for an
-- organization that has recorded no closeout durations at all. Zero hours to
-- repair is not an achievement, it is an absence, and it renders in the same
-- green as a genuine pass. That is exactly the failure the rest of this
-- platform refuses: work-management health marks a proxy PROXY, the knowledge
-- base declines a claim it cannot source, the ingest contract keeps every
-- rejected row — and then the executive summary shows an unmeasured number as
-- success, to the audience least able to check it and most damaged by it.
--
-- 'not_assessed' names the case the code always had and never admitted: the
-- value is real and is still shown with its lineage; what it stops doing is
-- claiming to be good.
--
-- Breach routing is untouched — it fires on 'breach' only, so nothing that
-- raised a HITL recommendation before stops now.
-- ============================================================================

alter table kpi_values drop constraint if exists kpi_values_status_check;
alter table kpi_values
  add constraint kpi_values_status_check
  check (status in ('on_target', 'watch', 'breach', 'not_assessed'));

-- ---------------------------------------------------------------------------
-- One predicate, defined once: is this KPI judged against an actual bound?
-- ---------------------------------------------------------------------------
create or replace function public.kpi_has_bound(p_kpi_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when k.direction = 'up' then k.target_low is not null
    when k.direction = 'down' then k.target_high is not null
    when k.direction = 'range' then k.target_low is not null and k.target_high is not null
    else false
  end
  from kpi_catalog k where k.kpi_key = p_kpi_key;
$$;

-- Historical rows stamped green by the default rather than by a comparison.
update kpi_values v
   set status = 'not_assessed'
 where v.status = 'on_target'
   and not coalesce(kpi_has_bound(v.kpi_key), false);

-- ---------------------------------------------------------------------------
-- The same rule on every future run.
--
-- Renamed once and wrapped rather than reproducing five hundred lines of
-- metric arithmetic to change one branch — the idiom 20260811090000 used for
-- planning accuracy. compute_kpi_snapshot loops EVERY organization and is
-- cron-only (execute was revoked from authenticated at 00000000000017:369);
-- both properties are preserved deliberately, so no org filter is applied here
-- and no grant is issued.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.compute_kpi_snapshot_bounded()') is null then
    alter function public.compute_kpi_snapshot()
      rename to compute_kpi_snapshot_bounded;
  end if;
end $$;

create or replace function public.compute_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_reclassified int;
begin
  v_result := compute_kpi_snapshot_bounded();

  with corrected as (
    update kpi_values v
       set status = 'not_assessed'
     where v.status = 'on_target'
       and not coalesce(kpi_has_bound(v.kpi_key), false)
    returning 1
  )
  select count(*) into v_reclassified from corrected;

  return v_result || jsonb_build_object('not_assessed', v_reclassified);
end
$$;

revoke execute on function public.compute_kpi_snapshot() from public, anon, authenticated;

notify pgrst, 'reload schema';
