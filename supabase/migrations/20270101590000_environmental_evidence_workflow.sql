-- E10.01 / E10.07 / E10.08 — governed environmental evidence workflow.
--
-- Canonical reuse only:
--   * efficiency_baselines / efficiency_readings remain the ONE efficiency model;
--   * environmental_activities remains the ONE activity and consumable-loss model;
--   * emission_factors remains the ONE sourced factor register;
--   * hazardous_inventory remains the ONE hazardous-material register;
--   * containment_losses remains the ONE process-safety loss register;
--   * evidence_items and audit_events remain the provenance and audit models.
--
-- The workflow records evidence. It never certifies environmental compliance,
-- creates a reportable inventory, authorizes work, accepts risk, changes an
-- operating limit or returns equipment to service.

alter table public.emission_factors
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists basis text,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists source_reference text;

alter table public.environmental_activities
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists basis text,
  add column if not exists source_reference text,
  add column if not exists substance text,
  add column if not exists recorded_by uuid references auth.users(id);

alter table public.efficiency_baselines
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists source_reference text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.efficiency_readings
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists basis text,
  add column if not exists source_reference text,
  add column if not exists recorded_by uuid references auth.users(id);

alter table public.hazardous_inventory
  add column if not exists inventory_ref text,
  add column if not exists version integer not null default 1,
  add column if not exists supersedes_id bigint
    references public.hazardous_inventory(id) on delete restrict,
  add column if not exists handling_requirements text,
  add column if not exists emergency_response_reference text,
  add column if not exists regulatory_reference text,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists basis text,
  add column if not exists source_reference text,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now();

alter table public.efficiency_baselines
  drop constraint if exists efficiency_baselines_version_positive;
alter table public.efficiency_baselines
  add constraint efficiency_baselines_version_positive check (version>0);
alter table public.hazardous_inventory
  drop constraint if exists hazardous_inventory_version_positive;
alter table public.hazardous_inventory
  add constraint hazardous_inventory_version_positive check (version>0);

create unique index if not exists hazardous_inventory_ref_version_idx
  on public.hazardous_inventory(organization_id,inventory_ref,version)
  where inventory_ref is not null;
create index if not exists environmental_activity_evidence_idx
  on public.environmental_activities(organization_id,evidence_item_id,period_end desc);
create index if not exists efficiency_baseline_evidence_idx
  on public.efficiency_baselines(organization_id,evidence_item_id);
create index if not exists hazardous_inventory_evidence_idx
  on public.hazardous_inventory(organization_id,evidence_item_id,recorded_at desc);

create or replace function public.guard_environmental_evidence_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old jsonb:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb:=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_org uuid;
  v_asset uuid;
  v_site uuid;
begin
  if tg_op='TRUNCATE' then
    raise exception 'Environmental evidence is retained and cannot be truncated';
  end if;
  -- Preserve only the exact FK cascade/set-null transitions owned by a
  -- canonical parent. Trigger nesting alone is not authority: an unrelated
  -- nested trigger must not become a generic bypass around this write wall.
  if pg_trigger_depth()>1 and tg_op='DELETE' then
    v_org:=nullif(v_old->>'organization_id','')::uuid;
    if not exists(select 1 from public.organizations where id=v_org) then
      return old;
    end if;
    if tg_table_name='efficiency_baselines'
       and not exists(select 1 from public.assets where id=(v_old->>'asset_id')::uuid) then
      return old;
    end if;
    if tg_table_name='efficiency_readings'
       and not exists(select 1 from public.efficiency_baselines where id=(v_old->>'baseline_id')::bigint) then
      return old;
    end if;
  end if;
  if pg_trigger_depth()>1 and tg_op='UPDATE' then
    if tg_table_name='environmental_activities'
       and (v_new-array['asset_id','site_id'])=(v_old-array['asset_id','site_id']) then
      v_asset:=nullif(v_old->>'asset_id','')::uuid;
      v_site:=nullif(v_old->>'site_id','')::uuid;
      if (v_new->>'asset_id') is null and v_asset is not null
         and not exists(select 1 from public.assets where id=v_asset)
         and v_new->>'site_id' is not distinct from v_old->>'site_id' then
        return new;
      end if;
      if (v_new->>'site_id') is null and v_site is not null
         and not exists(select 1 from public.sites where id=v_site)
         and v_new->>'asset_id' is not distinct from v_old->>'asset_id' then
        return new;
      end if;
    end if;
    if tg_table_name='hazardous_inventory'
       and (v_new-'asset_id')=(v_old-'asset_id')
       and (v_new->>'asset_id') is null then
      v_asset:=nullif(v_old->>'asset_id','')::uuid;
      if v_asset is not null and not exists(select 1 from public.assets where id=v_asset) then
        return new;
      end if;
    end if;
  end if;
  if coalesce(current_setting('app.environmental_evidence_writer',true),'')<>'governed' then
    raise exception 'Environmental evidence can change only through the governed E10 writer';
  end if;
  if tg_op='UPDATE' then
    if tg_table_name<>'efficiency_baselines' then
      raise exception 'Environmental evidence is append-only; record a superseding version';
    end if;
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.asset_id is distinct from old.asset_id
       or new.metric is distinct from old.metric then
      raise exception 'Efficiency baseline tenant, asset and metric identity are immutable';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists trg_guard_emission_factor_write on public.emission_factors;
