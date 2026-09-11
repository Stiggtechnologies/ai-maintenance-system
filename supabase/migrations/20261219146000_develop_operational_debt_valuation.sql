-- Sync Develop D8.04 — stated-basis lifecycle exposure over the canonical
-- Operational Debt register. A missing valuation remains missing, never zero.

create table if not exists public.operational_debt_valuations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operational_debt_item_id uuid not null references public.operational_debt_items(id) on delete cascade,
  version integer not null check (version > 0),
  resolution_cost numeric not null check (sync_is_finite_numeric(resolution_cost) and resolution_cost >= 0),
  annual_operating_cost numeric not null check (sync_is_finite_numeric(annual_operating_cost) and annual_operating_cost >= 0),
  annual_risk_exposure numeric not null check (sync_is_finite_numeric(annual_risk_exposure) and annual_risk_exposure >= 0),
  exposure_years numeric not null check (sync_is_finite_numeric(exposure_years) and exposure_years > 0 and exposure_years <= 100),
  discount_rate numeric not null check (sync_is_finite_numeric(discount_rate) and discount_rate >= 0 and discount_rate < 1),
  lifecycle_exposure numeric not null check (sync_is_finite_numeric(lifecycle_exposure) and lifecycle_exposure >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  basis text not null check (length(btrim(basis)) >= 20),
  source_reference text not null check (length(btrim(source_reference)) >= 3),
  status text not null default 'pending_approval'
    check (status in ('pending_approval','approved','superseded')),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approval_basis text,
  unique (operational_debt_item_id, version),
  check ((status='pending_approval' and approved_by is null and approved_at is null and approval_basis is null)
    or (status in ('approved','superseded') and approved_by is not null and approved_at is not null
      and length(btrim(approval_basis)) >= 20))
);
create index if not exists idx_operational_debt_valuation_item
  on public.operational_debt_valuations(organization_id,operational_debt_item_id,version desc);
create unique index if not exists uq_operational_debt_pending_valuation
  on public.operational_debt_valuations(operational_debt_item_id) where status='pending_approval';
create unique index if not exists uq_operational_debt_approved_valuation
  on public.operational_debt_valuations(operational_debt_item_id) where status='approved';
alter table public.operational_debt_valuations enable row level security;
drop policy if exists operational_debt_valuations_read on public.operational_debt_valuations;
create policy operational_debt_valuations_read on public.operational_debt_valuations
  for select to authenticated using (organization_id=app_current_org());

