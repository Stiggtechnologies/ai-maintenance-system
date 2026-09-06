-- ============================================================================
-- Sync Develop — Slice 6B, part 4c of 4.
-- D11.33 (spec III.§78) — the PROCUREMENT STATUS connector.
--
-- WHAT THE ROW SAYS, AND WHAT THIS CHANGES. Three of §78's seven connectors
-- have live rails: the document repository, the asset hierarchy, and Primavera
-- P6 (import half only). The row names what is missing and where it goes:
-- "SAP EAM/PM adapter, cost/ERP, procurement status (→ Slice 6)", and says how
-- each must land: "a thin caller on the ingest contract or an explicit
-- deferral, none silent". This file lands PROCUREMENT STATUS as exactly that —
-- a ninth entity type on the ONE ingest contract, with its own validator and
-- nothing else new: the same door (begin_manual_import), the same router
-- (ingest_rows), the same run, staging and counter machinery, the same screen
-- (src/components/ContractImport.tsx, which is descriptor-driven).
--
-- IT ROUTES THROUGH THE ONE WRITER, AND THAT IS THE POINT. A §25 status
-- dimension has exactly one writer — set_procurement_package_status — and
-- contract_packages' own wall refuses a direct status update for every caller
-- (20261208090000). So this validator does NOT insert or update anything: it
-- resolves the package and calls that function, which means an imported status
-- passes every refusal a typed one does. Two of those refusals matter most
-- here:
--
--   * `commercial = awarded` is refused BY NAME. An ERP feed cannot
--     manufacture a contract award — the award is an authority-bearing §70 act
--     and no file lands one.
--   * `delivery = received_and_inspected` is refused BY NAME. The arrival
--     DATE, not a status, discharges the mandatory long-lead gate blocker, and
--     an ERP goods-receipt flag is not that date.
--
-- ONE FACT PER ROW. A row carries EITHER a status move OR a delivery forecast,
-- never both: two writes in one row would half-apply when the second was
-- refused, and the row would then be counted rejected while the first had
-- already landed.
--
-- WHAT A RE-UPLOAD DOES. There is no external_id column on contract_packages
-- to deduplicate against, so the dedupe is SEMANTIC and comes from the one
-- writer itself: a dimension already at the value the file states is counted
-- DUPLICATE and skipped, in that function's own words. The surface descriptor
-- says so before the upload (src/lib/ingest-entities.ts), and
-- src/test/ingestImportDoor.test.ts derives that claim from this SQL rather
-- than trusting it.
--
-- WHAT IS STILL MISSING, NAMED RATHER THAN IMPLIED: SAP EAM/PM (no adapter),
-- cost/ERP (no rail — the commercial substrate the other three parts of this
-- slice build is its prerequisite, not its delivery), and P6's XER text format
-- (deferred; CSV lands honestly first). Those stay in the register row as
-- gaps. Four of seven, not seven.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ROUTE TABLE. The door's allowlist and the router's dispatch both read
--    this, so "the door said yes" and "a validator will accept it" cannot
--    diverge. Re-issued in FULL with the eight existing routes unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_entity_routes()
returns table (entity_type text, handler text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('condition_reading',        'ingest_batch'),
    ('material_stock',           'ingest_batch'),
    ('maintenance_notification', 'ingest_batch'),
    ('maintenance_plan',         'ingest_batch'),
    ('work_order',               'ingest_batch'),
    ('operating_state',          'ingest_context_batch'),
    ('production_record',        'ingest_context_batch'),
    ('schedule_activity',        'ingest_schedule_batch'),
    ('procurement_status',       'ingest_procurement_status_batch')
  ) as routes(entity_type, handler);
$$;

revoke all on function public.ingest_entity_routes() from public, anon;
grant execute on function public.ingest_entity_routes() to authenticated;

comment on function public.ingest_entity_routes() is
  'The ONE route table: which validator owns each manual-upload entity type. Read by begin_manual_import (the allowlist) and by ingest_rows (the dispatch), so a type the door accepts always has a validator. Slice 6B adds procurement_status (D11.33 / spec §78), whose validator writes nothing itself — it calls the ONE §25 status writer.';

