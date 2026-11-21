-- C6.03 — enterprise maintenance cost per production unit.
--
-- Canonical reuse:
--   * production_records remains the production denominator;
--   * asset_economics remains the stated USD maintenance-cost numerator;
--   * assets remains the asset identity;
--   * kpi_catalog / kpi_values remain the one KPI publication store;
--   * audit_events remains the one audit ledger.
--
-- The previous reader summed every class-level economics row onto every
-- member and also added any asset-specific row, and it published a figure
-- when only some producing assets had a cost. Both understate or invent the
-- ratio. This replacement uses one current asset-specific annual cost per
-- producing asset, refuses mixed units, site totals, stale costs and any
-- uncovered producer, and lets a named human publish that exact figure.
-- Publication does not authorize expenditure, work, risk acceptance or
-- return to service.

create or replace function public.get_cost_per_production_unit(
  p_window_days int default 365
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $cost$
declare
  v_org uuid := public.app_current_org();
  v_days int := greatest(coalesce(p_window_days, 365), 1);
  v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_window_days, 365), 1));
  v_records int;
  v_uoms int;
  v_uom text;
  v_site_rows int;
  v_unresolved int;
  v_producing int;
  v_priced int;
  v_stale int;
  v_missing_cost int;
  v_units numeric;
  v_annual numeric;
  v_excluded int;
  v_sources jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
  v_cost numeric;
  v_value numeric;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object(
      'available', false,
      'error', 'forbidden',
      'value', null,
      'unit', null,
      'units_produced', null,
      'maintenance_cost_usd', null,
      'cost_coverage', 'no session organization',
      'missing_inputs', jsonb_build_array('authenticated organization'),
      'window_days', v_days,
      'basis', 'Not computable: a signed-in organization member is required.',
      'expenditureAuthorized', false
    );
  end if;

  select count(*)::int,
         count(distinct unit_of_measure)::int,
         min(unit_of_measure),
         count(*) filter (where asset_id is null)::int
    into v_records, v_uoms, v_uom, v_site_rows
  from public.production_records
  where organization_id = v_org
    and period_start >= v_from;

  if v_records = 0 then
    return jsonb_build_object(
      'available', false,
      'value', null,
      'unit', null,
      'units_produced', null,
      'maintenance_cost_usd', null,
      'cost_coverage', '0 production records',
      'missing_inputs', jsonb_build_array('production volume'),
      'window_days', v_days,
      'producing_assets', 0,
      'excluded_assets', (select count(*) from public.assets where organization_id = v_org),
      'basis', 'Not computable: production volume not recorded. A cost-per-unit figure built on a partial denominator understates it, which is the direction that flatters.',
      'expenditureAuthorized', false
    );
  end if;

  if v_uoms > 1 then
    return jsonb_build_object(
      'available', false,
      'value', null,
      'unit', null,
      'units_produced', null,
      'maintenance_cost_usd', null,
      'cost_coverage', format('%s units of measure', v_uoms),
      'missing_inputs', jsonb_build_array('one production unit of measure'),
      'window_days', v_days,
      'basis', 'Production is recorded in more than one unit of measure. A single cost-per-unit figure across mixed units would be meaningless; segment by unit before comparing.',
      'expenditureAuthorized', false
    );
  end if;

  if v_site_rows > 0 then
    return jsonb_build_object(
      'available', false,
      'value', null,
      'unit', null,
      'units_produced', null,
      'maintenance_cost_usd', null,
      'cost_coverage', format('%s site-level production records', v_site_rows),
      'missing_inputs', jsonb_build_array('asset-level production'),
      'window_days', v_days,
      'basis', 'Not computable: production includes a site total with no asset. Pairing that volume with asset maintenance cost would either count the same output twice or assign cost to output that may not belong to those assets.',
      'expenditureAuthorized', false
    );
  end if;

  with produced as (
    select pr.asset_id, sum(pr.units_produced) as units
    from public.production_records pr
    where pr.organization_id = v_org
      and pr.period_start >= v_from
      and pr.asset_id is not null
    group by pr.asset_id
  ), resolved as (
    select p.asset_id,
           a.name as asset_name,
           p.units,
           e.id as economics_id,
           e.version,
           e.evidence_item_id,
           e.annual_maintenance_cost_usd,
           e.review_due,
           case
             when a.id is null then 'unresolved_asset'
             when e.id is null or e.annual_maintenance_cost_usd is null then 'missing_cost'
             when e.review_due is not null and e.review_due < current_date then 'stale_cost'
             else 'current'
           end as posture
    from produced p
    left join public.assets a
      on a.id = p.asset_id and a.organization_id = v_org
    left join public.asset_economics e
      on e.organization_id = v_org and e.asset_id = a.id
  )
  select count(*) filter (where posture = 'unresolved_asset')::int,
         count(*) filter (where posture = 'current')::int,
         count(*) filter (where posture = 'stale_cost')::int,
         count(*) filter (where posture = 'missing_cost')::int,
         count(*)::int,
         coalesce(sum(units) filter (where posture = 'current'), 0),
         coalesce(sum(annual_maintenance_cost_usd) filter (where posture = 'current'), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'assetId', asset_id,
           'asset', asset_name,
           'economicsId', economics_id,
           'version', version,
           'evidenceItemId', evidence_item_id,
           'annualMaintenanceCostUsd', annual_maintenance_cost_usd,
           'reviewDue', review_due,
           'units', units,
           'posture', posture
         ) order by asset_name nulls last, asset_id::text) filter (where posture = 'current'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object(
           'assetId', asset_id,
           'asset', asset_name,
           'posture', posture
         ) order by asset_name nulls last, asset_id::text) filter (where posture <> 'current'), '[]'::jsonb)
    into v_unresolved, v_priced, v_stale, v_missing_cost, v_producing,
         v_units, v_annual, v_sources, v_gaps
  from resolved;

  select count(*)::int into v_excluded
  from public.assets a
  where a.organization_id = v_org
    and not exists (
      select 1 from public.production_records pr
      where pr.organization_id = v_org
        and pr.asset_id = a.id
        and pr.period_start >= v_from
    );

  if v_unresolved > 0 or v_stale > 0 or v_missing_cost > 0 or v_units <= 0 then
    return jsonb_build_object(
      'available', false,
      'value', null,
      'unit', null,
      'units_produced', v_units,
      'maintenance_cost_usd', null,
      'cost_coverage', format(
        '%s of %s producing assets have a current asset-specific maintenance cost',
        v_priced, v_producing
      ),
      'missing_inputs', v_gaps,
      'window_days', v_days,
      'producing_assets', v_producing,
      'excluded_assets', v_excluded,
      'production_records', v_records,
      'basis', case
        when v_unresolved > 0 then
          'Not computable: production names an asset outside this organization. The row is excluded rather than dropped from the denominator.'
        when v_units <= 0 then
          'Not computable: recorded production sums to zero, so there is no denominator.'
        else
          'Not computable: every producing asset needs its own current asset-specific annual maintenance cost. A class snapshot is not spread across members, and a stale or partial cost is not published — a partial numerator understates the ratio, which is the direction that flatters.'
      end,
      'expenditureAuthorized', false
    );
  end if;

  v_cost := round(v_annual * (v_days / 365.0), 2);
  v_value := round(v_cost / v_units, 4);

  return jsonb_build_object(
    'available', true,
    'value', v_value,
    'unit', 'USD per ' || v_uom,
    'units_produced', v_units,
    'maintenance_cost_usd', v_cost,
    'cost_coverage', format(
      '%s of %s producing assets carry a current asset-specific maintenance cost; %s other assets are excluded from both sides',
      v_priced, v_producing, v_excluded
    ),
    'missing_inputs', '[]'::jsonb,
    'window_days', v_days,
    'producing_assets', v_producing,
    'excluded_assets', v_excluded,
    'production_records', v_records,
    'sources', v_sources,
    'input_digest', md5(v_sources::text || '|' || v_units::text || '|' || v_days::text),
    'cost_basis', 'stated_annual_maintenance_cost_prorated',
    'currency', 'USD',
    'class_cost_used', false,
    'basis', format(
      'Stated asset-specific annual maintenance cost, prorated over %s days, divided by recorded %s production. This is not captured work-order or ERP spend, and a class economics snapshot is not allocated.',
      v_days, v_uom
    ),
    'expenditureAuthorized', false
  );