create or replace function public.record_operational_debt_valuation(
  p_item_id uuid, p_resolution_cost numeric, p_annual_operating_cost numeric,
  p_annual_risk_exposure numeric, p_exposure_years numeric,
  p_discount_rate numeric, p_currency text, p_basis text, p_source_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  v_version integer; v_exposure numeric; v_currency text:=upper(btrim(p_currency));
begin
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    raise exception 'lifecycle-exposure valuation requires an authorized human planning, engineering or operations role';
  end if;
  if not exists(select 1 from operational_debt_items where id=p_item_id and organization_id=v_org) then
    raise exception 'operational-debt item not found in this organization';
  end if;
  if exists(select 1 from operational_debt_valuations where organization_id=v_org
      and operational_debt_item_id=p_item_id and status='pending_approval') then
    raise exception 'this item already has a valuation awaiting independent approval';
  end if;
  if p_resolution_cost is null or p_annual_operating_cost is null or p_annual_risk_exposure is null
    or p_exposure_years is null or p_discount_rate is null then
    raise exception 'all five valuation inputs are required; leave the item unvalued rather than substituting zero for an unknown';
  end if;
  if not sync_is_finite_numeric(p_resolution_cost) or p_resolution_cost<0
    or not sync_is_finite_numeric(p_annual_operating_cost) or p_annual_operating_cost<0
    or not sync_is_finite_numeric(p_annual_risk_exposure) or p_annual_risk_exposure<0
    or not sync_is_finite_numeric(p_exposure_years) or p_exposure_years<=0 or p_exposure_years>100
    or not sync_is_finite_numeric(p_discount_rate) or p_discount_rate<0 or p_discount_rate>=1 then
    raise exception 'valuation inputs must be finite and within the stated non-negative cost, 0–100 year and 0–1 discount-rate bounds';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'valuation currency must be a three-letter ISO code'; end if;
  if length(btrim(coalesce(p_basis,'')))<20 then raise exception 'valuation requires a stated calculation and assumption basis of at least 20 characters'; end if;
  if length(btrim(coalesce(p_source_reference,'')))<3 then raise exception 'valuation requires a source or evidence reference'; end if;

  -- Explicitly stated zero is allowed inside a complete input set. Missing inputs
  -- refuse above. The recurring exposure is discounted as an annuity.
  v_exposure:=round(p_resolution_cost +
    case when p_discount_rate=0 then
      (p_annual_operating_cost+p_annual_risk_exposure)*p_exposure_years
    else (p_annual_operating_cost+p_annual_risk_exposure)*
      (1-power(1+p_discount_rate,-p_exposure_years))/p_discount_rate end,2);
  select coalesce(max(version),0)+1 into v_version from operational_debt_valuations
    where operational_debt_item_id=p_item_id;
  insert into operational_debt_valuations(organization_id,operational_debt_item_id,version,
    resolution_cost,annual_operating_cost,annual_risk_exposure,exposure_years,
    discount_rate,lifecycle_exposure,currency,basis,source_reference,recorded_by)
  values(v_org,p_item_id,v_version,p_resolution_cost,p_annual_operating_cost,
    p_annual_risk_exposure,p_exposure_years,p_discount_rate,v_exposure,v_currency,
    btrim(p_basis),btrim(p_source_reference),v_uid);
  insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
  values(v_org,'operational_debt_valuation',v_role,
    jsonb_build_object('action','calculated','operational_debt_item_id',p_item_id,'version',v_version),
    jsonb_build_object('status','pending_approval','lifecycle_exposure',v_exposure,
      'currency',v_currency,'source_reference',btrim(p_source_reference)));
  return jsonb_build_object('itemId',p_item_id,'version',v_version,
    'lifecycleExposure',v_exposure,'currency',v_currency,'status','pending_approval');
end $$;

create or replace function public.approve_operational_debt_valuation(
  p_item_id uuid, p_version integer, p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text;
  v_record operational_debt_valuations%rowtype;
begin
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager') then
    raise exception 'valuation approval requires accountable human operations or executive authority';
  end if;
  select * into v_record from operational_debt_valuations where organization_id=v_org
    and operational_debt_item_id=p_item_id and version=p_version and status='pending_approval';
  if not found then raise exception 'pending operational-debt valuation not found in this organization'; end if;
  if v_record.recorded_by=v_uid then raise exception 'the valuation recorder cannot approve the same calculation'; end if;
  if length(btrim(coalesce(p_basis,'')))<20 then raise exception 'valuation approval requires an evidence basis of at least 20 characters'; end if;
  update operational_debt_valuations set status='superseded'
    where organization_id=v_org and operational_debt_item_id=p_item_id and status='approved';
  update operational_debt_valuations set status='approved',approved_by=v_uid,
    approved_at=now(),approval_basis=btrim(p_basis)
    where id=v_record.id;
  insert into audit_events(organization_id,entity_type,actor,event_data,previous_state,new_state)
  values(v_org,'operational_debt_valuation',v_role,
    jsonb_build_object('action','approved','operational_debt_item_id',p_item_id,'version',p_version),
    jsonb_build_object('status','pending_approval'),
    jsonb_build_object('status','approved','basis',btrim(p_basis),'lifecycle_exposure',v_record.lifecycle_exposure,'currency',v_record.currency));
  return jsonb_build_object('itemId',p_item_id,'version',p_version,'status','approved',
    'lifecycleExposure',v_record.lifecycle_exposure,'currency',v_record.currency);
end $$;

create or replace function public.get_case_operational_debt(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_result jsonb;
begin
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    raise exception 'development case not found in this organization';
  end if;
  with debts as (
    select o.*,coalesce(p.full_name,p.email,o.owner_id::text) owner_name,
      a.version approved_version,a.lifecycle_exposure,a.currency,a.basis valuation_basis,
      a.source_reference,a.approved_at valuation_approved_at,
      q.version pending_version,q.lifecycle_exposure pending_exposure,q.currency pending_currency
    from operational_debt_items o
    left join user_profiles p on p.organization_id=o.organization_id and p.id=o.owner_id
    left join lateral (select v.* from operational_debt_valuations v where v.organization_id=o.organization_id
      and v.operational_debt_item_id=o.id and v.status='approved' order by v.version desc limit 1) a on true
    left join lateral (select v.* from operational_debt_valuations v where v.organization_id=o.organization_id
      and v.operational_debt_item_id=o.id and v.status='pending_approval' order by v.version desc limit 1) q on true
    where o.organization_id=v_org and o.development_case_id=p_case_id
  ), totals as (
    select currency,sum(lifecycle_exposure) exposure,count(*)::int valued_items
    from debts where lifecycle_exposure is not null group by currency
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'gapClass',d.gap_class,
      'sourceTable',d.source_table,'sourceId',d.source_id,'ownerId',d.owner_id,'ownerName',d.owner_name,
      'dueOn',d.due_on,'recordedBy',d.recorded_by,'acknowledgedBy',d.acknowledged_by,
      'acknowledgedAt',d.acknowledged_at,'acknowledgementBasis',d.acknowledgement_basis,
      'approvedValuation',case when d.approved_version is null then null else jsonb_build_object(
        'version',d.approved_version,'lifecycleExposure',d.lifecycle_exposure,'currency',d.currency,
        'basis',d.valuation_basis,'sourceReference',d.source_reference,'approvedAt',d.valuation_approved_at) end,
      'pendingValuation',case when d.pending_version is null then null else jsonb_build_object(
        'version',d.pending_version,'lifecycleExposure',d.pending_exposure,'currency',d.pending_currency) end)
      order by d.recorded_at desc) from debts d),'[]'::jsonb),
    'gapClasses',9,'itemCount',(select count(*) from debts),
    'unvaluedCount',(select count(*) from debts where approved_version is null),
    'valuationStatus',case when not exists(select 1 from debts) then 'not_applicable_no_items'
      when exists(select 1 from debts where approved_version is null) then 'incomplete_unvalued_items_present'
      when (select count(*) from totals)>1 then 'complete_multiple_currencies_not_summed'
      else 'complete_approved_values' end,
    'totalsByCurrency',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,
      'lifecycleExposure',round(exposure,2),'valuedItems',valued_items) order by currency) from totals),'[]'::jsonb),
    'note','Only independently approved stated-basis valuations are totalled. Unknown items remain unvalued, never zero; different currencies are never silently combined.') into v_result;
  return v_result;
end $$;

revoke all on function public.record_operational_debt_valuation(uuid,numeric,numeric,numeric,numeric,numeric,text,text,text) from public,anon;
revoke all on function public.approve_operational_debt_valuation(uuid,integer,text) from public,anon;
grant execute on function public.record_operational_debt_valuation(uuid,numeric,numeric,numeric,numeric,numeric,text,text,text),
  public.approve_operational_debt_valuation(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
