-- E3.07 — production-plan-level loss forecasting.
--
-- Event-level recovery already stores projected_hours_recovered and
-- projected_downtime_value_usd. This adds the missing plan: a named human
-- records a production commitment, and a draft forecast applies the unplanned
-- share already demonstrated in operating_states to that commitment.
-- Production quantities stay in production_records. No second loss ledger, no
-- equipment rating, and no monetary valuation are introduced.
--
-- SAP S/4HANA planned orders are accepted only as a document the human has
-- already reviewed. This migration does not call SAP. Re-recording the same
-- SHA-256 returns the existing plan.
--
-- Gates reused, not invented: coverage below 25%, fewer than two production
-- records, and fewer than two unplanned-down observations are the refusals in
-- generate_maintenance_optimization_run. P50/P80 of historical event losses
-- stay null below five observations, the Sync Recovery comparable-job rule.
-- The forecast row remains counterfactual. A later verification row is the
-- only record that the horizon ended and actual production covered every
-- forecasted line. The generator cannot review or verify their own forecast.

create table if not exists public.production_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_key text not null check (length(btrim(plan_key)) between 2 and 80),
  title text not null check (length(btrim(title)) between 3 and 160),
  site_id uuid references public.sites(id) on delete restrict,
  horizon_start timestamptz not null,
  horizon_end timestamptz not null,
  source_kind text not null check (source_kind in ('human_record','sap_s4_planned_order')),
  source_system text not null,
  external_id text,
  payload_sha256 text,
  basis text not null check (length(btrim(basis)) between 20 and 2000),
  supersedes_plan_id uuid references public.production_plans(id) on delete restrict,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (horizon_end > horizon_start),
  check (horizon_end - horizon_start <= interval '366 days'),
  check (
    (source_kind = 'human_record' and source_system = 'human_record')
    or (
      source_kind = 'sap_s4_planned_order'
      and source_system = 'sap_s4_planned_order'
      and external_id is not null
      and payload_sha256 ~ '^[0-9a-f]{64}$'
    )
  )
);

create unique index if not exists idx_production_plans_org_key
  on public.production_plans(organization_id, plan_key);
create unique index if not exists idx_production_plans_source_identity
  on public.production_plans(organization_id, source_system, external_id)
  where external_id is not null;
create index if not exists idx_production_plans_org_time
  on public.production_plans(organization_id, recorded_at desc);

create table if not exists public.production_plan_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.production_plans(id) on delete restrict,
  line_no integer not null check (line_no > 0),
  asset_id uuid not null references public.assets(id) on delete restrict,
  planned_quantity numeric not null check (planned_quantity > 0),
  unit_of_measure text not null check (length(btrim(unit_of_measure)) between 1 and 32),
  window_start timestamptz not null,
  window_end timestamptz not null,
  source_external_id text,
  material text,
  plant text,
  check (window_end > window_start),
  check (window_end - window_start <= interval '366 days'),
  unique (plan_id, line_no)
);

create index if not exists idx_production_plan_lines_asset
  on public.production_plan_lines(organization_id, asset_id);

create table if not exists public.production_plan_forecasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.production_plans(id) on delete restrict,
  history_days integer not null check (history_days between 30 and 730),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  verification_state text not null default 'counterfactual'
    check (verification_state = 'counterfactual'),
  generated_by uuid not null references auth.users(id),
  generated_at timestamptz not null default now()
);

create index if not exists idx_production_plan_forecasts_plan
  on public.production_plan_forecasts(organization_id, plan_id, generated_at desc);

create table if not exists public.production_plan_forecast_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  forecast_id uuid not null references public.production_plan_forecasts(id) on delete restrict,
  note text not null check (length(btrim(note)) between 20 and 2000),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now()
);

create table if not exists public.production_plan_forecast_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  forecast_id uuid not null references public.production_plan_forecasts(id) on delete restrict,
  comparison jsonb not null check (jsonb_typeof(comparison) = 'object'),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(),
  unique (forecast_id)
);

alter table public.production_plans enable row level security;
alter table public.production_plan_lines enable row level security;
alter table public.production_plan_forecasts enable row level security;
alter table public.production_plan_forecast_reviews enable row level security;
alter table public.production_plan_forecast_verifications enable row level security;

drop policy if exists production_plans_org_read on public.production_plans;
create policy production_plans_org_read on public.production_plans
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists production_plan_lines_org_read on public.production_plan_lines;
create policy production_plan_lines_org_read on public.production_plan_lines
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists production_plan_forecasts_org_read on public.production_plan_forecasts;
create policy production_plan_forecasts_org_read on public.production_plan_forecasts
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists production_plan_forecast_reviews_org_read
  on public.production_plan_forecast_reviews;