create trigger trg_guard_emission_factor_write
  before insert or update or delete on public.emission_factors
  for each row execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_emission_factor_truncate on public.emission_factors;
create trigger trg_guard_emission_factor_truncate
  before truncate on public.emission_factors
  for each statement execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_environmental_activity_write on public.environmental_activities;
create trigger trg_guard_environmental_activity_write
  before insert or update or delete on public.environmental_activities
  for each row execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_environmental_activity_truncate on public.environmental_activities;
create trigger trg_guard_environmental_activity_truncate
  before truncate on public.environmental_activities
  for each statement execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_efficiency_baseline_write on public.efficiency_baselines;
create trigger trg_guard_efficiency_baseline_write
  before insert or update or delete on public.efficiency_baselines
  for each row execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_efficiency_baseline_truncate on public.efficiency_baselines;
create trigger trg_guard_efficiency_baseline_truncate
  before truncate on public.efficiency_baselines
  for each statement execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_efficiency_reading_write on public.efficiency_readings;
create trigger trg_guard_efficiency_reading_write
  before insert or update or delete on public.efficiency_readings
  for each row execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_efficiency_reading_truncate on public.efficiency_readings;
create trigger trg_guard_efficiency_reading_truncate
  before truncate on public.efficiency_readings
  for each statement execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_hazardous_inventory_write on public.hazardous_inventory;
create trigger trg_guard_hazardous_inventory_write
  before insert or update or delete on public.hazardous_inventory
  for each row execute function public.guard_environmental_evidence_write();
drop trigger if exists trg_guard_hazardous_inventory_truncate on public.hazardous_inventory;
create trigger trg_guard_hazardous_inventory_truncate
  before truncate on public.hazardous_inventory
  for each statement execute function public.guard_environmental_evidence_write();

revoke all on function public.guard_environmental_evidence_write()
  from public,anon,authenticated,service_role;

