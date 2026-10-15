-- ============================================================================
-- Sync Develop — D11.33 / spec III.§78: governed cost / ERP actuals.
--
-- This closes the last named §78 connector gap without creating another cost
-- store. ERP supplies a CUMULATIVE actual-to-date snapshot. The connector:
--
--   * resolves an EXISTING development case and coded project_cost_item;
--   * calls record_cost_item, the one writer of the canonical cost line;
--   * preserves baseline, commitment, forecast, contingency, coding and the
--     line's original basis exactly as they were;
--   * binds the table's already-reserved source_system/external_id provenance;
--   * refuses transactions masquerading as totals, mixed currency, stale
--     snapshots, conflicting reused identifiers and uncoded/unknown lines;
--   * cannot approve or revise a cost baseline.
--
-- Every source row and every refusal stays on the canonical connector_runs →
-- ingest_staging contract. The ERP remains the source of posted actuals; Sync
-- remains the governed system of intelligence over the canonical cost model.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend the ONE route table. The nine existing routes are unchanged.
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
    ('procurement_status',       'ingest_procurement_status_batch'),
    ('cost_actual',              'ingest_cost_actual_batch')
  ) as routes(entity_type, handler);
$$;

revoke all on function public.ingest_entity_routes() from public, anon;
grant execute on function public.ingest_entity_routes() to authenticated;

comment on function public.ingest_entity_routes() is
  'The ONE manual-import route table. D11.33 adds cost_actual, a cumulative ERP snapshot routed through record_cost_item onto the canonical project_cost_items actual — never a second cost store and never a baseline approval.';