create policy production_plan_forecast_reviews_org_read
  on public.production_plan_forecast_reviews
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists production_plan_forecast_verifications_org_read
  on public.production_plan_forecast_verifications;
create policy production_plan_forecast_verifications_org_read
  on public.production_plan_forecast_verifications
  for select to authenticated using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate on public.production_plans
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.production_plan_lines
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.production_plan_forecasts
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.production_plan_forecast_reviews
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.production_plan_forecast_verifications
  from public, anon, authenticated, service_role;
grant select on public.production_plans to authenticated;
grant select on public.production_plan_lines to authenticated;
grant select on public.production_plan_forecasts to authenticated;
grant select on public.production_plan_forecast_reviews to authenticated;
grant select on public.production_plan_forecast_verifications to authenticated;

create or replace function public.protect_production_plan_forecast_rows()
returns trigger
language plpgsql
set search_path = public
as $body$
begin
  raise exception 'production-plan forecast records are append-only';
end
$body$;

revoke all on function public.protect_production_plan_forecast_rows()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_production_plans on public.production_plans;
create trigger trg_protect_production_plans
  before update or delete on public.production_plans
  for each row execute function public.protect_production_plan_forecast_rows();
drop trigger if exists trg_protect_production_plan_lines on public.production_plan_lines;
create trigger trg_protect_production_plan_lines
  before update or delete on public.production_plan_lines
  for each row execute function public.protect_production_plan_forecast_rows();
drop trigger if exists trg_protect_production_plan_forecasts
  on public.production_plan_forecasts;
create trigger trg_protect_production_plan_forecasts
  before update or delete on public.production_plan_forecasts
  for each row execute function public.protect_production_plan_forecast_rows();
drop trigger if exists trg_protect_production_plan_forecast_reviews
  on public.production_plan_forecast_reviews;
create trigger trg_protect_production_plan_forecast_reviews
  before update or delete on public.production_plan_forecast_reviews
  for each row execute function public.protect_production_plan_forecast_rows();
drop trigger if exists trg_protect_production_plan_forecast_verifications
  on public.production_plan_forecast_verifications;
create trigger trg_protect_production_plan_forecast_verifications
  before update or delete on public.production_plan_forecast_verifications
  for each row execute function public.protect_production_plan_forecast_rows();

