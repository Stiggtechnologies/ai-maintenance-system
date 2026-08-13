-- ============================================================================
-- Demonstration notifications, built to prove the detector discriminates.
--
-- A detector that flags everything is as useless as one that flags nothing, and
-- only the second is obvious from a screenshot. So this seeds three cases:
--
--   1. A TRUE duplicate — one seal leak reported by three shifts inside a day,
--      in three people's words. Should surface as candidates.
--   2. A RECURRENCE — the same wording on the same asset, months later. Must
--      NOT surface: a fault returning after a repair is the signal, and
--      collapsing it into a duplicate would erase the thing worth knowing.
--   3. A COINCIDENCE — similar wording, same day, different asset. Must NOT
--      surface: "bearing noise" across a fleet is a pattern, not a duplicate.
--
-- Scoped to the demo organization and conditional on it existing.
-- ============================================================================

insert into maintenance_notifications
  (organization_id, asset_id, notification_no, description, notification_type,
   reported_by, reported_at, status)
select
  '11111111-1111-1111-1111-111111111111', a.id, v.no, v.descr, 'fault',
  v.who, now() - make_interval(hours => v.hours_ago), 'open'
from (values
  -- Case 1: one fault, three shifts, three phrasings.
  ('NOTIF-D-001', 0, 'Oil leak at pump outboard seal, drips onto guard',      'Day shift operator',   30),
  ('NOTIF-D-002', 0, 'Oil leaking from outboard seal on pump, pooling below', 'Night shift operator', 22),
  ('NOTIF-D-003', 0, 'Outboard seal leaking oil on the pump, guard wet',      'Back shift operator',  10),
  -- Case 2: same asset, same words, a season later. A recurrence.
  ('NOTIF-R-001', 0, 'Oil leak at pump outboard seal, drips onto guard',      'Day shift operator',   2900),
  -- Case 3: same words, same day, a different machine.
  ('NOTIF-C-001', 1, 'Oil leak at pump outboard seal, drips onto guard',      'Day shift operator',   26)
) as v(no, asset_slot, descr, who, hours_ago)
cross join lateral (
  select id from assets
   where organization_id = '11111111-1111-1111-1111-111111111111'
   order by id limit 1 offset v.asset_slot
) a
where exists (
  select 1 from organizations where id = '11111111-1111-1111-1111-111111111111'
)
-- The unique index is partial, so the predicate has to be repeated here for
-- Postgres to accept it as an inference target.
on conflict (organization_id, notification_no)
  where notification_no is not null
  do nothing;

notify pgrst, 'reload schema';
