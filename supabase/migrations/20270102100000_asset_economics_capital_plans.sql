-- C2.10 — governed maintenance economics, replacement value and lifecycle
-- capital-plan visibility.
--
-- Canonical reuse only:
--   * asset_economics remains the ONE current economic-input record;
--   * assets remains the ONE asset/class identity source;
--   * evidence_items remains the ONE provenance and verification model;
--   * audit_events retains every accepted before/after snapshot;
--   * capital_plan_items remains the ONE lifecycle capital-plan candidate store.
--
-- Values are human-supplied snapshots, never estimates. The existing columns
-- are explicitly USD, so this workflow records USD only rather than attaching
-- a misleading currency label to fields whose names and calculation contracts
-- are already denominated in USD. Recording inputs grants no expenditure,
-- project sanction, work-release, risk-acceptance or return-to-service power.

alter table public.asset_economics
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists effective_from date not null default current_date,
  add column if not exists review_due date,
  add column if not exists version integer not null default 1;

alter table public.asset_economics
  drop constraint if exists asset_economics_version_positive,
  drop constraint if exists asset_economics_review_window;
alter table public.asset_economics
  add constraint asset_economics_version_positive check (version > 0),
  add constraint asset_economics_review_window check (
    review_due is null or review_due >= effective_from
  );

create index if not exists asset_economics_evidence_idx
  on public.asset_economics(organization_id,evidence_item_id)
  where evidence_item_id is not null;

create or replace function public.guard_asset_economics_governed_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  -- Preserve organization/asset cascade behavior while refusing every direct
  -- top-level rewrite, including service-role maintenance outside the RPC.
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if coalesce(current_setting('app.asset_economics_writer',true),'')<>'governed' then
    raise exception 'Asset economics can change only through the governed C2.10 writer';
  end if;
  if tg_op='UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.asset_id is distinct from old.asset_id
    or new.asset_class is distinct from old.asset_class
  ) then
    raise exception 'Asset economics scope and tenant identity are immutable; create the correct governed scope';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_guard_asset_economics_governed_write
  on public.asset_economics;
create trigger trg_guard_asset_economics_governed_write
  before insert or update or delete on public.asset_economics
  for each row execute function public.guard_asset_economics_governed_write();

revoke all on function public.guard_asset_economics_governed_write()
  from public,anon,authenticated,service_role;

