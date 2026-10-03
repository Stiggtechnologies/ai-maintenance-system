-- Alberta adopted permanent UTC-6 beginning 2026-11-01. Keep the stored
-- first-response promise correct even when PostgreSQL ships older tzdata.
create or replace function public.business_hours_deadline(
  p_from timestamptz,
  p_duration interval
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  c_zone_before constant text := 'America/Edmonton';
  c_zone_after constant text := 'Etc/GMT+6';
  c_change constant timestamptz := timestamptz '2026-11-01 08:00:00+00';
  c_change_day constant date := date '2026-11-01';
  c_open constant interval := interval '8 hours';
  c_close constant interval := interval '17 hours';
  v_cursor timestamp;
  v_day date;
  v_open timestamp;
  v_close timestamp;
  v_left interval;
  v_avail interval;
  v_result timestamp;
  v_guard integer := 0;
begin
  if p_from is null then return null; end if;
  v_left := greatest(coalesce(p_duration, interval '0'), interval '0');
  v_cursor := p_from at time zone
    (case when p_from >= c_change then c_zone_after else c_zone_before end);

  loop
    v_guard := v_guard + 1;
    if v_guard > 400 then
      return p_from + coalesce(p_duration, interval '0');
    end if;
    v_day := v_cursor::date;
    v_open := v_day + c_open;
    v_close := v_day + c_close;
    if extract(isodow from v_day) >= 6 or v_cursor >= v_close then
      v_cursor := (v_day + 1)::timestamp;
      continue;
    end if;
    if v_cursor < v_open then v_cursor := v_open; end if;
    v_avail := v_close - v_cursor;
    if v_left <= v_avail then
      v_result := v_cursor + v_left;
      return v_result at time zone
        (case when v_result::date >= c_change_day then c_zone_after else c_zone_before end);
    end if;
    v_left := v_left - v_avail;
    v_cursor := (v_day + 1)::timestamp;
  end loop;
end
$$;

comment on function public.business_hours_deadline(timestamptz, interval) is
  'Adds working time across Alberta business hours and pins enacted permanent UTC-6 from 2026-11-01, independent of host tzdata age.';

revoke execute on function public.business_hours_deadline(timestamptz, interval)
  from public, anon, authenticated;
grant execute on function public.business_hours_deadline(timestamptz, interval)
  to service_role;
