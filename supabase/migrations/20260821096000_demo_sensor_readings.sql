-- ============================================================================
-- Demo condition readings for the three validated sensors, demo org only.
--
-- Seeded so the validator can be SEEN working. A validator that never fires
-- proves nothing, so the three sensors are given three different histories:
-- one healthy, one STUCK at exactly the same value, and one with a physically
-- impossible spike. Every row is marked source_system DEMO.
-- ============================================================================
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  r record; n int := 0; h int;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from condition_readings
              where organization_id = v_org and source_system = 'DEMO — validator fixture') then
    return;
  end if;

  for r in
    select sn.id, sn.asset_id from sensors sn
    join sensor_validation_rules vr on vr.sensor_id = sn.id
    where sn.organization_id = v_org order by sn.name limit 3
  loop
    n := n + 1;
    for h in 0..5 loop
      insert into condition_readings (organization_id, sensor_id, asset_id, value,
        quality, taken_at, source_system)
      values (v_org, r.id, r.asset_id,
        case n
          when 1 then 40 + h * 2                    -- healthy, plausible drift
          when 2 then 47.3                          -- stuck at exactly one value
          else case when h = 5 then 4200 else 60 + h end  -- impossible spike
        end,
        'good', now() - make_interval(hours => (5 - h) * 6),
        'DEMO — validator fixture');
    end loop;
  end loop;
end $$;