create or replace function public.record_asset_economics_snapshot(p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_asset uuid;
  -- Keep the canonical spelling stored on assets. Existing lifecycle,
  -- recovery and asset-strategy consumers deliberately use that exact class
  -- identity, so accepting a case-folded alias here would create a snapshot
  -- that those engines could never consume.
  v_class text:=nullif(btrim(p_snapshot->>'assetClass'),'');
  v_evidence uuid;
  v_expected integer;
  v_existing public.asset_economics%rowtype;
  v_id uuid;
  v_version integer;
  v_replacement numeric;
  v_maintenance numeric;
  v_downtime numeric;
  v_repair numeric;
  v_repair_hours numeric;
  v_remaining_life numeric;
  v_basis text:=nullif(btrim(p_snapshot->>'basis'),'');
  v_source text:=nullif(btrim(p_snapshot->>'sourceSystem'),'');
  v_effective date;
  v_review date;
  v_key text;
  v_before jsonb;
  v_after jsonb;
begin
  if v_org is null or v_actor is null or v_role not in
    ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','Asset economics require a named same-tenant human engineering, maintenance, executive or administrator role; the AI operator is refused');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Asset economics require a verified factor and an AAL2 session');
  end if;

  begin
    v_asset:=nullif(p_snapshot->>'assetId','')::uuid;
    v_evidence:=nullif(p_snapshot->>'evidenceItemId','')::uuid;
    v_expected:=coalesce(nullif(p_snapshot->>'expectedVersion','')::integer,0);
    v_effective:=coalesce(nullif(p_snapshot->>'effectiveFrom','')::date,current_date);
    v_review:=nullif(p_snapshot->>'reviewDue','')::date;
  exception when others then
    return jsonb_build_object('error','asset, evidence, version and review dates must use valid identifiers and ISO dates');
  end;

  if (v_asset is null)=(v_class is null) then
    return jsonb_build_object('error','Choose exactly one canonical asset or asset-class scope');
  end if;
  if v_expected<0 then
    return jsonb_build_object('error','Expected version cannot be negative');
  end if;
  if length(coalesce(v_basis,'')) not between 20 and 4000
     or length(coalesce(v_source,'')) not between 2 and 200 then
    return jsonb_build_object('error','A 20-4000 character basis and bounded source-system reference are required');
  end if;
  if v_effective>current_date or (v_review is not null and v_review<v_effective) then
    return jsonb_build_object('error','Effective date cannot be future-dated and review due cannot precede it');
  end if;

  foreach v_key in array array[
    'replacementValueUsd','annualMaintenanceCostUsd','downtimeCostPerHourUsd',
    'expectedRepairCostUsd','expectedRepairHours','expectedRemainingLifeYears'
  ] loop
    if p_snapshot ? v_key
       and coalesce(jsonb_typeof(p_snapshot->v_key),'null') not in ('number','null') then
      return jsonb_build_object('error',v_key||' must be a JSON number or explicit null');
    end if;
  end loop;
  begin
    v_replacement:=(p_snapshot->>'replacementValueUsd')::numeric;
    v_maintenance:=(p_snapshot->>'annualMaintenanceCostUsd')::numeric;
    v_downtime:=(p_snapshot->>'downtimeCostPerHourUsd')::numeric;
    v_repair:=(p_snapshot->>'expectedRepairCostUsd')::numeric;
    v_repair_hours:=(p_snapshot->>'expectedRepairHours')::numeric;
    v_remaining_life:=(p_snapshot->>'expectedRemainingLifeYears')::numeric;
  exception when others then
    return jsonb_build_object('error','Economic inputs must be finite numeric values or explicit unknowns');
  end;
  if v_replacement is null and v_maintenance is null and v_downtime is null
     and v_repair is null and v_repair_hours is null and v_remaining_life is null then
    return jsonb_build_object('error','Record at least one known economic input; unknowns remain null and are never treated as zero');
  end if;
  if (v_replacement is not null and v_replacement<=0)
     or (v_maintenance is not null and v_maintenance<0)
     or (v_downtime is not null and v_downtime<0)
     or (v_repair is not null and v_repair<0)
     or (v_repair_hours is not null and v_repair_hours<=0)
     or (v_remaining_life is not null and v_remaining_life<=0) then
    return jsonb_build_object('error','Replacement value, repair hours and remaining life must be positive; cost inputs cannot be negative');
  end if;

  if v_asset is not null and not exists(
    select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org
  ) then return jsonb_build_object('error','Asset scope is outside the active tenant'); end if;
  if v_class is not null and not exists(
    select 1 from public.assets a where a.organization_id=v_org
      and a.asset_class=v_class
  ) then return jsonb_build_object('error','Exact canonical asset class is not present in the active tenant'); end if;
  if v_evidence is null or not exists(
    select 1 from public.evidence_items e
    where e.id=v_evidence and e.organization_id=v_org
      and e.verification_status='verified' and e.verified_by is not null
      and e.verified_at is not null and e.verified_by<>v_actor
      and (e.asset_id is null
        or (v_asset is not null and e.asset_id=v_asset)
        or (v_class is not null and exists(
          select 1 from public.assets ea where ea.id=e.asset_id
            and ea.organization_id=v_org
            and ea.asset_class=v_class
        )))
  ) then
    return jsonb_build_object('error','Economic inputs require same-tenant verified canonical evidence independently verified by another named human and applicable to the scope');
  end if;

  if v_asset is not null then
    select * into v_existing from public.asset_economics
    where organization_id=v_org and asset_id=v_asset for update;
  else
    select * into v_existing from public.asset_economics
    where organization_id=v_org and asset_id is null
      and asset_class=v_class for update;
  end if;

  if found then
    if v_existing.version<>v_expected then
      return jsonb_build_object('error','Asset economics changed after it was loaded; refresh before replacing the snapshot');
    end if;
    v_before:=jsonb_build_object(
      'id',v_existing.id,'version',v_existing.version,
      'assetId',v_existing.asset_id,'assetClass',v_existing.asset_class,
      'replacementValueUsd',v_existing.replacement_value_usd,
      'annualMaintenanceCostUsd',v_existing.annual_maintenance_cost_usd,
      'downtimeCostPerHourUsd',v_existing.downtime_cost_per_hour_usd,
      'expectedRepairCostUsd',v_existing.expected_repair_cost_usd,
      'expectedRepairHours',v_existing.expected_repair_hours,
      'expectedRemainingLifeYears',v_existing.expected_remaining_life_years,
      'basis',v_existing.basis,'sourceSystem',v_existing.source_system,
      'evidenceItemId',v_existing.evidence_item_id,
      'effectiveFrom',v_existing.effective_from,'reviewDue',v_existing.review_due
    );
    v_id:=v_existing.id; v_version:=v_existing.version+1;
    perform set_config('app.asset_economics_writer','governed',true);
    update public.asset_economics set
      replacement_value_usd=v_replacement,
      annual_maintenance_cost_usd=v_maintenance,
      downtime_cost_per_hour_usd=v_downtime,
      expected_repair_cost_usd=v_repair,
      expected_repair_hours=v_repair_hours,
      expected_remaining_life_years=v_remaining_life,
      basis=v_basis,source_system=v_source,evidence_item_id=v_evidence,
      effective_from=v_effective,review_due=v_review,
      version=v_version,updated_by=v_actor,updated_at=now()
    where id=v_id and organization_id=v_org;
  else
    if v_expected<>0 then
      return jsonb_build_object('error','No current economics snapshot exists for that expected version');
    end if;
    v_version:=1;
    perform set_config('app.asset_economics_writer','governed',true);
    insert into public.asset_economics(
      organization_id,asset_id,asset_class,replacement_value_usd,
      annual_maintenance_cost_usd,downtime_cost_per_hour_usd,
      expected_repair_cost_usd,expected_repair_hours,
      expected_remaining_life_years,basis,source_system,evidence_item_id,
      effective_from,review_due,version,updated_by,updated_at
    ) values(
      v_org,v_asset,v_class,v_replacement,v_maintenance,v_downtime,v_repair,
      v_repair_hours,v_remaining_life,v_basis,v_source,v_evidence,
      v_effective,v_review,v_version,v_actor,now()
    ) returning id into v_id;
    v_before:=null;
  end if;

  v_after:=jsonb_build_object(
    'id',v_id,'version',v_version,'assetId',v_asset,'assetClass',v_class,
    'replacementValueUsd',v_replacement,
    'annualMaintenanceCostUsd',v_maintenance,
    'downtimeCostPerHourUsd',v_downtime,
    'expectedRepairCostUsd',v_repair,
    'expectedRepairHours',v_repair_hours,
    'expectedRemainingLifeYears',v_remaining_life,
    'basis',v_basis,'sourceSystem',v_source,'evidenceItemId',v_evidence,
    'effectiveFrom',v_effective,'reviewDue',v_review
  );
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'asset_economics_snapshot',v_role,
    jsonb_build_object('action',case when v_version=1 then 'created' else 'revised' end,
      'assetEconomicsId',v_id,'actorId',v_actor,'evidenceItemId',v_evidence,
      'currency','USD','expenditureAuthorized',false,'projectSanctioned',false,
      'workAuthorized',false,'riskAccepted',false,'returnToServiceAuthorized',false),
    v_before,v_after
  );

  return jsonb_build_object(
    'assetEconomicsId',v_id,'version',v_version,
    'scope',case when v_asset is null then 'asset_class' else 'asset' end,
    'currency','USD','status','recorded',
    'expenditureAuthorized',false,'projectSanctioned',false,
    'workAuthorized',false,'riskAccepted',false,
    'returnToServiceAuthorized',false
  );