create or replace function public.record_environmental_evidence(
  p_kind text,p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_role text:=public.app_current_role();
  v_evidence uuid;
  v_asset uuid;
  v_site uuid;
  v_id bigint;
  v_baseline bigint;
  v_expected integer;
  v_version integer;
  v_date1 date;
  v_date2 date;
  v_number numeric;
  v_number2 numeric;
  v_number3 numeric;
  v_bool boolean;
  v_factor_key text;
  v_scope text;
  v_activity_kind text;
  v_category text;
  v_ref text;
  v_basis text:=nullif(btrim(p_record->>'basis'),'');
  v_source text:=nullif(btrim(p_record->>'sourceReference'),'');
  v_before jsonb;
  v_after jsonb;
  v_existing_baseline public.efficiency_baselines%rowtype;
  v_existing_hazard public.hazardous_inventory%rowtype;
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error','authentication and an active tenant are required');
  end if;
  if v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','Environmental evidence requires a named same-tenant human engineering, maintenance, executive or administrator role; ai_admin and read-only roles are refused');
  end if;
  if not public.app_actor_has_verified_mfa(v_actor)
     or public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','Environmental evidence requires a verified factor and an AAL2 session');
  end if;
  if p_kind not in ('emission_factor','efficiency_baseline','efficiency_reading','environmental_activity','hazardous_inventory') then
    return jsonb_build_object('error','unsupported environmental evidence kind');
  end if;
  begin
    v_evidence:=nullif(p_record->>'evidenceItemId','')::uuid;
  exception when others then
    return jsonb_build_object('error','evidence item must be a valid identifier');
  end;
  if length(coalesce(v_basis,'')) not between 20 and 4000
     or length(coalesce(v_source,'')) not between 2 and 500 then
    return jsonb_build_object('error','A 20-4000 character basis and a bounded source reference are required');
  end if;
  if v_evidence is null or not exists(
    select 1 from public.evidence_items e
    join public.user_profiles verifier on verifier.id=e.verified_by
      and verifier.organization_id=e.organization_id
      and verifier.role<>'ai_admin'
    where e.id=v_evidence and e.organization_id=v_org
      and e.verification_status='verified'
      and e.verified_by is not null and e.verified_at is not null
      and e.verified_by<>v_actor
  ) then
    return jsonb_build_object('error','same-tenant independently verified environmental evidence is required');
  end if;

  if p_kind='emission_factor' then
    begin
      v_number:=(p_record->>'factor')::numeric;
      v_number2:=nullif(p_record->>'gwp','')::numeric;
      v_date1:=(p_record->>'validFrom')::date;
    exception when others then
      return jsonb_build_object('error','factor, optional GWP and valid-from date must be valid values');
    end;
    v_factor_key:=nullif(btrim(p_record->>'factorKey'),'');
    if v_factor_key is null or v_factor_key!~'^[a-z][a-z0-9_]{2,79}$'
       or length(btrim(coalesce(p_record->>'label','')))<3
       or length(btrim(coalesce(p_record->>'activityUnit','')))<1
       or length(btrim(coalesce(p_record->>'factorUnit','')))<1
       or v_number<=0 or (v_number2 is not null and v_number2<=0) then
      return jsonb_build_object('error','Factor key, label, units and positive factor/GWP are required');
    end if;
    if exists(select 1 from public.evidence_items e where e.id=v_evidence and e.asset_id is not null) then
      return jsonb_build_object('error','Emission-factor evidence must be organization-level rather than asset-specific');
    end if;
    perform set_config('app.environmental_evidence_writer','governed',true);
    insert into public.emission_factors(
      organization_id,factor_key,label,activity_unit,factor,factor_unit,source,
      valid_from,gwp,evidence_item_id,basis,recorded_by,source_reference
    ) values(
      v_org,v_factor_key,btrim(p_record->>'label'),btrim(p_record->>'activityUnit'),
      v_number,btrim(p_record->>'factorUnit'),v_source,v_date1,v_number2,
      v_evidence,v_basis,v_actor,v_source
    ) returning id into v_id;
    v_after:=jsonb_build_object('id',v_id,'factorKey',v_factor_key,'factor',v_number,
      'factorUnit',btrim(p_record->>'factorUnit'),'validFrom',v_date1,'gwp',v_number2,
      'evidenceItemId',v_evidence,'basis',v_basis,'sourceReference',v_source);

  elsif p_kind='efficiency_baseline' then
    begin
      v_asset:=(p_record->>'assetId')::uuid;
      v_number:=(p_record->>'designValue')::numeric;
      v_number2:=nullif(p_record->>'interventionCost','')::numeric;
      v_number3:=nullif(p_record->>'energyCostPerDay','')::numeric;
      v_date1:=(p_record->>'establishedOn')::date;
      v_expected:=coalesce(nullif(p_record->>'expectedVersion','')::integer,0);
    exception when others then
      return jsonb_build_object('error','asset, values, established date and expected version must be valid');
    end;
    if v_expected<0 or v_number<=0 or coalesce(v_number2,0)<0 or coalesce(v_number3,0)<0
       or v_date1>current_date
       or length(btrim(coalesce(p_record->>'metric','')))<2
       or length(btrim(coalesce(p_record->>'unit','')))<1 then
      return jsonb_build_object('error','Valid metric, unit, positive design value, non-negative costs, non-future date and version are required');
    end if;
    if not exists(select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org) then
      return jsonb_build_object('error','asset is outside the active tenant');
    end if;
    if exists(select 1 from public.evidence_items e where e.id=v_evidence and e.asset_id is not null and e.asset_id<>v_asset) then
      return jsonb_build_object('error','evidence is not applicable to the selected asset');
    end if;
    select * into v_existing_baseline from public.efficiency_baselines
      where organization_id=v_org and asset_id=v_asset
        and lower(btrim(metric))=lower(btrim(p_record->>'metric')) for update;
    if found then
      if v_existing_baseline.version<>v_expected then
        return jsonb_build_object('error','Efficiency baseline changed after it was loaded; refresh before revising');
      end if;
      v_before:=to_jsonb(v_existing_baseline);
      v_id:=v_existing_baseline.id;
      v_version:=v_existing_baseline.version+1;
      perform set_config('app.environmental_evidence_writer','governed',true);
      update public.efficiency_baselines set
        unit=btrim(p_record->>'unit'),design_value=v_number,basis=v_basis,
        established_on=v_date1,intervention_cost=v_number2,
        energy_cost_per_day=v_number3,evidence_item_id=v_evidence,
        source_reference=v_source,version=v_version,updated_by=v_actor,updated_at=now()
      where id=v_id and organization_id=v_org;
    else
      if v_expected<>0 then
        return jsonb_build_object('error','No efficiency baseline exists for that expected version');
      end if;
      v_version:=1;
      perform set_config('app.environmental_evidence_writer','governed',true);
      insert into public.efficiency_baselines(
        organization_id,asset_id,metric,unit,design_value,basis,established_on,
        intervention_cost,energy_cost_per_day,evidence_item_id,source_reference,
        version,updated_by,updated_at
      ) values(
        v_org,v_asset,btrim(p_record->>'metric'),btrim(p_record->>'unit'),v_number,
        v_basis,v_date1,v_number2,v_number3,v_evidence,v_source,1,v_actor,now()
      ) returning id into v_id;
    end if;
    v_after:=jsonb_build_object('id',v_id,'assetId',v_asset,
      'metric',btrim(p_record->>'metric'),'unit',btrim(p_record->>'unit'),
      'designValue',v_number,'establishedOn',v_date1,'interventionCost',v_number2,
      'energyCostPerDay',v_number3,'evidenceItemId',v_evidence,'basis',v_basis,
      'sourceReference',v_source,'version',v_version);

  elsif p_kind='efficiency_reading' then
    begin
      v_baseline:=(p_record->>'baselineId')::bigint;
      v_date1:=(p_record->>'measuredOn')::date;
      v_number:=(p_record->>'value')::numeric;
    exception when others then
      return jsonb_build_object('error','baseline, measurement date and value must be valid');
    end;
    select b.asset_id into v_asset from public.efficiency_baselines b
      where b.id=v_baseline and b.organization_id=v_org and v_date1>=b.established_on;
    if v_asset is null or v_date1>current_date or v_number<=0 then
      return jsonb_build_object('error','Reading requires a same-tenant baseline, a date on/after the baseline and a positive value');
    end if;
    if exists(select 1 from public.evidence_items e where e.id=v_evidence and e.asset_id is not null and e.asset_id<>v_asset) then
      return jsonb_build_object('error','evidence is not applicable to the baseline asset');
    end if;
    if exists(select 1 from public.efficiency_readings r where r.organization_id=v_org
      and r.baseline_id=v_baseline and r.measured_on=v_date1
      and r.source_reference=v_source) then
      return jsonb_build_object('error','this source reading is already recorded for the baseline and date');
    end if;
    perform set_config('app.environmental_evidence_writer','governed',true);
    insert into public.efficiency_readings(
      organization_id,baseline_id,measured_on,value,evidence_item_id,basis,
      source_reference,recorded_by
    ) values(v_org,v_baseline,v_date1,v_number,v_evidence,v_basis,v_source,v_actor)
    returning id into v_id;
    v_after:=jsonb_build_object('id',v_id,'baselineId',v_baseline,
      'measuredOn',v_date1,'value',v_number,'evidenceItemId',v_evidence,
      'basis',v_basis,'sourceReference',v_source);

  elsif p_kind='environmental_activity' then
    begin
      v_site:=nullif(p_record->>'siteId','')::uuid;
      v_asset:=nullif(p_record->>'assetId','')::uuid;
      v_date1:=(p_record->>'periodStart')::date;
      v_date2:=(p_record->>'periodEnd')::date;
      v_number:=(p_record->>'quantity')::numeric;
      v_bool:=nullif(p_record->>'maintenanceAttributable','')::boolean;
    exception when others then
      return jsonb_build_object('error','site, asset, period, quantity and attribution must use valid values');
    end;
    v_activity_kind:=nullif(btrim(p_record->>'activityKind'),'');
    v_factor_key:=nullif(btrim(p_record->>'factorKey'),'');
    v_scope:=nullif(btrim(p_record->>'scope'),'');
    if v_activity_kind not in (
      'fuel_burn','electricity','flaring','venting','fugitive_methane',
      'water_withdrawal','water_discharge','waste_generated','hazardous_waste',
      'lubricant_loss','chemical_loss'
    ) or v_number<0 or v_date2<v_date1 or v_date2>current_date
      or length(btrim(coalesce(p_record->>'unit','')))<1 then
      return jsonb_build_object('error','Valid activity kind, non-negative quantity, unit and completed period are required');
    end if;
    if v_activity_kind in ('lubricant_loss','chemical_loss')
       and length(btrim(coalesce(p_record->>'substance','')))<2 then
      return jsonb_build_object('error','Lubricant and chemical losses require the substance or product name');
    end if;
    if v_scope is not null and v_scope not in ('scope_1','scope_2','scope_3') then
      return jsonb_build_object('error','scope must be scope_1, scope_2 or scope_3');
    end if;
    if v_factor_key is not null and v_scope is null then
      return jsonb_build_object('error','An activity with an emission factor requires an explicit scope');
    end if;
    if v_factor_key is not null and not exists(
      select 1 from public.emission_factors f where f.organization_id=v_org
        and f.factor_key=v_factor_key and f.valid_from<=v_date2
        and lower(btrim(f.activity_unit))=lower(btrim(p_record->>'unit'))
    ) then return jsonb_build_object('error','No applicable same-tenant emission factor with the same activity unit exists for this activity period'); end if;
    if v_site is not null and not exists(select 1 from public.sites s where s.id=v_site and s.organization_id=v_org) then
      return jsonb_build_object('error','site is outside the active tenant');
    end if;
    if v_asset is not null and not exists(select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org) then
      return jsonb_build_object('error','asset is outside the active tenant');
    end if;
    if exists(select 1 from public.evidence_items e where e.id=v_evidence and e.asset_id is not null
      and (v_asset is null or e.asset_id<>v_asset)) then
      return jsonb_build_object('error','asset-specific evidence is not applicable to this activity');
    end if;
    perform set_config('app.environmental_evidence_writer','governed',true);
    insert into public.environmental_activities(
      organization_id,site_id,asset_id,activity_kind,period_start,period_end,
      quantity,unit,factor_key,scope,maintenance_attributable,note,
      evidence_item_id,basis,source_reference,substance,recorded_by
    ) values(
      v_org,v_site,v_asset,v_activity_kind,v_date1,v_date2,v_number,
      btrim(p_record->>'unit'),v_factor_key,v_scope,v_bool,
      nullif(btrim(p_record->>'note'),''),v_evidence,v_basis,v_source,
      nullif(btrim(p_record->>'substance'),''),v_actor
    ) returning id into v_id;
    v_after:=jsonb_build_object('id',v_id,'activityKind',v_activity_kind,
      'periodStart',v_date1,'periodEnd',v_date2,'quantity',v_number,
      'unit',btrim(p_record->>'unit'),'factorKey',v_factor_key,'scope',v_scope,
      'maintenanceAttributable',v_bool,'substance',nullif(btrim(p_record->>'substance'),''),
      'evidenceItemId',v_evidence,'basis',v_basis,'sourceReference',v_source);

  else
    begin
      v_asset:=nullif(p_record->>'assetId','')::uuid;
      v_expected:=coalesce(nullif(p_record->>'expectedVersion','')::integer,0);
      v_number:=nullif(p_record->>'quantity','')::numeric;
      v_bool:=coalesce(nullif(p_record->>'endOfLifePlanned','')::boolean,false);
    exception when others then
      return jsonb_build_object('error','asset, expected version, quantity and lifecycle flag must use valid values');
    end;
    v_ref:=nullif(btrim(p_record->>'inventoryRef'),'');
    v_category:=nullif(btrim(p_record->>'category'),'');
    if length(coalesce(v_ref,''))<2 or v_expected<0
       or length(btrim(coalesce(p_record->>'substance','')))<2
       or v_category not in ('battery','refrigerant','solvent','lubricant','reagent','radioactive_source','asbestos','other')
       or (v_number is not null and v_number<=0)
       or ((v_number is null)<>(nullif(btrim(p_record->>'unit'),'') is null))
       or length(btrim(coalesce(p_record->>'location','')))<2
       or length(btrim(coalesce(p_record->>'handlingRequirements','')))<20
       or length(btrim(coalesce(p_record->>'emergencyResponseReference','')))<2
       or length(btrim(coalesce(p_record->>'regulatoryReference','')))<2
       or length(btrim(coalesce(p_record->>'disposalRouteRequired','')))<10 then
      return jsonb_build_object('error','Inventory reference, substance, category, paired positive quantity/unit, controlled location, handling requirements, emergency and regulatory references, and disposal route are required');
    end if;
    if v_asset is not null and not exists(select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org) then
      return jsonb_build_object('error','asset is outside the active tenant');
    end if;
    if exists(select 1 from public.evidence_items e where e.id=v_evidence and e.asset_id is not null
      and (v_asset is null or e.asset_id<>v_asset)) then
      return jsonb_build_object('error','asset-specific evidence is not applicable to this inventory item');
    end if;
    select * into v_existing_hazard from public.hazardous_inventory
      where organization_id=v_org and inventory_ref=v_ref
      order by version desc limit 1 for update;
    if found and v_existing_hazard.version<>v_expected then
      return jsonb_build_object('error','Hazardous inventory changed after it was loaded; refresh before superseding');
    elsif not found and v_expected<>0 then
      return jsonb_build_object('error','No hazardous inventory item exists for that expected version');
    end if;
    v_version:=case when found then v_existing_hazard.version+1 else 1 end;
    v_before:=case when found then to_jsonb(v_existing_hazard) else null end;
    perform set_config('app.environmental_evidence_writer','governed',true);
    insert into public.hazardous_inventory(
      organization_id,asset_id,substance,category,quantity,unit,location,
      disposal_route_required,end_of_life_planned,inventory_ref,version,
      supersedes_id,handling_requirements,emergency_response_reference,
      regulatory_reference,evidence_item_id,basis,source_reference,recorded_by
    ) values(
      v_org,v_asset,btrim(p_record->>'substance'),v_category,v_number,
      nullif(btrim(p_record->>'unit'),''),nullif(btrim(p_record->>'location'),''),
      nullif(btrim(p_record->>'disposalRouteRequired'),''),v_bool,v_ref,v_version,
      case when found then v_existing_hazard.id else null end,
      btrim(p_record->>'handlingRequirements'),
      nullif(btrim(p_record->>'emergencyResponseReference'),''),
      nullif(btrim(p_record->>'regulatoryReference'),''),v_evidence,v_basis,
      v_source,v_actor
    ) returning id into v_id;
    v_after:=jsonb_build_object('id',v_id,'inventoryRef',v_ref,'version',v_version,
      'assetId',v_asset,'substance',btrim(p_record->>'substance'),'category',v_category,
      'quantity',v_number,'unit',nullif(btrim(p_record->>'unit'),''),
      'handlingRequirements',btrim(p_record->>'handlingRequirements'),
      'endOfLifePlanned',v_bool,'evidenceItemId',v_evidence,'basis',v_basis,
      'sourceReference',v_source);
  end if;

  perform set_config('app.environmental_evidence_writer','',true);
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'environmental_evidence',v_role,
    jsonb_build_object('action','recorded','kind',p_kind,'recordId',v_id,
      'actorId',v_actor,'evidenceItemId',v_evidence,
      'complianceCertified',false,'reportableInventory',false,
      'workAuthorized',false,'riskAccepted',false,
      'returnToServiceAuthorized',false),
    v_before,v_after
  );
  return jsonb_build_object('id',v_id,'kind',p_kind,'version',v_version,
    'status','recorded','complianceCertified',false,'reportableInventory',false,
    'workAuthorized',false,'riskAccepted',false,'returnToServiceAuthorized',false);