-- ---------------------------------------------------------------------------
-- 2. THE VALIDATOR. A peer of ingest_batch, ingest_context_batch and
--    ingest_schedule_batch: SECURITY DEFINER, reachable ONLY through
--    ingest_rows, every per-row write in its own subtransaction, every refused
--    row RETAINED with its reason.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_procurement_status_batch(
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
  v_source text;
  v_seen_ids text[] := '{}';
  v_code text;
  v_dim text;
  v_status text;
  v_basis text;
  v_forecast date;
  v_forecast_raw text;
  v_package bigint;
  v_pkg_forecast date;
  v_result jsonb;
  v_err text;
  v_max_ts timestamptz;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;

  select connector_key into v_source from connectors where id = r.connector_id;

  for row_in in select * from jsonb_array_elements(p_rows)
  loop
    v_read := v_read + 1;
    v_reason := null;
    v_result := null;
    -- Every per-row variable is cleared before the row is read. A loop
    -- variable left over from the PREVIOUS row is how one file's row gets
    -- decided on another one's data.
    v_err := null;
    v_package := null;
    v_pkg_forecast := null;
    v_forecast := null;
    v_ext := row_in->>'external_id';

    if v_ext is null or length(trim(v_ext)) = 0 then
      v_reason := 'missing external_id: a source row without a stable identifier cannot be replayed safely';
    end if;

    if v_reason is null and v_ext = any (v_seen_ids) then
      v_reason := format(
        'external_id "%s" appears more than once in this upload — only the first '
        || 'line was loaded. Give each row its own identifier.', v_ext);
    elsif v_reason is null then
      v_seen_ids := v_seen_ids || v_ext;
    end if;

    -- EVERY per-row write happens inside this subtransaction, for the reason
    -- 20261004090100 records: one cell the validator cannot see must not abort
    -- the whole call and take the retained rejects down with the accepted rows.
    begin

    if v_reason is null and r.entity_type = 'procurement_status' then
      v_code := nullif(btrim(coalesce(row_in->>'package_code', '')), '');
      v_dim := lower(nullif(btrim(coalesce(row_in->>'dimension', '')), ''));
      v_status := lower(nullif(btrim(coalesce(row_in->>'status', '')), ''));
      v_forecast_raw := nullif(btrim(coalesce(row_in->>'forecast_delivery_date', '')), '');
      v_forecast := sync_text_as_date(v_forecast_raw);
      v_basis := nullif(btrim(coalesce(row_in->>'basis', '')), '');
      if v_basis is null or length(v_basis) < 10 then
        -- Derived, never blank: the ONE writer requires a stated basis and an
        -- imported status with none would be a status that changed for no
        -- recorded reason. The source system and the source row ARE the reason.
        v_basis := format('Imported from %s, source row %s',
          coalesce(v_source, 'a manual upload'), v_ext);
      end if;

      if v_code is null then
        v_reason := 'missing package_code: nothing says which procurement package this row is about';
      elsif v_dim is null and v_status is null and v_forecast_raw is null then
        v_reason := 'the row carries neither a status (dimension and status) nor a forecast_delivery_date, so it states nothing';
      -- ONE FACT PER ROW. Two writes in one row half-apply when the second is
      -- refused: the first has landed and the row is counted rejected.
      elsif (v_dim is not null or v_status is not null) and v_forecast_raw is not null then
        v_reason := 'the row carries BOTH a status move and a delivery forecast. One fact per row: two writes in one row would leave the first applied when the second was refused, and the row counted as rejected. Split it into two lines.';
      elsif v_forecast_raw is not null and v_forecast is null then
        v_reason := format('forecast_delivery_date "%s" is not a date', v_forecast_raw);
      elsif v_forecast_raw is null and (v_dim is null or v_status is null) then
        v_reason := 'a status move needs BOTH a dimension and a status';
      elsif v_dim is not null and not (v_dim = any (sync_procurement_status_dimensions())) then
        v_reason := format('dimension "%s" is not one of: %s (spec III.§25 names four)',
          v_dim, array_to_string(sync_procurement_status_dimensions(), ', '));
      else
        select id, forecast_delivery_date into v_package, v_pkg_forecast
          from contract_packages
         where organization_id = v_org and package_code = v_code;
        if v_package is null then
          v_reason := format(
            'unknown package_code "%s" — a procurement package is created in Sync (it carries the scope, the mandatory judgement and the dates a gate blocker reads), not by this import',
            v_code);
        elsif v_forecast is not null and v_pkg_forecast = v_forecast then
          -- THE SEMANTIC DUPLICATE, FORECAST HALF. The status half recognises a
          -- re-upload by the ONE writer answering "already at that value";
          -- record_package_delivery_forecast has no such answer — it accepts an
          -- identical date, writes it, and files an audit row whose
          -- previous_state and new_state are the same day. So the same file
          -- uploaded twice reported `accepted: 1` twice on a connector whose
          -- whole surface promise (src/lib/ingest-entities.ts, `reupload:
          -- "skips"`) is that it skips. The dedupe is made HERE rather than in
          -- the writer because the writer is a Slice 6A door a typed forecast
          -- also uses, and "re-stating today's forecast" is a no-op to an
          -- import and a deliberate re-affirmation to a planner.
          v_dup := v_dup + 1;
          insert into ingest_staging (organization_id, connector_id, run_id,
            entity_type, external_id, payload, status)
          values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
          continue;
        elsif v_forecast is not null then
          -- THE ONE FORECAST WRITER.
          v_result := record_package_delivery_forecast(v_package, v_forecast, v_basis);
          v_err := v_result->>'error';
          if v_err is not null then
            v_reason := v_err;
          else
            v_max_ts := greatest(coalesce(v_max_ts, now()), now());
          end if;
        else
          -- THE ONE §25 STATUS WRITER. Every refusal it makes — the award that
          -- may not be typed, the receipt that must carry a date, the mandatory
          -- package that may not be cancelled — applies to an imported row
          -- exactly as it does to a typed one, in that function's own words.
          v_result := set_procurement_package_status(v_package, v_dim, v_status, v_basis);
          v_err := v_result->>'error';
          if v_err is not null then
            -- THE SEMANTIC DUPLICATE. contract_packages has no external_id to
            -- deduplicate against, so a re-upload is recognised by the one
            -- writer answering "already at that value". Counted DUPLICATE and
            -- skipped, which is what the surface descriptor promises.
            if v_err like 'the % dimension is already %' then
              v_dup := v_dup + 1;
              insert into ingest_staging (organization_id, connector_id, run_id,
                entity_type, external_id, payload, status)
              values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'duplicate');
              continue;
            end if;
            v_reason := v_err;
          else
            v_max_ts := greatest(coalesce(v_max_ts, now()), now());
          end if;
        end if;
      end if;

    elsif v_reason is null then
      v_reason := format('unsupported entity_type "%s"', r.entity_type);
    end if;

    exception
      when unique_violation then
        v_reason := 'already loaded — another run wrote this external_id while this one was in flight';
      when others then
        v_reason := format('the database refused this row: %s', sqlerrm);
    end;

    if v_reason is null then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext, row_in, 'accepted');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status, reject_reason)
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