create or replace function public.record_production_plan(
  p_plan_key text,
  p_title text,
  p_site_id uuid,
  p_source_kind text,
  p_payload_sha256 text,
  p_basis text,
  p_lines jsonb,
  p_supersedes_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_existing uuid;
  v_id uuid;
  v_clean jsonb := '[]'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_item record;
  v_asset_id uuid;
  v_asset_site uuid;
  v_qty numeric;
  v_unit text;
  v_start timestamptz;
  v_end timestamptz;
  v_ext text;
  v_material text;
  v_plant text;
  v_min_start timestamptz;
  v_max_end timestamptz;
  v_line_no integer := 0;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','ai_admin cannot record, forecast, review or verify a production plan');
  end if;
  if not public.production_loss_human_role_allowed() then
    return jsonb_build_object('error','a named operations, planning or maintenance role is required');
  end if;
  if coalesce(length(btrim(p_plan_key)),0) not between 2 and 80
     or coalesce(length(btrim(p_title)),0) not between 3 and 160
     or coalesce(length(btrim(p_basis)),0) not between 20 and 2000 then
    return jsonb_build_object('error','plan key, title and a 20-character evidence basis are required');
  end if;
  if p_source_kind not in ('human_record','sap_s4_planned_order') then
    return jsonb_build_object('error','source must be a human record or a reviewed SAP planned-order document');
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.organization_id = v_org
  ) then
    return jsonb_build_object('error','site is outside the active tenant or does not exist');
  end if;
  if p_supersedes_plan_id is not null and not exists (
    select 1 from public.production_plans existing_plan
    where existing_plan.id = p_supersedes_plan_id
      and existing_plan.organization_id = v_org
  ) then
    return jsonb_build_object('error','the plan being replaced is outside the active tenant or does not exist');
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 100 then
    return jsonb_build_object('error','a production plan needs between 1 and 100 lines');
  end if;
  if p_source_kind = 'sap_s4_planned_order' then
    if p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
      return jsonb_build_object('error','the reviewed SAP document needs its SHA-256');
    end if;
    select id into v_existing
    from public.production_plans
    where organization_id = v_org
      and source_system = 'sap_s4_planned_order'
      and external_id = p_payload_sha256;
    if v_existing is not null then
      return jsonb_build_object(
        'idempotent', true, 'planId', v_existing, 'sapContacted', false
      );
    end if;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    v_asset_id := (v_item.value->>'assetId')::uuid;
    v_qty := (v_item.value->>'plannedQuantity')::numeric;
    v_unit := btrim(v_item.value->>'unitOfMeasure');
    v_start := (v_item.value->>'windowStart')::timestamptz;
    v_end := (v_item.value->>'windowEnd')::timestamptz;
    v_ext := nullif(btrim(v_item.value->>'sourceExternalId'), '');
    v_material := nullif(btrim(v_item.value->>'material'), '');
    v_plant := nullif(btrim(v_item.value->>'plant'), '');
    if v_qty is null or v_qty <= 0 then
      return jsonb_build_object('error','Plan quantity must be positive.');
    end if;
    if v_unit is null or length(v_unit) < 1
       or length(v_unit) > case when p_source_kind = 'sap_s4_planned_order' then 3 else 32 end then
      return jsonb_build_object('error','unit of measure is missing or longer than the source allows');
    end if;
    if v_start is null or v_end is null or v_end <= v_start then
      return jsonb_build_object('error','line window end must be after its start');
    end if;
    if v_end - v_start > interval '366 days' then
      return jsonb_build_object('error','a plan line window cannot exceed 366 days; this is a record bound, not an operating limit');
    end if;
    select a.site_id into v_asset_site
    from public.assets a
    where a.id = v_asset_id and a.organization_id = v_org;
    if not found then
      return jsonb_build_object('error','asset is outside the active tenant or does not exist');
    end if;
    if p_site_id is not null and v_asset_site is not null and v_asset_site is distinct from p_site_id then
      return jsonb_build_object('error','asset is not in the selected site');
    end if;
    if p_source_kind = 'sap_s4_planned_order' then
      if v_ext is null or v_material is null or v_plant is null then
        return jsonb_build_object('error','each SAP planned-order line needs its order, material and plant');
      end if;
      if v_ext !~ '^[A-Za-z0-9._/-]+$' or length(v_ext) > 20
         or v_material !~ '^[A-Za-z0-9._/-]+$' or length(v_material) > 40
         or v_plant !~ '^[A-Za-z0-9._/-]+$' or length(v_plant) > 20 then
        return jsonb_build_object('error','SAP order, material and plant must be explicit identifiers');
      end if;
      if v_seen @> jsonb_build_object(v_ext, true) then
        return jsonb_build_object('error','duplicate planned order '||v_ext);
      end if;
      v_seen := v_seen || jsonb_build_object(v_ext, true);
    end if;
    v_min_start := least(coalesce(v_min_start, v_start), v_start);
    v_max_end := greatest(coalesce(v_max_end, v_end), v_end);
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'line_no', v_line_no,
      'asset_id', v_asset_id,
      'planned_quantity', v_qty,
      'unit_of_measure', v_unit,
      'window_start', v_start,
      'window_end', v_end,
      'source_external_id', v_ext,
      'material', v_material,
      'plant', v_plant
    ));
  end loop;

  if v_max_end - v_min_start > interval '366 days' then
    return jsonb_build_object('error','a production plan cannot span more than 366 days; this is a record bound, not an operating limit');
  end if;

  insert into public.production_plans(
    organization_id, plan_key, title, site_id, horizon_start, horizon_end,
    source_kind, source_system, external_id, payload_sha256, basis,
    supersedes_plan_id, recorded_by
  ) values (
    v_org, btrim(p_plan_key), btrim(p_title), p_site_id, v_min_start, v_max_end,
    p_source_kind,
    case when p_source_kind = 'sap_s4_planned_order' then 'sap_s4_planned_order' else 'human_record' end,
    case when p_source_kind = 'sap_s4_planned_order' then p_payload_sha256 else null end,
    case when p_source_kind = 'sap_s4_planned_order' then p_payload_sha256 else null end,
    btrim(p_basis), p_supersedes_plan_id, auth.uid()
  ) returning id into v_id;

  insert into public.production_plan_lines(
    organization_id, plan_id, line_no, asset_id, planned_quantity,
    unit_of_measure, window_start, window_end, source_external_id, material, plant
  )
  select v_org, v_id, x.line_no, x.asset_id::uuid, x.planned_quantity,
    x.unit_of_measure, x.window_start, x.window_end, x.source_external_id,
    x.material, x.plant
  from jsonb_to_recordset(v_clean) as x(
    line_no integer,
    asset_id text,
    planned_quantity numeric,
    unit_of_measure text,
    window_start timestamptz,
    window_end timestamptz,
    source_external_id text,
    material text,
    plant text
  );

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'production_plan_forecast', public.app_current_role(),
    jsonb_build_object(
      'action','recorded','planId',v_id,'sourceKind',p_source_kind,
      'lineCount',v_line_no,'actorId',auth.uid(),
      'sapContacted',false,'productionValueAuthorized',false
    )
  );

  return jsonb_build_object(
    'planId', v_id, 'lineCount', v_line_no, 'idempotent', false, 'sapContacted', false
  );