exception when unique_violation then
  perform set_config('app.environmental_evidence_writer','',true);
  return jsonb_build_object('error','An environmental record already exists for that governed identity and effective version');
end $$;

revoke all on function public.record_environmental_evidence(text,jsonb)
  from public,anon,service_role;
grant execute on function public.record_environmental_evidence(text,jsonb)
  to authenticated;

create or replace function public.get_environmental_loss_records()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with losses as (
    select a.period_end::timestamptz occurred_at,
      coalesce(a.substance,replace(a.activity_kind,'_',' ')) substance,
      a.quantity,a.unit,a.source_reference detected_by,
      a.maintenance_attributable
    from public.environmental_activities a
    where a.organization_id=public.app_current_org()
      and a.activity_kind in ('lubricant_loss','chemical_loss')
    union all
    select c.occurred_at,coalesce(c.substance,'unspecified containment loss'),
      c.quantity,c.quantity_unit,c.investigation_reference,null::boolean
    from public.containment_losses c
    where c.organization_id=public.app_current_org()
      and c.quantity is not null and c.quantity_unit is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'substance',x.substance,'quantity',x.quantity,'unit',x.unit,
    'detectedBy',x.detected_by,'attributedToMaintenance',x.maintenance_attributable
  ) order by x.occurred_at desc),'[]'::jsonb)
  from (select * from losses order by occurred_at desc limit 500) x