exception when unique_violation then
  return jsonb_build_object('error','A current economics snapshot already exists for this tenant scope; refresh and revise it by version');
end $$;

revoke all on function public.record_asset_economics_snapshot(jsonb)
  from public,anon,service_role;
grant execute on function public.record_asset_economics_snapshot(jsonb)
  to authenticated;

create or replace function public.get_asset_economics_workspace()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with context as (select public.app_current_org() org),
  tenant_assets as (
    select a.id,a.name,a.asset_class,a.criticality
    from public.assets a,context c
    where c.org is not null and a.organization_id=c.org
  ), economics as (
    select e.* from public.asset_economics e,context c
    where c.org is not null and e.organization_id=c.org
  ), plans as (
    -- A capital-plan cost is meaningful only in its recorded currency. Legacy
    -- rows can predate the governed portfolio currency field, so they remain
    -- visible but their amounts are never summed or labelled as USD. Mixing
    -- currencies would turn a factual plan view into invented arithmetic.
    select i.plan_year,i.currency,count(*)::int item_count,
      count(*) filter(where i.mandatory)::int mandatory_count,
      count(*) filter(where i.development_case_id is not null
        and i.evidence_item_id is not null)::int governed_candidate_count,
      case when i.currency is null then null else sum(i.cost) end total_cost
    from public.capital_plan_items i,context c
    where c.org is not null and i.organization_id=c.org
    group by i.plan_year,i.currency
  )
  select jsonb_build_object(
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'assetClass',a.asset_class,
      'criticality',a.criticality) order by a.name) from tenant_assets a),'[]'::jsonb),
    'economics',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'scope',case when e.asset_id is null then 'asset_class' else 'asset' end,
      'assetId',e.asset_id,'assetName',a.name,'assetClass',e.asset_class,
      'replacementValueUsd',e.replacement_value_usd,
      'annualMaintenanceCostUsd',e.annual_maintenance_cost_usd,
      'downtimeCostPerHourUsd',e.downtime_cost_per_hour_usd,
      'expectedRepairCostUsd',e.expected_repair_cost_usd,
      'expectedRepairHours',e.expected_repair_hours,
      'expectedRemainingLifeYears',e.expected_remaining_life_years,
      'currency','USD','basis',e.basis,'sourceSystem',e.source_system,
      'evidenceItemId',e.evidence_item_id,'evidenceDescription',ev.description,
      'evidenceVerifiedBy',ev.verified_by,'evidenceVerifiedAt',ev.verified_at,
      'effectiveFrom',e.effective_from,'reviewDue',e.review_due,
      'version',e.version,'updatedBy',e.updated_by,'updatedAt',e.updated_at
    ) order by coalesce(a.name,e.asset_class),e.updated_at desc)
      from economics e left join tenant_assets a on a.id=e.asset_id
      left join public.evidence_items ev on ev.id=e.evidence_item_id
        and ev.organization_id=(select org from context)),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'sourceSystem',e.source_system,
      'assetId',e.asset_id,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at
    ) order by e.verified_at desc)
      from public.evidence_items e,context c
      where e.organization_id=c.org and e.verification_status='verified'
        and e.verified_by is not null and e.verified_at is not null
        and e.verified_by<>auth.uid()),'[]'::jsonb),
    'coverage',jsonb_build_object(
      'assets',(select count(*) from tenant_assets),
      'assetsWithEconomics',(select count(*) from tenant_assets a where exists(
        select 1 from economics e where e.asset_id=a.id
          or (e.asset_id is null and e.asset_class=a.asset_class)
      )),
      'assetsWithCompleteEconomics',(select count(*) from tenant_assets a where exists(
        select 1 from economics e where (e.asset_id=a.id
          or (e.asset_id is null and e.asset_class=a.asset_class))
          and e.replacement_value_usd is not null
          and e.annual_maintenance_cost_usd is not null
          and e.downtime_cost_per_hour_usd is not null
          and e.expected_repair_cost_usd is not null
          and e.expected_repair_hours is not null
          and e.expected_remaining_life_years is not null
      )),
      'snapshots',(select count(*) from economics),
      'overdueReviews',(select count(*) from economics e
        where e.review_due is not null and e.review_due<current_date)
    ),
    'capitalPlans',coalesce((select jsonb_agg(jsonb_build_object(
      'planYear',p.plan_year,'itemCount',p.item_count,
      'mandatoryCount',p.mandatory_count,
      'governedCandidateCount',p.governed_candidate_count,
      'currency',p.currency,'currencySpecified',p.currency is not null,
      'totalCost',p.total_cost) order by p.plan_year desc,p.currency nulls last)
      from plans p),'[]'::jsonb),
    'currency','USD',
    'basis','Economic inputs remain explicit tenant evidence. Missing values remain unknown and prevent dependent options from being priced.',
    'decisionBoundary','Recording economics or viewing a capital plan does not authorize expenditure, sanction a project, release work, accept risk, change an operating limit or return equipment to service.'
  )
$$;

revoke all on function public.get_asset_economics_workspace()
  from public,anon,service_role;
grant execute on function public.get_asset_economics_workspace()
  to authenticated;

revoke insert,update,delete,truncate on public.asset_economics
  from anon,authenticated;

comment on function public.record_asset_economics_snapshot(jsonb) is
  'C2.10: AAL2 named-human versioned economic input snapshot with independently verified canonical evidence and no approval authority.';
comment on function public.get_asset_economics_workspace() is
  'C2.10: tenant-scoped economics coverage and currency-safe canonical capital_plan_items visibility; unknown currencies withhold totals and no operational authority is granted.';

notify pgrst, 'reload schema';
