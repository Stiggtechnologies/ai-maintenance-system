-- ============================================================================
-- Operating-context rows survive a bad cell, and stop asserting what a file
-- cannot know (C2.04, C8.03).
--
-- 20261004090000 routes operating_state and production_record to
-- ingest_context_batch for the first time from a customer surface. That
-- validator was written for a live connector, whose data is CURRENT and
-- COMPLETE. A spreadsheet is HISTORICAL and RAGGED, and five of its assumptions
-- do not survive the change of caller. Each was measured on a full schema
-- before and after; none is hypothetical.
--
--   1. ONE BAD CELL DESTROYED THE EVIDENCE. There is no exception block, so a
--      load_pct of -5 — a perfectly castable number that violates
--      operating_states_load_pct_check — aborted the entire call. Measured: the
--      good row before it landed 0 rows and 0 rejects were retained, counters
--      0/0/0, run stuck `running`. The contract's first promise ("a connector
--      that silently drops rows reports a successful sync; this is what makes
--      that impossible") was false for the single most common spreadsheet
--      defect. Every per-row write is now a subtransaction, so a row the
--      database refuses becomes a reject WITH THE DATABASE'S OWN REASON and the
--      rest of the file lands.
--
--   2. A BLANK ended_at ASSERTED THE PRESENT. Five reader sites compute
--      coalesce(ended_at, now()). One open row dated 2010 made
--      get_operating_context return hours_covered 2160.0, coverage_pct 100.0
--      and "State records cover the window." while holding data_span_to = 2010
--      in its own hand. An uploaded file cannot say "still in this state now",
--      so for a manual_upload connector ended_at is now required. A live
--      connector may still open a state; nothing about the reader changed, and
--      that remains an open hole for a connector that does not exist yet.
--
--   3. OVERLAPPING WINDOWS WERE ALL ACCEPTED. Three states covering one 24-hour
--      day gave that day 60 state-hours. An asset is in one state at a time; an
--      overlap is now a refusal naming the period it collides with, which also
--      catches the in-file case because rows are inserted one at a time.
--
--   4. FUTURE PERIODS RATCHETED THE WATERMARK. started_at 2099 was accepted and
--      finish_connector_run's greatest(...) means last_position can never come
--      back down. condition_reading already refused a future taken_at; this is
--      the same rule, not a new policy.
--
--   5. BLANK-BUT-NOT-NULL AND `limit 1`. '' and '   ' passed every `is null`
--      check into not-null columns, so an organisation ended up holding three
--      units of measure — '', '   ' and 'tonne'. A site_name matching nothing
--      was silently dropped. An ambiguous asset name bound by scan order.
--
-- SPLICED, NOT RETYPED. The body below is 20260812090000's, read from that file
-- and transformed by asserted replacements, for the reason 20260905090000 gives
-- for doing the same: hand-copying a 300-line validator to change a dozen lines
-- is how a transcription error reaches production disguised as a fix.
-- ============================================================================