-- ---------------------------------------------------------------------------
-- 2. The validator. Router-only, tenant-bound and one-row-at-a-time atomic.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_cost_actual_batch(
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
  v_payload jsonb;
  v_ext text;
  v_reason text;
  v_read int := 0;
  v_ok int := 0;
  v_dup int := 0;
  v_rej int := 0;
  v_source text;
  v_seen_ids text[] := '{}';
  v_case_raw text;
  v_case_title text;
  v_case_id uuid;
  v_case_count int;
  v_case development_cases%rowtype;
  v_ref text;
  v_actual_raw text;
  v_actual numeric;
  v_currency text;
  v_as_of_raw text;
  v_as_of timestamptz;
  v_basis text;
  v_item project_cost_items%rowtype;
  v_wbs text;
  v_cbs text;
  v_prior jsonb;
  v_prior_as_of timestamptz;
  v_result jsonb;
  v_err text;
  v_max_ts timestamptz;
begin
  select * into r
    from connector_runs
   where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;

  select connector_key into v_source
    from connectors
   where id = r.connector_id
     and organization_id = v_org
     and connector_type = 'manual_upload';
  if v_source is null then
    return jsonb_build_object('error',
      'the run is not bound to a governed manual-upload source');
  end if;

  for row_in in select * from jsonb_array_elements(p_rows)
  loop
    v_read := v_read + 1;
    v_payload := row_in;
    v_reason := null;
    v_prior := null;
    v_prior_as_of := null;
    v_case_id := null;
    v_case_count := 0;
    v_case := null;
    v_item := null;
    v_wbs := null;
    v_cbs := null;
    v_actual := null;
    v_as_of := null;
    v_result := null;
    v_err := null;

    v_ext := nullif(btrim(coalesce(row_in->>'external_id', '')), '');
    if v_ext is null then
      v_reason := 'missing external_id: a source snapshot without a stable identifier cannot be replayed safely';
    elsif v_ext = any (v_seen_ids) then
      v_reason := format(
        'external_id "%s" appears more than once in this upload — only the first row can state that source fact',
        v_ext);
    else
      v_seen_ids := v_seen_ids || v_ext;
    end if;

    -- One malformed cell rolls back only this row. The retained reject is
    -- inserted after the exception block, so its explanation survives.
    begin
      if v_reason is null and r.entity_type = 'cost_actual' then
        v_case_raw := nullif(btrim(coalesce(row_in->>'development_case_id', '')), '');
        v_case_title := nullif(btrim(coalesce(row_in->>'case_title', '')), '');
        v_ref := nullif(btrim(coalesce(row_in->>'cost_item_ref', '')), '');
        v_actual_raw := nullif(btrim(coalesce(row_in->>'actual_to_date', '')), '');
        v_actual := sync_text_as_numeric(v_actual_raw);
        v_currency := upper(nullif(btrim(coalesce(row_in->>'currency', '')), ''));
        v_as_of_raw := nullif(btrim(coalesce(row_in->>'as_of', '')), '');
        v_as_of := sync_text_as_timestamptz(v_as_of_raw);
        v_basis := nullif(btrim(coalesce(row_in->>'basis', '')), '');
        if v_basis is null or length(v_basis) < 10 then
          v_basis := format('Imported from %s, source row %s', v_source, v_ext);
        end if;

        if v_case_raw is null and v_case_title is null then
          v_reason := 'name development_case_id or case_title: an actual cannot be posted to an unidentified project';
        elsif v_case_raw is not null then
          v_case_id := sync_text_as_uuid(v_case_raw);
          if v_case_id is null then
            v_reason := format('development_case_id "%s" is not a UUID', v_case_raw);
          else
            select * into v_case from development_cases
             where id = v_case_id and organization_id = v_org;
            if not found then
              v_reason := 'development case not found in this organization';
            elsif v_case_title is not null and v_case.title <> v_case_title then
              v_reason := format(
                'development_case_id resolves to "%s", not the supplied case_title "%s"',
                v_case.title, v_case_title);
            end if;
          end if;
        else
          select count(*), max(id::text)::uuid into v_case_count, v_case_id
            from development_cases
           where organization_id = v_org and title = v_case_title;
          if v_case_count = 0 then
            v_reason := format('case_title "%s" does not resolve in this organization', v_case_title);
          elsif v_case_count > 1 then
            v_reason := format(
              'case_title "%s" resolves to %s cases — use development_case_id so the ERP actual cannot land on a guess',
              v_case_title, v_case_count);
          else
            select * into v_case from development_cases
             where id = v_case_id and organization_id = v_org;
          end if;
        end if;

        if v_reason is null and v_ref is null then
          v_reason := 'missing cost_item_ref: the ERP file may update an existing coded line, never create an uncoded one';
        elsif v_reason is null and v_actual_raw is null then
          v_reason := 'missing actual_to_date: supply the cumulative source-system actual, not a transaction amount';
        elsif v_reason is null and (v_actual is null
              or v_actual = 'NaN'::numeric
              or v_actual = 'Infinity'::numeric
              or v_actual = '-Infinity'::numeric) then
          v_reason := format('actual_to_date "%s" is not a finite number', coalesce(v_actual_raw, ''));
        elsif v_reason is null and v_actual < 0 then
          v_reason := 'actual_to_date cannot be negative — a credit must be represented in the ERP total, not as a negative Sync cost line';
        elsif v_reason is null and v_currency is null then
          v_reason := 'currency is required: an actual without its unit cannot be reconciled to the cost line';
        elsif v_reason is null and (v_as_of_raw is null
              or v_as_of_raw !~* '(Z|[+-][0-9]{2}:?[0-9]{2})$') then
          v_reason := 'as_of must include Z or an explicit UTC offset so the ERP snapshot has one unambiguous instant';
        elsif v_reason is null and (v_as_of is null or not isfinite(v_as_of)) then
          v_reason := format('as_of "%s" is not a finite timestamp with an explicit source time', coalesce(v_as_of_raw, ''));
        end if;

        if v_reason is null then
          select * into v_item from project_cost_items
           where organization_id = v_org
             and development_case_id = v_case_id
             and cost_item_ref = v_ref;
          if not found then
            v_reason := format(
              'cost_item_ref "%s" is not an existing coded line on this case — create its WBS, CBS and cost line in Sync before importing ERP actuals',
              v_ref);
          elsif v_item.currency <> v_currency then
            v_reason := format(
              'the ERP actual is stated in %s but cost line %s is in %s — their difference would be an exchange rate reported as project variance',
              v_currency, v_ref, v_item.currency);
          elsif v_item.source_system is not null and v_item.source_system <> v_source then
            v_reason := format(
              'cost line %s is already bound to source %s; a second ERP source cannot silently replace its provenance with %s',
              v_ref, v_item.source_system, v_source);
          end if;
        end if;

        if v_reason is null then
          v_payload := row_in || jsonb_build_object(
            '_sync_case_id', v_case_id::text,
            '_sync_actual_to_date', v_actual::text,
            '_sync_as_of', v_as_of::text,
            '_sync_source', v_source);

          -- Stable source identity. The same id with the same normalized fact
          -- is a replay; the same id with different content is a source-data
          -- conflict and never an update instruction.
          select payload into v_prior
            from ingest_staging
           where organization_id = v_org
             and connector_id = r.connector_id
             and entity_type = 'cost_actual'
             and external_id = v_ext
             and status in ('accepted', 'duplicate')
           order by received_at desc, id desc limit 1;
          if v_prior is not null then
            if v_prior->>'_sync_case_id' = v_case_id::text
               and nullif(btrim(coalesce(v_prior->>'cost_item_ref', '')), '') = v_ref
               and v_prior->>'_sync_actual_to_date' = v_actual::text
               and upper(nullif(btrim(coalesce(v_prior->>'currency', '')), '')) = v_currency
               and sync_text_as_timestamptz(v_prior->>'_sync_as_of') = v_as_of then
              v_dup := v_dup + 1;
              insert into ingest_staging (organization_id, connector_id, run_id,
                entity_type, external_id, payload, status)
              values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext,
                v_payload, 'duplicate');
              continue;
            else
              v_reason := format(
                'external_id "%s" was already accepted with different case, line, amount, currency or as_of content — source identity cannot be reused as an update command',
                v_ext);
            end if;
          end if;
        end if;

        if v_reason is null then
          select max(sync_text_as_timestamptz(payload->>'_sync_as_of'))
            into v_prior_as_of
            from ingest_staging
           where organization_id = v_org
             and connector_id = r.connector_id
             and entity_type = 'cost_actual'
             and status in ('accepted', 'duplicate')
             and payload->>'_sync_case_id' = v_case_id::text
             and nullif(btrim(coalesce(payload->>'cost_item_ref', '')), '') = v_ref;

          if v_prior_as_of is not null and v_as_of < v_prior_as_of then
            v_reason := format(
              'snapshot %s is older than the latest received snapshot %s for cost line %s — stale ERP data cannot move the canonical actual backward in time',
              v_as_of, v_prior_as_of, v_ref);
          elsif v_prior_as_of is not null and v_as_of = v_prior_as_of
                and v_item.actual is distinct from v_actual then
            v_reason := format(
              'snapshot time %s already exists for cost line %s with a different actual — the source must resolve the conflicting period close',
              v_as_of, v_ref);
          elsif v_item.actual is not distinct from v_actual then
            v_dup := v_dup + 1;
            insert into ingest_staging (organization_id, connector_id, run_id,
              entity_type, external_id, payload, status)
            values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext,
              v_payload, 'duplicate');
            continue;
          end if;
        end if;

        if v_reason is null then
          select wbs_code into v_wbs from project_wbs_elements where id = v_item.wbs_element_id;
          select cbs_code into v_cbs from project_cbs_codes where id = v_item.cbs_code_id;

          -- THE ONE COST WRITER. Every amount except actual is passed back
          -- exactly as stored. The connector cannot clear or revise it by
          -- omission, and it cannot create a new cost line because the lookup
          -- above must have succeeded first.
          v_result := record_cost_item(v_case_id, jsonb_build_object(
            'cost_item_ref', v_item.cost_item_ref,
            'wbs_code', v_wbs,
            'cbs_code', v_cbs,
            'description', v_item.description,
            'basis', v_item.basis,
            'currency', v_item.currency,
            'baseline_cost', v_item.baseline_cost,
            'commitment', v_item.commitment,
            'actual', v_actual,
            'forecast', v_item.forecast,
            'contingency', v_item.contingency,
            'contingency_basis', v_item.contingency_basis));
          v_err := v_result->>'error';
          if v_err is not null then
            v_reason := v_err;
          else
            -- record_cost_item opened the canonical marker in this transaction.
            -- This update binds provenance only; no amount or coding field is
            -- written outside the one writer.
            update project_cost_items
               set source_system = v_source,
                   external_id = v_ext
             where id = v_item.id and organization_id = v_org;

            insert into audit_events
              (organization_id, entity_type, actor, event_data, previous_state, new_state)
            values
              (v_org, 'project_cost_actual_import', coalesce(
                 (select role from user_profiles where id = auth.uid() and organization_id = v_org),
                 'unknown'),
               jsonb_build_object('case_id', v_case_id, 'cost_item_id', v_item.id,
                 'cost_item_ref', v_ref, 'source_system', v_source,
                 'external_id', v_ext, 'as_of', v_as_of, 'basis', v_basis),
               jsonb_build_object('actual', v_item.actual,
                 'source_system', v_item.source_system, 'external_id', v_item.external_id),
               jsonb_build_object('actual', v_actual,
                 'source_system', v_source, 'external_id', v_ext));
            v_max_ts := greatest(coalesce(v_max_ts, v_as_of), v_as_of);
          end if;
        end if;
      elsif v_reason is null then
        v_reason := format('unsupported entity_type "%s"', r.entity_type);
      end if;
    exception
      when unique_violation then
        v_reason := 'already loaded — another run wrote this source identity while this one was in flight';
      when others then
        v_reason := format('the database refused this row: %s', sqlerrm);
    end;

    if v_reason is null then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext,
        v_payload, 'accepted');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id,
        entity_type, external_id, payload, status, reject_reason)
      values (v_org, r.connector_id, p_run_id, r.entity_type, v_ext,
        v_payload, 'rejected', v_reason);
    end if;
  end loop;

  update connector_runs
     set records_read = records_read + v_read,
         records_accepted = records_accepted + v_ok,
         records_rejected = records_rejected + v_rej,
         records_duplicate = records_duplicate + v_dup,
         watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
   where id = p_run_id and organization_id = v_org;

  return jsonb_build_object('read', v_read, 'accepted', v_ok,
    'duplicate', v_dup, 'rejected', v_rej);