exception
  when unique_violation then
    return jsonb_build_object('error','a production plan with this key or source document already exists');
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    return jsonb_build_object('error','a plan line contains a value that is not a quantity, timestamp or asset id');
end
$body$;

revoke all on function public.record_production_plan(text, text, uuid, text, text, text, jsonb, uuid)
  from public, anon, service_role;
grant execute on function public.record_production_plan(text, text, uuid, text, text, text, jsonb, uuid)
  to authenticated;

create or replace function public.forecast_production_plan_loss(
  p_plan_id uuid,
  p_history_days integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_history integer := least(greatest(coalesce(p_history_days, 180), 30), 730);
  v_plan public.production_plans%rowtype;
  v_line public.production_plan_lines%rowtype;
  v_history_start timestamptz;
  v_history_end timestamptz;
  v_history_hours numeric;
  v_covered numeric;
  v_running numeric;
  v_unplanned numeric;
  v_event_hours numeric[];
  v_event_count integer;
  v_units numeric;
  v_records integer;
  v_unit_count integer;
  v_unit text;
  v_planned numeric;
  v_unplanned_hours numeric;
  v_covered_hours numeric;
  v_rate numeric;
  v_expected numeric;
  v_attainable numeric;
  v_p50 numeric;
  v_p80 numeric;
  v_refusal text;
  v_line_status text;
  v_asset_name text;
  v_asset_tag text;
  v_lines jsonb := '[]'::jsonb;
  v_by_unit jsonb;
  v_forecasted integer := 0;
  v_refused integer := 0;
  v_status text;
  v_id uuid;
  v_result jsonb;
  v_point text := 'Point forecast is planned quantity times the unplanned share of covered time. That equals planned running time at the demonstrated rate times that share times the rate. A zero demonstrated rate is refused rather than treated as a number. No equipment rating is used.';
  v_rollup text := 'Each forecasted line is summed only within the same unit. Overlapping lines are not deduplicated. Unlike units are never added.';
  v_authority text := 'Advisory draft only. This forecast does not change the production plan, release work, book a monetary loss, accept risk, or authorize return to service.';
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','ai_admin cannot record, forecast, review or verify a production plan');
  end if;
  if not public.production_loss_human_role_allowed() then
    return jsonb_build_object('error','a named operations, planning or maintenance role is required');
  end if;

  select * into v_plan
  from public.production_plans
  where id = p_plan_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error','production plan is outside the active tenant or does not exist');
  end if;
  if exists (
    select 1 from public.production_plans newer
    where newer.organization_id = v_org and newer.supersedes_plan_id = v_plan.id
  ) then
    return jsonb_build_object('error','this production plan has been superseded; forecast the replacement plan');
  end if;

  for v_line in
    select * from public.production_plan_lines
    where plan_id = v_plan.id and organization_id = v_org
    order by line_no
  loop
    v_history_end := least(now(), v_line.window_start);
    v_history_start := v_history_end - make_interval(days => v_history);
    v_history_hours := v_history * 24.0;
    v_refusal := null;
    v_line_status := 'forecast';
    v_p50 := null;
    v_p80 := null;
    v_expected := null;
    v_attainable := null;
    v_rate := null;

    select coalesce(sum(clipped.hrs), 0),
           coalesce(sum(clipped.hrs) filter (where clipped.state = 'running'), 0)
    into v_covered, v_running
    from (
      select s.state,
        extract(epoch from (
          least(coalesce(s.ended_at, v_history_end), v_history_end)
          - greatest(s.started_at, v_history_start)
        )) / 3600.0 as hrs
      from public.operating_states s
      where s.organization_id = v_org
        and s.asset_id = v_line.asset_id
        and s.started_at < v_history_end
        and coalesce(s.ended_at, v_history_end) > v_history_start
    ) clipped
    where clipped.hrs > 0;

    select coalesce(array_agg(event_hours.hrs order by event_hours.hrs), '{}'::numeric[])
    into v_event_hours
    from (
      select extract(epoch from (
        least(coalesce(s.ended_at, v_history_end), v_history_end)
        - greatest(s.started_at, v_history_start)
      )) / 3600.0 as hrs
      from public.operating_states s
      where s.organization_id = v_org
        and s.asset_id = v_line.asset_id
        and s.state = 'down_unplanned'
        and s.started_at < v_history_end
        and coalesce(s.ended_at, v_history_end) > v_history_start
    ) event_hours
    where event_hours.hrs > 0;

    v_event_count := coalesce(array_length(v_event_hours, 1), 0);
    v_unplanned := coalesce((select sum(hours_item) from unnest(v_event_hours) as hours_item), 0);

    select coalesce(sum(p.units_produced), 0), count(*)::integer,
           count(distinct p.unit_of_measure)::integer,
           min(p.unit_of_measure)
    into v_units, v_records, v_unit_count, v_unit
    from public.production_records p
    where p.organization_id = v_org
      and p.asset_id = v_line.asset_id
      and p.period_end > v_history_start
      and p.period_start < v_history_end;

    v_planned := v_line.planned_quantity;
    v_unplanned_hours := v_unplanned;
    v_covered_hours := v_covered;

    if v_covered_hours <= 0 or v_history_hours <= 0 then
      v_line_status := 'not_assessable';
      v_refusal := 'No operating-state history is available.';
    elsif v_covered_hours / v_history_hours < 0.25 then
      v_line_status := 'not_assessable';
      v_refusal := 'Operating-state coverage is below 25%; extrapolation is refused.';
    elsif v_running <= 0 then
      v_line_status := 'not_assessable';
      v_refusal := 'No demonstrated running hours exist.';
    elsif v_records < 2 then
      v_line_status := 'not_assessable';
      v_refusal := 'Fewer than two production records exist.';
    elsif v_unit_count is distinct from 1 then
      v_line_status := 'not_assessable';
      v_refusal := 'Production units conflict and cannot be combined.';
    elsif v_event_count < 2 then
      v_line_status := 'not_assessable';
      v_refusal := 'Fewer than two unplanned-down observations exist; a repeat rate is not established.';
    elsif v_unit is distinct from v_line.unit_of_measure then
      v_line_status := 'not_assessable';
      v_refusal := 'Plan unit does not match the demonstrated production unit; no conversion is applied.';
    elsif v_planned <= 0 then
      v_line_status := 'not_assessable';
      v_refusal := 'Plan quantity must be positive.';
    elsif v_units <= 0 then
      v_line_status := 'not_assessable';
      v_refusal := 'Demonstrated production during running hours is zero, so the plan quantity cannot be converted into expected running time.';
    else
      v_rate := v_units / v_running;
      v_expected := round((v_planned * v_unplanned_hours / v_covered_hours)::numeric, 3);
      v_attainable := round((v_planned - (v_planned * v_unplanned_hours / v_covered_hours))::numeric, 3);
      if v_event_count >= 5 then
        select percentile_disc(0.5) within group (order by event_hours * v_rate),
               percentile_disc(0.8) within group (order by event_hours * v_rate)
        into v_p50, v_p80
        from unnest(v_event_hours) as event_hours;
      end if;
    end if;

    if v_line_status = 'forecast' then
      v_forecasted := v_forecasted + 1;
    else
      v_refused := v_refused + 1;
    end if;

    select a.name, coalesce(nullif(a.asset_tag, ''), a.tag)
    into v_asset_name, v_asset_tag
    from public.assets a
    where a.id = v_line.asset_id and a.organization_id = v_org;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'lineNo', v_line.line_no,
      'assetId', v_line.asset_id,
      'assetName', v_asset_name,
      'assetTag', v_asset_tag,
      'plannedQuantity', v_planned,
      'unitOfMeasure', v_line.unit_of_measure,
      'windowStart', v_line.window_start,
      'windowEnd', v_line.window_end,
      'status', v_line_status,
      'refusal', v_refusal,
      'stateCoveragePct', case when v_history_hours > 0
        then round((100 * v_covered_hours / v_history_hours)::numeric, 1) else null end,
      'demonstratedRate', case when v_rate is null then null else round(v_rate::numeric, 6) end,
      'unplannedShare', case when v_line_status = 'forecast' and v_covered_hours > 0
        then round((v_unplanned_hours / v_covered_hours)::numeric, 6) else null end,
      'expectedUnitsAtRisk', v_expected,
      'expectedAttainableUnits', v_attainable,
      'historicalEventLossP50', case when v_event_count >= 5 and v_p50 is not null
        then round(v_p50::numeric, 3) else null end,
      'historicalEventLossP80', case when v_event_count >= 5 and v_p80 is not null
        then round(v_p80::numeric, 3) else null end,
      'percentileSample', v_event_count,
      'productionRecordCount', v_records,
      'unplannedEvents', v_event_count,
      'sourceExternalId', v_line.source_external_id,
      'material', v_line.material,
      'plant', v_line.plant
    ));
  end loop;

  if v_forecasted + v_refused = 0 then
    return jsonb_build_object('error','production plan has no lines');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'unitOfMeasure', grouped.unit_of_measure,
    'forecastedLines', grouped.forecasted_lines,
    'refusedLines', grouped.refused_lines,
    'plannedQuantityForecast', grouped.planned_quantity_forecast,
    'expectedUnitsAtRisk', grouped.expected_units_at_risk,
    'complete', grouped.refused_lines = 0 and grouped.forecasted_lines > 0
  ) order by grouped.unit_of_measure), '[]'::jsonb)
  into v_by_unit
  from (
    select x."unitOfMeasure" as unit_of_measure,
      count(*) filter (where x.status = 'forecast') as forecasted_lines,
      count(*) filter (where x.status <> 'forecast') as refused_lines,
      round(sum(x."plannedQuantity") filter (where x.status = 'forecast'), 3) as planned_quantity_forecast,
      round(sum(x."expectedUnitsAtRisk") filter (where x.status = 'forecast'), 3) as expected_units_at_risk
    from jsonb_to_recordset(v_lines) as x(
      status text,
      "unitOfMeasure" text,
      "plannedQuantity" numeric,
      "expectedUnitsAtRisk" numeric
    )
    group by x."unitOfMeasure"
  ) grouped;

  v_status := case
    when v_forecasted = 0 then 'not_assessable'
    when v_refused > 0 then 'partial'
    else 'forecast'
  end;

  v_result := jsonb_build_object(
    'historyDays', v_history,
    'planStatus', v_status,
    'frozenVerificationState', 'counterfactual',
    'byUnit', v_by_unit,
    'lines', v_lines,
    'basis', v_point,
    'authority', v_authority,
    'rollupBasis', v_rollup,
    'overlappingLines', 'not_deduplicated',
    'monetaryValuation', 'not_computed',
    'equipmentRatingUsed', false,
    'sapContacted', false
  );

  insert into public.production_plan_forecasts(
    organization_id, plan_id, history_days, result, verification_state, generated_by
  ) values (
    v_org, v_plan.id, v_history, v_result, 'counterfactual', auth.uid()
  ) returning id into v_id;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'production_plan_forecast', public.app_current_role(),
    jsonb_build_object(
      'action','forecast','forecastId',v_id,'planId',v_plan.id,
      'planStatus',v_status,'verificationState','counterfactual',
      'actorId',auth.uid(),'sapContacted',false,'productionValueAuthorized',false
    )
  );

  return v_result || jsonb_build_object('forecastId', v_id, 'verificationState', 'counterfactual');
