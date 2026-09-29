-- D6.07: a canonical relationship lookup must not silently drop a failure
-- mode because fifteen other modes occurred more frequently. Preserve the
-- existing return contract and invoker/RLS boundary; callers may paginate
-- presentation, but the specification thread must see the complete set.
create or replace function public.get_design_feedback_loop()
returns table (
  failure_mode text,
  occurrences bigint,
  assets_affected bigint,
  requirements_referencing bigint,
  loop_closed boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with modes as (
    select coalesce(nullif(btrim(w.actual_failure_mode), ''), '(uncoded)') fm,
           count(*)::bigint n,
           count(distinct w.asset_id)::bigint assets
    from work_orders w
    where w.organization_id = app_current_org()
      and w.work_type = 'corrective'
    group by 1
  )
  select m.fm, m.n, m.assets,
         (select count(*) from design_requirements d
           where d.organization_id = app_current_org()
             and d.derived_from_failure_mode = m.fm)::bigint,
         exists (select 1 from design_requirements d
                  where d.organization_id = app_current_org()
                    and d.derived_from_failure_mode = m.fm)
  from modes m
  order by m.n desc, m.fm;
$$;

revoke all on function public.get_design_feedback_loop() from public, anon;
grant execute on function public.get_design_feedback_loop() to authenticated;

notify pgrst, 'reload schema';