create or replace function public.ingest_context_batch(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
  row_in jsonb;
  v_ext text;
  v_reason text;
  v_read int := 0;
  v_ok int := 0;
  v_dup int := 0;
  v_rej int := 0;
  v_max_ts timestamptz;
  v_asset uuid;
  v_site uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_source text;
  v_conn_type text;
  v_ids uuid[];
  v_state text;
  v_uom text;
  v_load numeric;
  v_seen_ids text[] := '{}';
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;
  if r.entity_type not in ('operating_state', 'production_record') then
    return jsonb_build_object('error',
      format('ingest_context_batch handles operating_state and production_record; this run is %s', r.entity_type));
  end if;

  select connector_key, connector_type into v_source, v_conn_type
    from connectors where id = r.connector_id;

  for row_in in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_reason := null;
    v_ext := row_in->>'external_id';
    if v_ext is null or length(trim(v_ext)) = 0 then
      v_reason := 'missing external_id: a source row without a stable identifier cannot be replayed safely';
    end if;

    -- The same external_id twice in ONE file is a copy-pasted identifier, not a
    -- replay. Reporting it as `duplicate` told the operator the row was already
    -- loaded when in fact a DIFFERENT fact under a reused id was discarded.
    if v_reason is null and v_ext = any (v_seen_ids) then
      v_reason := format(
        'external_id "%s" appears more than once in this upload — only the first '
        || 'line was loaded. Give each row its own identifier.', v_ext);
    elsif v_reason is null then
      v_seen_ids := v_seen_ids || v_ext;
    end if;

    -- EVERY per-row write happens inside this subtransaction. Without it, one
    -- cell the validator cannot see — a load_pct of -5 is a perfectly castable
    -- number that violates operating_states_load_pct_check, and an uncastable
    -- timestamp raises before any check runs — aborted the WHOLE call: the rows
    -- already accepted were rolled back, and so were the retained rejects that
    -- were supposed to explain what happened. "Every refused row is kept with
    -- its reason" was false for exactly the file most likely to have a bad cell.
    begin
    if v_reason is null then
      select array_agg(id) into v_ids from assets
      where organization_id = v_org
        and (id::text = row_in->>'asset_id' or name = row_in->>'asset_name');
      -- `limit 1` with no ORDER BY bound an ambiguous name to whichever row the
      -- scan reached first. Unit numbers are reused across equipment types in
      -- real fleets, so this silently charged a 24-hour down event to the wrong
      -- machine. Ambiguity is now a refusal with the count in it.
      if coalesce(array_length(v_ids, 1), 0) > 1 then
        v_reason := format('asset "%s" matches %s assets — give asset_id instead of asset_name',
          coalesce(row_in->>'asset_name', row_in->>'asset_id'), array_length(v_ids, 1));
      else
        v_asset := v_ids[1];
      end if;
    end if;

    if v_reason is null and r.entity_type = 'operating_state' then
      v_start := (row_in->>'started_at')::timestamptz;
      v_end := (row_in->>'ended_at')::timestamptz;
      -- A cell holding '' or '   ' is not null, so every `is null` check below
      -- passed it straight through to a not-null column.
      v_state := nullif(btrim(row_in->>'state'), '');
      v_load := (nullif(btrim(row_in->>'load_pct'), ''))::numeric;
      if v_asset is null then
        v_reason := format('unknown asset "%s"', coalesce(row_in->>'asset_name', row_in->>'asset_id', '(none)'));
      elsif v_state is null then
        v_reason := 'missing state';
      elsif v_state not in ('running','idle','standby','down_planned','down_unplanned','offline') then
        v_reason := format('unrecognised state "%s"', v_state);
      elsif v_start is null then
        v_reason := 'missing or unparseable started_at';
      elsif v_end is not null and v_end <= v_start then
        v_reason := 'ended_at is not after started_at — a state cannot end before it begins';
      -- A blank ended_at means "still in this state NOW". A live connector can
      -- assert that; an uploaded file cannot. One such row on an asset made
      -- get_operating_context report 2160.0 hours covered and "State records
      -- cover the window." over a window whose data_span_to was 2010, because
      -- five reader sites compute coalesce(ended_at, now()). The honest-
      -- uncertainty machinery was defeated by one empty cell.
      elsif v_end is null and v_conn_type = 'manual_upload' then
        v_reason := 'ended_at is required on an uploaded state: a blank end means "still in this state now", which a file cannot assert. Give the end of the period you observed.';
      elsif greatest(v_start, coalesce(v_end, v_start)) > now() + interval '1 hour' then
        -- condition_reading already refuses a future taken_at. This branch did
        -- not, and finish_connector_run's greatest(...) means a state dated
        -- 2099 ratchets the watermark somewhere it can never come back from.
        v_reason := 'the period is in the future: a clock or timezone fault at the source';
      elsif v_load is not null and (v_load < 0 or v_load > 200) then
        v_reason := format('load_pct is %s; it must be between 0 and 200', v_load);
      elsif exists (select 1 from operating_states
                    where organization_id = v_org and source_system = v_source and external_id = v_ext) then
        v_dup := v_dup + 1;
        insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
        values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
        continue;
      -- An asset is in ONE state at a time. Nothing in the schema said so, and
      -- three rows covering the same 24-hour day were all accepted, giving that
      -- day 60 state-hours and every percentage computed from it a denominator
      -- that does not exist. Bounds are '[)' so a period that ends exactly when
      -- the next begins is contiguous, not overlapping.
      elsif exists (select 1 from operating_states os
                    where os.organization_id = v_org and os.asset_id = v_asset
                      and tstzrange(os.started_at, coalesce(os.ended_at, 'infinity'::timestamptz), '[)')
                       && tstzrange(v_start, coalesce(v_end, 'infinity'::timestamptz), '[)')) then
        v_reason := format('overlaps a state already recorded for this asset covering %s',
          (select format('%s to %s (%s)', os.started_at, coalesce(os.ended_at::text, 'open'), os.state)
             from operating_states os
            where os.organization_id = v_org and os.asset_id = v_asset
              and tstzrange(os.started_at, coalesce(os.ended_at, 'infinity'::timestamptz), '[)')
               && tstzrange(v_start, coalesce(v_end, 'infinity'::timestamptz), '[)')
            order by os.started_at limit 1));
      else
        insert into operating_states (organization_id, asset_id, state, load_pct,
          started_at, ended_at, reason_code, source_system, external_id)
        values (v_org, v_asset, v_state, v_load,
          v_start, v_end, nullif(btrim(row_in->>'reason_code'), ''), v_source, v_ext);
        v_max_ts := greatest(coalesce(v_max_ts, v_start), v_start);
      end if;

    elsif v_reason is null and r.entity_type = 'production_record' then
      v_start := (row_in->>'period_start')::timestamptz;
      v_end := (row_in->>'period_end')::timestamptz;
      v_uom := nullif(btrim(row_in->>'unit_of_measure'), '');
      v_site := null;
      if nullif(btrim(row_in->>'site_name'), '') is not null then
        select array_agg(id) into v_ids from sites
        where organization_id = v_org and name = btrim(row_in->>'site_name');
        if coalesce(array_length(v_ids, 1), 0) > 1 then
          v_reason := format('site "%s" matches %s sites', btrim(row_in->>'site_name'), array_length(v_ids, 1));
        else
          v_site := v_ids[1];
        end if;
      end if;
      if v_reason is not null then
        null;
      -- A named site that matches nothing used to leave site_id null and be
      -- ACCEPTED, so a whole file could land as one site-less pile with the
      -- counts reporting success. An unresolvable name is a refusal, the same
      -- rule maintenance_notification already applies to an asset.
      elsif v_site is null and nullif(btrim(row_in->>'site_name'), '') is not null then
        v_reason := format('unknown site "%s"', btrim(row_in->>'site_name'));
      elsif v_asset is null and coalesce(row_in->>'asset_id', row_in->>'asset_name') is not null then
        v_reason := format('unknown asset "%s"', coalesce(row_in->>'asset_name', row_in->>'asset_id'));
      elsif v_asset is null and v_site is null then
        v_reason := 'production must attach to a known asset or site';
      elsif nullif(btrim(row_in->>'units_produced'), '') is null then
        v_reason := 'missing units_produced';
      elsif (btrim(row_in->>'units_produced'))::numeric < 0 then
        v_reason := 'negative units_produced';
      elsif v_uom is null then
        v_reason := 'missing unit_of_measure — a quantity without a unit cannot be aggregated';
      elsif v_start is null or v_end is null or v_end <= v_start then
        v_reason := 'period_start and period_end must both parse, with the end after the start';
      elsif v_end > now() + interval '1 hour' then
        v_reason := 'the period is in the future: a clock or timezone fault at the source';
      elsif exists (select 1 from production_records
                    where organization_id = v_org and source_system = v_source and external_id = v_ext) then
        v_dup := v_dup + 1;
        insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
        values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
        continue;
      else
        insert into production_records (organization_id, asset_id, site_id,
          period_start, period_end, units_produced, unit_of_measure, source_system, external_id)
        values (v_org, v_asset, v_site, v_start, v_end,
          (btrim(row_in->>'units_produced'))::numeric, v_uom, v_source, v_ext);
        v_max_ts := greatest(coalesce(v_max_ts, v_end), v_end);
      end if;
    end if;

    exception
      when unique_violation then
        -- The dedupe index is the real guarantee; the `exists` check above is
        -- only an optimisation, and a concurrent run can land the same
        -- external_id between the two. Before this block that raised and took
        -- the whole batch with it, including the retained rejects.
        v_reason := 'already loaded — another run wrote this external_id while this one was in flight';
      when others then
        v_reason := format('the database refused this row: %s', sqlerrm);
    end;

    if v_reason is null then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'accepted');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status, reject_reason)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'rejected', v_reason);
    end if;
  end loop;

  update connector_runs
  set records_read = records_read + v_read,
      records_accepted = records_accepted + v_ok,
      records_rejected = records_rejected + v_rej,
      records_duplicate = records_duplicate + v_dup,
      watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
  where id = p_run_id;

  return jsonb_build_object('read', v_read, 'accepted', v_ok,
    'duplicate', v_dup, 'rejected', v_rej);