end
$body$;

revoke all on function public.forecast_production_plan_loss(uuid, integer)
  from public, anon, service_role;
grant execute on function public.forecast_production_plan_loss(uuid, integer)
  to authenticated;

create or replace function public.review_production_plan_forecast(
  p_forecast_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_forecast public.production_plan_forecasts%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','ai_admin cannot record, forecast, review or verify a production plan');
  end if;
  if not public.production_loss_human_role_allowed() then
    return jsonb_build_object('error','a named operations, planning or maintenance role is required');
  end if;
  if coalesce(length(btrim(p_note)),0) not between 20 and 2000 then
    return jsonb_build_object('error','a review note of between 20 and 2000 characters is required');
  end if;
  select * into v_forecast
  from public.production_plan_forecasts
  where id = p_forecast_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error','forecast is outside the active tenant or does not exist');
  end if;
  if v_forecast.generated_by = auth.uid() then
    return jsonb_build_object('error','The person who generated the forecast cannot review it.');
  end if;

  insert into public.production_plan_forecast_reviews(
    organization_id, forecast_id, note, reviewed_by
  ) values (
    v_org, v_forecast.id, btrim(p_note), auth.uid()
  ) returning id into v_id;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'production_plan_forecast', public.app_current_role(),
    jsonb_build_object(
      'action','reviewed','reviewId',v_id,'forecastId',v_forecast.id,
      'actorId',auth.uid(),'verificationState','counterfactual',
      'productionValueAuthorized',false
    )
  );

  return jsonb_build_object(
    'reviewed', true, 'reviewId', v_id, 'verificationState', 'counterfactual'
  );
