#!/usr/bin/env bash
# Restore the seeded alarm/warning fixture the agent-loop smoke depends on.
#
# supabase start applies the full chain (~9 min). Mid-chain, migration 13
# schedules simulate_telemetry_tick() every minute. That walk mutates
# last_value and recomputes status. The later "unschedule the randomizer"
# step stops future ticks but does not undo the ones that already landed —
# #283 and #317 both failed at flagged=2 created=0 against a seed that
# inserts three alarm/warning rows. The 5-minute agent-loop cron can also
# raise Investigate recs during boot, so a post-restore run_agent_loop
# would report created=0 even after the flags are put back.
#
# This script:
#   1. unschedules both crons so the smoke is the first post-restore run;
#   2. writes the three seeded breaches (and the other seed normals) back;
#   3. renames any boot-time Investigate recs so the loop's idempotency
#      key (asset_id + title) misses them and the smoke actually inserts.
set -euo pipefail

eval "$(supabase status -o env | grep -E '^DB_URL=')"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if exists (select 1 from cron.job where jobname = 'syncai-telemetry-sim') then
    perform cron.unschedule('syncai-telemetry-sim');
  end if;
  if exists (select 1 from cron.job where jobname = 'syncai-agent-loop') then
    perform cron.unschedule('syncai-agent-loop');
  end if;
exception when undefined_table then
  null;
end $$;

-- Exact values from 00000000000004_demo_seed.sql. Status is written
-- explicitly: Temperature 78 vs threshold 85 is a seeded warning under
-- the condition-monitoring warning_limit (0.8 * 85), not under the
-- telemetry walk's 0.9 * threshold rule, which is why a few ticks clear it.
update sensors s
set last_value = v.last_value,
    threshold = v.threshold,
    status = v.status,
    trend = v.trend
from (values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Vibration — Drive End',
    12.4::numeric, 10.0::numeric, 'alarm', 'up'),
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Temperature — Drive End',
    78::numeric, 85::numeric, 'warning', 'up'),
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Belt Speed',
    4.2::numeric, 4.5::numeric, 'normal', 'stable'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'Seal Chamber Pressure',
    3.1::numeric, 2.5::numeric, 'warning', 'up'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'Vibration — DE',
    5.8::numeric, 8.0::numeric, 'normal', 'up')
) as v(asset_id, name, last_value, threshold, status, trend)
where s.asset_id = v.asset_id and s.name = v.name;

-- Site-2 sensors from 00000000000013_realtime_operating_picture.sql.
update sensors s
set last_value = v.last_value,
    threshold = v.threshold,
    status = v.status,
    trend = v.trend
from (values
  ('aaaaaaaa-0000-0000-0000-000000000007'::uuid, 'Discharge Pressure — P-201',
    5.6::numeric, 7.0::numeric, 'normal', 'stable'),
  ('aaaaaaaa-0000-0000-0000-000000000007'::uuid, 'Vibration — P-201 DE',
    3.1::numeric, 8.0::numeric, 'normal', 'stable'),
  ('aaaaaaaa-0000-0000-0000-000000000008'::uuid, 'Discharge Temp — K-201',
    96::numeric, 120::numeric, 'normal', 'up'),
  ('aaaaaaaa-0000-0000-0000-000000000008'::uuid, 'Vibration — K-201',
    6.9::numeric, 9.0::numeric, 'normal', 'up')
) as v(asset_id, name, last_value, threshold, status, trend)
where s.asset_id = v.asset_id and s.name = v.name;

-- Walk leftovers that are not part of the seeded fixture. The smoke
-- proves the three seeded breaches, not leftover dice.
update sensors
set status = 'normal'
where status in ('alarm', 'warning')
  and name not in (
    'Vibration — Drive End',
    'Temperature — Drive End',
    'Seal Chamber Pressure'
  );

-- Idempotency key is asset_id + exact title. Prefix boot-time loop recs
-- so the smoke's first run_agent_loop inserts again.
update recommendations
set title = '[pre-smoke] ' || title
where title like 'Investigate %'
  and title not like '[pre-smoke] %'
  and rationale like '%continuous condition-monitoring loop%';
SQL

FLAGGED_NOW=$(psql "$DB_URL" -tAc "select count(*) from sensors where status in ('alarm','warning')")
test "$FLAGGED_NOW" -ge 3
echo "agent-loop fixture restored: flagged_sensors=$FLAGGED_NOW"