end
$$;

revoke all on function public.ingest_context_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_context_batch(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- And the one reader of these rows that never filtered by tenant.
-- ---------------------------------------------------------------------------
-- get_operating_regime is SECURITY DEFINER — RLS is off inside it — granted to
-- `authenticated`, and its only filter is `s.asset_id = p_asset_id`. An asset
-- id is not a secret, so any signed-in user holding another tenant's asset id
-- read that tenant's duty state. It has had no caller since it was written
-- (the register says so under C6.26), which is the only reason this never
-- mattered; making operating_states loadable is what turns an empty table into
-- somebody's production history. Its two siblings, get_operating_context and
-- get_production_position, both derive v_org from app_current_org() already.
--
-- Found by the rediscovering scan added to definerTenancy.test.ts in this
-- change, not by reading this file.
create or replace function public.get_operating_regime(p_asset_id uuid, p_at timestamptz)
returns text
language sql
security definer
set search_path = public
stable
as $$
  -- The regime an asset was in at a moment: high duty, low duty, or unknown.
  -- Unknown is a real answer and is never quietly folded into one of the others.
  select case
    when s.load_pct is null then 'Unknown duty'
    when s.load_pct >= 80 then 'High duty'
    when s.load_pct >= 40 then 'Moderate duty'
    else 'Low duty' end
  from operating_states s
  where s.organization_id = app_current_org()
    and s.asset_id = p_asset_id
    and s.started_at <= p_at
    and coalesce(s.ended_at, now()) >= p_at
  order by s.started_at desc
  limit 1;
$$;

revoke all on function public.get_operating_regime(uuid, timestamptz) from public, anon;
grant execute on function public.get_operating_regime(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