end
$body$;

revoke all on function public.review_production_plan_forecast(uuid, text)
  from public, anon, service_role;
grant execute on function public.review_production_plan_forecast(uuid, text)
  to authenticated;

create or replace function public.verify_production_plan_forecast(
  p_forecast_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_forecast public.production_plan_forecasts%rowtype;
  v_item record;
  v_forecasted integer := 0;
  v_max_end timestamptz := '-infinity'::timestamptz;
  v_records integer;
  v_actual numeric;
  v_missing integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_planned numeric;
  v_attainable numeric;
  v_id uuid;
  v_comparison jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','ai_admin cannot record, forecast, review or verify a production plan');
  end if;
  if not public.production_loss_human_role_allowed() then
    return jsonb_build_object('error','a named operations, planning or maintenance role is required');
  end if;

  select * into v_forecast
  from public.production_plan_forecasts
  where id = p_forecast_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error','forecast is outside the active tenant or does not exist');
  end if;
  if v_forecast.generated_by = auth.uid() then
    return jsonb_build_object('error','The person who generated the forecast cannot verify it.');
  end if;
  if exists (
    select 1 from public.production_plan_forecast_verifications existing_verification
    where existing_verification.forecast_id = v_forecast.id
      and existing_verification.organization_id = v_org
  ) then
    return jsonb_build_object('error','This forecast already has a verification record.');
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_forecast.result->'lines', '[]'::jsonb))
  loop
    if v_item.value->>'status' is distinct from 'forecast' then
      continue;
    end if;
    v_forecasted := v_forecasted + 1;
    if (v_item.value->>'windowEnd')::timestamptz > v_max_end then
      v_max_end := (v_item.value->>'windowEnd')::timestamptz;
    end if;
  end loop;

  if v_max_end > now() then
    return jsonb_build_object(
      'verified', false, 'verificationState', 'counterfactual',
      'refusal', 'The plan horizon has not ended; the forecast stays counterfactual.'
    );
  end if;
  if v_forecasted = 0 then
    return jsonb_build_object(
      'verified', false, 'verificationState', 'counterfactual',
      'refusal', 'No forecasted line exists, so there is nothing to verify.'
    );
  end if;

  for v_item in
    select value from jsonb_array_elements(v_forecast.result->'lines')
  loop
    if v_item.value->>'status' is distinct from 'forecast' then
      continue;
    end if;
    select count(*)::integer, coalesce(sum(p.units_produced), 0)
    into v_records, v_actual
    from public.production_records p
    where p.organization_id = v_org
      and p.asset_id = (v_item.value->>'assetId')::uuid
      and p.unit_of_measure = v_item.value->>'unitOfMeasure'
      and p.period_end > (v_item.value->>'windowStart')::timestamptz
      and p.period_start < (v_item.value->>'windowEnd')::timestamptz;
    if v_records = 0 then
      v_missing := v_missing + 1;
    else
      v_planned := (v_item.value->>'plannedQuantity')::numeric;
      v_attainable := (v_item.value->>'expectedAttainableUnits')::numeric;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'lineNo', (v_item.value->>'lineNo')::integer,
        'assetId', v_item.value->>'assetId',
        'unitOfMeasure', v_item.value->>'unitOfMeasure',
        'plannedQuantity', v_planned,
        'expectedUnitsAtRisk', (v_item.value->>'expectedUnitsAtRisk')::numeric,
        'expectedAttainableUnits', v_attainable,
        'actualUnits', round(v_actual, 3),
        'productionRecordCount', v_records,
        'varianceVsPlan', round(v_actual - v_planned, 3),
        'varianceVsExpectedAttainable', round(v_actual - v_attainable, 3),
        'actualsProrated', false
      ));
    end if;
  end loop;

  if v_missing > 0 then
    return jsonb_build_object(
      'verified', false, 'verificationState', 'counterfactual',
      'refusal', 'Actual production records do not cover every forecasted line; the forecast stays counterfactual.'
    );
  end if;

  v_comparison := jsonb_build_object(
    'lines', v_lines,
    'basis', 'Actual units are the sum of production records overlapping the line window in the plan unit. Records are not prorated. No tolerance is applied.',
    'monetaryValuation', 'not_computed'
  );

  insert into public.production_plan_forecast_verifications(
    organization_id, forecast_id, comparison, verified_by
  ) values (
    v_org, v_forecast.id, v_comparison, auth.uid()
  ) returning id into v_id;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'production_plan_forecast', public.app_current_role(),
    jsonb_build_object(
      'action','verified','verificationId',v_id,'forecastId',v_forecast.id,
      'actorId',auth.uid(),'verificationState','verified',
      'productionValueAuthorized',false
    )
  );

  return jsonb_build_object(
    'verified', true, 'verificationId', v_id,
    'verificationState', 'verified', 'comparison', v_comparison
  );