end
$cost$;

revoke all on function public.get_cost_per_production_unit(int) from public, anon;
grant execute on function public.get_cost_per_production_unit(int) to authenticated;

comment on function public.get_cost_per_production_unit(int) is
  'C6.03: tenant-scoped maintenance cost per production unit from current asset-specific economics and asset-level production. Refuses mixed units, site totals, stale costs and partial coverage. Grants no operational authority.';

create or replace function public.publish_maintenance_cost_per_unit(
  p_window_days int default 365
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $cost$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text := public.app_current_role();
  v_figure jsonb;
  v_id uuid;
begin
  if v_actor is null or v_org is null then
    return jsonb_build_object('published', false, 'error', 'forbidden',
      'basis', 'A signed-in organization member is required.');
  end if;
  if v_role = 'ai_admin'
     or v_role not in ('admin', 'executive', 'maintenance_manager') then
    insert into public.audit_events(
      organization_id, entity_type, actor, event_data, new_state
    ) values (
      v_org, 'maintenance_cost_per_unit', coalesce(nullif(v_role, ''), 'unknown'),
      jsonb_build_object(
        'action', 'publication_refused',
        'actorId', v_actor,
        'kpiKey', 'maintenance_cost_per_unit',
        'expenditureAuthorized', false,
        'workAuthorized', false,
        'riskAccepted', false,
        'returnToServiceAuthorized', false
      ),
      jsonb_build_object('role', v_role, 'published', false)
    );
    return jsonb_build_object(
      'published', false,
      'error', 'forbidden',
      'basis', case
        when v_role = 'ai_admin' then
          'Publishing maintenance cost per production unit is a named human act. The AI-operator identity may read the refusal but may not publish the figure.'
        else
          'Publishing this financial KPI requires an executive, maintenance manager or administrator.'
      end
    );
  end if;

  v_figure := public.get_cost_per_production_unit(p_window_days);

  if coalesce((v_figure->>'available')::boolean, false) is not true then
    insert into public.audit_events(
      organization_id, entity_type, actor, event_data, new_state
    ) values (
      v_org, 'maintenance_cost_per_unit', v_role,
      jsonb_build_object(
        'action', 'publication_refused',
        'actorId', v_actor,
        'kpiKey', 'maintenance_cost_per_unit',
        'expenditureAuthorized', false,
        'workAuthorized', false,
        'riskAccepted', false,
        'returnToServiceAuthorized', false
      ),
      v_figure
    );
    return jsonb_build_object(
      'published', false,
      'figure', v_figure,
      'expenditureAuthorized', false
    );
  end if;

  insert into public.kpi_values(
    organization_id, kpi_key, value, status, confidence, computed_from
  ) values (
    v_org,
    'maintenance_cost_per_unit',
    (v_figure->>'value')::numeric,
    'not_assessed',
    'high',
    v_figure
  )
  returning id into v_id;

  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    v_org, 'maintenance_cost_per_unit', v_role,
    jsonb_build_object(
      'action', 'published',
      'actorId', v_actor,
      'kpiValueId', v_id,
      'kpiKey', 'maintenance_cost_per_unit',
      'inputDigest', v_figure->>'input_digest',
      'expenditureAuthorized', false,
      'workAuthorized', false,
      'riskAccepted', false,
      'returnToServiceAuthorized', false
    ),
    v_figure
  );

  return jsonb_build_object(
    'published', true,
    'kpiValueId', v_id,
    'status', 'not_assessed',
    'figure', v_figure,
    'expenditureAuthorized', false,
    'workAuthorized', false,
    'riskAccepted', false,
    'returnToServiceAuthorized', false
  );
end
$cost$;

revoke all on function public.publish_maintenance_cost_per_unit(int) from public, anon;
grant execute on function public.publish_maintenance_cost_per_unit(int) to authenticated;

comment on function public.publish_maintenance_cost_per_unit(int) is
  'C6.03: a named executive, maintenance manager or administrator publishes the current cost-per-unit figure into kpi_values and audit_events. Unavailable figures are audited and not stored as a number. No target is assessed and no operational authority is granted.';

update public.kpi_catalog
set formula = 'Sum of current asset-specific annual maintenance cost x window/365 / recorded asset production',
    source_note = 'Published by publish_maintenance_cost_per_unit from stated asset-specific annual cost and asset-level production. Mixed units, site totals, stale economics and any producing asset without its own current cost stay unpublished. Not ERP actual spend and not assessed against a target.',
    computable = false
where kpi_key = 'maintenance_cost_per_unit';
