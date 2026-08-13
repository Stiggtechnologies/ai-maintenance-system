-- ============================================================================
-- Demonstration data for the two measurements added in 20260903090000.
--
-- These intervals are ILLUSTRATIVE. They are not engineering recommendations and
-- must not be copied into a real programme: a PM interval belongs to the
-- operator and follows from OEM requirement, duty cycle and observed failure
-- behaviour, none of which this file knows. Every row says so in `source`, so
-- the provenance travels with the data rather than living in a comment nobody
-- reads at query time.
--
-- Scoped to the demo organization and conditional on it existing, so a customer
-- deployment that omits the demo seed gets no invented maintenance programme.
-- ============================================================================

insert into maintenance_plans
  (organization_id, asset_id, task_code, task_label,
   interval_basis, interval_value, last_performed_at, source)
select
  '11111111-1111-1111-1111-111111111111', a.id, v.task_code, v.task_label,
  v.basis, v.interval_value,
  now() - make_interval(days => v.days_since_last),
  'DEMONSTRATION DATA — illustrative interval, not an engineering recommendation.'
from (values
  ('PM-LUBE-30',  'Lubrication route',            'calendar_days', 30,  12),
  ('PM-VIB-90',   'Vibration survey',             'calendar_days', 90,  40),
  ('PM-INSP-180', 'Statutory inspection',         'calendar_days', 180, 200),
  ('PM-OIL-8000', 'Oil change on running hours',  'run_hours',     8000, 30)
) as v(task_code, task_label, basis, interval_value, days_since_last)
cross join lateral (
  -- One asset per plan, deterministically chosen, so the demo shows plans spread
  -- across the fleet rather than stacked on a single machine.
  select id from assets
   where organization_id = '11111111-1111-1111-1111-111111111111'
   order by id
   limit 1 offset (case v.task_code
     when 'PM-LUBE-30' then 0 when 'PM-VIB-90' then 1
     when 'PM-INSP-180' then 2 else 3 end)
) a
where exists (
  select 1 from organizations where id = '11111111-1111-1111-1111-111111111111'
)
on conflict do nothing;

-- Dispatch response classes on demo work orders. Deliberately PARTIAL: roughly
-- a third are left null so the panel demonstrates the coverage line and the
-- classified-population denominator, which is the behaviour most likely to be
-- got wrong by whoever integrates a real CMMS next.
update work_orders w
   set response_class = case
     when w.priority = 'critical' and w.work_type <> 'preventive' then 'emergency'
     when w.work_type = 'preventive' then 'scheduled'
     when w.priority in ('high') then 'urgent'
     else 'scheduled'
   end
 where w.organization_id = '11111111-1111-1111-1111-111111111111'
   and w.response_class is null
   and (('x' || substr(md5(w.id::text), 1, 8))::bit(32)::bigint % 3) <> 0;

notify pgrst, 'reload schema';