end
$body$;

revoke all on function public.verify_production_plan_forecast(uuid)
  from public, anon, service_role;
grant execute on function public.verify_production_plan_forecast(uuid)
  to authenticated;

create or replace function public.get_production_plan_loss_forecast()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $body$
declare
  v_org uuid := public.app_current_org();
  v_plans jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;

  select coalesce(jsonb_agg(payload.plan_json order by payload.recorded_at desc), '[]'::jsonb)
  into v_plans
  from (
    select p.recorded_at,
      jsonb_build_object(
        'planId', p.id,
        'planKey', p.plan_key,
        'title', p.title,
        'sourceKind', p.source_kind,
        'sourceSystem', p.source_system,
        'payloadSha256', p.payload_sha256,
        'basis', p.basis,
        'siteId', p.site_id,
        'horizonStart', p.horizon_start,
        'horizonEnd', p.horizon_end,
        'recordedAt', p.recorded_at,
        'supersedesPlanId', p.supersedes_plan_id,
        'superseded', exists (
          select 1 from public.production_plans newer
          where newer.organization_id = v_org and newer.supersedes_plan_id = p.id
        ),
        'lines', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'lineNo', l.line_no,
            'assetId', l.asset_id,
            'assetName', a.name,
            'assetTag', coalesce(nullif(a.asset_tag, ''), a.tag),
            'plannedQuantity', l.planned_quantity,
            'unitOfMeasure', l.unit_of_measure,
            'windowStart', l.window_start,
            'windowEnd', l.window_end,
            'sourceExternalId', l.source_external_id,
            'material', l.material,
            'plant', l.plant
          ) order by l.line_no), '[]'::jsonb)
          from public.production_plan_lines l
          join public.assets a
            on a.id = l.asset_id and a.organization_id = v_org
          where l.plan_id = p.id and l.organization_id = v_org
        ),
        'forecast', (
          select jsonb_build_object(
            'forecastId', f.id,
            'generatedAt', f.generated_at,
            'generatedBy', f.generated_by,
            'historyDays', f.result->'historyDays',
            'frozenVerificationState', 'counterfactual',
            'verificationState', case when v.id is null then 'counterfactual' else 'verified' end,
            'planStatus', f.result->>'planStatus',
            'byUnit', coalesce(f.result->'byUnit', '[]'::jsonb),
            'lines', coalesce(f.result->'lines', '[]'::jsonb),
            'basis', f.result->>'basis',
            'authority', f.result->>'authority',
            'rollupBasis', f.result->>'rollupBasis',
            'reviews', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'reviewId', r.id,
                'note', r.note,
                'reviewedAt', r.reviewed_at,
                'reviewedBy', r.reviewed_by
              ) order by r.reviewed_at), '[]'::jsonb)
              from public.production_plan_forecast_reviews r
              where r.forecast_id = f.id and r.organization_id = v_org
            ),
            'verification', case when v.id is null then null else jsonb_build_object(
              'verificationId', v.id,
              'verifiedAt', v.verified_at,
              'verifiedBy', v.verified_by,
              'comparison', v.comparison
            ) end
          )
          from public.production_plan_forecasts f
          left join public.production_plan_forecast_verifications v
            on v.forecast_id = f.id and v.organization_id = v_org
          where f.plan_id = p.id and f.organization_id = v_org
          order by f.generated_at desc, f.id desc
          limit 1
        )
      ) as plan_json
    from public.production_plans p
    where p.organization_id = v_org
    order by p.recorded_at desc
    limit 20
  ) payload;

  return jsonb_build_object(
    'plans', v_plans,
    'basis', 'Point forecast is planned quantity times the unplanned share of covered time. That equals planned running time at the demonstrated rate times that share times the rate. A zero demonstrated rate is refused rather than treated as a number. No equipment rating is used.',
    'authority', 'Advisory draft only. This forecast does not change the production plan, release work, book a monetary loss, accept risk, or authorize return to service.'
  );
end
$body$;

revoke all on function public.get_production_plan_loss_forecast()
  from public, anon, service_role;
grant execute on function public.get_production_plan_loss_forecast()
  to authenticated;