$$;

revoke all on function public.get_environmental_loss_records()
  from public,anon,service_role;
grant execute on function public.get_environmental_loss_records()
  to authenticated;

-- Replace the original activity projection so a later factor version cannot
-- be applied retroactively and a factor whose activity unit differs from the
-- recorded activity is returned as absent instead of producing false CO2e.
create or replace function public.get_environmental_activities(p_limit int default 50)
returns jsonb
language sql
stable
security invoker
set search_path=public,pg_temp
as $$
  select coalesce(jsonb_agg(x.row),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'activityLabel',a.activity_kind||coalesce(' — '||ast.name,''),
      'activityQuantity',a.quantity,'activityUnit',a.unit,
      'factor',f.factor,'factorUnit',f.factor_unit,'factorSource',f.source,
      'gwp',f.gwp,'scope',a.scope,
      'maintenanceAttributable',a.maintenance_attributable) row
    from public.environmental_activities a
    left join public.assets ast
      on ast.id=a.asset_id and ast.organization_id=a.organization_id
    left join lateral (
      select ef.* from public.emission_factors ef
      where ef.organization_id=a.organization_id
        and ef.factor_key=a.factor_key
        and ef.valid_from<=a.period_end
        and lower(btrim(ef.activity_unit))=lower(btrim(a.unit))
      order by ef.valid_from desc,ef.id desc limit 1
    ) f on true
    where a.organization_id=public.app_current_org()
    order by a.period_end desc,a.id desc
    limit greatest(1,least(p_limit,500))
  ) x