end
$$;

revoke all on function public.ingest_cost_actual_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_cost_actual_batch(uuid, jsonb)
  to service_role;

comment on function public.ingest_cost_actual_batch(uuid, jsonb) is
  'D11.33 / spec §78: validates cumulative cost actual snapshots, refuses stale/conflicting/uncoded facts, and routes the amount through record_cost_item while preserving every other canonical cost field. Router-only; no baseline authority.';

-- ---------------------------------------------------------------------------
-- 3. Append one explicit dispatch branch to the current router definition.
--    The five-role gate, tenant checks and prior handlers remain byte-for-byte.
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
      'ingest_rows does not exist — the ONE ingest router this connector joins is missing.'
      using errcode = 'check_violation';
  end if;
  if position('ingest_cost_actual_batch' in v_def) = 0 then
    v_new := replace(v_def,
      $old$  elsif v_handler = 'ingest_procurement_status_batch' then
    return public.ingest_procurement_status_batch(p_run_id, p_rows);
  end if;$old$,
      $new$  elsif v_handler = 'ingest_procurement_status_batch' then
    return public.ingest_procurement_status_batch(p_run_id, p_rows);
  elsif v_handler = 'ingest_cost_actual_batch' then
    return public.ingest_cost_actual_batch(p_run_id, p_rows);
  end if;$new$);
    if v_new = v_def then
      raise exception
        'the procurement-status dispatch anchor is not in the expected shape — do not extend the ONE ingest router blind.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$router$;

revoke all on function public.ingest_rows(uuid, jsonb) from public, anon;
grant execute on function public.ingest_rows(uuid, jsonb) to authenticated;
grant execute on function public.ingest_rows(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