-- Reachable ONLY through the router, exactly as its three siblings are.
revoke all on function public.ingest_procurement_status_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_procurement_status_batch(uuid, jsonb)
  to service_role;

comment on function public.ingest_procurement_status_batch(uuid, jsonb) is
  'D11.33 / spec §78: the procurement-status connector''s validator. Writes NOTHING itself — it resolves the package and calls the ONE §25 status writer (set_procurement_package_status) or the ONE forecast writer (record_package_delivery_forecast), so every refusal a typed status meets an imported one meets too, including the two that matter: an ERP feed cannot type `commercial = awarded` and cannot type `delivery = received_and_inspected`. One fact per row; a dimension already at the stated value is counted DUPLICATE in that writer''s own words.';

-- ---------------------------------------------------------------------------
-- 3. THE ROUTER GAINS THE BRANCH — BY TRANSFORMATION, LIKE EVERY OTHER
--    EXTENSION IN THIS SLICE.
--
--    The first draft re-issued ingest_rows in full, on the argument that "the
--    dispatch is an explicit branch and not dynamic SQL" is a property a
--    transformation could not be read for. It is — src/test/ingestImportDoor.test.ts
--    reads the replacement TEXT below for exactly that — and a full re-type has
--    a cost the argument did not price: it silently reverts whatever has been
--    fixed in the router since 20261112090000, with a green suite, and it
--    dropped the reasoning behind two live guards on the way (the role re-check
--    lost "Without this a technician the door had just refused could push
--    condition readings through that run and clear a live alarm — measured, not
--    supposed", which in a security definer that re-states its own tenant filter
--    is that guard's only explanation).
--
--    One `elsif`, appended after the last handler branch, with the anchor
--    asserted. Nothing else in the router moves: not the five-role gate, not
--    the run resolution, not the tenant filter.
-- ---------------------------------------------------------------------------
do $router$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ingest_rows';
  if v_def is null then
    raise exception
      'ingest_rows does not exist — the ONE ingest router this connector joins is missing, and building a second door instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('ingest_procurement_status_batch' in v_def) = 0 then
    v_new := replace(v_def,
      $old$  elsif v_handler = 'ingest_schedule_batch' then
    return public.ingest_schedule_batch(p_run_id, p_rows);
  end if;$old$,
      $new$  elsif v_handler = 'ingest_schedule_batch' then
    return public.ingest_schedule_batch(p_run_id, p_rows);
  elsif v_handler = 'ingest_procurement_status_batch' then
    return public.ingest_procurement_status_batch(p_run_id, p_rows);
  end if;$new$);
    if v_new = v_def then
      raise exception
        'the handler dispatch of ingest_rows was not found in the shape 20261112090000 left it — do not extend the ONE ingest router blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$router$;

-- The replace preserves the ACL, but a grant that exists only as a leftover is
-- a grant nobody can read in this file (20261004090000's own argument) — so who
-- may call the router is restated.
revoke all on function public.ingest_rows(uuid, jsonb) from public, anon;
grant execute on function public.ingest_rows(uuid, jsonb) to authenticated;
grant execute on function public.ingest_rows(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