$$;

grant execute on function public.get_environmental_activities(int)
  to authenticated;

create or replace function public.get_environmental_evidence_workspace()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with context as (select public.app_current_org() org,auth.uid() actor),
  hazard_ranked as (
    select h.*,row_number() over(partition by coalesce(h.inventory_ref,'legacy-'||h.id::text)
      order by h.version desc,h.recorded_at desc,h.id desc) rn
    from public.hazardous_inventory h,context c where h.organization_id=c.org
  )
  select jsonb_build_object(
    'canRecord',coalesce(public.app_current_role() in
      ('admin','executive','maintenance_manager','reliability_engineer')
      and public.app_current_aal()='aal2'
      and public.app_actor_has_verified_mfa((select actor from context)),false),
    'requiredAal','aal2',
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'assetClass',a.asset_class) order by a.name)
      from public.assets a,context c where a.organization_id=c.org),'[]'::jsonb),
    'sites',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name) order by s.name)
      from public.sites s,context c where s.organization_id=c.org),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'description',e.description,'sourceSystem',e.source_system,
      'assetId',e.asset_id,'verifiedBy',e.verified_by,'verifiedAt',e.verified_at)
      order by e.verified_at desc)
      from public.evidence_items e join public.user_profiles verifier
        on verifier.id=e.verified_by and verifier.organization_id=e.organization_id
        and verifier.role<>'ai_admin'
      join context c on e.organization_id=c.org
      where e.verified_by<>(select actor from context)
        and e.verification_status='verified' and e.verified_by is not null
        and e.verified_at is not null),'[]'::jsonb),
    'emissionFactors',coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'factorKey',f.factor_key,'label',f.label,
      'activityUnit',f.activity_unit,'factor',f.factor,'factorUnit',f.factor_unit,
      'source',f.source,'validFrom',f.valid_from,'gwp',f.gwp,
      'evidenceItemId',f.evidence_item_id) order by f.factor_key,f.valid_from desc)
      from public.emission_factors f,context c where f.organization_id=c.org),'[]'::jsonb),
    'baselines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'assetId',b.asset_id,'assetName',a.name,'metric',b.metric,
      'unit',b.unit,'designValue',b.design_value,'establishedOn',b.established_on,
      'interventionCost',b.intervention_cost,'energyCostPerDay',b.energy_cost_per_day,
      'evidenceItemId',b.evidence_item_id,'basis',b.basis,
      'sourceReference',b.source_reference,'version',b.version)
      order by a.name,b.metric)
      from public.efficiency_baselines b join public.assets a
        on a.id=b.asset_id and a.organization_id=b.organization_id
      join context c on b.organization_id=c.org),'[]'::jsonb),
    'hazardousInventory',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'inventoryRef',coalesce(h.inventory_ref,'legacy-'||h.id::text),
      'version',h.version,'assetId',h.asset_id,'assetName',a.name,
      'substance',h.substance,'category',h.category,'quantity',h.quantity,
      'unit',h.unit,'location',h.location,
      'handlingRequirements',h.handling_requirements,
      'emergencyResponseReference',h.emergency_response_reference,
      'regulatoryReference',h.regulatory_reference,
      'disposalRouteRequired',h.disposal_route_required,
      'endOfLifePlanned',h.end_of_life_planned,
      'evidenceItemId',h.evidence_item_id,'basis',h.basis,
      'sourceReference',h.source_reference,'recordedAt',h.recorded_at)
      order by h.substance,h.inventory_ref)
      from hazard_ranked h left join public.assets a
        on a.id=h.asset_id and a.organization_id=h.organization_id
      where h.rn=1),'[]'::jsonb),
    'decisionBoundary','These records are governed environmental evidence. They do not certify compliance, create a reportable inventory, authorize work, accept risk, change an operating limit or return equipment to service.'
  )
$$;

revoke all on function public.get_environmental_evidence_workspace()
  from public,anon,service_role;
grant execute on function public.get_environmental_evidence_workspace()
  to authenticated;

revoke insert,update,delete,truncate on public.emission_factors
  from anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.environmental_activities
  from anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.efficiency_baselines
  from anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.efficiency_readings
  from anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.hazardous_inventory
  from anon,authenticated,service_role;

comment on function public.record_environmental_evidence(text,jsonb) is
  'E10 governed AAL2 named-human writer for existing environmental tables, requiring independently verified evidence and granting no compliance or operational authority.';
comment on function public.get_environmental_loss_records() is
  'E10.07 tenant-scoped lubricant, chemical and canonical process-containment losses for customer-reachable analysis; no cross-unit total is produced.';

notify pgrst,'reload schema';
